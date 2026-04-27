import { describe, it, expect } from 'vitest';
import {
  materializeTable,
  type TableSelection,
} from '../../core/extraction/tableMaterializer';
import type { FullPageOcrResult, OcrWord } from '../../core/extraction/ocrExtractor';

function word(text: string, x0: number, y0: number, w = 60, h = 14): OcrWord {
  return {
    text,
    confidence: 95,
    bbox: { x0, y0, x1: x0 + w, y1: y0 + h },
  };
}

function ocr(words: OcrWord[], imageWidth = 1000, imageHeight = 1000): FullPageOcrResult {
  return {
    text: words.map((w) => w.text).join(' '),
    confidence: 95,
    words,
    lines: [],
    imageWidth,
    imageHeight,
  };
}

describe('materializeTable', () => {
  const selection: TableSelection = {
    bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    colXs: [0.33, 0.66],
    rowYs: [0.25, 0.5, 0.75],
    headerRowIndex: 0,
  };

  it('buckets words into the right cells and uses headerRowIndex', () => {
    const result = materializeTable(
      selection,
      ocr([
        word('Date', 50, 50),
        word('Ref', 400, 50),
        word('Amount', 750, 50),
        word('01/15', 50, 300),
        word('INV-01', 400, 300),
        word('150.00', 750, 300),
        word('01/16', 50, 550),
        word('INV-02', 400, 550),
        word('200.00', 750, 550),
      ]),
    );
    expect(result.headers).toEqual(['Date', 'Ref', 'Amount']);
    expect(result.rows).toEqual([
      ['01/15', 'INV-01', '150.00'],
      ['01/16', 'INV-02', '200.00'],
      ['', '', ''],
    ]);
  });

  it('joins multiple words in the same cell in reading order', () => {
    const result = materializeTable(
      { ...selection, headerRowIndex: undefined, rowYs: [0.5] },
      ocr([
        word('Wireless', 50, 200),
        word('Mouse', 150, 200),
        word('29.99', 750, 200),
      ]),
    );
    expect(result.headers).toEqual(['Column 1', 'Column 2', 'Column 3']);
    expect(result.rows[0]).toEqual(['Wireless Mouse', '', '29.99']);
  });

  it('ignores words whose centers fall outside the bbox', () => {
    const result = materializeTable(
      {
        bbox: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 },
        colXs: [0.5],
        rowYs: [0.5],
      },
      ocr([
        word('inside', 400, 400),
        word('outside', 950, 950),
      ]),
    );
    expect(result.rows.flat()).toContain('inside');
    expect(result.rows.flat()).not.toContain('outside');
  });
});
