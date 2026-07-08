# M15 Frontend Rebuild — W1 Core Money Loop Implementation Plan

> **Status: AS-BUILT (retroactive).** W1 shipped ahead of this document (commit `77b82ff
> Frontend w1 phase`). This file reconstructs the plan from the delivered code so the
> `plans/` directory has one document per wave, matching the spec's "each wave is a
> separate implementation plan" rule. Checkboxes are marked done to reflect reality.

**Goal:** Build the core money loop on top of the W0 foundation — the four surfaces a user
touches every day: **Dashboard** (see the money), **Capture** (get documents in, offline-first),
**Review** (resolve low-confidence extractions), and **Transactions** (the ledger + line-item
drill-down with edit/split/merge/confirm/delete).

**Architecture:** Each surface is a route under the `(app)` group, consuming the typed
openapi-fetch client through small per-domain hook modules in `lib/api/*` (one `useQuery`/
`useMutation` per endpoint, all sharing the `unwrap()` helper). Capture is offline-first via a
Dexie queue (`lib/offline/*`) drained by a sync loop; everything else reads/writes live.
Surfaces use **inline English strings** (not i18n keys) per the English-only decision — the
next-intl machinery stays wired for nav/auth shell strings only.

**Tech Stack:** (inherited from W0) Next 15 App Router, React 19, TanStack Query 5,
openapi-fetch, Recharts 2, Dexie 4, shadcn/ui, Playwright.

---

## Environment notes (read first)

- Same as W0: app runs in the `web` container; run `typecheck`/`build` **inside the container**
  (`docker compose exec web ...`); run Playwright **on the host**; backend live at `:8000`.
- After adding a shadcn primitive, install runs on the host via the CLI but the component file
  lands in `components/ui/` and is committed.
- `lib/api.ts`, `lib/offlineQueue.ts`, `components/FinancePwaApp.tsx` are the old monolith —
  kept as reference, not imported by the new surfaces.

---

## File structure (created in W1)

```
web/
  app/(app)/
    dashboard/page.tsx              # KPIs + cash-flow chart + top merchants + range tabs
    capture/page.tsx                # camera/file upload + CSV wizard + offline queue UI
    review/page.tsx                 # low-confidence queue: confirm/discard + raw extraction
    transactions/page.tsx           # list/search/filter + row drill-down
  components/
    dashboard/cash-flow-chart.tsx   # Recharts grouped bar (income vs spend)
    capture/csv-wizard.tsx          # CSV column→field mapping wizard
    transactions/transaction-detail.tsx  # detail sheet: line items, edit/split/merge/confirm/delete
    ui/skeleton.tsx, table.tsx, sheet.tsx, dialog.tsx, badge.tsx,
    dropdown-menu.tsx, textarea.tsx, avatar.tsx   # shadcn primitives added for W1
  lib/
    api/analytics.ts                # useTimeseries / useSummary / useBreakdown
    api/review.ts                   # useReviewQueue / useResolveReview
    api/transactions.ts             # list/categories + patch/confirm/delete/split/merge
    offline/db.ts                   # Dexie schema (capture queue table)
    offline/sync.ts                 # multipart upload + drain loop, syncing→delete
    offline/use-capture-queue.ts    # liveQuery hook over the Dexie queue
    dates.ts                        # DateRange + presetRange (month-aligned windows)
    format.ts                       # formatCurrency / formatPercent / monthLabel
  e2e/w1.spec.ts                    # Playwright smoke across the four surfaces
```

---

## Task 1: Shared formatting + date helpers — DONE

**Files:** `lib/format.ts`, `lib/dates.ts`

- [x] `formatCurrency(value, {currency, compact, signed})`, `formatPercent`, `monthLabel`.
- [x] `DateRange`, `RANGE_PRESETS` (1m/3m/6m/12m), `presetRange()` returning **month-aligned**
  windows so the backend can serve straight from its monthly rollup.

---

## Task 2: Dashboard — DONE

**Files:** `app/(app)/dashboard/page.tsx`, `components/dashboard/cash-flow-chart.tsx`,
`lib/api/analytics.ts`

- [x] `lib/api/analytics.ts`: `useTimeseries` (metric `all` → spend/income/net),
  `useSummary`, `useBreakdown(dimension)`.
