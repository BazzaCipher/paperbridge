import type { DisplayNodeData, ExtractorNodeData, ExtractorColumn, CalculationNodeData, SheetNodeData, LabelNodeData, MatchNodeData } from '../../types';
import { createImageView } from '../../types';

export const DEFAULT_EXTRACTOR_COLUMNS: ExtractorColumn[] = [
  { id: 'label', label: 'Label', dataType: 'string' },
  { id: 'value', label: 'Value', dataType: 'string' },
];

export const defaultExtractorData: ExtractorNodeData = {
  label: 'Extractor',
  fileType: 'pdf',
  fileName: undefined,
  fileUrl: undefined,
  regions: [],
  currentPage: 1,
  totalPages: 1,
  columns: DEFAULT_EXTRACTOR_COLUMNS,
};

export const defaultMatchData: MatchNodeData = {
  label: 'Match',
  amountTolerance: 0.05,
  dateWindowDays: 7,
  pairs: [],
  unmatchedA: [],
  unmatchedB: [],
  manualOverrides: [],
  rejections: [],
};

export const defaultDisplayData: DisplayNodeData = {
  label: 'Display',
  fileType: 'image',
  fileUrl: undefined,
  fileId: undefined,
  fileName: undefined,
  view: createImageView(300, 200),
  totalPages: 1,
  viewports: [],
};

export const defaultCalculationData: CalculationNodeData = {
  label: 'Calculation',
  operation: 'sum',
  precision: 2,
  inputs: [],
  result: undefined,
  inputCache: {},
};

export const defaultSheetData: SheetNodeData = {
  label: 'Sheet',
  subheaders: [],
};

export const defaultLabelData: LabelNodeData = {
  label: 'Label',
  format: 'number',
  value: undefined,
  fontSize: 'medium',
  alignment: 'center',
};

