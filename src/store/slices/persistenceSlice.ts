/**
 * Persistence Slice
 *
 * Canvas metadata state only. I/O operations are in services/canvasPersistence.ts
 */

import type { CanvasState } from '../../types';
import type { ValidationResult, ExportedCanvas } from '../codecs';
import * as persistenceService from '../../services/canvasPersistence';
import { BlobRegistry } from '../canvasPersistence';
import { filterValidEdges } from '../../services/canvasValidation';
import { generateId } from '../../utils/id';
import type { StateCreator } from './types';
import { resetNodeIdCounter } from './coreSlice';

const generateCanvasId = () => generateId('canvas');

export interface PersistenceSlice {
  canvasName: string;
  canvasId: string;
  lastSaved: string | null;

  clearCanvas: () => void;
  setCanvasName: (name: string) => void;
  exportCanvas: () => CanvasState;
  importCanvas: (state: CanvasState | ExportedCanvas) => { success: boolean; error?: string };
  validateCanvas: () => ValidationResult;
  saveToFile: () => Promise<{ success: boolean; warnings: string[] }>;
  loadFromFile: () => Promise<{ success: boolean; error?: string }>;
}

export const createPersistenceSlice: StateCreator<PersistenceSlice> = (set, get) => ({
  canvasName: 'Untitled Canvas',
  canvasId: generateCanvasId(),
  lastSaved: null,

  clearCanvas: () => {
    const oldCanvasId = get().canvasId;
    BlobRegistry.removeCanvasFiles(oldCanvasId);
    set({
      nodes: [],
      edges: [],
      highlightedHandle: null,
      canvasName: 'Untitled Canvas',
      canvasId: generateCanvasId(),
      lastSaved: null,
      virtualFolders: [],
      txnGroups: {},
    });
    resetNodeIdCounter();
  },

  setCanvasName: (name) => set({ canvasName: name }),

  exportCanvas: () => {
    const { nodes, edges, viewport, canvasName, canvasId, lastSaved, virtualFolders, txnGroups } = get();
    return persistenceService.exportCanvas({ nodes, edges, viewport, canvasName, canvasId, lastSaved, virtualFolders, txnGroups });
  },

  importCanvas: (state) => {
    const result = persistenceService.importCanvas(state);
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    set({
      nodes: result.data.nodes,
      edges: result.data.edges,
      viewport: result.data.viewport,
      canvasName: result.data.canvasName,
      canvasId: result.data.canvasId,
      lastSaved: result.data.lastSaved,
      virtualFolders: result.data.virtualFolders || [],
      txnGroups: result.data.txnGroups || {},
      highlightedHandle: null,
    });

    // Clean up invalid edges
    const { nodes, edges } = get();
    const { valid, removedCount } = filterValidEdges(nodes, edges);
    if (removedCount > 0) {
      set({ edges: valid });
      console.log(`Removed ${removedCount} invalid edge(s) during import`);
    }

    return { success: true };
  },

  validateCanvas: () => {
    const { nodes, edges, viewport, canvasName, canvasId, lastSaved, virtualFolders, txnGroups } = get();
    return persistenceService.validateCanvas({ nodes, edges, viewport, canvasName, canvasId, lastSaved, virtualFolders, txnGroups });
  },

  saveToFile: async () => {
    const { nodes, edges, viewport, canvasName, canvasId, lastSaved, virtualFolders, txnGroups } = get();
    const result = await persistenceService.saveToFile({ nodes, edges, viewport, canvasName, canvasId, lastSaved, virtualFolders, txnGroups });
    if (result.success) {
      set({ lastSaved: new Date().toISOString() });
    }
    return result;
  },

  loadFromFile: async () => {
    const result = await persistenceService.loadFromFile();
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    set({
      nodes: result.data.nodes,
      edges: result.data.edges,
      viewport: result.data.viewport,
      canvasName: result.data.canvasName,
      canvasId: result.data.canvasId,
      lastSaved: result.data.lastSaved,
      virtualFolders: result.data.virtualFolders || [],
      txnGroups: result.data.txnGroups || {},
      highlightedHandle: null,
    });

    // Clean up invalid edges
    const { nodes, edges } = get();
    const { valid, removedCount } = filterValidEdges(nodes, edges);
    if (removedCount > 0) {
      set({ edges: valid });
      console.log(`Removed ${removedCount} invalid edge(s) during load`);
    }

    return { success: true };
  },
});
