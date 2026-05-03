import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/nodes/nodeRegistry', () => ({
  hasCapability: (type: string, cap: string) => {
    if (cap === 'isFileNode') return ['display', 'extractor'].includes(type);
    if (cap === 'canExport') return ['display', 'extractor', 'calculation', 'sheet', 'label'].includes(type);
    if (cap === 'canImport') return ['viewport', 'calculation', 'sheet', 'label'].includes(type);
    return false;
  },
}));

import { FileCodec } from '../../../store/codecs/fileCodec';
import { BlobRegistry } from '../../../store/canvasPersistence';
import type { CanvasState } from '../../../types';

const baseCanvas: CanvasState = {
  version: '1.0.0',
  metadata: { id: 'test', name: 'Test', createdAt: '2025-01-01', updatedAt: '2025-01-01' },
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe('FileCodec', () => {
  beforeEach(() => {
    BlobRegistry.clear();
  });

  it('has correct id and name', () => {
    expect(FileCodec.id).toBe('files');
    expect(FileCodec.name).toBe('File Embedding');
  });

  describe('encode', () => {
    it('returns empty embedded for canvas with no file nodes', async () => {
      const result = await FileCodec.encode(baseCanvas);
      expect(result.embedded).toEqual({});
      expect(result.warnings).toEqual([]);
    });

    it('encodes file node blobs to base64', async () => {
      const blob = new Blob(['test content'], { type: 'application/pdf' });
      const { fileId } = BlobRegistry.register(blob);
      BlobRegistry.metadata.set(fileId, {
        fileId, fileName: 'test.pdf', mimeType: 'application/pdf',
        size: 12, fileType: 'pdf', contentHash: 'abc', registeredAt: 0, nodeIds: new Set(), canvasId: 'c1',
      });

      const canvas: CanvasState = {
        ...baseCanvas,
        nodes: [{
          id: 'n1', type: 'display', position: { x: 0, y: 0 },
          data: { label: 'D', fileId, fileUrl: 'blob:fake' },
        }] as any,
      };

      const result = await FileCodec.encode(canvas);
      expect(result.embedded[fileId]).toBeTruthy();
      expect(result.embedded[fileId].filename).toBe('test.pdf');
      expect(result.embedded[fileId].data).toBeTruthy(); // base64
      // fileUrl should be stripped from nodes
      expect(result.canvas.nodes[0].data.fileUrl).toBeUndefined();
    });

    it('warns for missing blob', async () => {
      const canvas: CanvasState = {
        ...baseCanvas,
        nodes: [{
          id: 'n1', type: 'display', position: { x: 0, y: 0 },
          data: { label: 'D', fileId: 'nonexistent' },
        }] as any,
      };
      const result = await FileCodec.encode(canvas);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('not found');
    });
  });

  describe('decode', () => {
    it('returns canvas unchanged when no embedded data', () => {
      const result = FileCodec.decode(baseCanvas, undefined);
      expect(result.canvas).toEqual(baseCanvas);
      expect(result.warnings).toEqual([]);
    });

    it('clears orphaned file refs when no embedded data', () => {
      const canvas: CanvasState = {
        ...baseCanvas,
        nodes: [{
          id: 'n1', type: 'display', position: { x: 0, y: 0 },
          data: { label: 'D', fileId: 'orphan-id' },
        }] as any,
      };
      const result = FileCodec.decode(canvas, undefined);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.canvas.nodes[0].data.fileId).toBeUndefined();
    });

    it('decodes base64 back to blob and restores fileUrl', () => {
      const canvas: CanvasState = {
        ...baseCanvas,
        nodes: [{
          id: 'n1', type: 'display', position: { x: 0, y: 0 },
          data: { label: 'D', fileId: 'f1' },
        }] as any,
      };
      const embedded = {
        f1: {
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          data: btoa('hello'),
          size: 5,
          contentHash: 'abc',
        },
      };
      const result = FileCodec.decode(canvas, embedded);
      expect(result.canvas.nodes[0].data.fileUrl).toBeTruthy();
      expect(BlobRegistry.getBlob('f1')).toBeTruthy();
      expect(BlobRegistry.getMetadata('f1')?.fileName).toBe('test.pdf');
    });

    it('clears orphaned fileId when no matching embedded data', () => {
      const canvas: CanvasState = {
        ...baseCanvas,
        nodes: [{
          id: 'n1', type: 'display', position: { x: 0, y: 0 },
          data: { label: 'D', fileId: 'orphan' },
        }] as any,
      };
      const embedded = {
        'other-id': { filename: 'other.pdf', mimeType: 'application/pdf', data: btoa('x') },
      };
      const result = FileCodec.decode(canvas, embedded);
      // Orphaned ref should be cleared
      expect(result.canvas.nodes[0].data.fileId).toBeUndefined();
    });
  });

  describe('validate', () => {
    it('returns valid for canvas with no file nodes', () => {
      const result = FileCodec.validate!(baseCanvas);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('warns for file with URL but no fileId', () => {
      const canvas: CanvasState = {
        ...baseCanvas,
        nodes: [{
          id: 'n1', type: 'display', position: { x: 0, y: 0 },
          data: { label: 'D', fileUrl: 'blob:fake' },
        }] as any,
      };
      const result = FileCodec.validate!(canvas);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('errors for fileId with missing blob', () => {
      const canvas: CanvasState = {
        ...baseCanvas,
        nodes: [{
          id: 'n1', type: 'display', position: { x: 0, y: 0 },
          data: { label: 'D', fileId: 'missing' },
        }] as any,
      };
      const result = FileCodec.validate!(canvas);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('valid when fileId has blob in registry', () => {
      const blob = new Blob(['x']);
      BlobRegistry.blobs.set('f1', blob);
      const canvas: CanvasState = {
        ...baseCanvas,
        nodes: [{
          id: 'n1', type: 'display', position: { x: 0, y: 0 },
          data: { label: 'D', fileId: 'f1' },
        }] as any,
      };
      const result = FileCodec.validate!(canvas);
      expect(result.valid).toBe(true);
    });

    it('uses correct node type name for extractor', () => {
      const canvas: CanvasState = {
        ...baseCanvas,
        nodes: [{
          id: 'n1', type: 'extractor', position: { x: 0, y: 0 },
          data: { label: 'E', fileId: 'missing', regions: [] },
        }] as any,
      };
      const result = FileCodec.validate!(canvas);
      expect(result.errors[0]).toContain('ExtractorNode');
    });
  });
});
