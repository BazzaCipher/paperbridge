import type { DisplayNodeData, ExtractorNodeData, CalculationNodeData, SheetNodeData, LabelNodeData } from '../../types';
import { createImageView } from '../../types';

export const defaultExtractorData: ExtractorNodeData = {
  label: 'Extractor',
  fileType: 'pdf',
  fileName: undefined,
  fileUrl: undefined,
  regions: [],
  currentPage: 1,
  totalPages: 1,
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

