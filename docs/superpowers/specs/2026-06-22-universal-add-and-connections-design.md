# Universal Add + Connections (Plaid Link + Splitwise) — Design

**Date:** 2026-06-22
**Status:** Approved (design)
**Branch base:** `feat/debt-redesign-phase0` (new work branches off `main`)

## Problem

Two areas are half-built:

1. **Adding things is broken or scattered.** The top-bar `+Add` dropdown routes to
   `/capture?mode=receipt|csv|manual`, but the capture page **ignores `?mode=`** (always
   shows the Scan tab) and has **no manual-entry surface at all**, so "Add manually" is a
   dead link. `POST /transactions` exists on the backend but no frontend hook calls it.
   Several create hooks (`useCreateHolding`, `useCreatePaymentMethod`,
   `useCreateRecurringSeries`) exist with **zero UI consumers**. The capture page is split
   into Scan/Upload vs. CSV tabs and forces the user to pick a document type up front.

2. **Connections is partial.** Gmail and SMS are fully wired front-to-back. Plaid's backend
   is real (`link-token` / `exchange` / `sync` / `delete`) but the frontend only requests a
   link token then says "coming in a later pass" — there is no real `react-plaid-link` flow
   and **no endpoint to list connected items**, so connected state can't be shown. There is
   no Splitwise integration at all.

## Goal

A **single universal Add experience** that ingests anything (receipts, PDFs, CSV, XLSX, loan
docs, bank statements, paystubs, brokerage statements) with auto-detection taking priority
over manual selection, plus a manual-entry fallback — reachable from the sidebar. And a
**fully functional Connections module**: real Plaid Link, plus a new Splitwise connection
that pulls "who owes whom" events.

Out of scope (future work): creating Splitwise expenses *from* this app (read-only this
pass); the chat-bot connection (stays "on hold — M12").

---

## Part 1 — Universal Add page (`/capture` rebuilt)

### Behavior

- **One ingest surface, no tabs.** Replace the Scan/CSV `SegmentedPills` split with a single
  column.
- **Page-wide drag-and-drop.** Dropping a file *anywhere* on the page picks it up (a window
  `dragover`/`drop` listener with a full-page highlight overlay while dragging). An explicit
  **Upload** button (multi-file) remains as the conventional path.
- **Accepted kinds:** image (`jpg/png/heic/heif`), PDF, CSV, **XLSX** (Part 2).
- **Auto-detect first.** Files upload **without a forced doc-type**; the OCR/extraction
  pipeline classifies them (receipt vs. paystub vs. statement, etc.). A manual type override
  is *secondary* — a small per-file/collapsed control, never required. (Backend
  `POST /documents` already accepts an optional `doc_type`; we simply stop requiring it.)
- **Routing by kind** (client detects from MIME/extension):
  - image / PDF → existing offline queue → `POST /documents` (`uploadDocument` in
    `lib/offline/sync.ts`).
  - CSV / XLSX → the column-mapping wizard (`CsvWizard`, generalized to spreadsheets).
- **Inline queues on the same page:**
  - **Upload queue** (existing `useCaptureQueue` — pending/syncing/failed with retry/remove).
  - **Review queue** (existing `useReviewQueue` / `useResolveReview`) so low-confidence
    extractions are confirmed in place rather than only on `/review`.
- **Manual-entry option.** A "No document? Enter manually" affordance opens a transaction
  form (Dialog/Sheet, matching the income/budget/loan pattern) wired to a **new**
  `useCreateTransaction` hook calling `POST /transactions`. Fields: merchant, amount,
  currency, date, category (`useCategories`), payment method (`usePaymentMethods`), notes.
  `source_channel: "manual"`, `status: "draft"`. On success: invalidate `["transactions"]`,
  toast, close.

### Navigation (placement matters)

