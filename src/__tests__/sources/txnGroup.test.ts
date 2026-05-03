import { describe, it, expect } from 'vitest';
import type { MaterializedTable } from '../../core/extraction/tableMaterializer';
import {
  normalizeDate,
  parseSignedAmount,
  materializedTableToTxnGroup,
  suggestBankMapping,
  getRoleForHeader,
  setRoleForHeader,
  remapBankTxnGroup,
} from '../../core/sources/txnGroup';

const META = { nodeId: 'ext1', label: 'Bank A', fileId: 'f1', pageRange: [1, 1] as [number, number] };

describe('normalizeDate', () => {
  it('passes through ISO dates', () => {
    expect(normalizeDate('2026-04-27')).toBe('2026-04-27');
  });
  it('handles DD/MM/YYYY (AU)', () => {
    expect(normalizeDate('27/04/2026')).toBe('2026-04-27');
    expect(normalizeDate('1/4/26')).toBe('2026-04-01');
  });
  it('handles DD MMM YYYY', () => {
    expect(normalizeDate('27 Apr 2026')).toBe('2026-04-27');
    expect(normalizeDate('1-Jan-25')).toBe('2025-01-01');
  });
  it('returns input unchanged when no pattern matches', () => {
    expect(normalizeDate('not a date')).toBe('not a date');
  });
});

describe('parseSignedAmount', () => {
  it('parses plain numbers', () => {
    expect(parseSignedAmount('1,234.56')).toBeCloseTo(1234.56);
  });
  it('handles parens as negative', () => {
    expect(parseSignedAmount('(123.45)', { negativeParens: true })).toBeCloseTo(-123.45);
  });
  it('strips currency symbols', () => {
    expect(parseSignedAmount('$1,000.00', { currencySymbols: true })).toBeCloseTo(1000);
    expect(parseSignedAmount('AUD 50.25', { currencySymbols: true })).toBeCloseTo(50.25);
  });
  it('handles trailing minus', () => {
    expect(parseSignedAmount('100.00-')).toBeCloseTo(-100);
  });
  it('returns NaN for unparseable', () => {
    expect(parseSignedAmount('abc')).toBeNaN();
  });
});

describe('materializedTableToTxnGroup — single signed amount column', () => {
  const table: MaterializedTable = {
    headers: ['Date', 'Description', 'Amount', 'Balance'],
    rows: [
      ['27/04/2026', 'COFFEE SHOP', '-5.50', '1,000.00'],
      ['28/04/2026', 'SALARY', '2,500.00', '3,500.00'],
    ],
    cellBoxes: [],
  };

  it('produces transactions with signed amounts and source tracking', () => {
    const g = materializedTableToTxnGroup(
      table,
      { date: 'Date', description: 'Description', amount: 'Amount', balance: 'Balance' },
      META,
    );
    expect(g.transactions).toHaveLength(2);
    expect(g.transactions[0]).toMatchObject({
      date: '2026-04-27',
      description: 'COFFEE SHOP',
      amount: -5.5,
      sourceNodeId: 'ext1',
    });
    expect(g.transactions[0].sourceRowId).toBe('row-0');
    expect(g.transactions[1].amount).toBe(2500);
    expect(g.origin.kind).toBe('bank');
    expect(g.origin.sourceHeaders).toEqual(table.headers);
  });

  it('preserves raw cells keyed by header', () => {
    const g = materializedTableToTxnGroup(
      table,
      { date: 'Date', description: 'Description', amount: 'Amount' },
      META,
    );
    expect(g.transactions[0].raw).toMatchObject({
      Date: '27/04/2026',
      Description: 'COFFEE SHOP',
      Amount: '-5.50',
      Balance: '1,000.00',
    });
  });

  it('transaction id is stable for same inputs', () => {
    const g1 = materializedTableToTxnGroup(table, { date: 'Date', description: 'Description', amount: 'Amount' }, META);
    const g2 = materializedTableToTxnGroup(table, { date: 'Date', description: 'Description', amount: 'Amount' }, META);
    expect(g1.transactions[0].id).toBe(g2.transactions[0].id);
  });
});

