/**
 * Extracted Region Types
 *
 * Defines the structure for regions extracted from documents,
 * including their selection type, data, and visual properties.
 */

import type { DataValue, SimpleDataType } from './data';
import type { RegionCoordinates, TextRange, SelectionType } from './geometry';
import type { TableSelection } from '../core/extraction/tableMaterializer';

// ═══════════════════════════════════════════════════════════════════════════════
// FIELD DETECTION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Types of fields that can be auto-detected from documents */
export type FieldType =
  | 'invoice_number'
  | 'date'
  | 'total_amount'
  | 'subtotal'
  | 'tax'
  | 'name'
  | 'address'
  | 'phone'
  | 'email'
  | 'currency_amount'
  | 'unknown';

/** A field detected by auto-detection OCR */
export interface DetectedField {
  text: string;
  confidence: number;
  bbox: RegionCoordinates;
  fieldType: FieldType;
  label: string;
  dataType: SimpleDataType;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACTED REGIONS
// ═══════════════════════════════════════════════════════════════════════════════


/** Extracted region from a file node */
export interface ExtractedRegion {
  id: string;
  label: string;
  selectionType: SelectionType;
  /** For box selections */
  coordinates?: RegionCoordinates;
  /** For text selections */
  textRange?: TextRange;
  pageNumber: number;
  extractedData: DataValue;
  /** User-specified data type */
  dataType: SimpleDataType;
  color: string;
  /** Cached values per data type */
  valueCache?: Partial<Record<SimpleDataType, string>>;
  /** If this region was emitted as a row of a materialized table, links back to its TableRecord. */
  tableSourceId?: string;
  /** Row index within the parent table (excluding header). 0-based. */
  tableRowIndex?: number;
  /** Per-column cell values for user-defined columns (reconciliation). */
  cells?: Record<string, string>;
}

/** User-defined column on an ExtractorNode ledger table */
export interface ExtractorColumn {
  id: string;
  label: string;
  dataType: SimpleDataType;
  width?: number;
}

/**
 * Persistent record of a materialized table region. The user-drawn page bbox plus
 * the spatial separators that produced the rows. Stored on the ExtractorNode and
 * survives reload, so row edges remain draggable after re-opening a canvas.
 */
export interface TableRecord {
  id: string;
  pageNumber: number;
  /** User-drawn bbox in page pixel space. */
  pageBbox: RegionCoordinates;
  /** Pixel size of the OCR crop (matches pageBbox width/height). */
  pageSize: { width: number; height: number };
  selection: TableSelection;
  /** If this table was detected as a bank statement, points to a TxnGroup in `txnGroupSlice`. */
  txnGroupId?: string;
}
