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

### Shape

```ts
// src/core/sources/bankDataset.ts
export interface BankTransaction {
  id: string;             // stable hash of date+amount+description for dedupe across re-extracts
  date: string;           // ISO date "YYYY-MM-DD"
  description: string;
  amount: number;         // signed; debit negative, credit positive
  balance?: number;       // running balance if present in the statement
  raw: Record<string, string>; // every original cell keyed by header label
}

export interface BankDataset {
  account?: string;
  currency?: string;      // ISO 4217, e.g. "AUD"
  statementPeriod?: { from: string; to: string };
  openingBalance?: number;
  closingBalance?: number;
  transactions: BankTransaction[];
  origin: {
    fileId: string;
    pageRange: [number, number];
    extractedAt: string;  // ISO timestamp
    sourceHeaders: string[]; // original header labels for traceability
  };
}
```

### Adapter

```ts
// src/core/sources/bankDataset.ts
export interface BankColumnMapping {
  date: string;            // header label that maps to BankTransaction.date
  description: string;
  amount?: string;         // single signed amount column
  debit?: string;          // OR debit + credit pair (CBA-style)
  credit?: string;
  balance?: string;
}

export function materializedTableToBank(
  table: MaterializedTable,
  mapping: BankColumnMapping,
  meta: {
    fileId: string;
    pageRange: [number, number];
    account?: string;
    currency?: string;
    statementPeriod?: { from: string; to: string };
  },
): BankDataset;
```

Mapping is supplied either by user picks (dropdowns per header in the Extractor toggle UI) or by an auto-suggest pass — see *Auto-detect* below. Date strings are normalized via `normalizeDate(raw, hintFormat?)` (a small util that handles `DD/MM/YYYY`, `YYYY-MM-DD`, and `DD MMM YYYY`). Amount strings are normalized via `parseSignedAmount(raw, { negativeParens: true, currencySymbols: true })`.

### Auto-detect mapping

`suggestBankMapping(table: MaterializedTable): { mapping: BankColumnMapping | null; confidence: number }`:
- Score each header against keyword sets: `/date|posted|trans/i`, `/desc|narr|details|ref/i`, `/amount|amt/i`, `/debit|withdraw/i`, `/credit|deposit/i`, `/balance/i`.
- Boost score with sample-row content checks: column with 80%+ rows matching `/^\d{1,2}[\/\- ]\d{1,2}[\/\- ]\d{2,4}$/` is `date`; column with 80%+ rows matching `/^[\$\-\(]?[\d,]+\.\d{2}\)?$/` is amount/debit/credit/balance.
- Confidence threshold (e.g. 0.7) gates whether the Extractor *suggests* Bank output without prompting.

### Registry / type system locations

After the revert, the relevant places (verify before editing):

- `src/types/regions.ts` and `src/types/categories.ts` — current `DataValue` / category types. Add a `bank` data category and a `BankDatasetValue` variant of `DataValue` carrying `BankDataset` (or a reference to a stored dataset; see *Store* below).
- `src/core/engine/connectionValidation.ts` — connection compatibility matrix. `bank` outputs accept `bank` inputs only (no implicit coercion to `text` initially; revisit if needed).
- `src/components/canvas/nodeDefaults.ts` — handle color/icon defaults. Pick a distinct color (e.g. emerald) and an icon for `bank`.
- `src/store/canvasStore.ts` / a new `src/store/slices/bankSlice.ts` — datasets are heavy; **store them by id** in a `bankDatasets: Record<string, BankDataset>` slice, and have the handle payload carry only `{ kind: 'bank', datasetId }`. Keeps node JSON small and re-renders cheap.

### How it slots in

- Extractor table flow: after `materializeTable` returns, run `suggestBankMapping`. If confidence >= threshold, show "Detected bank statement — output as Bank?" (Yes / No). On Yes: `materializedTableToBank(...)` → store via `bankSlice.add` → expose a `bank`-typed output handle whose payload is `{ kind: 'bank', datasetId }`.
- Extractor UI shows a small chip on the `bank` handle: account, period, `N txns`, `Σ in / Σ out`. Click expands a popover with the first ~10 rows.
- Region list is **not** populated with N row regions when Bank output is chosen. The visual table overlay (step 4 separators) stays on the page for editability, but rows live in the dataset.
- `MatchNode` gains two `bank`-typed input ports (`statementA`, `statementB`) and runs reconciliation. Output is a `MatchResult` typed handle (existing or new `match` datatype — defer until step 7).

### Reconciliation primitives (step 7)

