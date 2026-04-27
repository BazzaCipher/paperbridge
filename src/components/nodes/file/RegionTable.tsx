import { useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useCanvasStore } from '../../../store/canvasStore';
import { Highlightable } from '../../../types/categories';
import type { ExtractedRegion, ExtractorColumn } from '../../../types';
import { formatValue } from '../../../utils/formatting';
import { generateId } from '../../../utils/id';

interface RegionTableProps {
  regions: ExtractedRegion[];
  columns: ExtractorColumn[];
  selectedRegionId: string | null;
  nodeId: string;
  onRegionSelect: (regionId: string) => void;
  onRegionDelete: (regionId: string) => void;
  onColumnsChange: (columns: ExtractorColumn[]) => void;
  onCellChange: (regionId: string, columnId: string, value: string) => void;
  onAddRow: () => void;
}

function getCellValue(region: ExtractedRegion, column: ExtractorColumn): string {
  if (column.id === 'label') return region.label;
  if (column.id === 'value') {
    const raw =
      region.extractedData.value !== ''
        ? String(region.extractedData.value)
        : region.selectionType === 'text' && region.textRange
          ? region.textRange.text
          : '';
    return raw ? formatValue(raw, region.dataType) : '';
  }
  return region.cells?.[column.id] ?? '';
}

export function RegionTable({
  regions,
  columns,
  selectedRegionId,
  nodeId,
  onRegionSelect,
  onRegionDelete,
  onColumnsChange,
  onCellChange,
  onAddRow,
}: RegionTableProps) {
  const highlightedHandle = useCanvasStore((s) => s.highlightedHandle);
  const isExternallyHighlighted = useCallback(
    (regionId: string): boolean => {
      if (!highlightedHandle) return false;
      return Highlightable.matches(highlightedHandle, nodeId, regionId);
    },
    [highlightedHandle, nodeId],
  );

  const addColumn = () => {
    const id = generateId('col');
    onColumnsChange([...columns, { id, label: 'Column', dataType: 'string' }]);
  };

  const renameColumn = (id: string, label: string) => {
    onColumnsChange(columns.map((c) => (c.id === id ? { ...c, label } : c)));
  };

  const deleteColumn = (id: string) => {
    if (id === 'label' || id === 'value') return;
    onColumnsChange(columns.filter((c) => c.id !== id));
  };

  return (
    <div className="border-t border-paper-100">
      {/* Header row */}
      <div className="flex items-stretch bg-paper-50 border-b border-paper-200 text-xs text-bridge-500">
        {columns.map((col) => (
          <div
            key={col.id}
            className="group flex-1 min-w-0 px-2 py-1.5 border-r border-paper-200 flex items-center gap-1"
          >
            <input
              type="text"
              value={col.label}
              onChange={(e) => renameColumn(col.id, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-transparent border-none outline-none focus:ring-0 p-0 text-xs font-medium text-bridge-700"
            />
            {col.id !== 'label' && col.id !== 'value' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteColumn(col.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-bridge-400 hover:text-red-500"
                title="Remove column"
              >
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addColumn}
          className="w-7 flex-shrink-0 py-1.5 text-copper-500 hover:bg-paper-100 text-xs font-medium"
          title="Add column"
        >
          +
        </button>
      </div>

      {/* Body rows */}
      {regions.length === 0 ? (
        <div className="px-3 py-3 text-xs text-bridge-400 text-center">No rows</div>
      ) : (
        <div className="max-h-[280px] overflow-y-auto pr-3">
          {regions.map((region) => {
            const selected = selectedRegionId === region.id;
            const external = isExternallyHighlighted(region.id);
            return (
              <div
                key={region.id}
                className={`group relative flex items-stretch min-h-8 border-b border-paper-100 hover:bg-paper-50 cursor-pointer ${
                  selected ? 'bg-copper-400/10' : ''
                } ${external ? 'bg-copper-400/20 ring-2 ring-copper-400' : ''}`}
              >
                <Handle
                  type="source"
                  position={Position.Right}
                  id={region.id}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    right: -8,
                    transform: 'translateY(-50%)',
                    background: region.color || '#9c8468',
                    width: 15,
                    height: 15,
                  }}
                  className="border-2 border-white"
                />
                {columns.map((col) => (
                  <div
                    key={col.id}
                    className="flex-1 min-w-0 px-2 py-1 border-r border-paper-100"
                    onClick={() => onRegionSelect(region.id)}
                  >
                    <input
                      type="text"
                      value={getCellValue(region, col)}
                      onChange={(e) => onCellChange(region.id, col.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-transparent border-none outline-none focus:ring-0 p-0 text-xs text-bridge-900"
                      placeholder="-"
                    />
                  </div>
                ))}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRegionDelete(region.id);
                  }}
                  className="w-7 flex-shrink-0 flex items-center justify-center text-bridge-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                  title="Delete row"
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: add row + count */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-paper-50 border-t border-paper-200">
        <button
          onClick={onAddRow}
          className="text-xs text-copper-500 hover:text-copper-700"
        >
          + Add Row
        </button>
        <span className="text-xs text-bridge-400">
          {regions.length} row{regions.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

