import type { Edge } from '@xyflow/react';
import type { LynkNode } from '../../types';
import { CanExport, CanImport, CalculationNode, ExtractorNode, DisplayNode, ViewportNode } from '../../types';
import { wouldCreateCycle } from './dependencyGraph';
import { getOperation, isTypeCompatible } from '../operations/operationRegistry';

export interface ConnectionValidationContext {
  nodes: LynkNode[];
  edges: Edge[];
}

export interface ConnectionValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateConnection(
  connection: {
    source?: string | null;
    target?: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  },
  context: ConnectionValidationContext
): ConnectionValidationResult {
  if (!connection.source || !connection.target) {
    return { valid: false };
  }

  // Prevent self-connections
  if (connection.source === connection.target) {
    return { valid: false, reason: 'Cannot connect a node to itself' };
  }

  // Check for cycles
  if (wouldCreateCycle(context.edges, connection.source, connection.target)) {
    return { valid: false, reason: 'Cannot create circular dependency' };
  }

  // Get source and target nodes
  const sourceNode = context.nodes.find((n) => n.id === connection.source);
  const targetNode = context.nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) return { valid: false };

  // Check if source node can export (has output handles)
  if (!CanExport.is(sourceNode)) {
    return { valid: false, reason: 'This node type cannot be a data source' };
  }

  // Check if target node can import (has input handles)
  if (!CanImport.is(targetNode)) {
    return { valid: false, reason: 'This node type cannot receive data' };
  }

  // TxnGroup-typed handles: source handle id starts with "txngroup:" — payload
  // is a TxnGroup reference, not a scalar. Targets must explicitly opt in by
  // exposing a target handle whose id also starts with "txngroup:".
  const sourceIsTxnGroup = connection.sourceHandle?.startsWith('txngroup:') ?? false;
  const targetIsTxnGroup = connection.targetHandle?.startsWith('txngroup:') ?? false;
  if (sourceIsTxnGroup !== targetIsTxnGroup) {
    return {
      valid: false,
      reason: sourceIsTxnGroup
        ? 'Transaction group can only connect to a TxnGroup input'
        : 'TxnGroup input only accepts a transaction group',
    };
  }

  // ViewportNode targets: only accept from DisplayNode, max 1 input
  if (ViewportNode.is(targetNode)) {
    if (!DisplayNode.is(sourceNode)) {
      return { valid: false, reason: 'Viewport nodes only accept connections from Display nodes' };
    }
    const existingInputs = context.edges.filter(
      (e) => e.target === targetNode.id && e.targetHandle === 'viewport-in'
    );
    if (existingInputs.length >= 1) {
      return { valid: false, reason: 'Viewport node already has a connection' };
    }
  }

  // Type compatibility check for CalculationNode targets
  if (CalculationNode.is(targetNode)) {
    const operation = getOperation(targetNode.data.operation);

    if (operation) {
      // Check if source data type is compatible with the operation
      if (ExtractorNode.is(sourceNode)) {
        const regionId = connection.sourceHandle;
        const region = sourceNode.data.regions.find((r) => r.id === regionId);

        if (region && !isTypeCompatible(targetNode.data.operation, region.dataType)) {
          return {
            valid: false,
            reason: `${region.dataType} is not compatible with ${operation.label}. Supported types: ${operation.compatibleTypes.join(', ')}`,
          };
        }
      }

      // Check single-input operation limits
      if (operation.maxInputs === 1) {
        const existingInputs = context.edges.filter(
          (e) => e.target === targetNode.id && e.targetHandle === 'inputs'
        );
        if (existingInputs.length >= 1) {
          return { valid: false, reason: `${operation.label} only accepts one input` };
        }
      }
    }
  }

  return { valid: true };
}
