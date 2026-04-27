import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useCanvasStore } from '../../store/canvasStore';
import { getNodeTypes } from '../../core/nodes/nodeRegistry';
import { FileControls } from './Toolbar';
import { NodeCreationBar } from './NodeCreationBar';
import { UndoRedoControls } from './UndoRedoControls';
import { PanelToggle } from './PanelToggle';
import { ConnectionLine } from './ConnectionLine';
import { LayoutControls } from './LayoutControls';
import { FileRegistryPanel } from './FileRegistryPanel';
import { NodeContextMenu } from './NodeContextMenu';
import { CanvasContextMenu } from './CanvasContextMenu';
import { ProjectSidebar } from './ProjectSidebar';
import { EmptyState } from './EmptyState';
import { SuggestionBar } from './SuggestionBar';
import { useToast } from '../ui/Toast';
import { AiPromptPanel } from '../ai/AiPromptPanel';
import type { AiConnectionSuggestion, AiDetectedField } from '../../types/ai';
import type { ExtractorNodeData } from '../../types/nodes';
import { createRegionFromDetectedField } from '../../utils/regions';
import { validateConnection } from '../../core/engine/connectionValidation';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useMagneticConnect } from '../../hooks/useMagneticConnect';
import { useCanvasDrop } from '../../hooks/useCanvasDrop';
import type { LynkNode, DisplayNodeData, ViewportRegion } from '../../types';
import { useProjectSessions } from '../../hooks/useProjectSessions';
import { DisplayNode, GroupNode } from '../../types';

// Node types from registry (wrapped with error boundaries)
const nodeTypes = getNodeTypes();

interface CanvasMenuState {
  mode: 'create' | 'actions';
  x: number;
  y: number;
  flowPosition: XYPosition;
}

