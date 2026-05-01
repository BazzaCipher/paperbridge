import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Canvas mock ─────────────────────────────────────────────────────────────
const mockCtx = {
  save: vi.fn(),
  restore: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
  drawImage: vi.fn(),
  globalAlpha: 1,
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  font: '',
};
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: vi.fn(() => mockCtx),
  toDataURL: vi.fn(() => 'data:image/png;base64,FAKEBASE64'),
};
vi.stubGlobal('document', {
  createElement: vi.fn((tag: string) => {
    if (tag === 'canvas') return { ...mockCanvas };
    return {};
  }),
});

// ─── BlobRegistry mock ───────────────────────────────────────────────────────
const blobMeta = new Map<string, {
  fileId: string; fileName: string; mimeType: string; size: number;
  fileType: 'pdf' | 'image'; nodeIds: Set<string>; canvasId: string;
}>();
const blobData = new Map<string, Blob>();

vi.mock('../../store/canvasPersistence', () => ({
  BlobRegistry: {
    getAllMetadata: vi.fn(() => [...blobMeta.values()]),
    getMetadata: vi.fn((id: string) => blobMeta.get(id) ?? null),
    getBlob: vi.fn((id: string) => blobData.get(id) ?? null),
  },
}));

// ─── Canvas store mock ───────────────────────────────────────────────────────
let mockNodes: any[] = [];
let mockEdges: any[] = [];
const mockAddEdge = vi.fn((edge: any) => { mockEdges.push(edge); return true; });
const mockUpdateNodeData = vi.fn();

vi.mock('../../store/canvasStore', () => ({
  useCanvasStore: {
    getState: vi.fn(() => ({
      nodes: mockNodes,
      edges: mockEdges,
      addEdge: mockAddEdge,
      updateNodeData: mockUpdateNodeData,
    })),
  },
}));

// ─── react-pdf pdfjs mock ────────────────────────────────────────────────────
vi.mock('react-pdf', () => ({
  pdfjs: {
    getDocument: vi.fn((_opts: unknown) => ({
      promise: Promise.resolve({
        getPage: vi.fn(async () => ({
          getViewport: vi.fn(() => ({ width: 100, height: 150 })),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
        })),
      }),
    })),
  },
}));

// ─── URL mock (needed by loadImageToCanvas) ──────────────────────────────────
vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock'),
  revokeObjectURL: vi.fn(),
});

// ─── Import the module under test AFTER mocks are in place ───────────────────
import { executeToolCall } from '../../services/ai/toolExecutor';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeExtractorNode(id: string, fileId: string, regions: any[] = []) {
  return {
    id,
    type: 'extractor',
    data: { fileId, regions, label: 'Doc' },
  };
}

function makeBlob(fileId: string, fileType: 'pdf' | 'image' = 'image') {
  const blob = new Blob([''], { type: fileType === 'pdf' ? 'application/pdf' : 'image/png' });
  blobMeta.set(fileId, {
    fileId,
    fileName: `file.${fileType === 'pdf' ? 'pdf' : 'png'}`,
    mimeType: fileType === 'pdf' ? 'application/pdf' : 'image/png',
    size: 0,
    fileType,
    nodeIds: new Set(), canvasId: 'c1',
  });
  blobData.set(fileId, blob);
}

