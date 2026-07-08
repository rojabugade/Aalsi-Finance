# Multi-Image Receipt Grouping & Batch Ingest — Design

**Date:** 2026-06-27
**Status:** Approved (pre-implementation)
**Branch context:** built on `feat/analyst-memory-awareness`

## Problem

The `/capture` "Add anything" flow uploads each file as its own `Document`, runs
one OCR job per file, and surfaces one review card per file. Three gaps result:

1. **Same-receipt across multiple images** — a receipt photographed as two images
   (merchant on one, total on the other) becomes two independent, half-empty
   review cards. Neither is a valid transaction. There is no signal that the two
   images belong together.
2. **Mixed batch uploads** work for *distinct* files (each becomes its own item),
   but offer no way to express "these N images are one receipt."
3. **Multiple spreadsheets in one batch are silently dropped** —
   `capture/page.tsx` does `setSpreadsheet(sheets[0])`, so only the first CSV/XLSX
   opens the wizard; the rest vanish with no error and no queue entry.

## Goals

- Let a batch of mixed files (images, PDFs, spreadsheets) upload together, each
  distinct item becoming its own review entry (already works — preserve it).
- Auto-detect when images in the **same upload batch** are the **same receipt**,
  and **propose** a merge the user confirms or splits. Never silently merge
  financial data.
- Stop dropping extra spreadsheets — queue them and map one at a time.

## Non-goals

- Cross-batch detection (grouping images uploaded minutes apart in separate
  batches). Out of scope; batch scope is the safety boundary.
- Silent auto-merge. All merges are user-confirmed.
- Any DB schema / migration change. Everything rides existing JSONB.

## Key decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Grouping trigger | Auto-detect | User does nothing at upload time |
| Merge action | Propose, user confirms | False silent merge corrupts an amount irreversibly |
| Detection scope | Same upload batch only | Eliminates fusing unrelated receipts across time |
| Detection signal | Canonical merchant + **compatible totals** | Total conflict disambiguates "one receipt, two photos" from "two different trips" |
| Computation timing | Read-time grouping | No async barrier, no persisted group state, no new task/column |
| Multi-spreadsheet | Queue, map one at a time | Nothing dropped, minimal change to `CsvWizard` flow |

### The safety rule

Within a batch, cluster receipt/invoice docs by canonical merchant, but **only
propose a group when no two members have *conflicting* non-null totals**.

- Two photos of one receipt → one total + one null → **grouped**.
- Two different Walmart trips uploaded together → two different totals →
  **stay separate** (loose cards).

The total conflict is the disambiguator that makes auto-detect safe.

## Architecture

Read-time grouping. When the frontend fetches the review queue, the backend
groups the current `needs_review` documents by `batch_id`, clusters
same-receipt candidates, and returns suggested groups alongside loose items.
Detection is a pure function over the small review set; nothing is persisted
until the user confirms. The proposal is provisional by nature, so there is no
value in materializing it.

### 1. Batch tagging (frontend → backend)

`ingest()` generates **one `batch_id` (UUID) per call** and threads it through:

```
ingest() → enqueueCapture(file, {batchId}) → QueuedCapture.batchId
        → uploadDocument(form: batch_id) → POST /documents
        → create_document(batch_id) → ocr_meta["ingest"]["batch_id"]
```

- `web/lib/offline/db.ts` — add optional `batchId?: string` to `QueuedCapture`
  (additive; Dexie optional field needs no store migration).
- `web/lib/offline/sync.ts` — `enqueueCapture` and `uploadDocument` accept and
  forward `batchId` as a `batch_id` multipart field.
- `web/app/(app)/capture/page.tsx` — `ingest()` mints `const batchId =
  crypto.randomUUID()` once per call, passes it to every `enqueueCapture`.
- `backend/app/documents/router.py` — `upload_document` gains
  `batch_id: str | None = Form(default=None)`.
- `backend/app/documents/service.create_document` — store `batch_id` in
  `ingest_meta` (alongside `original_filename`, `source_label`, etc.).

A loose drop still gets a batch_id; a batch of one simply never forms a group.

### 2. Read-time grouping (backend, pure functions)

New module `backend/app/ocr/grouping.py`:

- `group_review_documents(docs) -> (groups, loose)`
  - bucket `needs_review` docs by `ocr_meta["ingest"]["batch_id"]`
  - within each bucket, consider docs of type `receipt`/`invoice`
  - cluster by `canonical_merchant` of the extracted merchant
  - emit a group only when the cluster has ≥2 docs **and** no two members carry
    conflicting non-null totals (the safety rule)
  - a cluster that collapses to 1 after filtering is demoted to loose
  - everything else (distinct merchants, statements, paystubs, csv, missing
    batch_id, conflicting totals) is **loose**

- `merge_extractions(docs) -> MergedExtraction`
  - field-level union of the members' `ocr_meta["ocr"]["data"]`:
    - `merchant`, `date`, `currency` → first non-null
    - `total`, `subtotal`, `tax` → the single non-null value; if two non-null
      values agree, keep it; (conflicting values can't occur — the safety rule
      already excluded them from the group)
    - `line_items` → concatenation of all members
  - returns the merged `ExtractionResult`-shaped payload plus
    `member_document_ids` (primary first)

These are pure (no DB/I/O) and unit-tested in isolation.

### 3. Review queue response shape

