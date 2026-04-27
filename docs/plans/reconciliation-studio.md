# Reconciliation Studio — Plan

> Picks up from `table-materializer.md` Step 7. The bank-handle work landed
> partially under the name `bank:` but the user reframed the model: matching
> is the primary use case, "bank" is just one variant of "a group of
> transactions", and grouped invoice files should aggregate into the same
> shape as a bank statement. This plan supersedes Step 7 of the previous
> plan.

## Reframing

**MatchNode is not a function — it is a doorway into a reconciliation
workspace.** On the canvas the node stays small (label, count chip,
"Open" button). The actual reconciliation happens in a full-screen
*Studio* (Xero-style, two side-by-side tables, no drawn connection
lines).

The thing that flows on edges is not "a bank dataset" — it is a generic
**TxnGroup** (a labeled bag of `Transaction`s). A bank statement is one
TxnGroup. A single invoice is a TxnGroup of size 1. A collapsed Group of
50 invoices is a TxnGroup of size 50.

This unifies bank-to-bank, bank-to-invoice, and invoice-to-invoice
matching under one type and one input shape.

## Final data model

```ts
// src/core/sources/txnGroup.ts (replaces src/core/sources/bankDataset.ts)

interface Transaction {
  id: string;            // FNV-1a stable hash of date+amount+description
  amount: number;        // signed; debit negative, credit positive
  date: string;          // ISO 'YYYY-MM-DD'; '' if unknown
  description: string;
  raw?: Record<string, string>;
  sourceNodeId: string;  // for highlight wiring back to canvas
  sourceRowId: string;   // region id, original txn id, etc.
}

interface BankStatementMeta {
  account?: string;
  currency?: string;     // ISO 4217
  statementPeriod?: { from: string; to: string };
  openingBalance?: number;
  closingBalance?: number;
}

interface TxnGroup {
  id: string;            // 'txngroup-<ts>-<rand>'
  label: string;         // user-visible: "Bank A · March", "March invoices"
  transactions: Transaction[];
  origin: {
    kind: 'bank' | 'invoice' | 'aggregated';
    nodeIds: string[];   // contributing node ids
    extractedAt: string; // ISO timestamp
  };
  meta?: BankStatementMeta; // only when kind==='bank'
}
```

`BankDataset` and `BankTransaction` go away. `materializedTableToBank`
becomes `materializedTableToTxnGroup`. `bankSlice` becomes
`txnGroupSlice`. Handle id prefix `bank:` becomes `txngroup:`.

## Connection contract

- Source handle id starts with `txngroup:<txnGroupId>` — payload is a
  reference into `txnGroupSlice`, not the full data.
- Target handle id starts with `txngroup:` — opts in to receiving a
  TxnGroup reference.
- `validateConnection` already gates `bank:` ↔ `bank:`; rename to
  `txngroup:`. No other rule changes.

## Where TxnGroups come from

Three production paths, all converging on the same shape:

1. **Bank table extraction** (already implemented under the `bank` name).
   `materializeTable` → `suggestBankMapping` → `materializedTableToTxnGroup`.
   Origin kind: `'bank'`. `meta` populated.

2. **Role-tagged invoice extraction** (NEW). An ExtractorNode gains a
   per-region `role?: 'amount' | 'date' | 'description'` field. When at
   least one region has `role: 'amount'`, the Extractor exposes a
   `txngroup:` handle whose payload is a single-Transaction TxnGroup
   built from the role-tagged regions:
   - `amount` ← value of the amount-roled region
   - `date` ← value of the date-roled region (or `''`)
   - `description` ← value of the description-roled region, falling
     back to the **node's `data.label`** if not tagged
   AI field detection (`detectFieldsWithAI`) writes roles automatically
   when it returns `total_amount` / `date` / `name` field types.
   Origin kind: `'invoice'`.

3. **GroupNode aggregation on collapse** (NEW, the multi-file solution).
   When a Group collapses, walk children, collect every child output
   that's a `txngroup:` handle, concat their `transactions[]` into a new
   TxnGroup keyed by the group id, expose as `txngroup:<groupId>` on the
   collapsed group node. Recompute when child outputs change. On expand,
   drop the aggregate; children re-expose their own handles.
   Origin kind: `'aggregated'`. The group's user-set label becomes the
   TxnGroup label.

   Heterogeneous groups (some txn-emitters, some not) only aggregate the
   txn-emitters; non-txn outputs continue to mirror individually via the
   existing `groupOutputsRef` logic in `LynkCanvas.tsx`.

