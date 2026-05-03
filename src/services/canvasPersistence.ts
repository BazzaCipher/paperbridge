/**
 * Canvas Persistence Service
 *
 * Standalone functions for canvas import/export and file I/O.
 * Saves/loads .lynk archive files (ZIP-based format).
 */

import type { LynkNode, CanvasState } from '../types';
import type { VirtualFolder } from '../store/canvasPersistence';
import type { TxnGroup } from '../core/sources/txnGroup';
import { CanvasStateSchema } from '../schemas/canvas';
import { clearLocalStorageDraft } from '../hooks/useLocalStorageSync';
import { defaultPipeline, type ValidationResult, type ExportedCanvas } from '../store/codecs';
import { setNodeIdCounter } from '../store/slices/coreSlice';
import { FileNode } from '../types';
import { BlobRegistry } from '../store/canvasPersistence';
import { packLynk, unpackLynk, type LynkFileEntry } from './lynkArchive';

export type { ValidationResult };

export interface CanvasData {
  nodes: LynkNode[];
  edges: import('@xyflow/react').Edge[];
  viewport: import('@xyflow/react').Viewport;
  canvasName: string;
  canvasId: string;
  lastSaved: string | null;
  virtualFolders?: VirtualFolder[];
  txnGroups?: Record<string, TxnGroup>;
}

export interface ImportResult {
  success: boolean;
  error?: string;
  data?: CanvasData;
}

export interface SaveResult {
  success: boolean;
  warnings: string[];
}

/**
 * Export canvas state to a serializable object
 */
export function exportCanvas(data: CanvasData): CanvasState {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    metadata: {
      id: data.canvasId,
      name: data.canvasName,
      createdAt: data.lastSaved || now,
      updatedAt: now,
    },
    nodes: data.nodes,
    edges: data.edges,
    viewport: data.viewport,
    virtualFolders: data.virtualFolders,
    txnGroups: data.txnGroups,
  };
}

/**
 * Import and validate canvas state
 */
export function importCanvas(state: ExportedCanvas): ImportResult {
  const result = CanvasStateSchema.safeParse(state);
  if (!result.success) {
    // Include field paths in error message for debugging
    const errors = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    return {
      success: false,
      error: `Invalid canvas file: ${errors}`,
    };
  }

  const validState = result.data;
  const { canvas: restoredState, warnings } = defaultPipeline.import(validState as ExportedCanvas);

  if (warnings.length > 0) {
    console.warn('Canvas import warnings:', warnings);
  }

  // Find highest node ID to continue from
  let maxNodeId = 0;
  for (const node of restoredState.nodes) {
    const match = node.id.match(/^node-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNodeId) maxNodeId = num;
    }
  }
  setNodeIdCounter(maxNodeId);

  return {
    success: true,
    data: {
      nodes: restoredState.nodes as LynkNode[],
      edges: restoredState.edges,
      viewport: restoredState.viewport,
      canvasName: restoredState.metadata.name,
      canvasId: restoredState.metadata.id,
      lastSaved: restoredState.metadata.updatedAt,
      virtualFolders: restoredState.virtualFolders,
      txnGroups: restoredState.txnGroups,
    },
  };
}

/**
 * Validate canvas for export
 */
export function validateCanvas(data: CanvasData): ValidationResult {
  const state = exportCanvas(data);
  return defaultPipeline.validate(state);
}

/**
 * Collect file data from BlobRegistry for archive packing
 */
