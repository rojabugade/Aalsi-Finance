# Ingestion confirmation gate + provenance — design

**Date:** 2026-06-22
**Branch:** feat/universal-add-connections
**Status:** Approved (design), pending implementation plan

## Problem

Connection/upload modules are wired but their data is largely useless because
nothing reliably ingests it, and the user can't see what happened to anything
they added. Concretely:

| Channel | Today | Lands as transaction? |
|---|---|---|
| Receipt / PDF / CSV (`/capture`) | store → OCR → handoff → **draft txn** silently on high confidence; low-confidence → review queue | yes, but **silently, no user confirmation** |
| Plaid | `plaid_sync` → real txns | yes |
| SMS | webhook → draft txn | yes |
| **Splitwise** | `splitwise_sync` writes balances into a `Document.ocr_meta`; **0 transactions, no surface** | **no — dead end** |
| **Email / Gmail** | `email_sync` creates `Document`s but **never stores attachment bytes or enqueues OCR** | **no — dead end** |

Three user-stated requirements drive this work:

1. Auto-detected uploads must get a **"did we read this right?" confirmation**
   before they count — not silently committed.
2. Splitwise and Email data must actually go somewhere usable.
3. There must be a **history of uploads** showing **where the ingested data went**
   (provenance: this file → became this transaction).

## Decisions (locked with user)

- **Confirmation gate scope:** auto-detected uploads only (receipt / invoice /
  statement / CSV / paystub). Plaid and SMS stay auto.
- **Splitwise:** read-only balances surface ("you owe X / you're owed Y" per
  friend). No transactions.
- **Pass scope:** all three pillars (gate, Email fix, Splitwise) in this pass.
- **History view location:** a "Recent activity" section on `/capture`.
- **Reject behaviour:** mark the document `failed`, keep it in history. Nothing
  silently vanishes; the original file is retained.

## Goals

- Every auto-detected upload is held for explicit user confirmation before any
  transaction is created.
- The user can see every ingested item across all channels, its detected type,
  its status, and the transaction(s) it produced.
- Email attachments become first-class uploads that ride the confirmation gate.
- Splitwise balances are visible on the Connections page.

## Non-goals

- Changing Plaid or SMS ingestion (they stay auto).
- Importing Splitwise expenses as transactions (balances only this pass).
- Auto-extracting body-only emails (no attachment) — stored and shown in history
  as `other`, not force-extracted. Deliberate boundary.
- Any change to the OCR/LLM extraction quality itself.

## The spine: always-confirm for auto-detected docs

The OCR pipeline currently auto-creates a draft transaction when confidence is
high and only routes low-confidence docs to `needs_review`. Change:

- `app/ocr/service.py::process_document` — drop the
  "if not result.needs_review: handoff to M6" branch. **All** successfully
  extracted auto-detected docs end at status `needs_review`. No transaction is
  created in the pipeline.
- Confidence stops being an auto-commit switch. It is written into `ocr_meta`
  (already is) and surfaced purely as a UI signal.
- `app/ocr/service.py::resolve_review` already creates transactions via
  `_handoff_to_m6` on `confirm`. That remains the **only** path that creates a
  transaction from an upload. `reject` sets status `failed` (already does) and
  the document stays listable.

Net effect: a single funnel — upload (any auto-detected channel) → `needs_review`
→ user confirms → transaction(s). High-confidence items are pre-filled for a
one-click confirm; low-confidence items are flagged with `reasons`.

Plaid/SMS create transactions in their own service functions and never touch
`process_document`, so they are unaffected.

## Pillar 1 — Confirmation UI

Enhance the existing `/review` page and the inline review block in
`app/(app)/capture/page.tsx`. Each pending item renders:

- Detected **type** (Receipt, Statement, …).
- Extracted **fields**, editable: for receipts — merchant, date, currency, total,
  line items; for statements/CSV — account hint + row count (and a peek at rows).
- Confidence badge: green ("looks right") ≥ threshold, amber ("check this")
  below, with `reasons` shown when present.
- Actions: **Confirm** (commit), **Fix** (edit fields, then confirm), **Reject**
  (status → failed, retained in history).

The resolve API already accepts a corrected `data` payload
(`ResolveIn.data`), so field edits flow through unchanged. UI work only; no new
resolve endpoint.

## Pillar 2 — Upload history + provenance

A "Recent activity" section on `/capture` listing **every** ingested document
across channels (`upload`, `email`, `plaid`, `sms`, `splitwise`), each row:

- Source + label/filename, detected type, status
  (Pending confirm / Confirmed / Failed / Processing).