- [x] KPI cards: Net cash flow, Income, Spending, Savings rate — each with month-over-month
  delta and good/bad coloring (`text-success`/`text-destructive`, `invertDelta` for spend).
- [x] `CashFlowChart`: Recharts grouped bar, themed via `hsl(var(--*))` tokens.
- [x] Top-merchants list (breakdown by `merchant`, top 6, proportional bars).
- [x] Range tabs (1m/3m/6m/12m), loading skeleton, error card, empty state with CTA to Capture.

**Done when:** spend/income/net + cash-flow chart + top merchants render with working time filters.

---

## Task 3: Capture (offline-first) — DONE

**Files:** `app/(app)/capture/page.tsx`, `components/capture/csv-wizard.tsx`,
`lib/offline/db.ts`, `lib/offline/sync.ts`, `lib/offline/use-capture-queue.ts`

- [x] Dexie DB (`lib/offline/db.ts`) with a capture-queue table.
- [x] `sync.ts`: hand-built **multipart** `fetch` upload (openapi-fetch is awkward with `File`);
  items marked `syncing` then **deleted on success** → no duplicates.
- [x] `use-capture-queue.ts`: `liveQuery` hook so the UI reflects queue state reactively.
- [x] Page: camera/file upload, queue list with per-item status, manual + automatic drain.
- [x] CSV mapping wizard (`POST /documents/csv-mappings`): map columns → transaction fields.

**Done when:** a capture queues offline and syncs without loss or duplication; CSV mapping works.

---

## Task 4: Review queue — DONE

**Files:** `app/(app)/review/page.tsx`, `lib/api/review.ts`

- [x] `useReviewQueue` (`GET /review-queue`) + `useResolveReview`
  (`POST /review-queue/{document_id}/resolve`, action `confirm`/`reject`).
- [x] Page: list of low-confidence extractions, raw extraction view, confirm/discard actions,
  query invalidation on resolve.

**Done when:** low-confidence items can be confirmed or discarded with the raw extraction visible.

---

## Task 5: Transactions + line-item drill-down — DONE

**Files:** `app/(app)/transactions/page.tsx`, `components/transactions/transaction-detail.tsx`,
`lib/api/transactions.ts`

- [x] `lib/api/transactions.ts`: `useTransactions`, `useCategories`, and mutations
  `usePatchTransaction`, `useConfirmTransaction`, `useDeleteTransaction`, `useSplitTransaction`,
  `useMergeTransactions` — all invalidating the `["transactions"]` key on success.
- [x] List page: search + client-side filtering (server returns the full household set, no query
  params), category display.
- [x] Detail sheet: line items, edit fields, split into parts, merge multiple, confirm, delete.

**Done when:** list/search/filter works and a row drills into line items with edit/split/merge/
confirm/delete.

---

## Task 6: Nav-shell 404 fix (placeholders for W2–W4) — DONE

**Files:** `components/coming-soon.tsx`, the W2–W4 pages under `(app)`

- [x] Unbuilt surfaces ship a `ComingSoon` placeholder **inside** the `(app)` group, so dead
  links no longer hit Next's root 404 (which renders outside the layout and dropped the sidebar
  until a full reload).

---

## Task 7: Playwright smoke + close-out — DONE

**Files:** `e2e/w1.spec.ts`, `web/REBUILD_PROGRESS.md`

- [x] `e2e/w1.spec.ts`: smoke across the four surfaces.
- [x] `REBUILD_PROGRESS.md` updated: W1 row marked done, surface statuses set, W1 notes +
  working test creds (`dev@example.com` / `hunter2pass`) recorded.

---

## W1 Done When (met)

- `tsc --noEmit` clean and `next build` succeeds in the container.
- Dashboard shows spend/income/net + cash-flow chart + top merchants with working time filters.
- A receipt captured offline syncs without loss/duplication.
- Review queue resolves low-confidence items; Transactions list drills into line items with
  edit/split/merge/confirm/delete.
- Nav never 404s — W2–W4 surfaces show `ComingSoon` inside the shell.
- `REBUILD_PROGRESS.md` reflects W1 complete.