describe('materializedTableToTxnGroup — debit/credit pair (CBA-style)', () => {
  const table: MaterializedTable = {
    headers: ['Date', 'Details', 'Debit', 'Credit', 'Balance'],
    rows: [
      ['27/04/2026', 'COFFEE', '5.50', '', '994.50'],
      ['28/04/2026', 'SALARY', '', '2,500.00', '3,494.50'],
      ['', '', '', '', ''],
    ],
    cellBoxes: [],
  };

  it('signs debits negative and credits positive', () => {
    const g = materializedTableToTxnGroup(
      table,
      { date: 'Date', description: 'Details', debit: 'Debit', credit: 'Credit', balance: 'Balance' },
      META,
    );
    expect(g.transactions).toHaveLength(2);
    expect(g.transactions[0].amount).toBe(-5.5);
    expect(g.transactions[1].amount).toBe(2500);
  });
});

describe('materializedTableToTxnGroup — multi-line description merge', () => {
  // Captured directly from the AI vision response on the NAB statement.
  // One logical "Internet Transfer" txn spans two visual lines: the first
  // carries the amount, the second only carries a continuation of the desc.
  const nabTable: MaterializedTable = {
    headers: ['Date', 'Particulars', 'Debits', 'Credits', 'Balance'],
    rows: [
      ['7 Sep 2019', 'Brought forward', '', '', '26,659.01 Cr'],
      ['9 Sep 2019', 'Interest Rate Brought Forward Is 0.11%', '', '', ''],
      ['', 'Internet Transfer', '20.00', '', ''],
      ['', 'X Li.....................................................................t', '', '', ''],
      ['', 'Internet Transfer', '100.00', '', ''],
      ['', 'X Li.....................................................................t', '', '', ''],
    ],
    cellBoxes: [],
  };

  it('collapses continuation rows into the prior logical transaction', () => {
    const g = materializedTableToTxnGroup(
      nabTable,
      { date: 'Date', description: 'Particulars', debit: 'Debits', credit: 'Credits', balance: 'Balance' },
      META,
    );
    expect(g.transactions).toHaveLength(4);

    // Row 0: Brought forward (no debit/credit, opening balance only)
    expect(g.transactions[0].description).toBe('Brought forward');

    // Row 1: Interest rate notice
    expect(g.transactions[1].description).toContain('Interest Rate Brought Forward');

    // Row 2: Internet Transfer 20.00 — must absorb the X Li... continuation
    expect(g.transactions[2].description).toBe('Internet Transfer X Li.....................................................................t');
    expect(g.transactions[2].amount).toBe(-20);

    // Row 3: Internet Transfer 100.00 — likewise
    expect(g.transactions[3].description).toContain('Internet Transfer');
    expect(g.transactions[3].description).toContain('X Li');
    expect(g.transactions[3].amount).toBe(-100);
  });
});

describe('materializedTableToTxnGroup — persists mapping on origin', () => {
  it('stores the column mapping on group.origin.mapping', () => {
    const table: MaterializedTable = {
      headers: ['Date', 'Description', 'Amount'],
      rows: [['27/04/2026', 'COFFEE', '-5.50']],
      cellBoxes: [],
    };
    const g = materializedTableToTxnGroup(
      table,
      { date: 'Date', description: 'Description', amount: 'Amount' },
      META,
    );
    expect(g.origin.mapping).toEqual({
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
    });
  });
});

describe('getRoleForHeader / setRoleForHeader', () => {
  const m = { date: 'Date', description: 'Desc', debit: 'Out', credit: 'In', balance: 'Bal' };

  it('returns the assigned role for a header', () => {
    expect(getRoleForHeader('Date', m)).toBe('date');
    expect(getRoleForHeader('In', m)).toBe('credit');
    expect(getRoleForHeader('Other', m)).toBeNull();
    expect(getRoleForHeader('Anything', undefined)).toBeNull();
  });

  it('reassigns a role and clears the previous holder', () => {
    const next = setRoleForHeader('Other', 'date', m);
    expect(next.date).toBe('Other');
    // Date role moved off original "Date" header.
    expect(getRoleForHeader('Date', next)).toBeNull();
  });

  it('clears a role when role is null', () => {
    const next = setRoleForHeader('In', null, m);
    expect(next.credit).toBeUndefined();
    expect(next.debit).toBe('Out');
  });

  it('switching to amount clears debit and credit', () => {
    const next = setRoleForHeader('Total', 'amount', m);
    expect(next.amount).toBe('Total');
    expect(next.debit).toBeUndefined();
    expect(next.credit).toBeUndefined();
  });

  it('switching to debit clears amount', () => {
    const withAmount = { date: 'D', description: 'X', amount: 'A' };
    const next = setRoleForHeader('Out', 'debit', withAmount);
    expect(next.amount).toBeUndefined();
    expect(next.debit).toBe('Out');
  });
});