```ts
// src/core/match/bankReconciliation.ts
export interface ReconcileOptions {
  amountTolerance: number;   // absolute, e.g. 0.01
  dateWindowDays: number;    // e.g. 3 (CC posting lag)
  descriptionMinSimilarity: number; // 0-1 (Dice or token-set ratio)
}

export interface MatchedPair { a: BankTransaction; b: BankTransaction; score: number; reasons: string[]; }
export interface ReconcileResult {
  matched: MatchedPair[];
  onlyInA: BankTransaction[];
  onlyInB: BankTransaction[];
}

export function reconcile(a: BankDataset, b: BankDataset, opts: ReconcileOptions): ReconcileResult;
```

Algorithm: signed-amount equality (within tolerance) is hard gate; date within window is hard gate; description similarity tie-breaks ambiguous matches. Greedy assignment ordered by descending score. No global-optimal Hungarian; pragmatic and explainable.

### Extractor toggle

Small switch in the table-selection flow: "Output as: Regions | Bank". Default to whichever `suggestBankMapping` recommends. User can flip without re-running OCR.

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

0. ✅ **DONE.** Revert + salvage landed on `preview` (commits `ec1d9cf..ee09c1e`). Salvaged: `extractFullPageFromRegion`, `tableParser.ts` heuristic, `MultiHandleSelect.tsx`, fixtures.
1. ✅ **DONE** (`45a46ee`). `tableMaterializer.ts` with `TableSelection` / `MaterializedTable` / `materializeTable`. 3 vitest cases.
2. ✅ **DONE** (`45a46ee`). `parseTableFromOcr` refactored to build a `TableSelection` via `buildTableSelectionFromOcr` then route through `materializeTable`. 3 heuristic tests still pass.
3. 🟡 **PARTIAL** (`539f3e2`). Service-layer done: `detect_table` mode + system prompt in `api/ai/chat.ts`, `detectTableWithAI` in `aiService.ts` returning a validated `TableSelection`. **NOT DONE:** wiring into `ExtractorNode` — there is no `'table'` selection mode in the post-revert UI. See Step 3b below.
4. Add draggable separator handles on the canvas overlay. Persist `TableSelection` per region.
5. Register the `bank` datatype. Add `bankDataset.ts` types + `materializedTableToBank` adapter + tests against CBA / NAB fixtures.
6. Wire Extractor's table mode to emit on a `bank`-typed output handle when chosen. Add Output mode toggle.
7. Extend `MatchNode` to accept `bank` inputs and run reconciliation primitives.

Steps 1-2 are safe refactors. Steps 3-4 are additive UX. Steps 5-7 deliver the new datatype end to end.

### Step 3b — wire `'table'` mode into ExtractorNode (new, picked up here)

The reverted "Setup table systems" commit introduced the `'table'` toolbar mode and `handleTableExtract`. Both are gone. To resume:

1. Extend `selectionMode` union in `src/components/nodes/ExtractorNode.tsx:58` to `'select' | 'box' | 'text' | 'table'`.
2. Add a toolbar button alongside the existing select/box/text triple. Reuse the `box` interaction model — same drag-bbox behavior, different submit handler.
3. Add `handleTableExtract(region: RegionCoordinates)`:
   - call `extractFullPageFromRegion(imageSource, region)` → `FullPageOcrResult`
   - convert `region` to normalized 0-1 page coords via the existing page-size plumbing (used by `box` mode)
   - if AI is enabled (existing `aiSettings` check used by `detectFieldsWithAI`), call `detectTableWithAI({ images, ocrWords, hintBbox })`. Else fall back to `buildTableSelectionFromOcr(ocr)?.selection`.
   - call `materializeTable(selection, ocr, pageSize)` → `MaterializedTable`
   - persist `selection` on the created region (new field on `RegionCoordinates` or sibling table-region type — TBD when step 4 lands)
   - emit one region per row using the existing region-creation path (until step 6 swaps in the `bank` handle)
4. Toast on success/error mirroring the existing `box` flow.

This keeps step 3b additive and unblocks step 4 (which needs a persisted `TableSelection` to drag).

---

## Acceptance

- User clicks `table` mode, drags a bbox over a table on the CBA statement, headers and rows materialize correctly without manual column tweaking.
- With AI disabled, the same bbox still produces a reasonable table via heuristic separators.
- Dragging a column separator updates the materialized cells immediately. No AI call.
- When Output mode is Bank, the Extractor exposes a `bank`-typed handle (not row regions), and `MatchNode` can connect to it and run reconciliation.
- Vitest suite passes. `npx tsc -p tsconfig.app.json --noEmit` clean.
