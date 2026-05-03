import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateText, streamText, tool, Output } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface AiContentPart {
  type: 'text' | 'image';
  text?: string;
  mimeType?: string;
  base64?: string;
}

interface AiToolResult {
  toolCallId: string;
  content: AiContentPart[];
}

interface ChatRequestBody {
  provider: string;
  model: string;
  apiKey: string;
  mode: 'detect_fields' | 'detect_table' | 'extract_table' | 'freeform' | 'auto_connect' | 'summarise';
  ocrText?: string;
  nodesContext?: Array<{
    nodeId: string;
    nodeType: string;
    label: string;
    fields: Array<{ id: string; label: string; dataType: string; value?: string }>;
  }>;
  messages: Array<{
    role: 'user' | 'assistant' | 'tool_result';
    content: string;
    toolCalls?: AiToolCall[];
    toolResults?: AiToolResult[];
  }>;
  images?: Array<{ mimeType: string; base64: string }>;
  tools?: string[];
  stream?: boolean;
  customInstructions?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/** Create a provider-specific model instance with the user's API key */
export function resolveModel(provider: string, model: string, apiKey: string) {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(model);
    case 'openai':
      return createOpenAI({ apiKey })(model);
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey })(model);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS (AI SDK format)
// ═══════════════════════════════════════════════════════════════════════════════

const TOOL_DEFS = {
  get_canvas_graph: tool({
    description:
      'Get the simplified canvas graph: all nodes (id, type, label, fields summary) and edges (source→target with handles). Use this to understand the current document processing layout.',
    inputSchema: z.object({}),
  }),

  get_node_details: tool({
    description:
      'Get full details for a specific node: regions with coordinates, extracted values, data types, and confidence scores.',
    inputSchema: z.object({
      nodeId: z.string().describe('The node ID to get details for'),
    }),
  }),

  get_file_list: tool({
    description:
      'Get the list of files in the project: name, MIME type, size, and associated node ID.',
    inputSchema: z.object({}),
  }),

  get_file_content: tool({
    description:
      "Get a file's content. Returns the file as a base64 image (for images) or OCR text (for PDFs). Use this to visually inspect documents.",
    inputSchema: z.object({
      fileId: z.string().describe('The file ID to retrieve'),
    }),
  }),

  suggest_connection: tool({
    description: 'Propose a connection between two nodes on the canvas.',
    inputSchema: z.object({
      sourceNodeId: z.string().describe('Source node ID'),
      sourceFieldId: z.string().describe('Source field/region ID (used as output handle)'),
      targetNodeId: z.string().describe('Target node ID'),
      targetHandle: z.string().describe('Target handle name (e.g. "inputs" for calculation nodes, "input" for label nodes)'),
      reason: z.string().describe('Brief reason for this connection'),
    }),
  }),

  create_region: tool({
    description: 'Create an extraction region on an extractor node to extract a field from the document.',
    inputSchema: z.object({
      nodeId: z.string().describe('Extractor node ID'),
      x: z.number().describe('X coordinate (pixels from left)'),
      y: z.number().describe('Y coordinate (pixels from top)'),
      width: z.number().describe('Region width in pixels'),
      height: z.number().describe('Region height in pixels'),
      label: z.string().describe('Human-readable label for the field'),
      dataType: z.string().describe('Data type: "string", "number", "date", "currency", or "boolean"'),
    }),
  }),
};

type ToolName = keyof typeof TOOL_DEFS;

