import { describe, it, expect, beforeEach } from 'vitest';
import { BlobRegistry } from '../../store/canvasPersistence';

describe('BlobRegistry', () => {
  beforeEach(() => {
    BlobRegistry.clear();
  });

  it('register stores blob and returns fileId/blobUrl', () => {
    const blob = new Blob(['test'], { type: 'text/plain' });
    const { fileId, blobUrl } = BlobRegistry.register(blob);
    expect(fileId).toBeTruthy();
    expect(blobUrl).toBeTruthy();
    expect(BlobRegistry.getBlob(fileId)).toBe(blob);
  });

  it('getIdFromUrl returns fileId for known URL', () => {
    const blob = new Blob(['test']);
    const { fileId, blobUrl } = BlobRegistry.register(blob);
    expect(BlobRegistry.getIdFromUrl(blobUrl)).toBe(fileId);
  });

  it('getUrlFromId returns URL for known fileId', () => {
    const blob = new Blob(['test']);
    const { fileId, blobUrl } = BlobRegistry.register(blob);
    expect(BlobRegistry.getUrlFromId(fileId)).toBe(blobUrl);
  });

  it('registerWithMetadata creates metadata', async () => {
    const file = new File(['hello'], 'test.pdf', { type: 'application/pdf' });
    const result = await BlobRegistry.registerWithMetadata(file, 'canvas-1', 'node-1');
    expect(result.isDuplicate).toBe(false);
    expect(result.metadata.fileName).toBe('test.pdf');
    expect(result.metadata.fileType).toBe('pdf');
    expect(result.metadata.nodeIds.has('node-1')).toBe(true);
  });

  it('registerWithMetadata detects duplicates', async () => {
    const file1 = new File(['same content'], 'a.pdf', { type: 'application/pdf' });
    const file2 = new File(['same content'], 'b.pdf', { type: 'application/pdf' });
    const r1 = await BlobRegistry.registerWithMetadata(file1, 'canvas-1', 'n1');
    const r2 = await BlobRegistry.registerWithMetadata(file2, 'canvas-1', 'n2');
    expect(r2.isDuplicate).toBe(true);
    expect(r2.existingFileId).toBe(r1.fileId);
    expect(r2.metadata.nodeIds.has('n2')).toBe(true);
  });

  it('registerWithMetadata with image file', async () => {
    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    const result = await BlobRegistry.registerWithMetadata(file, 'canvas-1');
    expect(result.metadata.fileType).toBe('image');
    expect(result.metadata.nodeIds.size).toBe(0);
  });

  it('registerWithMetadata with folderId', async () => {
    const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' });
    const result = await BlobRegistry.registerWithMetadata(file, 'canvas-1', undefined, 'folder-1');
    expect(result.metadata.folderId).toBe('folder-1');
  });

  it('addNodeReference / removeNodeReference', () => {
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'test', mimeType: 'text/plain',
      size: 0, fileType: 'image', contentHash: '', registeredAt: 0, nodeIds: new Set(), canvasId: 'canvas-1',
    });
    BlobRegistry.addNodeReference('f1', 'n1');
    expect(BlobRegistry.getMetadata('f1')?.nodeIds.has('n1')).toBe(true);
    BlobRegistry.removeNodeReference('f1', 'n1');
    expect(BlobRegistry.getMetadata('f1')?.nodeIds.has('n1')).toBe(false);
  });

  it('renameFile updates fileName', () => {
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'old.pdf', mimeType: 'application/pdf',
      size: 0, fileType: 'pdf', contentHash: '', registeredAt: 0, nodeIds: new Set(), canvasId: 'c1',
    });
    BlobRegistry.renameFile('f1', 'new.pdf');
    expect(BlobRegistry.getMetadata('f1')?.fileName).toBe('new.pdf');
  });

  it('getAllMetadata returns all entries', () => {
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'a', mimeType: '', size: 0, fileType: 'image', contentHash: '', registeredAt: 0, nodeIds: new Set(), canvasId: 'c1',
    });
    BlobRegistry.metadata.set('f2', {
      fileId: 'f2', fileName: 'b', mimeType: '', size: 0, fileType: 'image', contentHash: '', registeredAt: 0, nodeIds: new Set(), canvasId: 'c1',
    });
    expect(BlobRegistry.getAllMetadata()).toHaveLength(2);
  });

  it('findByHash returns matching metadata', () => {
    BlobRegistry.metadata.set('f1', {
      fileId: 'f1', fileName: 'a', mimeType: '', size: 0, fileType: 'image', contentHash: 'abc123', registeredAt: 0, nodeIds: new Set(), canvasId: 'c1',
    });
    expect(BlobRegistry.findByHash('abc123')?.fileId).toBe('f1');
    expect(BlobRegistry.findByHash('nonexistent')).toBeUndefined();
  });

  it('removeFile cleans up all maps', () => {
    const blob = new Blob(['test']);
    const { fileId, blobUrl } = BlobRegistry.register(blob);
    BlobRegistry.metadata.set(fileId, {
      fileId, fileName: 'test', mimeType: '', size: 0, fileType: 'image', contentHash: '', registeredAt: 0, nodeIds: new Set(), canvasId: 'c1',
    });
    BlobRegistry.removeFile(fileId);
    expect(BlobRegistry.getBlob(fileId)).toBeUndefined();
    expect(BlobRegistry.getUrlFromId(fileId)).toBeUndefined();
    expect(BlobRegistry.getIdFromUrl(blobUrl)).toBeUndefined();
    expect(BlobRegistry.getMetadata(fileId)).toBeUndefined();
  });

  it('clear removes everything', () => {
    BlobRegistry.register(new Blob(['a']));
    BlobRegistry.register(new Blob(['b']));
    BlobRegistry.clear();
    expect(BlobRegistry.getAllMetadata()).toHaveLength(0);
  });
});
