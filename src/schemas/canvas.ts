import { z } from 'zod';
import { OPERATION_IDS } from '../core/operations/operationRegistry';

// ═══════════════════════════════════════════════════════════════════════════════
// DATA TYPE SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

/** Simple data types for region values and calculations */
const SimpleDataTypeSchema = z.enum(['string', 'number', 'boolean', 'date', 'currency']);

/** Extended data types including complex types and legacy 'text' alias */
const ExtendedDataTypeSchema = z.enum(['string', 'number', 'boolean', 'date', 'currency', 'array', 'table', 'txngroup', 'text']);

// ═══════════════════════════════════════════════════════════════════════════════
// GEOMETRY SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

// Region coordinates for box selections
const RegionCoordinatesSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

// Text range for text selections
const TextRangeSchema = z.object({
  startOffset: z.number(),
  endOffset: z.number(),
  text: z.string(),
  rects: z.array(RegionCoordinatesSchema),
});

// Data source reference
const DataSourceReferenceSchema = z.object({
  nodeId: z.string(),
  regionId: z.string(),
  pageNumber: z.number().optional(),
  coordinates: RegionCoordinatesSchema.optional(),
  textRange: TextRangeSchema.optional(),
  extractionMethod: z.enum(['manual', 'ocr', 'ai']),
  confidence: z.number().optional(),
});

// Data value - supports all extended types including legacy 'text'
const DataValueSchema: z.ZodType<{
  type: z.infer<typeof ExtendedDataTypeSchema>;
  value: unknown;
  source?: z.infer<typeof DataSourceReferenceSchema>;
}> = z.object({
  type: ExtendedDataTypeSchema,
  value: z.unknown(),
  source: DataSourceReferenceSchema.optional(),
});

// Value cache - stores converted values for each data type (partial, not all types need to be present)
const ValueCacheSchema = z.object({
  string: z.string(),
  number: z.string(),
  boolean: z.string(),
  date: z.string(),
  currency: z.string(),
}).partial();

// Extracted region
const ExtractedRegionSchema = z.object({
  id: z.string(),
  label: z.string(),
  selectionType: z.enum(['box', 'text']),
  coordinates: RegionCoordinatesSchema.optional(),
  textRange: TextRangeSchema.optional(),
  pageNumber: z.number(),
  extractedData: DataValueSchema,
  dataType: SimpleDataTypeSchema,
  color: z.string(),
  valueCache: ValueCacheSchema.optional(),
  role: z.enum(['amount', 'date', 'description']).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// VIEW SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

// View rectangle (normalized coordinates 0-1)
const ViewRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

// View target - what part of document is being viewed
const ViewTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), pageNumber: z.number() }),
  z.object({ type: z.literal('image') }),
  z.object({ type: z.literal('sheet'), sheetName: z.string() }),
  z.object({ type: z.literal('slide'), slideNumber: z.number() }),
  z.object({ type: z.literal('range'), sheet: z.string(), range: z.string() }),
]);

