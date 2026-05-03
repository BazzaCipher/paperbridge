import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/nodes/nodeRegistry', () => ({
  hasCapability: (type: string, cap: string) => {
    if (cap === 'isFileNode') return ['display', 'extractor'].includes(type);
    if (cap === 'canExport') return ['display', 'extractor', 'calculation', 'sheet', 'label'].includes(type);
    if (cap === 'canImport') return ['viewport', 'calculation', 'sheet', 'label'].includes(type);
    return false;
  },
}));

import { createFileRegistrySlice } from '../../../store/slices/fileRegistrySlice';
import { BlobRegistry } from '../../../store/canvasPersistence';

function createStore() {
  let state: any = {};
  const set = (partial: any) => {
    if (typeof partial === 'function') {
      Object.assign(state, partial(state));
    } else {
      Object.assign(state, partial);
    }
  };
  const get = () => state;
  const slice = createFileRegistrySlice(set, get);
  Object.assign(state, slice);
  return state;
}

describe('createFileRegistrySlice', () => {
  beforeEach(() => {
    BlobRegistry.clear();
  });

  it('has default state', () => {
    const store = createStore();
    expect(store.fileRegistryOpen).toBe(false);
    expect(store.fileRegistrySort).toEqual({ field: 'date', direction: 'desc' });
    expect(store.fileRegistrySearch).toBe('');
    expect(store.fileRegistryViewMode).toBe('flat');
    expect(store.virtualFolders).toEqual([]);
  });

  it('toggleFileRegistry toggles open state', () => {
    const store = createStore();
    store.toggleFileRegistry();
    expect(store.fileRegistryOpen).toBe(true);
    store.toggleFileRegistry();
    expect(store.fileRegistryOpen).toBe(false);
  });

  it('setFileRegistrySort updates sort', () => {
    const store = createStore();
    store.setFileRegistrySort('name', 'asc');
    expect(store.fileRegistrySort).toEqual({ field: 'name', direction: 'asc' });
  });

  it('setFileRegistrySearch updates search', () => {
    const store = createStore();
    store.setFileRegistrySearch('invoice');
    expect(store.fileRegistrySearch).toBe('invoice');
  });

  it('setFileRegistryViewMode updates view mode', () => {
    const store = createStore();
    store.setFileRegistryViewMode('hierarchy');
    expect(store.fileRegistryViewMode).toBe('hierarchy');
  });

  it('createVirtualFolder creates and returns ID', () => {
    const store = createStore();
    const id = store.createVirtualFolder('Invoices');
    expect(id).toBeTruthy();
    expect(store.virtualFolders).toHaveLength(1);
    expect(store.virtualFolders[0].name).toBe('Invoices');
    expect(store.virtualFolders[0].parentId).toBeNull();
  });

  it('createVirtualFolder with parent', () => {
    const store = createStore();
    const parentId = store.createVirtualFolder('Root');
    store.createVirtualFolder('Child', parentId);
    expect(store.virtualFolders).toHaveLength(2);
    expect(store.virtualFolders[1].parentId).toBe(parentId);
  });

  it('renameVirtualFolder renames', () => {
    const store = createStore();
    const id = store.createVirtualFolder('Old');
    store.renameVirtualFolder(id, 'New');
    expect(store.virtualFolders[0].name).toBe('New');
  });

  it('deleteVirtualFolder removes folder and descendants', () => {
    const store = createStore();
    const parentId = store.createVirtualFolder('Parent');
    store.createVirtualFolder('Child', parentId);
    store.deleteVirtualFolder(parentId);
    expect(store.virtualFolders).toHaveLength(0);
  });

  it('getRegisteredFiles returns metadata from BlobRegistry', () => {
    const store = createStore();
    // Register a file directly
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1',
      fileName: 'test.pdf',
      mimeType: 'application/pdf',
      size: 1000,
      fileType: 'pdf',
      contentHash: 'abc',
      registeredAt: Date.now(),
      nodeIds: new Set(), canvasId: 'c1',
    });
    const files = store.getRegisteredFiles();
    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('test.pdf');
  });

  it('getSortedFilteredFiles filters by search', () => {
    const store = createStore();
    const now = Date.now();
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'invoice.pdf', mimeType: 'application/pdf',
      size: 1000, fileType: 'pdf', contentHash: 'a', registeredAt: now, nodeIds: new Set(), canvasId: 'c1',
    });
    BlobRegistry.metadata.set('f2', {
      fileId: 'f2', fileName: 'receipt.png', mimeType: 'image/png',
      size: 500, fileType: 'image', contentHash: 'b', registeredAt: now + 1, nodeIds: new Set(), canvasId: 'c1',
    });
    store.setFileRegistrySearch('invoice');
    const files = store.getSortedFilteredFiles();
    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('invoice.pdf');
  });

  it('getSortedFilteredFiles sorts by name asc', () => {
    const store = createStore();
    const now = Date.now();
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'b.pdf', mimeType: 'application/pdf',
      size: 1000, fileType: 'pdf', contentHash: 'a', registeredAt: now, nodeIds: new Set(), canvasId: 'c1',
    });
    BlobRegistry.metadata.set('f2', {
      fileId: 'f2', fileName: 'a.png', mimeType: 'image/png',
      size: 500, fileType: 'image', contentHash: 'b', registeredAt: now, nodeIds: new Set(), canvasId: 'c1',
    });
    store.setFileRegistrySort('name', 'asc');
    const files = store.getSortedFilteredFiles();
    expect(files[0].fileName).toBe('a.png');
    expect(files[1].fileName).toBe('b.pdf');
  });

  it('getSortedFilteredFiles sorts by size', () => {
    const store = createStore();
    const now = Date.now();
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'big.pdf', mimeType: 'application/pdf',
      size: 5000, fileType: 'pdf', contentHash: 'a', registeredAt: now, nodeIds: new Set(), canvasId: 'c1',
    });
    BlobRegistry.metadata.set('f2', {
      fileId: 'f2', fileName: 'small.png', mimeType: 'image/png',
      size: 100, fileType: 'image', contentHash: 'b', registeredAt: now, nodeIds: new Set(), canvasId: 'c1',
    });
    store.setFileRegistrySort('size', 'asc');
    const files = store.getSortedFilteredFiles();
    expect(files[0].size).toBe(100);
  });

  it('getDuplicateGroups finds duplicates by hash', () => {
    const store = createStore();
    const now = Date.now();
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'a.pdf', mimeType: 'application/pdf',
      size: 1000, fileType: 'pdf', contentHash: 'same-hash', registeredAt: now, nodeIds: new Set(), canvasId: 'c1',
    });
    BlobRegistry.metadata.set('f2', {
      fileId: 'f2', fileName: 'b.pdf', mimeType: 'application/pdf',
      size: 1000, fileType: 'pdf', contentHash: 'same-hash', registeredAt: now, nodeIds: new Set(), canvasId: 'c1',
    });
    BlobRegistry.metadata.set('f3', {
      fileId: 'f3', fileName: 'c.png', mimeType: 'image/png',
      size: 500, fileType: 'image', contentHash: 'unique', registeredAt: now, nodeIds: new Set(), canvasId: 'c1',
    });
    const groups = store.getDuplicateGroups();
    expect(groups.size).toBe(1);
    expect(groups.get('same-hash')).toHaveLength(2);
  });

  it('moveFileToFolder updates file metadata', () => {
    const store = createStore();
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'test.pdf', mimeType: 'application/pdf',
      size: 1000, fileType: 'pdf', contentHash: 'a', registeredAt: Date.now(), nodeIds: new Set(), canvasId: 'c1',
    });
    const folderId = store.createVirtualFolder('Folder');
    store.moveFileToFolder('f1', folderId);
    expect(BlobRegistry.getMetadata('f1')?.folderId).toBe(folderId);
  });

  it('deleteVirtualFolder unassigns files in deleted folder', () => {
    const store = createStore();
    const folderId = store.createVirtualFolder('Docs');
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'test.pdf', mimeType: 'application/pdf',
      size: 1000, fileType: 'pdf', contentHash: 'a', registeredAt: Date.now(), nodeIds: new Set(), canvasId: 'c1',
      folderId,
    });
    store.deleteVirtualFolder(folderId);
    expect(BlobRegistry.getMetadata('f1')?.folderId).toBeUndefined();
  });

  it('getSortedFilteredFiles sorts by type', () => {
    const store = createStore();
    const now = Date.now();
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'a.pdf', mimeType: 'application/pdf',
      size: 1000, fileType: 'pdf', contentHash: 'a', registeredAt: now, nodeIds: new Set(), canvasId: 'c1',
    });
    BlobRegistry.metadata.set('f2', {
      fileId: 'f2', fileName: 'b.png', mimeType: 'image/png',
      size: 500, fileType: 'image', contentHash: 'b', registeredAt: now, nodeIds: new Set(), canvasId: 'c1',
    });
    store.setFileRegistrySort('type', 'asc');
    const files = store.getSortedFilteredFiles();
    expect(files[0].mimeType).toBe('application/pdf');
  });

  it('refreshFileRegistry increments version', () => {
    const store = createStore();
    const v1 = store._fileRegistryVersion;
    store.refreshFileRegistry();
    expect(store._fileRegistryVersion).toBe(v1 + 1);
  });
});
