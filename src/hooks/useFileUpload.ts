import { useCallback } from 'react';
import { BlobRegistry } from '../store/canvasPersistence';
import { useCanvasStore } from '../store/canvasStore';

export interface FileUploadResult {
  fileId: string;
  fileUrl: string;
  fileName: string;
  fileType: 'pdf' | 'image';
  isDuplicate: boolean;
  existingFileId?: string;
  folderId?: string;
}

interface UseFileUploadOptions {
  onFileRegistered: (result: FileUploadResult) => void;
  allowedTypes?: ('pdf' | 'image')[];
  nodeId?: string;
}

// Recursively read all files from a directory entry
async function readEntriesRecursively(
  entry: FileSystemEntry,
  basePath: string
): Promise<{ file: File; path: string }[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject)
    );
    return [{ file, path: basePath }];
  }

  if (entry.isDirectory) {
    const dirReader = (entry as FileSystemDirectoryEntry).createReader();
    const allEntries: FileSystemEntry[] = [];

    // readEntries may return partial results, so loop until empty
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        dirReader.readEntries(resolve, reject)
      );
      allEntries.push(...batch);
    } while (batch.length > 0);

    const results = await Promise.all(
      allEntries.map((e) =>
        readEntriesRecursively(e, basePath ? `${basePath}/${e.name}` : e.name)
      )
    );
    return results.flat();
  }

  return [];
}

/**
 * Given a path like "reports/2024/jan", ensure virtual folders exist
 * for each segment and return the leaf folder ID.
 */
function ensureVirtualFoldersForPath(folderPath: string): string | undefined {
  if (!folderPath) return undefined;

  const segments = folderPath.split('/').filter(Boolean);
  if (segments.length === 0) return undefined;

  const state = useCanvasStore.getState();
  let folders = state.virtualFolders;
  let parentId: string | null = null;

  for (const segment of segments) {
    const existing = folders.find(
      (f) => f.name === segment && f.parentId === parentId
    );
    if (existing) {
      parentId = existing.id;
    } else {
      const newId = state.createVirtualFolder(segment, parentId);
      // Re-read folders since createVirtualFolder updated the state
      folders = useCanvasStore.getState().virtualFolders;
      parentId = newId;
    }
  }

  return parentId ?? undefined;
}

export function useFileUpload({ onFileRegistered, allowedTypes = ['pdf', 'image'], nodeId }: UseFileUploadOptions) {
  const processFile = useCallback(async (file: File, folderId?: string): Promise<FileUploadResult | null> => {
    const isPdf = file.type === 'application/pdf';
    const isImage = file.type.startsWith('image/');

    if (!isPdf && !isImage) return null;
    if (isPdf && !allowedTypes.includes('pdf')) return null;
    if (isImage && !allowedTypes.includes('image')) return null;

    const canvasId = useCanvasStore.getState().canvasId;
    const result = await BlobRegistry.registerWithMetadata(file, canvasId, nodeId, folderId);

    return {
      fileId: result.fileId,
      fileUrl: result.blobUrl,
      fileName: file.name,
      fileType: isImage ? 'image' : 'pdf',
      isDuplicate: result.isDuplicate,
      existingFileId: result.existingFileId,
      folderId,
    };
  }, [allowedTypes, nodeId]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      // webkitRelativePath gives folder structure for directory uploads
      const relativePath = (file as any).webkitRelativePath as string | undefined;
      const folderPath = relativePath
        ? relativePath.substring(0, relativePath.lastIndexOf('/')) || undefined
        : undefined;
      const folderId = folderPath ? ensureVirtualFoldersForPath(folderPath) : undefined;
      const result = await processFile(file, folderId);
      if (result) onFileRegistered(result);
    }
  }, [processFile, onFileRegistered]);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const result = await processFile(file);
    if (result) onFileRegistered(result);
  }, [processFile, onFileRegistered]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Process DataTransferItems (supports folders via webkitGetAsEntry)
  const processDataTransferItems = useCallback(async (
    items: DataTransferItemList
  ): Promise<FileUploadResult[]> => {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }

    if (entries.length === 0) return [];

    const hasDirectories = entries.some((e) => e.isDirectory);

    if (hasDirectories) {
      const allFiles: { file: File; path: string }[] = [];
      for (const entry of entries) {
        const files = await readEntriesRecursively(
          entry,
          entry.isDirectory ? entry.name : ''
        );
        allFiles.push(...files);
      }

      const results: FileUploadResult[] = [];
      for (const { file, path } of allFiles) {
        // path is like "folderName/subfolder/file.pdf" - take the directory part
        const dirPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : path;
        const folderId = dirPath ? ensureVirtualFoldersForPath(dirPath) : undefined;
        const result = await processFile(file, folderId);
        if (result) results.push(result);
      }
      return results;
    }

    // No directories - process as regular files
    const results: FileUploadResult[] = [];
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject)
        );
        const result = await processFile(file);
        if (result) results.push(result);
      }
    }
    return results;
  }, [processFile]);

  // Handle clipboard paste for images
  const handleClipboardPaste = useCallback(async (
    e: ClipboardEvent
  ): Promise<FileUploadResult[]> => {
    const items = e.clipboardData?.items;
    if (!items) return [];

    const results: FileUploadResult[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = item.type.split('/')[1] || 'png';
        const file = new File([blob], `Pasted Image ${timestamp}.${ext}`, {
          type: item.type,
        });

        const result = await processFile(file);
        if (result) results.push(result);
      }
    }
    return results;
  }, [processFile]);

  return {
    handleFileSelect,
    handleFileDrop,
    handleDragOver,
    processFile,
    processDataTransferItems,
    handleClipboardPaste,
  };
}
