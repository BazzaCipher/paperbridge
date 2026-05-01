import { type ReactNode, type RefObject } from 'react';
import { Modal } from '../../ui/Modal';
import { ZoomControls } from '../../ui/ZoomControls';

interface DocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;

  /** Ref attached to the scrollable viewer area (drives useDocumentZoom). */
  viewerAreaRef: RefObject<HTMLDivElement | null>;

  /** Zoom state from useDocumentZoom / useFileNodeState. */
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;

  /** Sticky toolbar content (rendered to the left of ZoomControls). */
  toolbar?: ReactNode;
  /** Right-side panel (typically a CollapsiblePanel). */
  panel?: ReactNode;
  /** Footer area below the viewer + panel. */
  footer?: ReactNode;

  /** Viewer area contents — caller renders the scaled DocumentViewer + overlays. */
  children: ReactNode;
}

/**
 * Shared modal shell for file-backed nodes (Display, Extractor).
 *
 * Owns: Modal frame, scrollable viewer area, sticky toolbar bar with
 * ZoomControls, side-panel slot, footer slot. Caller composes the
 * DocumentViewer + overlays as children so each node controls its own
 * selection/overlay layout.
 */
export function DocumentModal({
  isOpen,
  onClose,
  title,
  fullscreen,
  onToggleFullscreen,
  viewerAreaRef,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  toolbar,
  panel,
  footer,
  children,
}: DocumentModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      className="w-[950px] max-w-[95vw]"
      fullscreen={fullscreen}
      onToggleFullscreen={onToggleFullscreen}
    >
      <div className={`flex ${fullscreen ? 'h-[calc(100vh-49px)]' : 'h-[75vh]'}`}>
        <div
          className="flex-1 overflow-auto bg-paper-50 relative"
          ref={viewerAreaRef}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 z-20 flex items-center gap-2 py-2 px-4 bg-white border-b border-paper-200 shadow-sm">
            {toolbar}
            <div className="flex-1" />
            <ZoomControls zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={onResetZoom} />
          </div>
          {children}
        </div>
        {panel}
      </div>
      {footer}
    </Modal>
  );
}
