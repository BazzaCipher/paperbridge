/**
 * TxnGroup handle protocol.
 *
 * A handle id of the form `txngroup:<name>` carries a TxnGroup reference
 * across an edge. `<name>` is either a TxnGroup id (for dynamic emitters
 * like Extractor invoice / Group aggregation) or a static slot name (e.g.
 * `source-a`, `matched`) used by nodes with fixed roles like Match.
 */

export const TXNGROUP_HANDLE_PREFIX = 'txngroup:';

/** Emerald — used by every TxnGroup-typed handle. */
export const TXNGROUP_HANDLE_COLOR = '#10b981';

export const txnGroupHandle = {
  /** Build a `txngroup:<name>` handle id. */
  make(name: string): string {
    return `${TXNGROUP_HANDLE_PREFIX}${name}`;
  },

  /** True if `id` is a TxnGroup-typed handle. */
  is(id: string | null | undefined): boolean {
    return !!id && id.startsWith(TXNGROUP_HANDLE_PREFIX);
  },

  /** Strip the prefix; returns null if `id` is not a TxnGroup handle. */
  parse(id: string | null | undefined): string | null {
    if (!txnGroupHandle.is(id)) return null;
    return (id as string).slice(TXNGROUP_HANDLE_PREFIX.length);
  },
};
