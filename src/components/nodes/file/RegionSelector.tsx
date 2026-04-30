import { useState, useCallback, useRef, type PointerEvent, type RefObject } from 'react';
import type { RegionCoordinates } from '../../../types';

interface RegionSelectorProps {
  onRegionCreate: (coordinates: RegionCoordinates, pageNumber?: number) => void;
  /** Ref to the document element — coordinates are computed relative to this */
  documentRef: RefObject<HTMLDivElement | null>;
  pageOffsets?: Map<number, number>;
  zoom?: number;
}

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function RegionSelector({
  onRegionCreate,
  documentRef,
  pageOffsets,
  zoom = 1,
}: RegionSelectorProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Determine which page a Y coordinate belongs to
  const getPageForY = (y: number): { pageNumber: number; localY: number } => {
    if (!pageOffsets || pageOffsets.size === 0) {
      return { pageNumber: 1, localY: y };
    }

    let currentPage = 1;
    let currentOffset = 0;

    const sortedEntries = Array.from(pageOffsets.entries()).sort((a, b) => a[1] - b[1]);
    for (const [pageNum, offset] of sortedEntries) {
      if (y >= offset) {
        currentPage = pageNum;
        currentOffset = offset;
      }
    }

    return { pageNumber: currentPage, localY: y - currentOffset };
  };

  /** Get coordinates relative to the document element, accounting for zoom and offset within the viewer area */
  const getDocumentRelativeCoordinates = useCallback(
    (e: PointerEvent): { x: number; y: number } => {
      if (!documentRef.current) {
        // Fallback to overlay-relative
        if (!overlayRef.current) return { x: 0, y: 0 };
        const rect = overlayRef.current.getBoundingClientRect();
        return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
      }

      const docRect = documentRef.current.getBoundingClientRect();
      return {
        x: (e.clientX - docRect.left) / zoom,
        y: (e.clientY - docRect.top) / zoom,
      };
    },
    [documentRef, zoom]
  );

  /** Get coordinates relative to the overlay, in pre-zoom layout space.
   *  The overlay sits inside the zoomed document container, so a child
   *  positioned at `left: N` is visually drawn at N*zoom from the overlay's
   *  top-left. Dividing the visual offset by zoom keeps the selection box
   *  visually anchored to the pointer at any zoom. */
  const getOverlayRelativeCoordinates = useCallback(
    (e: PointerEvent): { x: number; y: number } => {
      if (!overlayRef.current) return { x: 0, y: 0 };
      const rect = overlayRef.current.getBoundingClientRect();
      return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
    },
    [zoom]
  );

  const [displayDrag, setDisplayDrag] = useState<DragState | null>(null);

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      // Only handle primary pointer (ignore secondary touches)
      if (!e.isPrimary) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-region-id]') || target.closest('[data-viewport-id]')) {
        return;
      }

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const docCoords = getDocumentRelativeCoordinates(e);
      const displayCoords = getOverlayRelativeCoordinates(e);
      setDragState({
        startX: docCoords.x,
        startY: docCoords.y,
        currentX: docCoords.x,
        currentY: docCoords.y,
      });
      setDisplayDrag({
        startX: displayCoords.x,
        startY: displayCoords.y,
        currentX: displayCoords.x,
        currentY: displayCoords.y,
      });
    },
    [getDocumentRelativeCoordinates, getOverlayRelativeCoordinates]
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!e.isPrimary || !dragState) return;

      const docCoords = getDocumentRelativeCoordinates(e);
      const displayCoords = getOverlayRelativeCoordinates(e);
      setDragState((prev) =>
        prev ? { ...prev, currentX: docCoords.x, currentY: docCoords.y } : null
      );
      setDisplayDrag((prev) =>
        prev ? { ...prev, currentX: displayCoords.x, currentY: displayCoords.y } : null
      );
    },
    [dragState, getDocumentRelativeCoordinates, getOverlayRelativeCoordinates]
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (!e.isPrimary || !dragState) return;

      const minSize = 10;
      const regionWidth = Math.abs(dragState.currentX - dragState.startX);
      const regionHeight = Math.abs(dragState.currentY - dragState.startY);

      if (regionWidth >= minSize && regionHeight >= minSize) {
        const globalY = Math.min(dragState.startY, dragState.currentY);
        const { pageNumber, localY } = getPageForY(globalY);

        const coordinates: RegionCoordinates = {
          x: Math.min(dragState.startX, dragState.currentX),
          y: localY,
          width: regionWidth,
          height: regionHeight,
        };
        onRegionCreate(coordinates, pageNumber);
      }

      setDragState(null);
      setDisplayDrag(null);
    },
    [dragState, onRegionCreate, getPageForY]
  );

  // Display box uses overlay-relative coordinates (so it renders correctly in the viewer area)
  const selectionBox = displayDrag
    ? {
        x: Math.min(displayDrag.startX, displayDrag.currentX),
        y: Math.min(displayDrag.startY, displayDrag.currentY),
        width: Math.abs(displayDrag.currentX - displayDrag.startX),
        height: Math.abs(displayDrag.currentY - displayDrag.startY),
      }
    : null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 cursor-crosshair touch-none z-10"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {selectionBox && selectionBox.width > 0 && selectionBox.height > 0 && (
        <div
          className="absolute border-2 border-dashed border-copper-500 pointer-events-none"
          style={{
            left: selectionBox.x,
            top: selectionBox.y,
            width: selectionBox.width,
            height: selectionBox.height,
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
          }}
        />
      )}
    </div>
  );
}

export function getNextRegionColor(): string {
  return '#c27350';
}