- Provenance: **"→ became $42.10 at Trader Joe's"** linking to the resulting
  transaction; "—" when nothing was created (e.g. rejected, or pending).

Backend:

- `GET /documents` already lists household-scoped documents. Extend `DocumentOut`
  (or add `GET /documents/{id}/transactions`) to include the linked
  transaction(s). Link is `Transaction.source_document_id == Document.id`.
- Decision: **extend `DocumentOut`** with a light `transactions: [{id, merchant,
  amount, currency, status}]` array so the history list is one call. Keep it a
  summary, not full transactions.

Frontend:

- New hook `useDocuments()` in `lib/api` over `GET /documents`.
- Render the activity list; clicking a provenance link routes to
  `/transactions` filtered/anchored to that transaction.

## Pillar 3 — Email actually ingests

`app/ingestion/service.py::email_sync` / `create_email_document`:

- For each message **attachment**, route the bytes through the real upload path
  (the same `documents.service.create_document` used by `/documents`): decode the
  base64url payload → `detect_kind` → encrypted object store → row at status
  `uploaded` with `source_channel="email"` → `enqueue_ocr`. The attachment then
  rides the confirmation gate exactly like a manual upload.
- Body-only messages (no attachment): keep current behaviour — store a `Document`
  with the body preview in `ocr_meta`, `source_channel="email"`, type `other`,
  status `uploaded`. It appears in history but is not force-extracted.
- `email_sync` returns `{documents_created, attachments_ingested}`.

## Pillar 4 — Splitwise balances surface

- Storage: persist the latest synced balances. Reuse the existing splitwise
  `Document.ocr_meta["splitwise"]["events"]` (most recent splitwise document) as
  the source of truth — no schema change.
- Endpoint: `GET /ingestion/splitwise/balances` → returns the latest synced
  balances `[{friend, amount, currency}]` plus `synced_at`. 404/empty when no
  active connection.
- Frontend: a read-only card on `/connections` showing per-friend "you owe X /
  you're owed Y" and a net line. A "Sync now" action calls the existing
  `splitwise_sync` then refetches. No transactions.

## Data flow (after change)

```
Upload / Email-attachment ─┐
                           ├─→ Document(uploaded) ─→ OCR pipeline ─→ Document(needs_review)
CSV / PDF / photo ─────────┘                                              │
                                                              user confirms│ (Pillar 1 UI)
                                                                           ▼
                                                          ingest_extraction → Transaction(draft)
                                                                           │
                                              Document(processed) ◀─────────┘
                                              (provenance: txn.source_document_id)

Plaid sync ───→ Transaction (unchanged, auto)
SMS webhook ──→ Transaction (unchanged, auto)
Splitwise sync → Document(splitwise) → balances surface (read-only, no txn)
```

## Error handling

- OCR extraction failure → `Document.status = "failed"`, error in `ocr_meta`,
  shown in history as Failed. (Already implemented.)
- Confirm with no usable amount (e.g. receipt missing total) → handoff returns
  `None`; surface a toast "couldn't create a transaction — add an amount" and
  keep the item pending. Confirm UI requires a total before allowing Confirm for
  receipts.
- Email attachment of an unsupported type → skip that attachment, continue the
  sync, count it as skipped; do not fail the whole sync.
- Splitwise/Plaid gateway `IntegrationUnavailable` → surfaced as a clear card
  error, never a 500 to the user.

## Testing

Backend (pytest, run in api container per project convention):

- `process_document` routes high-confidence auto-detected docs to `needs_review`
  and creates **no** transaction.
- `resolve_review(confirm)` creates the expected transaction(s); `reject` →
  `failed`, no transaction.
- `DocumentOut` includes linked transaction summaries; rejected/pending docs show
  none.
- `email_sync` ingests an attachment as a real document (bytes stored, OCR
  enqueued) and skips unsupported attachments without failing.
- `GET /ingestion/splitwise/balances` returns latest synced balances; empty when
  no connection.

Frontend (vitest):

- Confirm card renders detected type + editable fields; Confirm/Fix/Reject call
  the resolve mutation with the right payload.
- History list renders provenance link when a transaction exists and "—"
  otherwise.
- Splitwise card renders balances and net.

## Files touched (anticipated)

Backend: `app/ocr/service.py`, `app/ingestion/service.py`,
`app/ingestion/router.py`, `app/documents/schemas.py`, `app/documents/service.py`
(transaction-link query), `app/documents/router.py`.

Frontend: `app/(app)/capture/page.tsx`, `app/(app)/review/page.tsx`,
`app/(app)/connections/page.tsx`, `lib/api/review.ts`, `lib/api/connections.ts`,
new `lib/api/documents.ts`.
