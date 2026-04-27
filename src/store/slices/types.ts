/**
 * Shared types for Zustand store slices
 */

import type { Edge, Viewport } from '@xyflow/react';
import type { LynkNode } from '../../types';
import type { VirtualFolder } from '../canvasPersistence';

// History snapshot for undo/redo
export interface HistorySnapshot {
  nodes: LynkNode[];
  edges: Edge[];
}

// Zustand slice creator type
export type StateCreator<T> = (
  set: (partial: Partial<CanvasStoreState> | ((state: CanvasStoreState) => Partial<CanvasStoreState>)) => void,
  get: () => CanvasStoreState
) => T;

// Base state that all slices can access
export interface CanvasStoreState {
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

  // File registry state
  fileRegistryOpen: boolean;
  fileRegistrySort: { field: 'name' | 'type' | 'size' | 'date'; direction: 'asc' | 'desc' };
  fileRegistrySearch: string;
  fileRegistryViewMode: 'flat' | 'hierarchy';
  virtualFolders: VirtualFolder[];
  _fileRegistryVersion: number;
}
