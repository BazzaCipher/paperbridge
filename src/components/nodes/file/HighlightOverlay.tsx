import { useCallback, useRef } from 'react';
import type { ExtractedRegion } from '../../../types';
import { getColorForType } from '../../../utils/colors';
import { useCanvasStore } from '../../../store/canvasStore';
import { Highlightable } from '../../../types/categories';

function RowEdgeHandle({
  edge,
  color,
  onDrag,
}: {
  edge: 'top' | 'bottom';
  color: string;
  onDrag: (deltaY: number) => void;
}) {
  const startYRef = useRef<number | null>(null);
  const lastEmittedRef = useRef<number>(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startYRef.current = e.clientY;
    lastEmittedRef.current = 0;
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (startYRef.current === null) return;
      const total = e.clientY - startYRef.current;
      const delta = total - lastEmittedRef.current;
      if (Math.abs(delta) < 1) return;
      lastEmittedRef.current = total;
      onDrag(delta);
    },
    [onDrag],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (startYRef.current === null) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    startYRef.current = null;
    lastEmittedRef.current = 0;
  }, []);

  return (
    <div
      className="absolute left-0 right-0 cursor-ns-resize pointer-events-auto"
      style={{
        height: 6,
        [edge]: -3,
        backgroundColor: color,
        opacity: 0.6,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

interface HighlightOverlayProps {
  regions: ExtractedRegion[];
  currentPage: number;
  selectedRegionId: string | null;
  onRegionSelect: (regionId: string) => void;
  interactive?: boolean;
  nodeId?: string; // Node ID for comparing with external highlight
  scrollMode?: boolean; // When true, show regions from all pages with Y offset
  pageOffsets?: Map<number, number>; // Y offset for each page in scrollMode
  /** When set, rows linked to a TableRecord get draggable top/bottom edges. */
  onRowEdgeDrag?: (regionId: string, edge: 'top' | 'bottom', deltaY: number) => void;
}

export function HighlightOverlay({
  regions,
  currentPage,
  selectedRegionId,
  onRegionSelect,
  interactive = true,
  nodeId,
  scrollMode = false,
  pageOffsets,
  onRowEdgeDrag,
}: HighlightOverlayProps) {
  // Check if a region is externally highlighted
  const highlightedHandle = useCanvasStore(state => state.highlightedHandle);
  const isExternallyHighlighted = useCallback(
    (regionId: string): boolean => {
      if (!nodeId || !highlightedHandle) return false;
      return Highlightable.matches(highlightedHandle, nodeId, regionId);
    },
    [highlightedHandle, nodeId]
  );

  // Filter regions - in scrollMode show all pages, otherwise just current page
  const boxRegions = scrollMode
    ? regions.filter((r) => r.selectionType === 'box' && r.coordinates)
    : regions.filter((r) => r.pageNumber === currentPage && r.selectionType === 'box' && r.coordinates);
  const textRegions = scrollMode
    ? regions.filter((r) => r.selectionType === 'text' && r.textRange?.rects)
    : regions.filter((r) => r.pageNumber === currentPage && r.selectionType === 'text' && r.textRange?.rects);

  // Helper to get Y offset for a page in scrollMode
  const getPageOffset = (pageNumber: number): number => {
    if (!scrollMode || !pageOffsets) return 0;
    return pageOffsets.get(pageNumber) ?? 0;
  };

  if (boxRegions.length === 0 && textRegions.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Render box selections */}
      {boxRegions.map((region) => {
        const colors = getColorForType(region.dataType);
        const isSelected = selectedRegionId === region.id;
        const isExternal = isExternallyHighlighted(region.id);

        return (
          <div
            key={region.id}
            data-region-id={region.id}
            className={`absolute transition-all duration-150 ${
              interactive ? 'pointer-events-auto cursor-pointer' : ''
            }`}
            style={{
              left: region.coordinates!.x,
              top: getPageOffset(region.pageNumber) + region.coordinates!.y,
              width: region.coordinates!.width,
              height: region.coordinates!.height,
              backgroundColor: isSelected || isExternal ? colors.bg : 'transparent',
              borderWidth: isExternal ? 3 : 2,
              borderStyle: isSelected || isExternal ? 'solid' : 'dashed',
              borderColor: colors.border,
              boxShadow: isExternal
                ? `0 0 0 4px ${colors.border}60, 0 0 20px 6px ${colors.bg}`
                : isSelected
                ? `0 0 0 2px ${colors.bg}`
                : 'none',
            }}
            onClick={interactive ? () => onRegionSelect(region.id) : undefined}
          >
            {/* Region label - only shown when selected */}
            {(isSelected || isExternal) && (
              <div
                className="absolute -top-5 left-0 px-1.5 py-0.5 text-xs text-white rounded-t whitespace-nowrap font-medium"
                style={{ backgroundColor: colors.border }}
              >
                {region.label}
              </div>
            )}

            {/* Corner handles for selected region */}
            {(isSelected || isExternal) && (
              <>
                <div
                  className="absolute -top-1 -left-1 w-2 h-2 rounded-full"
                  style={{ backgroundColor: colors.border }}
                />
                <div
                  className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                  style={{ backgroundColor: colors.border }}
                />
                <div
                  className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full"
                  style={{ backgroundColor: colors.border }}
                />
                <div
                  className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full"
                  style={{ backgroundColor: colors.border }}
                />
              </>
            )}

            {/* Draggable top/bottom edges for table-row regions */}
            {region.tableSourceId && onRowEdgeDrag && (
              <>
                <RowEdgeHandle
                  edge="top"
                  color={colors.border}
                  onDrag={(dy) => onRowEdgeDrag(region.id, 'top', dy)}
                />
                <RowEdgeHandle
                  edge="bottom"
                  color={colors.border}
                  onDrag={(dy) => onRowEdgeDrag(region.id, 'bottom', dy)}
                />
              </>
            )}
          </div>
        );
      })}

      {/* Render text selections */}
      {textRegions.map((region) => {
        const colors = getColorForType(region.dataType);
        const isSelected = selectedRegionId === region.id;
        const isExternal = isExternallyHighlighted(region.id);
        const rects = region.textRange!.rects;
        const pageOffset = getPageOffset(region.pageNumber);

        // Use first rect for label positioning (where text actually starts)
        const firstRect = rects[0];
        if (!firstRect) return null;

        return (
          <div key={region.id} data-region-id={region.id}>
            {/* Render highlight rects with marker-style effect */}
            {rects.map((rect, index) => {
              const isFirst = index === 0;
              const isLast = index === rects.length - 1;

              return (
                <div
                  key={`${region.id}-rect-${index}`}
                  className={`absolute transition-all duration-150 ${
                    interactive ? 'pointer-events-auto cursor-pointer' : ''
                  }`}
                  style={{
                    left: rect.x - 2,
                    top: pageOffset + rect.y,
                    width: rect.width + 4,
                    height: rect.height,
                    background: `linear-gradient(to bottom, ${colors.bg} 0%, ${colors.bg} 85%, ${colors.border}40 100%)`,
                    borderRadius: isFirst && isLast ? '3px' : isFirst ? '3px 0 0 3px' : isLast ? '0 3px 3px 0' : '0',
                    boxShadow: isSelected || isExternal
                      ? `0 1px 3px ${colors.border}40`
                      : 'none',
                    opacity: isExternal ? 0.9 : 1,
                  }}
                  onClick={interactive ? () => onRegionSelect(region.id) : undefined}
                />
              );
            })}

            {/* Label positioned directly above the first rect - only shown when selected */}
            {(isSelected || isExternal) && (
              <div
                className={`absolute flex items-center gap-1 ${
                  interactive ? 'pointer-events-auto cursor-pointer' : ''
                }`}
                style={{
                  left: firstRect.x - 2,
                  top: Math.max(0, pageOffset + firstRect.y - 18),
                  zIndex: 10,
                }}
                onClick={interactive ? () => onRegionSelect(region.id) : undefined}
              >
                <div
                  className="px-1.5 py-0.5 text-[10px] text-white rounded whitespace-nowrap font-medium shadow-sm"
                  style={{ backgroundColor: colors.border }}
                >
                  {region.label}
                </div>
                {/* Small connector line */}
                <div
                  className="w-px h-2 -ml-1"
                  style={{ backgroundColor: colors.border, opacity: 0.5 }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