beforeEach(() => {
  mockNodes = [];
  mockEdges = [];
  blobMeta.clear();
  blobData.clear();
  vi.clearAllMocks();
  // Restore createElement mock after clearAllMocks
  (document.createElement as any).mockImplementation((tag: string) => {
    if (tag === 'canvas') return { ...mockCanvas, width: 0, height: 0 };
    return {};
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('executeToolCall - unknown tool', () => {
  it('returns an error message for unknown tools', async () => {
    const result = await executeToolCall('id1', 'nonexistent_tool', {});
    expect(result.toolCallId).toBe('id1');
    expect(result.content[0].text).toContain('Unknown tool');
  });
});

describe('get_canvas_graph', () => {
  it('returns nodes and edges as JSON', async () => {
    mockNodes = [
      { id: 'n1', type: 'extractor', data: { label: 'Doc', fileType: 'pdf', regions: [] } },
    ];
    mockEdges = [{ source: 'n1', sourceHandle: 'f1', target: 'n2', targetHandle: 'inputs' }];

    const result = await executeToolCall('id', 'get_canvas_graph', {});
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].id).toBe('n1');
    expect(parsed.edges).toHaveLength(1);
  });

  it('includes bbox for extractor regions that have coordinates', async () => {
    mockNodes = [{
      id: 'n1',
      type: 'extractor',
      data: {
        label: 'Doc',
        fileType: 'image',
        regions: [{
          id: 'r1',
          label: 'Total',
          dataType: 'currency',
          extractedData: { value: '$100' },
          coordinates: { x: 10, y: 20, width: 80, height: 15 },
        }],
      },
    }];

    const result = await executeToolCall('id', 'get_canvas_graph', {});
    const parsed = JSON.parse(result.content[0].text!);
    const field = parsed.nodes[0].fields[0];
    expect(field.bbox).toEqual({ x: 10, y: 20, w: 80, h: 15 });
    expect(field.value).toBe('$100');
  });

  it('omits bbox when region has no coordinates', async () => {
    mockNodes = [{
      id: 'n1',
      type: 'extractor',
      data: {
        label: 'Doc',
        fileType: 'image',
        regions: [{ id: 'r1', label: 'Name', dataType: 'string', extractedData: null }],
      },
    }];

    const result = await executeToolCall('id', 'get_canvas_graph', {});
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.nodes[0].fields[0].bbox).toBeUndefined();
  });
});

describe('get_node_details', () => {
  it('returns node data as JSON', async () => {
    mockNodes = [
      { id: 'n1', type: 'extractor', data: { label: 'Invoice', regions: [] } },
    ];
    const result = await executeToolCall('id', 'get_node_details', { nodeId: 'n1' });
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.label).toBe('Invoice');
  });

  it('returns error for unknown node', async () => {
    mockNodes = [];
    const result = await executeToolCall('id', 'get_node_details', { nodeId: 'missing' });
    expect(result.content[0].text).toContain('Node not found');
  });
});

describe('get_file_list', () => {
  it('returns empty array when no files', async () => {
    const result = await executeToolCall('id', 'get_file_list', {});
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed).toEqual([]);
  });

  it('lists files with metadata', async () => {
    makeBlob('file1', 'image');
    const result = await executeToolCall('id', 'get_file_list', {});
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].fileId).toBe('file1');
    expect(parsed[0].fileType).toBe('image');
  });
});

describe('get_file_content', () => {
  it('returns error when file not found', async () => {
    const result = await executeToolCall('id', 'get_file_content', { fileId: 'missing' });
    expect(result.content[0].text).toContain('File not found');
  });

  it('returns text summary + image for an image file', async () => {
    makeBlob('img1', 'image');
    mockNodes = [makeExtractorNode('n1', 'img1', [])];

    // Mock Image loading
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 200;
      naturalHeight = 300;
      set src(_: string) { this.onload?.(); }
    });

    const result = await executeToolCall('id', 'get_file_content', { fileId: 'img1' });
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1].type).toBe('image');
    expect(result.content[1].mimeType).toBe('image/png');
    expect(result.content[1].base64).toBe('FAKEBASE64');
  });

  it('returns text summary + image for a PDF file', async () => {
    makeBlob('pdf1', 'pdf');
    mockNodes = [makeExtractorNode('n1', 'pdf1', [
      {
        id: 'r1',
        label: 'Invoice #',
        dataType: 'string',
        color: '#f59e0b',
        coordinates: { x: 5, y: 5, width: 50, height: 10 },
      },
    ])];

    const result = await executeToolCall('id', 'get_file_content', { fileId: 'pdf1' });
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Invoice #');
    expect(result.content[1].type).toBe('image');
  });

  it('text summary describes no-fields state', async () => {
    makeBlob('img2', 'image');
    mockNodes = [makeExtractorNode('n1', 'img2', [])];

    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      set src(_: string) { this.onload?.(); }
      naturalWidth = 100;
      naturalHeight = 100;
    });

    const result = await executeToolCall('id', 'get_file_content', { fileId: 'img2' });
    expect(result.content[0].text).toContain('No fields defined');
  });
});

