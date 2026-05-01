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
      <div className={`relative flex ${fullscreen ? 'h-[calc(100vh-49px)]' : 'h-[75vh]'}`}>
        <div
          className="flex-1 overflow-auto bg-paper-50 relative"
          ref={viewerAreaRef}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
        {panel}

        {/* Floating toolbar — centered over the full modal body so opening a side panel
            doesn't shift it. Mirrors the centered TopBar on the main canvas. */}
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 max-w-[calc(100%-2rem)]">
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 bg-white/90 backdrop-blur-md border border-paper-200 rounded-xl shadow-[0_2px_12px_rgba(16,42,67,0.08)]">
            {toolbar}
          </div>
        </div>

        {/* Zoom pinned to top-right of the viewer area, independent of panel state. */}
        <div className="pointer-events-none absolute top-3 right-3 z-20">
          <div className="pointer-events-auto bg-white/90 backdrop-blur-md border border-paper-200 rounded-xl shadow-[0_2px_12px_rgba(16,42,67,0.08)] px-1 py-0.5">
            <ZoomControls zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={onResetZoom} />
          </div>
        </div>
      </div>
      {footer}
    </Modal>
  );
}
