/**
 * Group Slice
 *
 * Handles node grouping and selection operations:
 * - Creating groups from selected nodes
 * - Ungrouping nodes
 * - Selection queries and operations
 */

import type { Edge } from '@xyflow/react';
import type { LynkNode } from '../../types';
import { GroupNode, FileNode } from '../../types';
import { BlobRegistry } from '../canvasPersistence';
import type { StateCreator } from './types';
import { generateNodeId } from './coreSlice';
import {
  calculateBoundingBox,
  toRelativePosition,
  toAbsolutePosition,
  GROUP_PADDING,
  GROUP_HEADER_HEIGHT,
} from '../../utils/geometry';

export interface GroupSlice {
  // Group actions
  createGroup: (nodeIds: string[]) => string | null;
  ungroupNodes: (groupId: string) => void;

  // Selection queries
  getSelectedNodes: () => LynkNode[];
  getSelectedEdges: () => Edge[];

  // Selection actions
  removeSelectedNodes: () => void;
  removeSelectedEdges: () => void;
  clearSelection: () => void;
}

/** Collect node IDs and their children (one level) for cascading operations */
function collectWithChildren(nodeIds: Set<string>, nodes: LynkNode[]): Set<string> {
  const result = new Set(nodeIds);
  for (const node of nodes) {
    if (node.parentId && result.has(node.parentId)) {
      result.add(node.id);
    }
  }
  return result;
}

/** Deselect all nodes and edges */
function deselectAll(nodes: LynkNode[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => ({ ...n, selected: false })) as LynkNode[],
    edges: edges.map((e) => ({ ...e, selected: false })),
  };
}

export const createGroupSlice: StateCreator<GroupSlice> = (set, get) => ({
  createGroup: (nodeIds) => {
    const { nodes, edges } = get();
    const groupableNodes = nodes.filter(
      (n) => nodeIds.includes(n.id) && !GroupNode.is(n)
    );

    if (groupableNodes.length < 2) return null;

    const bounds = calculateBoundingBox(groupableNodes);
    const groupId = generateNodeId();
    const groupPosition = {
      x: bounds.minX - GROUP_PADDING,
      y: bounds.minY - GROUP_PADDING - GROUP_HEADER_HEIGHT,
    };
    const groupWidth = bounds.maxX - bounds.minX + GROUP_PADDING * 2;
    const groupHeight = bounds.maxY - bounds.minY + GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT;

    const groupNode: LynkNode = {
      id: groupId,
      type: 'group',
      position: groupPosition,
      selected: true,
      style: { width: groupWidth, height: groupHeight },
      data: { label: 'Group', width: groupWidth, height: groupHeight },
    } as LynkNode;

    const nodeIdSet = new Set(nodeIds);
    const updatedNodes = nodes.map((node) => {
      if (nodeIdSet.has(node.id) && !GroupNode.is(node)) {
        return {
          ...node,
          selected: false,
          parentId: groupId,
          position: toRelativePosition(node.position, groupPosition),
        };
      }
      return { ...node, selected: false };
    });

    set({
      nodes: [groupNode, ...updatedNodes] as LynkNode[],
      edges: edges.map((e) => ({ ...e, selected: false })),
    });
    return groupId;
  },

  ungroupNodes: (groupId) => {
    const { nodes } = get();
    const groupNode = nodes.find((n) => n.id === groupId && GroupNode.is(n));
    if (!groupNode) return;

    const { position: groupPosition } = groupNode;

    const updatedNodes = nodes
      .filter((n) => n.id !== groupId)
      .map((node) => {
        if (node.parentId !== groupId) return node;
        const { parentId: _, ...rest } = node as LynkNode & { parentId?: string };
        return {
          ...rest,
          position: toAbsolutePosition(node.position, groupPosition),
        };
      });

    set({ nodes: updatedNodes as LynkNode[] });
  },

  getSelectedNodes: () => get().nodes.filter((n) => n.selected),

  getSelectedEdges: () => get().edges.filter((e) => e.selected),

  removeSelectedEdges: () => {
    set({ edges: get().edges.filter((e) => !e.selected) });
  },

  clearSelection: () => {
    const { nodes, edges } = get();
    set(deselectAll(nodes, edges));
  },

  removeSelectedNodes: () => {
    const { nodes, edges } = get();
    const selectedIds = new Set(
      nodes.filter((n) => n.selected).map((n) => n.id)
    );
    const allIdsToRemove = collectWithChildren(selectedIds, nodes);

    // Clean up file references before removing nodes
    for (const nodeId of allIdsToRemove) {
      const node = nodes.find((n) => n.id === nodeId) as LynkNode | undefined;
      if (node && FileNode.is(node)) {
        const fileId = FileNode.getFileId(node);
        if (fileId) BlobRegistry.removeNodeReference(fileId, nodeId);
      }
    }

    set({
      nodes: nodes.filter((n) => !allIdsToRemove.has(n.id)),
      edges: edges.filter(
        (e) => !allIdsToRemove.has(e.source) && !allIdsToRemove.has(e.target)
      ),
    });
  },
});
