/**
 * Canvas Persistence
 *
 * Blob URL registry for tracking files in memory.
 * Export/import logic has moved to src/store/codecs/.
 */

import { generateId } from '../utils/id';

// ═══════════════════════════════════════════════════════════════════════════════
// FILE METADATA
// ═══════════════════════════════════════════════════════════════════════════════

export interface FileMetadata {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  fileType: 'pdf' | 'image';
  contentHash: string;
  registeredAt: number;
  nodeIds: Set<string>;
  folderId?: string;
  /** Canvas (project) this file belongs to. Files are not shared across canvases. */
  canvasId: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIRTUAL FOLDERS
// ═══════════════════════════════════════════════════════════════════════════════

export interface VirtualFolder {
  id: string;
  name: string;
  parentId: string | null;
}

async function computeHash(blob: Blob): Promise<string> {
  const rawBuffer = await blob.arrayBuffer();
  // Ensure we have a proper ArrayBuffer (jsdom may return a Node Buffer)
  const view = new Uint8Array(rawBuffer);
  // crypto.subtle is only available in secure contexts (HTTPS/localhost)
  if (crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', view);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback: simple FNV-1a-like hash for non-secure contexts
  const bytes = view;
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + '-' + bytes.length.toString(16);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOB REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

export interface RegisterWithMetadataResult {
  fileId: string;
  blobUrl: string;
  metadata: FileMetadata;
  isDuplicate: boolean;
  existingFileId?: string;
}

/**
 * Registry tracking blob URLs and their associated file data.
 * Allows converting between runtime blob URLs and persistable base64.
 */
export const BlobRegistry = {
  // Maps fileId -> blob data
  blobs: new Map<string, Blob>() as Map<string, Blob>,
  // Maps blobUrl -> fileId (reverse lookup)
  urlToId: new Map<string, string>() as Map<string, string>,
  // Maps fileId -> blobUrl
  idToUrl: new Map<string, string>() as Map<string, string>,
  // Maps fileId -> metadata
  metadata: new Map<string, FileMetadata>() as Map<string, FileMetadata>,

  generateId(): string {
    return generateId('file');
  },

  register(blob: Blob): { fileId: string; blobUrl: string } {
    const fileId = this.generateId();
    const blobUrl = URL.createObjectURL(blob);

    this.blobs.set(fileId, blob);
    this.urlToId.set(blobUrl, fileId);
    this.idToUrl.set(fileId, blobUrl);

    return { fileId, blobUrl };
  },

  async registerWithMetadata(
    file: File,
    canvasId: string,
    nodeId?: string,
    folderId?: string
  ): Promise<RegisterWithMetadataResult> {
    const contentHash = await computeHash(file);

    // Check for existing file with same hash, scoped to this canvas
    const existing = this.findByHash(contentHash, canvasId);
    if (existing) {
      if (nodeId) {
        existing.nodeIds.add(nodeId);
      }
      const blobUrl = this.idToUrl.get(existing.fileId)!;
      return {
        fileId: existing.fileId,
        blobUrl,
        metadata: existing,
        isDuplicate: true,
        existingFileId: existing.fileId,
      };
    }

    // Register new file
    const { fileId, blobUrl } = this.register(file);
    const isPdf = file.type === 'application/pdf';

    const meta: FileMetadata = {
      fileId,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      fileType: isPdf ? 'pdf' : 'image',
      contentHash,
      registeredAt: Date.now(),
      nodeIds: new Set(nodeId ? [nodeId] : []),
      folderId,
      canvasId,
    };

    this.metadata.set(fileId, meta);

    return {
      fileId,
      blobUrl,
      metadata: meta,
      isDuplicate: false,
    };
  },

  getMetadata(fileId: string): FileMetadata | undefined {
    return this.metadata.get(fileId);
  },

  getAllMetadata(canvasId?: string): FileMetadata[] {
    const all = Array.from(this.metadata.values());
    return canvasId ? all.filter((m) => m.canvasId === canvasId) : all;
  },

  findByHash(hash: string, canvasId?: string): FileMetadata | undefined {
    for (const meta of this.metadata.values()) {
      if (meta.contentHash !== hash) continue;
      if (canvasId && meta.canvasId !== canvasId) continue;
      return meta;
    }
    return undefined;
  },

  /** Remove all files belonging to a canvas. Used when clearing the canvas. */
  removeCanvasFiles(canvasId: string): void {
    const toRemove: string[] = [];
    for (const meta of this.metadata.values()) {
      if (meta.canvasId === canvasId) toRemove.push(meta.fileId);
    }
    for (const fileId of toRemove) {
      this.removeFile(fileId);
    }
  },

  addNodeReference(fileId: string, nodeId: string): void {
    const meta = this.metadata.get(fileId);
    if (meta) {
      meta.nodeIds.add(nodeId);
    }
  },

  renameFile(fileId: string, newName: string): void {
    const meta = this.metadata.get(fileId);
    if (meta) meta.fileName = newName;
  },

  removeNodeReference(fileId: string, nodeId: string): void {
    const meta = this.metadata.get(fileId);
    if (meta) {
      meta.nodeIds.delete(nodeId);
    }
  },

  getIdFromUrl(blobUrl: string): string | undefined {
    return this.urlToId.get(blobUrl);
  },

  getUrlFromId(fileId: string): string | undefined {
    return this.idToUrl.get(fileId);
  },

  getBlob(fileId: string): Blob | undefined {
    return this.blobs.get(fileId);
  },

  removeFile(fileId: string): void {
    const url = this.idToUrl.get(fileId);
    if (url) {
      URL.revokeObjectURL(url);
      this.urlToId.delete(url);
    }
    this.idToUrl.delete(fileId);
    this.blobs.delete(fileId);
    this.metadata.delete(fileId);
  },

  clear(): void {
    for (const url of this.urlToId.keys()) {
      URL.revokeObjectURL(url);
    }
    this.blobs.clear();
    this.urlToId.clear();
    this.idToUrl.clear();
    this.metadata.clear();
  },
};
