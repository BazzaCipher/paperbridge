import type { AiChatRequest, AiDetectedField, AiConnectionSuggestion, AiMessage, AiNodeContext, ProviderId, AiToolCall } from '../types/ai';
import { executeToolCall } from './ai/toolExecutor';
import type { OcrWord } from '../core/extraction/ocrExtractor';
import type { TableSelection } from '../core/extraction/tableMaterializer';

const API_URL = '/api/ai/chat';

/** Extract a JSON array from a model response that may include preamble text or markdown code fences */
function extractJsonArray<T = unknown>(content: string): T[] {
  // Try direct parse first (clean JSON)
  try {
    const parsed = JSON.parse(content.trim());
    if (Array.isArray(parsed)) return parsed;
    // Some models wrap in an object like { "fields": [...] }
    if (parsed && typeof parsed === 'object') {
      const values = Object.values(parsed);
      const arr = values.find((v) => Array.isArray(v));
      if (arr) return arr as T[];
    }
  } catch { /* fall through */ }

  // Try extracting from a markdown code block: ```json\n[...]\n```
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') {
        const values = Object.values(parsed);
        const arr = values.find((v) => Array.isArray(v));
        if (arr) return arr as T[];
      }
    } catch { /* fall through */ }
  }

  // Find the first '[' and last ']' and try to parse that slice
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(content.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }

  // Truncated JSON recovery: find last complete object in a cut-off array
  if (start !== -1) {
    const lastBrace = content.lastIndexOf('}');
    if (lastBrace > start) {
      try {
        const patched = content.slice(start, lastBrace + 1) + ']';
        const parsed = JSON.parse(patched);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch { /* fall through */ }
    }
  }

  throw new Error(`No JSON array found in response (length=${content.length}, preview=${content.slice(0, 200)})`);
}

interface AiResponse {
  content: string;
  toolCalls?: AiToolCall[];
}

async function callAiRaw(request: AiChatRequest): Promise<AiResponse> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `API error: ${res.status}`);
  }

  return res.json();
}

/** Stream AI text response, calling onChunk for each text delta */
async function callAiStream(
  request: AiChatRequest,
  onChunk: (text: string) => void,
  onToolCall?: (toolName: string) => void,
): Promise<{ text: string; toolCalls?: AiToolCall[] }> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, stream: true }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `API error: ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullText = '';
  let toolCalls: AiToolCall[] | undefined;
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'text') {
          fullText += parsed.text;
          onChunk(parsed.text);
        } else if (parsed.type === 'tool_calls') {
          toolCalls = parsed.toolCalls;
          for (const tc of parsed.toolCalls) {
            onToolCall?.(tc.name);
          }
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  return { text: fullText, toolCalls };
}

/** Call AI with automatic tool-call loop. Executes tools client-side until the model returns a text response. */
async function callAi(
  request: AiChatRequest,
  onToolCall?: (toolName: string) => void,
  maxRounds = 10
): Promise<string> {
  let messages = [...request.messages];
  let round = 0;

  while (round < maxRounds) {
    const response = await callAiRaw({ ...request, messages });

    if (!response.toolCalls?.length) {
      return response.content;
    }

    // Execute tools client-side
    const toolResults = await Promise.all(
      response.toolCalls.map(async (tc) => {
        onToolCall?.(tc.name);
        return executeToolCall(tc.id, tc.name, tc.arguments);
      })
    );

    // Append assistant message with tool calls, then tool results
    messages = [
      ...messages,
      {
        role: 'assistant' as const,
        content: response.content,
        toolCalls: response.toolCalls,
      },
      {
        role: 'tool_result' as const,
        content: '',
        toolResults: toolResults.map((tr) => ({
          toolCallId: tr.toolCallId,
          content: tr.content.map((c) => ({
            type: c.type,
            ...(c.type === 'text' ? { text: c.text } : { mimeType: c.mimeType, base64: c.base64 }),
          })),
        })),
      },
    ];

    round++;
  }

  throw new Error('Tool call loop exceeded maximum rounds');
}

export interface DetectFieldsOptions {
  /** Base64-encoded images to send directly (for small images) */
  images?: Array<{ mimeType: string; base64: string }>;
  /** OCR words with bounding boxes (fallback for large images) */
  ocrWords?: OcrWord[];
  /** Raw OCR text (legacy fallback) */
  ocrText?: string;
  /** User custom instructions to guide field detection */
  customInstructions?: string;
}

export async function detectFieldsWithAI(
  options: DetectFieldsOptions,
  provider: ProviderId,
  model: string,
  apiKey: string
): Promise<AiDetectedField[]> {
  const { images, ocrWords, ocrText, customInstructions } = options;

  let userContent = 'Detect all fields in this document. Be thorough — extract every field you can identify, including table rows as separate line items.';
  if (ocrWords?.length) {
    // Send structured OCR data with spatial info for better bbox computation
    const ocrData = ocrWords.map((w) => ({
      t: w.text,
      c: Math.round(w.confidence),
      b: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1],
    }));
    userContent += `\n\nOCR words (t=text, c=confidence, b=[x0,y0,x1,y1]):\n${JSON.stringify(ocrData)}`;
  }

  const content = await callAi({
    provider,
    model,
    apiKey,
    mode: 'detect_fields',
    ocrText: !images?.length ? ocrText : undefined,
    messages: [{ role: 'user', content: userContent }],
    images: images,
    customInstructions,
  });

  try {
    const fields = extractJsonArray<AiDetectedField>(content);
    if (!Array.isArray(fields)) throw new Error('Expected array');
    return fields;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse AI response as field data: ${msg}`);
  }
}

