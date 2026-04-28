import { useState, useMemo, useEffect, useCallback } from 'react';
import { Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './base/BaseNode';
import { TxnGroupHandle } from './base/TxnGroupHandle';
import { EditableLabel } from './base/EditableLabel';
import { useCanvasStore } from '../../store/canvasStore';
import type { MatchNode as MatchNodeType } from '../../types';
import type { TxnGroup } from '../../core/sources/txnGroup';
import { reconcile } from '../../core/reconciliation/reconcile';
import { txnGroupHandle } from '../../core/handles/txnGroup';
import { ReconciliationStudio } from './match/ReconciliationStudio';

/** Resolve the TxnGroup connected to a target handle by walking edges back to a source. */
function resolveTxnGroup(
  edges: ReturnType<typeof useCanvasStore.getState>['edges'],
  selfId: string,
  slotName: string,
  getTxnGroup: (id: string) => TxnGroup | undefined,
): TxnGroup | null {
  const targetHandle = txnGroupHandle.make(slotName);
  const edge = edges.find((e) => e.target === selfId && e.targetHandle === targetHandle);
  if (!edge?.sourceHandle) return null;
  const id = txnGroupHandle.parse(edge.sourceHandle);
  if (!id) return null;
  return getTxnGroup(id) ?? null;
}

export function MatchNode({ id, data, selected }: NodeProps<MatchNodeType>) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const edges = useCanvasStore((s) => s.edges);
  const getTxnGroup = useCanvasStore((s) => s.getTxnGroup);

  const [studioOpen, setStudioOpen] = useState(false);

  const groupA = useMemo(
    () => resolveTxnGroup(edges, id, 'source-a', getTxnGroup),
    [edges, id, getTxnGroup],
  );
  const groupB = useMemo(
    () => resolveTxnGroup(edges, id, 'source-b', getTxnGroup),
    [edges, id, getTxnGroup],
  );

  // Run reconcile, honouring locks and rejections from MatchNodeData.
  const result = useMemo(() => {
    if (!groupA || !groupB) return null;
    return reconcile(groupA, groupB, {
      amountTolerance: data.amountTolerance,
      dateWindowDays: data.dateWindowDays,
      locks: data.manualOverrides,
      rejections: data.rejections,
    });
  }, [groupA, groupB, data.amountTolerance, data.dateWindowDays, data.manualOverrides, data.rejections]);

  // Persist derived pairs/unmatched onto MatchNodeData for downstream consumers.
  useEffect(() => {
    if (!result) return;
    const pairs = result.matched.map((m) => ({ aId: m.a.id, bId: m.b.id, score: m.score }));
    const unmatchedA = result.onlyInA.map((t) => t.id);
    const unmatchedB = result.onlyInB.map((t) => t.id);
    const same =
      data.pairs.length === pairs.length &&
      data.unmatchedA.length === unmatchedA.length &&
      data.unmatchedB.length === unmatchedB.length &&
      pairs.every((p, i) => data.pairs[i]?.aId === p.aId && data.pairs[i]?.bId === p.bId);
    if (same) return;
    updateNodeData(id, { pairs, unmatchedA, unmatchedB });
  }, [result, data.pairs, data.unmatchedA, data.unmatchedB, id, updateNodeData]);

  const counts = useMemo(() => {
    const matched = result?.matched.length ?? 0;
    const total = matched + (result?.onlyInA.length ?? 0) + (result?.onlyInB.length ?? 0);
    return { matched, total };
  }, [result]);

  const onCommit = useCallback(
    (next: {
      manualOverrides?: Array<{ aId: string; bId: string }>;
      rejections?: Array<{ aId: string; bId: string }>;
      amountTolerance?: number;
      dateWindowDays?: number;
    }) => {
      updateNodeData(id, next);
    },
    [id, updateNodeData],
  );

  // Derive matched / unmatched-a / unmatched-b TxnGroups for downstream handles.
  // These live in-memory only; not added to the slice (MatchNode pairs change often).
  // For Step 5 we expose the handles; Studio (Step 6) will surface the data.
  const hasInputs = !!(groupA && groupB);

  return (
    <BaseNode
      label={data.label}
      selected={selected}
      renderHeader={
        <EditableLabel
          value={data.label}
          onSave={(v) => updateNodeData(id, { label: v })}
          variant="header"
        />
      }
    >
      <div className="relative">
        {/* Top input: source A */}
        <TxnGroupHandle name="source-a" handleType="target" handlePosition={Position.Top}>
          <div className="text-xs text-bridge-500 truncate flex-1">
            {groupA ? `A: ${groupA.label} (${groupA.transactions.length})` : <span className="text-bridge-400">Connect TxnGroup A on top</span>}
          </div>
        </TxnGroupHandle>

        {/* Body: count chip + Open button */}
        <div className="px-2 py-1.5 flex flex-col gap-1">
          {hasInputs ? (
            <div className="text-[11px] text-bridge-600 tabular-nums">
              {counts.matched} / {counts.total} matched
            </div>
          ) : (
            <div className="text-[11px] text-bridge-400 italic">No data to reconcile</div>
          )}
          <button
            type="button"
            className="px-2 py-1 text-xs bg-copper-400/10 hover:bg-copper-400/20 text-copper-700 rounded border border-copper-400/30 transition-colors disabled:opacity-50"
            onClick={(e) => { e.stopPropagation(); setStudioOpen(true); }}
            disabled={!hasInputs}
          >
            Open
          </button>
        </div>

        {/* Outputs */}
        <TxnGroupHandle name="matched" handleType="source" handlePosition={Position.Right}>
          <div className="text-[10px] text-bridge-400 flex-1 text-right pr-2">matched</div>
        </TxnGroupHandle>
        <TxnGroupHandle name="unmatched-a" handleType="source" handlePosition={Position.Right}>
          <div className="text-[10px] text-bridge-400 flex-1 text-right pr-2">unmatched A</div>
        </TxnGroupHandle>
        <TxnGroupHandle name="unmatched-b" handleType="source" handlePosition={Position.Right}>
          <div className="text-[10px] text-bridge-400 flex-1 text-right pr-2">unmatched B</div>
        </TxnGroupHandle>

        {/* Bottom input: source B */}
        <TxnGroupHandle name="source-b" handleType="target" handlePosition={Position.Bottom}>
          <div className="text-xs text-bridge-500 truncate flex-1">
            {groupB ? `B: ${groupB.label} (${groupB.transactions.length})` : <span className="text-bridge-400">Connect TxnGroup B on bottom</span>}
          </div>
        </TxnGroupHandle>
      </div>

      {studioOpen && groupA && groupB && result && (
        <ReconciliationStudio
          onClose={() => setStudioOpen(false)}
          groupA={groupA}
          groupB={groupB}
          result={result}
          amountTolerance={data.amountTolerance}
          dateWindowDays={data.dateWindowDays}
          manualOverrides={data.manualOverrides}
          rejections={data.rejections}
          onCommit={onCommit}
        />
      )}
    </BaseNode>
  );
}
