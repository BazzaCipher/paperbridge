/**
 * Node Capabilities & Categories
 *
 * Nodes have orthogonal capabilities that compose freely:
 * - Exportable: Can produce data (has source/output handles) - stores outputs map
 * - Importable: Can receive data (has target/input handles)
 * - FileNodeData: Loads external files (display, extractor)
 *
 * A node can be Exportable, Importable, or both (e.g., CalculationNode, LabelNode).
 * Connection validation uses CanExport/CanImport capability helpers.
 */

import type { LynkNode, LynkNodeType } from './nodes';
import type { SimpleDataType } from './data';
import type { DataSourceReference } from './geometry';
import { hasCapability } from '../core/nodes/nodeRegistry';

// Re-export SimpleDataType for convenience
export type { SimpleDataType } from './data';

// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITY INTERFACES (data contracts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A single output value from a node handle.
 * Stored in Exportable.outputs keyed by handle ID.
 */
export interface NodeOutput {
  value: number | string | boolean | Date;
  dataType: SimpleDataType;
  /** Types this output is compatible with (for handle coloring). Defaults to [dataType] if not specified. */
  compatibleTypes?: SimpleDataType[];
  label: string;
  source?: DataSourceReference | null;
}

/**
 * Data contract for nodes that can export data (have source/output handles).
 *
 * Each node component is responsible for populating `outputs` with current
 * computed values. The data flow resolver reads this map generically -
 * no per-node-type switch logic needed.
 */
export interface Exportable {
  outputs?: Record<string, NodeOutput>;
}

/**
 * Data contract for nodes that can import data (have target/input handles).
 *
 * Input resolution is handled by useDataFlow, which reads connected edges
 * and resolves source values from the source node's Exportable.outputs.
 */
export interface Importable {
  /**
   * Types accepted by input handles (for handle coloring).
   * - As array: all handles accept these types
   * - As Record: per-handle accepted types (key = handleId)
   */
  acceptedTypes?: SimpleDataType[] | Record<string, SimpleDataType[]>;
}

/** Data contract for file-backed nodes */
export interface FileNodeData {
  fileType: 'pdf' | 'image';
  fileId?: string;
  fileUrl?: string;
  fileName?: string;
}

/** @deprecated Use FileNodeData instead */
export interface SourceNodeData {
  fileId?: string;
  fileUrl?: string;
  fileName?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY CLASSES
// ═══════════════════════════════════════════════════════════════════════════════

/** File nodes - bring external files into the system */
export class FileNode {
  static readonly types: LynkNodeType[] = ['display', 'extractor'];

  static is(node: LynkNode): node is LynkNode & { data: FileNodeData } {
    return hasCapability(node.type, 'isFileNode');
  }

  static getFileId(node: LynkNode & { data: FileNodeData }): string | undefined {
    return node.data.fileId;
  }

  static getFileUrl(node: LynkNode & { data: FileNodeData }): string | undefined {
    return node.data.fileUrl;
  }

  static getFileName(node: LynkNode & { data: FileNodeData }): string | undefined {
    return node.data.fileName;
  }

  static filter(nodes: LynkNode[]): Array<LynkNode & { data: FileNodeData }> {
    return nodes.filter(FileNode.is);
  }
}

/** @deprecated Use FileNode instead */
export class SourceNode {
  static readonly types: LynkNodeType[] = ['display', 'extractor'];

  static is(node: LynkNode): node is LynkNode & { data: SourceNodeData } {
    return SourceNode.types.includes(node.type as LynkNodeType);
  }

  static getFileId(node: LynkNode & { data: SourceNodeData }): string | undefined {
    return node.data.fileId;
  }

  static getFileUrl(node: LynkNode & { data: SourceNodeData }): string | undefined {
    return node.data.fileUrl;
  }

  static getFileName(node: LynkNode & { data: SourceNodeData }): string | undefined {
    return node.data.fileName;
  }

  static filter(nodes: LynkNode[]): Array<LynkNode & { data: SourceNodeData }> {
    return nodes.filter(SourceNode.is);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPABILITY HELPERS (for connection validation)
// ═══════════════════════════════════════════════════════════════════════════════

/** Nodes that can be connection sources (have output handles) */
export const CanExport = {
  types: ['display', 'extractor', 'calculation', 'sheet', 'label'] as LynkNodeType[],
  is: (node: LynkNode) => hasCapability(node.type, 'canExport'),
};

/** Nodes that can be connection targets (have input handles) */
export const CanImport = {
  types: ['viewport', 'calculation', 'sheet', 'label'] as LynkNodeType[],
  is: (node: LynkNode) => hasCapability(node.type, 'canImport'),
};

/** Capability helper for highlighting - works with Exportable */
export const Highlightable = {
  types: [...CanExport.types],

  /** Construct handle ID: "nodeId:handleId" */
  target(nodeId: string, handleId: string): string {
    return `${nodeId}:${handleId}`;
  },

  /** Parse handle ID back to parts */
  parse(target: string): { nodeId: string; handleId: string } | null {
    const colonIndex = target.indexOf(':');
    if (colonIndex === -1) return null;
    return {
      nodeId: target.slice(0, colonIndex),
      handleId: target.slice(colonIndex + 1),
    };
  },

  /** Get highlightable handles from Exportable.outputs */
  getHandles(data: Partial<Exportable>): string[] {
    return Object.keys(data.outputs ?? {});
  },

  /** Check if handle matches highlighted target */
  matches(highlighted: string | null, nodeId: string, handleId: string): boolean {
    return highlighted === Highlightable.target(nodeId, handleId);
  },
};
