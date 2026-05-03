/**
 * File Registry Slice
 *
 * Manages reactive state for the file registry panel,
 * including virtual folders for organising files.
 */

import { BlobRegistry, type FileMetadata, type VirtualFolder } from '../canvasPersistence';
import { generateId } from '../../utils/id';
import type { StateCreator } from './types';

export interface FileRegistrySlice {
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

function generateFolderId(): string {
  return generateId('folder');
}

export const createFileRegistrySlice: StateCreator<FileRegistrySlice> = (set, get) => ({
  fileRegistryOpen: false,
  fileRegistrySort: { field: 'date', direction: 'desc' },
  fileRegistrySearch: '',
  fileRegistryViewMode: 'flat',
  virtualFolders: [],
  _fileRegistryVersion: 0,

  toggleFileRegistry: () => {
    set({ fileRegistryOpen: !get().fileRegistryOpen });
  },

  setFileRegistrySort: (field, direction) => {
    set({ fileRegistrySort: { field, direction } });
  },

  setFileRegistrySearch: (search) => {
    set({ fileRegistrySearch: search });
  },

  setFileRegistryViewMode: (mode) => {
    set({ fileRegistryViewMode: mode });
  },

  createVirtualFolder: (name, parentId = null) => {
    const id = generateFolderId();
    const folder: VirtualFolder = { id, name, parentId: parentId ?? null };
    set({ virtualFolders: [...get().virtualFolders, folder] });
    return id;
  },

  renameVirtualFolder: (folderId, name) => {
    set({
      virtualFolders: get().virtualFolders.map((f) =>
        f.id === folderId ? { ...f, name } : f
      ),
    });
  },

  deleteVirtualFolder: (folderId) => {
    // Collect folder and all descendants
    const folders = get().virtualFolders;
    const toDelete = new Set<string>();
    const collect = (id: string) => {
      toDelete.add(id);
      for (const f of folders) {
        if (f.parentId === id) collect(f.id);
      }
    };
    collect(folderId);

    // Unassign files in deleted folders (current canvas only)
    const canvasId = get().canvasId;
    for (const meta of BlobRegistry.getAllMetadata(canvasId)) {
      if (meta.folderId && toDelete.has(meta.folderId)) {
        meta.folderId = undefined;
      }
    }

    set({
      virtualFolders: folders.filter((f) => !toDelete.has(f.id)),
    });
    set((state) => ({ _fileRegistryVersion: state._fileRegistryVersion + 1 }));
  },

  moveFileToFolder: (fileId, folderId) => {
    const meta = BlobRegistry.getMetadata(fileId);
    if (meta) {
      meta.folderId = folderId ?? undefined;
    }
    set((state) => ({ _fileRegistryVersion: state._fileRegistryVersion + 1 }));
  },

  getRegisteredFiles: () => {
    get()._fileRegistryVersion;
    return BlobRegistry.getAllMetadata(get().canvasId);
  },

  getSortedFilteredFiles: () => {
    get()._fileRegistryVersion;
    const { fileRegistrySort, fileRegistrySearch, canvasId } = get();
    let files = BlobRegistry.getAllMetadata(canvasId);

    if (fileRegistrySearch) {
      const search = fileRegistrySearch.toLowerCase();
      files = files.filter((f) => f.fileName.toLowerCase().includes(search));
    }

    const { field, direction } = fileRegistrySort;
    const dir = direction === 'asc' ? 1 : -1;
    files.sort((a, b) => {
      switch (field) {
        case 'name':
          return dir * a.fileName.localeCompare(b.fileName);
        case 'type':
          return dir * a.mimeType.localeCompare(b.mimeType);
        case 'size':
          return dir * (a.size - b.size);
        case 'date':
          return dir * (a.registeredAt - b.registeredAt);
        default:
          return 0;
      }
    });

    return files;
  },

  getDuplicateGroups: () => {
    get()._fileRegistryVersion;
    const files = BlobRegistry.getAllMetadata(get().canvasId);
    const hashMap = new Map<string, FileMetadata[]>();

    for (const file of files) {
      const group = hashMap.get(file.contentHash);
      if (group) {
        group.push(file);
      } else {
        hashMap.set(file.contentHash, [file]);
      }
    }

    for (const [hash, group] of hashMap) {
      if (group.length <= 1) hashMap.delete(hash);
    }

    return hashMap;
  },

  refreshFileRegistry: () => {
    set((state) => ({ _fileRegistryVersion: state._fileRegistryVersion + 1 }));
  },
});