## MatchNode

Restored from `aa1260e` last session at `src/components/nodes/MatchNode.tsx`.
Current state: two target handles `source-a` / `source-b` both on
`Position.Left`, generic `runMatch` against extractor row views.

Changes for this plan:
- Move `source-a` to `Position.Top`, `source-b` to `Position.Bottom`.
- Both target handles accept `txngroup:` only. Drop the
  `extractorRows`/`runMatch` path entirely (delete `match/matchRows.ts`,
  delete `core/reconciliation/matchEngine.ts` use from MatchNode — the
  file can stay if it has other uses, but MatchNode does not depend on
  it). The single reconciliation engine is `bankReconciliation.reconcile`,
  which should be renamed `reconcile` in `src/core/reconciliation/reconcile.ts`
  and operate on `Transaction[]` regardless of source.
- The on-canvas node body shows: label (editable), count chip
  ("23 / 47 matched · 4 ambiguous"), "Open" button. No tolerance/key
  controls inline.
- Outputs unchanged: `matched`, `unmatched-a`, `unmatched-b` on the
  right. Each output is itself a `txngroup:` (a TxnGroup of the matched
  / unmatched-a / unmatched-b transactions) so downstream nodes can
  consume them.

## The Studio

Full-screen overlay, **not** a slide-in modal. Esc to leave. Replaces
`SyncModal` (delete `src/components/nodes/match/SyncModal.tsx` once the
Studio is in).

Layout:

```
┌──────────────────────────────────────────────────────────┐
│ Tolerance $0.05  Date ±7d  [Auto]  [Show: All ▾]    Esc │
├────────────────────────────┬─────────────────────────────┤
│ A · 47                     │ B · 8                       │
├────────────────────────────┼─────────────────────────────┤
│ 03/12  -$42.50  Coffee     │ ─                           │
│ 03/13 -$120.00  Acme Corp  │ Acme Corp  $120.00  03/13   │
│ 03/15  -$42.50  Cafe       │ Cafe ABC   $42.50   --      │
│ ...                        │ ...                         │
├────────────────────────────┴─────────────────────────────┤
│ 6 confirmed · 1 ambiguous · 41 unmatched                  │
└──────────────────────────────────────────────────────────┘
```

Behaviour:
- Rows align horizontally when matched. Unmatched rows leave the
  opposite cell as `─`. **No drawn lines** — alignment is the visual
  cue. Xero-style.
- Color encoding per pair: green = high-confidence auto, yellow =
  matched but had alternatives or missing date, red = user-rejected,
  gray = unmatched.
- Click an unmatched row → opposite-side compatible candidates
  highlight. Click a candidate → confirms the match (rows realign).
- Drag from one row to another → manual match (overrides auto).
- Right-click a matched pair → unlink.
- Hover a pair → score breakdown tooltip
  (`amount Δ $0.00 · date Δ 1d · desc 0.78`).
- Top toolbar: tolerance ($), date window (days), "Auto" re-runs
  reconcile non-destructively (manual matches remain locked), filter
  dropdown (All / Unmatched only / Ambiguous only), text search.
- Sort modes: by date asc (default), by amount desc, by status. Per
  side independently? — start with shared sort, split if needed.
- Bottom statusbar: counts.
- Persistence: matched pairs, manual overrides, and rejections live on
  `MatchNodeData` (`pairs`, `unmatchedLeft`, `unmatchedRight`,
  `manualOverrides`, `rejections`). Re-opening preserves all decisions.

## Reconciliation engine

The current `bankReconciliation.reconcile` (8 tests, landed earlier this
session) is the right shape. Rename to `reconcile` and operate on
`Transaction[]`. Hard gates: signed amount within `amountTolerance` AND
date within `dateWindowDays` (skip date gate when either side has empty
date — match by amount only with reduced confidence). Tie-break: Dice
bigram description similarity. Greedy assignment by descending score.

When the user manually matches a pair, that pair is locked. Re-running
auto-match honours locks: removes locked txns from the candidate pool
before scoring.

## Build order (hand off to next session)

