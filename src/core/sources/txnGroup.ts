/**
 * TxnGroup: a labeled bag of `Transaction`s. Universal payload for the
 * `txngroup:` handle datatype. Sources include bank statements, single
 * invoice extractors (1-Transaction groups), and aggregated GroupNodes
 * (concat of children's TxnGroups on collapse).
 */

import type { MaterializedTable } from '../extraction/tableMaterializer';

export interface Transaction {
  /** FNV-1a stable hash of date+amount+description. */
  id: string;
  /** Signed; debit negative, credit positive. */
  amount: number;
  /** ISO 'YYYY-MM-DD'; '' if unknown. */
  date: string;
  description: string;
  /** Every original cell keyed by header label, when from a table. */
  raw?: Record<string, string>;
  /** Originating node id (for highlight wiring back to canvas). */
  sourceNodeId: string;
  /** Stable row id within the source: region id, table row id, etc. */
  sourceRowId: string;
}

export interface BankStatementMeta {
  account?: string;
  /** ISO 4217, e.g. "AUD". */
  currency?: string;
  statementPeriod?: { from: string; to: string };
  openingBalance?: number;
  closingBalance?: number;
}

export interface TxnGroup {
  id: string;
  /** User-visible label, e.g. "Bank A · March", "March invoices". */
  label: string;
  transactions: Transaction[];
  origin: {
    kind: 'bank' | 'invoice' | 'aggregated';
    /** Contributing node ids. */
    nodeIds: string[];
    /** ISO timestamp. */
    extractedAt: string;
    /** Original header labels, when from a table. */
    sourceHeaders?: string[];
    fileId?: string;
    pageRange?: [number, number];
  };
  meta?: BankStatementMeta;
}

export interface BankColumnMapping {
  date: string;
  description: string;
  /** Single signed amount column. */
  amount?: string;
  /** OR debit + credit pair (CBA-style). */
  debit?: string;
  credit?: string;
  balance?: string;
}

// ─── Normalization helpers ────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (!s) return s;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
  if (dmy) {
    const d = +dmy[1];
    const m = +dmy[2];
    let y = +dmy[3];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
  }

  const dmonY = /^(\d{1,2})[\s\-]([A-Za-z]{3,9})[\s\-](\d{2,4})$/.exec(s);
  if (dmonY) {
    const d = +dmonY[1];
    const m = MONTHS[dmonY[2].toLowerCase()];
    let y = +dmonY[3];
    if (m && y) {
      if (y < 100) y += y < 50 ? 2000 : 1900;
      return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    }
  }

  return s;
}

export interface ParseAmountOptions {
  negativeParens?: boolean;
  currencySymbols?: boolean;
}

