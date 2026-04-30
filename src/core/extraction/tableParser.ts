/**
 * Heuristic table extraction. Produces a `TableSelection` from OCR clusters,
 * then materializes it via `materializeTable`. The non-AI fallback for
 * table-mode extraction.
 */

import type { FullPageOcrResult, OcrLine } from './ocrExtractor';
import {
  materializeTable,
  type TableSelection,
} from './tableMaterializer';
import { debug } from '../../utils/debug'; // see src/utils/debug.ts

const log = debug('table');

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  /** Whether the first OCR line was used as headers (vs synthesised). */
  headerDetected: boolean;
}

const DEFAULT_COLUMN_TOLERANCE_PX = 20;

// Matches common bank-statement date formats: 12/03, 12/03/2025, 12-03-25,
// 12 Mar, 12 Mar 2025, Mar 12, Mar 12 2025.
const MONTHS = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const DATE_RE = new RegExp(
  `(?:\\b\\d{1,2}[\\/\\-.]\\d{1,2}(?:[\\/\\-.]\\d{2,4})?\\b)` +
    `|(?:\\b\\d{1,2}\\s+${MONTHS}\\b)` +
    `|(?:\\b${MONTHS}\\s+\\d{1,2}\\b)`,
  'i',
);

function clusterX(positions: number[], tolerance: number): number[] {
  if (positions.length === 0) return [];
  const sorted = [...positions].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = clusters[clusters.length - 1];
    const lastVal = last[last.length - 1];
    if (sorted[i] - lastVal <= tolerance) last.push(sorted[i]);
    else clusters.push([sorted[i]]);
  }
  return clusters.map((c) => c.reduce((s, v) => s + v, 0) / c.length);
}

function midpoints(values: number[]): number[] {
  const seps: number[] = [];
  for (let i = 1; i < values.length; i++) {
    seps.push((values[i - 1] + values[i]) / 2);
  }
  return seps;
}

function looksLikeHeader(cells: string[]): boolean {
  const nonEmpty = cells.filter((c) => c.length > 0);
  if (nonEmpty.length === 0) return false;
  const numeric = nonEmpty.filter((c) => /^[$€£]?[\d,.\s-]+%?$/.test(c.trim())).length;
  return numeric / nonEmpty.length < 0.4;
}

export interface ParseTableOptions {
  columnTolerance?: number;
  /** Optional filter: only include lines whose y-center falls in this range. */
  yRange?: { min: number; max: number };
}

/**
 * Build a `TableSelection` from OCR clusters. Public so the table flow can
 * persist the selection (for draggable separators) and re-materialize.
 */
export function buildTableSelectionFromOcr(
  ocr: FullPageOcrResult,
  options: ParseTableOptions = {},
): { selection: TableSelection; lines: OcrLine[]; headerDetected: boolean } | null {
  const tolerance = options.columnTolerance ?? DEFAULT_COLUMN_TOLERANCE_PX;
  const yRange = options.yRange;

  const candidateLines = ocr.lines.filter((l) => {
    if (l.words.length === 0) return false;
    if (!yRange) return true;
    const yc = (l.bbox.y0 + l.bbox.y1) / 2;
    return yc >= yRange.min && yc <= yRange.max;
  });

  if (candidateLines.length === 0) {
    log('null', { reason: 'no candidate lines', totalLines: ocr.lines.length, yRange });
    return null;
  }

  const allStarts: number[] = [];
  for (const line of candidateLines) {
    for (const w of line.words) allStarts.push(w.bbox.x0);
  }
  const xAnchors = clusterX(allStarts, tolerance);
  if (xAnchors.length === 0) {
    log('null', { reason: 'no x anchors', candidateLines: candidateLines.length });
    return null;
  }

  const lineCenters = candidateLines
    .map((l) => (l.bbox.y0 + l.bbox.y1) / 2)
    .sort((a, b) => a - b);

  // Group lines into rows: a new row starts on every line whose text contains
  // a date. Continuation lines (no date) merge into the previous row's range.
  // Bank statements often wrap a long description over 2-3 lines; without this
  // each wrap was emitted as its own row.
  const dateBearing = candidateLines
    .filter((l) => DATE_RE.test(l.words.map((w) => w.text).join(' ')))
    .map((l) => (l.bbox.y0 + l.bbox.y1) / 2)
    .sort((a, b) => a - b);
  const rowAnchors = dateBearing.length >= 2 ? dateBearing : lineCenters;

  const W = ocr.imageWidth || 1;
  const H = ocr.imageHeight || 1;

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const l of candidateLines) {
    for (const w of l.words) {
      if (w.bbox.x0 < xMin) xMin = w.bbox.x0;
      if (w.bbox.x1 > xMax) xMax = w.bbox.x1;
      if (w.bbox.y0 < yMin) yMin = w.bbox.y0;
      if (w.bbox.y1 > yMax) yMax = w.bbox.y1;
    }
  }

  // Pad the bbox slightly so word centers near the edge fall inside.
  const padX = (xMax - xMin) * 0.02 + 1;
  const padY = (yMax - yMin) * 0.02 + 1;
  xMin = Math.max(0, xMin - padX);
  yMin = Math.max(0, yMin - padY);
  xMax = Math.min(W, xMax + padX);
  yMax = Math.min(H, yMax + padY);

  // Provisional materialization to decide header.
  const provisional: TableSelection = {
    bbox: { x0: xMin / W, y0: yMin / H, x1: xMax / W, y1: yMax / H },
    colXs: midpoints(xAnchors).map((x) => x / W),
    rowYs: midpoints(rowAnchors).map((y) => y / H),
  };

  const provisionalTable = materializeTable(provisional, ocr);
  const detected = looksLikeHeader(provisionalTable.rows[0] ?? []);
  const selection: TableSelection = detected
    ? { ...provisional, headerRowIndex: 0 }
    : provisional;

  log('built', {
    cols: provisional.colXs.length + 1,
    rows: provisional.rowYs.length + 1,
    headerDetected: detected,
  });

  return { selection, lines: candidateLines, headerDetected: detected };
}

export function parseTableFromOcr(
  ocr: FullPageOcrResult,
  options: ParseTableOptions = {},
): ParsedTable {
  const built = buildTableSelectionFromOcr(ocr, options);
  if (!built) return { headers: [], rows: [], headerDetected: false };

  const table = materializeTable(built.selection, ocr);
  const rows = table.rows.filter((r) => r.some((c) => c.length > 0));
  return {
    headers: table.headers,
    rows,
    headerDetected: built.headerDetected,
  };
}