1. **Rename `bank:` → `txngroup:` everywhere.** Mechanical sweep:
   - `src/core/sources/bankDataset.ts` → `src/core/sources/txnGroup.ts`,
     types renamed (`BankDataset`→`TxnGroup`, `BankTransaction`→
     `Transaction`, `materializedTableToBank`→`materializedTableToTxnGroup`).
     Bank-specific metadata moves into optional `meta: BankStatementMeta`.
   - `src/store/slices/bankSlice.ts` → `txnGroupSlice.ts`. Action names
     `addBankDataset` → `addTxnGroup` etc.
   - Handle id prefix `bank:` → `txngroup:` in `ExtractorNode.tsx`,
     `connectionValidation.ts`, tests.
   - `'bank'` data-type entry in `ExtendedDataType` / `ExtendedDataTypeSchema`
     becomes `'txngroup'`.
   - All tests in `__tests__/sources/`, `__tests__/store/`,
     `__tests__/core/connectionValidation.test.ts` updated.
   - `Transaction` carries `sourceNodeId` and `sourceRowId`. Update
     `materializedTableToTxnGroup` to populate these from the extractor
     node id and the synthesized row ids.
   - tsc + full vitest must remain green after this step.

2. **Region roles**:
   - Add `role?: 'amount' | 'date' | 'description'` to `ExtractedRegion`
     in `src/types/regions.ts`.
   - UI: right-click on a region in `HighlightOverlay` (or wherever the
     region context-menu lives) → "Tag as: amount / date / description /
     none". Visible role chip on the region.
   - When AI field-detection (`detectFieldsWithAI`) returns
     `total_amount` / `date` / `name`, auto-set the role on the created
     region (`total_amount` → `amount`, `name` → `description`).

3. **Invoice TxnGroup emission**:
   - In `ExtractorNode.tsx`, derive a `txngroup:<id>` source handle
     when `data.regions.some(r => r.role === 'amount')`. Build a
     single-Transaction TxnGroup from role-tagged regions. Description
     fallback: `data.label`. Persist the TxnGroup id on the extractor
     (`data.invoiceTxnGroupId?: string`) so it survives reload.
   - Origin kind `'invoice'`. `meta` undefined.
   - The existing bank-table emission stays; just both paths now go
     through the same `addTxnGroup` slice action.

4. **Group aggregation on collapse**:
   - In `LynkCanvas.tsx` (or a sibling file), when `groupNode.data.collapsed`
     becomes true, walk `nodes.filter(n => n.parentId === groupId)`,
     collect their `txngroup:` outputs (look at each child's output
     handles), concat the referenced TxnGroups' `transactions[]`,
     `addTxnGroup({ kind: 'aggregated', nodeIds: childIds, ... })`,
     mirror as `txngroup:<groupId>` on the collapsed group node.
   - Recompute when child outputs change (existing `groupOutputsRef`
     mirror loop is the hook — extend its dependency tracking).
   - On expand, remove the aggregate from the slice and drop the mirrored
     handle.
   - GroupNode renders the aggregated handle in its collapsed state.
   - Heterogeneous groups: only txn-emitters contribute; other outputs
     mirror individually as today.

5. **MatchNode revamp**:
   - Move handles to top/bottom. Both `txngroup:` targets only.
   - Strip `runMatch`/`extractorRows` path. Resolve top + bottom inputs
     to TxnGroups via `txnGroupSlice.getTxnGroup`. Run `reconcile()`.
   - Body: editable label, count chip, "Open" button. No inline
     controls.
   - Persist `pairs`, `unmatchedLeft`, `unmatchedRight`,
     `manualOverrides: Array<{ aId: string; bId: string }>`,
     `rejections: Array<{ aId: string; bId: string }>` on
     `MatchNodeData`.
   - Outputs (`matched`, `unmatched-a`, `unmatched-b`) become
     `txngroup:` handles, each backed by a derived TxnGroup in the slice.

6. **Studio**:
   - New file `src/components/nodes/match/ReconciliationStudio.tsx`.
     Full-screen `createPortal` overlay.
   - Two side-by-side tables, aligned by match status (matched pairs
     share a row index; unmatched rows have a blank cell on the
     opposite side).
   - Top toolbar: tolerance / date window / Auto / filter / search.
   - Click-to-confirm, drag-to-link, right-click-to-unlink, hover for
     score breakdown.
   - Bottom statusbar: counts.
   - Sort: by date asc default. Toggle by amount / status.
   - Delete `SyncModal.tsx` after Studio replaces it.

