# Debt plan: backend⇄frontend cascade parity + income-aware AI

**Date:** 2026-06-23
**Status:** Approved (design)
**Area:** `backend/app/analyst/debt_plan.py`, `backend/app/analyst/service.py`, tests

## Problem

The Debt overview shows two contradictory numbers for the same plan:

- **AI Smart Prioritization card** says "save $3,278 in interest, debt free **0 months sooner**".
- **Payoff Projection chart** says "**3 months sooner**".

Two separate causes, both rooted in the backend plan math:

### Cause A — backend projection has no rollover and uses the wrong baseline

The frontend (`web/components/debt/debt-math.ts` → `simulateStrategy`) already models a
correct **waterfall**: each month every loan accrues interest and pays its minimum, then a
*pool* (extra payment + minimums freed by paid-off loans + any minimum over-shoot) cascades
down the strategy order. Paying off the top loan accelerates every loan below it. It also
starts each loan from its **outstanding balance**.

The backend (`backend/app/analyst/debt_plan.py` → `project_total`) does none of this:

1. It projects each loan **independently** (`_project` per loan) — no rollover.
2. It reports `months = max(len(rows))` — the **single longest loan** drives the debt-free
   date, so extra aimed at any other loan never moves it (→ "0 months sooner" while the home
   loan dominates the horizon).
3. It starts from raw `loan.principal`, ignoring payments already made; the frontend starts
   from **outstanding balance** (`principal − total_principal_paid`).

`interest_saved` *is* honest (it sums across loans), which is why the card shows real savings
but zero schedule improvement — a self-contradictory headline by construction.

### Cause B — the AI never sees income

The snapshot sent to the LLM in `run_debt_plan` contains only `loans` + `scenarios`. Income,
expenses, and leftover are **not** included. The model picks `strategy` + `extra_monthly`
blind, then the code clamps the result to affordability afterward. So the recommendation is
income-*clamped*, never income-*aware*.

There is also a guardrail gap: if `build_cashflow_summary` throws, `leftover` falls to `0`, the
`if affordable > 0` branch is skipped, and the raw (potentially hallucinated) LLM
`extra_monthly` passes through **un-clamped**.

## Goals

1. Backend and frontend compute the **same** payoff math, so the card and the chart always
   agree. The frontend waterfall is the reference implementation.
2. The AI and the deterministic ("math") path share that one engine and are directly
   comparable — the AI can no longer produce a strictly-worse-looking plan due to a different
   algorithm.
3. The AI reasons within the household budget (income/leftover in its context), with the
   affordability clamp retained as a guardrail and its skip-on-failure gap closed.

## Non-goals

- No UI redesign. The only UI change is removing the frontend months-sooner workaround so the
  card and chart read the backend figure (§7). `build_ordered` stays as-is: "Extra $X/mo on
  loan #1, $0 on the rest" is the correct **month-0** snapshot; the cascade is a timeline, not a
  static per-loan figure.
- No new payoff strategies beyond the existing snowball / avalanche.
- No change to credit-card exclusion or other plan plumbing.

## Design

### 1. `simulate_strategy()` — Python port of the frontend waterfall

New function in `backend/app/analyst/debt_plan.py`, a faithful port of
`simulateStrategy` (debt-math.ts):

```
simulate_strategy(loans, extra_monthly: Decimal, strategy: str) -> dict
  # returns {"months": int, "interest": Decimal, "payoff_date": date|None,
  #          "series": list[Decimal]}   # series = summed balance per month, month 0..N
```

Per-loan state: `balance` (outstanding), `rate` (monthly), `min` (payment).

- **Start balance** = outstanding = `principal − sum(payment.principal_component)`, clamped at
  0. Loans are passed in with this already resolved (see §3) so `debt_plan` stays free of DB
  access.
- **Monthly rate** = `annual_rate / 100 / 12` for both sides (decision: match frontend exactly;
  daily-compounding nuance is intentionally dropped in the *plan* projection so the card and
  chart are identical for every loan). This diverges from `_monthly_rate` only for
  daily-compounded loans, and only in the forward plan view.
- **Min fallback** = `min_or_emi_amount` if > 0 else `max(1, outstanding * 0.02)` (matches
  `paymentOf` in the frontend).
- **Each month**: (1) accrue interest on active balances; (2) pay minimums, where cleared
  loans contribute their full minimum to the pool and partial over-shoot past a tiny balance is
  recovered into the pool; (3) cascade the pool down the strategy priority order, overflowing
  to the next loan as each clears.
- **Rounding**: round balances to cents per month (mirror `round2`) so totals match the
  frontend to the cent.
- **Cap**: 600 months (`MONTH_CAP`), same as both current implementations.
- **payoff_date** = `today + months` (calendar months). The plan is forward-looking "from
  now", which is also more correct than the current per-loan `start_date` mix.

Ordering reuses the existing `order_loans` (already consistent with the frontend `orderLoans`:
avalanche = rate desc then balance asc; snowball = balance asc then rate desc). One alignment
fix: `order_loans` currently sorts by `principal`; switch it to **outstanding** so tie-breaks
match the frontend.

### 2. `project_total` becomes a thin wrapper

`project_total(loans, extra_monthly, strategy)` delegates to `simulate_strategy` and returns
the existing `{"months", "interest", "payoff_date"}` shape. All current callers
(`_assemble_plan`'s baseline/optimized projections and the AI snapshot's `scenarios`) keep
working unchanged, but now get cascade-honest numbers. `months_sooner` and `interest_saved`
in `_assemble_plan` then match the chart.

The old per-loan `_project`-based body and `_payment_for` are removed if unused elsewhere
(grep first; `_payment_for` is local to this module).

