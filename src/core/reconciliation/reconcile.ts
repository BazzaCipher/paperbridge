/**
 * Reconcile transactions between two TxnGroups.
 *
 * Hard gates: signed-amount equality (within `amountTolerance`) AND date within
 * `dateWindowDays`. The date gate is skipped when either side has empty date
 * (`''`) — a common case for invoice TxnGroups without a tagged date region —
 * and that match is given a neutral date score (0.5).
 *
 * Description similarity (Dice on character bigrams) is a tie-breaker for
 * ambiguous candidates and contributes to the match score. Greedy assignment
 * by descending score; pragmatic and explainable, not globally optimal.
 */

import type { TxnGroup, Transaction } from '../sources/txnGroup';

export interface ReconcileOptions {
  /** Absolute tolerance on signed amount, e.g. 0.01. */
  amountTolerance: number;
  /** Day window for matching dates (inclusive), e.g. 3. */
  dateWindowDays: number;
  /** Minimum Dice similarity (0-1) on tokenized descriptions. Default 0. */
  descriptionMinSimilarity?: number;
  /** Locked pairs (manual matches) — removed from candidate pool before scoring. */
  locks?: Array<{ aId: string; bId: string }>;
  /** Rejected pairs — never considered. */
  rejections?: Array<{ aId: string; bId: string }>;
}

export interface MatchedPair {
  a: Transaction;
  b: Transaction;
  score: number;
  reasons: string[];
}

export interface ReconcileResult {
  matched: MatchedPair[];
  onlyInA: Transaction[];
  onlyInB: Transaction[];
}

const DAY_MS = 86_400_000;

function parseDay(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
}

function bigrams(s: string): Set<string> {
  const norm = s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const out = new Set<string>();
  if (norm.length < 2) {
    if (norm.length === 1) out.add(norm);
    return out;
  }
  for (let i = 0; i < norm.length - 1; i++) out.add(norm.slice(i, i + 2));
  return out;
}

export function descriptionSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

interface Candidate {
  ai: number;
  bi: number;
  score: number;
  reasons: string[];
}

export function reconcile(
  a: TxnGroup,
  b: TxnGroup,
  opts: ReconcileOptions,
): ReconcileResult {
  const minSim = opts.descriptionMinSimilarity ?? 0;
  const aDays = a.transactions.map((t) => parseDay(t.date));
  const bDays = b.transactions.map((t) => parseDay(t.date));

  const lockA = new Set<number>();
  const lockB = new Set<number>();
  const matched: MatchedPair[] = [];
  for (const lock of opts.locks ?? []) {
    const ai = a.transactions.findIndex((t) => t.id === lock.aId);
    const bi = b.transactions.findIndex((t) => t.id === lock.bId);
    if (ai < 0 || bi < 0) continue;
    lockA.add(ai);
    lockB.add(bi);
    matched.push({
      a: a.transactions[ai],
      b: b.transactions[bi],
      score: 1,
      reasons: ['manual'],
    });
  }

  const rejectKey = (aid: string, bid: string) => `${aid}::${bid}`;
  const rejected = new Set((opts.rejections ?? []).map((r) => rejectKey(r.aId, r.bId)));

  const candidates: Candidate[] = [];

  for (let i = 0; i < a.transactions.length; i++) {
    if (lockA.has(i)) continue;
    const ta = a.transactions[i];
    const da = aDays[i];
    for (let j = 0; j < b.transactions.length; j++) {
      if (lockB.has(j)) continue;
      const tb = b.transactions[j];
      if (rejected.has(rejectKey(ta.id, tb.id))) continue;
      const db = bDays[j];

      const amtDelta = Math.abs(ta.amount - tb.amount);
      if (amtDelta > opts.amountTolerance) continue;

      let dateDelta: number | null = null;
      if (da !== null && db !== null) {
        dateDelta = Math.abs(da - db);
        if (dateDelta > opts.dateWindowDays) continue;
      }

      const sim = descriptionSimilarity(ta.description, tb.description);
      if (sim < minSim) continue;

      const reasons: string[] = [];
      reasons.push(`amount Δ ${amtDelta.toFixed(2)}`);
      if (dateDelta !== null) reasons.push(`date Δ ${dateDelta}d`);
      reasons.push(`desc sim ${sim.toFixed(2)}`);

      const amountScore = 1 - amtDelta / Math.max(opts.amountTolerance, 1e-9);
      const dateScore = dateDelta === null
        ? 0.5
        : 1 - dateDelta / Math.max(opts.dateWindowDays, 1);
      const score = amountScore * 0.6 + dateScore * 0.25 + sim * 0.15;

      candidates.push({ ai: i, bi: j, score, reasons });
    }
  }

  candidates.sort((x, y) => y.score - x.score);

  const usedA = new Set<number>(lockA);
  const usedB = new Set<number>(lockB);
  for (const c of candidates) {
    if (usedA.has(c.ai) || usedB.has(c.bi)) continue;
    usedA.add(c.ai);
    usedB.add(c.bi);
    matched.push({
      a: a.transactions[c.ai],
      b: b.transactions[c.bi],
      score: c.score,
      reasons: c.reasons,
    });
  }

  const onlyInA = a.transactions.filter((_, i) => !usedA.has(i));
  const onlyInB = b.transactions.filter((_, i) => !usedB.has(i));

  return { matched, onlyInA, onlyInB };
}
