/**
 * Node Types
 *
 * Defines all node types for the canvas graph including
 * display, extractor, calculation, sheet, and label nodes.
 */

import type { Node } from '@xyflow/react';
import type { DataValue, SimpleDataType } from './data';
import type { DataSourceReference } from './geometry';
import type { ExtractedRegion } from './regions';
import type { ViewportRegion } from './viewport';
import type { DocumentView } from './view';
import type { FileNodeData, Exportable, Importable } from './categories';

// ═══════════════════════════════════════════════════════════════════════════════
// NODE TYPE IDENTIFIERS
// ═══════════════════════════════════════════════════════════════════════════════

export type LynkNodeType = 'display' | 'extractor' | 'calculation' | 'sheet' | 'label' | 'group' | 'viewport';

// ═══════════════════════════════════════════════════════════════════════════════
// BASE NODE DATA
// ═══════════════════════════════════════════════════════════════════════════════

/** Base node data that all nodes share */
export interface BaseNodeData extends Record<string, unknown> {
  label: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE CACHING (for node type conversion)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cached edge state when converting from ExtractorNode to DisplayNode.
 * Stores edge connections so they can be restored when switching back.
 */
export interface CachedExtractorEdges {
  /** Edges that were connected from this node */
  edges: Array<{
    id: string;
    target: string;
    targetHandle?: string;
    sourceHandle: string;
  }>;
  /** Preserve region definitions for restoration */
  regions: ExtractedRegion[];
  /** Timestamp of when this was cached */
  cachedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPLAY NODE (visual reference for images and PDFs)
// ═══════════════════════════════════════════════════════════════════════════════

/** Display node specific data - visual reference with viewport regions */
export interface DisplayNodeData extends BaseNodeData, FileNodeData, Exportable {
  /** View configuration - defines what portion of document is shown */
  view: DocumentView;
  /** Total pages in document (1 for images) */
  totalPages: number;
  /** Viewport regions drawn on the document */
  viewports: ViewportRegion[];
  /** Edge cache when switching from ExtractorNode */
  cachedExtractorEdges?: CachedExtractorEdges;
  /** Document dimensions at scale=1 (natural size) */
  documentSize?: { width: number; height: number };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEWPORT NODE (cropped view connected to DisplayNode)
// ═══════════════════════════════════════════════════════════════════════════════

/** Viewport node specific data - receives cropped region via edge from DisplayNode */
export interface ViewportNodeData extends BaseNodeData, Importable {
  /** File URL copied from parent DisplayNode for rendering */
  fileUrl?: string;
  /** File type of the parent document */
  fileType?: 'image' | 'pdf';
  /** Normalized crop coordinates (0-1) */
  normalizedRect?: ViewportRegion['normalizedRect'];
  /** Page number for PDFs */
  pageNumber?: number;
  /** Node display size */
  nodeSize: { width: number; height: number };
  /** Lock aspect ratio when resizing */
  aspectLocked: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACTOR NODE (data extraction with regions and OCR)
// ═══════════════════════════════════════════════════════════════════════════════

/** Extractor node specific data - data extraction with output handles */
export interface ExtractorNodeData extends BaseNodeData, FileNodeData, Exportable {
  regions: ExtractedRegion[];
  currentPage: number;
  totalPages: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALCULATION NODE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cached input state for an operation.
 * Stores edge connections so they can be restored when switching back to this operation.
 */
export interface CachedOperationInputs {
  /** The operation this cache is for */
  operationId: string;
  /** Edge IDs that were connected */
  edgeIds: string[];
  /** Timestamp of when this was cached */
  cachedAt: string;
}

/**
 * Result from a calculation operation with type information.
 * The dataType may differ from inputs (e.g., count returns number regardless of input types).
 */
export interface CalculationResult {
  /** The computed value */
  value: number | string | Date;
  /** The data type of the result (determines output handle color) */
  dataType: SimpleDataType;
  /** Optional source tracking for provenance */
  source?: DataSourceReference;
}

/**
 * Calculation node specific data.
 * Uses extensible operation IDs from the operation registry.
 */
export interface CalculationNodeData extends BaseNodeData, Importable, Exportable {
  /** Operation ID - references operationRegistry (e.g., 'sum', 'max', 'round') */
  operation: string;
  /** Decimal precision for result display */
  precision: number;
  /** Input values (resolved from edges) - computed, not persisted */
  inputs: DataValue[];
  /** Computed result with type information */
  result?: CalculationResult;
  /**
   * Cached inputs per operation.
   * When user switches operations, we store current connections here.
   * If they switch back, compatible connections can be restored.
   */
  inputCache?: Record<string, CachedOperationInputs>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET NODE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sheet entry - like a mini CalculationNode within a SheetNode.
 * Accepts multiple inputs, applies an operation, outputs the result.
 */
export interface SheetEntry {
  id: string;
  label: string;
  /** Operation ID from registry (default: 'sum') */
  operation: string;
  /** Show/hide connected inputs (like CalculationNode) */
  expanded?: boolean;
}

/**
 * Sheet subheader - groups entries and aggregates their outputs.
 */
export interface SheetSubheader {
  id: string;
  label: string;
  /** Operation ID from registry (default: 'sum') */
  operation: string;
  entries: SheetEntry[];
  /** Collapse entire subheader */
  collapsed?: boolean;
}

/**
 * Computed result for an entry or subheader.
 */
export interface SheetComputedResult {
  value: number | string | Date;
  dataType: SimpleDataType;
}

/** Sheet node specific data */
export interface SheetNodeData extends BaseNodeData, Importable, Exportable {
  subheaders: SheetSubheader[];
  /** Computed entry results (for entry output handles) - runtime only */
  entryResults?: Record<string, SheetComputedResult | null>;
  /** Computed subheader results (for subheader output handles) - runtime only */
  subheaderResults?: Record<string, SheetComputedResult | null>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LABEL NODE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Display format options for label nodes.
 * Note: 'text' is kept for backward compatibility, treated as 'string'.
 */
export type LabelFormat = 'number' | 'currency' | 'date' | 'string';

/** Label node specific data */
export interface LabelNodeData extends BaseNodeData, Importable, Exportable {
  format: LabelFormat;
  value?: DataValue;
  /** User-entered value when in manual mode */
  manualValue?: string;
  /** True when using manual input instead of connected edge */
  isManualMode?: boolean;
  fontSize: 'small' | 'medium' | 'large';
  alignment: 'left' | 'center' | 'right';
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP NODE
// ═══════════════════════════════════════════════════════════════════════════════

/** Group node specific data - container for grouping other nodes */
export interface GroupNodeData extends BaseNodeData {
  /** Width of the group container */
  width: number;
  /** Height of the group container */
  height: number;
  /** Background color (optional, defaults to transparent) */
  backgroundColor?: string;
  /** Whether the group is collapsed (children hidden) */
  collapsed?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NODE DATA UNION
// ═══════════════════════════════════════════════════════════════════════════════

/** Union type for all node data types */
export type LynkNodeData =
  | DisplayNodeData
  | ViewportNodeData
  | ExtractorNodeData
  | CalculationNodeData
  | SheetNodeData
  | LabelNodeData
  | GroupNodeData;

// ═══════════════════════════════════════════════════════════════════════════════
// REACT FLOW NODE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Typed React Flow nodes */
export type DisplayNode = Node<DisplayNodeData, 'display'>;
export type ViewportNode = Node<ViewportNodeData, 'viewport'>;
export type ExtractorNode = Node<ExtractorNodeData, 'extractor'>;
export type CalculationNode = Node<CalculationNodeData, 'calculation'>;
export type SheetNode = Node<SheetNodeData, 'sheet'>;
export type LabelNode = Node<LabelNodeData, 'label'>;
export type GroupNode = Node<GroupNodeData, 'group'>;

/** Union type for all node types */
export type LynkNode = DisplayNode | ViewportNode | ExtractorNode | CalculationNode | SheetNode | LabelNode | GroupNode;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS (runtime type checking)
// ═══════════════════════════════════════════════════════════════════════════════

/** Type guard and utilities for DisplayNode */
export const DisplayNode = {
  type: 'display' as const,
  is: (node: LynkNode): node is DisplayNode => node.type === 'display',
};

/** Type guard and utilities for ViewportNode */
export const ViewportNode = {
  type: 'viewport' as const,
  is: (node: LynkNode): node is ViewportNode => node.type === 'viewport',
};

/** Type guard and utilities for ExtractorNode */
export const ExtractorNode = {
  type: 'extractor' as const,
  is: (node: LynkNode): node is ExtractorNode => node.type === 'extractor',
};

/** Type guard and utilities for CalculationNode */
export const CalculationNode = {
  type: 'calculation' as const,
  is: (node: LynkNode): node is CalculationNode => node.type === 'calculation',
};

/** Type guard and utilities for SheetNode */
export const SheetNode = {
  type: 'sheet' as const,
  is: (node: LynkNode): node is SheetNode => node.type === 'sheet',
};

/** Type guard and utilities for LabelNode */
export const LabelNode = {
  type: 'label' as const,
  is: (node: LynkNode): node is LabelNode => node.type === 'label',
};

/** Type guard and utilities for GroupNode */
export const GroupNode = {
  type: 'group' as const,
  is: (node: LynkNode): node is GroupNode => node.type === 'group',
};
