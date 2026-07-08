# Plaid Liabilities Visibility + Separate Credit-Cards Page

Date: 2026-06-22
Status: Approved design (pending spec review)

## Problem

1. **Plaid sandbox debt is not visible.** The M20 backend (`_sync_liabilities`) that
   upserts Plaid credit/student/mortgage liabilities into the `loan` table is built,
   running, and migrated — but zero Plaid loans exist. Root cause: the one linked
   sandbox item was created **before** `liabilities` was added to the link-token
   product list, so `liabilities_get` returns "additional consent required" and
   `get_liabilities` correctly returns `None`. The item must be re-linked.
2. **Credit-card statement data never reaches the frontend.** `LoanOut` omits
   `credit_card_detail`, so even a synced card has no limit / statement / available
   credit on the wire.
3. **No credit-cards surface exists.** Cards would otherwise land in the Debt page.
   The user wants them on their **own top-level page**, not in Debt.
4. **Console noise:** expired-session 401s (dead refresh token) and a recharts
   `M10,NaN` SVG path produced when a chart is fed undefined data from a failed load.

## Decisions (locked)

- **Data visibility path:** user re-links Plaid via the UI (Connections). No
  auto-seeding of the stored token.
- **Cards placement:** top-level navigation — a real `/cards` route, surfaced as a
  primary tab.
- **Totals:** credit-card balances **count toward** overall debt / net-worth math
  (they remain `loan` rows), but are **displayed only** on the Cards page.
- **Cards page emphasis:** lead with utilization + available credit, but show full
  detail — balance, credit limit, statement balance, minimum payment, due date,
  interest rate (APR), and any penalty warning.
- **NaN/console fix:** in scope.

## Scope

### 1. Backend — expose credit-card detail on `/loans`

- Extend `LoanOut` (`backend/app/loans/schemas.py`) with an optional nested
  `credit_card_detail` object:
  - `credit_limit: Decimal`
  - `statement_balance: Decimal | None`
  - `available_credit: Decimal | None`
  - `statement_day: int | None`
  - `utilization: float | None` — computed `outstanding_balance / credit_limit`,
    clamped to `[0, ...]`, `None` when limit is 0/absent.
- In `backend/app/loans/service.py`, load the `CreditCardDetail` for each loan
  (batch query keyed by `loan_id`, or per-loan in the existing `_loan_to_out`
  builder) and include the nested object only for `type == "credit_card"`.
- No new endpoint. `/loans` continues to return all loans; `type` discriminates.
- Existing aggregations that sum loans for net worth are unaffected — cards stay
  counted.

### 2. Frontend — `/cards` page + navigation

- New route `web/app/(app)/cards/page.tsx`.
- Nav (`web/lib/shell/nav.ts`):
  - Add `{ label: "Cards", href: "/cards" }` to `INSIGHTS_TABS` (peer of Debt).
  - Add `"/cards"` to the Insights bottom-tab `match` array so the tab lights on
    `/cards`.
- Frontend loan type (`web/lib/api/loans.ts` / shared schema): add the
  `credit_card_detail` shape so the typed client surfaces it.
- Cards page component:
  - Fetch `/loans`, filter `type === "credit_card"`.
  - Per card, render: card name, current balance, credit limit, **utilization bar**
    (color-graded), available credit, statement balance, minimum payment, due date
    (from `due_day`), interest rate (APR), and penalty warning when present.
  - Lead/summary row: total card balance, total limit, blended utilization.
  - Empty state: explanatory copy + CTA linking to `/connections` to link Plaid.

### 3. Debt page — exclude cards

- In the Debt overview data path (`web/components/debt/overview/debt-overview.tsx`
  and wherever loans are fetched for it), filter `type !== "credit_card"` for the
  debt list and payoff projection inputs.
- Net-worth / dashboard figures that sum every loan keep including cards (no change
  needed there) — this is what "count toward totals" means.
- The Debt page is installment-loans-only end to end: its own list, projection, **and
  its local headline subtotal** all exclude cards. "Overall debt" that includes cards
  lives in net-worth/dashboard surfaces, not on the Debt page. This avoids a confusing
  Debt total that doesn't match the loans listed below it.

### 4. Plaid re-link path (verification, not new build)

- The connect flow exists end-to-end: `POST /plaid/link-token` (now requests
  `transactions,liabilities`) → Plaid Link → `POST /plaid/exchange` →
  `POST /plaid/sync` (runs `_sync_liabilities`) → `DELETE /plaid/items/{id}`.
- Verify that after `exchange` the UI triggers a `sync` (auto or an obvious Sync
  button on Connections) so liabilities actually land. If exchange does not
  auto-sync and there is no working manual trigger, add a minimal post-exchange
  sync call.
- Proven against live sandbox: `user_good` / `ins_109508` with the liabilities
  product returns 1 credit card (bal 410 / limit 2000 / min 20), 1 student loan,
  1 mortgage.

### 5. Console robustness

- Add a guard in chart rendering so non-finite values never reach the SVG `d`
  attribute. Concretely: coerce non-finite numbers to `0` (or drop the point)
  before building recharts series / inline paths in the affected chart(s). This
  removes the `M10,NaN` error when data is briefly empty/undefined.
- The 401s are an expired session and self-resolve on re-login; no code change
  beyond confirming the existing refresh-then-clear behavior is correct. No new
  redirect logic in this scope.

## Out of scope (YAGNI)

- Per-card transaction history.
- Payment scheduling / amortization for revolving cards (already skipped by
  `regenerate_schedule`).
- Multi-currency card conversion beyond what `LoanOut` already provides.
- Auto-seeding the sandbox token (user chose the UI re-link path).
- A global session-expiry redirect/banner.

## Testing

- **Backend:** unit test that `LoanOut` includes `credit_card_detail` with computed
  `utilization` for a `credit_card` loan and omits it / leaves null for others.
  Reuse the `finance_test` DB pattern.
- **Backend:** existing `_sync_liabilities` path — assert a `credit` entry upserts a
  `type="credit_card"` loan + `CreditCardDetail` row (idempotent on re-sync).
- **Frontend:** vitest for the Cards page — renders cards from a mocked `/loans`,
  filters out non-card loans, shows utilization and detail fields, and shows the
  empty state with the Connections CTA when no cards.
- **Frontend:** vitest that the Debt overview filters out `credit_card` loans.
- **Manual:** re-link sandbox in Connections, confirm a card on `/cards`, student +
  mortgage on `/debt`, and no `M10,NaN` console error.

## Affected files

- `backend/app/loans/schemas.py` — `LoanOut` nested card detail.
- `backend/app/loans/service.py` — load + serialize `CreditCardDetail`, compute
  utilization.
- `web/lib/shell/nav.ts` — Cards tab + Insights match.
- `web/app/(app)/cards/page.tsx` — new page.
- `web/components/cards/*` — card components (new).
- `web/lib/api/loans.ts` / shared api schema — `credit_card_detail` type.
- `web/components/debt/overview/debt-overview.tsx` — exclude cards.
- Chart component(s) emitting the NaN path — finite-value guard.
