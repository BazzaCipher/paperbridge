import React, { useState, useCallback } from 'react';
import { Position } from '@xyflow/react';
import { NodeEntry } from '../base/NodeEntry';
import { useCanvasStore } from '../../../store/canvasStore';
import { Highlightable } from '../../../types/categories';
import type { ExtractedRegion, SimpleDataType } from '../../../types';
import { getTypeBadgeClass, getTypeColorClass } from '../../../utils/colors';
import {
  formatValue,
  formatDateForInput,
  validateValue,
  getLocaleCurrencySymbol,
  parseBooleanValue,
} from '../../../utils/formatting';

interface RegionListProps {
  regions: ExtractedRegion[];
  selectedRegionId: string | null;
  onRegionSelect: (regionId: string) => void;
  onRegionDelete: (regionId: string) => void;
  onRegionLabelChange: (regionId: string, label: string) => void;
  onRegionDataTypeChange: (regionId: string, dataType: SimpleDataType) => void;
  onRegionRoleChange?: (regionId: string, role: 'amount' | 'date' | 'description' | undefined) => void;
  onValueChange?: (regionId: string, value: string) => void;
  onExtract?: (regionId: string) => void;
  isExtracting?: boolean;
  showOcrButton?: boolean;
  compact?: boolean;
  nodeId?: string; // Node ID for comparing with external highlight
}

// Date icon - replace this SVG with your custom icon
const DateIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
  </svg>
);

function getDataTypeOptions(): { value: SimpleDataType; label: string; icon: React.ReactNode }[] {
  return [
    { value: 'string', label: 'Text', icon: 'Aa' },
    { value: 'number', label: 'Number', icon: '#' },
    { value: 'currency', label: 'Currency', icon: getLocaleCurrencySymbol() },
    { value: 'date', label: 'Date', icon: <DateIcon /> },
    { value: 'boolean', label: 'Yes/No', icon: '?' },
  ];
}

const BOOLEAN_OPTIONS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

function getRawValue(region: ExtractedRegion): string {
  if (region.extractedData.value !== '') {
    return String(region.extractedData.value);
  }
  if (region.selectionType === 'text' && region.textRange) {
    return region.textRange.text;
  }
  return '';
}

function getDisplayValue(region: ExtractedRegion): string {
  const raw = getRawValue(region);
  if (!raw) return '';
  return formatValue(raw, region.dataType);
}

function getBooleanValue(region: ExtractedRegion): string {
  return parseBooleanValue(getRawValue(region));
}