export interface DetectTableOptions {
  images?: Array<{ mimeType: string; base64: string }>;
  ocrWords?: OcrWord[];
  /** Optional bbox hint in normalized 0-1 page coords (user-drawn region). */
  hintBbox?: { x0: number; y0: number; x1: number; y1: number };
}

function extractJsonObject(content: string): Record<string, unknown> {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  let parsed = tryParse(content.trim());
  if (parsed) return parsed;
  const fence = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) {
    parsed = tryParse(fence[1].trim());
    if (parsed) return parsed;
  }
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start !== -1 && end > start) {
    parsed = tryParse(content.slice(start, end + 1));
    if (parsed) return parsed;
  }
  throw new Error('No JSON object found in AI response');
}

function validateTableSelection(raw: Record<string, unknown>): TableSelection {
  const bbox = raw.bbox as Record<string, number> | undefined;
  const colXs = raw.colXs as number[] | undefined;
  const rowYs = raw.rowYs as number[] | undefined;
  if (!bbox || typeof bbox.x0 !== 'number') throw new Error('Missing bbox');
  if (!Array.isArray(colXs) || !Array.isArray(rowYs)) throw new Error('Missing colXs/rowYs');
  const headerRowIndex = typeof raw.headerRowIndex === 'number' ? raw.headerRowIndex : undefined;
  return {
    bbox: { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 },
    colXs: [...colXs].sort((a, b) => a - b),
    rowYs: [...rowYs].sort((a, b) => a - b),
    headerRowIndex,
  };
}