- **Top-bar `+Add`** becomes a **single action** linking to `/capture` (remove the
  `DropdownMenu`; keep the styled button). Delete `ADD_ACTIONS` and the `AddMenu` dropdown
  body; `add-menu.tsx` becomes a plain link button (or fold into `top-bar.tsx`).
- **Sidebar entry.** Add an **"Add"** item so `/capture` appears in the desktop rail and
  mobile drawer. The desktop rail renders `BOTTOM_TABS` then `DRAWER_ITEMS`; the drawer
  renders `DRAWER_ITEMS`. Add a dedicated nav entry (new exported constant, e.g.
  `PRIMARY_ADD` rendered at the top of the rail nav and the top of the drawer) with a
  `Plus`/`Camera` icon → `/capture`. Keep `/capture` titled "Capture" / "Add" in `TITLES`.
  Update `isSecondarySurface` handling so the back-arrow/title behavior stays correct.
- **FAB** already links to `/capture` — unchanged.

### Files touched (Part 1)

- `web/app/(app)/capture/page.tsx` — full rebuild (single surface, dropzone, manual entry,
  embedded review queue).
- `web/components/capture/csv-wizard.tsx` — accept XLSX input (parse client-side or hand the
  file to the same upload+mapping path).
- `web/lib/api/transactions.ts` — add `useCreateTransaction`.
- `web/lib/shell/nav.ts` — remove `ADD_ACTIONS`; add the primary "Add" nav entry; keep
  `/capture` title.
- `web/components/shell/add-menu.tsx`, `top-bar.tsx`, `desktop-rail.tsx`, `drawer.tsx` —
  wire the single Add action + sidebar entry.

### Tests (Part 1)

- vitest: `useCreateTransaction` posts the right body and invalidates; capture page renders
  the single surface, accepts a dropped file, routes CSV→wizard vs image→queue; manual form
  validates required fields; nav exposes `/capture` in rail + drawer.

---

## Part 2 — XLSX ingestion (backend)

- Extend `backend/app/documents/processing.py` `detect_kind` to recognize XLSX
  (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, magic bytes `PK\x03\x04`
  + `.xlsx` ext) returning a `"csv"`-compatible kind (or new `"spreadsheet"` branch that
  normalizes to rows).
- Parse the first worksheet with `openpyxl` into rows, feeding the existing CSV column-mapping
  flow (`save_csv_mapping` / `load_csv_mapping`). Add `openpyxl` to backend deps.
- Update `CSV_TYPES`/`CSV_EXTS` (or add `XLSX_TYPES`/`XLSX_EXTS`) and the upload validation.
- Regenerate `shared/openapi.json` + `shared/api-schema.ts` if any schema changes.

### Tests (Part 2)

- pytest: `detect_kind` classifies a real `.xlsx`; an xlsx upload parses to the same row
  shape as the equivalent CSV; unsupported files still raise `UnsupportedFile`.

---

## Part 3 — Connections: real Plaid Link

- Install **`react-plaid-link`** (web dep).
- Rewrite `PlaidCard` in `web/app/(app)/connections/page.tsx`:
  - `usePlaidLinkToken` → pass token to `usePlaidLink({ token, onSuccess })`.
  - `onSuccess(public_token, metadata)` → **new** `useExchangePlaidToken`
    (`POST /plaid/exchange`, body `{ public_token, institution_name, accounts }`).
  - After exchange → **new** `useSyncPlaid` (`POST /plaid/sync`, optional `plaid_item_id`).
  - Toasts + query invalidation at each step (`["transactions"]`, `["plaid-items"]`).
- **New backend endpoint** `GET /plaid/items` (list connected items: id, institution name,
  account count, last sync). Add to `backend/app/ingestion/router.py` + service + schema;
  regenerate types. New `usePlaidItems` hook renders connected institutions with per-item
  **Sync** and **Disconnect** (`DELETE /plaid/items/{item_id}`).
- **Env:** add sandbox `PLAID_CLIENT_ID` / `PLAID_SECRET` (config keys already exist:
  `plaid_client_id`, `plaid_secret`, `plaid_environment=sandbox`). Ensure `plaid-python` is
  installed in the API image.

