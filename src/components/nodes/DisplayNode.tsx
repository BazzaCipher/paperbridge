import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useEdges, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base/BaseNode';
import { DocumentViewer } from './file/DocumentViewer';
import { RegionSelector } from './file/RegionSelector';
import { HighlightOverlay } from './file/HighlightOverlay';
import { ViewportList } from './file/ViewportList';
import { FileNodePreview } from './file/FileNodePreview';
import { DocumentModal } from './file/DocumentModal';
import { CollapsiblePanel } from '../ui/CollapsiblePanel';
import { FileDropZone } from '../ui/FileDropZone';
import { useCanvasStore } from '../../store/canvasStore';
import { useFileNodeState } from '../../hooks/useFileNodeState';
import { useNodeOutputs } from '../../hooks/useNodeOutputs';
import { useSyncNodeOutputs } from '../../hooks/useSyncNodeOutputs';
import { BlobRegistry } from '../../store/canvasPersistence';
import { generateId } from '../../utils/id';
import { FilePickerModal } from '../ui/FilePickerModal';
import type {
  DisplayNode as DisplayNodeType,
  ExtractorNodeData,
  NodeOutput,
  RegionCoordinates,
  ViewportRegion,
  ViewportNodeData,
  ExtractedRegion,
} from '../../types';
import { createImageView, createPdfView } from '../../types';

const VIEWER_WIDTH = 500;
const DEFAULT_WIDTH = 300;

