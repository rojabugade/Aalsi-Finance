# Money page + disposable-income engine — Design

Date: 2026-06-22
Status: Approved (pending spec review)

## Problem

The app treats "income" narrowly (salary sources + take-home + equity) and never
computes what the user actually has left over each month. As a result:

- The **Income** page shows earnings only — no holdings/assets, no leftover.
- The **safe-to-spend** widget is hollow: `max(0, -spend_total)`, not real
  disposable income.
- The **debt optimizer** picks an arbitrary extra payment (`total_min × 0.1`)
  with no idea what the user can afford.
- **Recurring** has a model, CRUD, and a wired widget, but `detect_recurring()`
  only sets `flags["recurring"]=true` on a transaction — it never materializes a
  `RecurringSeries`, so the widget and any leftover calc stay empty unless the
  user hand-enters series.

## Goal

Introduce one authoritative backend number — **monthly leftover (disposable
income)** — computed once and reused by the Money page, the safe-to-spend
widget, and the debt optimizer. Make recurring data real (auto-detected **and**
manually addable). Reframe the Income page as a holistic **Money** page.

```
leftover_monthly =
    income_monthly
  − recurring_monthly        (bills + subscriptions, non-income)
  − debt_emi_monthly         (loan EMIs, excluding credit cards)
  − card_min_monthly         (estimated credit-card minimums)
  − discretionary_monthly    (6-month avg of un-categorized spend)
```

## Decisions (locked with user)

1. **Page identity:** rebuild as a **Money** overview — hero leftover number +
   Earnings / Commitments / Assets sections. Nav relabels to "Money"; the route
   stays `/income` to avoid churn (path rename can come later).
2. **Spend baseline:** 6-month average of discretionary spend (`sum(180d) / 6`).
3. **Debt link:** debt optimizer's extra payment **defaults to 50% of leftover**
   and the scenario slider **caps at full leftover**.
4. **Recurring detection:** build real detection that materializes
   `RecurringSeries`. Manual add/edit/delete also supported — both paths coexist.

## Components

### 1. Backend — new `cashflow` module

`backend/app/cashflow/{service,router,schemas}.py`, registered in the app router.

Endpoint: `GET /cashflow/summary` → `CashflowSummary`:

| Field | Derivation |
|---|---|
| `currency` | household base currency (via `fx_service.household_base_currency`) |
| `income_monthly` | Σ income-source **net**, normalized with `FREQ_MULT`. If **no** income sources exist, fall back to detected recurring-income series + transaction-derived income. (Prevents double-counting salary that also appears as a recurring deposit.) |
| `recurring_monthly` | active `RecurringSeries` with `type ∉ {income}`, normalized by `CADENCE_FACTOR` |
| `debt_emi_monthly` | Σ `min_or_emi_amount` over loans where `type != "credit_card"` |
| `card_min_monthly` | Σ estimated card minimum = `max(MIN_FLOOR, MIN_PCT × statement_balance)` per credit-card loan (reuse `widget_data.list_credit_cards`) |
| `discretionary_monthly` | expense transactions with `recurring_series_id IS NULL` and not a loan/card payment, over the last 180 days ÷ 6 |
| `leftover_monthly` | the subtraction above, floored at the display layer (can be negative in data) |
| `breakdown` | ordered list of `{label, amount, kind}` lines for the waterfall UI |

All amounts FX-normalized to the base currency. Constants `MIN_FLOOR`, `MIN_PCT`
defined in the module (e.g. `25.00`, `0.02`).

Reuses existing services: `income.service` (net normalization / take-home),
`widget_data.service` (`list_recurring`, `list_credit_cards`),
`loans.service.list_loans`, `analytics.service` (transaction spend).

**Discretionary query** must exclude:
- transactions linked to a `recurring_series_id` (counted in `recurring_monthly`),
- loan/card payments (the `loan_payment` ledger / payments to card loans),
- inflows (only expenses count).

### 2. Backend — recurring detection (replace flag-only stub)

Rewrite `detect_recurring(session, txn)` in `backend/app/transactions/service.py`:

- Find same-merchant transactions within ~13 months whose amount is within ±5%
  of `txn.amount` (sign-aware: inflow vs expense).
- If ≥3 occurrences: sort by date, compute the **median gap** between
  consecutive dates, map it to a cadence:
  - ~7d → `weekly`, ~14d → `biweekly`, ~30d → `monthly`, ~91d → `quarterly`,
    ~365d → `annual`, else `irregular` (skip materialization for irregular).
