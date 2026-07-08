# Plaid Deep Integration + Spend UX — Design

Date: 2026-07-02
Status: Approved (user, 2026-07-02)
Build order: C (UI fast wins) → A (Plaid depth) → B (Gmail events)

## Problem

Plaid connect works, but integration is shallow:

- Loan/credit-card payments arrive as ordinary transactions; nothing lands on the
  `loan_payment` ledger, and payments inflate spend analytics.
- Refunds are stored as raw negative amounts with no flag or link to the purchase.
- Plaid Link shows every account type (IRA, 401k, HSA, CD…); unsupported ones are
  silently imported as `checking` (`_account_type` fallback).
- `plaid_sync` never writes `AccountBalance` snapshots, so net worth is frozen at
  seeded values and looks hardcoded.
- Gmail sync ingests attachments only; email bodies (bank alerts, receipts) are inert.
- UI: "Payment due" events hide inside the history activity feed; merchants and
  categories are two separate views; drill callouts have a left-accent highlight the
  user dislikes.
- Sandbox appears to "give few transactions" (default `user_good` static set).

## A. Plaid depth (backend)

All in `backend/app/ingestion/` + `backend/app/transactions/` + `backend/app/loans/`.

### A1. Link account filters

`PlaidGateway.create_link_token` sends `account_filters`:

- depository: checking, savings
- credit: credit card
- loan: student, mortgage

Unsupported types never appear in the Link picker. `_account_type` fallback changes
from `"checking"` to `"other"` so anything that slips through is visible, not
miscounted as cash.

### A2. Balance snapshots

Each `plaid_sync` run fetches current balances (accounts/get) and writes one
`AccountBalance` row per mapped account (`as_of = today`, upsert per day). Net worth
(`analytics.net_worth`, snapshot-based) becomes live.

### A3. Loan/CC payment detection — auto-register, undoable

Detector pass after txn ingestion per sync:

1. **Pair match (high confidence):** credit/loan-account credit (payment received)
   + depository debit, same amount, ±3 days → both txns marked as transfer legs
   (`flags.transfer = true`, `flags.payment_pair_id`), payment auto-registered on the
   matching loan's `loan_payment` ledger.
2. **Single-leg match:** depository debit with Plaid
   `personal_finance_category = LOAN_PAYMENTS` (or merchant matching a connected
   loan's institution/label) → payment registered against that loan.

Registered payments carry provenance (`source: plaid`, plaid `transaction_id`).
Undo = delete the ledger payment via existing loan UI; the transaction remains but
loses its payment link. Transfer/payment legs are excluded from spend analytics.
Loans synced from Plaid liabilities are matched via existing `plaid_account_id`.
Detection is idempotent across re-syncs (keyed on plaid transaction_id).

### A4. Refund detection

Merchant-side credits (negative amount, not a payment leg):

- flagged `flags.refund = true`
- matched to original purchase: same merchant, opposite amount, ≤90 days; linked
  both ways (`flags.refund_of` / `flags.refunded_by`)
- spend analytics net refunds against their category/merchant

Unmatched credits stay flagged refund, netted in analytics, no link.

### A5. Plaid category seed

`_to_create` passes Plaid `personal_finance_category` through; categorization adds a
final fallback layer (after rules → merchant default → name similarity) mapping
Plaid PFC primary/detailed to the household category tree. User edits still win and
still write rules.

### A6. Sandbox data volume

No code. Document (`.env.example`, connections page hint): log into Plaid Link
sandbox with `user_transactions_dynamic` / `pass_good` for continuously generated
realistic transactions. Default `user_good` returns a small static set — expected
Plaid behavior, not a bug.

## B. Gmail transaction events

- Gmail query widens to bank/card alert senders **and** merchant receipt emails
  (sender/subject heuristics).
- Email bodies are LLM-parsed into draft transactions, same pattern as the SMS
  parser (`_parse_sms`): confidence < 0.75 → `needs_review`.
- Dedup: Gmail message id as transaction `external_id` (channel `email`).
- Attachments keep the existing OCR pipeline.
- Everything lands in the existing ingestion review queue — same confirmation gate
  as other sources.

## C. UI

### C1. Highlight removal

Remove `border-l-4 border-l-accent` from the "What changed" callouts in
`web/components/spend/category-drill.tsx:129` and
`web/components/spend/merchant-drill.tsx:97`; sweep repo for any other left-accent
highlight and remove.

### C2. Unified spend view (categories primary, merchants nested)

On `/transactions`:

- Categories are the single top-level breakdown.
- Merchants appear inside each category drill (top merchants for that category) and
  as one global "Top merchants" card on the main spend view.
- `view=merchants` toggle removed; old `?view=merchants` deep links redirect to the
  spend view (global merchants card anchors the content).
- Existing slide-in drill behavior unchanged.

### C3. Payment due placement

- Notifications page: "Upcoming payments" strip pinned at top; `loan_due` and
  penalty-risk events render there, removed from the historical feed below.
- Debt page loan cards surface next due date.

## Error handling

- Detector and refund matching run inside the sync transaction per item; a matching
  failure logs and skips (never fails the sync).
- Balance fetch failure: sync proceeds, balances skipped, reported in sync summary.
- Gmail parse failures: message becomes a document without a transaction (current
  behavior), never aborts the batch.

## Testing

- pytest: fake `PlaidGateway` payloads covering pair match, single-leg match,
  idempotent re-sync, refund link, unmatched refund, balance snapshot write, account
  filter request shape.
- pytest: Gmail body → draft txn, dedup on message id, low-confidence gate.
- vitest: spend view (categories primary, merchants card, drill nesting, redirect),
  notifications upcoming strip, highlight removal regression not needed.

## Out of scope

- Investment/HSA account support (filtered out at Link).
- Plaid webhooks (sync stays pull-based).
- Real (non-sandbox) Plaid environment rollout.

## Hygiene

Branch `feat/security-plaid-hardening` carries uncommitted security work — commit
that first; this work goes on a fresh branch (e.g. `feat/plaid-deep-integration`).