### Tests (Part 3)

- vitest: exchange + sync hooks post correct bodies and invalidate; `PlaidCard` shows
  connected items from `usePlaidItems`; disconnect calls the delete endpoint.
- pytest: `GET /plaid/items` returns the household's items, scoped (no cross-household leak).
- Manual: full sandbox Link → exchange → sync verified end-to-end.

---

## Part 4 — Connections: Splitwise (new, read-only)

Mirror the Gmail OAuth pattern.

- **Backend** (`backend/app/ingestion/`):
  - `SplitwiseGateway` (OAuth2): `authorization_url()`, `exchange_code(code)`,
    `get_current_user()`, `get_expenses(updated_after)`, `get_friends()` — raising
    `IntegrationUnavailable` when `SPLITWISE_CONSUMER_KEY/SECRET` are unset (same shape as
    `GmailGateway`/`PlaidGateway`).
  - Endpoints: `POST /splitwise/oauth/start`, `GET /splitwise/oauth/callback`,
    `POST /splitwise/sync`, `DELETE /splitwise/connection`.
  - `sync` pulls recent expenses + per-friend balances and produces **"who owes whom"**
    events — surfaced as notifications and/or stored records ("You owe Alice $24",
    "Bob owes you $10"). Store the Splitwise connection token like the email connection.
  - Config: `splitwise_consumer_key`, `splitwise_secret`,
    `splitwise_redirect_uri` (default `http://localhost:8000/splitwise/oauth/callback`).
  - Regenerate `shared/openapi.json` + `shared/api-schema.ts`.
- **Frontend:**
  - `web/lib/api/connections.ts`: `useSplitwiseOAuthStart`, `useSplitwiseSync`,
    `useDisconnectSplitwise`.
  - `SplitwiseCard` in `connections/page.tsx`, same shape as `EmailCard`
    (Connect → opens consent in a new tab; Sync now; Disconnect). Show last-sync summary of
    balances when available.
- **Env:** `SPLITWISE_CONSUMER_KEY` / `SPLITWISE_SECRET` (sandbox/live) in the API env.

### Tests (Part 4)

- pytest: gateway raises `IntegrationUnavailable` without creds; sync maps expenses/balances
  to events; endpoints are role-guarded and household-scoped.
- vitest: Splitwise hooks + card render and call the right endpoints.
- Manual: live connect + sync against a real Splitwise account.

---

## Architecture notes

- **Auto-detect priority** is achieved by *not sending* a `doc_type` on upload (let the
  pipeline classify); the manual override is a thin, optional control. No new classifier is
  built here.
- **Gateways stay uniform:** Plaid/Gmail/SMS/Splitwise all follow the
  `IntegrationUnavailable`-when-unconfigured pattern, so the UI degrades gracefully without
  credentials.
- **Household scoping:** every new endpoint uses `require_role(...)` + `scoped_query`/
  household filtering, matching existing ingestion routes.

## Implementation phasing (single spec, phased plan)

1. **Universal Add page + nav + manual transaction** (Part 1) — highest user value, no new
   external creds.
2. **XLSX ingestion** (Part 2) — unlocks spreadsheet uploads on the new page.
3. **Plaid Link** (Part 3).
4. **Splitwise** (Part 4).

## Success criteria

- `+Add` and the sidebar both open one `/capture` page; dropping a file anywhere on the page
  ingests it; multiple files upload at once; CSV/XLSX route to the mapping wizard; review
  queue is resolvable in place; manual transaction entry creates a draft transaction.
- Connections: a Plaid sandbox bank connects via Link, exchanges, and syncs transactions;
  connected institutions list with Sync/Disconnect. Splitwise connects via OAuth and a sync
  surfaces current balances/owed events.
- Existing vitest suite (245) stays green; new vitest + pytest cover the added hooks,
  endpoints, and parsing.