export async function detectTableWithAI(
  options: DetectTableOptions,
  provider: ProviderId,
  model: string,
  apiKey: string,
): Promise<TableSelection> {
  const { images, ocrWords, hintBbox } = options;

  let userContent = 'Detect the spatial layout of the table in this image. The image IS the table region — return colXs and rowYs as fractions (0-1) of THIS image. Return ONLY the JSON object with bbox, rowYs, colXs, headerRowIndex. Do NOT include cell text.';
  if (hintBbox) {
    userContent += `\n\nUser-drawn region (normalized 0-1 of page): ${JSON.stringify(hintBbox)}. Constrain bbox to this region.`;
  }
  if (ocrWords?.length) {
    // Normalize OCR boxes to 0-1 of the crop using the first image's intrinsic dims if available,
    // otherwise pass pixels and tell the model so. Words are already in crop-pixel space.
    const maxX = ocrWords.reduce((m, w) => Math.max(m, w.bbox.x1), 0) || 1;
    const maxY = ocrWords.reduce((m, w) => Math.max(m, w.bbox.y1), 0) || 1;
    const ocrData = ocrWords.map((w) => ({
      b: [
        +(w.bbox.x0 / maxX).toFixed(4),
        +(w.bbox.y0 / maxY).toFixed(4),
        +(w.bbox.x1 / maxX).toFixed(4),
        +(w.bbox.y1 / maxY).toFixed(4),
      ],
    }));
    userContent += `\n\nOCR word boxes [x0,y0,x1,y1] normalized 0-1 of the crop (use these to verify alignment, place colXs in vertical gaps between word clusters):\n${JSON.stringify(ocrData)}`;
  }

  const content = await callAi({
    provider,
    model,
    apiKey,
    mode: 'detect_table',
    messages: [{ role: 'user', content: userContent }],
    images,
  });

  try {
    const obj = extractJsonObject(content);
    return validateTableSelection(obj);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse AI response as TableSelection: ${msg}`);
  }
}

export interface AskAIOptions {
  onChunk?: (text: string) => void;
  onToolCall?: (toolName: string) => void;
  stream?: boolean;
  /** User custom instructions to guide AI behavior */
  customInstructions?: string;
}

export async function askAI(
  question: string,
  ocrText: string | undefined,
  provider: ProviderId,
  model: string,
  apiKey: string,
  history: AiMessage[] = [],
  optionsOrOnToolCall?: AskAIOptions | ((toolName: string) => void),
): Promise<string> {
  // Support old signature (onToolCall callback) and new options object
  const opts: AskAIOptions = typeof optionsOrOnToolCall === 'function'
    ? { onToolCall: optionsOrOnToolCall }
    : optionsOrOnToolCall ?? {};

  const request: AiChatRequest = {
    provider,
    model,
    apiKey,
    mode: 'freeform',
    ocrText,
    messages: [...history, { role: 'user', content: question }],
    customInstructions: opts.customInstructions,
  };

  if (opts.stream && opts.onChunk) {
    const result = await callAiStream(request, opts.onChunk, opts.onToolCall);

    // If there were tool calls, execute them and continue the loop from where we left off
    if (result.toolCalls?.length) {
      const toolResults = await Promise.all(
        result.toolCalls.map(async (tc) => {
          opts.onToolCall?.(tc.name);
          return executeToolCall(tc.id, tc.name, tc.arguments);
        })
      );

      const continuedMessages: AiMessage[] = [
        ...request.messages,
        {
          role: 'assistant' as const,
          content: result.text,
          toolCalls: result.toolCalls,
        },
        {
          role: 'tool_result' as const,
          content: '',
          toolResults: toolResults.map((tr) => ({
            toolCallId: tr.toolCallId,
            content: tr.content.map((c) => ({
              type: c.type,
              ...(c.type === 'text' ? { text: c.text } : { mimeType: c.mimeType, base64: c.base64 }),
            })),
          })),
        },
      ];

      return callAi({ ...request, messages: continuedMessages }, opts.onToolCall);
    }

    return result.text;
  }

  return callAi(request, opts.onToolCall);
}

export async function autoConnectWithAI(
  nodesContext: AiNodeContext[],
  provider: ProviderId,
  model: string,
  apiKey: string
): Promise<AiConnectionSuggestion[]> {
  const content = await callAi({
    provider,
    model,
    apiKey,
    mode: 'auto_connect',
    nodesContext,
    messages: [{ role: 'user', content: 'Analyse these nodes and suggest connections between matching fields.' }],
  });

  try {
    const suggestions = extractJsonArray<AiConnectionSuggestion>(content);
    if (!Array.isArray(suggestions)) throw new Error('Expected array');
    return suggestions;
  } catch {
    throw new Error('Failed to parse AI connection suggestions');
  }
}

export async function summariseWithAI(
  ocrText: string | undefined,
  nodesContext: AiNodeContext[] | undefined,
  provider: ProviderId,
  model: string,
  apiKey: string
): Promise<string> {
  return callAi({
    provider,
    model,
    apiKey,
    mode: 'summarise',
    ocrText,
    nodesContext,
    messages: [{ role: 'user', content: 'Summarise the documents and fields on this canvas.' }],
  });
}

/** Verify an API key by making a minimal request */
export async function verifyApiKey(
  provider: ProviderId,
  model: string,
  apiKey: string
): Promise<boolean> {
  try {
    await callAiRaw({
      provider,
      model,
      apiKey,
      mode: 'freeform',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    return true;
  } catch {
    return false;
  }
}