export function RegionList({
  regions,
  selectedRegionId,
  onRegionSelect,
  onRegionDelete,
  onRegionLabelChange,
  onRegionDataTypeChange,
  onRegionRoleChange,
  onValueChange,
  onExtract,
  isExtracting = false,
  showOcrButton = false,
  compact = false,
  nodeId,
}: RegionListProps) {
  // Check if a region is externally highlighted
  const highlightedHandle = useCanvasStore(state => state.highlightedHandle);
  const isExternallyHighlighted = useCallback(
    (regionId: string): boolean => {
      if (!nodeId || !highlightedHandle) return false;
      return Highlightable.matches(highlightedHandle, nodeId, regionId);
    },
    [highlightedHandle, nodeId]
  );

  // Collapsible view state for full view mode
  const [collapsedView, setCollapsedView] = useState(false);

  if (regions.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-bridge-400 text-center">
        {compact ? 'No fields' : 'Draw a box or select text to create fields'}
      </div>
    );
  }

  // Compact view - just show values with type indicator
  if (compact) {
    return (
      <div className="divide-y divide-paper-100">
        {regions.map((region) => {
          const displayValue = getDisplayValue(region);
          const typeColor = getTypeBadgeClass(region.dataType);
          const isExternal = isExternallyHighlighted(region.id);

          return (
            <NodeEntry
              key={region.id}
              id={region.id}
              handleType="source"
              handlePosition={Position.Right}
              handleColor={region.color}
              className={`group hover:bg-paper-50 cursor-pointer ${
                selectedRegionId === region.id ? 'bg-copper-400/10' : ''
              } ${isExternal ? 'bg-copper-400/20 ring-2 ring-copper-400' : ''}`}
            >
              <div
                className="flex items-center gap-2 flex-1 min-w-0 py-0.5"
                onClick={() => onRegionSelect(region.id)}
              >
                {/* Type color indicator */}
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${typeColor}`} />

                {/* Label */}
                <span className="text-xs text-bridge-500 truncate max-w-[60px]">
                  {region.label}
                </span>

                {/* Role chip */}
                {region.role && (
                  <span
                    className="text-[9px] px-1 rounded bg-emerald-100 text-emerald-700 flex-shrink-0"
                    title={`Role: ${region.role}`}
                  >
                    {region.role === 'description' ? 'desc' : region.role}
                  </span>
                )}

                {/* Value */}
                <span className={`text-sm font-medium truncate flex-1 ${
                  displayValue ? 'text-bridge-900' : 'text-bridge-400'
                }`}>
                  {displayValue || '(empty)'}
                </span>
              </div>
            </NodeEntry>
          );
        })}
      </div>
    );
  }

  // Full view - editable with all controls
  return (
    <div className="divide-y divide-paper-100">
      {/* Toggle header */}
      <div className="flex justify-between px-3 py-2 bg-paper-50 border-b">
        <span className="text-xs text-bridge-500">
          {collapsedView ? 'Compact' : 'Full'} view
        </span>
        <button
          onClick={() => setCollapsedView(!collapsedView)}
          className="text-xs text-copper-500 hover:text-copper-700"
        >
          {collapsedView ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {/* Collapsed view - name + value only */}
      {collapsedView ? (
        regions.map((region) => {
          const displayValue = getDisplayValue(region);
          const typeColor = getTypeBadgeClass(region.dataType);
          const isExternal = isExternallyHighlighted(region.id);

          return (
            <div
              key={region.id}
              className={`px-3 py-2 hover:bg-paper-50 cursor-pointer flex items-center gap-2 ${
                selectedRegionId === region.id ? 'bg-copper-400/10' : ''
              } ${isExternal ? 'bg-copper-400/20 ring-2 ring-copper-400' : ''}`}
              onClick={() => onRegionSelect(region.id)}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${typeColor}`} />
              <span className="text-xs text-bridge-500 truncate max-w-[80px]">
                {region.label}
              </span>
              <span className={`text-sm font-medium truncate flex-1 ${
                displayValue ? 'text-bridge-900' : 'text-bridge-400'
              }`}>
                {displayValue || '(empty)'}
              </span>
            </div>
          );
        })
      ) : (
        /* Full editable view */
        regions.map((region) => {
          const displayValue = getDisplayValue(region);
          const rawValue = getRawValue(region);
          const hasValue = rawValue !== '';
          const needsOcr = region.selectionType === 'box' && !hasValue;
          const validation = validateValue(rawValue, region.dataType);

          return (
            <div
              key={region.id}
              className={`p-3 hover:bg-paper-50 transition-colors cursor-pointer ${
                selectedRegionId === region.id ? 'bg-copper-400/10 ring-2 ring-copper-200 ring-inset' : ''
              }`}
              onClick={() => onRegionSelect(region.id)}
            >
              {/* Header row: label + delete */}
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={region.label}
                  onChange={(e) => {
                    e.stopPropagation();
                    onRegionLabelChange(region.id, e.target.value);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 text-sm font-medium bg-transparent border-none outline-none focus:ring-0 p-0"
                  placeholder="Label..."
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRegionDelete(region.id);
                  }}
                  className="text-bridge-400 hover:text-red-500 transition-colors p-1"
                  title="Delete"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              {/* Type selector */}
              <div className="flex items-center gap-1 mb-2">
                {getDataTypeOptions().map((opt) => (
                  <button
                    key={opt.value}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRegionDataTypeChange(region.id, opt.value);
                    }}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      region.dataType === opt.value
                        ? getTypeColorClass(opt.value)
                        : 'bg-paper-100 text-bridge-500 hover:bg-paper-200'
                    }`}
                    title={opt.label}
                  >
                    {opt.icon}
                  </button>
                ))}
              </div>

              {/* Reconciliation role tag - only when handler is wired */}
              {onRegionRoleChange && (
                <div className="flex items-center gap-1 mb-2 text-[10px]">
                  <span className="text-bridge-400 mr-1">Role:</span>
                  {([
                    { value: undefined, label: 'none' },
                    { value: 'amount' as const, label: 'amount' },
                    { value: 'date' as const, label: 'date' },
                    { value: 'description' as const, label: 'desc' },
                  ]).map((opt) => (
                    <button
                      key={opt.label}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRegionRoleChange(region.id, opt.value);
                      }}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        region.role === opt.value
                          ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300'
                          : 'bg-paper-100 text-bridge-500 hover:bg-paper-200'
                      }`}
                      title={`Tag as ${opt.label}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Value display/input */}
              <div className={`rounded p-2 ${getTypeColorClass(region.dataType)} ${
                !validation.valid ? 'ring-2 ring-red-400' : ''
              }`}>
                {region.dataType === 'boolean' ? (
                  // Boolean: Yes/No/Unknown selector
                  <div className="flex gap-1">
                    {BOOLEAN_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={(e) => {
                          e.stopPropagation();
                          onValueChange?.(region.id, opt.value);
                        }}
                        className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                          getBooleanValue(region) === opt.value
                            ? 'bg-white shadow-sm font-medium'
                            : 'hover:bg-white/50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : region.dataType === 'date' && onValueChange ? (
                  // Date: native date picker
                  <input
                    type="date"
                    value={formatDateForInput(rawValue)}
                    onChange={(e) => {
                      e.stopPropagation();
                      onValueChange(region.id, e.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full text-sm bg-transparent border-none outline-none focus:ring-0 p-0"
                  />
                ) : region.dataType === 'currency' ? (
                  // Currency: uneditable locale symbol prefix + numeric input
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-sm font-mono opacity-60 select-none flex-shrink-0 cursor-default"
                      title={`Currency symbol (${getLocaleCurrencySymbol()})`}
                    >
                      {getLocaleCurrencySymbol()}
                    </span>
                    <div className="h-3.5 w-px bg-current opacity-20 flex-shrink-0" />
                    {onValueChange ? (
                      <input
                        type="text"
                        value={rawValue.replace(/^[$€£¥₹₩₪₫₱]\s*/, '')}
                        onChange={(e) => {
                          e.stopPropagation();
                          onValueChange(region.id, e.target.value);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 text-sm font-mono bg-transparent border-none outline-none focus:ring-0 p-0 min-w-0"
                        placeholder="0.00"
                      />
                    ) : (
                      <span className={`text-sm font-mono ${hasValue ? '' : 'opacity-50'}`}>
                        {rawValue.replace(/^[$€£¥₹₩₪₫₱]\s*/, '') || '(no value)'}
                      </span>
                    )}
                  </div>
                ) : onValueChange ? (
                  <input
                    type="text"
                    value={rawValue}
                    onChange={(e) => {
                      e.stopPropagation();
                      onValueChange(region.id, e.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full text-sm font-mono bg-transparent border-none outline-none focus:ring-0 p-0"
                    placeholder="Enter value..."
                  />
                ) : (
                  <span className={`text-sm font-mono ${hasValue ? '' : 'opacity-50'}`}>
                    {displayValue || '(no value)'}
                  </span>
                )}
              </div>

              {/* Validation error message */}
              {!validation.valid && (
                <p className="mt-1 text-xs text-red-500">{validation.message}</p>
              )}

              {/* OCR button for box selections without value */}
              {showOcrButton && needsOcr && onExtract && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onExtract(region.id);
                  }}
                  disabled={isExtracting}
                  className="mt-2 w-full px-3 py-1.5 text-xs bg-copper-500 text-white rounded hover:bg-copper-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                >
                  {isExtracting ? (
                    <>
                      <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Extracting...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                      </svg>
                      Run OCR
                    </>
                  )}
                </button>
              )}

              {/* Selection type indicator */}
              <div className="mt-2 flex items-center gap-1 text-xs text-bridge-400">
                {region.selectionType === 'text' ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                    Text selection
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 2h10v10H5V5z" />
                    </svg>
                    Box selection
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
