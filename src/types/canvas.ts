/**
 * Canvas State Types
 *
 * Defines the structure for canvas persistence and serialization.
 */

import type { Edge, Viewport } from '@xyflow/react';
import type { LynkNode } from './nodes';
import type { VirtualFolder } from '../store/canvasPersistence';
import type { TxnGroup } from '../core/sources/txnGroup';

// ═══════════════════════════════════════════════════════════════════════════════
// CANVAS METADATA
// ═══════════════════════════════════════════════════════════════════════════════

/** Canvas metadata for identification and timestamps */
export interface CanvasMetadata {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANVAS STATE
// ═══════════════════════════════════════════════════════════════════════════════

/** Canvas state for persistence */
export interface CanvasState {
  version: string;
  metadata: CanvasMetadata;
  nodes: LynkNode[];
  edges: Edge[];
  viewport: Viewport;
  /** Codec-managed embedded data (files, etc.) */
  embedded?: Record<string, unknown>;
  /** Virtual folder hierarchy for file organization */
  virtualFolders?: VirtualFolder[];
  /** TxnGroup payloads keyed by id; referenced from node data via
   *  `txnGroupId` / `tables[].txnGroupId`. */
  txnGroups?: Record<string, TxnGroup>;
}
