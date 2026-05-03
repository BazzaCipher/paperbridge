/**
 * Registers all built-in node types with the node registry.
 * Import this module once at app startup (before rendering the canvas).
 */

import { registerNodeType } from './nodeRegistry';

import { DisplayNode } from '../../components/nodes/DisplayNode';
import { ViewportNode } from '../../components/nodes/ViewportNode';
import { ExtractorNode } from '../../components/nodes/ExtractorNode';
import { CalculationNode } from '../../components/nodes/CalculationNode';
import { SheetNode } from '../../components/nodes/SheetNode';
import { LabelNode } from '../../components/nodes/LabelNode';
import { GroupNode } from '../../components/nodes/GroupNode';
import { MatchNode } from '../../components/nodes/MatchNode';

import {
  defaultDisplayData,
  defaultExtractorData,
  defaultCalculationData,
  defaultSheetData,
  defaultLabelData,
  defaultMatchData,
} from '../../components/canvas/nodeDefaults';

registerNodeType({
  type: 'extractor',
  label: 'Extractor',
  icon: 'extractor',
  component: ExtractorNode,
  defaultData: defaultExtractorData,
  capabilities: { canExport: true, canImport: false, isFileNode: true },
  creatable: true,
  description: 'Extract data from documents',
});

registerNodeType({
  type: 'display',
  label: 'Display',
  icon: 'display',
  component: DisplayNode,
  defaultData: defaultDisplayData,
  capabilities: { canExport: true, canImport: false, isFileNode: true },
  creatable: true,
  description: 'Visual reference for images and PDFs',
});

registerNodeType({
  type: 'calculation',
  label: 'Calculation',
  shortLabel: 'Calc',
  icon: 'calculation',
  component: CalculationNode,
  defaultData: defaultCalculationData,
  capabilities: { canExport: true, canImport: true, isFileNode: false },
  creatable: true,
  description: 'Perform calculations on inputs',
});

registerNodeType({
  type: 'sheet',
  label: 'Sheet',
  icon: 'sheet',
  component: SheetNode,
  defaultData: defaultSheetData,
  capabilities: { canExport: true, canImport: true, isFileNode: false },
  creatable: true,
  description: 'Tabular data aggregation',
});

registerNodeType({
  type: 'label',
  label: 'Label',
  icon: 'label',
  component: LabelNode,
  defaultData: defaultLabelData,
  capabilities: { canExport: true, canImport: true, isFileNode: false },
  creatable: true,
  description: 'Display formatted values',
});

registerNodeType({
  type: 'viewport',
  label: 'Viewport',
  icon: 'viewport',
  component: ViewportNode,
  defaultData: {},
  capabilities: { canExport: false, canImport: true, isFileNode: false },
  creatable: false,
});

registerNodeType({
  type: 'match',
  label: 'Match',
  icon: 'calculation',
  component: MatchNode,
  defaultData: defaultMatchData,
  capabilities: { canExport: true, canImport: true, isFileNode: false },
  creatable: true,
  description: 'Reconcile two data sources',
});

registerNodeType({
  type: 'group',
  label: 'Group',
  icon: 'group',
  component: GroupNode,
  defaultData: { label: 'Group', width: 400, height: 300 },
  capabilities: { canExport: true, canImport: true, isFileNode: false },
  creatable: false,
});
