import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useEdges, Position } from '@xyflow/react';
import { BaseNode } from './base/BaseNode';
import { DocumentViewer } from './file/DocumentViewer';
import { RegionSelector } from './file/RegionSelector';
import { HighlightOverlay } from './file/HighlightOverlay';
import { RegionList } from './file/RegionList';
import { TxnGroupList } from './file/TxnGroupList';
import { TxnGroupHandle } from './base/TxnGroupHandle';
import { FileNodePreview } from './file/FileNodePreview';
import { DocumentModal } from './file/DocumentModal';
import { CollapsiblePanel } from '../ui/CollapsiblePanel';
import { FileDropZone } from '../ui/FileDropZone';
import { extractTextFromRegion, extractFullPage, extractFullPageFromRegion, cropRegionToDataUrl, type FullPageOcrResult } from '../../core/extraction/ocrExtractor';
import { detectFields, fieldOverlapsExisting } from '../../core/extraction/fieldDetector';
import { buildTableSelectionFromOcr } from '../../core/extraction/tableParser';
import { materializeTable, materializeFromCells, type TableSelection, type MaterializedTable } from '../../core/extraction/tableMaterializer';
import { detectTableWithAI, extractTableWithAIVision } from '../../services/aiService';
import { suggestBankMapping, inferMappingFromContent, materializedTableToTxnGroup, remapBankTxnGroup, setRoleForHeader, singleTxnGroup, type BankColumnMapping, type BankColumnRole } from '../../core/sources/txnGroup';
import { useAiSettings } from '../../hooks/useAiSettings';
import { useCanvasStore } from '../../store/canvasStore';
import { useToast } from '../ui/Toast';
import { useFileNodeState } from '../../hooks/useFileNodeState';
import { useNodeOutputs } from '../../hooks/useNodeOutputs';
import { useSyncNodeOutputs } from '../../hooks/useSyncNodeOutputs';
import { getColorForType, getCompatibleTypes } from '../../utils/colors';
import { generateId } from '../../utils/id';
import { debug } from '../../utils/debug'; // see src/utils/debug.ts

const log = debug('extractor');
import { createRegionFromBox, createRegionFromText } from '../../utils/regions';
import { BlobRegistry } from '../../store/canvasPersistence';
import { FilePickerModal } from '../ui/FilePickerModal';
import type {
  ExtractorNode as ExtractorNodeType,
  NodeOutput,
  RegionCoordinates,
  ExtractedRegion,
  TableRecord,
  TextRange,
  SimpleDataType,
  DisplayNodeData,
  CachedExtractorEdges,
  DataSourceReference,
} from '../../types';

const VIEWER_WIDTH = 500;

// Confidence threshold for OCR warnings (0-100)
const LOW_CONFIDENCE_THRESHOLD = 50;

/**
 * Session-level cache of OCR snapshots per TableRecord id. Lost on reload — the
 * Extractor lazily re-OCRs from the persisted pageBbox when a separator is
 * dragged after a fresh load. Keeps node JSON small.
 */
const tableOcrCache = new Map<string, FullPageOcrResult>();

function buildRowRegions(
  table: MaterializedTable,
  selection: TableSelection,
  pageSize: { width: number; height: number },
  pageBbox: RegionCoordinates,
  pageNumber: number,
  tableId: string,
  nodeId: string,
  ocrConfidence: number,
  baseRegionIndex: number,
  reuseIds?: Map<number, string>,
): ExtractedRegion[] {
  const W = pageSize.width || pageBbox.width;
  const H = pageSize.height || pageBbox.height;
  const rowEdgesNorm = [selection.bbox.y0, ...selection.rowYs, selection.bbox.y1];
  const rowEdgesPx = rowEdgesNorm.map((y) => y * H);
  const xLeftPx = selection.bbox.x0 * W;
  const xRightPx = selection.bbox.x1 * W;
  const sx = pageBbox.width / W;
  const sy = pageBbox.height / H;

  const headerIdx = selection.headerRowIndex;
  const out: ExtractedRegion[] = [];
  let rowDisplayIndex = 0;
  for (let i = 0; i < table.rows.length + (headerIdx !== undefined ? 1 : 0); i++) {
    if (headerIdx !== undefined && i === headerIdx) continue;
    const yTop = rowEdgesPx[i];
    const yBot = rowEdgesPx[i + 1];
    const rowCoords: RegionCoordinates = {
      x: pageBbox.x + xLeftPx * sx,
      y: pageBbox.y + yTop * sy,
      width: (xRightPx - xLeftPx) * sx,
      height: (yBot - yTop) * sy,
    };
    const dataIdx = headerIdx !== undefined && i > headerIdx ? i - 1 : i;
    const cells = table.rows[dataIdx];
    if (!cells || !cells.some((c) => c.length > 0)) continue;
    const rowText = cells.join(' | ');
    const reuseId = reuseIds?.get(rowDisplayIndex);
    const base = reuseId
      ? null
      : createRegionFromBox(rowCoords, pageNumber, baseRegionIndex + out.length);
    const regionId = reuseId ?? base!.id;
    out.push({
      id: regionId,
      label: `Row ${rowDisplayIndex + 1}: ${cells[0] || ''}`.trim(),
      selectionType: 'box',
      coordinates: rowCoords,
      pageNumber,
      dataType: 'string',
      color: getColorForType('string').border,
      extractedData: {
        type: 'string',
        value: rowText,
        source: {
          nodeId,
          regionId,
          pageNumber,
          coordinates: rowCoords,
          extractionMethod: 'ocr' as const,
          confidence: ocrConfidence,
        },
      },
      tableSourceId: tableId,
      tableRowIndex: rowDisplayIndex,
    });
    rowDisplayIndex++;
  }
  return out;
}

