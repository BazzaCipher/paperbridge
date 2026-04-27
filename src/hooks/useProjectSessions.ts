import { useState, useCallback, useRef } from 'react';
import type { Edge } from '@xyflow/react';
import type { Viewport } from '@xyflow/react';
import { useCanvasStore } from '../store/canvasStore';
import { useToast } from '../components/ui/Toast';
import { generateId } from '../utils/id';
import type { LynkNode } from '../types';
import type { SessionProject } from '../components/canvas/ProjectSidebar';

interface ProjectSnapshot {
  nodes: LynkNode[];
  edges: Edge[];
  viewport: Viewport;
  canvasName: string;
  canvasId: string;
  lastSaved: string | null;
}

function captureSnapshot(): ProjectSnapshot {
  const state = useCanvasStore.getState();
  return {
    nodes: state.nodes,
    edges: state.edges,
    viewport: state.viewport,
    canvasName: state.canvasName,
    canvasId: state.canvasId,
    lastSaved: state.lastSaved,
  };
}

export function useProjectSessions() {
  const canvasId = useCanvasStore((state) => state.canvasId);
  const canvasName = useCanvasStore((state) => state.canvasName);
  const nodes = useCanvasStore((state) => state.nodes);
  const loadFromFile = useCanvasStore((state) => state.loadFromFile);
  const { showToast } = useToast();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [focusNameInput, setFocusNameInput] = useState(false);

  const [projects, setProjects] = useState<SessionProject[]>(() => [{
    id: canvasId,
    name: canvasName,
    lastModified: Date.now(),
    nodeCount: nodes.length,
  }]);
  const snapshotsRef = useRef<Map<string, ProjectSnapshot>>(new Map());

  // Keep current project metadata in sync
  const activeProject = projects.find((p) => p.id === canvasId);
  if (activeProject && (activeProject.name !== canvasName || activeProject.nodeCount !== nodes.length)) {
    activeProject.name = canvasName;
    activeProject.nodeCount = nodes.length;
    activeProject.lastModified = Date.now();
  }

  const switchProject = useCallback((targetId: string) => {
    snapshotsRef.current.set(useCanvasStore.getState().canvasId, captureSnapshot());

    const snapshot = snapshotsRef.current.get(targetId);
    if (snapshot) {
      useCanvasStore.setState({
        ...snapshot,
        highlightedHandle: null,
      });
    }
  }, []);

  const deleteProject = useCallback((targetId: string) => {
    const state = useCanvasStore.getState();

    if (targetId === state.canvasId) {
      setProjects((prev) => {
        const remaining = prev.filter((p) => p.id !== targetId);
        if (remaining.length > 0) {
          setTimeout(() => switchProject(remaining[0].id), 0);
        }
        return remaining;
      });
    } else {
      setProjects((prev) => prev.filter((p) => p.id !== targetId));
    }

    snapshotsRef.current.delete(targetId);
  }, [switchProject]);

  const cloneProject = useCallback((targetId: string) => {
    const state = useCanvasStore.getState();
    const newId = generateId('canvas');

    let sourceSnapshot: ProjectSnapshot;
    if (targetId === state.canvasId) {
      sourceSnapshot = { ...captureSnapshot(), canvasId: newId, lastSaved: null };
    } else {
      const snap = snapshotsRef.current.get(targetId);
      if (!snap) return;
      sourceSnapshot = { ...snap, canvasId: newId, lastSaved: null };
    }

    const sourceName = targetId === state.canvasId
      ? state.canvasName
      : projects.find((p) => p.id === targetId)?.name || 'Untitled';

    snapshotsRef.current.set(newId, sourceSnapshot);

    setProjects((prev) => [...prev, {
      id: newId,
      name: `${sourceName} (copy)`,
      lastModified: Date.now(),
      nodeCount: sourceSnapshot.nodes.length,
    }]);
  }, [projects]);

  const createProject = useCallback(() => {
    const newId = generateId('canvas');

    snapshotsRef.current.set(useCanvasStore.getState().canvasId, captureSnapshot());

    useCanvasStore.setState({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      canvasName: 'Untitled Canvas',
      canvasId: newId,
      lastSaved: null,
      highlightedHandle: null,
    });

    setProjects((prev) => [...prev, {
      id: newId,
      name: 'Untitled Canvas',
      lastModified: Date.now(),
      nodeCount: 0,
    }]);

    setFocusNameInput(true);
  }, []);

  const handleLoad = useCallback(async () => {
    const state = useCanvasStore.getState();
    snapshotsRef.current.set(state.canvasId, captureSnapshot());

    const result = await loadFromFile();
    if (!result.success) {
      const snapshot = snapshotsRef.current.get(state.canvasId);
      if (snapshot) {
        useCanvasStore.setState(snapshot);
      }
      if (result.error) {
        const errorMsg = result.error.startsWith('Invalid canvas file:')
          ? 'Invalid canvas file. The file may be corrupted or in an incompatible format.'
          : result.error;
        showToast(errorMsg, 'error');
      }
      return;
    }

    showToast('Canvas loaded successfully', 'success');
  }, [loadFromFile, showToast]);

  // Track canvasId changes to register new projects
  const lastKnownIdRef = useRef(canvasId);
  if (canvasId !== lastKnownIdRef.current) {
    const prevId = lastKnownIdRef.current;
    lastKnownIdRef.current = canvasId;

    if (!projects.some((p) => p.id === canvasId)) {
      const prevProject = projects.find((p) => p.id === prevId);
      if (prevProject && prevProject.nodeCount === 0 && !snapshotsRef.current.has(prevId)) {
        setProjects((prev) => prev.map((p) =>
          p.id === prevId
            ? { id: canvasId, name: canvasName, lastModified: Date.now(), nodeCount: nodes.length }
            : p
        ));
      } else {
        setProjects((prev) => [...prev, {
          id: canvasId,
          name: canvasName,
          lastModified: Date.now(),
          nodeCount: nodes.length,
        }]);
      }
    }
  }

  return {
    projects,
    sidebarOpen,
    setSidebarOpen,
    focusNameInput,
    clearFocusName: useCallback(() => setFocusNameInput(false), []),
    switchProject,
    deleteProject,
    cloneProject,
    createProject,
    handleLoad,
  };
}