export function getTools(names?: string[]) {
  if (!names?.length) return TOOL_DEFS;
  const result: Partial<typeof TOOL_DEFS> = {};
  for (const name of names) {
    if (name in TOOL_DEFS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[name] = TOOL_DEFS[name as ToolName];
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

const FIELD_DETECTION_SYSTEM_PROMPT = `You are a document field extraction assistant. You may receive a document image directly (use your vision to read it) or OCR text/word data. Identify all key fields and their values from whatever input is provided.

Return ONLY a JSON array of detected fields. Each field must have:
- "text": the extracted value as a string
- "confidence": 0-1 confidence score
- "fieldType": one of "invoice_number", "date", "total_amount", "subtotal", "tax", "name", "address", "phone", "email", "currency_amount", "line_item", "quantity", "unit_price", "description", "payment_terms", "due_date", "account_number", "reference", "unknown"
- "label": a human-readable label for the field
- "dataType": one of "string", "number", "date", "currency", "boolean"
- "bbox": (when OCR word data with bounding boxes is provided) approximate bounding box as {"x": number, "y": number, "width": number, "height": number} in pixels — group nearby words that form one value into a single bbox

When OCR word data with bounding boxes is provided:
1. Use spatial relationships: labels are typically left-of or above their values
2. Group words on the same line into coherent phrases
3. Identify table structures by detecting aligned columns
4. For each field, compute a bounding box that tightly covers the VALUE (not the label)
5. Use word confidence scores to inform your field-level confidence

Be thorough — extract ALL identifiable fields including line items in tables, dates, amounts, names, addresses, reference numbers, payment terms, and any labeled key-value pairs. For tables, extract each row as separate line_item entries.`;

const TABLE_DETECTION_SYSTEM_PROMPT = `You are a table layout analyzer. You receive a document image (and optional OCR words) containing a table. Return ONLY the SPATIAL layout of the table — DO NOT emit any cell text.

Output strictly this JSON shape:
{
  "bbox": { "x0": number, "y0": number, "x1": number, "y1": number },
  "rowYs": number[],
  "colXs": number[],
  "headerRowIndex": number | null
}

All coordinates are normalized 0-1 of the page (x: left=0, right=1; y: top=0, bottom=1).
- bbox: tight rectangle covering the table.
- colXs: between-column vertical separators inside bbox, sorted ascending. N columns => N-1 entries.
- rowYs: between-row horizontal separators inside bbox, sorted ascending. N rows => N-1 entries.
- headerRowIndex: zero-based index of the header row in the resulting rows (typically 0), or null if no header.

Rules:
- Do NOT include cell text. Only spatial separators.
- Separators must be strictly inside bbox (not at the edges).
- Exclude page margins, page numbers, and footers from bbox.

Return ONLY the JSON object, no prose.`;

const TABLE_EXTRACTION_SYSTEM_PROMPT = `You are a table extraction engine. You receive a document image (typically a bank statement table) and must read every cell directly from the image, using your visual understanding rather than relying on any provided OCR.

Output strictly this JSON shape:
{
  "bbox": { "x0": number, "y0": number, "x1": number, "y1": number },
  "rowYs": number[],
  "colXs": number[],
  "headerRowIndex": number | null,
  "cells": string[][]
}

Coordinates are normalized 0-1 of the input image (x: left=0, right=1; y: top=0, bottom=1).
- bbox: tight rectangle around the table.
- colXs: between-column separators (N columns => N-1 entries), sorted.
- rowYs: between-row separators (M rows => M-1 entries), sorted.
- headerRowIndex: zero-based row index of the header row, or null.
- cells: M rows x N columns of strings. Row order matches rowYs (top-to-bottom). Column order matches colXs (left-to-right). INCLUDE the header row at headerRowIndex.

Rules:
- Read the text from the IMAGE. The OCR may be garbled — trust your visual reading over any provided text.
- Bank statements typically have columns: Date, Particulars/Description, Debit, Credit, Balance. Capture all of them.
- Preserve numeric formatting (commas, decimals, signs, parens for negatives, trailing CR/DR).
- Empty cells are "" (empty string), not null.
- Every row must have exactly colXs.length+1 cells.
- Exclude page margins, page numbers, footers from bbox.

Row grouping — IMPORTANT for bank statements:
- Emit ONE row per LOGICAL transaction, not one row per visual line. A single transaction commonly spans 2-5 visual lines (e.g. "Internet Transfer" / "X Li12345" / "Ref ABC" / "20.00").
- A new logical row starts when EITHER a new date appears in the Date column, OR a new amount appears in the Debit/Credit column with no prior amount on the current logical row.
- Continuation lines (no date, no debit, no credit) belong to the prior logical row — JOIN their description text into the prior row's Particulars cell, separated by " " or "\n".
- rowYs separators must align with these LOGICAL row boundaries, not every visual line. So if 3 visual lines belong to one transaction, do NOT put rowYs separators between them.
- The opening "Brought forward" line and closing balance line each count as their own logical row.

Return ONLY the JSON object, no prose.`;

const FREEFORM_SYSTEM_PROMPT = `You are a helpful assistant for a document processing application called Paper Bridge. You help users understand their document data and set up extraction fields on their documents.

When answering questions about document content:
- Focus on the actual data and its business meaning: totals, dates, parties involved, what the document is for
- Be concise and reference specific values from the documents when possible

When asked to extract, highlight, or create fields:
- Use get_file_content to visually inspect the document and identify where the field appears
- Use get_canvas_graph to find the correct extractor node ID
- Use create_region with accurate pixel coordinates (x, y, width, height) to create the extraction region
- After creating, confirm which field was created and on which document

When asked to connect fields between nodes:
- Use get_canvas_graph to understand the current layout
- Use suggest_connection to wire source fields to target nodes

You have access to tools that let you inspect files, view document content, and understand the canvas layout. Use them proactively — do not ask the user for information you can look up with a tool.`;

const AUTO_CONNECT_SYSTEM_PROMPT = `You are a document processing assistant that analyses extracted fields across multiple document nodes and suggests connections between them.

Given a list of nodes with their fields (labels, data types, values), suggest connections where:
- Fields with matching or related names should be connected (e.g. "Total" in one document → "Amount" input in a calculation)
- Fields that represent the same entity across documents should be linked
- Numeric fields can feed into calculation nodes (sum, average, etc.)
- Label nodes can display values from extractor fields

Return ONLY a JSON array of connection suggestions. Each suggestion should have:
- "sourceNodeId": the node ID containing the source field
- "sourceFieldId": the field/region ID to connect from
- "targetNodeId": the node ID to connect to
- "targetHandle": the target handle name (for calculation nodes use "inputs", for label nodes use "input")
- "reason": brief explanation of why these should be connected

Be conservative — only suggest connections that make semantic sense.`;

const SUMMARISE_SYSTEM_PROMPT = `You are a document processing assistant. Given OCR text or field data from documents, provide a concise summary that covers:
- Document type (invoice, receipt, contract, etc.)
- Key entities (people, companies, dates)
- Important values (totals, amounts, reference numbers)
- Any notable observations

Keep the summary brief (3-5 bullet points). Use plain language.`;

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

type ModelMessage = Parameters<typeof generateText>[0]['messages'] extends infer T
  ? T extends Array<infer U> ? U : never
  : never;

export function toModelMessages(
  messages: ChatRequestBody['messages'],
  contextBlock: string,
  images?: ChatRequestBody['images']
): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'tool_result' && msg.toolResults) {
      for (const tr of msg.toolResults) {
        const hasImages = tr.content.some((p) => p.type === 'image');

        // If the result contains images, use the 'content' output type so vision
        // models actually receive the image data instead of a [image] placeholder.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let output: any;
        if (hasImages) {
          output = {
            type: 'content' as const,
            value: tr.content.map((p) =>
              p.type === 'text'
                ? { type: 'text' as const, text: p.text ?? '' }
                : { type: 'file-data' as const, data: p.base64!, mediaType: p.mimeType! }
            ),
          };
        } else {
          output = {
            type: 'text' as const,
            value: tr.content.map((p) => p.text ?? '').join('\n'),
          };
        }

        result.push({
          role: 'tool' as const,
          content: [{
            type: 'tool-result' as const,
            toolCallId: tr.toolCallId,
            toolName: '', // filled by SDK from context
            output,
          }],
        });
      }
      continue;
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      result.push({
        role: 'assistant' as const,
        content: [
          ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
          ...msg.toolCalls.map((tc) => ({
            type: 'tool-call' as const,
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.arguments,
          })),
        ],
      });
      continue;
    }

    if (msg.role === 'user') {
      // First user message gets context block + images prepended
      if (i === 0 && (contextBlock || images?.length)) {
        const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mediaType?: string }> = [];
        if (contextBlock) {
          content.push({ type: 'text', text: contextBlock + msg.content });
        } else {
          content.push({ type: 'text', text: msg.content });
        }
        if (images?.length) {
          for (const img of images) {
            content.push({
              type: 'image',
              image: img.base64,
              mediaType: img.mimeType,
            });
          }
        }
        result.push({ role: 'user' as const, content });
      } else {
        result.push({ role: 'user' as const, content: msg.content });
      }
      continue;
    }

    // Plain assistant text
    result.push({ role: 'assistant' as const, content: msg.content });
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as ChatRequestBody;
  const { provider, model: modelId, apiKey, mode, ocrText, messages } = body;

  if (!provider || !modelId || !messages?.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!apiKey) {
    return res.status(400).json({ error: 'Missing API key' });
  }

  const systemPromptMap: Record<string, string> = {
    detect_fields: FIELD_DETECTION_SYSTEM_PROMPT,
    detect_table: TABLE_DETECTION_SYSTEM_PROMPT,
    extract_table: TABLE_EXTRACTION_SYSTEM_PROMPT,
    freeform: FREEFORM_SYSTEM_PROMPT,
    auto_connect: AUTO_CONNECT_SYSTEM_PROMPT,
    summarise: SUMMARISE_SYSTEM_PROMPT,
  };
  let system = systemPromptMap[mode] ?? FREEFORM_SYSTEM_PROMPT;
  if (body.customInstructions?.trim()) {
    system += `\n\n## User Instructions\n${body.customInstructions.trim()}`;
  }

  // Build context string
  let contextBlock = '';
  if (ocrText) {
    contextBlock += `Document OCR text:\n---\n${ocrText}\n---\n\n`;
  }
  if (body.nodesContext?.length) {
    contextBlock += `Canvas nodes:\n---\n${JSON.stringify(body.nodesContext, null, 2)}\n---\n\n`;
  }

  // Resolve tools — only for freeform mode or explicit tool list
  let tools: typeof TOOL_DEFS | Partial<typeof TOOL_DEFS> | undefined;
  if (body.tools?.length) {
    tools = getTools(body.tools);
  } else if (mode === 'freeform') {
    tools = getTools();
  }

  try {
    const resolvedModel = resolveModel(provider, modelId, apiKey);
    const modelMessages = toModelMessages(messages, contextBlock, body.images);

    // Streaming response for freeform chat
    if (body.stream && mode === 'freeform') {
      const result = streamText({
        model: resolvedModel,
        system,
        messages: modelMessages,
        tools,
        maxOutputTokens: 4096,
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      for await (const chunk of result.textStream) {
        res.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
      }

      const finalResult = await result;
      const resolvedToolCalls = await finalResult.toolCalls;
      const toolCalls = resolvedToolCalls?.length
        ? resolvedToolCalls.map((tc) => ({
            id: tc!.toolCallId,
            name: tc!.toolName,
            arguments: (tc as { toolCallId: string; toolName: string; input: unknown }).input,
          }))
        : undefined;

      if (toolCalls) {
        res.write(`data: ${JSON.stringify({ type: 'tool_calls', toolCalls })}\n\n`);
      }

      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Structured output for table detection — guarantees JSON shape.
    if (mode === 'detect_table') {
      const tableSchema = z.object({
        bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }),
        rowYs: z.array(z.number()),
        colXs: z.array(z.number()),
        headerRowIndex: z.number().nullable().optional(),
      });
      const out = await generateText({
        model: resolvedModel,
        system,
        messages: modelMessages,
        experimental_output: Output.object({ schema: tableSchema }),
        maxOutputTokens: 4096,
      });
      return res.status(200).json({ content: JSON.stringify(out.experimental_output), toolCalls: undefined });
    }

    // Plain-text JSON for full table extraction. We don't use
    // experimental_output here because Gemini's strict structured-output mode
    // intermittently throws "No output generated" on long bank-statement
    // responses (cells + rowYs make the JSON large). Plain text + client-side
    // extractJsonObject handles loose JSON robustly.
    if (mode === 'extract_table') {
      const out = await generateText({
        model: resolvedModel,
        system,
        messages: modelMessages,
        maxOutputTokens: 32768,
      });
      const text = out.text ?? '';
      if (!text.trim()) {
        return res.status(502).json({
          error: 'AI returned empty response. The image may be too large or the model timed out — try cropping the table tighter and retry.',
        });
      }
      return res.status(200).json({ content: text, toolCalls: undefined });
    }

    // Non-streaming response — detect_fields needs more tokens for large documents
    const result = await generateText({
      model: resolvedModel,
      system,
      messages: modelMessages,
      tools,
      maxOutputTokens: mode === 'detect_fields' ? 16384 : 4096,
    });

    const toolCalls = result.toolCalls?.length
      ? result.toolCalls.map((tc) => ({
          id: tc!.toolCallId,
          name: tc!.toolName,
          arguments: (tc as { toolCallId: string; toolName: string; input: unknown }).input,
        }))
      : undefined;

    return res.status(200).json({
      content: result.text,
      toolCalls,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status =
      message.includes('401') || message.includes('auth') ? 401
      : message.includes('429') ? 429
      : 500;
    return res.status(status).json({ error: message });
  }
}