async function collectFileData(
  nodes: LynkNode[]
): Promise<{ files: Map<string, { meta: LynkFileEntry; data: Uint8Array }>; warnings: string[] }> {
  const warnings: string[] = [];
  const files = new Map<string, { meta: LynkFileEntry; data: Uint8Array }>();

  const fileIds = FileNode.filter(nodes)
    .map((node) => FileNode.getFileId(node))
    .filter((id): id is string => id !== undefined);

  for (const fileId of fileIds) {
    if (files.has(fileId)) continue; // deduplicate

    const blob = BlobRegistry.getBlob(fileId);
    if (!blob) {
      warnings.push(`File ${fileId} not found in registry, skipping`);
      continue;
    }

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const meta = BlobRegistry.getMetadata(fileId);
      files.set(fileId, {
        meta: {
          filename: meta?.fileName || fileId,
          mimeType: blob.type || 'application/octet-stream',
          size: meta?.size ?? blob.size,
          contentHash: meta?.contentHash,
          folderId: meta?.folderId,
        },
        data: new Uint8Array(arrayBuffer),
      });
    } catch (err) {
      warnings.push(`Failed to read file ${fileId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return { files, warnings };
}

/**
 * Save canvas to .lynk file (triggers download)
 */
export async function saveToFile(data: CanvasData): Promise<SaveResult> {
  const state = exportCanvas(data);

  const validation = defaultPipeline.validate(state);
  if (!validation.valid) {
    console.error('Canvas validation failed:', validation.errors);
    return { success: false, warnings: validation.errors };
  }

  // Strip fileUrls from nodes (blob URLs are runtime-only)
  const cleanedNodes = state.nodes.map((node) => {
    if (!FileNode.is(node)) return node;
    if (!node.data.fileUrl) return node;
    const { fileUrl: _, ...restData } = node.data;
    return { ...node, data: restData };
  }) as LynkNode[];

  // Collect binary file data
  const { files, warnings: fileWarnings } = await collectFileData(state.nodes);
  const allWarnings = [...validation.warnings, ...fileWarnings];

  // Pack into .lynk archive
  const archiveBytes = packLynk({
    manifest: {
      formatVersion: 1,
      version: state.version,
      metadata: state.metadata,
      nodes: cleanedNodes,
      edges: state.edges,
      viewport: state.viewport,
      virtualFolders: state.virtualFolders,
    },
    files,
  });

  const blob = new Blob([archiveBytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.metadata.name.replace(/[^a-z0-9]/gi, '_')}.lynk`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  clearLocalStorageDraft();

  return { success: true, warnings: allWarnings };
}

/**
 * Import a .lynk archive: unpack, restore files to BlobRegistry, return canvas state
 */
function importLynkArchive(archiveData: Uint8Array): ImportResult {
  const { manifest, files } = unpackLynk(archiveData);

  // Restore files to BlobRegistry
  const fileIdToUrl: Record<string, string> = {};
  for (const [fileId, bytes] of files) {
    const fileMeta = manifest.files[fileId];
    if (!fileMeta) continue;

    const blob = new Blob([bytes as BlobPart], { type: fileMeta.mimeType });
    const blobUrl = URL.createObjectURL(blob);

    BlobRegistry.blobs.set(fileId, blob);
    BlobRegistry.urlToId.set(blobUrl, fileId);
    BlobRegistry.idToUrl.set(fileId, blobUrl);
    fileIdToUrl[fileId] = blobUrl;

    const isPdf = fileMeta.mimeType === 'application/pdf';
    BlobRegistry.metadata.set(fileId, {
      fileId,
      fileName: fileMeta.filename || fileId,
      mimeType: fileMeta.mimeType,
      size: fileMeta.size ?? bytes.length,
      fileType: isPdf ? 'pdf' : 'image',
      contentHash: fileMeta.contentHash ?? '',
      registeredAt: Date.now(),
      nodeIds: new Set<string>(),
      folderId: fileMeta.folderId,
      canvasId: manifest.metadata.id,
    });
  }

  // Restore fileUrl on nodes
  const restoredNodes = (manifest.nodes as LynkNode[]).map((node) => {
    if (!FileNode.is(node)) return node;
    const fileId = FileNode.getFileId(node);
    if (!fileId || !fileIdToUrl[fileId]) return node;
    return { ...node, data: { ...node.data, fileUrl: fileIdToUrl[fileId] } };
  }) as LynkNode[];

  // Rebuild nodeIds references
  for (const node of restoredNodes) {
    if (FileNode.is(node)) {
      const fid = FileNode.getFileId(node);
      if (fid) BlobRegistry.addNodeReference(fid, node.id);
    }
  }

  // Build CanvasState and run through normal import validation
  const canvasState: ExportedCanvas = {
    version: manifest.version,
    metadata: manifest.metadata,
    nodes: restoredNodes,
    edges: manifest.edges as import('@xyflow/react').Edge[],
    viewport: manifest.viewport,
    virtualFolders: manifest.virtualFolders,
  };

  // Validate via schema (skip file codec since we already restored files)
  const result = CanvasStateSchema.safeParse(canvasState);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    return { success: false, error: `Invalid .lynk file: ${errors}` };
  }

  // Find highest node ID
  let maxNodeId = 0;
  for (const node of restoredNodes) {
    const match = node.id.match(/^node-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNodeId) maxNodeId = num;
    }
  }
  setNodeIdCounter(maxNodeId);

  return {
    success: true,
    data: {
      nodes: restoredNodes,
      edges: canvasState.edges,
      viewport: canvasState.viewport,
      canvasName: canvasState.metadata.name,
      canvasId: canvasState.metadata.id,
      lastSaved: canvasState.metadata.updatedAt,
      virtualFolders: canvasState.virtualFolders,
    },
  };
}

/**
 * Load canvas from file (triggers file picker)
 * Supports both .lynk (archive) and legacy .lynk.json files.
 */
export function loadFromFile(): Promise<ImportResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lynk,.json,.lynk.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        resolve({ success: false, error: 'No file selected' });
        return;
      }

      try {
        // Detect format: .lynk archive vs legacy JSON
        if (file.name.endsWith('.lynk') && !file.name.endsWith('.lynk.json')) {
          const arrayBuffer = await file.arrayBuffer();
          resolve(importLynkArchive(new Uint8Array(arrayBuffer)));
        } else {
          // Legacy .lynk.json / .json support
          const text = await file.text();
          const data = JSON.parse(text);
          resolve(importCanvas(data));
        }
      } catch (err) {
        resolve({
          success: false,
          error: `Failed to parse file: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      }
    };

    input.oncancel = () => {
      resolve({ success: false, error: 'File selection cancelled' });
    };

    input.click();
  });
}