export function parseSignedAmount(raw: string, opts: ParseAmountOptions = {}): number {
  let s = raw.trim();
  if (!s) return NaN;
  let sign = 1;
  if (opts.negativeParens && /^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (opts.currencySymbols) {
    s = s.replace(/[A-Z]{2,3}\$?|\$|€|£|¥/gi, '');
  }
  s = s.replace(/,/g, '').trim();
  if (s.endsWith('-')) {
    sign = -1;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1).trim();
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return sign * n;
}

// ─── Stable hash for transaction IDs ──────────────────────────────────────

function hashTxn(date: string, amount: number, description: string): string {
  const s = `${date}|${amount.toFixed(2)}|${description.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `txn_${(h >>> 0).toString(36)}`;
}

// ─── Adapter: MaterializedTable → TxnGroup (bank-statement path) ──────────

export interface MaterializedToTxnGroupMeta {
  /** Originating ExtractorNode id. */
  nodeId: string;
  /** Display label for the group. */
  label: string;
  fileId: string;
  pageRange: [number, number];
  /** Optional id to assign; otherwise generated. */
  id?: string;
  account?: string;
  currency?: string;
  statementPeriod?: { from: string; to: string };
  openingBalance?: number;
  closingBalance?: number;
}

export function materializedTableToTxnGroup(
  table: MaterializedTable,
  mapping: BankColumnMapping,
  meta: MaterializedToTxnGroupMeta,
): TxnGroup {
  const headers = table.headers;
  const idx = (label: string | undefined): number =>
    label === undefined ? -1 : headers.findIndex((h) => h === label);

  const dateCol = idx(mapping.date);
  const descCol = idx(mapping.description);
  const amountCol = idx(mapping.amount);
  const debitCol = idx(mapping.debit);
  const creditCol = idx(mapping.credit);
  const balanceCol = idx(mapping.balance);

  const transactions: Transaction[] = [];

  for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
    const row = table.rows[rowIdx];
    const rawDate = dateCol >= 0 ? (row[dateCol] ?? '') : '';
    const rawDesc = descCol >= 0 ? (row[descCol] ?? '') : '';
    if (!rawDate.trim() && !rawDesc.trim()) continue;

    const date = normalizeDate(rawDate);

    let amount = NaN;
    if (amountCol >= 0) {
      amount = parseSignedAmount(row[amountCol] ?? '', { negativeParens: true, currencySymbols: true });
    } else {
      const debit = debitCol >= 0 ? parseSignedAmount(row[debitCol] ?? '', { negativeParens: true, currencySymbols: true }) : NaN;
      const credit = creditCol >= 0 ? parseSignedAmount(row[creditCol] ?? '', { negativeParens: true, currencySymbols: true }) : NaN;
      if (Number.isFinite(credit) && credit !== 0) amount = Math.abs(credit);
      else if (Number.isFinite(debit) && debit !== 0) amount = -Math.abs(debit);
      else amount = 0;
    }
    // Keep the row even when amount is unparseable — set to 0 so the user
    // can correct the column mapping after the fact rather than silently
    // losing transactions that the heuristic couldn't classify.
    if (!Number.isFinite(amount)) amount = 0;

    const balance = balanceCol >= 0
      ? parseSignedAmount(row[balanceCol] ?? '', { negativeParens: true, currencySymbols: true })
      : NaN;

    const raw: Record<string, string> = {};
    headers.forEach((h, i) => { raw[h] = row[i] ?? ''; });
    if (Number.isFinite(balance)) raw.__balance = String(balance);

    transactions.push({
      id: hashTxn(date, amount, rawDesc),
      date,
      description: rawDesc.trim(),
      amount,
      raw,
      sourceNodeId: meta.nodeId,
      sourceRowId: `row-${rowIdx}`,
    });
  }

  return {
    id: meta.id ?? `txngroup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: meta.label,
    transactions,
    origin: {
      kind: 'bank',
      nodeIds: [meta.nodeId],
      extractedAt: new Date().toISOString(),
      sourceHeaders: [...headers],
      fileId: meta.fileId,
      pageRange: meta.pageRange,
    },
    meta: {
      account: meta.account,
      currency: meta.currency,
      statementPeriod: meta.statementPeriod,
      openingBalance: meta.openingBalance,
      closingBalance: meta.closingBalance,
    },
  };
}

// ─── Invoice TxnGroup (single-Transaction from role-tagged regions) ──────

interface RoleTaggedRegion {
  id: string;
  role?: 'amount' | 'date' | 'description';
  /** Display value already normalized (e.g. ISO date for `date`). */
  value: string;
}

export interface InvoiceTxnGroupMeta {
  nodeId: string;
  /** Falls back to label of node when no description-roled region exists. */
  label: string;
  /** Optional id to assign; otherwise generated. */
  id?: string;
}

/**
 * Build a single-Transaction TxnGroup from an ExtractorNode's role-tagged
 * regions. Returns null if no region has `role: 'amount'` or the amount
 * doesn't parse. Description falls back to `meta.label` when no
 * description-roled region exists.
 */