// Document view - complete viewport configuration
const DocumentViewSchema = z.object({
  viewport: ViewRectSchema,
  target: ViewTargetSchema,
  nodeSize: z.object({ width: z.number(), height: z.number() }),
  aspectLocked: z.boolean(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE CACHE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

// Cached edge for node type conversion
const CachedEdgeSchema = z.object({
  id: z.string(),
  target: z.string(),
  targetHandle: z.string().optional(),
  sourceHandle: z.string(),
});

// Cached extractor edges when converting to display node
const CachedExtractorEdgesSchema = z.object({
  edges: z.array(CachedEdgeSchema),
  regions: z.array(ExtractedRegionSchema),
  cachedAt: z.string(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// NODE DATA SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

// Base schema for file-backed nodes (DRY)
const FileNodeDataSchema = z.object({
  fileType: z.enum(['pdf', 'image']),
  fileUrl: z.string().optional(),
  fileId: z.string().optional(),
  fileName: z.string().optional(),
});

// Viewport region - a cropped area on a document
const ViewportRegionSchema = z.object({
  id: z.string(),
  label: z.string(),
  normalizedRect: ViewRectSchema,
  pixelRect: RegionCoordinatesSchema,
  pageNumber: z.number(),
});

// Display node data - visual reference for images and PDFs with viewport regions
const DisplayNodeDataSchema = FileNodeDataSchema.extend({
  label: z.string(),
  view: DocumentViewSchema,
  totalPages: z.number(),
  viewports: z.array(ViewportRegionSchema).default([]),
  outputs: z.record(z.string(), z.any()).optional(),
  cachedExtractorEdges: CachedExtractorEdgesSchema.optional(),
});

// Viewport node data - receives cropped region via edge from DisplayNode
const ViewportNodeDataSchema = z.object({
  label: z.string(),
  fileUrl: z.string().optional(),
  fileType: z.enum(['image', 'pdf']).optional(),
  normalizedRect: ViewRectSchema.optional(),
  pageNumber: z.number().optional(),
  nodeSize: z.object({ width: z.number(), height: z.number() }),
  aspectLocked: z.boolean(),
});

// Extractor node data - data extraction with regions
const ExtractorNodeDataSchema = FileNodeDataSchema.extend({
  label: z.string(),
  regions: z.array(ExtractedRegionSchema),
  currentPage: z.number(),
  totalPages: z.number(),
  outputs: z.record(z.string(), z.any()).optional(), // Runtime computed
  invoiceTxnGroupId: z.string().optional(),
});

// Calculation result - uses SimpleDataType (no complex types)
const CalculationResultSchema = z.object({
  value: z.union([z.number(), z.string()]),
  dataType: SimpleDataTypeSchema,
  source: DataSourceReferenceSchema.optional(),
});

// Cached operation inputs for operation switching
const CachedOperationInputsSchema = z.object({
  operationId: z.string(),
  edgeIds: z.array(z.string()),
  cachedAt: z.string(),
});

// Calculation node data
const CalculationNodeDataSchema = z.object({
  label: z.string(),
  operation: z.enum(OPERATION_IDS),
  precision: z.number(),
  inputs: z.array(DataValueSchema),
  result: CalculationResultSchema.optional(),
  inputCache: z.record(z.string(), CachedOperationInputsSchema).optional(),
});

// Sheet entry - mini aggregator within a subheader
const SheetEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  operation: z.enum(OPERATION_IDS),
  expanded: z.boolean().optional(),
});

// Sheet subheader - groups entries and aggregates their outputs
const SheetSubheaderSchema = z.object({
  id: z.string(),
  label: z.string(),
  operation: z.enum(OPERATION_IDS),
  entries: z.array(SheetEntrySchema),
  collapsed: z.boolean().optional(),
});

// Sheet node data - hierarchical data aggregator
const SheetNodeDataSchema = z.object({
  label: z.string(),
  subheaders: z.array(SheetSubheaderSchema),
  entryResults: z.record(z.string(), z.any()).optional(), // Runtime computed
  subheaderResults: z.record(z.string(), z.any()).optional(), // Runtime computed
});

// Label node data
const LabelNodeDataSchema = z.object({
  label: z.string(),
  format: z.enum(['number', 'currency', 'date', 'string', 'text']).transform(
    (v) => v === 'text' ? 'string' : v
  ),
  value: DataValueSchema.optional(),
  manualValue: z.string().optional(),
  isManualMode: z.boolean().optional(),
  fontSize: z.enum(['small', 'medium', 'large']),
  alignment: z.enum(['left', 'center', 'right']),
});

// Group node data
const GroupNodeDataSchema = z.object({
  label: z.string(),
  width: z.number(),
  height: z.number(),
  backgroundColor: z.string().optional(),
  collapsed: z.boolean().optional(),
  aggregatedTxnGroupId: z.string().optional(),
});

// Position
const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// Node schema (discriminated union)
// Each node uses .passthrough() to allow React Flow internal properties (measured, selected, dragging)
const NodeSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('display'),
    position: PositionSchema,
    parentId: z.string().optional(),
    data: DisplayNodeDataSchema,
  }).passthrough(),
  z.object({
    id: z.string(),
    type: z.literal('extractor'),
    position: PositionSchema,
    parentId: z.string().optional(),
    data: ExtractorNodeDataSchema,
  }).passthrough(),
  z.object({
    id: z.string(),
    type: z.literal('calculation'),
    position: PositionSchema,
    parentId: z.string().optional(),
    data: CalculationNodeDataSchema,
  }).passthrough(),
  z.object({
    id: z.string(),
    type: z.literal('sheet'),
    position: PositionSchema,
    parentId: z.string().optional(),
    data: SheetNodeDataSchema,
  }).passthrough(),
  z.object({
    id: z.string(),
    type: z.literal('label'),
    position: PositionSchema,
    parentId: z.string().optional(),
    data: LabelNodeDataSchema,
  }).passthrough(),
  z.object({
    id: z.string(),
    type: z.literal('viewport'),
    position: PositionSchema,
    parentId: z.string().optional(),
    data: ViewportNodeDataSchema,
  }).passthrough(),
  z.object({
    id: z.string(),
    type: z.literal('group'),
    position: PositionSchema,
    data: GroupNodeDataSchema,
  }).passthrough(),
]);

// Edge schema
const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
});

// Viewport schema
const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

// Canvas metadata
const MetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Full canvas state schema
// Virtual folder for file organization
const VirtualFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
});

export const CanvasStateSchema = z.object({
  version: z.string(),
  metadata: MetadataSchema,
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  viewport: ViewportSchema,
  embedded: z.record(z.string(), z.unknown()).optional(),
  virtualFolders: z.array(VirtualFolderSchema).optional(),
});

export type ValidatedCanvasState = z.infer<typeof CanvasStateSchema>;
