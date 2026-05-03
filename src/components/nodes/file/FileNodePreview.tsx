import { Document, Page, pdfjs } from 'react-pdf';
import { getFileTypeColor } from '../../../utils/colors';
import { formatFileSize } from '../../../utils/formatting';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface FileNodePreviewProps {
  fileUrl: string;
  fileType: 'image' | 'pdf';
  fileName: string;
  currentPage: number;
  totalPages: number;
  itemCount: number;
  itemLabel: string; // "viewport" or "field"
  onOpenClick: () => void;
  onConvertClick: () => void;
  convertLabel: string; // "Extractor" or "Display"
  convertIcon: 'document' | 'image';
  showThumbnail?: boolean;
  thumbnailHeight?: number;
  onPdfLoad?: (data: { numPages: number }) => void;
  onPdfError?: (error: Error) => void;
  pdfError?: string | null;
  mimeType?: string;
  fileSize?: number;
  compressed?: boolean;
  onCompressToggle?: () => void;
}

function ConvertIcon({ type }: { type: 'document' | 'image' }) {
  if (type === 'document') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
    </svg>
  );
}

export function FileNodePreview({
  fileUrl,
  fileType,
  fileName,
  currentPage,
  totalPages,
  itemCount,
  itemLabel,
  onOpenClick,
  onConvertClick,
  convertLabel,
  convertIcon,
  showThumbnail = true,
  thumbnailHeight = 200,
  onPdfLoad,
  onPdfError,
  pdfError,
  mimeType,
  fileSize,
  compressed = false,
  onCompressToggle,
}: FileNodePreviewProps) {
  const resolvedMimeType = mimeType || (fileType === 'pdf' ? 'application/pdf' : 'image/png');
  const typeColor = getFileTypeColor(resolvedMimeType);

  return (
    <div className="border-b border-paper-100" style={{ borderLeft: `3px solid ${typeColor.border}` }}>
      {/* Optional thumbnail - hidden when compressed */}
      {showThumbnail && !compressed && (
        <div
          className="relative cursor-pointer hover:opacity-90 transition-opacity"
          onClick={onOpenClick}
          style={{
            width: '100%',
            height: thumbnailHeight,
            overflow: 'hidden',
          }}
        >
          {fileType === 'image' ? (
            <img
              src={fileUrl}
              alt={fileName || 'Image'}
              className="w-full h-full object-contain bg-paper-50"
              draggable={false}
            />
          ) : (
            <div className="w-full h-full bg-paper-50 flex items-center justify-center overflow-hidden">
              {pdfError ? (
                <div className="text-red-500 text-sm">{pdfError}</div>
              ) : (
                <Document
                  file={fileUrl}
                  onLoadSuccess={onPdfLoad}
                  onLoadError={onPdfError}
                  loading={
                    <div className="text-bridge-400 text-sm">Loading PDF...</div>
                  }
                >
                  <Page
                    pageNumber={currentPage}
                    width={276}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </Document>
              )}
            </div>
          )}

          {/* Hover overlay with "Click to edit" */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors">
            <span className="text-white text-sm font-medium opacity-0 hover:opacity-100 transition-opacity bg-black/50 px-3 py-1 rounded-full">
              Click to edit
            </span>
          </div>
        </div>
      )}

      {/* File info */}
      <div className="p-2">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-6 h-6 rounded flex items-center justify-center"
            style={{ backgroundColor: typeColor.bg }}
          >
            <span className="text-[8px] font-bold" style={{ color: typeColor.text }}>
              {typeColor.label}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-bridge-900 truncate">{fileName}</p>
            <p className="text-[10px] text-bridge-500">
              {fileSize !== undefined && `${formatFileSize(fileSize)} · `}
              {itemCount} {itemLabel}{itemCount !== 1 ? 's' : ''}
              {fileType === 'pdf' && totalPages > 1 && ` · Page ${currentPage}/${totalPages}`}
            </p>
          </div>
          {/* Format badge */}
          <span
            className="px-1.5 py-0.5 text-[9px] font-semibold rounded-full"
            style={{
              backgroundColor: typeColor.bg,
              color: typeColor.text,
              border: `1px solid ${typeColor.border}`,
            }}
          >
            {typeColor.label}
          </span>
        </div>

        <div className="flex gap-1">
          <button
            onClick={onOpenClick}
            className="flex-1 px-2 py-1.5 text-xs bg-copper-400/10 text-copper-600 rounded hover:bg-copper-400/20 transition-colors flex items-center justify-center gap-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
            </svg>
            Open
          </button>
          <button
            onClick={onConvertClick}
            className="px-2 py-1.5 text-xs bg-paper-100 text-bridge-700 rounded hover:bg-paper-200 transition-colors flex items-center justify-center gap-1"
            title={`Convert to ${convertLabel} Node`}
          >
            <ConvertIcon type={convertIcon} />
          </button>
          {onCompressToggle && (
            <button
              onClick={onCompressToggle}
              className="px-2 py-1.5 text-xs bg-paper-100 text-bridge-700 rounded hover:bg-paper-200 transition-colors flex items-center justify-center gap-1"
              title={compressed ? 'Expand node' : 'Compress node'}
            >
              {compressed ? (
                /* Expand: arrows point OUTWARD to corners */
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="12 4 16 4 16 8" />
                  <line x1="16" y1="4" x2="11" y2="9" />
                  <polyline points="8 16 4 16 4 12" />
                  <line x1="4" y1="16" x2="9" y2="11" />
                </svg>
              ) : (
                /* Compress: arrows point INWARD from corners toward center */
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 5 11 5 11 9" />
                  <line x1="11" y1="9" x2="16" y2="4" />
                  <polyline points="5 15 9 15 9 11" />
                  <line x1="9" y1="11" x2="4" y2="16" />
                </svg>
              )}
            </button>
          )}

        </div>
      </div>
    </div>
  );
}