7. **Cleanup**:
   - `core/reconciliation/matchEngine.ts` and `match/matchRows.ts` are
     no longer referenced by MatchNode after step 5. Delete them and
     the `matchEngine.test.ts` file (or keep the engine file if desired
     as a generic utility — but MatchNode must not depend on it).
   - `bankReconciliation.ts` → renamed to `reconcile.ts`. Rename
     `bankReconciliation.test.ts` to `reconcile.test.ts`. Update
     types from `BankDataset` → `TxnGroup` etc.

## Acceptance

- A user can drop 50 invoice PDFs onto the canvas, run AI field
  detection (each Extractor gets `amount` / `date` / `description`
  roles auto-tagged), select all 50, group them, collapse the group,
  and connect the group's single `txngroup:` handle to the bottom
  input of a MatchNode. Connect a bank statement extractor's
  `txngroup:` handle to the top input. Click "Open" → Studio shows
  47 bank txns vs 50 invoices, with the auto-matched pairs aligned
  side-by-side, ambiguous ones flagged, unmatched ones on either
  side leaving the opposite cell blank.
- Manual click-to-confirm and drag-to-link work. Re-running Auto
  preserves manual matches. Closing and reopening preserves all
  decisions.
- `npx tsc -p tsconfig.app.json --noEmit` clean.
- Full vitest suite passes (currently 490/490 + new tests for steps).

## Deferred

- **Match learning** — persisting `(bankDescription → invoiceVendor)`
  mappings so next reconciliation pre-fills matches. Worth it but a
  follow-up project.
- **Templates / batch invoice extraction** — re-applying role-tagged
  regions across a folder of similar invoices from a single Extractor.
  Currently the user has one Extractor per file. This is the natural
  next problem after the studio works end-to-end.
- **Output downstream** — what happens after reconciliation? Posting
  to a ledger node, exporting a CSV, etc. Not in scope here.

## Files / context for the next session

**Already-uncommitted on `preview` (don't lose these):**
- `src/core/sources/bankDataset.ts` (rename target)
- `src/store/slices/bankSlice.ts` (rename target)
- `src/__tests__/sources/bankDataset.test.ts` (rename target)
- `src/__tests__/store/bankSlice.test.ts` (rename target)
- `src/core/reconciliation/bankReconciliation.ts` (rename to `reconcile.ts`)
- `src/__tests__/reconciliation/bankReconciliation.test.ts` (rename)
- `src/components/nodes/MatchNode.tsx` (revamp per step 5)
- `src/components/nodes/match/matchRows.ts` (delete in step 7)
- `src/components/nodes/match/SyncModal.tsx` (delete in step 6)
- `src/core/reconciliation/matchEngine.ts` + tests (delete or keep,
  but unused by MatchNode after step 5)

**Modified files to be aware of:**
- `src/types/data.ts` — `'bank'` in `ExtendedDataType`
- `src/schemas/canvas.ts` — `'bank'` in `ExtendedDataTypeSchema`
- `src/types/regions.ts` — `bankDatasetId?` on `TableRecord`,
  `cells?` on `ExtractedRegion`, `ExtractorColumn`
- `src/types/nodes.ts` — `MatchNodeData`, `'match'` in `LynkNodeType`,
  `columns?` on `ExtractorNodeData`
- `src/types/categories.ts` — `'match'` in `CanExport` / `CanImport`
- `src/types/index.ts` — Match exports
- `src/store/canvasStore.ts` + `src/store/slices/index.ts` +
  `src/store/slices/types.ts` — bank slice composed in
- `src/components/canvas/nodeDefaults.ts` — `defaultMatchData`,
  `DEFAULT_EXTRACTOR_COLUMNS`
- `src/core/nodes/registerAll.ts` — match node registered
- `src/components/nodes/ExtractorNode.tsx` — bank handle emission
  (suggester, addBankDataset)
- `src/core/engine/connectionValidation.ts` — `bank:` prefix rule

**Verify before acting:** the sweeping rename touches a lot. Re-read
this plan and re-run `git log preview` first; the codebase will have
moved. Run `npx tsc -p tsconfig.app.json --noEmit` after every step
since TS will guide most of the rename mechanics. Run the full
vitest suite after step 1 (rename) before adding behaviour.
