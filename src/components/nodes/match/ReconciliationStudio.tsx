/**
 * Reconciliation Studio — full-screen Xero-style overlay.
 *
 * Two side-by-side tables aligned by match status. Matched pairs share a row
 * index; unmatched rows leave the opposite cell as "─". No drawn lines —
 * alignment is the visual cue.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TxnGroup, Transaction } from '../../../core/sources/txnGroup';
import type { ReconcileResult } from '../../../core/reconciliation/reconcile';

interface CommitInput {
  manualOverrides?: Array<{ aId: string; bId: string }>;
  rejections?: Array<{ aId: string; bId: string }>;
  amountTolerance?: number;
  dateWindowDays?: number;
}

interface ReconciliationStudioProps {
  onClose: () => void;
  groupA: TxnGroup;
  groupB: TxnGroup;
  result: ReconcileResult;
  amountTolerance: number;
  dateWindowDays: number;
  manualOverrides: Array<{ aId: string; bId: string }>;
  rejections: Array<{ aId: string; bId: string }>;
  onCommit: (next: CommitInput) => void;
}

type FilterMode = 'all' | 'unmatched' | 'matched';

interface Row {
  a: Transaction | null;
  b: Transaction | null;
  score: number | null;
  /** True if this pair is in manualOverrides (locked). */
  locked: boolean;
  /** Color bucket. */
  color: 'green' | 'yellow' | 'gray';
}

function fmtAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ReconciliationStudio({
  onClose,
  groupA,
  groupB,
  result,
  amountTolerance,
  dateWindowDays,
  manualOverrides,
  rejections,
  onCommit,
}: ReconciliationStudioProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [pendingA, setPendingA] = useState<string | null>(null);
  const [pendingB, setPendingB] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(amountTolerance);
  const [dateWindow, setDateWindow] = useState(dateWindowDays);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lockedAids = useMemo(() => new Set(manualOverrides.map((p) => p.aId)), [manualOverrides]);

  // Build aligned rows: matched pairs first, then unmatchedA-only, then unmatchedB-only.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const m of result.matched) {
      const locked = lockedAids.has(m.a.id);
      const color: Row['color'] =
        locked || m.score >= 0.85 ? 'green' : 'yellow';
      out.push({ a: m.a, b: m.b, score: m.score, locked, color });
    }
    for (const t of result.onlyInA) {
      out.push({ a: t, b: null, score: null, locked: false, color: 'gray' });
    }
    for (const t of result.onlyInB) {
      out.push({ a: null, b: t, score: null, locked: false, color: 'gray' });
    }
    return out;
  }, [result, lockedAids]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'unmatched' && r.a && r.b) return false;
      if (filter === 'matched' && !(r.a && r.b)) return false;
      if (!q) return true;
      const hay = `${r.a?.description ?? ''} ${r.b?.description ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, filter, search]);

  const counts = useMemo(() => {
    const matched = result.matched.length;
    const ambiguous = result.matched.filter((m) => m.score < 0.85 && !lockedAids.has(m.a.id)).length;
    const unmatched = result.onlyInA.length + result.onlyInB.length;
    return { matched, ambiguous, unmatched };
  }, [result, lockedAids]);

  const confirmPair = useCallback(
    (aId: string, bId: string) => {
      // Add to manualOverrides; drop any rejection for this pair.
      const next = [...manualOverrides.filter((p) => p.aId !== aId && p.bId !== bId), { aId, bId }];
      onCommit({
        manualOverrides: next,
        rejections: rejections.filter((r) => !(r.aId === aId && r.bId === bId)),
      });
      setPendingA(null);
      setPendingB(null);
    },
    [manualOverrides, rejections, onCommit],
  );

  const unlinkPair = useCallback(
    (aId: string, bId: string) => {
      onCommit({
        manualOverrides: manualOverrides.filter((p) => !(p.aId === aId && p.bId === bId)),
        rejections: [...rejections, { aId, bId }],
      });
    },
    [manualOverrides, rejections, onCommit],
  );

  const onApplySettings = useCallback(() => {
    onCommit({ amountTolerance: tolerance, dateWindowDays: dateWindow });
  }, [tolerance, dateWindow, onCommit]);

  const handleAClick = useCallback(
    (t: Transaction) => {
      if (pendingB) {
        confirmPair(t.id, pendingB);
        return;
      }
      setPendingA(pendingA === t.id ? null : t.id);
    },
    [pendingA, pendingB, confirmPair],
  );

  const handleBClick = useCallback(
    (t: Transaction) => {
      if (pendingA) {
        confirmPair(pendingA, t.id);
        return;
      }
      setPendingB(pendingB === t.id ? null : t.id);
    },
    [pendingA, pendingB, confirmPair],
  );

  const isCandidateA = useCallback(
    (t: Transaction): boolean => {
      if (!pendingB) return false;
      const tb = groupB.transactions.find((x) => x.id === pendingB);
      if (!tb) return false;
      return Math.abs(t.amount - tb.amount) <= tolerance;
    },
    [pendingB, groupB, tolerance],
  );

  const isCandidateB = useCallback(
    (t: Transaction): boolean => {
      if (!pendingA) return false;
      const ta = groupA.transactions.find((x) => x.id === pendingA);
      if (!ta) return false;
      return Math.abs(t.amount - ta.amount) <= tolerance;
    },
    [pendingA, groupA, tolerance],
  );

  const colorClass = (c: Row['color']): string => {
    switch (c) {
      case 'green': return 'bg-emerald-50';
      case 'yellow': return 'bg-amber-50';
      default: return '';
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-paper-50 flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-paper-200 bg-white">
        <label className="text-xs text-bridge-500 flex items-center gap-1">
          Tolerance $
          <input
            type="number"
            step="0.01"
            min="0"
            value={tolerance}
            onChange={(e) => setTolerance(Number(e.target.value))}
            className="w-16 px-1 py-0.5 text-xs border border-paper-200 rounded"
          />
        </label>
        <label className="text-xs text-bridge-500 flex items-center gap-1">
          Date ±
          <input
            type="number"
            min="0"
            value={dateWindow}
            onChange={(e) => setDateWindow(Number(e.target.value))}
            className="w-12 px-1 py-0.5 text-xs border border-paper-200 rounded"
          />
          d
        </label>
        <button
          type="button"
          onClick={onApplySettings}
          className="px-2 py-1 text-xs bg-copper-400/10 hover:bg-copper-400/20 text-copper-700 rounded border border-copper-400/30"
        >
          Auto
        </button>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterMode)}
          className="px-2 py-1 text-xs border border-paper-200 rounded"
        >
          <option value="all">All</option>
          <option value="unmatched">Unmatched only</option>
          <option value="matched">Matched only</option>
        </select>
        <input
          type="text"
          placeholder="Search description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-2 py-1 text-xs border border-paper-200 rounded"
        />
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-1 text-xs text-bridge-500 hover:text-bridge-700"
          title="Close (Esc)"
        >
          Esc
        </button>
      </div>

      {/* Headers */}
      <div className="grid grid-cols-2 border-b border-paper-200 bg-paper-100 text-[11px] font-semibold text-bridge-600">
        <div className="px-3 py-1.5 border-r border-paper-200">
          A · {groupA.label} ({groupA.transactions.length})
        </div>
        <div className="px-3 py-1.5">
          B · {groupB.label} ({groupB.transactions.length})
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-auto">
        {filteredRows.map((r, i) => (
          <div
            key={i}
            className={`grid grid-cols-2 border-b border-paper-100 text-xs ${colorClass(r.color)}`}
            title={r.score !== null ? `score ${r.score.toFixed(2)}` : undefined}
          >
            {/* A side */}
            <div
              className={`px-3 py-1.5 border-r border-paper-200 cursor-pointer hover:bg-copper-400/10 ${
                pendingA === r.a?.id ? 'ring-2 ring-copper-400 ring-inset' : ''
              } ${r.a && isCandidateA(r.a) ? 'bg-emerald-100' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (r.a) handleAClick(r.a);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (r.a && r.b) unlinkPair(r.a.id, r.b.id);
              }}
            >
              {r.a ? (
                <div className="flex gap-2 tabular-nums">
                  <span className="text-bridge-400 w-20">{r.a.date || '—'}</span>
                  <span className="w-24 text-right">{fmtAmount(r.a.amount)}</span>
                  <span className="flex-1 truncate">{r.a.description}</span>
                  {r.locked && <span className="text-emerald-600 text-[10px]">🔒</span>}
                </div>
              ) : (
                <span className="text-bridge-300">─</span>
              )}
            </div>

            {/* B side */}
            <div
              className={`px-3 py-1.5 cursor-pointer hover:bg-copper-400/10 ${
                pendingB === r.b?.id ? 'ring-2 ring-copper-400 ring-inset' : ''
              } ${r.b && isCandidateB(r.b) ? 'bg-emerald-100' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (r.b) handleBClick(r.b);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (r.a && r.b) unlinkPair(r.a.id, r.b.id);
              }}
            >
              {r.b ? (
                <div className="flex gap-2 tabular-nums">
                  <span className="text-bridge-400 w-20">{r.b.date || '—'}</span>
                  <span className="w-24 text-right">{fmtAmount(r.b.amount)}</span>
                  <span className="flex-1 truncate">{r.b.description}</span>
                </div>
              ) : (
                <span className="text-bridge-300">─</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Status bar */}
      <div className="px-4 py-2 border-t border-paper-200 bg-white text-xs text-bridge-600 flex gap-4">
        <span className="text-emerald-600">{counts.matched} confirmed</span>
        <span className="text-amber-600">{counts.ambiguous} ambiguous</span>
        <span className="text-bridge-500">{counts.unmatched} unmatched</span>
        {(pendingA || pendingB) && (
          <span className="ml-auto text-copper-700">
            Click a row on the {pendingA ? 'right' : 'left'} to confirm a match
            <button
              type="button"
              onClick={() => { setPendingA(null); setPendingB(null); }}
              className="ml-2 text-bridge-500 hover:text-bridge-700"
            >
              cancel
            </button>
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}
