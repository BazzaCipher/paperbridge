import Tesseract from 'tesseract.js';
import type { DataValue, RegionCoordinates } from '../../types';

let worker: Tesseract.Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const IDLE_TIMEOUT_MS = 60_000;

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleCleanup(): void {
  clearIdleTimer();
  idleTimer = setTimeout(() => terminateWorker(), IDLE_TIMEOUT_MS);
}

async function getWorker(): Promise<Tesseract.Worker> {
  clearIdleTimer();
  if (!worker) {
    worker = await Tesseract.createWorker('eng');
  }
  return worker;
}

export async function terminateWorker(): Promise<void> {
  clearIdleTimer();
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

interface ExtractionResult {
  text: string;
  confidence: number;
  dataValue: DataValue;
}

function parseExtractedText(text: string): DataValue {
  const trimmed = text.trim();

  // Try to parse as number
  const numberValue = parseFloat(trimmed.replace(/[,$]/g, ''));
  if (!isNaN(numberValue) && trimmed.match(/^[$]?[\d,]+\.?\d*$/)) {
    return {
      type: 'number',
      value: numberValue,
    };
  }

  // Try to parse as date
  const datePatterns = [
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    /^\d{4}-\d{2}-\d{2}$/,
    /^[A-Za-z]+ \d{1,2}, \d{4}$/,
  ];
  for (const pattern of datePatterns) {
    if (pattern.test(trimmed)) {
      const date = new Date(trimmed);
      if (!isNaN(date.getTime())) {
        return {
          type: 'date',
          value: date,
        };
      }
    }
  }

  // Default to string
  return {
    type: 'string',
    value: trimmed,
  };
}

export async function extractTextFromRegion(
  imageSource: HTMLImageElement | HTMLCanvasElement | string,
  region: RegionCoordinates
): Promise<ExtractionResult> {
  const tesseractWorker = await getWorker();

  // Create a canvas to crop the region
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Load image if string URL provided
  let img: HTMLImageElement | HTMLCanvasElement;
  if (typeof imageSource === 'string') {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load image for OCR'));
      image.src = imageSource;
    });
  } else {
    img = imageSource;
  }

  // Set canvas size to region size
  canvas.width = region.width;
  canvas.height = region.height;

  // Draw cropped region to canvas
  ctx.drawImage(
    img,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height
  );

  // Run OCR on the cropped region
  const result = await tesseractWorker.recognize(canvas);
  const text = result.data.text;
  const confidence = result.data.confidence;

  const dataValue = parseExtractedText(text);

  scheduleIdleCleanup();

  return {
    text,
    confidence,
    dataValue: {
      ...dataValue,
      source: undefined, // Source will be added by the caller
    },
  };
}

/**
 * Full-page OCR on a cropped rectangular region of the source image.
 * Used by table-mode extraction where a user lasso'd a tabular area.
 */
export async function extractFullPageFromRegion(
  imageSource: HTMLImageElement | HTMLCanvasElement | string,
  region: RegionCoordinates,
): Promise<FullPageOcrResult> {
  let img: HTMLImageElement | HTMLCanvasElement;
  if (typeof imageSource === 'string') {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load image for OCR'));
      image.src = imageSource;
    });
  } else {
    img = imageSource;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  canvas.width = region.width;
  canvas.height = region.height;
  ctx.drawImage(
    img,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );
  return extractFullPage(canvas);
}

export async function extractTextFromPdfPage(
  pdfCanvas: HTMLCanvasElement,
  region: RegionCoordinates
): Promise<ExtractionResult> {
  return extractTextFromRegion(pdfCanvas, region);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL PAGE OCR
// ═══════════════════════════════════════════════════════════════════════════════

/** Word detected by OCR with bounding box */
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Line detected by OCR with bounding box */
export interface OcrLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: OcrWord[];
}

/** Result of full-page OCR extraction */
export interface FullPageOcrResult {
  text: string;
  confidence: number;
  words: OcrWord[];
  lines: OcrLine[];
  imageWidth: number;
  imageHeight: number;
}

/**
 * Extract all text from an entire page/image using OCR.
 * Returns words and lines with their bounding boxes for field detection.
 */
export async function extractFullPage(
  imageSource: HTMLImageElement | HTMLCanvasElement | string
): Promise<FullPageOcrResult> {
  const tesseractWorker = await getWorker();

  // Load image if string URL provided
  let img: HTMLImageElement | HTMLCanvasElement;
  if (typeof imageSource === 'string') {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load image for OCR'));
      image.src = imageSource;
    });
  } else {
    img = imageSource;
  }

  // Get image dimensions
  const imageWidth = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const imageHeight = img instanceof HTMLImageElement ? img.naturalHeight : img.height;

  // Run OCR on the full image
  const result = await tesseractWorker.recognize(img);

  // Tesseract structure: Page -> blocks[] -> paragraphs[] -> lines[] -> words[]
  // Flatten the hierarchy to get all words and lines
  const words: OcrWord[] = [];
  const lines: OcrLine[] = [];

  if (result.data.blocks) {
    for (const block of result.data.blocks) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          // Collect line with its words
          const lineWords: OcrWord[] = line.words.map((word) => ({
            text: word.text,
            confidence: word.confidence,
            bbox: {
              x0: word.bbox.x0,
              y0: word.bbox.y0,
              x1: word.bbox.x1,
              y1: word.bbox.y1,
            },
          }));

          lines.push({
            text: line.text,
            confidence: line.confidence,
            bbox: {
              x0: line.bbox.x0,
              y0: line.bbox.y0,
              x1: line.bbox.x1,
              y1: line.bbox.y1,
            },
            words: lineWords,
          });

          // Also add to flat words array
          words.push(...lineWords);
        }
      }
    }
  }

  scheduleIdleCleanup();

  return {
    text: result.data.text,
    confidence: result.data.confidence,
    words,
    lines,
    imageWidth,
    imageHeight,
  };
}
