# Plan: AI-driven Table Selection via `materializeTable` + `bank` handle datatype

## Summary

Two coupled changes on top of a clean base:

1. Replace ad-hoc table parsing in the Extractor with a small AI step that returns only spatial separators, plus a pure `materializeTable` function that reconstructs cells from OCR words.
2. Add a new handle datatype `bank` so a materialized bank statement flows along an edge as a typed dataset, consumed by `MatchNode` for reconciliation. No new node type, no per-row region dump.

Both depend on first reverting the recent "everything is a table" detour and porting forward only the salvageable pieces.

---

## Step 0: undo the "everything is a table" detour

Revert these 5 commits on `preview` before starting the rest:

```
9ea07ad Improve balance sheet
5d423c2 Improve OCR w BANK
f19fabe Improve matchnode semantics
e144d13 Improve clipping
aa1260e Setup table systems
```

The previous direction conflated "table" with the universal data shape, pushing table semantics into MatchNode, ExtractorNode region rendering, GroupNode, RegionTable, and the reconciliation engine. The new direction keeps tables as one materialization output among many, and reconciliation moves to a typed `bank` handle datatype rather than table-shaped regions.

**Method**

- Preferred: `git revert aa1260e..HEAD` (5 revert commits, history preserved). Squash into one revert PR if a clean history is wanted.
- `git reset --hard 0ca68f3` only if `preview` has not been pushed, or the user explicitly opts into a force-push.

**Salvage list (port forward by hand on top of the revert)**

- `src/__tests__/extraction/tableParser.test.ts`: still valid against the refactored materializer.
- `src/core/extraction/ocrExtractor.ts` additions for region OCR (`extractFullPageFromRegion`, page-size plumbing). The materializer needs them.
- `src/core/extraction/tableParser.ts` heuristic separator clustering logic. Reused as the non-AI fallback in step 2.
- Anything in `src/components/canvas/MultiHandleSelect.tsx` that is generally useful for typed handles. The `bank` datatype work in step 5 will lean on multi-handle UI.
- Verify `public/fixtures/bank-statements/*` and the auto-detect AI plumbing in `aiService.ts` are untouched (they predate the 5 commits).

**Drop list (do not port forward)**

- `MatchNode` row-matching primitives in `src/core/reconciliation/matchEngine.ts` and related tests. The new direction is bank-typed reconciliation, not generic row matching.
- `src/components/nodes/match/SyncModal.tsx` and `matchRows.ts` if they assume the table-everywhere model.
- `RegionTable.tsx` extensions that render N-rows-as-table inside the Extractor. Replaced by the `bank` handle summary chip.
- `plans/reconciliation-system-v3.md`: superseded by this plan. Delete or mark historical.

Land the revert + salvage as its own PR. After it merges, every file path and symbol referenced below applies to that base, not to current `HEAD`.

---

## Core idea

AI returns a minimal spatial schema. Code does the bookkeeping.

```ts
export interface TableSelection {
  bbox: { x0: number; y0: number; x1: number; y1: number }; // normalized 0-1 of page
  rowYs: number[];   // sorted, between-row separators in normalized y
  colXs: number[];   // sorted, between-col separators in normalized x
  headerRowIndex?: number;
}

export interface MaterializedTable {
  headers: string[];
  rows: string[][];
  cellBoxes: BBox[][]; // for region creation / debugging
}
```

`materializeTable(selection, ocr, pageSize)`:
1. Convert separators to page pixels.
2. Filter OCR words inside `bbox`.
3. Bucket each word into `(row, col)` by `colXs` / `rowYs`.
4. Concatenate words per cell in reading order.
5. `headerRowIndex` row becomes `headers`; remaining rows become `rows`.

**Why this split**
- AI does spatial reasoning (where are the lines?), not bookkeeping (which word in which cell?).
- Cheap, deterministic reconstruction. No re-prompt to fix a misassigned cell.
- Same primitive powers manual editing: dragging a separator re-runs `materializeTable` instantly.
- Trivially testable with fixture OCR (CBA + NAB statements).

**Coordinate space**

All separators and bboxes are normalized 0-1 against the rendered page. OCR word bboxes are converted to the same space once on ingest. Decouples AI output from render scale.

---

## Integration with the Extractor

The existing `selectionMode === 'table'` flow stays intact at the symbol level:

- The toolbar `table` button still toggles `selectionMode`.
- A user-drawn bbox routes through `handleBoxDraw` then `handleTableExtract`.
- Inside `handleTableExtract`, the only swap is the inference step:
  - **Before:** `extractFullPageFromRegion(...)` -> `parseTableFromOcr(ocr)` -> `{ headers, rows }`.
  - **After:** `extractFullPageFromRegion(...)` -> obtain `TableSelection` (AI or heuristic) -> `materializeTable(selection, ocr, pageSize)` -> `MaterializedTable`.
- The downstream block (column merge, region build, toast) consumes `MaterializedTable.headers` / `rows` directly. Same shape, same code path.

(Specific line numbers are intentionally omitted; they will shift once Step 0 lands.)

**Editable separators (UX win)**

