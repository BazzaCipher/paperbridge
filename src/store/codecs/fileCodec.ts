/**
 * File Codec
 *
 * Handles encoding and decoding of file data (PDFs, images) for canvas export/import.
 * Colocates all file handling logic in one place:
 * - encode: Collect fileIds, convert blobs to base64, strip fileUrls from nodes
 * - decode: Convert base64 back to blobs, register in BlobRegistry, restore fileUrls
 * - validate: Check for missing blobs, orphaned references
 */

import type { CanvasState, LynkNode } from '../../types';
import { FileNode, ExtractorNode } from '../../types';
import { BlobRegistry } from '../canvasPersistence';
import type { CanvasCodec, EncodeResult, DecodeResult, ValidationResult } from './types';

/**
 * Embedded file data shape for the files codec
 */
export interface FileEmbeddedData {
  [fileId: string]: {
    filename: string;
    mimeType: string;
    /** Base64-encoded file content */
    data: string;
    /** File size in bytes */
    size?: number;
    /** SHA-256 hash for duplicate detection */
    contentHash?: string;
    /** Virtual folder assignment */
    folderId?: string;
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Extract base64 portion after "data:mime/type;base64,"
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Collect all file IDs from FileNodes (DisplayNodes and ExtractorNodes)
 */
function collectFileIds(nodes: LynkNode[]): string[] {
  return FileNode.filter(nodes)
    .map((node) => FileNode.getFileId(node))
    .filter((id): id is string => id !== undefined);
}

/**
 * Strip fileUrl from nodes (blob URLs are meaningless in saved file)
 */
function stripFileUrls(nodes: LynkNode[]): LynkNode[] {
  return nodes.map((node) => {
    if (!FileNode.is(node)) return node;
    if (!node.data.fileUrl) return node;

    const { fileUrl: _, ...restData } = node.data;
    return {
      ...node,
      data: restData,
    };
  }) as LynkNode[];
}

/**
 * Restore blob URLs in FileNodes from embedded files
 */
function restoreFileUrls(
  nodes: LynkNode[],
  fileIdToUrl: Record<string, string>
): LynkNode[] {
  return nodes.map((node) => {
    if (!FileNode.is(node)) return node;

    const fileId = FileNode.getFileId(node);
    if (!fileId) return node;

    const blobUrl = fileIdToUrl[fileId];
    if (!blobUrl) {
      // No embedded file data - clear orphaned fileId reference
      const { fileId: _, ...restData } = node.data;
      return {
        ...node,
        data: restData,
      };
    }

    return {
      ...node,
      data: {
        ...node.data,
        fileUrl: blobUrl,
      },
    };
  }) as LynkNode[];
}

/**
 * Clear orphaned file references from nodes when embedded data is missing
 */
function clearOrphanedFileRefs(nodes: LynkNode[]): { nodes: LynkNode[]; warnings: string[] } {
  const warnings: string[] = [];
  const cleanedNodes = nodes.map((node) => {
    if (!FileNode.is(node)) return node;

    const fileId = FileNode.getFileId(node);
    if (!fileId) return node;

    // File reference exists but no embedded data - clear it
    warnings.push(
      `FileNode "${node.data.label}" references file "${fileId}" but no embedded file data found. Reference cleared.`
    );

    const { fileId: _, fileUrl: __, ...restData } = node.data;
    return {
      ...node,
      data: restData,
    };
  }) as LynkNode[];

  return { nodes: cleanedNodes, warnings };
}

export const FileCodec: CanvasCodec<FileEmbeddedData> = {
  id: 'files',
  name: 'File Embedding',

  async encode(canvas: CanvasState): Promise<EncodeResult<FileEmbeddedData>> {
    const warnings: string[] = [];
    const embedded: FileEmbeddedData = {};

    // Collect all file IDs from FileNodes
    const fileIds = collectFileIds(canvas.nodes);

    // Convert blobs to base64
    for (const fileId of fileIds) {
      const blob = BlobRegistry.getBlob(fileId);
      if (!blob) {
        warnings.push(`File ${fileId} not found in registry, skipping`);
        continue;
      }

      try {
        const base64 = await blobToBase64(blob);
        const meta = BlobRegistry.getMetadata(fileId);
        embedded[fileId] = {
          filename: meta?.fileName || fileId,
          mimeType: blob.type || 'application/octet-stream',
          data: base64,
          size: meta?.size,
          contentHash: meta?.contentHash,
          folderId: meta?.folderId,
        };
      } catch (err) {
        warnings.push(`Failed to embed file ${fileId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // Strip fileUrls from nodes (blob URLs are meaningless in saved file)
    const cleanedNodes = stripFileUrls(canvas.nodes);

    return {
      canvas: {
        ...canvas,
        nodes: cleanedNodes,
      },
      embedded,
      warnings,
    };
  },

  decode(canvas: CanvasState, embedded: FileEmbeddedData | undefined): DecodeResult {
    // If no embedded files, clear any orphaned file references
    if (!embedded || Object.keys(embedded).length === 0) {
      // Check if any nodes have fileId references
      const hasFileRefs = FileNode.filter(canvas.nodes).some(
        (node) => FileNode.getFileId(node) !== undefined
      );

      if (hasFileRefs) {
        const { nodes, warnings } = clearOrphanedFileRefs(canvas.nodes);
        return {
          canvas: { ...canvas, nodes },
          warnings,
        };
      }

      return { canvas, warnings: [] };
    }

    const warnings: string[] = [];
    const fileIdToUrl: Record<string, string> = {};

    // Convert base64 back to blobs and register in BlobRegistry
    for (const [fileId, file] of Object.entries(embedded)) {
      try {
        const blob = base64ToBlob(file.data, file.mimeType);
        const blobUrl = URL.createObjectURL(blob);

        BlobRegistry.blobs.set(fileId, blob);
        BlobRegistry.urlToId.set(blobUrl, fileId);
        BlobRegistry.idToUrl.set(fileId, blobUrl);

        fileIdToUrl[fileId] = blobUrl;

        // Restore metadata
        const isPdf = file.mimeType === 'application/pdf';
        BlobRegistry.metadata.set(fileId, {
          fileId,
          fileName: file.filename || fileId,
          mimeType: file.mimeType,
          size: file.size ?? blob.size,
          fileType: isPdf ? 'pdf' : 'image',
          contentHash: file.contentHash ?? '',
          registeredAt: Date.now(),
          nodeIds: new Set<string>(),
          folderId: file.folderId,
          canvasId: canvas.metadata.id,
        });
      } catch (err) {
        warnings.push(`Failed to extract file ${fileId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // Restore fileUrls in nodes
    const restoredNodes = restoreFileUrls(canvas.nodes, fileIdToUrl);

    // Rebuild nodeIds references from decoded nodes
    for (const node of restoredNodes) {
      if (FileNode.is(node)) {
        const fid = FileNode.getFileId(node);
        if (fid) {
          BlobRegistry.addNodeReference(fid, node.id);
        }
      }
    }

    return {
      canvas: {
        ...canvas,
        nodes: restoredNodes,
      },
      warnings,
    };
  },

  validate(canvas: CanvasState): ValidationResult {
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const node of canvas.nodes) {
      if (FileNode.is(node)) {
        const fileUrl = FileNode.getFileUrl(node);
        const fileId = FileNode.getFileId(node);
        const label = node.data.label;
        const nodeTypeName = ExtractorNode.is(node) ? 'ExtractorNode' : 'DisplayNode';

        // Check if file has URL but no fileId (blob URL that won't persist)
        if (fileUrl && !fileId) {
          warnings.push(
            `${nodeTypeName} "${label}" has a file loaded but it won't be saved. ` +
              `Re-import the file to include it in the export.`
          );
        }

        // Check if file has fileId but blob not in registry
        if (fileId && !BlobRegistry.getBlob(fileId)) {
          errors.push(
            `${nodeTypeName} "${label}" references file ${fileId} but file data is missing.`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
    };
  },
};
