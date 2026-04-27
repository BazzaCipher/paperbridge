import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useEdges } from '@xyflow/react';
import { BaseNode } from './base/BaseNode';
import { DocumentViewer } from './file/DocumentViewer';
import { RegionSelector } from './file/RegionSelector';
import { HighlightOverlay } from './file/HighlightOverlay';
import { RegionList } from './file/RegionList';
import { RegionTable } from './file/RegionTable';
import { DEFAULT_EXTRACTOR_COLUMNS } from '../canvas/nodeDefaults';
import { FileNodePreview } from './file/FileNodePreview';
import { Modal } from '../ui/Modal';
import { ZoomControls } from '../ui/ZoomControls';
import { CollapsiblePanel } from '../ui/CollapsiblePanel';
import { FileDropZone } from '../ui/FileDropZone';
import { extractTextFromRegion, extractFullPage, extractFullPageFromRegion } from '../../core/extraction/ocrExtractor';
import { detectFields, fieldOverlapsExisting } from '../../core/extraction/fieldDetector';
import { parseTableFromOcr } from '../../core/extraction/tableParser';
import { useCanvasStore } from '../../store/canvasStore';
import { useAiSettings } from '../../hooks/useAiSettings';
import { detectFieldsWithAI } from '../../services/aiService';
import { isSimpleDataType } from '../../types/data';
import { useToast } from '../ui/Toast';
import { useFileNode } from '../../hooks/useFileNode';
import { useNodeOutputs } from '../../hooks/useNodeOutputs';
import { useSyncNodeOutputs } from '../../hooks/useSyncNodeOutputs';
import { useDocumentZoom } from '../../hooks/useDocumentZoom';
import { getColorForType, getCompatibleTypes } from '../../utils/colors';
import { generateId } from '../../utils/id';
import { parseCsv } from '../../utils/csvParser';
import { createRegionFromBox, createRegionFromText } from '../../utils/regions';
import { BlobRegistry } from '../../store/canvasPersistence';
import { FilePickerModal } from '../ui/FilePickerModal';
import type {
  ExtractorNode as ExtractorNodeType,
  NodeOutput,
  RegionCoordinates,
  ExtractedRegion,
  ExtractorColumn,
  TextRange,
  SimpleDataType,
  FieldType,
  DisplayNodeData,
  CachedExtractorEdges,
  DataSourceReference,
} from '../../types';

const VIEWER_WIDTH = 500;

// Confidence threshold for OCR warnings (0-100)
const LOW_CONFIDENCE_THRESHOLD = 50;

