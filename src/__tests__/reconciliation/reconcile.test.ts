import { describe, it, expect } from 'vitest';
import { reconcile, descriptionSimilarity } from '../../core/reconciliation/reconcile';
import type { TxnGroup, Transaction } from '../../core/sources/txnGroup';

function txn(id: string, date: string, amount: number, description: string): Transaction {
  return { id, date, amount, description, sourceNodeId: 'n1', sourceRowId: id };
}

function group(transactions: Transaction[]): TxnGroup {
  return {
    id: 'g',
    label: 'g',
    transactions,
    origin: { kind: 'bank', nodeIds: ['n1'], extractedAt: '2026-01-01T00:00:00Z' },
  };
}

describe('descriptionSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(descriptionSimilarity('Acme Corp', 'Acme Corp')).toBe(1);
  });
  it('returns >0 for partial overlap and 0 for disjoint', () => {
    expect(descriptionSimilarity('Acme Corp', 'Acme Corporation')).toBeGreaterThan(0.4);
    expect(descriptionSimilarity('xyz', 'qqqq')).toBe(0);
  });
});

describe('reconcile', () => {
  it('matches identical transactions', () => {
    const a = group([txn('a1', '2026-03-01', -50, 'Coffee shop')]);
    const b = group([txn('b1', '2026-03-01', -50, 'Coffee shop')]);
    const r = reconcile(a, b, { amountTolerance: 0.01, dateWindowDays: 0 });
    expect(r.matched).toHaveLength(1);
    expect(r.onlyInA).toHaveLength(0);
    expect(r.onlyInB).toHaveLength(0);
  });

  it('rejects matches outside amount tolerance', () => {
    const a = group([txn('a1', '2026-03-01', -50.0, 'X')]);
    const b = group([txn('b1', '2026-03-01', -50.5, 'X')]);
    const r = reconcile(a, b, { amountTolerance: 0.1, dateWindowDays: 3 });
    expect(r.matched).toHaveLength(0);
  });

  it('respects date window', () => {
    const a = group([txn('a1', '2026-03-01', -50, 'X')]);
    const b = group([txn('b1', '2026-03-05', -50, 'X')]);
    expect(reconcile(a, b, { amountTolerance: 0.01, dateWindowDays: 3 }).matched).toHaveLength(0);
    expect(reconcile(a, b, { amountTolerance: 0.01, dateWindowDays: 5 }).matched).toHaveLength(1);
  });

  it('matches when one side has empty date (invoice case)', () => {
    const a = group([txn('a1', '2026-03-01', -50, 'Acme')]);
    const b = group([txn('b1', '', -50, 'Acme')]);
    const r = reconcile(a, b, { amountTolerance: 0.01, dateWindowDays: 0 });
    expect(r.matched).toHaveLength(1);
  });

  it('uses description similarity to break ties greedily', () => {
    const a = group([txn('a1', '2026-03-01', -50, 'Acme Coffee Roasters')]);
    const b = group([
      txn('b1', '2026-03-01', -50, 'Wayne Enterprises'),
      txn('b2', '2026-03-01', -50, 'Acme Coffee'),
    ]);
    const r = reconcile(a, b, { amountTolerance: 0.01, dateWindowDays: 0 });
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].b.id).toBe('b2');
    expect(r.onlyInB.map((t) => t.id)).toEqual(['b1']);
  });

  it('does not reuse transactions on either side', () => {
    const a = group([
      txn('a1', '2026-03-01', -50, 'X'),
      txn('a2', '2026-03-01', -50, 'X'),
    ]);
    const b = group([txn('b1', '2026-03-01', -50, 'X')]);
    const r = reconcile(a, b, { amountTolerance: 0.01, dateWindowDays: 0 });
    expect(r.matched).toHaveLength(1);
    expect(r.onlyInA).toHaveLength(1);
    expect(r.onlyInB).toHaveLength(0);
  });

  it('honors descriptionMinSimilarity gate', () => {
    const a = group([txn('a1', '2026-03-01', -50, 'Acme')]);
    const b = group([txn('b1', '2026-03-01', -50, 'Wayne')]);
    const r = reconcile(a, b, { amountTolerance: 0.01, dateWindowDays: 0, descriptionMinSimilarity: 0.5 });
    expect(r.matched).toHaveLength(0);
  });

  it('honors locks (manual matches) and excludes them from candidate pool', () => {
    const a = group([
      txn('a1', '2026-03-01', -50, 'Foo'),
      txn('a2', '2026-03-01', -50, 'Bar'),
    ]);
    const b = group([
      txn('b1', '2026-03-01', -50, 'Foo'),
      txn('b2', '2026-03-01', -50, 'Bar'),
    ]);
    const r = reconcile(a, b, {
      amountTolerance: 0.01,
      dateWindowDays: 0,
      locks: [{ aId: 'a1', bId: 'b2' }],
    });
    expect(r.matched).toHaveLength(2);
    const lockedPair = r.matched.find((p) => p.a.id === 'a1');
    expect(lockedPair?.b.id).toBe('b2');
    const autoPair = r.matched.find((p) => p.a.id === 'a2');
    expect(autoPair?.b.id).toBe('b1');
  });

  it('honors rejections', () => {
    const a = group([txn('a1', '2026-03-01', -50, 'X')]);
    const b = group([txn('b1', '2026-03-01', -50, 'X')]);
    const r = reconcile(a, b, {
      amountTolerance: 0.01,
      dateWindowDays: 0,
      rejections: [{ aId: 'a1', bId: 'b1' }],
    });
    expect(r.matched).toHaveLength(0);
  });
});
