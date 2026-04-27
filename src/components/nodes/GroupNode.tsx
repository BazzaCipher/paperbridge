import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Handle, Position, useEdges } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { GroupNode as GroupNodeType } from '../../types';
import { useCanvasStore } from '../../store/canvasStore';

const COLLAPSED_WIDTH = 220;
const COLLAPSED_HEIGHT = 60;

const labelStyles = {
  selected: 'bg-copper-400/20 text-copper-600 border border-copper-400',
  idle: 'bg-white text-bridge-500 border border-paper-200 hover:bg-paper-50 hover:text-bridge-700',
} as const;

function getCollapsedState(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem('lynk-group-collapsed');
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function setCollapsedState(groupId: string, collapsed: boolean) {
  try {
    const state = getCollapsedState();
    if (collapsed) {
      state[groupId] = true;
    } else {
      delete state[groupId];
    }
    localStorage.setItem('lynk-group-collapsed', JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function GroupNode({ id, data, selected }: NodeProps<GroupNodeType>) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const allEdges = useEdges();
  const collapsed = data.collapsed ?? false;

  // Derive dynamic handles for collapsed view from remapped edges
  const { outHandles, inHandles } = useMemo(() => {
    if (!collapsed) return { outHandles: [] as string[], inHandles: [] as string[] };
    return {
      outHandles: [...new Set(allEdges.filter(e => e.source === id && e.sourceHandle?.startsWith('group-out:')).map(e => e.sourceHandle!))],
      inHandles: [...new Set(allEdges.filter(e => e.target === id && e.targetHandle?.startsWith('group-in:')).map(e => e.targetHandle!))],
    };
  }, [collapsed, allEdges, id]);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.label);
  const inputRef = useRef<HTMLInputElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const lsState = getCollapsedState();
    const lsCollapsed = lsState[id] ?? false;
    if (lsCollapsed !== collapsed) {
      setCollapsedState(id, collapsed);
    }
  }, []);// eslint-disable-line react-hooks/exhaustive-deps

  const toggleCollapse = useCallback(() => {
    const next = !collapsed;
    updateNodeData(id, { collapsed: next });
    setCollapsedState(id, next);
  }, [id, collapsed, updateNodeData]);

  const startEditing = useCallback(() => {
    setEditValue(data.label);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [data.label]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== data.label) {
      updateNodeData(id, { label: trimmed });
    }
  }, [id, editValue, data.label, updateNodeData]);

  // Single click = toggle, double click = rename
  const handleNameClick = useCallback(() => {
    if (editing) return;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      startEditing();
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        toggleCollapse();
      }, 250);
    }
  }, [editing, startEditing, toggleCollapse]);

  const handleStyle = {
    background: '#9c8468',
    width: '15px',
    height: '15px',
  };

  // Collapsed view: matches BaseNode style
  if (collapsed) {
    return (
      <div
        className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-copper-500' : 'border-paper-200'}`}
        style={{ width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT }}
      >
        {/* Header matching BaseNode */}
        <div className="px-2 py-1.5 bg-paper-50 rounded-t-lg border-b border-paper-200">
          {editing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="text-sm font-semibold w-full bg-transparent outline-none border-b border-copper-400 text-bridge-700"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <h3
              className="text-sm font-semibold text-bridge-700 truncate cursor-pointer"
              onClick={handleNameClick}
              title="Click to expand, double-click to rename"
            >
              {data.label}
            </h3>
          )}
        </div>

        {/* Body with connection counts */}
        <div className="px-2 py-1 flex items-center justify-between">
          {inHandles.length > 0 && (
            <span className="text-[10px] text-bridge-400 tabular-nums">{inHandles.length} in</span>
          )}
          <span className="text-[10px] text-bridge-400 uppercase tracking-wider flex-1 text-center">Group</span>
          {outHandles.length > 0 && (
            <span className="text-[10px] text-bridge-400 tabular-nums">{outHandles.length} out</span>
          )}
        </div>

        {/* Hidden handles for edge rendering (invisible, stacked at center) */}
        {inHandles.map((h) => (
          <Handle
            key={h}
            type="target"
            position={Position.Left}
            id={h}
            style={{ ...handleStyle, left: -8, opacity: 0, pointerEvents: 'none' }}
          />
        ))}
        {outHandles.map((h) => (
          <Handle
            key={h}
            type="source"
            position={Position.Right}
            id={h}
            style={{ ...handleStyle, right: -8, opacity: 0, pointerEvents: 'none' }}
          />
        ))}
        {/* Single visible non-interactive handles */}
        <Handle
          type="target"
          position={Position.Left}
          id="group-in"
          style={{ ...handleStyle, left: -8 }}
          className="border-2 border-white !pointer-events-none"
          isConnectable={false}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="group-out"
          style={{ ...handleStyle, right: -8 }}
          className="border-2 border-white !pointer-events-none"
          isConnectable={false}
        />
      </div>
    );
  }

  // Expanded view: original dashed style
  return (
    <div
      className={`rounded-xl transition-colors border-2 border-dashed ${selected ? 'border-copper-400 bg-copper-400/20/60' : 'border-paper-200 bg-paper-50/30'}`}
      style={{
        width: data.width,
        height: data.height,
        backgroundColor: data.backgroundColor || undefined,
      }}
    >
      <div
        className={`absolute -top-6 left-2 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors select-none ${labelStyles[selected ? 'selected' : 'idle']}`}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="min-w-[60px] max-w-[200px] bg-transparent outline-none border-b border-current text-current"
            style={{ width: `${Math.max(60, editValue.length * 7)}px` }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            onClick={handleNameClick}
            title="Click to collapse, double-click to rename"
          >
            {data.label}
          </span>
        )}
      </div>
      {selected && (
        <>
          <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-paper-100/80 border-2 border-paper-300 rounded-tl-xl" />
          <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-paper-100/80 border-2 border-paper-300 rounded-tr-xl" />
          <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-paper-100/80 border-2 border-paper-300 rounded-bl-xl" />
          <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-paper-100/80 border-2 border-paper-300 rounded-br-xl" />
        </>
      )}
    </div>
  );
}