`backend/app/ocr/router.py` review-queue endpoint returns a grouped shape:

```jsonc
{
  "groups": [
    {
      "suggested_merge": ReviewItemOut,      // the merged preview
      "members": [ReviewItemOut, ReviewItemOut]
    }
  ],
  "items": [ReviewItemOut]                    // loose, as today
}
```

`ReviewItemOut` gains `batch_id: str | None`. `shared/api-schema.ts` regenerated.
`web/lib/api/review.ts` types updated to the grouped shape.

> Compatibility note: this changes the review-queue response from a flat list to
> `{groups, items}`. `useReviewQueue` and its one consumer (`ReviewQueueInline`)
> are updated together; there are no other consumers.

### 4. Group confirm / split (backend)

New endpoint `POST /review-queue/group/resolve`:

```jsonc
{ "member_document_ids": [...], "action": "confirm" | "split", "data": {...}? }
```

- **confirm**
  - re-read members; skip any no longer `needs_review` (stale)
  - `merge_extractions` over the survivors (apply `data` override if provided)
  - hand the single merged result to M6 `ingest_extraction` (one transaction)
  - mark the primary doc `processed`; mark each other member `processed` with
    `ocr_meta["ocr"]["merged_into"] = <primary_id>` (consumed, never re-ingested)
  - index document memory once (best-effort, mirrors `resolve_review`)
- **split** — server no-op; frontend falls back to per-card confirm via the
  existing `/review-queue/{id}/resolve`.

The existing per-document `resolve_review` is untouched.

### 5. Review UI (frontend)

`web/components/dashboard/analyst/...` is unrelated; changes live in
`capture/page.tsx` + `components/capture/`.

- `ReviewQueueInline` renders `groups` above loose `items`.
- New `SuggestedGroupCard`:
  - shows merged merchant / total / "from N images"
  - `[Confirm]` → group resolve (`confirm`)
  - `[Split apart]` → expands inline to the members' existing `ConfirmCard`s;
    each confirms/rejects individually via the current endpoint
- Loose `items` render with `ConfirmCard` exactly as today.

### 6. Spreadsheet queue (frontend, isolated)

- `capture/page.tsx` — replace `spreadsheet: File | null` with `sheets: File[]`;
  `ingest()` enqueues **all** detected sheets.
- `CsvWizard` gains an `onDone` callback; on finish/skip the page shifts the
  queue to the next sheet. Header shows "Mapping a.csv (1 of 3)".
- Nothing is dropped.

## Error handling & edge cases

- **Missing/old `batch_id`** (pre-feature docs, `manual`/`email`/`plaid`
  channels) → treated as loose, never grouped.
- **Stale member** — a member confirmed/rejected before the group is confirmed →
  group resolve re-reads and skips non-`needs_review` members, merges the rest;
  if fewer than 1 survive, returns the group as already-resolved.
- **Conflicting totals in a batch** → not grouped; separate loose cards (correct).
- **Group collapses to 1** after filtering → demoted to loose.
- **Memory indexing failure** on group confirm → swallowed, never breaks ingest
  (same contract as `resolve_review`).

## Testing strategy

**Backend (pure functions — `backend/tests/`):**
- `group_review_documents`: complementary fields → grouped; conflicting totals →
  split; mixed merchants → separate groups; different batches never group;
  statements/csv stay loose; missing batch_id → loose; single-doc cluster
  demoted.
- `merge_extractions`: field union, line-item concatenation, agreeing-total pick.
- Group resolve endpoint: confirm creates exactly one transaction and marks the
  other members `merged_into`; split is a no-op; stale-member skip path.

**Frontend (vitest):**
- `SuggestedGroupCard`: confirm calls group resolve; split expands to per-card
  confirm.
- Spreadsheet queue: dropping 3 sheets maps all three in sequence, drops nothing.
- `ReviewQueueInline`: renders groups above loose items.

## Boundaries (isolation check)

- `grouping.py` — pure, no I/O; testable in isolation.
- group-resolve endpoint — thin orchestration over `grouping` + existing M6 ingest.
- `SuggestedGroupCard` / spreadsheet queue — plain props / local state.
- No model or migration changes; backend edits are confined to `ocr/` plus a few
  `documents/` lines.

## Affected files (summary)

**Frontend**
- `web/app/(app)/capture/page.tsx` — batch_id mint, spreadsheet queue, grouped render
- `web/lib/offline/db.ts` — `batchId?` on `QueuedCapture`
- `web/lib/offline/sync.ts` — forward `batch_id`
- `web/lib/api/review.ts` — grouped response type + group-resolve mutation
- `web/components/capture/confirm-card.tsx` — reused; add `SuggestedGroupCard` (new file)
- `web/components/capture/csv-wizard.tsx` — `onDone` callback
- `shared/api-schema.ts` — regenerated

**Backend**
- `backend/app/ocr/grouping.py` — new: `group_review_documents`, `merge_extractions`
- `backend/app/ocr/router.py` — grouped review-queue response + group-resolve route
- `backend/app/ocr/schemas.py` — `batch_id` on `ReviewItemOut`; grouped/resolve schemas
- `backend/app/ocr/service.py` — group resolve orchestration
- `backend/app/documents/router.py` — `batch_id` form field
- `backend/app/documents/service.py` — persist `batch_id` in `ingest_meta`
- `backend/tests/` — grouping, merge, endpoint tests
