# Capture ("Add anything") Page — Comprehensive Redesign

**Date:** 2026-06-28
**Branch:** feat/analyst-memory-awareness (capture work)
**Status:** Approved design

## Problem

The current `/capture` page feels vague: a single drop zone, no way to declare
what kind of document is being uploaded, no guidance on how to upload receipts
that span multiple images, a thin "what went where" list, and review/recent
sections that disappear when empty and only update on poll. We want a more
comprehensive, guided, and live-feeling page.

## Goals

- Clear upload section with a **document-type picker** (Auto-detect is default).
- **Guidance** that promotes uploading one transaction-event at a time, while
  explaining that several images of the *same* receipt belong in one drop and
  several *different* purchases can also share a drop (the app auto-groups).
- An **info section** telling users what they can upload.
- **Review** and **Recent activity** that feel spontaneous: optimistic + live,
  motion/transitions, inline quick actions, and always-visible with friendly
  empty states.
- Extras: per-file upload progress, a "these are one receipt" toggle, recent
  filter/search, and a summary stat strip.

## Non-goals (YAGNI)

- New backend document-type auto-detection logic.
- Camera-specific capture UI.
- Connections (Plaid/Splitwise) shortcuts on this page.
- Bulk "confirm all".

## Layout

Two-column on desktop, collapsing to a single column on mobile.

**Header row:** title "Add anything" + online/offline badge + **summary stat
strip** — `N waiting to confirm · M added this week · K failed`. Clicking the
"waiting" stat scrolls to the Confirm section.

**Left rail — the "do" side:**

1. **Type selector** — segmented control with options:
   `Auto-detect` (default) · Receipt · Invoice · Statement · Paystub ·
   Spreadsheet · Other. Applies **per-batch** (governs the next drop/pick).
   - Auto-detect sends no `type` (server detects).
   - An explicit type is sent as `docType` for document-pipeline files.
   - CSV/XLSX **always** route to the mapping wizard regardless of this picker
     (classification stays client-side via `classifyFile`).
2. **Drop zone + Upload button + Manual entry** — retains page-wide drag/drop.
3. **"These are one receipt" toggle** — off by default. When on, the next drop is
   forced into a single merged receipt (`group_hint=single`). Helper text: for a
   single receipt split across several photos/pages.
4. **Tip callout** (the guidance):
   > Uploading one receipt split across several images? Drop them together and
   > we'll merge them into one transaction. Uploading different purchases? Those
   > can go in the same drop too — we keep them separate. For best results, add
   > one transaction-event at a time so nothing gets mixed up.
5. **Info section — "What you can upload":** small icon + one-liner rows for
   receipts (photo/PDF), bank & card statements, paystubs, invoices, CSV/XLSX
   exports. Includes the privacy line (read on-device with local OCR; files
   aren't sent to any AI service).

**Right column — the "watch" side (always visible, friendly empty states):**

6. **In-progress / upload** — per-file progress: each file shows
   `queued → uploading → reading… → done/failed`, with retry/remove. Upgrades
   today's offline UploadQueue; pre-server states live here, while the server
   "Reading…" state continues to show in Recent.
7. **Confirm to add** (review) — group cards + item cards. **Optimistic + live**
   (polls while pending), **motion** (cards animate in; confirm/reject animates
   the card out), **inline actions** (existing edit/confirm/reject/split).
8. **Recent activity** — **filter** (All / Pending / Confirmed / Failed) +
   **search** (filename/merchant), live updates, motion on new rows.

## Components

Under `web/components/capture/` (new unless noted):

- `type-selector.tsx` — the document-type segmented control.
- `upload-panel.tsx` — drop zone + Upload button + manual entry + type selector
  + one-receipt toggle (left-rail top).
- `upload-info.tsx` — "What you can upload" + privacy note.
- `capture-stats.tsx` — summary stat strip.
- `activity-list.tsx` — Recent activity with filter/search + motion (refactor of
  today's `RecentActivity`).
- `review-list.tsx` — motion + empty-state wrapper around existing `ConfirmCard`
  and `SuggestedGroupCard`.
- `upload-progress.tsx` — per-file progress (upgraded `UploadQueue`).
- `page.tsx` — rewritten as a thin orchestrator holding `docType` + `oneReceipt`
  state and the two-column shell.

**Motion:** use the animation library already in the app if present; otherwise
CSS transitions (verified at plan time). Respect `prefers-reduced-motion` for
fades but **not** for core layout motion (per prior project note that
reduce-motion should not kill the slide/layout motion).

## Backend / plumbing slice (for the one-receipt toggle)

Today a multi-file drop already shares one `batch_id`, and
`group_review_documents` auto-clusters receipt/invoice docs by canonical
merchant + non-conflicting total. The toggle needs a real signal so it can force
a merge even when OCR misreads a page:

- `backend/app/documents/router.py`: accept `group_hint: "auto" | "single"` form
  field → pass to `create_document`.
- `backend/app/documents/service.py`: persist as
  `ocr_meta["ingest"]["group_hint"]`.
- `backend/app/ocr/grouping.py`: when a batch's docs carry
  `group_hint == "single"`, force them into one cluster (bypass the
  `_compatible` clique check) and merge via `merge_extractions`.
- `web/lib/offline/sync.ts` + `web/lib/offline/db.ts`: thread `groupHint` through
  `enqueueCapture` / `uploadDocument` / `QueuedCapture` → multipart field.

## Data flow

- `page.tsx` holds `docType` (default `"auto"`) and `oneReceipt` (default
  `false`). `ingest(files)` assigns one `batchId` per drop, routes spreadsheets
  to the wizard, and enqueues document-pipeline files with `docType` (when not
  auto) and `groupHint` (`"single"` when toggle on).
- After flush, invalidate `documents` + `review-queue` queries; polling hooks
  keep them live until processing settles.
- Stats derive from the documents + review queue already fetched.

## Error handling

- Upload failures surface per-file in the in-progress list with retry; offline
  drops queue and sync when reconnected (unchanged behavior).
- Review confirm/reject failures keep the card and toast an error (unchanged).
- Forced single-group with no groupable docs falls back to loose items (no
  crash).

## Testing

**vitest (web):**
- Type selector defaults to Auto-detect; changing it sends `docType`.
- One-receipt toggle wires `group_hint=single` through ingest.
- Activity filter + search narrow the list correctly.
- Stat strip computes waiting/added/failed counts.
- Review and Recent render friendly empty states (not hidden).

**pytest (backend):**
- `group_review_documents` forces a single group under `group_hint=single`,
  even with conflicting merchant/total.
- Router persists `group_hint` into `ocr_meta["ingest"]`.

## Open questions

None blocking. Animation library presence confirmed at plan time.