describe('remapBankTxnGroup', () => {
  const table: MaterializedTable = {
    headers: ['Date', 'Description', 'Out', 'In', 'Balance'],
    rows: [
      ['27/04/2026', 'COFFEE', '5.50', '', '994.50'],
      ['28/04/2026', 'SALARY', '', '2,500.00', '3,494.50'],
    ],
    cellBoxes: [],
  };
  const original = materializedTableToTxnGroup(
    table,
    { date: 'Date', description: 'Description', debit: 'Out', credit: 'In', balance: 'Balance' },
    META,
  );

  it('preserves group id, label, and meta when remapping', () => {
    const remapped = remapBankTxnGroup(
      original,
      { date: 'Date', description: 'Description', debit: 'Out', credit: 'In', balance: 'Balance' },
    );
    expect(remapped.id).toBe(original.id);
    expect(remapped.label).toBe(original.label);
    expect(remapped.origin.fileId).toBe(original.origin.fileId);
  });

  it('updates origin.mapping to the new mapping', () => {
    const newMap = { date: 'Date', description: 'Description', amount: 'Out' };
    const remapped = remapBankTxnGroup(original, newMap);
    expect(remapped.origin.mapping).toEqual(newMap);
  });

  it('re-derives transaction amounts under the new role assignment', () => {
    // Treat the "Out" column as a single signed amount: the values are
    // positive, so debits become positive credits under the new mapping.
    const remapped = remapBankTxnGroup(
      original,
      { date: 'Date', description: 'Description', amount: 'Out' },
    );
    expect(remapped.transactions).toHaveLength(2);
    expect(remapped.transactions[0].amount).toBe(5.5);
    // Second row had no value in "Out", so amount is 0 under the new mapping.
    expect(remapped.transactions[1].amount).toBe(0);
  });
});

describe('suggestBankMapping', () => {
  it('detects single-amount layout', () => {
    const table: MaterializedTable = {
      headers: ['Date', 'Description', 'Amount', 'Balance'],
      rows: [
        ['27/04/2026', 'COFFEE SHOP', '-5.50', '1,000.00'],
        ['28/04/2026', 'SALARY', '2,500.00', '3,500.00'],
      ],
      cellBoxes: [],
    };
    const { mapping, confidence } = suggestBankMapping(table);
    expect(mapping).not.toBeNull();
    expect(mapping!.date).toBe('Date');
    expect(mapping!.description).toBe('Description');
    expect(mapping!.amount).toBe('Amount');
    expect(mapping!.balance).toBe('Balance');
    expect(confidence).toBeGreaterThan(0.5);
  });

  it('detects debit/credit layout', () => {
    const table: MaterializedTable = {
      headers: ['Trans Date', 'Particulars', 'Debit', 'Credit', 'Balance'],
      rows: [
        ['27/04/2026', 'COFFEE', '5.50', '', '994.50'],
        ['28/04/2026', 'SALARY', '', '2,500.00', '3,494.50'],
      ],
      cellBoxes: [],
    };
    const { mapping } = suggestBankMapping(table);
    expect(mapping).not.toBeNull();
    expect(mapping!.debit).toBe('Debit');
    expect(mapping!.credit).toBe('Credit');
    expect(mapping!.amount).toBeUndefined();
  });

  it('returns null when required columns are missing', () => {
    const table: MaterializedTable = {
      headers: ['Foo', 'Bar', 'Baz'],
      rows: [['a', 'b', 'c']],
      cellBoxes: [],
    };
    const { mapping } = suggestBankMapping(table);
    expect(mapping).toBeNull();
  });
});
