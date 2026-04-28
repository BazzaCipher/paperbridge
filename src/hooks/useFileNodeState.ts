import { useCallback, useRef, useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useDocumentZoom } from './useDocumentZoom';
import { useFileNode } from './useFileNode';

interface FileInitData {
  fileUrl: string;
  fileId: string;
  fileName: string;
  fileType: 'pdf' | 'image';
}

/**
 * Composite hook for file-backed nodes (Display, Extractor).
 *
 * Bundles the modal/picker open state, the scrollable-viewer ref + zoom,
 * PDF load state, page offsets, and forwards file-pick/drop handlers from
 * `useFileNode`.
 *
 * `onFileInit` runs after a file is registered; the node uses it to write
 * shape-specific data (e.g. createImageView, totalPages, viewports).
 */
export function useFileNodeState(
  nodeId: string,
  onFileInit: (fileData: FileInitData, blobUrl: string) => void,
) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  const viewerAreaRef = useRef<HTMLDivElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pageOffsets, setPageOffsets] = useState<Map<number, number>>(new Map());

  const { zoom, zoomIn, zoomOut, resetZoom } = useDocumentZoom(viewerAreaRef, isModalOpen);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    resetZoom();
  }, [resetZoom]);

  const openPicker = useCallback(() => setIsPickerOpen(true), []);
  const closePicker = useCallback(() => setIsPickerOpen(false), []);

  const handlePdfLoad = useCallback(
    ({ numPages }: { numPages: number }) => {
      updateNodeData(nodeId, { totalPages: numPages });
      setPdfError(null);
    },
    [nodeId, updateNodeData],
  );

  const handlePdfError = useCallback((error: Error) => {
    console.error('PDF load error:', error);
    setPdfError('Failed to load PDF');
  }, []);

  const fileHandlers = useFileNode(nodeId, onFileInit);

  return {
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
    ...fileHandlers,
  };
}