export function ExtractorNode({ id, data, selected }: NodeProps<ExtractorNodeType>) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const replaceNode = useCanvasStore((state) => state.replaceNode);
  const removeEdge = useCanvasStore((state) => state.removeEdge);
  const addTxnGroup = useCanvasStore((state) => state.addTxnGroup);
  const updateTxnGroup = useCanvasStore((state) => state.updateTxnGroup);
  const removeTxnGroup = useCanvasStore((state) => state.removeTxnGroup);
  const getTxnGroup = useCanvasStore((state) => state.getTxnGroup);
  const edges = useEdges();
  const nodeOutputs = useNodeOutputs(id);
  const { showToast } = useToast();
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'select' | 'box' | 'text' | 'single' | 'table'>('box');
  const [singleStep, setSingleStep] = useState<'date' | 'description' | 'amount' | null>(null);
  const singleDraftRef = useRef<{ date: string; description: string; amount: string }>({ date: '', description: '', amount: '' });
  const [txnDropdownOpen, setTxnDropdownOpen] = useState(false);
  const [addingColumnFor, setAddingColumnFor] = useState<string | null>(null);
  const [isExtractingTable, setIsExtractingTable] = useState(false);
  const { activeProvider, activeConfig } = useAiSettings();
  const imageRef = useRef<HTMLImageElement | HTMLCanvasElement | null>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const lastScrolledRef = useRef<string | null>(null);

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

  const {
    viewerAreaRef,
    isModalOpen,
    openModal: baseOpenModal,
    closeModal: baseCloseModal,
    isPickerOpen,
    openPicker,
    closePicker,
    zoom,
    zoomIn,
    zoomOut,
    resetZoom,
    pdfError,
    handlePdfLoad,
    handlePdfError,
    pageOffsets,
    setPageOffsets,
    handleFileSelect,
    handleFileDrop,
    handleDragOver,
    handlePickFromRegistry,
  } = useFileNodeState(id, handleFileInit);

  const handleDocumentLoad = useCallback(
    (numPages: number) => {
      updateNodeData(id, { totalPages: numPages });
    },
    [id, updateNodeData]
  );

  const handleContentResize = useCallback(() => {}, []);

  const handlePageChange = useCallback(
    (page: number) => {
      updateNodeData(id, { currentPage: page });
    },
    [id, updateNodeData]
  );

  const handleRegionCreate = useCallback(
    (coordinates: RegionCoordinates, pageNumber?: number) => {
      const region = createRegionFromBox(
        coordinates,
        pageNumber ?? data.currentPage,
        data.regions.length
      );
      updateNodeData(id, { regions: [...data.regions, region] });
      setSelectedRegionId(region.id);
    },
    [id, data.regions, data.currentPage, updateNodeData]
  );

  const handleTableExtract = useCallback(
    async (coordinates: RegionCoordinates, pageNumber?: number) => {
      if (!data.fileUrl) {
        showToast('No document loaded', 'error');
        return;
      }
      const page = pageNumber ?? data.currentPage;

      let imageSource: HTMLImageElement | HTMLCanvasElement | string;
      if (imageRef.current) {
        imageSource = imageRef.current;
      } else if (data.fileType === 'image') {
        imageSource = data.fileUrl;
      } else {
        showToast('PDF not ready. Please wait and try again.', 'warning');
        return;
      }

      setIsExtractingTable(true);
      try {
        const ocr = await extractFullPageFromRegion(imageSource, coordinates);

        let selection: TableSelection | null = null;

        if (activeProvider && activeConfig?.apiKey) {
          try {
            const cropImage = await cropRegionToDataUrl(imageSource, coordinates);
            selection = await detectTableWithAI(
              {
                images: [cropImage],
                ocrWords: ocr.words,
                imageWidth: ocr.imageWidth,
                imageHeight: ocr.imageHeight,
                hintBbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
              },
              activeProvider.id,
              activeConfig.selectedModel,
              activeConfig.apiKey,
            );
          } catch (err) {
            console.warn('detectTableWithAI failed, falling back to heuristic:', err);
          }
        }

        const heuristicBuilt = buildTableSelectionFromOcr(ocr);

        if (!selection) {
          if (!heuristicBuilt) {
            showToast('Could not detect a table — kept selection as a box.', 'warning');
            handleRegionCreate(coordinates, page);
            return;
          }
          selection = heuristicBuilt.selection;
        } else if (
          heuristicBuilt &&
          heuristicBuilt.selection.colXs.length > selection.colXs.length
        ) {
          // AI under-segmented columns (common on dense bank statements where
          // numeric columns visually compress). Heuristic clusters word x-starts
          // across all rows and produces stricter column boundaries — prefer it
          // for colXs while keeping AI's bbox / rowYs / headerRowIndex.
          selection = {
            ...selection,
            colXs: heuristicBuilt.selection.colXs,
          };
        }

        const table = materializeTable(selection, ocr);

        const tableId = generateId('table');
        const pageSize = { width: ocr.imageWidth || coordinates.width, height: ocr.imageHeight || coordinates.height };
        tableOcrCache.set(tableId, ocr);

        const newRegions = buildRowRegions(
          table,
          selection,
          pageSize,
          coordinates,
          page,
          tableId,
          id,
          ocr.confidence,
          data.regions.length,
        );

        if (newRegions.length === 0) {
          showToast('No populated rows detected — kept selection as a box.', 'warning');
          tableOcrCache.delete(tableId);
          handleRegionCreate(coordinates, page);
          return;
        }

        // Try header-keyword mapping first; fall back to content-based
        // inference so table mode emits a TxnGroup even when OCR mangles
        // headers or the statement has no header row at all.
        let txnGroupId: string | undefined;
        const headerSuggest = suggestBankMapping(table);
        const useHeader = headerSuggest.mapping && headerSuggest.confidence >= 0.7;
        const contentSuggest = useHeader ? null : inferMappingFromContent(table);
        const finalMapping = useHeader ? headerSuggest.mapping : contentSuggest?.mapping ?? null;
        const finalSource: 'header' | 'content' | 'none' = useHeader
          ? 'header'
          : finalMapping
            ? 'content'
            : 'none';
        log('table-mapping', {
          nodeId: id,
          headers: table.headers,
          rows: table.rows.length,
          headerMapping: headerSuggest.mapping,
          headerConfidence: headerSuggest.confidence,
          contentMapping: contentSuggest?.mapping,
          contentConfidence: contentSuggest?.confidence,
          finalMapping,
          finalSource,
        });
        if (finalMapping) {
          const group = materializedTableToTxnGroup(table, finalMapping, {
            nodeId: id,
            label: data.label || 'Bank statement',
            fileId: data.fileId ?? '',
            pageRange: [page, page],
          });
          if (group.transactions.length > 0) {
            txnGroupId = addTxnGroup(group);
          }
        }

        const tableRecord: TableRecord = {
          id: tableId,
          pageNumber: page,
          pageBbox: coordinates,
          pageSize,
          selection,
          txnGroupId,
        };

        updateNodeData(id, {
          regions: [...data.regions, ...newRegions],
          tables: [...(data.tables ?? []), tableRecord],
        });
        showToast(
          `Extracted ${newRegions.length} row${newRegions.length === 1 ? '' : 's'} from table`,
          'success',
        );
      } catch (err) {
        console.error('Table extraction failed:', err);
        const msg = err instanceof Error ? err.message : 'Unknown error';
        showToast(`Table extraction failed: ${msg} — kept selection as a box.`, 'error');
        handleRegionCreate(coordinates, page);
      } finally {
        setIsExtractingTable(false);
      }
    },
    [
      id,
      data.fileUrl,
      data.fileType,
      data.currentPage,
      data.regions,
      data.tables,
      activeProvider,
      activeConfig,
      updateNodeData,
      showToast,
      data.fileId,
      data.label,
      addTxnGroup,
      handleRegionCreate,
    ],
  );

  // Re-materialize a table with an updated TableSelection and replace its rows.
  // Reuses cached OCR; lazily re-OCRs from pageBbox if the cache is cold (post-reload).
  const rematerializeTable = useCallback(
    async (tableId: string, nextSelection: TableSelection) => {
      const tableRecord = (data.tables ?? []).find((t) => t.id === tableId);
      if (!tableRecord || !data.fileUrl) return;

      let ocr = tableOcrCache.get(tableId);
      if (!ocr) {
        let imageSource: HTMLImageElement | HTMLCanvasElement | string;
        if (imageRef.current) imageSource = imageRef.current;
        else if (data.fileType === 'image') imageSource = data.fileUrl;
        else {
          showToast('PDF not ready. Please reopen the document.', 'warning');
          return;
        }
        ocr = await extractFullPageFromRegion(imageSource, tableRecord.pageBbox);
        tableOcrCache.set(tableId, ocr);
      }

      const table = materializeTable(nextSelection, ocr);

      // Reuse ids from existing rows of this table where possible to avoid identity churn.
      const existingRows = data.regions
        .filter((r) => r.tableSourceId === tableId)
        .sort((a, b) => (a.tableRowIndex ?? 0) - (b.tableRowIndex ?? 0));
      const reuseIds = new Map<number, string>();
      existingRows.forEach((r, i) => reuseIds.set(i, r.id));

      const newRows = buildRowRegions(
        table,
        nextSelection,
        tableRecord.pageSize,
        tableRecord.pageBbox,
        tableRecord.pageNumber,
        tableId,
        id,
        ocr.confidence,
        data.regions.length,
        reuseIds,
      );

      const otherRegions = data.regions.filter((r) => r.tableSourceId !== tableId);
      const nextTables = (data.tables ?? []).map((t) =>
        t.id === tableId ? { ...t, selection: nextSelection } : t,
      );
      updateNodeData(id, {
        regions: [...otherRegions, ...newRows],
        tables: nextTables,
      });
    },
    [id, data.fileUrl, data.fileType, data.regions, data.tables, updateNodeData, showToast],
  );

  // Drag a row's top or bottom edge: mutate the corresponding rowYs separator
  // and re-materialize. deltaY is in page pixel space.
  const handleRowEdgeDrag = useCallback(
    (regionId: string, edge: 'top' | 'bottom', deltaY: number) => {
      const region = data.regions.find((r) => r.id === regionId);
      if (!region || !region.tableSourceId || region.tableRowIndex === undefined) return;
      const tableRecord = (data.tables ?? []).find((t) => t.id === region.tableSourceId);
      if (!tableRecord) return;

      const rowIndex = region.tableRowIndex; // among emitted (non-header, non-empty) rows
      // Translate the emitted row index back to the materialized row index, accounting for header.
      // Approximation: assume no skipped (empty) rows in the materialized output.
      const headerIdx = tableRecord.selection.headerRowIndex;
      const matRowIndex =
        headerIdx !== undefined && rowIndex >= headerIdx ? rowIndex + 1 : rowIndex;
      // rowYs separators are between materialized rows: rowYs[i] separates row i from i+1.
      const sepIdx = edge === 'top' ? matRowIndex - 1 : matRowIndex;
      if (sepIdx < 0 || sepIdx >= tableRecord.selection.rowYs.length) return;

      const dyNorm = deltaY / tableRecord.pageBbox.height;
      const nextRowYs = [...tableRecord.selection.rowYs];
      const lower = sepIdx > 0 ? nextRowYs[sepIdx - 1] : tableRecord.selection.bbox.y0;
      const upper =
        sepIdx < nextRowYs.length - 1 ? nextRowYs[sepIdx + 1] : tableRecord.selection.bbox.y1;
      const candidate = nextRowYs[sepIdx] + dyNorm;
      const minGap = 0.005;
      nextRowYs[sepIdx] = Math.min(upper - minGap, Math.max(lower + minGap, candidate));

      const nextSelection: TableSelection = { ...tableRecord.selection, rowYs: nextRowYs };
      void rematerializeTable(tableRecord.id, nextSelection);
    },
    [data.regions, data.tables, rematerializeTable],
  );

  const txnGroupIds = useMemo(() => {
    const ids: string[] = [];
    for (const gid of data.singleTxnGroupIds ?? []) ids.push(gid);
    for (const t of data.tables ?? []) {
      if (t.txnGroupId) ids.push(t.txnGroupId);
    }
    return ids;
  }, [data.singleTxnGroupIds, data.tables]);

  const applyColumnSelection = useCallback(
    (tableId: string, nextSelection: TableSelection) => {
      const tableRecord = (data.tables ?? []).find((t) => t.id === tableId);
      if (!tableRecord) return;
      void rematerializeTable(tableId, nextSelection);

      const groupId = tableRecord.txnGroupId;
      if (!groupId) return;
      const ocr = tableOcrCache.get(tableId);
      const group = getTxnGroup(groupId);
      if (!ocr || !group) return;
      const table = materializeTable(nextSelection, ocr, tableRecord.pageSize);

      // Re-run bank mapping against the new columns so date/desc/amount get
      // re-derived. Without this, raw cells update but the structured fields
      // keep stale values from the old (under-segmented) columns.
      const headerSuggest = suggestBankMapping(table);
      const useHeader = headerSuggest.mapping && headerSuggest.confidence >= 0.7;
      const contentSuggest = useHeader ? null : inferMappingFromContent(table);
      const finalMapping = useHeader ? headerSuggest.mapping : contentSuggest?.mapping ?? null;

      if (finalMapping) {
        const remapped = materializedTableToTxnGroup(table, finalMapping, {
          nodeId: id,
          label: group.label,
          fileId: data.fileId ?? '',
          pageRange: (group.origin.kind === 'bank' ? group.origin.pageRange : undefined) ?? [1, 1],
        });
        if (remapped.transactions.length > 0) {
          updateTxnGroup(groupId, {
            label: group.label,
            transactions: remapped.transactions,
            origin: remapped.origin,
          });
          return;
        }
      }

      // Fallback: only update raw cells if mapping fails (preserve prior fields)
      const headerIdx = nextSelection.headerRowIndex;
      const headers =
        headerIdx !== undefined ? table.rows[headerIdx] : table.headers.length ? table.headers : table.rows[0]?.map((_, i) => `Column ${i + 1}`) ?? [];
      const dataRows = table.rows.filter((_, i) => i !== headerIdx);
      const transactions = group.transactions.map((t, i) => {
        const row = dataRows[i];
        if (!row) return t;
        const raw: Record<string, string> = {};
        headers.forEach((h, ci) => { raw[h || `Column ${ci + 1}`] = row[ci] ?? ''; });
        return { ...t, raw };
      });
      updateTxnGroup(groupId, {
        transactions,
        origin: { ...group.origin, sourceHeaders: headers.map((h, i) => h || `Column ${i + 1}`) },
      });
    },
    [data.tables, rematerializeTable, getTxnGroup, updateTxnGroup],
  );

  const handleColumnEdgeDrag = useCallback(
    (tableId: string, colIndex: number, deltaX: number) => {
      const tableRecord = (data.tables ?? []).find((t) => t.id === tableId);
      if (!tableRecord) return;
      const sel = tableRecord.selection;
      if (colIndex < 0 || colIndex >= sel.colXs.length) return;
      const dxNorm = deltaX / tableRecord.pageBbox.width;
      const nextColXs = [...sel.colXs];
      const lower = colIndex > 0 ? nextColXs[colIndex - 1] : sel.bbox.x0;
      const upper = colIndex < nextColXs.length - 1 ? nextColXs[colIndex + 1] : sel.bbox.x1;
      const minGap = 0.005;
      const candidate = nextColXs[colIndex] + dxNorm;
      nextColXs[colIndex] = Math.min(upper - minGap, Math.max(lower + minGap, candidate));
      applyColumnSelection(tableId, { ...sel, colXs: nextColXs });
    },
    [data.tables, applyColumnSelection],
  );

  const handleColumnInsert = useCallback(
    (tableId: string, normalizedX: number) => {
      const tableRecord = (data.tables ?? []).find((t) => t.id === tableId);
      if (!tableRecord) return;
      const sel = tableRecord.selection;
      const minGap = 0.005;
      if (normalizedX <= sel.bbox.x0 + minGap || normalizedX >= sel.bbox.x1 - minGap) return;
      if (sel.colXs.some((cx) => Math.abs(cx - normalizedX) < minGap)) return;
      const nextColXs = [...sel.colXs, normalizedX].sort((a, b) => a - b);
      applyColumnSelection(tableId, { ...sel, colXs: nextColXs });
    },
    [data.tables, applyColumnSelection],
  );

  const handleAutoFixColumns = useCallback(
    async (tableId: string) => {
      console.log('[auto-fix] click', { tableId });
      const tableRecord = (data.tables ?? []).find((t) => t.id === tableId);
      if (!tableRecord) {
        showToast('Table not found', 'error');
        return;
      }
      if (!activeProvider || !activeConfig?.apiKey) {
        showToast('Configure an AI provider in settings first', 'warning');
        return;
      }
      let imageSource: HTMLImageElement | HTMLCanvasElement | string;
      if (imageRef.current) imageSource = imageRef.current;
      else if (data.fileType === 'image' && data.fileUrl) imageSource = data.fileUrl;
      else { showToast('Document not ready', 'warning'); return; }

      showToast('Asking AI to read the table…', 'info');
      const cropImage = await cropRegionToDataUrl(imageSource, tableRecord.pageBbox);

      // First: try AI vision direct read — it bypasses OCR entirely and reads
      // cell text straight from the image. Far more robust on low-quality scans
      // than Tesseract+heuristic, but costs one extra Gemini call per auto-fix.
      try {
        const visionResult = await extractTableWithAIVision(
          { images: [cropImage], hintBbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
          activeProvider.id,
          activeConfig.selectedModel,
          activeConfig.apiKey,
        );
        const newSelection = visionResult.selection;
        const pageSize = tableRecord.pageSize;
        const aiTable = materializeFromCells(newSelection, visionResult.cells, pageSize);

        // Re-run bank mapping on the freshly-read text.
        const headerSuggest = suggestBankMapping(aiTable);
        const useHeader = headerSuggest.mapping && headerSuggest.confidence >= 0.65;
        const contentSuggest = useHeader ? null : inferMappingFromContent(aiTable);
        const finalMapping = useHeader ? headerSuggest.mapping : contentSuggest?.mapping ?? null;

        const existingGroupId = tableRecord.txnGroupId;
        const existingGroup = existingGroupId ? getTxnGroup(existingGroupId) : null;
        let nextGroupId: string | undefined = existingGroupId;
        if (finalMapping) {
          const labelForGroup = existingGroup?.label ?? data.label ?? 'Bank statement';
          const pageRangeForGroup =
            (existingGroup?.origin.kind === 'bank' ? existingGroup.origin.pageRange : undefined) ??
            [tableRecord.pageNumber, tableRecord.pageNumber];
          const built = materializedTableToTxnGroup(aiTable, finalMapping, {
            nodeId: id,
            label: labelForGroup,
            fileId: data.fileId ?? '',
            pageRange: pageRangeForGroup,
          });
          if (built.transactions.length > 0) {
            if (existingGroupId && existingGroup) {
              updateTxnGroup(existingGroupId, {
                label: existingGroup.label,
                transactions: built.transactions,
                origin: built.origin,
              });
            } else {
              // No txnGroup yet (initial extract didn't find a mapping). Create one
              // now so the auto-fixed bank-statement data isn't silently dropped.
              nextGroupId = addTxnGroup(built);
            }
          }
        }

        // Rebuild row regions from the new selection so highlight boxes match.
        const newRows = buildRowRegions(
          aiTable,
          newSelection,
          pageSize,
          tableRecord.pageBbox,
          tableRecord.pageNumber,
          tableId,
          id,
          100,
          data.regions.length,
        );
        const otherRegions = data.regions.filter((r) => r.tableSourceId !== tableId);
        const nextTables = (data.tables ?? []).map((t) =>
          t.id === tableId ? { ...t, selection: newSelection, txnGroupId: nextGroupId } : t,
        );
        updateNodeData(id, {
          regions: [...otherRegions, ...newRows],
          tables: nextTables,
        });

        showToast(`AI read ${aiTable.rows.length} row${aiTable.rows.length === 1 ? '' : 's'}`, 'success');
        return;
      } catch (err) {
        console.warn('[auto-fix] AI vision read failed, falling back to OCR + column-detect path', err);
      }

      // Fallback: original OCR + column-detection path.
      let ocr = tableOcrCache.get(tableId);
      if (!ocr) ocr = await extractFullPageFromRegion(imageSource, tableRecord.pageBbox);
      tableOcrCache.set(tableId, ocr);

      let detected: TableSelection | null = null;
      try {
        console.log('[auto-fix] sending', {
          provider: activeProvider.id,
          model: activeConfig.selectedModel,
          ocrWords: ocr.words.length,
          imageBytes: cropImage.base64.length,
          currentColXs: tableRecord.selection.colXs,
        });
        detected = await detectTableWithAI(
          {
            images: [cropImage],
            ocrWords: ocr.words,
            imageWidth: ocr.imageWidth,
            imageHeight: ocr.imageHeight,
            hintBbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
          },
          activeProvider.id,
          activeConfig.selectedModel,
          activeConfig.apiKey,
        );
        console.log('[auto-fix] response', detected);
      } catch (err) {
        console.warn('[auto-fix] AI failed, will fall back to OCR heuristic', err);
      }

      // Always compute heuristic; use it if AI failed or under-segmented.
      const heuristicBuilt = buildTableSelectionFromOcr(ocr);
      const aiCols = detected?.colXs?.length ?? 0;
      const heuristicCols = heuristicBuilt?.selection.colXs.length ?? 0;

      let finalColXs: number[];
      let finalRowYs: number[];
      let finalHeaderRowIndex: number | undefined;
      if (heuristicCols > aiCols && heuristicBuilt) {
        finalColXs = heuristicBuilt.selection.colXs;
        finalRowYs = heuristicBuilt.selection.rowYs.length
          ? heuristicBuilt.selection.rowYs
          : detected?.rowYs.length
            ? detected.rowYs
            : tableRecord.selection.rowYs;
        finalHeaderRowIndex = heuristicBuilt.selection.headerRowIndex ?? detected?.headerRowIndex ?? tableRecord.selection.headerRowIndex;
        console.log('[auto-fix] using heuristic colXs', finalColXs);
      } else if (detected && aiCols > 0) {
        finalColXs = detected.colXs;
        finalRowYs = detected.rowYs.length ? detected.rowYs : tableRecord.selection.rowYs;
        finalHeaderRowIndex = detected.headerRowIndex ?? tableRecord.selection.headerRowIndex;
      } else {
        showToast('Could not detect columns from AI or OCR', 'error');
        return;
      }

      applyColumnSelection(tableId, {
        ...tableRecord.selection,
        colXs: finalColXs,
        rowYs: finalRowYs,
        headerRowIndex: finalHeaderRowIndex,
      });
      showToast(`Set ${finalColXs.length + 1} columns`, 'success');
    },
    [
      id,
      data.tables,
      data.fileType,
      data.fileUrl,
      data.fileId,
      data.label,
      data.regions,
      activeProvider,
      activeConfig,
      applyColumnSelection,
      getTxnGroup,
      updateTxnGroup,
      addTxnGroup,
      updateNodeData,
      showToast,
    ],
  );

  const handleColumnDelete = useCallback(
    (tableId: string, colIndex: number) => {
      const tableRecord = (data.tables ?? []).find((t) => t.id === tableId);
      if (!tableRecord) return;
      const sel = tableRecord.selection;
      if (colIndex < 0 || colIndex >= sel.colXs.length) return;
      const nextColXs = sel.colXs.filter((_, i) => i !== colIndex);
      applyColumnSelection(tableId, { ...sel, colXs: nextColXs });
    },
    [data.tables, applyColumnSelection],
  );

  const handleAddColumn = useCallback(
    async (coordinates: RegionCoordinates) => {
      const tableId = addingColumnFor;
      if (!tableId) return;
      const tableRecord = (data.tables ?? []).find((t) => t.id === tableId);
      if (!tableRecord || !tableRecord.txnGroupId) {
        setAddingColumnFor(null);
        return;
      }
      const groupId = tableRecord.txnGroupId;
      const group = getTxnGroup(groupId);
      if (!group) {
        setAddingColumnFor(null);
        return;
      }

      let imageSource: HTMLImageElement | HTMLCanvasElement | string;
      if (imageRef.current) imageSource = imageRef.current;
      else if (data.fileType === 'image' && data.fileUrl) imageSource = data.fileUrl;
      else {
        showToast('PDF not ready. Please wait and try again.', 'warning');
        return;
      }

      try {
        const ocr = await extractFullPageFromRegion(imageSource, coordinates);
        const sel = tableRecord.selection;
        const tableBbox = tableRecord.pageBbox;
        const rowEdges = [sel.bbox.y0, ...sel.rowYs, sel.bbox.y1];
        const numRows = rowEdges.length - 1;

        // Map a y in OCR-strip pixel space → normalized y inside the table's pageBbox.
        const stripYToTableNorm = (yPx: number): number => {
          const yInPage = coordinates.y + (yPx / ocr.imageHeight) * coordinates.height;
          return (yInPage - tableBbox.y) / tableBbox.height;
        };

        const cellWords: string[][] = Array.from({ length: numRows }, () => []);
        for (const w of ocr.words) {
          const cy = (w.bbox.y0 + w.bbox.y1) / 2;
          const yNorm = stripYToTableNorm(cy);
          if (yNorm < sel.bbox.y0 || yNorm > sel.bbox.y1) continue;
          let row = numRows - 1;
          for (let i = 0; i < rowEdges.length - 1; i++) {
            if (yNorm < rowEdges[i + 1]) { row = i; break; }
          }
          cellWords[row].push(w.text);
        }
        const cellTexts = cellWords.map((ws) => ws.join(' ').trim());

        const headerIdx = sel.headerRowIndex;
        let headerName =
          headerIdx !== undefined && cellTexts[headerIdx] ? cellTexts[headerIdx] : '';
        const promptDefault = headerName || `Column ${(group.origin.sourceHeaders?.length ?? 0) + 1}`;
        const userName = window.prompt('Column name?', promptDefault);
        if (!userName || !userName.trim()) {
          setAddingColumnFor(null);
          return;
        }
        headerName = userName.trim();

        // Drop the header row from data cells if present, mirroring buildRowRegions.
        const dataCells: string[] = [];
        for (let i = 0; i < cellTexts.length; i++) {
          if (i === headerIdx) continue;
          dataCells.push(cellTexts[i]);
        }

        const transactions = group.transactions.map((t, i) => ({
          ...t,
          raw: { ...(t.raw ?? {}), [headerName]: dataCells[i] ?? '' },
        }));
        const sourceHeaders = [...(group.origin.sourceHeaders ?? []), headerName];
        updateTxnGroup(groupId, {
          transactions,
          origin: { ...group.origin, sourceHeaders },
        });

        showToast(`Added column "${headerName}"`, 'success');
      } catch (err) {
        console.error('Add column failed:', err);
        showToast('Could not OCR the column strip.', 'error');
      } finally {
        setAddingColumnFor(null);
      }
    },
    [addingColumnFor, data.tables, data.fileType, data.fileUrl, getTxnGroup, updateTxnGroup, showToast],
  );

  const handleSingleStepCreate = useCallback(
    async (coordinates: RegionCoordinates, _pageNumber?: number) => {
      const step = singleStep ?? 'date';
      if (!data.fileUrl) {
        showToast('Document not loaded', 'warning');
        return;
      }

      let value = '';
      try {
        const result = await extractTextFromRegion(data.fileUrl, coordinates);
        value = String(result.dataValue.value ?? '');
      } catch (err) {
        console.warn('Single-mode OCR failed:', err);
        showToast('OCR failed for this selection', 'error');
        return;
      }

      singleDraftRef.current = { ...singleDraftRef.current, [step]: value };

      if (step !== 'amount') {
        const next = step === 'date' ? 'description' : 'amount';
        setSingleStep(next);
        showToast(`${step}: ${value || '(empty)'}`, 'info');
        return;
      }

      // Final step — assemble the TxnGroup and add it to the store.
      const draft = singleDraftRef.current;
      const group = singleTxnGroup({
        nodeId: id,
        label: data.label || 'Single transaction',
        date: draft.date,
        description: draft.description,
        amount: draft.amount,
      });
      if (!group) {
        showToast(`Couldn't parse amount "${draft.amount}"`, 'error');
        return;
      }
      const newId = addTxnGroup(group);
      const existing = data.singleTxnGroupIds ?? [];
      updateNodeData(id, { singleTxnGroupIds: [...existing, newId] });
      singleDraftRef.current = { date: '', description: '', amount: '' };
      setSingleStep(null);
      setSelectionMode('select');
      showToast('Single transaction added', 'success');
    },
    [singleStep, data.fileUrl, data.label, data.singleTxnGroupIds, id, addTxnGroup, updateNodeData, showToast],
  );

  const handleBoxOrTableCreate = useCallback(
    (coordinates: RegionCoordinates, pageNumber?: number) => {
      if (addingColumnFor) {
        void handleAddColumn(coordinates);
      } else if (selectionMode === 'table') {
        void handleTableExtract(coordinates, pageNumber);
      } else if (selectionMode === 'single') {
        void handleSingleStepCreate(coordinates, pageNumber);
      } else {
        handleRegionCreate(coordinates, pageNumber);
      }
    },
    [addingColumnFor, handleAddColumn, selectionMode, handleTableExtract, handleRegionCreate, handleSingleStepCreate],
  );

  const handleTxnGroupAddColumn = useCallback(
    (groupId: string) => {
      const table = (data.tables ?? []).find((t) => t.txnGroupId === groupId);
      if (!table) return;
      setAddingColumnFor(table.id);
    },
    [data.tables],
  );

  const handleTxnGroupTxnEdit = useCallback(
    (
      groupId: string,
      txnId: string,
      patch: { date?: string; description?: string; amount?: number; raw?: Record<string, string> },
    ) => {
      const group = getTxnGroup(groupId);
      if (!group) return;
      const transactions = group.transactions.map((t) =>
        t.id === txnId
          ? { ...t, ...patch, raw: patch.raw ? { ...(t.raw ?? {}), ...patch.raw } : t.raw }
          : t,
      );
      updateTxnGroup(groupId, { transactions, edited: true });
    },
    [getTxnGroup, updateTxnGroup],
  );

  const handleTxnGroupMappingChange = useCallback(
    (groupId: string, header: string, role: BankColumnRole | null) => {
      const group = getTxnGroup(groupId);
      if (!group || group.origin.kind !== 'bank') return;
      const current: BankColumnMapping = group.origin.mapping ?? { date: '', description: '' };
      const nextMapping = setRoleForHeader(header, role, current);
      const remapped = remapBankTxnGroup(group, nextMapping, id);
      updateTxnGroup(groupId, {
        transactions: remapped.transactions,
        origin: remapped.origin,
        edited: true,
      });
    },
    [getTxnGroup, updateTxnGroup, id],
  );

  const handleTxnGroupRename = useCallback(
    (groupId: string, label: string) => {
      updateTxnGroup(groupId, { label });
    },
    [updateTxnGroup],
  );

  const handleTxnGroupDelete = useCallback(
    (groupId: string) => {
      const group = getTxnGroup(groupId);
      if (!group) return;
      if (group.origin.kind === 'invoice') {
        const remaining = (data.singleTxnGroupIds ?? []).filter((gid) => gid !== groupId);
        updateNodeData(id, { singleTxnGroupIds: remaining });
        removeTxnGroup(groupId);
      } else if (group.origin.kind === 'bank') {
        const table = (data.tables ?? []).find((t) => t.txnGroupId === groupId);
        if (!table) return;
        updateNodeData(id, {
          regions: data.regions.filter((r) => r.tableSourceId !== table.id),
          tables: (data.tables ?? []).filter((t) => t.id !== table.id),
        });
        removeTxnGroup(groupId);
      }
    },
    [id, data.tables, data.singleTxnGroupIds, updateNodeData, getTxnGroup, removeTxnGroup],
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
      baseOpenModal();
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

  const handleAutoDetect = useCallback(async () => {
    if (!data.fileUrl) {
      showToast('No document loaded', 'error');
      return;
    }

    // Determine the image source to use for OCR
    // For images, we can use the file URL directly if the ref isn't available
    // For PDFs, we need the canvas ref
    let imageSource: HTMLImageElement | HTMLCanvasElement | string;
    if (imageRef.current) {
      imageSource = imageRef.current;
    } else if (data.fileType === 'image') {
      // Fall back to URL for images
      imageSource = data.fileUrl;
    } else {
      showToast('PDF not ready. Please wait and try again.', 'warning');
      return;
    }

    setIsAutoDetecting(true);
    try {
      // 1. Run full-page OCR
      const ocrResult = await extractFullPage(imageSource);

      // 2. Detect fields
      const detectedFields = detectFields(ocrResult);

      if (detectedFields.length === 0) {
        showToast('No fields detected. Try manual selection.', 'warning');
        return;
      }

      // 3. Filter out fields that overlap with existing regions
      const existingCoordinates = data.regions
        .filter((r) => r.coordinates && r.pageNumber === data.currentPage)
        .map((r) => r.coordinates!);

      const newFields = detectedFields.filter(
        (field) => !fieldOverlapsExisting(field, existingCoordinates, 0.8)
      );

      if (newFields.length === 0) {
        showToast('All detected fields overlap with existing regions.', 'info');
        return;
      }

      // 4. Convert to regions
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

      // 5. Add to existing regions
      updateNodeData(id, {
        regions: [...data.regions, ...newRegions],
      });

      // 6. Show feedback with confidence warning if needed
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
      showToast('Auto-detection failed. Please try again.', 'error');
    } finally {
      setIsAutoDetecting(false);
    }
  }, [id, data.fileUrl, data.fileType, data.regions, data.currentPage, updateNodeData, showToast]);

  useEffect(() => {
    if (!addingColumnFor) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddingColumnFor(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addingColumnFor]);

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
    baseOpenModal();
  }, [data.fileType, baseOpenModal]);

  const closeModal = useCallback(() => {
    baseCloseModal();
    setIsFullscreen(false);
  }, [baseCloseModal]);

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
          onDrop={handleFileDrop}
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
                onDrop={handleFileDrop}
                onDragOver={handleDragOver}
                compact
                onPickFromRegistry={openPicker}
              />
            </div>
          )}
        </div>

        {/* Single-transaction TxnGroup handles — one per Single-mode capture. */}
        {(data.singleTxnGroupIds ?? []).map((gid, i) => (
          <TxnGroupHandle
            key={`txngroup-single-${gid}`}
            name={gid}
            handleType="source"
            handlePosition={Position.Right}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0 py-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500 text-white flex-shrink-0">
                Txn
              </span>
              <span className="text-xs font-medium text-emerald-800 truncate">Single {i + 1}</span>
            </div>
          </TxnGroupHandle>
        ))}

        {/* TxnGroup handles - one per detected bank statement table */}
        {(data.tables ?? [])
          .filter((t) => t.txnGroupId)
          .map((t) => (
            <TxnGroupHandle
              key={`txngroup-${t.id}`}
              name={t.txnGroupId!}
              handleType="source"
              handlePosition={Position.Right}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0 py-1">
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500 text-white flex-shrink-0">
                  Txn
                </span>
                <span className="text-xs font-medium text-emerald-800 truncate">
                  Bank statement
                </span>
                <span className="text-[10px] text-bridge-400">
                  p{t.pageNumber}
                </span>
              </div>
            </TxnGroupHandle>
          ))}

        {/* Compact region list with values - no OCR button here */}
        <RegionList
          regions={data.regions}
          selectedRegionId={selectedRegionId}
          onRegionSelect={handleRegionSelect}
          onRegionDelete={handleRegionDelete}
          onRegionLabelChange={handleRegionLabelChange}
          onRegionDataTypeChange={handleRegionDataTypeChange}
          compact
          nodeId={id}
        />
      </BaseNode>

      {/* Document viewer modal with side panel */}
      <DocumentModal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={data.fileName || 'Document Viewer'}
        viewerAreaRef={viewerAreaRef}
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
        fullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen((f) => !f)}
        toolbar={
          <>
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
              <div className="relative">
                <button
                  onClick={() => setTxnDropdownOpen((v) => !v)}
                  disabled={isExtractingTable}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
                    selectionMode === 'single' || selectionMode === 'table'
                      ? 'bg-copper-500 text-white shadow-sm'
                      : 'bg-paper-100 text-bridge-600 hover:bg-paper-200'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isExtractingTable ? (
                    <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 1v3h4V5H5zm6 0v3h4V5h-4zM5 10v3h4v-3H5zm6 0v3h4v-3h-4zM5 15v1h4v-1H5zm6 0v1h4v-1h-4z" clipRule="evenodd" />
                    </svg>
                  )}
                  Txns
                  {selectionMode === 'single' && (
                    <span className="opacity-80">: Single{singleStep ? ` → ${singleStep}` : ''}</span>
                  )}
                  {selectionMode === 'table' && <span className="opacity-80">: Table</span>}
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                {txnDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setTxnDropdownOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 w-44 bg-white border border-paper-200 rounded-md shadow-lg z-20">
                      <button
                        onClick={() => { setSelectionMode('single'); setSingleStep('date'); setTxnDropdownOpen(false); }}
                        className={`w-full px-3 py-2 text-xs text-left hover:bg-paper-100 ${selectionMode === 'single' ? 'text-copper-600 font-medium' : 'text-bridge-700'}`}
                      >
                        <div>Single select</div>
                        <div className="text-[10px] text-bridge-400">Tag a region as date / desc / amount</div>
                      </button>
                      <button
                        onClick={() => { setSelectionMode('table'); setTxnDropdownOpen(false); }}
                        className={`w-full px-3 py-2 text-xs text-left hover:bg-paper-100 border-t border-paper-100 ${selectionMode === 'table' ? 'text-copper-600 font-medium' : 'text-bridge-700'}`}
                      >
                        <div>Table</div>
                        <div className="text-[10px] text-bridge-400">Detect rows from a table region</div>
                      </button>
                    </div>
                  </>
                )}
              </div>
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
          </>
        }
        panel={
          <div className="flex flex-col border-l border-paper-200 w-72 h-full min-h-0">
            <CollapsiblePanel
              title="Fields"
              badge={data.regions.length}
              defaultOpen={true}
              orientation="vertical"
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
            <CollapsiblePanel
              title="Transaction Groups"
              badge={txnGroupIds.length}
              defaultOpen={true}
              orientation="vertical"
              className="border-t border-paper-200"
            >
              <TxnGroupList
                groupIds={txnGroupIds}
                onRename={handleTxnGroupRename}
                onDelete={handleTxnGroupDelete}
                onTxnEdit={handleTxnGroupTxnEdit}
                onAddColumn={handleTxnGroupAddColumn}
                onMappingChange={handleTxnGroupMappingChange}
                onAutoFixColumns={(groupId) => {
                  const t = (data.tables ?? []).find((tt) => tt.txnGroupId === groupId);
                  if (t) void handleAutoFixColumns(t.id);
                }}
              />
            </CollapsiblePanel>
          </div>
        }
        footer={
          <div className="px-4 py-2 bg-paper-100 border-t border-paper-200 text-xs text-bridge-500 flex items-center justify-between">
            <span>
              {addingColumnFor
                ? 'Draw a vertical strip aligned with table rows to add a new column. Esc to cancel.'
                : selectionMode === 'select'
                ? 'Click on a highlight to select it.'
                : selectionMode === 'box'
                ? 'Draw a box to create a field.'
                : selectionMode === 'single'
                ? 'Draw boxes for date, then description, then amount.'
                : selectionMode === 'table'
                ? 'Draw a box around a table to extract its rows.'
                : 'Select text directly to create a field with that value.'}
            </span>
            <span className="text-bridge-400">
              {data.regions.length} field{data.regions.length !== 1 ? 's' : ''}
            </span>
          </div>
        }
      >
        <div className="relative p-6 flex justify-center">
          <div
            ref={documentRef}
            className="relative bg-white shadow-lg"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
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
              {data.fileUrl && (
                <HighlightOverlay
                  regions={data.regions}
                  currentPage={data.currentPage}
                  selectedRegionId={selectedRegionId}
                  onRegionSelect={handleRegionSelect}
                  interactive={selectionMode === 'select' || selectionMode === 'box' || selectionMode === 'table' || selectionMode === 'single' || !!addingColumnFor}
                  nodeId={id}
                  scrollMode={true}
                  pageOffsets={pageOffsets}
                  onRowEdgeDrag={handleRowEdgeDrag}
                  onColumnEdgeDrag={handleColumnEdgeDrag}
                  onColumnInsert={handleColumnInsert}
                  onColumnDelete={handleColumnDelete}
                  tables={data.tables}
                />
              )}
            </DocumentViewer>
            {/* Selection overlay lives INSIDE the scaled document so it
                covers the full visible bounds at any zoom. Outside, CSS
                transforms don't affect layout, so an inset-0 sibling would
                only catch clicks on the un-zoomed footprint and overflowed
                drags would fall through to the modal's scroll container. */}
            {data.fileUrl && (selectionMode === 'box' || selectionMode === 'table' || selectionMode === 'single' || !!addingColumnFor) && (
              <RegionSelector
                onRegionCreate={handleBoxOrTableCreate}
                documentRef={documentRef}
                pageOffsets={pageOffsets}
                zoom={zoom}
              />
            )}
          </div>
        </div>
      </DocumentModal>

      <FilePickerModal
        isOpen={isPickerOpen}
        onClose={closePicker}
        onSelect={handlePickFromRegistry}
      />
    </>
  );
}
