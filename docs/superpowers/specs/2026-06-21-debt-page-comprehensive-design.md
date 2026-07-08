# Debt Page — Comprehensive Rebuild

**Date:** 2026-06-21
**Status:** Approved (design)

## Goal

Make the debt page a comprehensive loan-management surface:

1. Main page shows rich, at-a-glance info per loan (outstanding balance, progress, next due, APR, EMI) instead of a flat name/principal list.
2. Clicking a loan opens detail with a **payment history** section — collapsed by default, paginated when large.
3. Loans become **editable** (and deletable) from the UI.
4. Real payments can be **logged**; each logged payment triggers a **full recompute** of the loan's remaining amortization schedule.

## Decisions locked during brainstorming

- **History = real payment logging**, not just the projected schedule. Requires backend (new ledger + endpoints).
- **Payment effect = full recompute**: each recorded payment re-derives the outstanding balance and re-projects the remaining schedule forward.
- **Interest accrual = monthly periods**, consistent with the existing `_project()` engine (not day-by-day). Flagged as a possible future refinement.
- **Credit-card-specific fields** (`CreditCardDetail`: limit/statement balance) are **out of scope** for this pass.
- **History page size = 12 rows.**

## Backend

### New model `loan_payment`

`backend/app/models/debt.py`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `loan_id` | uuid fk → `loan.id` ON DELETE CASCADE, indexed | |
| `payment_date` | date, not null | |
| `amount` | money, not null | actual amount paid |
| `interest_component` | money | computed at write, stored for display |
| `principal_component` | money | computed at write |
| `balance_after` | money | running balance after this payment |
| `note` | string, nullable | optional |
| `created_at` | timestamp | for stable ordering of same-day payments |

Migration added under the existing Alembic migrations dir.

### Recompute logic

`regenerate_schedule()` in `app/loans/service.py` becomes payment-aware:

1. Load the loan's `loan_payment` rows ordered by `(payment_date, created_at)`.
2. Walk them, maintaining a running `balance` starting at `loan.principal`:
   - Accrue interest for the elapsed monthly period(s) since the previous event using `_monthly_rate(loan)`.
   - Split `amount` into interest-first, then principal (`principal_component = max(0, amount − interest)`, capped at remaining balance).
   - `balance_after = balance − principal_component`.
   - Persist `interest_component`, `principal_component`, `balance_after` back onto the `loan_payment` row.
3. The leftover `balance` after the last payment, and the date of the last payment (or loan start if none), seed a forward projection via the existing `_project()` — but starting from the current balance rather than `loan.principal`.
   - Introduce a small variant/parameterization of `_project()` that accepts a starting balance and start date. Keep the original signature working for `payoff_calc`.
4. `PaymentSchedule` is rebuilt to hold **only the future/projected** rows (all status `due`). History lives in `loan_payment`.
5. Triggered on: loan create, loan patch (existing), payment create, payment delete.

`_loan_out()` next-due logic is unchanged (first `due` schedule row).

### `LoanOut` additions

Derived in `_loan_out()`:

- `outstanding_balance` — current balance (principal − total principal paid).
- `total_principal_paid`
- `total_interest_paid`
- `total_paid` — sum of logged payment amounts.
- `progress_pct` — `total_principal_paid / principal * 100`, clamped 0–100; `0` when principal is 0.

### Schemas

`app/loans/schemas.py`:

- `LoanPaymentIn` — `payment_date`, `amount`, `note?`.
- `LoanPaymentOut` — full row incl. computed split + `balance_after`.
- Extend `LoanOut` with the derived fields above.

### Endpoints

`app/loans/router.py`:

- `GET /loans/{loan_id}/payments?limit=12&offset=0` → `list[LoanPaymentOut]` (newest first). Returns total count via response header or a wrapped `{items, total}` shape — **wrapped shape** chosen for pagination clarity.
- `POST /loans/{loan_id}/payments` → record, recompute, return `LoanPaymentOut`. Role: owner/member.
- `DELETE /loans/{loan_id}/payments/{payment_id}` → delete, recompute. Role: owner/member. 204.

All scoped to the user's household via the existing `get_loan` ownership check.

### Tests

Extend `backend/tests/test_m8_loans.py`:

- Logging a payment reduces `outstanding_balance` and recomputes the schedule (first projected balance reflects the payment).
- Interest/principal split is correct for a known rate.
- Deleting a payment restores the prior projection.
- Payments are household-scoped (404 cross-household).
- Pagination returns correct slice + total.

## Frontend

### API hooks — `web/lib/api/loans.ts`

Add:
- `usePatchLoan()` — `PATCH /loans/{id}`, invalidates `loans`.
- `useLoanPayments(loanId, { limit, offset })` — paginated query, enabled when sheet open.
- `useCreatePayment()` — invalidates `loans`, schedule, payments.
- `useDeletePayment()` — same invalidations.

Types pulled from the generated `@shared/api-schema` after the backend schema regen.

### Main page — `web/app/(app)/debt/page.tsx`

Replace the flat `RowList`/`StatRow` with **loan cards** (grid, responsive). Each card:
- Name + type badge, APR, currency.
- Outstanding balance (prominent) with original principal beneath.
- Progress bar driven by `progress_pct`.
- EMI/min payment + next due date; penalty warning badge when `penalty_warning` is set.
- Click → opens `LoanDetail`.

Top summary card: total **outstanding** (not principal) + total monthly. Keep `NewLoanDialog` and `PayoffStrategyCard`.

### Detail — `web/components/debt/loan-detail.tsx`

Restructured sections inside the existing `ResponsiveSheet`:

1. **Header stats** — outstanding, paid-to-date, interest paid, next due.
2. **Payment history** — collapsed by default (`<details>`/disclosure). Paginated (12/page) from `useLoanPayments`. Each row: date, amount, principal/interest split, balance after, per-row delete (undo). A **Log payment** form (date, amount, note) at the top → `useCreatePayment`.
3. **Upcoming schedule** — existing projected `PaymentSchedule` rows, kept paginated.
4. **Payoff calculator** — unchanged.
5. **Edit & Delete** — Edit opens the shared form prefilled (`usePatchLoan`); Delete with confirm (`useDeleteLoan`).

### Shared form — `web/components/debt/loan-form.tsx`

Extract the field set currently inline in `NewLoanDialog` into a reusable `LoanForm` consumed by both Add (create) and Edit (patch), eliminating ~70 lines of duplication.

## Out of scope

- Credit-card statement fields (`CreditCardDetail`).
- Day-accurate interest accrual.
- Linking loan payments to bank transactions (M6).

## File touch list

**Backend:** `models/debt.py`, `loans/schemas.py`, `loans/service.py`, `loans/router.py`, new Alembic migration, `tests/test_m8_loans.py`.

**Frontend:** `lib/api/loans.ts`, `app/(app)/debt/page.tsx`, `components/debt/loan-detail.tsx`, new `components/debt/loan-form.tsx`. Regenerate `@shared/api-schema`.
