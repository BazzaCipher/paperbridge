/**
 * Canvas Store
 *
 * Zustand store for canvas state management.
 * Composed from individual slices for maintainability.
 *
 * Slices:
 * - coreSlice: nodes, edges, viewport, basic CRUD
 * - historySlice: undo/redo functionality
 * - groupSlice: node grouping and selection
 * - persistenceSlice: save/load, import/export
 * - validationSlice: edge cleanup, data validation
 * - layoutSlice: layout algorithms
 */

import { create } from 'zustand';
import type { Edge, NodeChange, EdgeChange, Viewport } from '@xyflow/react';
import type { LynkNode, LynkNodeData, LynkNodeType, CanvasState, ViewportRegion } from '../types';
import type { LayoutType } from '../core/layout/layoutAlgorithms';
import type { ValidationResult } from './codecs';

// Import slice creators
import {
  createCoreSlice,
  createHistorySlice,
  createGroupSlice,
  createPersistenceSlice,
  createValidationSlice,
  createLayoutSlice,
  createFileRegistrySlice,
  type HistorySnapshot,
} from './slices';
import type { FileMetadata, VirtualFolder } from './canvasPersistence';

// Combined store interface (maintains backward compatibility)
interface CanvasStore {
  // Core state
  nodes: LynkNode[];
  edges: Edge[];
  viewport: Viewport;
  highlightedHandle: string | null; // "nodeId:handleId" format

  // Canvas metadata
  canvasName: string;
  canvasId: string;
  lastSaved: string | null;

  // History state
  history: HistorySnapshot[];
  historyIndex: number;

  // React Flow change handlers
  onNodesChange: (changes: NodeChange<LynkNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;

  // Node actions
  addNode: (type: LynkNodeType, position: { x: number; y: number }, data: LynkNodeData) => string;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Partial<LynkNodeData>) => void;
  replaceNode: (nodeId: string, newType: LynkNodeType, newData: LynkNodeData) => void;

  // Edge actions
  addEdge: (edge: Edge) => boolean;
  removeEdge: (edgeId: string) => void;
  removeEdgesToTarget: (targetNodeId: string, targetHandle?: string) => void;
  canAddEdge: (source: string, target: string) => boolean;

  // Dependency graph selectors
  getCalculationOrder: () => string[] | null;
  getDependents: (nodeId: string) => string[];

  // Viewport actions
  setViewport: (viewport: Viewport) => void;

  // Highlight actions
  setHighlightedHandle: (handle: string | null) => void;

  // Viewport region actions
  updateViewportRegion: (nodeId: string, viewportId: string, updates: Partial<ViewportRegion>) => void;

  // Group actions
  createGroup: (nodeIds: string[]) => string | null;
  ungroupNodes: (groupId: string) => void;
  getSelectedNodes: () => LynkNode[];
  getSelectedEdges: () => Edge[];
  removeSelectedNodes: () => void;
  removeSelectedEdges: () => void;
  clearSelection: () => void;

  // History actions
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Canvas actions
  clearCanvas: () => void;
  setCanvasName: (name: string) => void;

  // Persistence actions
  exportCanvas: () => CanvasState;
  importCanvas: (state: CanvasState) => { success: boolean; error?: string };
  validateCanvas: () => ValidationResult;
  saveToFile: () => Promise<{ success: boolean; warnings: string[] }>;
  loadFromFile: () => Promise<{ success: boolean; error?: string }>;

  // Layout actions
  applyLayout: (layoutType: LayoutType) => void;

  // Maintenance actions
  cleanupInvalidEdges: () => number;

  // File registry
  fileRegistryOpen: boolean;
  fileRegistrySort: { field: 'name' | 'type' | 'size' | 'date'; direction: 'asc' | 'desc' };
  fileRegistrySearch: string;
  _fileRegistryVersion: number;
  fileRegistryViewMode: 'flat' | 'hierarchy';
  virtualFolders: VirtualFolder[];
  toggleFileRegistry: () => void;
  setFileRegistrySort: (field: 'name' | 'type' | 'size' | 'date', direction: 'asc' | 'desc') => void;
  setFileRegistrySearch: (search: string) => void;
  setFileRegistryViewMode: (mode: 'flat' | 'hierarchy') => void;
  createVirtualFolder: (name: string, parentId?: string | null) => string;
  renameVirtualFolder: (folderId: string, name: string) => void;
  deleteVirtualFolder: (folderId: string) => void;
  moveFileToFolder: (fileId: string, folderId: string | null) => void;
  getRegisteredFiles: () => FileMetadata[];
  getSortedFilteredFiles: () => FileMetadata[];
  getDuplicateGroups: () => Map<string, FileMetadata[]>;
  refreshFileRegistry: () => void;
}

/**
 * Main canvas store - composes all slices into a single store.
 * API remains identical for backward compatibility.
 */
export const useCanvasStore = create<CanvasStore>((set, get) => ({
  // Compose all slices
  ...createCoreSlice(set, get),
  ...createHistorySlice(set, get),
  ...createGroupSlice(set, get),
  ...createPersistenceSlice(set, get),
  ...createValidationSlice(set, get),
  ...createLayoutSlice(set, get),
  ...createFileRegistrySlice(set, get),
}));
