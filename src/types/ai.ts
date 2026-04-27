/** AI provider and settings types */

export type ProviderId = 'anthropic' | 'openai' | 'gemini';

export interface AiProviderDefinition {
  id: ProviderId;
  name: string;
  models: AiModel[];
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
}

export interface AiModel {
  id: string;
  name: string;
}

export interface AiProviderConfig {
  apiKey: string;
  verified: boolean;
  selectedModel: string;
}

export interface AiSettings {
  providers: Partial<Record<ProviderId, AiProviderConfig>>;
  activeProvider: ProviderId | null;
  /** User-written instructions the AI assistant should follow (markdown) */
  customInstructions?: string;
}

export interface AiContentPart {
  type: 'text' | 'image';
  text?: string;
  mimeType?: string;
  base64?: string;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiToolResult {
  toolCallId: string;
  content: AiContentPart[];
}

export interface AiMessage {
  role: 'user' | 'assistant' | 'tool_result';
  content: string;
  toolCalls?: AiToolCall[];
  toolResults?: AiToolResult[];
}

export interface AiChatRequest {
  provider: ProviderId;
  model: string;
  apiKey: string;
  mode: 'detect_fields' | 'detect_table' | 'freeform' | 'auto_connect' | 'summarise';
  ocrText?: string;
  /** For auto_connect: describes nodes and their fields */
  nodesContext?: AiNodeContext[];
  messages: AiMessage[];
  /** Base64 images to include in the request */
  images?: Array<{ mimeType: string; base64: string }>;
  /** Tool names to enable for this request */
  tools?: string[];
  /** User-written custom instructions to append to system prompt */
  customInstructions?: string;
}

/** Describes a node and its fields for AI auto-connect */
export interface AiNodeContext {
  nodeId: string;
  nodeType: string;
  label: string;
  fields: Array<{
    id: string;
    label: string;
    dataType: string;
    value?: string;
  }>;
}

/** AI-suggested connection between two fields */
export interface AiConnectionSuggestion {
  sourceNodeId: string;
  sourceFieldId: string;
  targetNodeId: string;
  targetHandle: string;
  reason: string;
}

export interface AiDetectedField {
  text: string;
  confidence: number;
  fieldType: string;
  label: string;
  dataType: string;
  bbox?: { x: number; y: number; width: number; height: number };
}

/** Registry of supported providers */
export const AI_PROVIDERS: AiProviderDefinition[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    ],
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'sk-ant-...',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    ],
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    ],
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'AIza...',
  },
];

export const DEFAULT_AI_SETTINGS: AiSettings = {
  providers: {},
  activeProvider: null,
};
