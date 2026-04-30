import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { pdfjs } from 'react-pdf';
import { Sparkles, Settings, Wand2, Link2, Send, Loader2 } from 'lucide-react';
import { useAiSettings } from '../../hooks/useAiSettings';
import { AiSettingsModal } from './AiSettingsModal';
import { askAI, detectFieldsWithAI, autoConnectWithAI } from '../../services/aiService';
import { useCanvasStore } from '../../store/canvasStore';
import { BlobRegistry } from '../../store/canvasPersistence';
import { extractFullPage } from '../../core/extraction/ocrExtractor';
import { AI_IMAGE_SIZE_LIMIT } from '../../config/ai';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AiMessage, AiDetectedField, AiNodeContext, AiConnectionSuggestion } from '../../types/ai';
import type { ExtractorNodeData, CalculationNodeData, LabelNodeData, SheetNodeData } from '../../types/nodes';

interface AiPromptPanelProps {
  context: 'canvas' | 'extractor';
  /** OCR text for extractor context */
  ocrText?: string;
  onFieldsDetected?: (fields: AiDetectedField[]) => void;
  /** Called when detect fields is triggered on canvas (caller handles per-node OCR) */
  onCanvasDetect?: () => void;
  /** Called when AI suggests connections on canvas */
  onConnectionsSuggested?: (suggestions: AiConnectionSuggestion[]) => void;
  /** Render flat (no card border/shadow/fixed width) for use in a docked bottom strip */
  docked?: boolean;
}

/** Build node context from canvas store for AI auto-connect / summarise */
function gatherNodesContext(): AiNodeContext[] {
  const { nodes } = useCanvasStore.getState();
  const contexts: AiNodeContext[] = [];

  for (const node of nodes) {
    if (node.type === 'extractor') {
      const data = node.data as ExtractorNodeData;
      contexts.push({
        nodeId: node.id,
        nodeType: 'extractor',
        label: data.label,
        fields: data.regions.map((r) => ({
          id: r.id,
          label: r.label,
          dataType: r.dataType,
          value: String(r.extractedData.value || ''),
        })),
      });
    } else if (node.type === 'calculation') {
      const data = node.data as CalculationNodeData;
      contexts.push({
        nodeId: node.id,
        nodeType: 'calculation',
        label: data.label,
        fields: [{ id: 'result', label: data.operation, dataType: 'number' }],
      });
    } else if (node.type === 'label') {
      const data = node.data as LabelNodeData;
      contexts.push({
        nodeId: node.id,
        nodeType: 'label',
        label: data.label,
        fields: [{ id: 'label-in', label: data.label, dataType: data.format ?? 'string' }],
      });
    } else if (node.type === 'sheet') {
      const data = node.data as SheetNodeData;
      contexts.push({
        nodeId: node.id,
        nodeType: 'sheet',
        label: data.label,
        fields: data.subheaders?.flatMap((sh) =>
          sh.entries.map((e) => ({
            id: e.id,
            label: e.label,
            dataType: 'number',
          }))
        ) ?? [],
      });
    }
  }
  return contexts;
}

