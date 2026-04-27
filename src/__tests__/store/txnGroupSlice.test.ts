import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '../../store/canvasStore';
import type { TxnGroup } from '../../core/sources/txnGroup';

const sample = (label = 'A'): TxnGroup => ({
  id: '',
  label,
  transactions: [],
  origin: {
    kind: 'bank',
    nodeIds: ['n1'],
    extractedAt: new Date().toISOString(),
    sourceHeaders: ['Date', 'Description', 'Amount'],
    fileId: 'f1',
    pageRange: [1, 1],
  },
});

describe('txnGroupSlice', () => {
  beforeEach(() => {
    useCanvasStore.setState({ txnGroups: {} });
  });

  it('adds a TxnGroup and returns its id', () => {
    const id = useCanvasStore.getState().addTxnGroup(sample('Acme'));
    expect(id).toMatch(/^txngroup-/);
    expect(useCanvasStore.getState().getTxnGroup(id)?.label).toBe('Acme');
  });

  it('honors an explicit id', () => {
    useCanvasStore.getState().addTxnGroup(sample(), 'fixed-id');
    expect(useCanvasStore.getState().txnGroups['fixed-id']).toBeDefined();
  });

  it('updates an existing TxnGroup', () => {
    const id = useCanvasStore.getState().addTxnGroup(sample('Old'));
    useCanvasStore.getState().updateTxnGroup(id, { ...sample('New'), id });
    expect(useCanvasStore.getState().getTxnGroup(id)?.label).toBe('New');
  });

  it('ignores updates for unknown ids', () => {
    useCanvasStore.getState().updateTxnGroup('missing', sample());
    expect(useCanvasStore.getState().txnGroups.missing).toBeUndefined();
  });

  it('removes a TxnGroup', () => {
    const id = useCanvasStore.getState().addTxnGroup(sample());
    useCanvasStore.getState().removeTxnGroup(id);
    expect(useCanvasStore.getState().getTxnGroup(id)).toBeUndefined();
  });
});