Persist `TableSelection` on the region. Render `colXs` / `rowYs` as draggable lines in the canvas overlay. On drag-end re-run `materializeTable` synchronously and update regions. No re-prompt.

**Fallback when AI disabled**

Heuristic clustering of OCR x-positions and line grouping (the salvaged `parseTableFromOcr` logic) produces a `TableSelection` and feeds the same `materializeTable`. One code path. AI vs heuristic differs only in how separators are produced.

---

## New `bank` handle datatype

A materialized bank-statement table is a *dataset*, not a per-row visual artifact. Don't bloat the Extractor's region list with N rows. Add a new **handle datatype** `bank` alongside the existing types (`text`, `number`, etc.). The Extractor exposes an output handle typed `bank`. `MatchNode` accepts `bank` on a typed input port.

This is **not** a new node type. The dataset travels along an existing edge between existing nodes, just with a richer type than `text`.

**Shape carried on a `bank` handle**

```ts
interface BankDataset {
  account?: string;
  currency?: string;
  statementPeriod?: { from: string; to: string };
  transactions: BankTransaction[];
  origin: { fileId: string; pageRange: [number, number] };
}

interface BankTransaction {
  id: string;
  date: string;        // ISO
  description: string;
  amount: number;      // signed; debit negative, credit positive
  balance?: number;
  raw: Record<string, string>; // unmapped original cells
}
```

**How it slots in**

- Register `bank` in the handle/datatype system (find where `text` / `number` are registered). Includes color, icon, compatibility rules.
- When the Extractor's table output is designated as a bank statement, it exposes one `bank`-typed output handle carrying the dataset, instead of writing N row regions. Conversion happens via a `materializedTableToBank` adapter.
- Extractor UI shows a small bank-summary chip on that handle: account, period, txn count, totals in/out. Optional collapsed disclosure to peek at rows.
- `MatchNode` gains an input port that accepts `bank` (and likely two for statement-vs-ledger reconciliation). Reconciliation rules (amount + date-window match, fuzzy description match) become first-class because the type is known.

**Extractor toggle**

Small switch in the table-selection flow: "Output as: Regions | Bank". Default heuristic: if AI-detected headers match a bank-ish schema (date / description / amount), suggest Bank with user confirm. Otherwise the existing region-per-row behavior is used.

---

## Files

**Add**
- `src/core/extraction/tableMaterializer.ts`: types + pure `materializeTable`. No AI imports.
- `src/core/extraction/tableMaterializer.test.ts`: vitest snapshot tests using fixture OCR from `public/fixtures/bank-statements/cba-statement.pdf` and `nab-statement.pdf` plus hand-authored `TableSelection` inputs.
- `src/core/sources/bankDataset.ts`: `BankDataset` / `BankTransaction` types + `materializedTableToBank` adapter.
- `src/core/match/bankReconciliation.ts`: matching primitives consumed by `MatchNode`.

**Change**
- `src/services/aiService.ts`: add `detectTableWithAI(image, ocrWords, bbox?)` returning `TableSelection`. Strict zod schema. Prompt forbids emitting cell text. Reuses the existing AI SDK plumbing used by `detectFieldsWithAI`.
- `src/core/extraction/tableParser.ts` (salvaged version): keep the heuristic, but reduce its public surface to producing a `TableSelection` from OCR clusters. Then route through `materializeTable`. Eliminates the parallel pipeline.
- `src/components/nodes/ExtractorNode.tsx`: swap inference step in the table handler; add Output mode toggle; emit `bank`-typed handle when Bank is chosen.
- Handle/datatype registry (location to confirm in salvaged code): register `bank`.
- `src/components/nodes/MatchNode.tsx`: accept `bank`-typed input(s); add reconciliation rule UI.

---

## Order of work

0. Land the revert + salvage PR (Step 0 above). All later steps assume that base.
1. Add `tableMaterializer.ts` + tests. No UI change.
2. Refactor salvaged `parseTableFromOcr` to emit a `TableSelection` and route through `materializeTable`. Behavior unchanged. Proves the seam.
3. Add `detectTableWithAI` in `aiService.ts`. Switch table mode to prefer it, falling back to heuristic.
4. Add draggable separator handles on the canvas overlay. Persist `TableSelection` per region.
5. Register the `bank` datatype. Add `bankDataset.ts` types + `materializedTableToBank` adapter + tests against CBA / NAB fixtures.
6. Wire Extractor's table mode to emit on a `bank`-typed output handle when chosen. Add Output mode toggle.
7. Extend `MatchNode` to accept `bank` inputs and run reconciliation primitives.

Steps 1-2 are safe refactors. Steps 3-4 are additive UX. Steps 5-7 deliver the new datatype end to end.

---

## Acceptance

- User clicks `table` mode, drags a bbox over a table on the CBA statement, headers and rows materialize correctly without manual column tweaking.
- With AI disabled, the same bbox still produces a reasonable table via heuristic separators.
- Dragging a column separator updates the materialized cells immediately. No AI call.
- When Output mode is Bank, the Extractor exposes a `bank`-typed handle (not row regions), and `MatchNode` can connect to it and run reconciliation.
- Vitest suite passes. `npx tsc -p tsconfig.app.json --noEmit` clean.
