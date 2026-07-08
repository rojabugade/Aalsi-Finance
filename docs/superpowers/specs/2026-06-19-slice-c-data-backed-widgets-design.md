# Slice C — Data-Backed Widgets

**Date:** 2026-06-19
**Roadmap slice:** C — data-backed widgets (order 4; blocked by D, C-be — both done)
**Depends on:** D (widget-system standard, locked), C-be (commit c9806bd — endpoints + hooks)

## Goal

Ship four dashboard widgets that render real entity data through the locked D
`WidgetContract<T>` standard: **Credit Card, Debt, Recurring, Holdings**.

Roster note: the roadmap listed "Merchant" — dropped, because the existing
`breakdown` widget (dimension=merchant) already covers top-merchant spend.
"Holdings" added in its place: C-be shipped the holdings/valuations plumbing,
so an Investments widget is the natural consumer.

## Non-Goals

- **No CRUD inside widgets.** Widgets are read-only: glanceable `Body` + analytical
  `Focus`. Adding/editing/deleting cards, loans, series, holdings belongs to a later
  settings/entities surface, not the dashboard.
- **No multi-currency normalization.** Aggregate sums assume one household currency,
  the same assumption `netWorth`/`budgets` already make. Out of scope.
- **No global date range.** See "Global range" below.
- No AI insight upgrades — chips stay rule-based (slice G swaps `deriveInsights` later).

## Architecture

Four new files in `web/components/dashboard/widgets/`, each exporting a
`WidgetContract<T>` and each with a co-located `.test.tsx`:

| File | Export | Data hook |
|------|--------|-----------|
| `credit-card-widget.tsx` | `creditCardContract` | `useCreditCards()` |
| `debt-widget.tsx` | `debtContract` | `useLoans()` |
| `recurring-widget.tsx` | `recurringContract` | `useRecurringSeries("active")` |
| `holdings-widget.tsx` | `holdingsContract` | `useHoldings()` |

Each is wired into `web/lib/dashboard/registry.tsx` `WIDGETS` map.

**Contract shape (all four):**
- `useData(config)` → calls the TanStack hook, maps rows to a flat view-model via
  the `queryState` helper (`web/lib/dashboard/widget-contract.ts`). All
  loading/error/empty/partial/ready logic flows through `queryState`.
- `Body(ctx)` → density-adaptive render. Density 0 reuses `CompactStat`
  (`widget-tier.tsx`).
- `deriveInsights(data, config)` → rule-based chips.
- `Focus(ctx)` → analytical expansion.
- `emptyHint` → copy for the empty state.

Reuse: `formatCurrency` / `formatPercent` (`lib/format.ts`), `CompactStat`,
`InsightChips`, `FocusView`. No new shared infra needed.

## Widgets

### ① Credit Card — `creditCardContract`

Hook: `useCreditCards()` → `CreditCardOut[]`
(`{ loan, credit_limit, statement_balance, available_credit, statement_day, utilization, detail_complete }`).

View-model:
```ts
type CreditCardVM = {
  cards: { name: string; last4: string | null; balance: number; limit: number | null;
           utilization: number | null; dueDate: string | null; detailComplete: boolean }[];
  totalBalance: number;
  totalLimit: number;
  aggUtil: number | null;   // totalBalance / totalLimit when totalLimit > 0
  nextDue: { name: string; dueDate: string } | null;
};
```
- `balance` = `statement_balance ?? 0`; `dueDate` derived from `loan.next_due_date`.
- **Partial:** any `detail_complete === false` → `partialReason` "Some cards missing limits".
- **Empty:** no cards.
- Density: **0** = next-due card name + total balance · **1–2** = top 2–3 cards w/ utilization
  bars · **3** = all cards, utilization bars, due dates.
- Chips: "Due in N days" (nearest `dueDate`); "Utilization high" (`aggUtil >= 0.30`,
  tone warning, severity scaled); "Interest risk" if a statement balance is carried.
- Focus: all cards — name, balance, limit, utilization bar, available credit, due date.
- Controls: `count` (1–6); toggles `utilization`, `due`, `amounts`; + shared (preset/title/accent).

### ② Debt — `debtContract`

Hook: `useLoans()` → `LoanOut[]`. **Excludes `type === "credit_card"` by default**
(toggle `includeCC` to include — credit-card debt is otherwise owned by the Credit Card widget).

View-model:
```ts
type DebtVM = {
  loans: { name: string; principal: number; rate: number | null;
           monthly: number | null; nextDue: string | null }[];
  totalDebt: number;        // sum of principal (tracked amount)
  totalMonthly: number;     // sum of min_or_emi_amount
  nextPayment: { name: string; nextDue: string } | null;
};
```
- **Decision:** track `principal` as the debt amount. `LoanOut` has no live
  outstanding-balance field; deriving remaining balance would cost one
  `useLoanSchedule` query per loan. Glance stays cheap on `principal`; the
  payoff timeline / remaining-balance detail lives in **Focus** via
  `usePayoffStrategy`.
- **Empty:** no (non-CC, unless toggled) loans.
- Density: **0** = total debt + next payment · **1–2** = top debts w/ amount + rate ·
  **3** = list + monthly + next due.
- Chips: "Next: <date>"; "APR <max>%"; loan count.
- Focus: per-loan rows (principal, rate, monthly, next due) + snowball/avalanche
  payoff summary from `usePayoffStrategy`.
- Controls: `count`; toggles `rate` (APR), `monthly`, `includeCC`; + shared.

