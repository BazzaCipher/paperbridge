/**
 * TxnGroup Slice
 *
 * Stores `TxnGroup` payloads keyed by id. Handles carry only
 * `txngroup:<id>` so node JSON stays small and re-renders are cheap.
 */

import type { TxnGroup } from '../../core/sources/txnGroup';
import { generateId } from '../../utils/id';
import type { StateCreator } from './types';

export interface TxnGroupSlice {
  txnGroups: Record<string, TxnGroup>;

  /** Insert a TxnGroup; returns the assigned id. */
  addTxnGroup: (group: TxnGroup, id?: string) => string;
  /** Replace an existing TxnGroup (no-op if id is unknown). */
  updateTxnGroup: (id: string, group: TxnGroup) => void;
  /** Remove a TxnGroup by id. */
  removeTxnGroup: (id: string) => void;
  /** Read a TxnGroup by id. */
  getTxnGroup: (id: string) => TxnGroup | undefined;
}

export const createTxnGroupSlice: StateCreator<TxnGroupSlice> = (set, get) => ({
  txnGroups: {},

  addTxnGroup: (group, id) => {
    const groupId = id || group.id || generateId('txngroup');
    set((state) => ({
      txnGroups: { ...(state as unknown as TxnGroupSlice).txnGroups, [groupId]: { ...group, id: groupId } },
    } as never));
    return groupId;
  },

  updateTxnGroup: (id, group) => {
    const current = (get() as unknown as TxnGroupSlice).txnGroups;
    if (!current[id]) return;
    set({ txnGroups: { ...current, [id]: group } } as never);
  },

  removeTxnGroup: (id) => {
    const current = (get() as unknown as TxnGroupSlice).txnGroups;
    if (!current[id]) return;
    const next = { ...current };
    delete next[id];
    set({ txnGroups: next } as never);
  },

  getTxnGroup: (id) => (get() as unknown as TxnGroupSlice).txnGroups[id],
});