export function ExtractorNode({ id, data, selected }: NodeProps<ExtractorNodeType>) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const replaceNode = useCanvasStore((state) => state.replaceNode);
  const removeEdge = useCanvasStore((state) => state.removeEdge);
  const edges = useEdges();
  const nodeOutputs = useNodeOutputs(id);
  const { showToast } = useToast();
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [, setViewerHeight] = useState(400);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'select' | 'box' | 'text' | 'table'>('box');
  const [isTableExtracting, setIsTableExtracting] = useState(false);
  const [pageOffsets, setPageOffsets] = useState<Map<number, number>>(new Map());
  const [pdfError, setPdfError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | HTMLCanvasElement | null>(null);
  const viewerAreaRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const lastScrolledRef = useRef<string | null>(null);
  const { zoom, zoomIn, zoomOut, resetZoom } = useDocumentZoom(viewerAreaRef, isModalOpen);

  // ── Populate Exportable.outputs from regions ──────────────────────────────
  const outputs = useMemo(() => {
    const map: Record<string, NodeOutput> = {};
    for (const region of data.regions) {
      const extractedValue = region.extractedData.value;
      let value: number | string | boolean | Date;

      if (region.dataType === 'boolean') {
        if (typeof extractedValue === 'boolean') {
          value = extractedValue;
        } else {
          const strVal = String(extractedValue).toLowerCase();
          value = strVal === 'yes' || strVal === 'true' || strVal === '1';
        }
      } else if (region.dataType === 'date') {
        value = typeof extractedValue === 'string' ? extractedValue : String(extractedValue);
      } else if (typeof extractedValue === 'number') {
        value = extractedValue;
      } else {
        value = String(extractedValue);
      }

      const source: DataSourceReference = {
        nodeId: id,
        regionId: region.id,
        pageNumber: region.pageNumber,
        coordinates: region.coordinates,
        textRange: region.textRange,
        extractionMethod: region.extractedData.source?.extractionMethod || 'manual',
        confidence: region.extractedData.source?.confidence,
      };

      map[region.id] = {
        value,
        dataType: region.dataType,
        compatibleTypes: getCompatibleTypes(region.dataType),
        label: region.label,
        source,
      };
    }
    return map;
  }, [data.regions, id]);

  useSyncNodeOutputs(
    Object.keys(outputs).length > 0 ? outputs : undefined,
    nodeOutputs
  );

  const handleFileInit = useCallback(
    (fileData: { fileUrl: string; fileId: string; fileName: string; fileType: 'pdf' | 'image' }) => {
      updateNodeData(id, {
        ...fileData,
        currentPage: 1,
        totalPages: 1,
        regions: [],
      });
    },
    [id, updateNodeData]
  );

  const { handleFileSelect, handleFileDrop, handleDragOver, handlePickFromRegistry } = useFileNode(id, handleFileInit);

  const handlePdfLoad = useCallback(
    ({ numPages }: { numPages: number }) => {
      updateNodeData(id, { totalPages: numPages });
      setPdfError(null);
    },
    [id, updateNodeData]
  );

  const handlePdfError = useCallback((error: Error) => {
    console.error('PDF load error:', error);
    setPdfError('Failed to load PDF');
  }, []);

  const handleDocumentLoad = useCallback(
    (numPages: number) => {
      updateNodeData(id, { totalPages: numPages });
      setViewerHeight(VIEWER_WIDTH * 1.4);
    },
    [id, updateNodeData]
  );

  const handleContentResize = useCallback(
    (_width: number, height: number) => {
      setViewerHeight(height);
    },
    []
  );

  const handlePageChange = useCallback(
    (page: number) => {
      updateNodeData(id, { currentPage: page });
    },
    [id, updateNodeData]
  );

  const handleRegionCreate = useCallback(
    (coordinates: RegionCoordinates, pageNumber?: number) => {
      const newRegion = createRegionFromBox(
        coordinates,
        pageNumber ?? data.currentPage,
        data.regions.length
      );
      updateNodeData(id, { regions: [...data.regions, newRegion] });
      setSelectedRegionId(newRegion.id);
    },
    [id, data.regions, data.currentPage, updateNodeData]
  );

  const handleTableExtract = useCallback(
    async (coordinates: RegionCoordinates, pageNumber?: number) => {
      if (!data.fileUrl) {
        showToast('No document loaded', 'error');
        return;
      }
      let imageSource: HTMLImageElement | HTMLCanvasElement | string;
      if (imageRef.current) {
        imageSource = imageRef.current;
      } else if (data.fileType === 'image') {
        imageSource = data.fileUrl;
      } else {
        showToast('Document not ready. Please wait and try again.', 'warning');
        return;
      }

      setIsTableExtracting(true);
      try {
        const ocr = await extractFullPageFromRegion(imageSource, coordinates);
        const table = parseTableFromOcr(ocr);
        if (table.headers.length === 0 || table.rows.length === 0) {
          showToast('No table structure detected in selection', 'warning');
          return;
        }

        // Merge headers into existing columns: first header maps to built-in
        // "label" column; remaining headers reuse an existing custom column
        // (case-insensitive label match) or create new ones.
        const existingCols = data.columns ?? DEFAULT_EXTRACTOR_COLUMNS;
        const byLabel = new Map(
          existingCols.map((c) => [c.label.toLowerCase(), c] as const),
        );
        const mappedColIds: string[] = [];
        const nextCols: ExtractorColumn[] = [...existingCols];

        table.headers.forEach((h, i) => {
          if (i === 0) {
            mappedColIds.push('label');
            return;
          }
          const existing = byLabel.get(h.toLowerCase());
          if (existing && existing.id !== 'label') {
            mappedColIds.push(existing.id);
            return;
          }
          const newCol: ExtractorColumn = {
            id: generateId('col'),
            label: h,
            dataType: 'string',
          };
          nextCols.push(newCol);
          byLabel.set(h.toLowerCase(), newCol);
          mappedColIds.push(newCol.id);
        });

        const page = pageNumber ?? data.currentPage;
        const newRegions: ExtractedRegion[] = table.rows.map((r) => {
          const cells: Record<string, string> = {};
          let label = '';
          let valueCell = '';
          mappedColIds.forEach((colId, i) => {
            const v = r[i] ?? '';
            if (colId === 'label') label = v;
            else if (colId === 'value') valueCell = v;
            else cells[colId] = v;
          });
          return {
            id: generateId('region'),
            label,
            selectionType: 'box',
            coordinates,
            pageNumber: page,
            extractedData: {
              type: 'string',
              value: valueCell,
              source: {
                nodeId: id,
                regionId: '',
                pageNumber: page,
                coordinates,
                extractionMethod: 'ocr',
                confidence: ocr.confidence,
              },
            },
            dataType: 'string',
            color: getColorForType('string').border,
            cells,
          };
        });

        updateNodeData(id, {
          columns: nextCols,
          regions: [...data.regions, ...newRegions],
        });
        showToast(
          `Extracted ${newRegions.length} row(s) across ${table.headers.length} column(s)`,
          'success',
        );
      } catch (err) {
        console.error('Table extraction failed:', err);
        showToast('Table extraction failed', 'error');
      } finally {
        setIsTableExtracting(false);
      }
    },
    [id, data.fileUrl, data.fileType, data.columns, data.regions, data.currentPage, updateNodeData, showToast],
  );

  const handleBoxDraw = useCallback(
    (coordinates: RegionCoordinates, pageNumber?: number) => {
      if (selectionMode === 'table') {
        void handleTableExtract(coordinates, pageNumber);
        return;
      }
      handleRegionCreate(coordinates, pageNumber);
    },
    [selectionMode, handleTableExtract, handleRegionCreate],
  );

  const handleTextSelect = useCallback(
    (textRange: TextRange) => {
      const newRegion = createRegionFromText(textRange, data.currentPage, data.regions.length);
      updateNodeData(id, { regions: [...data.regions, newRegion] });
      setSelectedRegionId(newRegion.id);
    },
    [id, data.regions, data.currentPage, updateNodeData]
  );

  const handleRegionSelect = useCallback((regionId: string) => {
    // Toggle: deselect if already selected
    if (selectedRegionId === regionId) {
      setSelectedRegionId(null);
      return;
    }

    setSelectedRegionId(regionId);
    const region = data.regions.find((r) => r.id === regionId);
    if (region) {
      updateNodeData(id, { currentPage: region.pageNumber });
      setIsModalOpen(true);
    }
  }, [data.regions, id, updateNodeData, selectedRegionId]);

  const handleRegionDelete = useCallback(
    (regionId: string) => {
      updateNodeData(id, {
        regions: data.regions.filter((r) => r.id !== regionId),
      });
      if (selectedRegionId === regionId) {
        setSelectedRegionId(null);
      }
    },
    [id, data.regions, selectedRegionId, updateNodeData]
  );

  const handleRegionLabelChange = useCallback(
    (regionId: string, label: string) => {
      updateNodeData(id, {
        regions: data.regions.map((r) =>
          r.id === regionId ? { ...r, label } : r
        ),
      });
    },
    [id, data.regions, updateNodeData]
  );

  const handleRegionDataTypeChange = useCallback(
    (regionId: string, newDataType: SimpleDataType) => {
      updateNodeData(id, {
        regions: data.regions.map((r) => {
          if (r.id !== regionId) return r;

          const currentValue = String(r.extractedData.value || '');
          const updatedCache = { ...(r.valueCache || {}), [r.dataType]: currentValue };
          const cachedValue = updatedCache[newDataType];

          return {
            ...r,
            dataType: newDataType,
            color: getColorForType(newDataType).border,
            valueCache: updatedCache,
            extractedData: {
              ...r.extractedData,
              value: cachedValue ?? currentValue,
            },
          };
        }),
      });
    },
    [id, data.regions, updateNodeData]
  );

  const columns: ExtractorColumn[] = data.columns ?? DEFAULT_EXTRACTOR_COLUMNS;

  const handleColumnsChange = useCallback(
    (next: ExtractorColumn[]) => {
      updateNodeData(id, { columns: next });
    },
    [id, updateNodeData],
  );

  const handleCellChange = useCallback(
    (regionId: string, columnId: string, value: string) => {
      updateNodeData(id, {
        regions: data.regions.map((r) => {
          if (r.id !== regionId) return r;
          if (columnId === 'label') return { ...r, label: value };
          if (columnId === 'value') {
            return {
              ...r,
              extractedData: { ...r.extractedData, value },
              ...(r.selectionType === 'text' && r.textRange
                ? { textRange: { ...r.textRange, text: value } }
                : {}),
            };
          }
          return { ...r, cells: { ...(r.cells ?? {}), [columnId]: value } };
        }),
      });
    },
    [id, data.regions, updateNodeData],
  );

  const handleCsvImport = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const { headers, rows } = parseCsv(text);
        if (headers.length === 0 || rows.length === 0) {
          showToast('CSV appears empty', 'warning');
          return;
        }

        // Merge columns: built-in "label" maps to the first header; remaining
        // headers become custom columns (reusing existing IDs by label match).
        const existingCols = data.columns ?? DEFAULT_EXTRACTOR_COLUMNS;
        const byLabel = new Map(
          existingCols.map((c) => [c.label.toLowerCase(), c] as const),
        );
        const mappedHeaderColIds: string[] = [];
        const nextCols: ExtractorColumn[] = [...existingCols];

        headers.forEach((h, i) => {
          if (i === 0) {
            mappedHeaderColIds.push('label');
            return;
          }
          const existing = byLabel.get(h.toLowerCase());
          if (existing && existing.id !== 'label') {
            mappedHeaderColIds.push(existing.id);
            return;
          }
          const newCol: ExtractorColumn = {
            id: generateId('col'),
            label: h,
            dataType: 'string',
          };
          nextCols.push(newCol);
          byLabel.set(h.toLowerCase(), newCol);
          mappedHeaderColIds.push(newCol.id);
        });

        const newRegions: ExtractedRegion[] = rows.map((r) => {
          const cells: Record<string, string> = {};
          let label = '';
          let valueCell = '';
          mappedHeaderColIds.forEach((colId, i) => {
            const v = r[i] ?? '';
            if (colId === 'label') {
              label = v;
            } else if (colId === 'value') {
              valueCell = v;
            } else {
              cells[colId] = v;
            }
          });
          return {
            id: generateId('region'),
            label,
            selectionType: 'manual',
            pageNumber: data.currentPage,
            extractedData: { type: 'string', value: valueCell },
            dataType: 'string',
            color: getColorForType('string').border,
            cells,
          };
        });

        updateNodeData(id, {
          columns: nextCols,
          regions: [...data.regions, ...newRegions],
        });
        showToast(`Imported ${newRegions.length} row(s) from CSV`, 'success');
      } catch (err) {
        console.error('CSV import failed:', err);
        showToast('Failed to parse CSV', 'error');
      }
    },
    [id, data.columns, data.regions, data.currentPage, updateNodeData, showToast],
  );

  const isCsvFile = (f: File) =>
    f.type === 'text/csv' ||
    f.type === 'application/csv' ||
    /\.csv$/i.test(f.name) ||
    /\.tsv$/i.test(f.name);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const files = e.dataTransfer?.files;
      if (files && files.length > 0 && isCsvFile(files[0])) {
        e.preventDefault();
        e.stopPropagation();
        handleCsvImport(files[0]);
        return;
      }
      handleFileDrop(e);
    },
    [handleFileDrop, handleCsvImport],
  );

  const handleAddRow = useCallback(() => {
    const newRegion: ExtractedRegion = {
      id: generateId('region'),
      label: '',
      selectionType: 'manual',
      pageNumber: data.currentPage,
      extractedData: { type: 'string', value: '' },
      dataType: 'string',
      color: getColorForType('string').border,
      cells: {},
    };
    updateNodeData(id, { regions: [...data.regions, newRegion] });
  }, [id, data.regions, data.currentPage, updateNodeData]);

  const handleValueChange = useCallback(
    (regionId: string, value: string) => {
      updateNodeData(id, {
        regions: data.regions.map((r) =>
          r.id === regionId
            ? {
                ...r,
                extractedData: { ...r.extractedData, value },
                // Also update textRange if it's a text selection
                ...(r.selectionType === 'text' && r.textRange
                  ? { textRange: { ...r.textRange, text: value } }
                  : {}),
              }
            : r
        ),
      });
    },
    [id, data.regions, updateNodeData]
  );

  const handleExtract = useCallback(
    async (regionId: string) => {
      const region = data.regions.find((r) => r.id === regionId);
      if (!region || !data.fileUrl || !region.coordinates) return;

      setIsExtracting(true);
      try {
        const result = await extractTextFromRegion(
          data.fileUrl,
          region.coordinates
        );

        // Warn if confidence is low
        if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
          showToast(
            `Low OCR confidence (${Math.round(result.confidence)}%). Results may be inaccurate.`,
            'warning'
          );
        }

        // Warn if no text was extracted
        if (!result.text.trim()) {
          showToast('No text detected in selection. Try a different region.', 'warning');
        }

        updateNodeData(id, {
          regions: data.regions.map((r) =>
            r.id === regionId
              ? {
                  ...r,
                  extractedData: {
                    ...result.dataValue,
                    source: {
                      nodeId: id,
                      regionId: r.id,
                      pageNumber: r.pageNumber,
                      coordinates: r.coordinates,
                      extractionMethod: 'ocr' as const,
                      confidence: result.confidence,
                    },
                  },
                }
              : r
          ),
        });
      } catch (error) {
        console.error('OCR extraction failed:', error);
        // Show user-friendly error message
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage.includes('canvas context')) {
          showToast('Failed to process image. Please try again.', 'error');
        } else if (errorMessage.includes('load') || errorMessage.includes('image')) {
          showToast('Failed to load image for OCR. The file may be corrupted.', 'error');
        } else {
          showToast(`OCR extraction failed: ${errorMessage}`, 'error');
        }
      } finally {
        setIsExtracting(false);
      }
    },
    [id, data.regions, data.fileUrl, updateNodeData, showToast]
  );

  const { activeProvider, activeConfig, settings: aiSettings } = useAiSettings();

  const handleAutoDetect = useCallback(async () => {
    if (!data.fileUrl) {
      showToast('No document loaded', 'error');
      return;
    }

    let imageSource: HTMLImageElement | HTMLCanvasElement | string;
    if (imageRef.current) {
      imageSource = imageRef.current;
    } else if (data.fileType === 'image') {
      imageSource = data.fileUrl;
    } else {
      showToast('PDF not ready. Please wait and try again.', 'warning');
      return;
    }

    const existingCoordinates = data.regions
      .filter((r) => r.coordinates && r.pageNumber === data.currentPage)
      .map((r) => r.coordinates!);

    setIsAutoDetecting(true);
    try {
      const useAi = !!(activeProvider && activeConfig?.apiKey && activeConfig?.selectedModel);

      if (useAi) {
        // AI-imbued OCR path: send the page image directly to a vision model.
        // For PDFs, the rendered canvas is the imageRef. For images with no
        // ref, we fall back to fetching the URL and converting to base64.
        let mimeType = 'image/png';
        let base64: string;

        if (imageSource instanceof HTMLCanvasElement) {
          const dataUrl = imageSource.toDataURL('image/png');
          base64 = dataUrl.split(',')[1] ?? '';
        } else if (imageSource instanceof HTMLImageElement) {
          const canvas = document.createElement('canvas');
          canvas.width = imageSource.naturalWidth || imageSource.width;
          canvas.height = imageSource.naturalHeight || imageSource.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Failed to create canvas context');
          ctx.drawImage(imageSource, 0, 0);
          base64 = canvas.toDataURL('image/png').split(',')[1] ?? '';
        } else {
          // string URL — fetch and encode
          const res = await fetch(imageSource);
          const blob = await res.blob();
          mimeType = blob.type || 'image/png';
          base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(',')[1] ?? '');
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        }

        // Also gather OCR words so the AI can compute bboxes when its vision
        // alone doesn't yield reliable coordinates (large/complex pages).
        const ocr = await extractFullPage(imageSource);

        const aiFields = await detectFieldsWithAI(
          {
            images: [{ mimeType, base64 }],
            ocrWords: ocr.words,
            ocrText: ocr.text,
            customInstructions: aiSettings.customInstructions,
          },
          activeProvider!.id,
          activeConfig!.selectedModel,
          activeConfig!.apiKey,
        );

        if (aiFields.length === 0) {
          showToast('AI detected no fields. Try manual selection.', 'warning');
          return;
        }

        const newRegions: ExtractedRegion[] = [];
        for (const f of aiFields) {
          const dataType: SimpleDataType = isSimpleDataType(f.dataType as SimpleDataType)
            ? (f.dataType as SimpleDataType)
            : 'string';

          const bbox = f.bbox;
          if (bbox && fieldOverlapsExisting(
            { bbox, label: f.label, text: f.text, confidence: f.confidence * 100, dataType, fieldType: (f.fieldType ?? 'unknown') as FieldType },
            existingCoordinates,
            0.8,
          )) {
            continue;
          }

          const regionId = generateId('region');
          newRegions.push({
            id: regionId,
            label: f.label || f.fieldType || 'Field',
            selectionType: bbox ? 'box' : 'manual',
            coordinates: bbox,
            pageNumber: data.currentPage,
            extractedData: {
              type: dataType,
              value: f.text,
              source: {
                nodeId: id,
                regionId,
                pageNumber: data.currentPage,
                coordinates: bbox,
                extractionMethod: 'ocr' as const,
                confidence: Math.round((f.confidence ?? 0) * 100),
              },
            },
            dataType,
            color: getColorForType(dataType).border,
          });
        }

        if (newRegions.length === 0) {
          showToast('All AI-detected fields overlap with existing regions.', 'info');
          return;
        }

        updateNodeData(id, { regions: [...data.regions, ...newRegions] });
        showToast(`AI detected ${newRegions.length} field(s)`, 'success');
        return;
      }

      // Fallback: local OCR + heuristic detector
      const ocrResult = await extractFullPage(imageSource);
      const detectedFields = detectFields(ocrResult);

      if (detectedFields.length === 0) {
        showToast('No fields detected. Try manual selection or configure an AI provider.', 'warning');
        return;
      }

      const newFields = detectedFields.filter(
        (field) => !fieldOverlapsExisting(field, existingCoordinates, 0.8)
      );

      if (newFields.length === 0) {
        showToast('All detected fields overlap with existing regions.', 'info');
        return;
      }

      const newRegions: ExtractedRegion[] = newFields.map((field) => {
        const regionId = generateId('region');
        return {
          id: regionId,
          label: field.label,
          selectionType: 'box' as const,
          coordinates: field.bbox,
          pageNumber: data.currentPage,
          extractedData: {
            type: field.dataType,
            value: field.text,
            source: {
              nodeId: id,
              regionId,
              pageNumber: data.currentPage,
              coordinates: field.bbox,
              extractionMethod: 'ocr' as const,
              confidence: field.confidence,
            },
          },
          dataType: field.dataType,
          color: getColorForType(field.dataType).border,
        };
      });

      updateNodeData(id, { regions: [...data.regions, ...newRegions] });
      const lowConfidenceCount = newFields.filter((f) => f.confidence < 50).length;
      if (lowConfidenceCount > 0) {
        showToast(
          `Detected ${newRegions.length} field(s). ${lowConfidenceCount} have low confidence.`,
          'warning'
        );
      } else {
        showToast(`Detected ${newRegions.length} field(s)`, 'success');
      }
    } catch (error) {
      console.error('Auto-detection failed:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      showToast(`Auto-detection failed: ${msg}`, 'error');
    } finally {
      setIsAutoDetecting(false);
    }
  }, [id, data.fileUrl, data.fileType, data.regions, data.currentPage, updateNodeData, showToast, activeProvider, activeConfig, aiSettings.customInstructions]);

  // Scroll to selected region once when selection changes
  useEffect(() => {
    if (!isModalOpen || !selectedRegionId || !viewerAreaRef.current) {
      lastScrolledRef.current = null;
      return;
    }
    if (lastScrolledRef.current === selectedRegionId) return;

    const region = data.regions.find(r => r.id === selectedRegionId);
    if (!region) return;

    const pageOffset = pageOffsets.get(region.pageNumber) ?? 0;
    const regionY = region.coordinates?.y ?? region.textRange?.rects?.[0]?.y ?? 0;
    const targetY = pageOffset + regionY - 60;

    lastScrolledRef.current = selectedRegionId;
    requestAnimationFrame(() => {
      viewerAreaRef.current?.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
    });
  }, [isModalOpen, selectedRegionId, pageOffsets, data.regions]);

  const openModal = useCallback(() => {
    if (data.fileType !== 'pdf') setSelectionMode('box');
    setIsModalOpen(true);
  }, [data.fileType]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setIsFullscreen(false);
    resetZoom();
  }, [resetZoom]);

  // Convert to DisplayNode
  const convertToDisplay = useCallback(() => {
    // Cache current edges and regions
    const outgoingEdges = edges.filter((e) => e.source === id);
    const cachedExtractorEdges: CachedExtractorEdges = {
      edges: outgoingEdges.map((e) => ({
        id: e.id,
        target: e.target,
        targetHandle: e.targetHandle ?? undefined,
        sourceHandle: e.sourceHandle ?? '',
      })),
      regions: data.regions,
      cachedAt: new Date().toISOString(),
    };

    // Create DisplayNode with view from current page
    const displayData: DisplayNodeData = {
      label: data.label,
      fileType: data.fileType,
      fileUrl: data.fileUrl,
      fileId: data.fileId,
      fileName: data.fileName,
      view: {
        viewport: { x: 0, y: 0, width: 1, height: 1 },
        target: data.fileType === 'pdf'
          ? { type: 'page', pageNumber: data.currentPage }
          : { type: 'image' },
        nodeSize: { width: 400, height: 300 },
        aspectLocked: true,
      },
      totalPages: data.totalPages,
      viewports: [],
      cachedExtractorEdges,
    };

    // Remove outgoing edges (DisplayNode has no outputs)
    for (const edge of outgoingEdges) {
      removeEdge(edge.id);
    }

    // Replace node
    replaceNode(id, 'display', displayData);
  }, [id, data, edges, replaceNode, removeEdge]);

  return (
    <>
      <BaseNode label={data.label} selected={selected} className="w-[280px]" hideHeader={!!data.compressed}>
        {/* File info and open button */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {data.fileUrl ? (
            <FileNodePreview
              fileUrl={data.fileUrl}
              fileType={data.fileType}
              fileName={data.fileName || ''}
              currentPage={data.currentPage}
              totalPages={data.totalPages}
              itemCount={data.regions.length}
              itemLabel="field"
              onOpenClick={openModal}
              onConvertClick={convertToDisplay}
              convertLabel="Display"
              convertIcon="image"
              showThumbnail={true}
              thumbnailHeight={150}
              onPdfLoad={handlePdfLoad}
              onPdfError={handlePdfError}
              pdfError={pdfError}
              mimeType={data.fileId ? BlobRegistry.getMetadata(data.fileId)?.mimeType : undefined}
              fileSize={data.fileId ? BlobRegistry.getMetadata(data.fileId)?.size : undefined}
              compressed={!!data.compressed}
              onCompressToggle={() => updateNodeData(id, { compressed: !data.compressed })}
            />
          ) : (
            <div className="p-2">
              <FileDropZone
                onFileSelect={handleFileSelect}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                compact
                onPickFromRegistry={() => setIsPickerOpen(true)}
              />
            </div>
          )}
        </div>

        {/* Ledger table: columns + cells, with inline editing */}
        <RegionTable
          regions={data.regions}
          columns={columns}
          selectedRegionId={selectedRegionId}
          nodeId={id}
          onRegionSelect={handleRegionSelect}
          onRegionDelete={handleRegionDelete}
          onColumnsChange={handleColumnsChange}
          onCellChange={handleCellChange}
          onAddRow={handleAddRow}
        />
      </BaseNode>

      {/* Document viewer modal with side panel */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={data.fileName || 'Document Viewer'}
        className="w-[950px] max-w-[95vw]"
        fullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen((f) => !f)}
      >
        <div className={`flex ${isFullscreen ? 'h-[calc(100vh-49px)]' : 'h-[75vh]'}`}>
          {/* Document viewer area */}
          <div
            className="flex-1 overflow-auto bg-paper-50"
            ref={viewerAreaRef}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {/* Selection mode toggle */}
            <div className="sticky top-0 z-10 flex items-center gap-2 py-2 px-4 bg-white border-b border-paper-200 shadow-sm">
              <button
                onClick={() => setSelectionMode('select')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
                  selectionMode === 'select'
                    ? 'bg-copper-500 text-white shadow-sm'
                    : 'bg-paper-100 text-bridge-600 hover:bg-paper-200'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.26-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.26zm8.814-.569a1 1 0 00-1.415-1.414l-.707.707a1 1 0 101.414 1.415l.708-.708zm-7.071 7.072l.707-.708A1 1 0 003.465 9.12l-.708.707a1 1 0 001.415 1.415zm3.2-5.171a1 1 0 00-1.3 1.3l4 10a1 1 0 001.823.075l1.38-2.759 3.018 3.02a1 1 0 001.414-1.415l-3.019-3.02 2.76-1.379a1 1 0 00-.076-1.822l-10-4z" />
                </svg>
                Select
              </button>
              <button
                onClick={() => setSelectionMode('box')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
                  selectionMode === 'box'
                    ? 'bg-copper-500 text-white shadow-sm'
                    : 'bg-paper-100 text-bridge-600 hover:bg-paper-200'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 2h10v10H5V5z" />
                </svg>
                Box
              </button>
              <button
                onClick={() => setSelectionMode('table')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
                  selectionMode === 'table'
                    ? 'bg-copper-500 text-white shadow-sm'
                    : 'bg-paper-100 text-bridge-600 hover:bg-paper-200'
                }`}
                title="Draw a box around a table to extract rows and columns"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 1v3h4V5H5zm6 0v3h4V5h-4zM5 10v2h4v-2H5zm6 0v2h4v-2h-4zM5 14v1h4v-1H5zm6 0v1h4v-1h-4z" clipRule="evenodd" />
                </svg>
                {isTableExtracting ? 'Extracting...' : 'Table'}
              </button>
              {data.fileType === 'pdf' && (
                <button
                  onClick={() => setSelectionMode('text')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
                    selectionMode === 'text'
                      ? 'bg-copper-500 text-white shadow-sm'
                      : 'bg-paper-100 text-bridge-600 hover:bg-paper-200'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                  </svg>
                  Text
                </button>
              )}

              {/* Divider */}
              <div className="w-px h-6 bg-paper-300 mx-2" />

              {/* Auto-detect button */}
              <button
                onClick={handleAutoDetect}
                disabled={isAutoDetecting}
                className="px-3 py-1.5 text-xs rounded-md bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {isAutoDetecting ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Detecting...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" />
                    </svg>
                    Auto-detect Fields
                  </>
                )}
              </button>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Zoom controls */}
              <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} />
            </div>

            {/* Document with overlays - CSS transform zoom (GPU, no re-render) */}
            <div className="relative p-6 flex justify-center" ref={viewerAreaRef}>
              <div
                ref={documentRef}
                className="relative bg-white shadow-lg"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top center',
                }}
              >
                <DocumentViewer
                  fileUrl={data.fileUrl ?? null}
                  fileType={data.fileType}
                  currentPage={data.currentPage}
                  totalPages={data.totalPages}
                  onPageChange={handlePageChange}
                  onDocumentLoad={handleDocumentLoad}
                  onImageRef={(ref) => {
                    imageRef.current = ref;
                  }}
                  onTextSelect={selectionMode === 'text' ? handleTextSelect : undefined}
                  onContentResize={handleContentResize}
                  onPageOffsetsChange={setPageOffsets}
                  enableTextSelection={selectionMode === 'text'}
                  width={VIEWER_WIDTH}
                  devicePixelRatio={Math.max(window.devicePixelRatio, zoom) * window.devicePixelRatio}
                  scrollMode={true}
                >
                  {/* Overlays share coordinate space at base width */}
                  {data.fileUrl && (
                    <HighlightOverlay
                      regions={data.regions}
                      currentPage={data.currentPage}
                      selectedRegionId={selectedRegionId}
                      onRegionSelect={handleRegionSelect}
                      interactive={selectionMode === 'select' || selectionMode === 'box' || selectionMode === 'table'}
                      nodeId={id}
                      scrollMode={true}
                      pageOffsets={pageOffsets}
                    />
                  )}
                </DocumentViewer>
              </div>
              {/* RegionSelector fills entire viewer area — allows drawing outside the page */}
              {data.fileUrl && (selectionMode === 'box' || selectionMode === 'table') && (
                <RegionSelector
                  onRegionCreate={handleBoxDraw}
                  documentRef={documentRef}
                  pageOffsets={pageOffsets}
                  zoom={zoom}
                />
              )}
            </div>
          </div>

          {/* Collapsible fields panel - with OCR and value editing */}
          <CollapsiblePanel
            title="Fields"
            badge={data.regions.length}
            defaultOpen={true}
            side="right"
          >
            <RegionList
              regions={data.regions}
              selectedRegionId={selectedRegionId}
              onRegionSelect={handleRegionSelect}
              onRegionDelete={handleRegionDelete}
              onRegionLabelChange={handleRegionLabelChange}
              onRegionDataTypeChange={handleRegionDataTypeChange}
              onValueChange={handleValueChange}
              onExtract={handleExtract}
              isExtracting={isExtracting}
              showOcrButton={false}
            />
          </CollapsiblePanel>
        </div>

        {/* Footer instructions */}
        <div className="px-4 py-2 bg-paper-100 border-t border-paper-200 text-xs text-bridge-500 flex items-center justify-between">
          <span>
            {selectionMode === 'select'
              ? 'Click on a highlight to select it.'
              : selectionMode === 'box'
              ? 'Draw a box to create a field.'
              : selectionMode === 'table'
              ? 'Draw a box around a table to extract rows and columns.'
              : 'Select text directly to create a field with that value.'}
          </span>
          <span className="text-bridge-400">
            {data.regions.length} field{data.regions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </Modal>

      <FilePickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onSelect={handlePickFromRegistry}
      />
    </>
  );
}