### ③ Recurring — `recurringContract`

Hook: `useRecurringSeries("active")` → `RecurringSeriesOut[]`
(`{ name, amount, currency, cadence, type, status, next_due_date, merchant_name, category_name }`).

Cadence → monthly factor: `weekly ×4.33`, `biweekly ×2.17`, `monthly ×1`,
`quarterly ÷3`, `annual ÷12`, `irregular` excluded from `totalMonthly`.

View-model:
```ts
type RecurringVM = {
  items: { name: string; amount: number; cadence: string; monthly: number;
           nextDue: string | null; type: string; merchant: string | null }[];
  totalMonthly: number;
  nextUp: { name: string; nextDue: string } | null;
};
```
- Items sorted by `next_due_date` ascending (nulls last).
- **Empty:** no active series → hint "No recurring payments detected yet. Upload a
  statement and I'll start finding patterns."
- Density: **0** = next payment + total monthly · **1–2** = next 3–5 by due date ·
  **3** = list + monthly total + grouping by `type`.
- Chips: "Next: <name> <date>"; "$X/mo".
- Focus: grouped by `type` (subscription / bill / income / transfer / other), monthly
  cost breakdown.
- Controls: `count`; toggles `bills`, `subscriptions`, `amounts`; + shared.
  (Type toggles filter `items` by `type` before rendering.)

### ④ Holdings — `holdingsContract`

Hook: `useHoldings()` → `HoldingOut[]`
(`{ name, symbol, asset_type, quantity, avg_buy_price, currency, latest_valuation }`).

Per holding: `value = latest_valuation?.value ?? quantity × (avg_buy_price ?? 0)`;
`cost = quantity × (avg_buy_price ?? 0)`; `gain = value − cost`;
`gainPct = cost > 0 ? gain / cost : null`.

View-model:
```ts
type HoldingsVM = {
  holdings: { name: string; symbol: string | null; value: number; cost: number;
              gain: number; gainPct: number | null }[];
  totalValue: number;
  totalGain: number;
  totalGainPct: number | null;   // totalGain / totalCost when totalCost > 0
};
```
- **Partial:** any holding lacking `latest_valuation` → "Some holdings unpriced".
- **Empty:** no holdings.
- Density: **0** = total value + total gain% · **1–2** = top holdings by value w/ gain ·
  **3** = full list + allocation.
- Chips: "▲/▼ X% total" (tone by sign); top holding by value.
- Focus: full list (value / cost / gain) + allocation donut by value
  (reuse the donut approach from `breakdown-widget.tsx`).
- Controls: `count`; toggles `gain`, `symbol`; + shared.

## Registry wiring

Add four entries to `WIDGETS` in `registry.tsx`. None include `range` in
`controls.fields`. Suggested icons (lucide-react): `CreditCard`, `Landmark`,
`Repeat`, `LineChart`. `defW/defH` default `5/2` like the existing data widgets;
`variant` left default.

## Global range — opt-out (deliberate)

The global board range (slice B) is a **backward** time-series selector (3m/6m/…).
These four are not time-series:
- Credit Card / Debt / Holdings = **current snapshots** ("what I owe/own now").
- Recurring = a **forward** window ("what's coming up").

A backward range maps onto none of them without misrepresenting the number, so all
four omit `range` from `controls.fields`. `resolveConfig` only injects the global
range when `fields.includes("range")`, so opting out is automatic — the same pattern
`budgets`, `recentActivity`, and `aiAlert` already use.

## Breakdown widget — responsive fix (in scope)

Since slice C designates the existing `breakdown` widget (dimension=merchant) as
the merchant surface, its layout correctness is in scope. The donut tier
(`breakdown-widget.tsx`, density ≥ 2 path) has dead-space / non-adjusting bugs:

1. **Vertical dead band.** The donut container uses `flex-col justify-start ... pt-1`
   with an inner `items-start` row, so the donut + legend hug the top of the cell.
   At tall instances (`h >= 3`) a large empty band appears below.
   → Change outer to `justify-center`; the group centers in available height.

2. **Donut size is a coarse stepped constant** (`size-28` / `size-20` keyed off a few
   w/h thresholds) that ignores actual available space — lost in large cells, cramped
   in others. → Add a larger tier for `h >= 3` (e.g. `size-36`) and pick the donut
   size from an explicit `(w, h)` → size map so each grid footprint gets a sensible,
   monotonic size.

3. **Legend-off case left-aligns the donut.** When `show.legend === false` the donut
   sits off to one side with space beside it. → Center horizontally (`justify-center`
   on the row) when the legend is hidden.

Also re-check `maxRowsFor`: when fewer rows exist than the cell can hold, the legend
is short — vertical centering (fix 1) absorbs this, but confirm bars/list tiers don't
regress. Verify visually at footprints 2×2, 5×2, 4×3, 5×3 with legend on and off.
This fix gets a test asserting the centered container classes for the donut tier.

## Testing

One `.test.tsx` per widget, mirroring the existing harness (vitest + React Testing
Library, mocking the data hook). Each asserts:
- loading / empty / ready (and partial where applicable) states via the contract,
- density-tier body output (0 vs mid vs 3),
- `deriveInsights` output for representative data.

## Error Handling

All paths route through `queryState`: `isLoading → loading`, `isError → error`,
`undefined data → loading`, empty predicate → `empty`, partial predicate → `partial`,
else `ready`. Widgets render no data-fetching errors themselves; `WidgetError`
(`widget-states.tsx`) owns the error UI.
