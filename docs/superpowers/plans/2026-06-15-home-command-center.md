# Home Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the sparse Home (`/dashboard`) into a dense at-a-glance command center: net worth (placeholder), this-month cash flow, budget status, top movers/alerts, recent activity, and quick actions — with the currently broken charts fixed.

**Architecture:** Reuses existing data hooks (`useTimeseries`, `useBreakdown` from analytics; `useTransactions`; `useBudgets`; `useNotifications`) and components built in earlier plans (`NetWorthCard` from Insights, `topMover`/`categoryRowsWithDeltas` from Spend, `InsightStrip` patterns). Home becomes a bento grid. The "broken graphs" are fixed by feeding the existing `HeroCard` sparkline / `AreaChart` clean numeric series (the current page already computes `points`; the break is empty/NaN series — we guard those). Depends on Plans 1–3.

**Tech Stack:** Next.js, React, TypeScript, TanStack Query, recharts, Tailwind, Playwright e2e.

**Testing note:** No unit runner — validated via Playwright e2e against the seeded demo household.

---

## File Structure

- **Create** `web/components/dashboard/budget-status-card.tsx` — budgets vs actual mini-summary.
- **Create** `web/components/dashboard/top-movers-card.tsx` — top 3 MoM movers (reuses `categoryRowsWithDeltas`).
- **Create** `web/components/dashboard/recent-activity-card.tsx` — last 5 transactions, links to Spend.
- **Modify** `web/app/(app)/dashboard/page.tsx` — assemble the bento command center; fix chart guards.
- **Create** `web/e2e/home.spec.ts`.

---

### Task 1: Budget status card

**Files:**
- Create: `web/components/dashboard/budget-status-card.tsx`

- [ ] **Step 1: Confirm the budgets hook shape**

Run: `sed -n '1,30p' web/lib/api/budgets.ts`
Expected: `useBudgets()` returns budget rows with at least `amount`, `category_id`, `period`. Note the exact `BudgetOut` field names and use them below (adapt property access if they differ).

- [ ] **Step 2: Write the component**

```tsx
"use client";

import Link from "next/link";
import { useBudgets } from "@/lib/api/budgets";
import { useTransactions } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";

const ym = (d: string) => d.slice(0, 7);

export function BudgetStatusCard() {
  const budgets = useBudgets();
  const txns = useTransactions();
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  const spentByCat = new Map<string, number>();
  for (const t of txns.data ?? []) {
    if (Number(t.amount) < 0 || ym(t.txn_date) !== month || !t.category_id) continue;
    spentByCat.set(t.category_id, (spentByCat.get(t.category_id) ?? 0) + Number(t.amount));
  }

  const rows = (budgets.data ?? []).slice(0, 4).map((b) => {
    const spent = spentByCat.get(b.category_id) ?? 0;
    const limit = Number(b.amount);
    return { id: b.id, limit, spent, pct: limit ? Math.min(100, (spent / limit) * 100) : 0 };
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card" data-testid="budget-status-card">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm">Budget status</b>
        <Link href="/budgets" className="text-xs font-semibold text-accent">See all</Link>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No budgets set yet.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.id}>
              <div className="flex justify-between text-xs">
                <span className="tabular-nums">{formatCurrency(r.spent)} / {formatCurrency(r.limit)}</span>
                <span className={r.pct >= 100 ? "font-bold text-destructive" : "text-muted"}>{r.pct.toFixed(0)}%</span>
              </div>
              <span className="mt-1 block h-[6px] overflow-hidden rounded-full bg-track">
                <span className={`block h-full rounded-full ${r.pct >= 100 ? "bg-destructive" : "bg-accent"}`} style={{ width: `${r.pct}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors. If `BudgetOut` lacks `id`/`category_id`/`amount` with those names, adjust the property accesses to the real schema.

- [ ] **Step 4: Commit**

```bash
git add web/components/dashboard/budget-status-card.tsx
git commit -m "feat(home): add budget status card"
```

---

### Task 2: Top movers + recent activity cards

**Files:**
- Create: `web/components/dashboard/top-movers-card.tsx`
- Create: `web/components/dashboard/recent-activity-card.tsx`

- [ ] **Step 1: Write top movers**

```tsx
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCategories, useTransactions } from "@/lib/api/transactions";
import { categoryRowsWithDeltas } from "@/lib/spend/derive";
import { formatCurrency } from "@/lib/format";
import { categoryIcon } from "@/lib/icons";

export function TopMoversCard() {
  const txns = useTransactions();
  const cats = useCategories();
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const prev = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();

  const movers = useMemo(() => {
    const rows = categoryRowsWithDeltas(txns.data ?? [], cats.data ?? [], month, prev);
    return rows.filter((r) => r.deltaPct !== null).sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0)).slice(0, 3);
  }, [txns.data, cats.data, month, prev]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card" data-testid="top-movers-card">
      <b className="text-sm">Top movers</b>
      <p className="mb-2 text-xs text-muted">Biggest changes vs last month.</p>
      {movers.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No change to report.</p>
      ) : (
        movers.map((r) => {
          const Icon = categoryIcon(r.name);
          const up = (r.deltaPct ?? 0) > 0;
          return (
            <Link key={r.id} href={`/transactions?cat=${encodeURIComponent(r.id)}`} className="flex items-center gap-3 py-1.5">
              <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent"><Icon className="size-4" /></span>
              <span className="flex-1 truncate text-sm capitalize">{r.name.toLowerCase()}</span>
              <span className={`text-xs font-bold ${up ? "text-destructive" : "text-c3"}`}>{up ? "▲" : "▼"}{Math.abs(r.deltaPct ?? 0).toFixed(0)}%</span>
              <span className="text-sm font-bold tabular-nums">{formatCurrency(r.total)}</span>
            </Link>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write recent activity**

```tsx
"use client";

