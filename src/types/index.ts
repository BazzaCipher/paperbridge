/**
 * Type System Index
 *
 * Re-exports all types from modular files for convenient importing.
 * Import from '../types' to access any type.
 */

// Data types and values
export type {
  SimpleDataType,
  ExtendedDataType,
  LegacyTextType,
  AnyDataType,
  StringValue,
  NumberValue,
  BooleanValue,
  DateValue,
  CurrencyValue,
  SimpleValue,
  DataValue,
} from './data';

export { normalizeDataType, isSimpleDataType } from './data';

// Geometry and selection types
export type {
  RegionCoordinates,
  TextRange,
  SelectionType,
  DataSourceReference,
} from './geometry';

// Extracted regions and field detection
export type { ExtractedRegion, ExtractorColumn, FieldType, DetectedField, TableRecord } from './regions';

// Viewport types
export type { ViewportRegion } from './viewport';

// View types
export type {
  ViewRect,
  ViewTarget,
  DocumentView,
} from './view';

export { DEFAULT_VIEW, createImageView, createPdfView } from './view';

// Node types and type guards
export type {
  LynkNodeType,
  BaseNodeData,
  CachedExtractorEdges,
  DisplayNodeData,
  ViewportNodeData,
  ExtractorNodeData,
  CachedOperationInputs,
  CalculationResult,
  CalculationNodeData,
  SheetEntry,
  SheetSubheader,
  SheetComputedResult,
  SheetNodeData,
  LabelFormat,
  LabelNodeData,
  GroupNodeData,
  MatchNodeData,
  MatchPairRef,
  LynkNodeData,
  LynkNode,
} from './nodes';

// Node type aliases (types) and type guards (values) - declaration merging
export {
  DisplayNode,
  ViewportNode,
  ExtractorNode,
  CalculationNode,
  SheetNode,
  LabelNode,
  GroupNode,
  MatchNode,
} from './nodes';

// Canvas state
export type { CanvasMetadata, CanvasState } from './canvas';

// Node capabilities and categories
export { FileNode, SourceNode, CanExport, CanImport } from './categories';
export type { NodeOutput, Exportable, Importable, FileNodeData, SourceNodeData } from './categories';