### 3. Resolve outstanding balance before calling the engine

`debt_plan` must not touch the DB. In `service.py`, `_debt_loans` (or a small helper) resolves
each loan's outstanding balance and attaches it (e.g. a lightweight dataclass / dict, or set an
attribute the engine reads). Reuse the existing payment-sum logic from `loans.service`
(`total_principal_paid` from `_apply_payments` / the same query `_loan_out` uses) rather than
duplicating it. The engine reads `outstanding` with a `principal` fallback so unit tests can
pass bare `Loan` objects.

### 4. Income-aware AI snapshot + guardrail fix (`run_debt_plan`)

Add to the snapshot dict the model sees:

```
"budget": {
  "income_monthly": float(income),
  "expenses_monthly": float(expenses),
  "leftover_monthly": float(leftover),
  "affordable_extra": float(max(leftover, 0)),
}
```

Pull these from the already-computed `build_cashflow_summary` result (income, expenses,
`leftover_monthly`). Update `_DEBT_SYSTEM` to tell the coach to keep `extra_monthly` within
`affordable_extra` and to use income context when choosing the strategy.

Keep the post-hoc clamp, and close the gap: when affordability is unavailable or ≤ 0, fall back
to the deterministic affordable default (`_affordable_default_extra` / `_default_extra`) as the
cap instead of trusting an unbounded LLM number. Net rule: the recommended `extra_monthly`
is **never** greater than a sane affordable bound, regardless of LLM output or cashflow errors.

### 5. Tests (`backend`, `finance_test` DB; pytest)

- **Cascade correctness**: a fixture with ≥3 loans where the extra targets a *non-horizon*
  loan. Assert `project_total(..., extra>0).months < project_total(..., 0).months` (rollover
  moves the debt-free date) — the exact case that currently returns 0.
- **Baseline = outstanding**: a loan with recorded payments projects from outstanding, not
  principal.
- **Parity**: a shared numeric fixture (same loans, same extra, avalanche) produces the same
  `months` and `interest` (to the cent) as the frontend `simulateStrategy`. Encode the expected
  values from a vitest run of the same fixture so both suites assert the identical truth.
- **Income clamp**: `run_debt_plan` never returns `extra_monthly > affordable_extra`, including
  when `build_cashflow_summary` raises (guardrail-gap regression test).
- Frontend vitest already covers `simulateStrategy`; add one assertion tying the shared fixture
  to the same expected numbers if practical.

### 6. Cache the plan — recompute only on change or after a TTL

A page refresh re-ran the whole plan, including the (expensive) LLM call, every time.
`run_debt_plan` now caches its result in the existing Redis-backed `LLMCache` (already on the
injected `llm` client, 24h TTL):

- **Key** = `debtplan:{sha256(fingerprint)}`. The fingerprint covers everything that changes
  the plan: household id, each loan's `(id, principal, interest_rate, min_or_emi_amount,
  outstanding, type)`, and the budget (`income`, `leftover`). It also includes the calendar
  day so payoff dates roll forward daily even with no input change.
- **Hit** → return the cached `DebtPlanOut` (no recompute, no LLM call). **Miss** (an input
  changed, or the 24h TTL expired) → recompute and store.
- Compute logic moved into `_compute_debt_plan`; `run_debt_plan` is now the cache wrapper.
- Best-effort: if `llm` has no `.cache` (unit tests) or Redis is down, it computes directly —
  caching never breaks the plan.

This satisfies "don't recalculate on every refresh — only when something changes, or
periodically if nothing changes for a while": the fingerprint is the "something changed" signal;
the TTL (and daily key component) is the "periodic" refresh.

### 7. Frontend single source of truth (small, justified UI change)

`debt-overview.tsx` previously **recomputed** months-sooner locally (`savingsVsBaseline`)
specifically because the backend figure "predates the rollover model and reads 0" (its own
comment). With the backend now honest, that workaround is removed: both the Smart
Prioritization card and the Payoff Projection footer read the backend `plan.months_sooner`.
The chart *line* still renders from the local `simulateStrategy`, which now matches the backend
to the cent. This is the only UI change; it eliminates the source of the 0-vs-3 contradiction
at its root.

### 8. Manual recalc + no payment cap (follow-up)

- **Manual recalc**: `POST /analyst/debt-plan?force=true` bypasses the cache read and recomputes
  (still writes the fresh result back). Frontend `useRecalcDebtPlan` mutation writes the result
  straight into the query cache; a refresh button (RefreshCw) sits in the Smart Prioritization
  card header. For when the cached plan is stale-feeling or after swapping the LLM provider.
- **Removed the flat $10k cap** (`_EXTRA_CAP`) on the recommended/allowed extra. `_clamp_extra`
  now only floors at zero; the recommendation is bounded by affordability (leftover), not an
  arbitrary ceiling — consistent with the "no arbitrary caps" rule. Frontend `suggestedExtraMax`
  drops its `min(10000, …)` ceiling and instead scales with the debt (capped only at total
  outstanding, since paying more than you owe in a month is meaningless).

## Risks / notes

- **Performance**: month-by-month simulation over ≤600 months × a handful of loans, run a few
  times per plan request — negligible.
- **Rate parity trade-off**: daily-compounded loans show a slightly lower projected interest in
  the *plan* than a daily model would. Accepted: chosen explicitly to guarantee card⇄chart
  parity; the schedule/ledger features that need daily accuracy still use `_monthly_rate`.
- **`order_loans` tie-break change** (principal → outstanding) could reorder loans with equal
  rates; this is the intended alignment with the frontend and is covered by the parity test.
