/**
 * Pure table reconstruction from OCR words + a spatial selection.
 *
 * The selection (bbox + row/column separators in normalized 0-1 page coords)
 * is provided either by an AI step or by the heuristic in `tableParser`.
 * This module does the bookkeeping: bucket each OCR word into a (row, col)
 * cell and concatenate in reading order.
 */

import type { FullPageOcrResult, OcrWord } from './ocrExtractor';

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TableSelection {
  /** Normalized 0-1 of page (x0/y0 top-left, x1/y1 bottom-right). */
  bbox: BBox;
  /** Sorted between-row separators in normalized y (exclusive of bbox edges). */
  rowYs: number[];
  /** Sorted between-col separators in normalized x (exclusive of bbox edges). */
  colXs: number[];
  /** Index into the resulting rows array that should be treated as headers. */
  headerRowIndex?: number;
}

export interface MaterializedTable {
  headers: string[];
  rows: string[][];
  /** Pixel-space cell boxes, indexed [rowIndex][colIndex]. */
  cellBoxes: BBox[][];
}

export interface PageSize {
  width: number;
  height: number;
}

function denorm(values: number[], scale: number): number[] {
  return values.map((v) => v * scale);
}

function bucket(value: number, separators: number[]): number {
  for (let i = 0; i < separators.length; i++) {
    if (value < separators[i]) return i;
  }
  return separators.length;
}

function wordCenter(w: OcrWord): { x: number; y: number } {
  return {
    x: (w.bbox.x0 + w.bbox.x1) / 2,
    y: (w.bbox.y0 + w.bbox.y1) / 2,
  };
}

/**
 * Reconstruct a table from OCR words and a spatial selection.
 *
 * Coordinates in `selection` are normalized 0-1 of the page; OCR word bboxes
 * are in pixel space against `pageSize`.
 */
export function materializeTable(
  selection: TableSelection,
  ocr: FullPageOcrResult,
  pageSize?: PageSize,
): MaterializedTable {
  const W = pageSize?.width ?? ocr.imageWidth;
  const H = pageSize?.height ?? ocr.imageHeight;

  const px = {
    x0: selection.bbox.x0 * W,
    y0: selection.bbox.y0 * H,
    x1: selection.bbox.x1 * W,
    y1: selection.bbox.y1 * H,
  };
  const colSeps = denorm(selection.colXs, W);
  const rowSeps = denorm(selection.rowYs, H);

  const numCols = colSeps.length + 1;
  const numRows = rowSeps.length + 1;

  // Build cell column ranges (xL, xR) and row ranges (yT, yB) for cellBoxes.
  const colEdges = [px.x0, ...colSeps, px.x1];
  const rowEdges = [px.y0, ...rowSeps, px.y1];

  const cells: OcrWord[][][] = Array.from({ length: numRows }, () =>
    Array.from({ length: numCols }, () => []),
  );

  for (const w of ocr.words) {
    const c = wordCenter(w);
    if (c.x < px.x0 || c.x > px.x1 || c.y < px.y0 || c.y > px.y1) continue;
    const col = bucket(c.x, colSeps);
    const row = bucket(c.y, rowSeps);
    cells[row][col].push(w);
  }

  const allRows: string[][] = cells.map((rowCells) =>
    rowCells.map((words) =>
      words
        .slice()
        .sort((a, b) => a.bbox.x0 - b.bbox.x0)
        .map((w) => w.text)
        .join(' ')
        .trim(),
    ),
  );

  const cellBoxes: BBox[][] = Array.from({ length: numRows }, (_, r) =>
    Array.from({ length: numCols }, (_, c) => ({
      x0: colEdges[c],
      y0: rowEdges[r],
      x1: colEdges[c + 1],
      y1: rowEdges[r + 1],
    })),
  );

  let headers: string[];
  let rows: string[][];
  let cellRowBoxes: BBox[][];
  if (selection.headerRowIndex !== undefined && allRows[selection.headerRowIndex]) {
    headers = allRows[selection.headerRowIndex].map((h, i) => h || `Column ${i + 1}`);
    rows = allRows.filter((_, i) => i !== selection.headerRowIndex);
    cellRowBoxes = cellBoxes.filter((_, i) => i !== selection.headerRowIndex);
  } else {
    headers = Array.from({ length: numCols }, (_, i) => `Column ${i + 1}`);
    rows = allRows;
    cellRowBoxes = cellBoxes;
  }

  return { headers, rows, cellBoxes: cellRowBoxes };
}