export function LynkCanvas() {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const onNodesChange = useCanvasStore((state) => state.onNodesChange);
  const storeOnEdgesChange = useCanvasStore((state) => state.onEdgesChange);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const storeAddEdge = useCanvasStore((state) => state.addEdge);
  const removeEdge = useCanvasStore((state) => state.removeEdge);
  const setViewport = useCanvasStore((state) => state.setViewport);
  const canvasId = useCanvasStore((state) => state.canvasId);

  const fileRegistryOpen = useCanvasStore((state) => state.fileRegistryOpen);
  const toggleFileRegistry = useCanvasStore((state) => state.toggleFileRegistry);
  const focusedGroupId = useCanvasStore((state) => state.focusedGroupId);
  const setFocusedGroup = useCanvasStore((state) => state.setFocusedGroup);
  const { showToast } = useToast();
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();

  // Keyboard shortcuts (Delete, Ctrl+S, Ctrl+Z, Ctrl+G, etc.)
  useKeyboardShortcuts();

  // Lock children of unselected groups from being dragged, and hide children of collapsed groups
  // Build collapsed group mappings: child ID → group ID
  const { collapsedChildToGroup, collapsedGroups } = useMemo(() => {
    const cGroups = new Set(
      nodes.filter((n) => GroupNode.is(n as LynkNode) && (n as LynkNode).data?.collapsed).map((n) => n.id)
    );
    const childMap = new Map<string, string>();
    for (const n of nodes) {
      if (n.parentId && cGroups.has(n.parentId)) {
        childMap.set(n.id, n.parentId);
      }
    }
    return { collapsedChildToGroup: childMap, collapsedGroups: cGroups };
  }, [nodes]);

  // Hide collapsed children, resize collapsed groups
  const processedNodes = useMemo(() => {
    return nodes
      .filter((node) => !collapsedChildToGroup.has(node.id))
      .map((node) => {
        // Collapsed group: override dimensions
        if (collapsedGroups.has(node.id)) {
          return { ...node, style: { ...node.style, width: 220, height: 60 } };
        }
        return node;
      });
  }, [nodes, collapsedChildToGroup, collapsedGroups]);

  // Remap edges: edges to/from collapsed children → point to the group node's handles
  const processedEdges = useMemo(() => {
    if (collapsedChildToGroup.size === 0) return edges;
    const seen = new Set<string>();
    return edges
      .map((edge) => {
        const sourceInGroup = collapsedChildToGroup.get(edge.source);
        const targetInGroup = collapsedChildToGroup.get(edge.target);
        // Skip internal edges (both source and target in same collapsed group)
        if (sourceInGroup && targetInGroup && sourceInGroup === targetInGroup) return null;
        const newEdge = { ...edge };
        if (sourceInGroup) {
          newEdge.source = sourceInGroup;
          newEdge.sourceHandle = `group-out:${edge.source}:${edge.sourceHandle}`;
        }
        if (targetInGroup) {
          newEdge.target = targetInGroup;
          newEdge.targetHandle = `group-in:${edge.target}:${edge.targetHandle}`;
        }
        // Deduplicate remapped edges
        const key = `${newEdge.source}:${newEdge.sourceHandle}-${newEdge.target}:${newEdge.targetHandle}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return { ...newEdge, id: `remapped-${key}` };
      })
      .filter((e): e is Edge => e !== null);
  }, [edges, collapsedChildToGroup]);

  // Focus mode: compute which node IDs stay bright. Rule = focused group + its
  // children + 1-hop edge neighbours, so a MatchNode (or extractor) wired into
  // the focused group stays visible even if it sits outside the group.
  const dimmedNodeIds = useMemo(() => {
    if (!focusedGroupId) return null;
    const focused = new Set<string>([focusedGroupId]);
    for (const n of nodes) {
      if (n.parentId === focusedGroupId) focused.add(n.id);
    }
    const visible = new Set(focused);
    for (const e of edges) {
      if (focused.has(e.source) && !focused.has(e.target)) visible.add(e.target);
      else if (focused.has(e.target) && !focused.has(e.source)) visible.add(e.source);
    }
    const dimmed = new Set<string>();
    for (const n of nodes) {
      if (!visible.has(n.id)) dimmed.add(n.id);
    }
    return { dimmed, visible };
  }, [focusedGroupId, nodes, edges]);

  const focusedGroupLabel = useMemo(() => {
    if (!focusedGroupId) return null;
    const g = nodes.find((n) => n.id === focusedGroupId);
    return g?.data && typeof (g.data as { label?: unknown }).label === 'string'
      ? (g.data as { label: string }).label
      : 'Group';
  }, [focusedGroupId, nodes]);

  // Mirror child outputs onto collapsed group nodes so downstream resolveNodeOutput works
  const groupOutputsRef = useRef<string>('');
  useEffect(() => {
    if (collapsedGroups.size === 0) {
      groupOutputsRef.current = '';
      return;
    }
    const updates: Array<{ groupId: string; outputs: Record<string, unknown> }> = [];
    for (const groupId of collapsedGroups) {
      const childNodes = nodes.filter((n) => n.parentId === groupId);
      const mergedOutputs: Record<string, unknown> = {};
      for (const child of childNodes) {
        const childOutputs = (child.data as { outputs?: Record<string, unknown> }).outputs;
        if (childOutputs) {
          for (const [handle, value] of Object.entries(childOutputs)) {
            mergedOutputs[`group-out:${child.id}:${handle}`] = value;
          }
        }
      }
      updates.push({ groupId, outputs: mergedOutputs });
    }
    const serialized = JSON.stringify(updates);
    if (serialized !== groupOutputsRef.current) {
      groupOutputsRef.current = serialized;
      for (const { groupId, outputs } of updates) {
        updateNodeData(groupId, { outputs });
      }
    }
  }, [nodes, collapsedGroups, updateNodeData]);

  const { magneticMode, snapTarget, toggleMagneticMode, onNodeDrag, onNodeDragStop } = useMagneticConnect();

  // Group-first selection: clicking a child of an unselected group selects the group first,
  // but still allows dragging (the drag moves the group when it's not selected)
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (!node.parentId) return;
    const parent = nodes.find((n) => n.id === node.parentId);
    if (!parent || parent.type !== 'group' || parent.selected) return;
    // Group isn't selected — select both the group and the child
    onNodesChange([
      { type: 'select', id: parent.id, selected: true },
    ]);
  }, [nodes, onNodesChange]);

  // Node context menu (right-click on node)
  const [contextMenu, setContextMenu] = useState<{ node: LynkNode; x: number; y: number } | null>(null);

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ node: node as LynkNode, x: event.clientX, y: event.clientY });
  }, []);

  // Canvas context menu (double-click = create, right-click = actions)
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState | null>(null);

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.react-flow__node')) return;

      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setCanvasMenu({
        mode: 'create',
        x: event.clientX,
        y: event.clientY,
        flowPosition,
      });
    },
    [screenToFlowPosition]
  );

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setCanvasMenu({
        mode: 'actions',
        x: event.clientX,
        y: event.clientY,
        flowPosition,
      });
    },
    [screenToFlowPosition]
  );

  // Double-click on edge: navigate to the closer node (source or target)
  const handleEdgeDoubleClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      const sourceNode = getNodes().find((n) => n.id === edge.source);
      const targetNode = getNodes().find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode) return;

      const clickPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      // Calculate center of each node
      const sourceCenter = {
        x: sourceNode.position.x + (sourceNode.measured?.width ?? 200) / 2,
        y: sourceNode.position.y + (sourceNode.measured?.height ?? 100) / 2,
      };
      const targetCenter = {
        x: targetNode.position.x + (targetNode.measured?.width ?? 200) / 2,
        y: targetNode.position.y + (targetNode.measured?.height ?? 100) / 2,
      };

      const distToSource = Math.hypot(clickPos.x - sourceCenter.x, clickPos.y - sourceCenter.y);
      const distToTarget = Math.hypot(clickPos.x - targetCenter.x, clickPos.y - targetCenter.y);

      const closerNodeId = distToSource <= distToTarget ? edge.source : edge.target;
      fitView({ nodes: [{ id: closerNodeId }], duration: 300, padding: 0.5 });
    },
    [screenToFlowPosition, fitView, getNodes]
  );

  // Right-click on a selected edge: flash red then delete
  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (!edge.selected) return;
      event.preventDefault();

      // Flash edge red before deleting
      const edgeEl = document.querySelector(`[data-testid="rf__edge-${edge.id}"]`)
        ?? document.querySelector(`.react-flow__edge[data-id="${edge.id}"]`);
      if (edgeEl) {
        const path = edgeEl.querySelector('path');
        if (path) {
          path.style.stroke = '#ef4444';
          path.style.strokeWidth = '3';
          path.style.filter = 'drop-shadow(0 0 4px rgba(239, 68, 68, 0.5))';
        }
      }

      setTimeout(() => removeEdge(edge.id), 150);
    },
    [removeEdge]
  );

  // Wrap onEdgesChange to clean up viewport regions when edges are deleted
  const onEdgesChange = useCallback(
    (changes: import('@xyflow/react').EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          const edge = edges.find((e) => e.id === change.id);
          if (!edge) continue;

          const sourceNode = nodes.find((n) => n.id === edge.source);
          if (sourceNode && DisplayNode.is(sourceNode as LynkNode)) {
            const displayData = sourceNode.data as DisplayNodeData;
            const sourceHandle = edge.sourceHandle;
            if (sourceHandle && displayData.viewports?.some((v: ViewportRegion) => v.id === sourceHandle)) {
              updateNodeData(sourceNode.id, {
                viewports: displayData.viewports.filter((v: ViewportRegion) => v.id !== sourceHandle),
              });
            }
          }
        }
      }
      storeOnEdgesChange(changes);
    },
    [edges, nodes, storeOnEdgesChange, updateNodeData]
  );

  const isValidConnection = useCallback(
    (connection: Edge | Connection): boolean => {
      return validateConnection(connection, { nodes: nodes as LynkNode[], edges }).valid;
    },
    [edges, nodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const result = validateConnection(connection, { nodes: nodes as LynkNode[], edges });
      if (!result.valid) {
        if (result.reason) showToast(result.reason, 'warning');
        return;
      }

      const edge = {
        id: `edge-${connection.source}-${connection.sourceHandle || 'default'}-${connection.target}-${connection.targetHandle || 'default'}`,
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      };
      storeAddEdge(edge);
    },
    [edges, nodes, storeAddEdge, showToast]
  );

  const handleFieldsDetected = useCallback(
    (fields: AiDetectedField[]) => {
      const { nodes: currentNodes, updateNodeData, pushHistory } = useCanvasStore.getState();
      const extractorNodes = currentNodes.filter((n) => n.type === 'extractor');
      if (extractorNodes.length === 0 || fields.length === 0) return;

      pushHistory();

      for (const extractorNode of extractorNodes) {
        const data = extractorNode.data as ExtractorNodeData;
        const newRegions = fields
          .filter((f) => f.bbox)
          .map((f, i) => createRegionFromDetectedField(f, 1, data.regions.length + i));
        if (newRegions.length > 0) {
          updateNodeData(extractorNode.id, { regions: [...data.regions, ...newRegions] });
        }
      }
      const count = fields.filter((f) => f.bbox).length;
      if (count > 0) showToast(`Applied ${count} detected field(s)`, 'success');
    },
    [showToast]
  );

  const handleConnectionsSuggested = useCallback(
    (suggestions: AiConnectionSuggestion[]) => {
      const { pushHistory } = useCanvasStore.getState();
      const hasValid = suggestions.some((s) =>
        nodes.find((n) => n.id === s.sourceNodeId) && nodes.find((n) => n.id === s.targetNodeId)
      );
      if (hasValid) pushHistory();

      let connected = 0;
      for (const s of suggestions) {
        const sourceNode = nodes.find((n) => n.id === s.sourceNodeId);
        const targetNode = nodes.find((n) => n.id === s.targetNodeId);
        if (!sourceNode || !targetNode) continue;

        // Resolve source handle: try ID match, then label match
        let resolvedSourceHandle = s.sourceFieldId;
        if (sourceNode.type === 'extractor') {
          const data = sourceNode.data as ExtractorNodeData;
          const direct = data.regions.find((r) => r.id === s.sourceFieldId);
          if (!direct) {
            const byLabel = data.regions.find(
              (r) => r.label.toLowerCase() === s.sourceFieldId.toLowerCase()
            ) ?? data.regions.find(
              (r) =>
                r.label.toLowerCase().includes(s.sourceFieldId.toLowerCase()) ||
                s.sourceFieldId.toLowerCase().includes(r.label.toLowerCase())
            );
            if (!byLabel) continue; // Can't resolve — skip
            resolvedSourceHandle = byLabel.id;
          }
        }

        // Resolve target handle: normalize common LLM patterns
        let resolvedTargetHandle = s.targetHandle;
        if (targetNode.type === 'calculation') {
          // Calculation nodes use 'inputs' handle, not 'input-0' etc.
          resolvedTargetHandle = 'inputs';
        } else if (targetNode.type === 'label') {
          resolvedTargetHandle = 'input';
        }

        const edge = {
          id: `edge-${s.sourceNodeId}-${resolvedSourceHandle}-${s.targetNodeId}-${resolvedTargetHandle}`,
          source: s.sourceNodeId,
          target: s.targetNodeId,
          sourceHandle: resolvedSourceHandle,
          targetHandle: resolvedTargetHandle,
        };
        if (storeAddEdge(edge)) connected++;
      }
      if (connected > 0) {
        showToast(`Auto-connected ${connected} field(s)`, 'success');
      }
    },
    [nodes, storeAddEdge, showToast]
  );

  const { handleCanvasDragOver, handleCanvasDrop, handleCanvasPaste } = useCanvasDrop();

  // Long-press to open create menu on mobile (500ms hold on empty canvas)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const target = e.target as HTMLElement;
      if (target.closest('.react-flow__node') || target.closest('.react-flow__controls')) return;

      longPressPosRef.current = { x: touch.clientX, y: touch.clientY };
      longPressTimerRef.current = setTimeout(() => {
        if (longPressPosRef.current) {
          const { x, y } = longPressPosRef.current;
          const flowPosition = screenToFlowPosition({ x, y });
          setCanvasMenu({ mode: 'create', x, y, flowPosition });
        }
      }, 500);
    },
    [screenToFlowPosition]
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch || !longPressPosRef.current) return;
    const dx = touch.clientX - longPressPosRef.current.x;
    const dy = touch.clientY - longPressPosRef.current.y;
    // Cancel long-press if finger moved more than 10px
    if (Math.hypot(dx, dy) > 10) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressPosRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressPosRef.current = null;
  }, []);

  // Drag overlay state
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    dragCounterRef.current = 0;
    setIsDragOver(false);
    handleCanvasDrop(e);
  }, [handleCanvasDrop]);

  // Clipboard paste listener
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Don't intercept paste in input/textarea elements
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      handleCanvasPaste(e);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [handleCanvasPaste]);

  // Project session management
  const {
    projects,
    sidebarOpen, setSidebarOpen,
    focusNameInput, clearFocusName,
    switchProject: handleSwitchProject,
    deleteProject: handleDeleteProject,
    cloneProject: handleCloneProject,
    createProject: handleCreateProject,
    handleLoad,
  } = useProjectSessions();

  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div className="w-full h-full flex flex-col">
    <div className="flex flex-1 min-h-0">
      <ProjectSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        projects={projects}
        activeProjectId={canvasId}
        onSwitchProject={handleSwitchProject}
        onDeleteProject={handleDeleteProject}
        onCloneProject={handleCloneProject}
        onCreateProject={handleCreateProject}
        onLoad={handleLoad}
      />
      <div
        className="flex-1 h-full relative"
        onDragOver={handleCanvasDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Top center: File controls + Undo/Redo */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 max-w-[calc(100vw-6rem)]">
          <div className="flex items-center gap-2">
            <FileControls
              focusName={focusNameInput}
              onFocusNameHandled={clearFocusName}
            />
            <UndoRedoControls />
          </div>
          {nodes.length > 0 && <SuggestionBar />}
        </div>

        {/* Left: Projects panel toggle */}
        <PanelToggle
          side="left"
          isOpen={sidebarOpen}
          onClick={() => setSidebarOpen((v) => !v)}
          label="Projects"
        />

        {/* Right: Files panel toggle */}
        <PanelToggle
          side="right"
          isOpen={fileRegistryOpen}
          onClick={toggleFileRegistry}
          label="Files"
        />

        {/* Bottom center: Node creation */}
        <NodeCreationBar />

        {focusedGroupId && (
          <button
            onClick={() => setFocusedGroup(null)}
            className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-copper-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg hover:bg-copper-600 transition-colors flex items-center gap-2"
            title="Exit focus mode"
          >
            <span>Focusing &ldquo;{focusedGroupLabel}&rdquo;</span>
            <span className="opacity-70">Esc to exit</span>
          </button>
        )}
        {nodes.length === 0 && <EmptyState />}
        {magneticMode && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none
                          bg-copper-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg
                          flex items-center gap-2 select-none">
            Magnetic connect {snapTarget ? '- snap ready' : '- drag near a handle'} · press M to disable
          </div>
        )}
        <ReactFlow
          nodes={dimmedNodeIds ? processedNodes.map((n) => dimmedNodeIds.dimmed.has(n.id) ? { ...n, className: `${n.className ?? ''} lynk-dimmed`.trim() } : n) : processedNodes}
          edges={dimmedNodeIds ? processedEdges.map((e) => dimmedNodeIds.dimmed.has(e.source) && dimmedNodeIds.dimmed.has(e.target) ? { ...e, className: `${e.className ?? ''} lynk-dimmed`.trim() } : e) : processedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          zoomOnDoubleClick={false}
          onViewportChange={setViewport}
          onNodeClick={handleNodeClick}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodeContextMenu={handleNodeContextMenu}
          onPaneContextMenu={handlePaneContextMenu}
          onEdgeDoubleClick={handleEdgeDoubleClick}
          onEdgeContextMenu={handleEdgeContextMenu}
          nodeTypes={nodeTypes}
          isValidConnection={isValidConnection}
          connectionLineComponent={ConnectionLine}
          fitView
          snapToGrid
          snapGrid={[16, 16]}
          edgesReconnectable
          edgesFocusable
          panOnScroll={true}
          zoomOnScroll={false}
          zoomOnPinch={true}
          zoomActivationKeyCode={['Control', 'Meta']}
          preventScrolling={true}
          minZoom={0.1}
          maxZoom={4}
        >
          <Background gap={16} size={1} />
          <Controls />
          <LayoutControls />
        </ReactFlow>
        {isDragOver && (
          <div className="absolute inset-0 z-50 bg-copper-500/10 border-2 border-dashed border-copper-400 flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 rounded-lg px-6 py-4 shadow-lg text-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto mb-2 text-copper-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="text-sm font-medium text-copper-600">Drop files or folders here</p>
              <p className="text-xs text-bridge-500 mt-1">PDF and image files will be processed</p>
            </div>
          </div>
        )}
        {contextMenu && (
          <NodeContextMenu
            node={contextMenu.node}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onClose={() => setContextMenu(null)}
            magneticMode={magneticMode}
            onToggleMagneticMode={toggleMagneticMode}
          />
        )}
        {canvasMenu && (
          <CanvasContextMenu
            mode={canvasMenu.mode}
            position={{ x: canvasMenu.x, y: canvasMenu.y }}
            flowPosition={canvasMenu.flowPosition}
            onClose={() => setCanvasMenu(null)}
            onLoad={handleLoad}
          />
        )}
      </div>
      <FileRegistryPanel />
    </div>

    {/* AI Assistant: bottom strip on mobile, floating portal on desktop */}
    {isMobile ? (
      <div className="shrink-0 border-t border-paper-200 bg-white">
        <button
          onClick={() => setAiPanelOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs text-bridge-500 hover:text-copper-500 hover:bg-paper-50 transition-colors"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-copper-500" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" />
            </svg>
            AI Assistant
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-3.5 w-3.5 transition-transform ${aiPanelOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        {aiPanelOpen && (
          <AiPromptPanel
            context="canvas"
            onFieldsDetected={handleFieldsDetected}
            onConnectionsSuggested={handleConnectionsSuggested}
            docked
          />
        )}
      </div>
    ) : createPortal(
      <div className="fixed bottom-4 right-4 z-[60]">
        <AiPromptPanel context="canvas" onFieldsDetected={handleFieldsDetected} onConnectionsSuggested={handleConnectionsSuggested} />
      </div>,
      document.body
    )}
    </div>
  );
}