describe('create_region', () => {
  it('creates a region on an extractor node', async () => {
    mockNodes = [makeExtractorNode('n1', 'f1', [])];

    const result = await executeToolCall('id', 'create_region', {
      nodeId: 'n1',
      x: 10, y: 20, width: 100, height: 30,
      label: 'Invoice Number',
      dataType: 'string',
    });

    expect(mockUpdateNodeData).toHaveBeenCalledOnce();
    const [calledNodeId, patch] = mockUpdateNodeData.mock.calls[0];
    expect(calledNodeId).toBe('n1');
    expect(patch.regions).toHaveLength(1);
    expect(patch.regions[0].label).toBe('Invoice Number');

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.status).toBe('created');
    expect(parsed.nodeId).toBe('n1');
  });

  it('returns error for non-extractor node', async () => {
    mockNodes = [{ id: 'n1', type: 'calculation', data: { label: 'Calc' } }];
    const result = await executeToolCall('id', 'create_region', {
      nodeId: 'n1', x: 0, y: 0, width: 10, height: 10, label: 'x', dataType: 'string',
    });
    expect(result.content[0].text).toContain('Extractor node not found');
    expect(mockUpdateNodeData).not.toHaveBeenCalled();
  });

  it('returns error for missing node', async () => {
    mockNodes = [];
    const result = await executeToolCall('id', 'create_region', {
      nodeId: 'ghost', x: 0, y: 0, width: 10, height: 10, label: 'x', dataType: 'string',
    });
    expect(result.content[0].text).toContain('Extractor node not found');
  });
});

describe('suggest_connection', () => {
  it('creates an edge between two nodes', async () => {
    mockNodes = [
      makeExtractorNode('src', 'f1', [{ id: 'r1', label: 'Total', dataType: 'currency' }]),
      { id: 'dst', type: 'label', data: { label: 'Display' } },
    ];

    const result = await executeToolCall('id', 'suggest_connection', {
      sourceNodeId: 'src',
      sourceFieldId: 'r1',
      targetNodeId: 'dst',
      targetHandle: 'input',
      reason: 'show total',
    });

    expect(mockAddEdge).toHaveBeenCalledOnce();
    const edge = mockAddEdge.mock.calls[0][0];
    expect(edge.source).toBe('src');
    expect(edge.sourceHandle).toBe('r1');
    expect(edge.target).toBe('dst');
    expect(edge.targetHandle).toBe('input');

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.status).toBe('connected');
  });

  it('resolves source field by label when ID not found', async () => {
    mockNodes = [
      makeExtractorNode('src', 'f1', [{ id: 'r1', label: 'Total Amount', dataType: 'currency' }]),
      { id: 'dst', type: 'calculation', data: { label: 'Sum' } },
    ];

    await executeToolCall('id', 'suggest_connection', {
      sourceNodeId: 'src',
      sourceFieldId: 'total amount',  // label match, not ID
      targetNodeId: 'dst',
      targetHandle: 'inputs',
      reason: 'sum it',
    });

    const edge = mockAddEdge.mock.calls[0][0];
    expect(edge.sourceHandle).toBe('r1');  // resolved to actual region ID
  });

  it('returns error when source node not found', async () => {
    mockNodes = [{ id: 'dst', type: 'label', data: {} }];
    const result = await executeToolCall('id', 'suggest_connection', {
      sourceNodeId: 'missing',
      sourceFieldId: 'r1',
      targetNodeId: 'dst',
      targetHandle: 'input',
      reason: '',
    });
    expect(result.content[0].text).toContain('Node not found');
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  it('returns error when addEdge returns false (cycle)', async () => {
    mockAddEdge.mockReturnValueOnce(false);
    mockNodes = [
      makeExtractorNode('src', 'f1', [{ id: 'r1', label: 'A', dataType: 'string' }]),
      { id: 'dst', type: 'label', data: {} },
    ];
    const result = await executeToolCall('id', 'suggest_connection', {
      sourceNodeId: 'src',
      sourceFieldId: 'r1',
      targetNodeId: 'dst',
      targetHandle: 'input',
      reason: '',
    });
    expect(result.content[0].text).toContain('cycle');
  });
});