/** Render all pages of a PDF (base64) to canvases using PDF.js */
async function renderPdfToCanvases(base64: string, mimeType: string): Promise<HTMLCanvasElement[]> {
  const dataUrl = `data:${mimeType};base64,${base64}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = await (pdfjs as any).getDocument({ url: dataUrl }).promise;
  const canvases: HTMLCanvasElement[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
  }

  return canvases;
}

/** Get ALL files from extractor nodes for vision-based detect */
async function getExtractorImages(): Promise<Array<{ mimeType: string; base64: string; size: number; fileType: 'pdf' | 'image' }>> {
  const { nodes } = useCanvasStore.getState();
  const results: Array<{ mimeType: string; base64: string; size: number; fileType: 'pdf' | 'image' }> = [];

  for (const node of nodes) {
    if (node.type !== 'extractor') continue;
    const data = node.data as ExtractorNodeData;
    const fileId = data.fileId;
    if (!fileId) continue;

    const blob = BlobRegistry.getBlob(fileId);
    const meta = BlobRegistry.getMetadata(fileId);
    if (!blob || !meta) continue;

    const buffer = await blob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((d, byte) => d + String.fromCharCode(byte), '')
    );
    results.push({ mimeType: meta.mimeType, base64, size: meta.size, fileType: meta.fileType });
  }
  return results;
}

export function AiPromptPanel({
  context,
  ocrText,
  onFieldsDetected,
  onCanvasDetect,
  onConnectionsSuggested,
  docked = false,
}: AiPromptPanelProps) {
  const { settings, activeProvider, activeConfig, enabledProviders } = useAiSettings();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [response, setResponse] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeToolCall, setActiveToolCall] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, response]);

  // Resolve human-readable model name
  const modelDisplayName = useMemo(() => {
    if (!activeProvider || !activeConfig?.selectedModel) return null;
    const model = activeProvider.models.find((m) => m.id === activeConfig.selectedModel);
    return model?.name ?? activeConfig.selectedModel;
  }, [activeProvider, activeConfig]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeProvider || !activeConfig) return;

    const question = input.trim();
    setInput('');
    setError(null);
    setIsLoading(true);

    const newMessages: AiMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(newMessages);

    // Add a placeholder assistant message for streaming
    const streamingIdx = newMessages.length;
    setMessages([...newMessages, { role: 'assistant', content: '' }]);

    try {
      const reply = await askAI(
        question,
        ocrText,
        activeProvider.id,
        activeConfig.selectedModel,
        activeConfig.apiKey,
        messages,
        {
          stream: true,
          onChunk: (chunk) => {
            setMessages((prev) => {
              const updated = [...prev];
              if (updated[streamingIdx]) {
                updated[streamingIdx] = {
                  ...updated[streamingIdx],
                  content: updated[streamingIdx].content + chunk,
                };
              }
              return updated;
            });
          },
          onToolCall: (toolName) => setActiveToolCall(toolName),
          customInstructions: settings.customInstructions,
        }
      );
      setActiveToolCall(null);
      // Finalize with the complete reply
      setMessages([...newMessages, { role: 'assistant', content: reply }]);
      setResponse(reply);
    } catch (err) {
      setActiveToolCall(null);
      // Remove the placeholder on error
      setMessages(newMessages);
      setError(err instanceof Error ? err.message : 'Failed to get response');
    } finally {
      setIsLoading(false);
    }
  }, [input, activeProvider, activeConfig, messages, ocrText, settings.customInstructions]);

  const handleDetectFields = useCallback(async () => {
    if (context === 'canvas') {
      // Try vision-based detection for canvas context
      if (!activeProvider || !activeConfig) {
        onCanvasDetect?.();
        return;
      }

      setIsDetecting(true);
      setError(null);

      try {
        const allImages = await getExtractorImages();

        if (allImages.length === 0) {
          // No images found, fall back to caller
          onCanvasDetect?.();
          setIsDetecting(false);
          return;
        }

        // Split by file type: PDFs cannot be sent as image parts to vision models
        const actualImages = allImages.filter((img) => img.fileType === 'image');
        const pdfFiles = allImages.filter((img) => img.fileType === 'pdf');

        // For actual images, further split by size. Account for ~33% base64 overhead
        // so that the encoded payload stays within AI_IMAGE_SIZE_LIMIT.
        const MAX_RAW_FOR_VISION = AI_IMAGE_SIZE_LIMIT * 0.75;
        const smallImages = actualImages.filter((img) => img.size <= MAX_RAW_FOR_VISION);
        const largeImages = actualImages.filter((img) => img.size > MAX_RAW_FOR_VISION);

        let fields: AiDetectedField[] = [];

        // Process small images: send all together to vision model
        if (smallImages.length > 0) {
          const visionFields = await detectFieldsWithAI(
            { images: smallImages.map((img) => ({ mimeType: img.mimeType, base64: img.base64 })), customInstructions: settings.customInstructions },
            activeProvider.id,
            activeConfig.selectedModel,
            activeConfig.apiKey
          );
          fields.push(...visionFields);
        }

        // Process large images and PDFs via Tesseract OCR
        const ocrCandidates = [...largeImages, ...pdfFiles];
        if (ocrCandidates.length > 0) {
          const allOcrWords: import('../../core/extraction/ocrExtractor').OcrWord[] = [];
          const allOcrTexts: string[] = [];

          for (const imageData of ocrCandidates) {
            if (imageData.fileType === 'pdf') {
              // PDFs can't be loaded as <img> — render each page to canvas via PDF.js
              const canvases = await renderPdfToCanvases(imageData.base64, imageData.mimeType);
              for (const canvas of canvases) {
                const ocrResult = await extractFullPage(canvas);
                allOcrWords.push(...ocrResult.words);
                allOcrTexts.push(ocrResult.text);
              }
            } else {
              const img = new Image();
              img.src = `data:${imageData.mimeType};base64,${imageData.base64}`;
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error(`Failed to load image for OCR`));
              });
              const ocrResult = await extractFullPage(img);
              allOcrWords.push(...ocrResult.words);
              allOcrTexts.push(ocrResult.text);
            }
          }

          const ocrFields = await detectFieldsWithAI(
            { ocrWords: allOcrWords, ocrText: allOcrTexts.join('\n\n---\n\n'), customInstructions: settings.customInstructions },
            activeProvider.id,
            activeConfig.selectedModel,
            activeConfig.apiKey
          );
          fields.push(...ocrFields);
        }

        onFieldsDetected?.(fields);
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Detected ${fields.length} field(s) across ${allImages.length} document(s):\n${fields.map((f) => `- **${f.label}**: ${f.text}`).join('\n')}`,
        }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Detection failed');
      } finally {
        setIsDetecting(false);
      }
      return;
    }

    if (!ocrText || !activeProvider || !activeConfig) return;

    setIsDetecting(true);
    setError(null);

    try {
      const fields = await detectFieldsWithAI(
        { ocrText, customInstructions: settings.customInstructions },
        activeProvider.id,
        activeConfig.selectedModel,
        activeConfig.apiKey
      );
      onFieldsDetected?.(fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed');
    } finally {
      setIsDetecting(false);
    }
  }, [context, ocrText, activeProvider, activeConfig, onFieldsDetected, onCanvasDetect, settings.customInstructions]);

  const handleAutoConnect = useCallback(async () => {
    if (!activeProvider || !activeConfig) return;

    const nodesContext = gatherNodesContext();
    if (nodesContext.length < 2) {
      setError('Need at least 2 nodes with fields to auto-connect');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const suggestions = await autoConnectWithAI(
        nodesContext,
        activeProvider.id,
        activeConfig.selectedModel,
        activeConfig.apiKey
      );

      if (suggestions.length === 0) {
        setMessages((prev) => [...prev, { role: 'assistant', content: 'No connections suggested — the fields don\'t appear to have matching relationships.' }]);
      } else {
        onConnectionsSuggested?.(suggestions);
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Connected ${suggestions.length} field(s):\n${suggestions.map((s) => `• ${s.reason}`).join('\n')}`,
        }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-connect failed');
    } finally {
      setIsConnecting(false);
    }
  }, [activeProvider, activeConfig, onConnectionsSuggested]);

const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasProvider = enabledProviders.length > 0;

  const outerStyle = docked
    ? undefined
    : (context === 'canvas' ? { width: 320, maxHeight: 400 } : { width: '100%', maxHeight: 300 });
  const outerClass = docked
    ? 'flex flex-col bg-white overflow-hidden'
    : 'flex flex-col bg-white/95 backdrop-blur-md border border-paper-100 rounded-xl shadow-[0_8px_24px_rgba(16,42,67,0.08)] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300';

  const loadingLabel = activeToolCall
    ? ({
        get_file_content: 'Reading document...',
        get_canvas_graph: 'Scanning canvas...',
        get_node_details: 'Inspecting node...',
        get_file_list: 'Listing files...',
        suggest_connection: 'Creating connection...',
        create_region: 'Defining field...',
      } as Record<string, string>)[activeToolCall] ?? `Running ${activeToolCall}...`
    : 'Thinking...';

  return (
    <>
      <div className={outerClass} style={outerStyle}>
        {/* Header */}
        <div className="flex items-center justify-between pl-3 pr-1.5 py-1.5 border-b border-paper-100 bg-paper-50/60">
          <span className="text-xs font-medium text-bridge-800 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-copper-500" />
            AI Assistant
          </span>
          <div className="flex items-center gap-1">
            {activeProvider && (
              <span className="text-[10px] text-bridge-500 px-1.5 py-0.5 bg-paper-100 rounded-full">
                {activeProvider.name}{modelDisplayName ? ` · ${modelDisplayName}` : ''}
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)} aria-label="AI settings">
                  <Settings />
                </Button>
              </TooltipTrigger>
              <TooltipContent>AI settings</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {!hasProvider ? (
          /* No provider configured */
          <div className="p-4 text-center">
            <p className="text-xs text-bridge-500 mb-2">No AI provider configured</p>
            <Button size="sm" onClick={() => setSettingsOpen(true)}>
              Configure AI
            </Button>
          </div>
        ) : (
          <>
            {/* Messages area */}
            {messages.length > 0 && (
              <div className="flex-1 overflow-auto px-3 py-2 space-y-2 min-h-0" style={{ maxHeight: docked ? 120 : 200 }}>
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-xs rounded-md px-2.5 py-1.5 max-w-[90%] ${
                      msg.role === 'user'
                        ? 'bg-copper-400/10 text-bridge-900 ml-auto'
                        : 'bg-paper-100 text-bridge-700'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="max-w-none leading-relaxed [&_*]:text-xs [&_*]:leading-relaxed [&_p]:m-0 [&_h1]:m-0 [&_h1]:font-semibold [&_h2]:m-0 [&_h2]:font-semibold [&_h3]:m-0 [&_h3]:font-semibold [&_h4]:m-0 [&_h4]:font-medium [&_h5]:m-0 [&_h6]:m-0 [&_ul]:m-0 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:m-0 [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:m-0 [&_pre]:bg-paper-200 [&_pre]:rounded [&_pre]:px-2 [&_pre]:py-1 [&_code]:bg-paper-200 [&_code]:px-1 [&_code]:rounded [&_strong]:font-semibold [&_a]:text-copper-500 [&_a]:underline [&>*+*]:mt-1">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div className="text-xs text-bridge-400 px-2.5 py-1.5 flex items-center gap-1.5">
                    <Loader2 className="animate-spin h-3 w-3" />
                    {loadingLabel}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="px-3 py-1.5 text-xs text-red-600 bg-red-50 border-t border-red-100">
                {error}
              </div>
            )}

            {/* Actions & Input */}
            <div className="border-t border-paper-100 p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleDetectFields}
                  disabled={isDetecting || (!ocrText && context === 'extractor')}
                  className="flex-1"
                >
                  {isDetecting ? <Loader2 className="animate-spin" /> : <Wand2 />}
                  {isDetecting ? 'Detecting...' : 'Detect fields'}
                </Button>

                {context === 'canvas' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAutoConnect}
                    disabled={isConnecting}
                    className="flex-1"
                  >
                    {isConnecting ? <Loader2 className="animate-spin" /> : <Link2 />}
                    {isConnecting ? 'Connecting...' : 'Auto-connect'}
                  </Button>
                )}
              </div>

              {/* Text input */}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your documents..."
                  disabled={isLoading}
                  className="flex-1 px-2.5 py-1.5 text-xs bg-paper-50 border border-paper-100 rounded-md text-bridge-800 placeholder:text-bridge-400 focus:outline-none focus:bg-white focus:border-copper-400 focus:ring-1 focus:ring-copper-400/30 disabled:opacity-50 transition-colors"
                />
                <Button
                  variant="default"
                  size="icon"
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  aria-label="Send"
                >
                  <Send />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <AiSettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
