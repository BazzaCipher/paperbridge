import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '../store/canvasStore';
import { useToast } from '../components/ui/Toast';
import { useFileUpload, type FileUploadResult } from './useFileUpload';
import { BlobRegistry } from '../store/canvasPersistence';

export function useCanvasDrop() {
  const addNode = useCanvasStore((state) => state.addNode);
  const pushHistory = useCanvasStore((state) => state.pushHistory);
  const { showToast } = useToast();
  const { screenToFlowPosition } = useReactFlow();

  const { processFile, processDataTransferItems, handleClipboardPaste } = useFileUpload({
    onFileRegistered: () => {},
  });

  const createNodesFromResults = useCallback(
    (results: FileUploadResult[], position: { x: number; y: number }) => {
      if (results.length === 0) return;

      const VERTICAL_SPACING = 350;
      pushHistory();

      results.forEach((result, index) => {
        const nodePosition = {
          x: position.x,
          y: position.y + index * VERTICAL_SPACING,
        };

        const nodeId = addNode('extractor', nodePosition, {
          label: result.fileName,
          fileId: result.fileId,
          fileUrl: result.fileUrl,
          fileName: result.fileName,
          fileType: result.fileType,
          currentPage: 1,
          totalPages: 1,
          regions: [],
        });

        BlobRegistry.addNodeReference(result.fileId, nodeId);
      });

      useCanvasStore.getState().refreshFileRegistry();
      showToast(`Created ${results.length} extractor node(s)`, 'success');
    },
    [addNode, pushHistory, showToast]
  );

  const handleCanvasDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();

      const dropPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      // Check for internal file drag from FileRegistryPanel
      const internalFileId = event.dataTransfer.getData('application/x-lynk-file');
      if (internalFileId) {
        const meta = BlobRegistry.getMetadata(internalFileId);
        const blobUrl = BlobRegistry.getUrlFromId(internalFileId);
        if (meta && blobUrl) {
          pushHistory();
          const nodeId = addNode('extractor', dropPosition, {
            label: meta.fileName,
            fileId: meta.fileId,
            fileUrl: blobUrl,
            fileName: meta.fileName,
            fileType: meta.fileType,
            currentPage: 1,
            totalPages: 1,
            regions: [],
          });
          BlobRegistry.addNodeReference(meta.fileId, nodeId);
          useCanvasStore.getState().refreshFileRegistry();
          showToast('Created extractor node', 'success');
        }
        return;
      }

      // Try folder-aware processing via DataTransferItems first
      if (event.dataTransfer.items && event.dataTransfer.items.length > 0) {
        const results = await processDataTransferItems(event.dataTransfer.items);
        if (results.length > 0) {
          createNodesFromResults(results, dropPosition);
          return;
        }
      }

      // Fallback to regular file processing
      const files = event.dataTransfer.files;
      if (!files || files.length === 0) return;

      const promises = Array.from(files).map((file) => processFile(file));
      const processed = await Promise.all(promises);
      const results = processed.filter((r): r is NonNullable<typeof r> => r !== null);

      if (results.length === 0) {
        showToast('No valid files (PDF or images only)', 'warning');
        return;
      }

      createNodesFromResults(results, dropPosition);
    },
    [screenToFlowPosition, processFile, processDataTransferItems, createNodesFromResults, showToast]
  );

  const handleCanvasPaste = useCallback(
    async (e: ClipboardEvent) => {
      const results = await handleClipboardPaste(e);
      if (results.length === 0) return;

      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });

      createNodesFromResults(results, center);
    },
    [handleClipboardPaste, screenToFlowPosition, createNodesFromResults]
  );

  return { handleCanvasDragOver, handleCanvasDrop, handleCanvasPaste };
}
