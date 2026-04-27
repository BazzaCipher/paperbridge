import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Connection } from '@xyflow/react';
import { useCanvasStore } from '../../store/canvasStore';
import { validateConnection } from '../../core/engine/connectionValidation';
import { useToast } from '../ui/Toast';
import type { LynkNode } from '../../types';

interface SelectedHandle {
  nodeId: string;
  handleId: string | null;
  type: 'source' | 'target';
}

function getHandleInfo(target: EventTarget | null): SelectedHandle | null {
  if (!(target instanceof Element)) return null;
  const handleEl = target.closest('.react-flow__handle') as HTMLElement | null;
  if (!handleEl) return null;
  const nodeEl = handleEl.closest('.react-flow__node') as HTMLElement | null;
  const nodeId =
    handleEl.getAttribute('data-nodeid') ?? nodeEl?.getAttribute('data-id') ?? null;
  if (!nodeId) return null;
  const handleId = handleEl.getAttribute('data-handleid');
  const type: 'source' | 'target' | null = handleEl.classList.contains('source')
    ? 'source'
    : handleEl.classList.contains('target')
      ? 'target'
      : null;
  if (!type) return null;
  return { nodeId, handleId, type };
}

function sameHandle(a: SelectedHandle, b: SelectedHandle): boolean {
  return a.nodeId === b.nodeId && a.handleId === b.handleId && a.type === b.type;
}

export function MultiHandleSelect() {
  const [selected, setSelected] = useState<SelectedHandle[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const addEdge = useCanvasStore((s) => s.addEdge);
  const { showToast } = useToast();

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      setCursor({ x: e.clientX, y: e.clientY });
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) {
        if (selected.length > 0) setSelected([]);
        return;
      }

      const handle = getHandleInfo(e.target);

      if (e.shiftKey) {
        if (!handle) return;
        e.preventDefault();
        e.stopPropagation();
        setSelected((prev) => {
          const existing = prev.find((h) => sameHandle(h, handle));
          if (existing) return prev.filter((h) => !sameHandle(h, handle));
          return [...prev, handle];
        });
        setCursor({ x: e.clientX, y: e.clientY });
        return;
      }

      if (selected.length === 0) return;

      if (!handle) {
        setSelected([]);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const { nodes, edges } = useCanvasStore.getState();
      const lynkNodes = nodes as LynkNode[];
      let connected = 0;
      let skipped = 0;

      for (const sel of selected) {
        let conn: Connection | null = null;
        if (sel.type === 'source' && handle.type === 'target') {
          conn = {
            source: sel.nodeId,
            target: handle.nodeId,
            sourceHandle: sel.handleId,
            targetHandle: handle.handleId,
          };
        } else if (sel.type === 'target' && handle.type === 'source') {
          conn = {
            source: handle.nodeId,
            target: sel.nodeId,
            sourceHandle: handle.handleId,
            targetHandle: sel.handleId,
          };
        }
        if (!conn) {
          skipped++;
          continue;
        }
        const result = validateConnection(conn, { nodes: lynkNodes, edges });
        if (!result.valid) {
          skipped++;
          continue;
        }
        const ok = addEdge({
          id: `edge-${conn.source}-${conn.sourceHandle || 'default'}-${conn.target}-${conn.targetHandle || 'default'}`,
          source: conn.source!,
          target: conn.target!,
          sourceHandle: conn.sourceHandle,
          targetHandle: conn.targetHandle,
        });
        if (ok) connected++;
        else skipped++;
      }

      if (connected > 0) {
        showToast(
          skipped > 0
            ? `Created ${connected} connection(s), skipped ${skipped}`
            : `Created ${connected} connection(s)`,
          'success'
        );
      } else if (skipped > 0) {
        showToast('No valid connections from selection', 'warning');
      }

      setSelected([]);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected.length > 0) setSelected([]);
    };

    window.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }, [selected, addEdge, showToast]);

  if (selected.length === 0 || !cursor) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: cursor.x + 14,
        top: cursor.y + 14,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
      className="bg-copper-500 text-white text-xs px-2.5 py-1 rounded-full shadow-lg flex items-center gap-1.5"
    >
      <span className="inline-block w-2 h-2 rounded-full bg-white" />
      {selected.length} handle{selected.length !== 1 ? 's' : ''}
    </div>,
    document.body
  );
}
