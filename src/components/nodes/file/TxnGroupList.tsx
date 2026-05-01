import { useState } from 'react';
import { useCanvasStore } from '../../../store/canvasStore';
import type { TxnGroup } from '../../../core/sources/txnGroup';
import { EditableLabel } from '../base/EditableLabel';

interface TxnEditPatch {
  date?: string;
  description?: string;
  amount?: number;
  raw?: Record<string, string>;
}

interface TxnGroupListProps {
  groupIds: string[];
  onRename?: (groupId: string, label: string) => void;
  onDelete?: (groupId: string) => void;
  onTxnEdit?: (groupId: string, txnId: string, patch: TxnEditPatch) => void;
  onAddColumn?: (groupId: string) => void;
  onAutoFixColumns?: (groupId: string) => void;
}

function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toFixed(2)}`;
}

function CellInput({
  value,
  onCommit,
  className = '',
  align = 'left',
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  align?: 'left' | 'right';
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur(); }
      }}
      className={`bg-transparent border border-transparent hover:border-paper-200 focus:border-copper-400 focus:bg-white rounded px-1 outline-none w-full ${align === 'right' ? 'text-right' : ''} ${className}`}
    />
  );
}

function GroupBlock({
  group,
  onRename,
  onDelete,
  onTxnEdit,
  onAddColumn,
  onAutoFixColumns,
}: {
  group: TxnGroup;
  onRename?: (groupId: string, label: string) => void;
  onDelete?: (groupId: string) => void;
  onTxnEdit?: (groupId: string, txnId: string, patch: TxnEditPatch) => void;
  onAddColumn?: (groupId: string) => void;
  onAutoFixColumns?: (groupId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const headers = group.origin.sourceHeaders;
  const txns = group.transactions;

  return (
    <div className="border-b border-paper-200">
      <div className="px-2 py-1.5 bg-emerald-50/60 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="text-bridge-500 hover:text-bridge-700 flex-shrink-0"
          title={isOpen ? 'Collapse' : 'Expand'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-3.5 w-3.5 transition-transform ${isOpen ? '' : '-rotate-90'}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <div className="flex-1 min-w-0 flex">
          {onRename ? (
            <EditableLabel
              value={group.label}
              onSave={(v) => onRename(group.id, v)}
              variant="inline"
              className="text-emerald-800 font-medium block min-w-0"
            />
          ) : (
            <span className="text-xs font-medium text-emerald-800 truncate block">
              {group.label}
            </span>
          )}
        </div>
        <span className="text-[10px] text-bridge-400 flex-shrink-0">
          {txns.length} {txns.length === 1 ? 'row' : 'rows'}
        </span>
        {onAutoFixColumns && group.origin.kind === 'bank' && (
          <button
            type="button"
            onClick={() => onAutoFixColumns(group.id)}
            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 flex-shrink-0"
            title="Re-detect columns with AI vision"
          >
            Auto-fix
          </button>
        )}
        {onAddColumn && group.origin.kind === 'bank' && (
          <button
            type="button"
            onClick={() => onAddColumn(group.id)}
            className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 flex-shrink-0"
            title="Add a new column by selecting a strip on the document"
          >
            + Col
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(group.id)}
            className="text-bridge-400 hover:text-red-600 flex-shrink-0"
            title="Delete transaction group"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>

      {!isOpen ? null : txns.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-bridge-400 italic">
          No transactions
        </div>
      ) : headers && headers.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-paper-50 text-bridge-500">
                {headers.map((h) => (
                  <th key={h} className="px-2 py-1 text-left font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id} className="border-t border-paper-100">
                  {headers.map((h) => (
                    <td key={h} className="px-1 py-0.5 text-bridge-700 font-mono whitespace-nowrap">
                      {onTxnEdit ? (
                        <CellInput
                          value={t.raw?.[h] ?? ''}
                          onCommit={(v) => onTxnEdit(group.id, t.id, { raw: { [h]: v } })}
                        />
                      ) : (
                        t.raw?.[h] ?? ''
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="divide-y divide-paper-100">
          {txns.map((t) => (
            <div key={t.id} className="px-2 py-1 flex items-center gap-1 text-[11px]">
              <div className="font-mono w-20 flex-shrink-0 text-bridge-500">
                {onTxnEdit ? (
                  <CellInput
                    value={t.date || ''}
                    onCommit={(v) => onTxnEdit(group.id, t.id, { date: v })}
                  />
                ) : (
                  t.date || '—'
                )}
              </div>
              <div className="flex-1 text-bridge-700 min-w-0">
                {onTxnEdit ? (
                  <CellInput
                    value={t.description || ''}
                    onCommit={(v) => onTxnEdit(group.id, t.id, { description: v })}
                  />
                ) : (
                  <span className="truncate block">{t.description || '(no description)'}</span>
                )}
              </div>
              <div className={`font-mono w-20 flex-shrink-0 ${t.amount < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {onTxnEdit ? (
                  <CellInput
                    value={Number.isFinite(t.amount) ? t.amount.toFixed(2) : ''}
                    align="right"
                    onCommit={(v) => {
                      const n = parseFloat(v.replace(/[^0-9.\-]/g, ''));
                      onTxnEdit(group.id, t.id, { amount: Number.isFinite(n) ? n : 0 });
                    }}
                  />
                ) : (
                  <span className="block text-right">{formatAmount(t.amount)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TxnGroupList({ groupIds, onRename, onDelete, onTxnEdit, onAddColumn, onAutoFixColumns }: TxnGroupListProps) {
  const txnGroups = useCanvasStore((state) => state.txnGroups);
  const groups = groupIds
    .map((gid) => txnGroups[gid])
    .filter((g): g is TxnGroup => Boolean(g));

  if (groups.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-bridge-400 text-center">
        No transaction groups yet. Tag a field as amount, or run table extract.
      </div>
    );
  }

  return (
    <div>
      {groups.map((g) => (
        <GroupBlock
          key={g.id}
          group={g}
          onRename={onRename}
          onDelete={onDelete}
          onTxnEdit={onTxnEdit}
          onAddColumn={onAddColumn}
          onAutoFixColumns={onAutoFixColumns}
        />
      ))}
    </div>
  );
}
