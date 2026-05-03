import { pdfjs } from 'react-pdf';
import { useCanvasStore } from '../../store/canvasStore';
import { BlobRegistry } from '../../store/canvasPersistence';
import type { ExtractorNodeData, CalculationNodeData, LabelNodeData, SheetNodeData } from '../../types/nodes';
import type { SimpleDataType } from '../../types';
import { createRegionFromBox } from '../../utils/regions';
import { getColorForType } from '../../utils/colors';
import { generateId } from '../../utils/id';

export interface ToolResultContent {
  type: 'text' | 'image';
  text?: string;
  mimeType?: string;
  base64?: string;
}

export interface ToolExecutionResult {
  toolCallId: string;
  content: ToolResultContent[];
}

export async function executeToolCall(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const handler = toolHandlers[toolName];
  if (!handler) {
    return {
      toolCallId,
      content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
    };
  }

  const content = await handler(args);
  return { toolCallId, content };
}

/** Render the first page of a PDF blob to a canvas via PDF.js */
async function renderPdfFirstPageToCanvas(buffer: ArrayBuffer): Promise<HTMLCanvasElement> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = await (pdfjs as any).getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Load an image blob into a canvas element */
async function loadImageToCanvas(buffer: ArrayBuffer, mimeType: string): Promise<HTMLCanvasElement> {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load image'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draw existing extraction regions onto a canvas so the AI can see what is already defined */
function annotateCanvasWithRegions(canvas: HTMLCanvasElement, regions: ExtractorNodeData['regions']): void {
  if (!regions.length) return;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  for (const region of regions) {
    if (!region.coordinates) continue;
    const { x, y, width, height } = region.coordinates;
    const color = region.color ?? '#f59e0b';
    // Semi-transparent fill
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
    // Solid border
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    // Label above the box
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(region.label, x + 2, Math.max(y - 4, 12));
  }
  ctx.restore();
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResultContent[]>;

const toolHandlers: Record<string, ToolHandler> = {
  async get_canvas_graph() {
    const { nodes, edges } = useCanvasStore.getState();

    const graph = {
      nodes: nodes.map((n) => {
        const base = { id: n.id, type: n.type, label: (n.data as { label?: string }).label ?? '' };

        if (n.type === 'extractor') {
          const data = n.data as ExtractorNodeData;
          return {
            ...base,
            fileType: data.fileType,
            fields: data.regions.map((r) => ({
              id: r.id,
              label: r.label,
              dataType: r.dataType,
              value: r.extractedData?.value ?? null,
              bbox: r.coordinates
                ? { x: r.coordinates.x, y: r.coordinates.y, w: r.coordinates.width, h: r.coordinates.height }
                : undefined,
            })),
          };
        }
        if (n.type === 'calculation') {
          const data = n.data as CalculationNodeData;
          return { ...base, operation: data.operation };
        }
        if (n.type === 'label') {
          const data = n.data as LabelNodeData;
          return { ...base, text: data.label };
        }
        if (n.type === 'sheet') {
          const data = n.data as SheetNodeData;
          return { ...base, columns: data.subheaders?.length ?? 0 };
        }
        return base;
      }),
      edges: edges.map((e) => ({
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
      })),
    };

    return [{ type: 'text' as const, text: JSON.stringify(graph, null, 2) }];
  },

  async get_node_details(args) {
    const nodeId = args.nodeId as string;
    const { nodes } = useCanvasStore.getState();
    const node = nodes.find((n) => n.id === nodeId);

    if (!node) {
      return [{ type: 'text' as const, text: `Node not found: ${nodeId}` }];
    }

    return [{ type: 'text' as const, text: JSON.stringify(node.data, null, 2) }];
  },

  async get_file_list() {
    const { canvasId } = useCanvasStore.getState();
    const files = BlobRegistry.getAllMetadata(canvasId).map((m) => ({
      fileId: m.fileId,
      fileName: m.fileName,
      mimeType: m.mimeType,
      size: m.size,
      fileType: m.fileType,
      nodeIds: Array.from(m.nodeIds),
    }));

    return [{ type: 'text' as const, text: JSON.stringify(files, null, 2) }];
  },

  async get_file_content(args) {
    const fileId = args.fileId as string;
    const blob = BlobRegistry.getBlob(fileId);
    const meta = BlobRegistry.getMetadata(fileId);

    if (!blob || !meta) {
      return [{ type: 'text' as const, text: `File not found: ${fileId}` }];
    }

    const buffer = await blob.arrayBuffer();

    // Find the extractor node that owns this file to get existing regions for annotation
    const { nodes } = useCanvasStore.getState();
    const ownerNode = nodes.find(
      (n) => n.type === 'extractor' && (n.data as ExtractorNodeData).fileId === fileId
    );
    const existingRegions = ownerNode ? (ownerNode.data as ExtractorNodeData).regions : [];

    try {
      let canvas: HTMLCanvasElement;
      if (meta.fileType === 'pdf') {
        canvas = await renderPdfFirstPageToCanvas(buffer);
      } else {
        canvas = await loadImageToCanvas(buffer, meta.mimeType);
      }

      // Draw existing region boxes so the AI can see what fields are already defined
      annotateCanvasWithRegions(canvas, existingRegions);

      // Return as PNG alongside a text description of existing fields
      const pngBase64 = canvas.toDataURL('image/png').split(',')[1];
      const fieldSummary = existingRegions.length > 0
        ? `Existing fields already defined on this document:\n${existingRegions.map((r) =>
            `- "${r.label}" (${r.dataType})${r.coordinates ? ` at x=${r.coordinates.x}, y=${r.coordinates.y}, w=${r.coordinates.width}, h=${r.coordinates.height}` : ''}`
          ).join('\n')}`
        : 'No fields defined on this document yet.';

      return [
        { type: 'text' as const, text: fieldSummary },
        { type: 'image' as const, mimeType: 'image/png', base64: pngBase64 },
      ];
    } catch {
      return [{ type: 'text' as const, text: `Could not render preview for ${meta.fileName}` }];
    }
  },

  async suggest_connection(args) {
    const sourceNodeId = args.sourceNodeId as string;
    const sourceFieldId = args.sourceFieldId as string;
    const targetNodeId = args.targetNodeId as string;
    const targetHandle = args.targetHandle as string;

    const { nodes, addEdge } = useCanvasStore.getState();
    const sourceNode = nodes.find((n) => n.id === sourceNodeId);
    const targetNode = nodes.find((n) => n.id === targetNodeId);

    if (!sourceNode || !targetNode) {
      return [{ type: 'text' as const, text: `Node not found: ${!sourceNode ? sourceNodeId : targetNodeId}` }];
    }

    // Resolve source handle: direct ID match or label match
    let resolvedSourceHandle = sourceFieldId;
    if (sourceNode.type === 'extractor') {
      const data = sourceNode.data as ExtractorNodeData;
      const direct = data.regions.find((r) => r.id === sourceFieldId);
      if (!direct) {
        const byLabel = data.regions.find(
          (r) => r.label.toLowerCase() === sourceFieldId.toLowerCase()
        ) ?? data.regions.find(
          (r) =>
            r.label.toLowerCase().includes(sourceFieldId.toLowerCase()) ||
            sourceFieldId.toLowerCase().includes(r.label.toLowerCase())
        );
        if (byLabel) resolvedSourceHandle = byLabel.id;
      }
    }

    const edge = {
      id: generateId('edge'),
      source: sourceNodeId,
      sourceHandle: resolvedSourceHandle,
      target: targetNodeId,
      targetHandle,
    };

    const added = addEdge(edge);
    if (!added) {
      return [{ type: 'text' as const, text: 'Could not create connection (would create a cycle)' }];
    }

    return [{ type: 'text' as const, text: JSON.stringify({ status: 'connected', edgeId: edge.id, reason: args.reason }) }];
  },

  async create_region(args) {
    const nodeId = args.nodeId as string;
    const { nodes, updateNodeData } = useCanvasStore.getState();
    const node = nodes.find((n) => n.id === nodeId);

    if (!node || node.type !== 'extractor') {
      return [{ type: 'text' as const, text: `Extractor node not found: ${nodeId}` }];
    }

    const data = node.data as ExtractorNodeData;
    const coordinates = {
      x: args.x as number,
      y: args.y as number,
      width: args.width as number,
      height: args.height as number,
    };
    const dataType = (args.dataType as SimpleDataType) || 'string';

    const newRegion = createRegionFromBox(coordinates, 1, data.regions.length);
    newRegion.label = (args.label as string) || newRegion.label;
    newRegion.dataType = dataType;
    newRegion.color = getColorForType(dataType).border;

    updateNodeData(nodeId, { regions: [...data.regions, newRegion] } as Partial<ExtractorNodeData>);

    return [{ type: 'text' as const, text: JSON.stringify({ status: 'created', regionId: newRegion.id, label: newRegion.label, nodeId }) }];
  },
};
