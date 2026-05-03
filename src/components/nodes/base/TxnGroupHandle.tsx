import { type ReactNode } from 'react';
import { Position } from '@xyflow/react';
import { NodeEntry } from './NodeEntry';
import { txnGroupHandle, TXNGROUP_HANDLE_COLOR } from '../../../core/handles/txnGroup';

interface TxnGroupHandleProps {
  /** Either a TxnGroup id or a static slot name (e.g. 'source-a', 'matched'). */
  name: string;
  handleType: 'source' | 'target';
  handlePosition: Position;
  children: ReactNode;
}

/**
 * NodeEntry preset for TxnGroup-typed handles. Centralizes the `txngroup:`
 * prefix and emerald color so individual nodes don't repeat them.
 */
export function TxnGroupHandle({ name, handleType, handlePosition, children }: TxnGroupHandleProps) {
  return (
    <NodeEntry
      id={txnGroupHandle.make(name)}
      handleType={handleType}
      handlePosition={handlePosition}
      handleColor={TXNGROUP_HANDLE_COLOR}
      handleShape="square"
      className="bg-emerald-50/60 border-l-2 border-emerald-400"
    >
      {children}
    </NodeEntry>
  );
}
