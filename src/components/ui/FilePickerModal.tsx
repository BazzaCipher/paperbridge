import { useState, useCallback } from 'react';
import { Modal } from './Modal';
import { BlobRegistry, type FileMetadata } from '../../store/canvasPersistence';
import { useCanvasStore } from '../../store/canvasStore';
import { getFileTypeColor } from '../../utils/colors';
import { formatFileSize } from '../../utils/formatting';

interface FilePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (fileId: string, blobUrl: string, meta: FileMetadata) => void;
}

export function FilePickerModal({ isOpen, onClose, onSelect }: FilePickerModalProps) {
  const [search, setSearch] = useState('');
  const canvasId = useCanvasStore((s) => s.canvasId);
  const allFiles = BlobRegistry.getAllMetadata(canvasId);

  const filtered = search
    ? allFiles.filter((f) => f.fileName.toLowerCase().includes(search.toLowerCase()))
    : allFiles;

  const handleSelect = useCallback(
    (meta: FileMetadata) => {
      const blobUrl = BlobRegistry.getUrlFromId(meta.fileId);
      if (blobUrl) {
        onSelect(meta.fileId, blobUrl, meta);
        onClose();
      }
    },
    [onSelect, onClose]
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Choose from loaded files" className="w-[400px] max-w-[90vw]">
      <div className="p-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className="w-full px-2 py-1.5 text-sm border border-paper-200 rounded focus:outline-none focus:ring-1 focus:ring-copper-400 mb-3"
        />

        <div className="max-h-[50vh] overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-bridge-400 text-center py-4">
              {allFiles.length === 0 ? 'No files loaded yet' : 'No matching files'}
            </p>
          ) : (
            filtered.map((meta) => {
              const typeColor = getFileTypeColor(meta.mimeType);
              const blobUrl = BlobRegistry.getUrlFromId(meta.fileId);

              return (
                <button
                  key={meta.fileId}
                  onClick={() => handleSelect(meta)}
                  className="w-full flex items-center gap-3 p-2 rounded hover:bg-paper-50 transition-colors text-left"
                >
                  {/* Thumbnail */}
                  {meta.fileType === 'image' && blobUrl ? (
                    <img
                      src={blobUrl}
                      alt={meta.fileName}
                      className="w-10 h-10 rounded object-cover"
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded flex items-center justify-center"
                      style={{ backgroundColor: typeColor.bg }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill={typeColor.text}>
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-bridge-900 truncate">{meta.fileName}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className="px-1 py-0.5 text-[8px] font-semibold rounded"
                        style={{
                          backgroundColor: typeColor.bg,
                          color: typeColor.text,
                          border: `1px solid ${typeColor.border}`,
                        }}
                      >
                        {typeColor.label}
                      </span>
                      <span className="text-[10px] text-bridge-400">{formatFileSize(meta.size)}</span>
                    </div>
                  </div>

                  {/* Select action */}
                  <span className="text-xs text-copper-500 font-medium">Select</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
