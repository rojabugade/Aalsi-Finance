# Debt experience redesign — design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Supersedes (UI):** the `ResponsiveSheet` loan popup from `2026-06-21-debt-cards-and-popup-info-rail-design.md`

## Goal

Turn the debt section into a premium, **fully functional** two-surface experience driven by **real AI** where the mockup brands it as AI:

1. Replace the loan **popup** with a routed **detail page** (breadcrumb `‹ Debt / <Loan name>` + back), mirroring the spend tab's category drill.
2. Redesign the `/debt` **overview** to the approved mockup: overview ring, AI Smart Prioritization, Your Debts list, Payoff Projection chart, Scenario Simulator, Next best step, and an AI Coach pane.
3. Enrich the detail **info section** (loan type, schedule kind, compounding, principal, APR, term, due day, EMI).
4. Fix the analyst pane: chat history currently lives in local component state and **resets on every reopen**. Lift it into session-scoped temporary memory so threads persist across opens — for both the dashboard pane and the new loan AI Coach.

**This is not a visual mock.** Every surface is wired to real data and real endpoints. Every figure shown is real (computed from the user's loans). Every AI-branded recommendation is produced by the actual LLM analyst, not faked.

## Core principle: AI decides, math computes

A finance product must never display a hallucinated dollar figure. So the division of labor is explicit and enforced:

- **The LLM genuinely produces** (this is the "AI data"): the chosen payoff **strategy** (snowball vs avalanche), the recommended **extra monthly payment**, the per-loan **rationale**/impact ranking, and the coaching **narrative**.
- **Deterministic math produces** every number: exact interest saved, months sooner, payoff dates, projection curves — computed from the plan the LLM chose. The LLM is never the source of a money figure; it is the source of the decision and the words.

This makes the AI-branded data truly AI-driven while keeping every number correct and reproducible.

**Don't invoke the LLM for anything math can do.** The ordering algorithms themselves (snowball = smallest balance first, avalanche = highest rate first), the % paid ring, the projection curves, the simulator, and all totals are pure deterministic math — no model call. The LLM is invoked *only* for the genuine judgment calls: choosing *which* strategy fits this user's full picture, recommending the extra amount, and writing the rationale/narrative. If a value is computable, it is computed, never prompted.

## Constraints & grounding

- `LoanOut` already exposes: `type` (credit_card/personal/auto/education/home/other), `schedule_kind` (revolving/amortizing/emi), `compounding` (monthly/daily), `principal`, `currency`, `interest_rate`, `min_or_emi_amount`, `due_day`, `start_date`, `end_date`, `next_due_date`, `penalty_warning`, derived `outstanding_balance`, `total_paid`, `total_principal_paid`, `total_interest_paid`, `progress_pct`.
- Existing loan hooks (`web/lib/api/loans.ts`): `useLoans`, `useLoanSchedule`, `usePayoffCalc`, `usePayoffStrategy`, `usePatchLoan`, payment hooks, `useCreateLoan`, `useDeleteLoan`.
- Analyst: `POST /analyst/ask` (`backend/app/analyst/`) builds a `FinancialSnapshot` and calls the LLM gateway. Structured output is supported: `llm.chat(messages, json_schema=PydanticModel, purpose=..., user_id=..., session=...)` returns a validated dict (the `action` mode already uses this).
- Backend already has deterministic payoff math: `loans/service.py` `payoff_strategy()` (snowball/avalanche ordering) and `payoff_calc()` (months/total interest for a monthly payment). `list_loans()` returns the full derived loan shape.
- **The current snapshot is debt-blind** — it only has aggregate `liabilities` + credit-card utilization, no per-loan data. This must change for the AI to be debt-aware.
- Charting: `recharts@^2.15.4` installed; `components/ui/area-chart.tsx` is the dynamic-loaded wrapper pattern to follow.
- Theming: per-theme CSS vars (`--accent`, `--accent-soft`, `--on-accent`, `--card`, `--border`, `--muted`, `--chip`, `--fg`). Default theme accent is violet (`#6b5bf0`/`#8b7bff`), matching the mockup natively. **Build with tokens, never hard-code the mockup's hex.**
- Routing pattern to mirror: spend's `/transactions?cat=<id>` query-param view swap with a breadcrumb `<Link>` to clear it (`components/spend/category-drill.tsx`, `app/(app)/transactions/page.tsx`).

## AI fallback (no provider configured)

When the LLM gateway is unavailable (`available:false` from the gateway), the AI-branded cards **fall back to the deterministic snowball/avalanche recommendation but drop the "AI" framing** for that fallback (e.g. heading becomes "Smart Prioritization", a small note says AI coaching is off). The page stays fully functional with zero AI provider. The backend signals this with a `source: "ai" | "deterministic"` field; the frontend switches labels on it.

## Architecture

### Backend (Phase 0): make the analyst debt-aware + structured debt plan

1. **Extend `FinancialSnapshot`** with a `loans` list (from `loans.service.list_loans`, trimmed to model-relevant fields: name, type, schedule_kind, outstanding_balance, principal, interest_rate, min_or_emi_amount, next_due_date). `snapshot.py` populates it. This alone makes the existing `/analyst/ask` (and thus the AI Coach chat) debt-aware.
2. **New endpoint `POST /analyst/debt-plan`** → `DebtPlanOut`. Flow in `analyst/service.py`:
   - Build the debt context: the loans list + **deterministic candidate scenarios** computed server-side (reuse `payoff_strategy` for both snowball and avalanche orderings; reuse `payoff_calc`-style amortization for baseline vs +extra).
   - Call `llm.chat(..., json_schema=DebtPlanLLM)` asking the model to choose `strategy`, `extra_monthly`, per-loan `rationale`/`impact`, a `headline`, and a `narrative` — **grounded on the supplied scenarios, and explicitly told not to state its own totals**.
   - **Recompute** `interest_saved`, `months_sooner`, `baseline_payoff_date`, `optimized_payoff_date` deterministically from the model's chosen `strategy` + `extra_monthly` (clamped to a sane range). These computed numbers — not the model's — populate the response.
   - On `LLMError`/no provider: return the deterministic snowball-vs-avalanche best plan with `source:"deterministic"`, `available:false`.
3. **Schema `DebtPlanOut`** (new, `analyst/schemas.py`):
   ```
   available: bool
   source: "ai" | "deterministic"
   strategy: "snowball" | "avalanche"
   extra_monthly: Decimal
   headline: str                 # AI (or deterministic fallback) one-liner
   narrative: str                # AI coaching paragraph (empty in fallback)
   ordered: [ { loan_id, name, extra_allocation: Decimal, rationale: str, impact: str } ]
   interest_saved: Decimal       # deterministic
   months_sooner: int            # deterministic
   baseline_payoff_date: date    # deterministic
   optimized_payoff_date: date   # deterministic
   updated_at: datetime
   ```
4. Tests with a fake LLM (mirroring existing analyst tests): AI path returns structured plan with deterministic numbers; fallback path on `LLMError`; numbers come from math not the model (assert the model can't move the totals).

### Frontend file plan

```
components/debt/
  overview/
    debt-overview.tsx          # Overview surface composition
    overview-ring.tsx          # total, % paid ring, monthly, avg APR
    smart-prioritization.tsx   # <- /analyst/debt-plan (AI strategy + deterministic numbers)
    debt-list.tsx              # Your Debts rows -> drill to ?loan=<id>
    payoff-projection.tsx      # recharts: current vs AI-plan balance over time
    scenario-simulator.tsx     # client math; user-driven "what if" (not AI-branded)
    next-best-step.tsx         # derived from debt-plan top item
  detail/
    loan-detail-page.tsx       # breadcrumb + back + sections
    loan-info-card.tsx         # enriched info block
    (reuse) payment-history, upcoming-schedule, payoff-calculator, edit-section
  analyst/
    ai-coach.tsx               # fancy persistent chat pane for debt surfaces
  debt-math.ts                 # pure amortization helpers (projection/savings/payoff date)
  debt-context.ts              # loan + plan context for the coach (extends loan-context.ts)
web/lib/api/analyst.ts         # + useDebtPlan() hook
```

`debt/page.tsx` becomes a thin switch on the `loan` search param (no param → Overview; `?loan=<id>` → detail; invalid id → Overview). Existing `loan-detail.tsx` sections (PaymentHistory, UpcomingSchedule, PayoffCalculator, EditSection) are extracted/reused on the detail page; the `ResponsiveSheet` wrapper and `InfoRail` are removed.

### debt-math.ts (pure, unit-tested)

Mirrors the server math so the projection chart and the live simulator are instant and consistent with the backend:

- `amortize(balance, annualRatePct, monthlyPayment) -> { months, totalInterest, totalPaid, series, neverPaysOff }` — guards payment ≤ monthly interest.
- `aggregateProjection(loans, extraMonthly, strategy) -> series[]` — summed balances over time for the chart.
- `savingsVsBaseline(loans, extraMonthly, strategy) -> { interestSaved, monthsSooner, baselinePayoff, optimizedPayoff }` — for the **simulator only** (user-driven). The AI plan card uses the backend's computed numbers.
- `weightedAvgRate`, `totalsSummary`.

### Phase 1 — Overview (`/debt`)

- **Debt Overview card** — total outstanding, animated SVG % paid ring, total monthly (`Σ min_or_emi`), balance-weighted avg APR, "On track" chip (no `penalty_warning`). Pure client derivations.
- **AI Smart Prioritization** — `useDebtPlan()` → strategy, `ordered` (per-loan extra + "Highest impact" badge on rank 1), headline + the deterministic `interest_saved` / `months_sooner`. "Apply plan" sets the Scenario Simulator's extra-payment state and scrolls to it (no write endpoint exists; flagged). "Updated Xs ago" from `updated_at`. Honest fallback labeling when `source:"deterministic"`.
- **Your Debts** — rows (type icon, name, type, remaining, rate, monthly, next due, progress, chevron); click → `router.push('/debt?loan=<id>')`; keyboard-accessible.
- **Payoff Projection** — recharts line chart, current (no extra) vs AI-plan (`debt-plan` strategy + extra) from `aggregateProjection`; "N months sooner" callout from the debt-plan numbers.
- **Scenario Simulator** — `$0–$2000+` slider; live `savingsVsBaseline` → new payoff date + interest saved (+% vs current). Pure client math, debounced; no per-keystroke calls. This card is **not** AI-branded (it's the user's own what-if).
- **Next best step** bar — from `debt-plan.ordered[0]`; "Set up payment" routes to that loan's detail with a logging intent (non-destructive); "Not now" dismisses for the session.

### Phase 2 — Loan detail (`/debt?loan=<id>`)

- **Breadcrumb** `‹ Debt / <Loan name>` (Link clears `loan`) + back, mirroring `category-drill.tsx`.
- **Loan info card** (the requested enrichment): loan type, schedule kind (revolving/amortizing/EMI) with one-line plain-English meaning, compounding, original principal, APR, term (`start_date → end_date`), due day, EMI/min payment, currency.
- **Header stats** (outstanding, paid to date, interest paid, next due), **Payment history**, **Upcoming schedule**, **Payoff calculator** — reuse current logic, restyled to the card vocabulary. **Edit/delete** reuse `EditSection`; on delete, route to `/debt`.

### Phase 3 — Persistent AI Coach

- New `components/dashboard/analyst/thread-store.ts`: session-scoped store (module singleton + `useSyncExternalStore`) mapping `threadId -> Message[]`. **Not persisted to localStorage** (temporary memory; clears on full reload), per request.
- `ChatThread` takes a `threadId` prop and reads/writes the store instead of local `useState`. Dashboard thread = `"dashboard"`; loan coach = `"loan:<id>"`. Reopening restores the thread.
- `ai-coach.tsx` — fancy debt chat pane: header ("AI Coach", BETA chip), suggested prompts, a "Top recommendation" card from `useDebtPlan` (AI narrative + strategy), scrollable thread, composer, "AI responses can make mistakes" footnote; reuses the liquid-glass treatment from `analyst-pane.tsx`. On the detail page, `debt-context.ts` injects the loan facts into questions so chat answers are loan-specific. Because the snapshot now carries `loans`, overview-level coach questions are debt-aware without extra injection.

## Data flow

`useLoans` → `debt-math` → overview ring / projection / simulator (synchronous, memoized). `useDebtPlan` → Smart Prioritization + Coach recommendation + Next best step (real AI, deterministic numbers). `useLoanSchedule`/`usePayoffCalc` on detail. `useAnalystAsk` (now debt-aware) → Coach chat, rendered history held in the thread store.

## Error & empty states

- Loans error → existing error card; loading → skeletons matching the new layout.
- Zero loans → overview empty hero ("No debts yet…"), hides chart/simulator/prioritization, keeps "Add loan".
- `neverPaysOff` (payment ≤ interest) → simulator/calculator show the existing warning instead of an infinite projection.
- LLM unavailable → deterministic fallback with honest labeling (see above).
- Unknown `?loan=` id → render overview (no crash).

## Testing

- **Backend:** `debt-plan` AI path (structured plan, deterministic numbers), fallback path on `LLMError`, snapshot now includes loans; numbers provably come from math not the model. Existing analyst + loan tests stay green (loan tests run in the api container against `finance_test`).
- **Frontend:** `debt-math.test.ts` (amortization, neverPaysOff, savings, weighted rate, zero/edge); `thread-store.test.tsx` (per-thread isolation, append, restore, reset); component tests — overview renders from mock loans; row click pushes `?loan=<id>`; detail renders enriched info; breadcrumb clears param; debt-plan card shows AI vs deterministic labeling; coach persists messages across unmount/remount.
- `web` lint is broken repo-wide (Next 16 removed `next lint`); gate on `npm run typecheck` + `npm test`.

## Out of scope

- "Apply plan" persistence (no write endpoint); day-accurate/daily-compounding-exact accrual (monthly amortization, consistent with existing schedule math); durable analyst memory (temporary session memory only); `CreditCardDetail`-specific fields; real ML (the "AI" is the LLM's strategy/narrative decision, not a trained model).

## Phasing / sequencing

0. **Backend** — snapshot `loans` + `/analyst/debt-plan` (AI plan, deterministic numbers, fallback) + tests.
1. **Overview** — `debt-math` (+tests) → overview surface + routing switch; wire `useDebtPlan`.
2. **Detail page** — routed detail + enriched info; retire popup.
3. **Persistent AI Coach** — thread store + coach pane; wire into dashboard and debt surfaces.

Each phase is independently shippable and testable; Phase 0 unblocks the AI-branded parts of Phases 1 and 3.
