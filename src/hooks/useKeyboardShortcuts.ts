/**
 * Keyboard Shortcuts Hook
 *
 * Encapsulates all keyboard shortcut logic for the canvas.
 * Handles Delete, Ctrl+S (save), Ctrl+Z (undo), Ctrl+Y (redo),
 * Ctrl+G (group), Ctrl+Shift+G (ungroup), and Escape (clear selection).
 */

import { useEffect } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useToast } from '../components/ui/Toast';
import type { LynkNode } from '../types';
import { GroupNode } from '../types';

export function useKeyboardShortcuts(): void {
  const getSelectedNodes = useCanvasStore((state) => state.getSelectedNodes);
  const getSelectedEdges = useCanvasStore((state) => state.getSelectedEdges);
  const removeSelectedNodes = useCanvasStore((state) => state.removeSelectedNodes);
  const removeSelectedEdges = useCanvasStore((state) => state.removeSelectedEdges);
  const clearSelection = useCanvasStore((state) => state.clearSelection);
  const saveToFile = useCanvasStore((state) => state.saveToFile);
  const createGroup = useCanvasStore((state) => state.createGroup);
  const ungroupNodes = useCanvasStore((state) => state.ungroupNodes);
  const pushHistory = useCanvasStore((state) => state.pushHistory);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const { showToast } = useToast();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if typing in an input field
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const isMod = event.ctrlKey || event.metaKey;

      // Escape - clear selection
      if (event.key === 'Escape') {
        event.preventDefault();
        clearSelection();
      }

      // Delete/Backspace - delete selected nodes and edges
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selectedNodes = getSelectedNodes();
        const selectedEdges = getSelectedEdges();

        if (selectedNodes.length > 0 || selectedEdges.length > 0) {
          event.preventDefault();
          pushHistory();

          if (selectedEdges.length > 0) {
            removeSelectedEdges();
          }
          if (selectedNodes.length > 0) {
            removeSelectedNodes();
          }

          const parts = [];
          if (selectedNodes.length > 0) {
            parts.push(`${selectedNodes.length} node(s)`);
          }
          if (selectedEdges.length > 0) {
            parts.push(`${selectedEdges.length} edge(s)`);
          }
          showToast(`Deleted ${parts.join(' and ')}`, 'info');
        }
      }

      // Ctrl/Cmd+S - save to file
      if (isMod && event.key === 's') {
        event.preventDefault();
        saveToFile().then((result) => {
          if (result.success) {
            showToast('Canvas saved', 'success');
          } else if (result.warnings && result.warnings.length > 0) {
            showToast(`Save failed: ${result.warnings[0]}`, 'error');
          }
        });
      }

      // Ctrl/Cmd+Z - undo
      if (isMod && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      }

      // Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z - redo
      if (isMod && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
      }

      // Ctrl/Cmd+G - group selected nodes
      if (isMod && event.key === 'g' && !event.shiftKey) {
        event.preventDefault();
        const selected = getSelectedNodes();
        if (selected.length >= 2) {
          pushHistory();
          const groupId = createGroup(selected.map((n) => n.id));
          if (groupId) {
            showToast('Nodes grouped', 'info');
          }
        } else {
          showToast('Select at least 2 nodes to group', 'warning');
        }
      }

      // Ctrl/Cmd+Shift+G - ungroup selected group
      if (isMod && event.key === 'G' && event.shiftKey) {
        event.preventDefault();
        const selected = getSelectedNodes();
        const groupNode = selected.find((n) => GroupNode.is(n as LynkNode));
        if (groupNode) {
          pushHistory();
          ungroupNodes(groupNode.id);
          showToast('Group dissolved', 'info');
        } else {
          showToast('Select a group to ungroup', 'warning');
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    getSelectedNodes,
    getSelectedEdges,
    removeSelectedNodes,
    removeSelectedEdges,
    clearSelection,
    saveToFile,
    createGroup,
    ungroupNodes,
    pushHistory,
    undo,
    redo,
    showToast,
  ]);
}
