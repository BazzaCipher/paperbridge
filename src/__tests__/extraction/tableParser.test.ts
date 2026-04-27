import { describe, it, expect } from 'vitest';
import { parseTableFromOcr } from '../../core/extraction/tableParser';
import type { FullPageOcrResult, OcrLine, OcrWord } from '../../core/extraction/ocrExtractor';

function word(text: string, x0: number, y0: number): OcrWord {
  return {
    text,
    confidence: 95,
    bbox: { x0, y0, x1: x0 + text.length * 8, y1: y0 + 14 },
  };
}

function line(words: OcrWord[]): OcrLine {
  const x0 = Math.min(...words.map((w) => w.bbox.x0));
  const x1 = Math.max(...words.map((w) => w.bbox.x1));
  const y0 = Math.min(...words.map((w) => w.bbox.y0));
  const y1 = Math.max(...words.map((w) => w.bbox.y1));
  return {
    text: words.map((w) => w.text).join(' '),
    confidence: 95,
    bbox: { x0, y0, x1, y1 },
    words,
  };
}

function ocr(lines: OcrLine[]): FullPageOcrResult {
  return {
    text: lines.map((l) => l.text).join('\n'),
    confidence: 95,
    lines,
    words: lines.flatMap((l) => l.words),
    imageWidth: 800,
    imageHeight: 600,
  };
}

describe('parseTableFromOcr', () => {
  it('detects columns by x-alignment and uses first row as header', () => {
    const input = ocr([
      line([word('Date', 10, 0), word('Ref', 110, 0), word('Amount', 210, 0)]),
      line([word('01/15', 10, 20), word('INV-01', 110, 20), word('150.00', 210, 20)]),
      line([word('01/16', 10, 40), word('INV-02', 110, 40), word('200.00', 210, 40)]),
    ]);
    const table = parseTableFromOcr(input);
    expect(table.headerDetected).toBe(true);
    expect(table.headers).toEqual(['Date', 'Ref', 'Amount']);
    expect(table.rows).toEqual([
      ['01/15', 'INV-01', '150.00'],
      ['01/16', 'INV-02', '200.00'],
    ]);
  });

  it('falls back to synthesised headers when first row looks numeric', () => {
    const input = ocr([
      line([word('1.00', 10, 0), word('2.00', 110, 0), word('3.00', 210, 0)]),
      line([word('4.00', 10, 20), word('5.00', 110, 20), word('6.00', 210, 20)]),
    ]);
    const table = parseTableFromOcr(input);
    expect(table.headerDetected).toBe(false);
    expect(table.headers).toEqual(['Column 1', 'Column 2', 'Column 3']);
    expect(table.rows.length).toBe(2);
  });

  it('joins words into one cell when their x-starts fall within tolerance', () => {
    const input = ocr([
      line([word('Item', 10, 0), word('Price', 210, 0)]),
      line([word('Wireless', 10, 20), word('Mouse', 25, 20), word('29.99', 210, 20)]),
    ]);
    const table = parseTableFromOcr(input, { columnTolerance: 30 });
    expect(table.headers).toEqual(['Item', 'Price']);
    expect(table.rows[0]).toEqual(['Wireless Mouse', '29.99']);
  });
});
