/**
 * Extracted Region Types
 *
 * Defines the structure for regions extracted from documents,
 * including their selection type, data, and visual properties.
 */

import type { DataValue, SimpleDataType } from './data';
import type { RegionCoordinates, TextRange, SelectionType } from './geometry';

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
}
