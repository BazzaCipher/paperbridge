/**
 * Geometry & Selection Types
 *
 * Defines spatial coordinates, text ranges, selection types,
 * and data provenance tracking.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SPATIAL COORDINATES
// ═══════════════════════════════════════════════════════════════════════════════

/** Region coordinates for box selections */
export interface RegionCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT SELECTION
// ═══════════════════════════════════════════════════════════════════════════════

/** Text range for text selections */
export interface TextRange {
  startOffset: number;
  endOffset: number;
  text: string;
  /** Bounding rectangles for visual highlighting */
  rects: RegionCoordinates[];
}

/** Selection mode types */
export type SelectionType = 'box' | 'text';

// ═══════════════════════════════════════════════════════════════════════════════
// DATA PROVENANCE
// ═══════════════════════════════════════════════════════════════════════════════

/** Source tracking for data provenance */
export interface DataSourceReference {
  nodeId: string;
  regionId: string;
  pageNumber?: number;
  coordinates?: RegionCoordinates;
  textRange?: TextRange;
  extractionMethod: 'manual' | 'ocr' | 'ai';
  confidence?: number;
}