export function DisplayNode({ id, data, selected }: NodeProps<DisplayNodeType>) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const replaceNode = useCanvasStore((state) => state.replaceNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const storeAddNode = useCanvasStore((state) => state.addNode);
  const removeEdge = useCanvasStore((state) => state.removeEdge);
  const edges = useEdges();
  const { getNode } = useReactFlow();
  const nodeOutputs = useNodeOutputs(id);

  const [selectedViewportId, setSelectedViewportId] = useState<string | null>(null);
  const [singlePageSize, setSinglePageSize] = useState<{ width: number; height: number } | null>(null);

  // Get current page number from view target
  const currentPage = data.view.target.type === 'page' ? data.view.target.pageNumber : 1;
  const viewports = data.viewports || [];

  // Map viewports to ExtractedRegion shape for HighlightOverlay reuse
  const viewportAsRegions: ExtractedRegion[] = useMemo(
    () =>
      viewports.map((v) => ({
        id: v.id,
        label: v.label,
        selectionType: 'box' as const,
        coordinates: v.pixelRect,
        pageNumber: v.pageNumber,
        extractedData: { type: 'string' as const, value: '' },
        dataType: 'string' as const,
        color: '#c27350',
      })),
    [viewports]
  );

  // Track viewer container dimensions for normalizing coordinates
  const viewerContainerRef = useRef<{ width: number; height: number }>({
    width: VIEWER_WIDTH,
    height: 400,
  });

  // ── Populate Exportable.outputs from viewports ──────────────────────────────
  const outputs = useMemo(() => {
    const map: Record<string, NodeOutput> = {};
    for (const viewport of viewports) {
      // Serialize viewport data as a JSON string for transport through the data flow system
      const value = JSON.stringify({
        fileUrl: data.fileUrl,
        fileType: data.fileType,
        normalizedRect: viewport.normalizedRect,
        pageNumber: viewport.pageNumber,
      });

      map[viewport.id] = {
        value,
        dataType: 'string',
        label: viewport.label,
      };
    }
    return map;
  }, [viewports, data.fileUrl, data.fileType]);

  useSyncNodeOutputs(
    Object.keys(outputs).length > 0 ? outputs : undefined,
    nodeOutputs
  );

  // ── File handling ──────────────────────────────────────────────────────────
  const handleFileInit = useCallback(
    (fileData: { fileUrl: string; fileId: string; fileName: string; fileType: 'pdf' | 'image' }, blobUrl: string) => {
      if (fileData.fileType === 'image') {
        const img = new Image();
        img.onload = () => {
          const aspectRatio = img.naturalWidth / img.naturalHeight;
          let width = DEFAULT_WIDTH;
          let height = width / aspectRatio;
          if (height > 600) {
            height = 600;
            width = height * aspectRatio;
          }
          updateNodeData(id, {
            ...fileData,
            view: createImageView(Math.round(width), Math.round(height)),
            totalPages: 1,
            viewports: [],
            documentSize: { width: img.naturalWidth, height: img.naturalHeight },
          });
        };
        img.src = blobUrl;
      } else {
        updateNodeData(id, {
          ...fileData,
          view: createPdfView(1, 400, 300),
          totalPages: 1,
          viewports: [],
        });
      }
    },
    [id, updateNodeData]
  );

  const {
    viewerAreaRef,
    isModalOpen,
    openModal,
    closeModal,
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

  const handleModalPageChange = useCallback(
    (page: number) => {
      updateNodeData(id, {
        view: {
          ...data.view,
          target: { type: 'page', pageNumber: page },
        },
      });
    },
    [id, data.view, updateNodeData]
  );

  const handleDocumentLoad = useCallback(
    (numPages: number) => {
      updateNodeData(id, { totalPages: numPages });
    },
    [id, updateNodeData]
  );

  // Handle single page size from DocumentViewer
  const handleSinglePageSize = useCallback(
    (w: number, h: number) => {
      setSinglePageSize({ width: w, height: h });
    },
    []
  );

  // Sync documentSize from singlePageSize for per-page normalization
  useEffect(() => {
    if (singlePageSize && data.fileType === 'pdf') {
      const { width, height } = singlePageSize;
      if (!data.documentSize || data.documentSize.width !== width || data.documentSize.height !== height) {
        updateNodeData(id, { documentSize: { width, height } });
      }
    }
  }, [singlePageSize, id, data.fileType, data.documentSize, updateNodeData]);

  const handleContentResize = useCallback(
    (width: number, height: number) => {
      viewerContainerRef.current = { width, height };
      // For images (non-scroll), still track total content size
      if (data.fileType === 'image' && (!data.documentSize || data.documentSize.width !== width || data.documentSize.height !== height)) {
        updateNodeData(id, { documentSize: { width, height } });
      }
      // For PDFs in scroll mode, documentSize is set from singlePageSize instead
    },
    [id, data.fileType, data.documentSize, updateNodeData]
  );

  // ── Viewport region creation ──────────────────────────────────────────────
  const handleViewportCreate = useCallback(
    (coordinates: RegionCoordinates, pageNumber?: number) => {
      // In scroll mode, normalize against single page dimensions
      // RegionSelector already provides page-local coordinates via getPageForY
      const normW = singlePageSize ? singlePageSize.width : viewerContainerRef.current.width;
      const normH = singlePageSize ? singlePageSize.height : viewerContainerRef.current.height;

      const normalizedRect = {
        x: coordinates.x / normW,
        y: coordinates.y / normH,
        width: coordinates.width / normW,
        height: coordinates.height / normH,
      };

      const resolvedPage = pageNumber ?? currentPage;

      const newViewport: ViewportRegion = {
        id: generateId('viewport'),
        label: `Viewport ${viewports.length + 1}`,
        normalizedRect,
        pixelRect: coordinates,
        pageNumber: resolvedPage,
      };

      const newViewports = [...viewports, newViewport];
      updateNodeData(id, { viewports: newViewports });
      setSelectedViewportId(newViewport.id);

      // Auto-spawn ViewportNode + create connecting edge
      const thisNode = getNode(id);
      const nodeX = thisNode?.position?.x ?? 0;
      const nodeY = thisNode?.position?.y ?? 0;
      const spawnX = nodeX + data.view.nodeSize.width + 100;
      const spawnY = nodeY + (newViewports.length - 1) * 220;

      const cropAspect = coordinates.width / coordinates.height;
      const MAX_SPAWN_SIZE = 350;
      let viewportWidth = 250;
      let viewportHeight = Math.round(viewportWidth / cropAspect);

      if (viewportHeight > MAX_SPAWN_SIZE) {
        viewportHeight = MAX_SPAWN_SIZE;
        viewportWidth = Math.round(viewportHeight * cropAspect);
      }
      if (viewportWidth > MAX_SPAWN_SIZE) {
        viewportWidth = MAX_SPAWN_SIZE;
        viewportHeight = Math.round(viewportWidth / cropAspect);
      }

      const viewportNodeData: ViewportNodeData = {
        label: newViewport.label,
        fileUrl: data.fileUrl,
        fileType: data.fileType,
        normalizedRect: newViewport.normalizedRect,
        pageNumber: newViewport.pageNumber,
        nodeSize: { width: viewportWidth, height: viewportHeight },
        aspectLocked: true,
      };

      const viewportNodeId = storeAddNode(
        'viewport',
        { x: spawnX, y: spawnY },
        viewportNodeData
      );

      addEdge({
        id: `edge-${id}-${newViewport.id}-${viewportNodeId}`,
        source: id,
        sourceHandle: newViewport.id,
        target: viewportNodeId,
        targetHandle: 'viewport-in',
      });
    },
    [id, viewports, currentPage, singlePageSize, data.fileUrl, data.fileType, data.view.nodeSize, updateNodeData, storeAddNode, getNode, addEdge]
  );

  // ── Viewport management ───────────────────────────────────────────────────
  const handleViewportSelect = useCallback((viewportId: string) => {
    setSelectedViewportId(viewportId);
  }, []);

  const handleViewportDelete = useCallback(
    (viewportId: string) => {
      // Remove connected edges
      const outgoingEdges = edges.filter(
        (e) => e.source === id && e.sourceHandle === viewportId
      );
      for (const edge of outgoingEdges) {
        const targetNode = getNode(edge.target);
        if (targetNode && targetNode.type === 'viewport') {
          useCanvasStore.getState().removeNode(edge.target);
        }
        removeEdge(edge.id);
      }

      updateNodeData(id, {
        viewports: viewports.filter((v) => v.id !== viewportId),
      });
      if (selectedViewportId === viewportId) {
        setSelectedViewportId(null);
      }
    },
    [id, viewports, edges, selectedViewportId, updateNodeData, removeEdge, getNode]
  );

  const handleViewportLabelChange = useCallback(
    (viewportId: string, label: string) => {
      updateNodeData(id, {
        viewports: viewports.map((v) =>
          v.id === viewportId ? { ...v, label } : v
        ),
      });
    },
    [id, viewports, updateNodeData]
  );

  // ── Convert to ExtractorNode ──────────────────────────────────────────────
  const convertToExtractor = useCallback(() => {
    const extractorCurrentPage = data.view.target.type === 'page'
      ? data.view.target.pageNumber
      : 1;

    const extractorData: ExtractorNodeData = {
      label: data.label,
      fileType: data.fileType,
      fileUrl: data.fileUrl,
      fileId: data.fileId,
      fileName: data.fileName,
      regions: data.cachedExtractorEdges?.regions || [],
      currentPage: extractorCurrentPage,
      totalPages: data.totalPages,
    };

    // Remove viewport edges before converting
    const outgoingEdges = edges.filter((e) => e.source === id);
    for (const edge of outgoingEdges) {
      removeEdge(edge.id);
    }

    replaceNode(id, 'extractor', {
      ...extractorData,
      cachedExtractorEdges: undefined,
    } as unknown as ExtractorNodeData);

    // Restore cached extractor edges if available
    if (data.cachedExtractorEdges?.edges) {
      for (const cached of data.cachedExtractorEdges.edges) {
        addEdge({
          id: cached.id,
          source: id,
          sourceHandle: cached.sourceHandle,
          target: cached.target,
          targetHandle: cached.targetHandle,
        });
      }
    }
  }, [id, data, edges, replaceNode, addEdge, removeEdge]);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!data.fileUrl) {
    return (
      <>
        <BaseNode label={data.label} selected={selected} className="w-[280px]">
          <div className="p-2">
            <FileDropZone
              onFileSelect={handleFileSelect}
              onDrop={handleFileDrop}
              onDragOver={handleDragOver}
              compact
              onPickFromRegistry={openPicker}
            />
          </div>
        </BaseNode>
        <FilePickerModal
          isOpen={isPickerOpen}
          onClose={closePicker}
          onSelect={handlePickFromRegistry}
        />
      </>
    );
  }

  // ── Loaded state ──────────────────────────────────────────────────────────
  return (
    <>
      {/* Main node with preview + viewport list */}
      <BaseNode label={data.label} selected={selected} className="w-[280px]" hideHeader={!!data.compressed}>
        {/* Document preview using shared component */}
        <FileNodePreview
          fileUrl={data.fileUrl}
          fileType={data.fileType}
          fileName={data.fileName || ''}
          currentPage={currentPage}
          totalPages={data.totalPages}
          itemCount={viewports.length}
          itemLabel="viewport"
          onOpenClick={openModal}
          onConvertClick={convertToExtractor}
          convertLabel="Extractor"
          convertIcon="document"
          showThumbnail={true}
          thumbnailHeight={Math.min(data.view.nodeSize.height, 200)}
          onPdfLoad={handlePdfLoad}
          onPdfError={handlePdfError}
          pdfError={pdfError}
          mimeType={data.fileId ? BlobRegistry.getMetadata(data.fileId)?.mimeType : undefined}
          fileSize={data.fileId ? BlobRegistry.getMetadata(data.fileId)?.size : undefined}
          compressed={!!data.compressed}
          onCompressToggle={() => updateNodeData(id, { compressed: !data.compressed })}
        />

        {/* Compact viewport list with source handles */}
        <ViewportList
          viewports={viewports}
          selectedViewportId={selectedViewportId}
          onViewportSelect={handleViewportSelect}
          onViewportDelete={handleViewportDelete}
          onViewportLabelChange={handleViewportLabelChange}
          compact
          nodeId={id}
        />
      </BaseNode>

      <DocumentModal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={data.fileName || 'Document Viewer'}
        viewerAreaRef={viewerAreaRef}
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
        toolbar={
          <>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-copper-500" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 2h10v10H5V5z" />
            </svg>
            <span className="text-xs text-bridge-600">Draw a box to create a viewport region</span>
          </>
        }
        panel={
          <CollapsiblePanel title="Viewports" badge={viewports.length} defaultOpen={true} side="right">
            <ViewportList
              viewports={viewports}
              selectedViewportId={selectedViewportId}
              onViewportSelect={handleViewportSelect}
              onViewportDelete={handleViewportDelete}
              onViewportLabelChange={handleViewportLabelChange}
              nodeId={id}
            />
          </CollapsiblePanel>
        }
        footer={
          <div className="px-4 py-2 bg-paper-100 border-t border-paper-200 text-xs text-bridge-500 flex items-center justify-between">
            <span>Draw a box on the document to create a viewport. Each viewport spawns a connected node.</span>
            <span className="text-bridge-400">
              {viewports.length} viewport{viewports.length !== 1 ? 's' : ''}
            </span>
          </div>
        }
      >
        <div className="relative p-6 flex justify-center">
          <div
            className="relative bg-white shadow-lg"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
          >
            <DocumentViewer
              fileUrl={data.fileUrl ?? null}
              fileType={data.fileType}
              currentPage={currentPage}
              totalPages={data.totalPages}
              onPageChange={handleModalPageChange}
              onDocumentLoad={handleDocumentLoad}
              onContentResize={handleContentResize}
              onPageOffsetsChange={setPageOffsets}
              onSinglePageSize={handleSinglePageSize}
              enableTextSelection={false}
              width={VIEWER_WIDTH}
              devicePixelRatio={Math.max(window.devicePixelRatio, zoom) * window.devicePixelRatio}
              scrollMode={true}
            >
              {data.fileUrl && (
                <HighlightOverlay
                  regions={viewportAsRegions}
                  currentPage={currentPage}
                  selectedRegionId={selectedViewportId}
                  onRegionSelect={handleViewportSelect}
                  interactive
                  nodeId={id}
                  scrollMode={true}
                  pageOffsets={pageOffsets}
                />
              )}
              {data.fileUrl && (
                <RegionSelector
                  onRegionCreate={handleViewportCreate}
                  documentRef={viewerAreaRef}
                  pageOffsets={pageOffsets}
                  zoom={zoom}
                />
              )}
            </DocumentViewer>
          </div>
        </div>
      </DocumentModal>
    </>
  );
}