import { useMemo } from "react";
import { useTransactions } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";

export function RecentActivityCard() {
  const txns = useTransactions();
  const recent = useMemo(
    () => [...(txns.data ?? [])].sort((a, b) => b.txn_date.localeCompare(a.txn_date)).slice(0, 5),
    [txns.data],
  );
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card" data-testid="recent-activity-card">
      <b className="text-sm">Recent activity</b>
      <div className="mt-2 space-y-1">
        {recent.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-1.5">
            <span className="flex-1 truncate text-sm">{t.merchant ?? "Unknown"}<span className="block text-[11px] text-muted">{t.txn_date}</span></span>
            <span className="text-sm font-bold tabular-nums">{formatCurrency(Number(t.amount), { currency: t.currency })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/components/dashboard/top-movers-card.tsx web/components/dashboard/recent-activity-card.tsx
git commit -m "feat(home): add top movers and recent activity cards"
```

---

### Task 3: Assemble the command center + fix charts

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Write the failing e2e test**

`web/e2e/home.spec.ts` (copy signup/authenticate helpers from `web/e2e/spend.spec.ts`):

```ts
// …helpers copied…
test.describe("home command center", () => {
  test("renders the bento cards", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await expect(page.getByTestId("budget-status-card")).toBeVisible();
    await expect(page.getByTestId("top-movers-card")).toBeVisible();
    await expect(page.getByTestId("recent-activity-card")).toBeVisible();
    await expect(page.getByText(/net cash flow/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd web && npx playwright test e2e/home.spec.ts`
Expected: FAIL — new cards not present.

- [ ] **Step 3: Rebuild the dashboard layout**

Modify `web/app/(app)/dashboard/page.tsx`. Keep the existing `HeroCard` (net cash flow) and the data computation, but:
1. Guard the series so charts never get NaN/empty (the "broken graph" fix):

```tsx
const series = points.map((p) => p.net).filter((n) => Number.isFinite(n));
// pass `series={series.length > 1 ? series : undefined}` to HeroCard
```

2. Replace the lower half (the feature cards + stat rows + "Top spending" block) with a bento grid:

```tsx
import { NetWorthCard } from "@/components/insights/net-worth-card";
import { BudgetStatusCard } from "@/components/dashboard/budget-status-card";
import { TopMoversCard } from "@/components/dashboard/top-movers-card";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";

// …in the main return, after <HeroCard/>:
<div className="grid gap-3 lg:grid-cols-2">
  <NetWorthCard />
  <BudgetStatusCard />
  <TopMoversCard />
  <RecentActivityCard />
</div>
<div className="grid grid-cols-2 gap-3">
  <FeatureCard icon={Sparkles} title="Ask your money" href="/guidance" variant="ai" />
  <FeatureCard icon={Globe} title="Send abroad" href="/guidance" variant="xb" />
</div>
```

Keep `HeroCard` showing net cash flow (the test asserts `/net cash flow/i`). Remove the now-redundant income/spending/savings `StatRow` block and the old "Top spending" `CategoryRow` block (top movers + Spend tab supersede them). Keep the `goals`, `isError`, `loading`, and `!hasData` branches intact.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd web && npx playwright test e2e/home.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + regression**

Run: `cd web && npm run typecheck && npm run lint && npx playwright test e2e/redesign-surfaces.spec.ts`
Expected: green. `redesign-surfaces.spec.ts` asserts `dashboard shows the hero net cash flow` — preserved.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/dashboard/page.tsx" web/e2e/home.spec.ts
git commit -m "feat(home): bento command center, guard broken charts"
```

---

## Self-Review

**Spec coverage (Home):**
- Net worth tile → Task 3 (reuses `NetWorthCard`). ✓
- This-month cash flow → existing `HeroCard`, kept + chart guarded. ✓
- Budget status → Task 1. ✓
- Top movers / alerts → Task 2 (top movers; alert feed lives in Activity, Plan 5). ✓
- Recent activity → Task 2. ✓
- Quick actions (+Add / Ask) → +Add is in the top bar (Plan 1); "Ask your money" FeatureCard kept in Task 3. ✓
- Fix broken charts → Task 3 Step 3 (finite-series guard). ✓

**Placeholder scan:** No TBD/TODO. Field-name adaptation notes (budgets schema) are concrete conditionals.

**Type consistency:** Reuses `categoryRowsWithDeltas` / `CatRow` (Plan 2) and `NetWorthCard` (Plan 3) with their defined signatures. New cards take no props.

**Cross-plan dependency:** Imports from Plan 2 (`@/lib/spend/derive`) and Plan 3 (`@/components/insights/net-worth-card`). Sequence Home after Plans 2–3.