- **Upsert** one `RecurringSeries` per `(household_id, merchant_id, cadence)`:
  set `amount` = median, `currency`, `cadence`, `next_due_date` = last date +
  interval, `type` = `income` if inflow else heuristic (`subscription` for
  small/round monthly, else `bill`), `status="active"`. Update in place if a
  matching series already exists (idempotent — never duplicate).
- Link the triggering transaction via `txn.recurring_series_id` when newly
  matched (so it is excluded from discretionary).

Keep the function defensive: no merchant → return; never raise into the txn
write path.

### 3. Backend — debt plan consumes leftover

In `backend/app/analyst/service.py`:

- Compute `leftover` from the cashflow service for the household.
- `_default_extra` (deterministic branch) becomes `clamp(leftover × 0.5)`
  instead of `total_min × 0.1`.
- Pass `leftover` into the AI prompt as affordability context and **clamp** the
  AI-returned `extra_monthly` to `≤ leftover`.
- Add `affordable_extra: Decimal` to `DebtPlanOut` (= leftover) so the UI can
  show "based on ~$X/mo surplus" and cap its slider.

### 4. Frontend — Money page (rebuild `/income`)

- `web/lib/shell/nav.ts` + `web/lib/nav.ts`: relabel "Income" → "Money".
- New `web/lib/api/cashflow.ts` → `useCashflowSummary()` (typed off the generated
  schema once the backend ships the endpoint).
- `app/(app)/income/page.tsx` rebuilt with sections:
  - **Hero:** leftover/mo + a compact waterfall from `breakdown`.
  - **Earnings:** existing income-source list + take-home sheet + detected
    recurring-income rows.
  - **Commitments:** recurring / debt EMI / card-minimum lines from cashflow,
    plus the recurring add/edit UI (below).
  - **Assets:** holdings (`useHoldings`) + net worth (existing analytics) in a
    compact list. Reuse existing widget data sources; no new asset backend.
- Keep `EquitySection` under Earnings.

### 5. Frontend — manual recurring add/edit/delete

Commitments section gets an **"Add recurring"** dialog (form: name, amount,
cadence, type, next-due) wired to the existing `useCreateRecurringSeries`.
Listed series support inline edit/delete via existing patch/delete hooks. Manual
entries and auto-detected series are the same `RecurringSeries` rows and both
feed `recurring_monthly`.

### 6. Frontend — wire the rest

- **safe-to-spend widget** (`components/dashboard/widgets/safe-to-spend-widget.tsx`):
  replace the hollow calc with `useCashflowSummary().leftover_monthly`. Update
  insights + tests.
- **debt scenario dialog** (`components/debt/overview/scenario-dialog.tsx`):
  slider `max` = `affordable_extra` (leftover), initial = `plan.extra_monthly`,
  and surface an affordability label ("afford ~$X/mo extra").
- **recurring widget**: already wired to `useRecurringSeries("active")` — now
  self-populates from detection; verify graceful empty state (already present).

## Data flow

```
income sources (net) ─┐
recurring(income)*    ├─► income_monthly ─┐
txn income*           ┘ (*fallback only)  │
recurring(non-income) ───► recurring_monthly│
loans(non-card) EMIs  ───► debt_emi_monthly │─► leftover_monthly ─┬─► Money hero
credit cards          ───► card_min_monthly │                     ├─► safe-to-spend
txns(180d, no series, ───► discretionary/6 ─┘                     └─► debt plan
   not loan/card pmt)                                            (default 50%, cap 100%)
```

## Testing

**Backend (pytest, finance_test DB / api container — local .venv is broken):**
- cashflow math; income fallback when no sources; discretionary exclusion of
  recurring-linked + loan/card payments; FX normalization.
- recurring detection: cadence inference from gaps, no duplicate series,
  income-vs-bill classification, idempotent upsert, txn linkage.
- debt plan: deterministic default extra = 50% of leftover; AI extra clamped to
  leftover; `affordable_extra` populated.

**Frontend (vitest + typecheck):**
- cashflow VM / waterfall rendering.
- safe-to-spend new calc + insights.
- Money page sections render with/without data.
- recurring add dialog submit path.
- debt scenario slider cap = affordable_extra.

## Out of scope (YAGNI)

- Renaming the `/income` route or adding redirects.
- Real-time market valuation of holdings (uses existing latest valuation).
- Background/scheduled recurring re-detection sweep (detection runs on txn write).
- Multi-currency per-line display beyond base-currency normalization.