export function regionsToInvoiceTxnGroup(
  regions: RoleTaggedRegion[],
  meta: InvoiceTxnGroupMeta,
): TxnGroup | null {
  const amountRegion = regions.find((r) => r.role === 'amount');
  if (!amountRegion) return null;
  const amount = parseSignedAmount(amountRegion.value, { negativeParens: true, currencySymbols: true });
  if (!Number.isFinite(amount)) return null;

  const dateRegion = regions.find((r) => r.role === 'date');
  const descRegion = regions.find((r) => r.role === 'description');

  const date = dateRegion ? normalizeDate(dateRegion.value) : '';
  const description = (descRegion?.value || meta.label || '').trim();

  return {
    id: meta.id ?? `txngroup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: meta.label,
    transactions: [
      {
        id: hashTxn(date, amount, description),
        amount,
        date,
        description,
        sourceNodeId: meta.nodeId,
        sourceRowId: amountRegion.id,
      },
    ],
    origin: {
      kind: 'invoice',
      nodeIds: [meta.nodeId],
      extractedAt: new Date().toISOString(),
    },
  };
}

// ─── Auto-detect mapping ──────────────────────────────────────────────────

// Strict whole-cell match used by content scoring in scoreContent().
const DATE_RE = /^\d{1,2}[\/\- ]\d{1,2}[\/\- ]\d{2,4}$|^\d{4}-\d{2}-\d{2}$|^\d{1,2}[\s\-][A-Za-z]{3,9}[\s\-]\d{2,4}$/;
// Permissive substring match used by content-based mapping inference: many
// bank statements omit the year ("12/03", "12 Mar"), and OCR can leave stray
// whitespace or punctuation. Substring is safe here because the column needs
// to score >= 0.5 across all populated cells before we pick it as a date col.
const DATE_LIKE_RE =
  /\b\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/i;
const MONEY_RE = /^[\$\-\(]?[A-Z]{0,3}\$?\s?[\d,]+\.\d{2}\)?-?$/;
// Permissive money: allows whole-dollar amounts and trailing CR/DR markers
// commonly seen on statements.
const MONEY_LIKE_RE = /^[\$\-\(]?[A-Z]{0,3}\$?\s?[\d,]+(?:\.\d{1,2})?\s?(?:\)|-|CR|DR)?$/i;

interface ColumnScores {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  balance: number;
}

function scoreHeader(header: string): ColumnScores {
  const h = header.toLowerCase();
  return {
    date: /date|posted|trans/.test(h) ? 1 : 0,
    description: /desc|narr|details|ref|particulars|payee/.test(h) ? 1 : 0,
    amount: /^amount$|^amt$/.test(h) ? 1 : 0,
    debit: /debit|withdraw|out|paid out/.test(h) ? 1 : 0,
    credit: /credit|deposit|in|paid in/.test(h) ? 1 : 0,
    balance: /balance/.test(h) ? 1 : 0,
  };
}

function scoreContent(rows: string[][], colIdx: number): { date: number; money: number } {
  let dateMatches = 0;
  let moneyMatches = 0;
  let total = 0;
  for (const r of rows) {
    const v = (r[colIdx] ?? '').trim();
    if (!v) continue;
    total++;
    if (DATE_RE.test(v)) dateMatches++;
    if (MONEY_RE.test(v.replace(/\s/g, ''))) moneyMatches++;
  }
  if (total === 0) return { date: 0, money: 0 };
  return { date: dateMatches / total, money: moneyMatches / total };
}

export interface SuggestedMapping {
  mapping: BankColumnMapping | null;
  confidence: number;
}

export function suggestBankMapping(table: MaterializedTable): SuggestedMapping {
  const { headers, rows } = table;
  if (headers.length === 0) return { mapping: null, confidence: 0 };

  const used = new Set<number>();
  const pick = (
    headerKey: keyof ColumnScores,
    contentBoost: 'date' | 'money' | null,
  ): { idx: number; score: number } | null => {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const hs = scoreHeader(headers[i])[headerKey];
      if (hs <= 0) continue;
      const cs = contentBoost ? scoreContent(rows, i)[contentBoost] : 0;
      const score = hs * 1.0 + (cs >= 0.8 ? 0.5 : cs * 0.5);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1 || bestScore <= 0) return null;
    used.add(bestIdx);
    return { idx: bestIdx, score: bestScore };
  };

  const date = pick('date', 'date');
  const description = pick('description', null);
  const debit = pick('debit', 'money');
  const credit = pick('credit', 'money');
  const amount = !debit && !credit ? pick('amount', 'money') : null;
  const balance = pick('balance', 'money');

  if (!date || !description || (!amount && !debit && !credit)) {
    return { mapping: null, confidence: 0 };
  }

  const mapping: BankColumnMapping = {
    date: headers[date.idx],
    description: headers[description.idx],
    amount: amount ? headers[amount.idx] : undefined,
    debit: debit ? headers[debit.idx] : undefined,
    credit: credit ? headers[credit.idx] : undefined,
    balance: balance ? headers[balance.idx] : undefined,
  };

  const parts = [date.score, description.score, amount?.score ?? Math.max(debit?.score ?? 0, credit?.score ?? 0)];
  const confidence = parts.reduce((a, b) => a + b, 0) / (parts.length * 1.5);

  return { mapping, confidence: Math.min(1, confidence) };
}

/**
 * Content-based mapping: picks columns by what their cells LOOK like, not by
 * header text. Used when suggestBankMapping (header-keyword based) fails —
 * common when OCR mangles header words ("Dale" instead of "Date") or when the
 * statement has no header row at all. As long as the table has a date-shaped
 * column and a money-shaped column, table-mode emits a usable TxnGroup.
 */
export function inferMappingFromContent(table: MaterializedTable): SuggestedMapping {
  const { headers, rows } = table;
  if (headers.length === 0 || rows.length === 0) return { mapping: null, confidence: 0 };

  const stats = headers.map((_, colIdx) => {
    const cells = rows.map((r) => (r[colIdx] ?? '').trim()).filter(Boolean);
    const total = cells.length || 1;
    const dates = cells.filter((c) => DATE_LIKE_RE.test(c)).length / total;
    const money = cells.filter((c) => MONEY_LIKE_RE.test(c.replace(/\s/g, ''))).length / total;
    const avgLen = cells.reduce((a, c) => a + c.length, 0) / total;
    const wordCount = cells.reduce((a, c) => a + c.split(/\s+/).length, 0) / total;
    return { colIdx, dates, money, avgLen, wordCount };
  });

  // Greedy picks: always assign each role to its best-scoring unused column,
  // even when the score is 0. Table mode is "I want a TxnGroup from this" —
  // an obviously-wrong column the user can re-tag is better than no group at
  // all. confidence reflects scoring quality so the keyword path still wins
  // when both succeed.
  const used = new Set<number>();
  const pickHighest = (key: 'dates' | 'money', preferLeft = false): number => {
    const candidates = stats.filter((s) => !used.has(s.colIdx));
    if (candidates.length === 0) return -1;
    candidates.sort((a, b) => {
      if (b[key] !== a[key]) return b[key] - a[key];
      return preferLeft ? a.colIdx - b.colIdx : b.colIdx - a.colIdx;
    });
    used.add(candidates[0].colIdx);
    return candidates[0].colIdx;
  };

  const dateIdx = pickHighest('dates', true);
  const amountIdx = pickHighest('money', true);

  // Balance: a money-shaped column to the right of amount, only if it
  // genuinely scores. Otherwise leave undefined.
  const balanceIdx = stats
    .filter((s) => !used.has(s.colIdx) && s.money >= 0.5 && s.colIdx > amountIdx)
    .sort((a, b) => b.money - a.money)[0]?.colIdx;
  if (balanceIdx !== undefined) used.add(balanceIdx);

  // Description: longest remaining text-like column. If nothing is left,
  // reuse the most word-heavy column overall (excluding the date column).
  const descCandidates = stats
    .filter((s) => !used.has(s.colIdx))
    .sort((a, b) => b.wordCount - a.wordCount || b.avgLen - a.avgLen);
  const descIdx =
    descCandidates[0]?.colIdx ??
    stats
      .filter((s) => s.colIdx !== dateIdx)
      .sort((a, b) => b.wordCount - a.wordCount)[0]?.colIdx ??
    (dateIdx >= 0 ? dateIdx : 0);

  const mapping: BankColumnMapping = {
    date: dateIdx >= 0 ? headers[dateIdx] : '',
    description: descIdx >= 0 ? headers[descIdx] : '',
    amount: amountIdx >= 0 ? headers[amountIdx] : undefined,
    balance: balanceIdx !== undefined ? headers[balanceIdx] : undefined,
  };

  // Confidence reflects content quality, capped well below the keyword-based
  // path so a header match still wins when both succeed.
  const dateScore = dateIdx >= 0 ? stats[dateIdx].dates : 0;
  const moneyScore = amountIdx >= 0 ? stats[amountIdx].money : 0;
  const confidence = Math.min(0.7, (dateScore + moneyScore) / 2);
  return { mapping, confidence };
}
