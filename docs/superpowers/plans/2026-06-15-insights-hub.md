# Insights Big-Picture Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe Insights from a confusing raw breakdown table into a clear big-picture hub: an Overview sub-tab (Net worth placeholder + Cash-flow Sankey + section summaries) plus the existing Budgets / Debt / Income sections, each opening with a plain-language explanation. Spending depth now lives in Spend, so Insights drops the per-category table.

**Architecture:** Insights is already a multi-route surface (`/analytics`, `/budgets`, `/debt`, `/income`) sharing top tabs in `web/lib/shell/nav.ts`. We add an Overview as the `/analytics` landing (replacing the breakdown table), built from `useTimeseries` + `useBreakdown` (already available). The Sankey uses recharts' `Sankey` (recharts 2.15 is installed — no new dep). Net worth is a labeled placeholder component wired to a future endpoint (deferred per spec). Depends on Plan 1.

**Tech Stack:** Next.js, React, TypeScript, TanStack Query, recharts (`Sankey`), Tailwind, Playwright e2e.

**Testing note:** No unit runner — validated via Playwright e2e against the seeded demo household.

---

## File Structure

- **Create** `web/components/insights/net-worth-card.tsx` — labeled "coming soon" net-worth tile (no fake numbers).
- **Create** `web/components/insights/cash-flow-sankey.tsx` — recharts Sankey (income → categories → savings).
- **Create** `web/components/insights/cash-flow-sankey-impl.tsx` — client-only recharts impl.
- **Create** `web/lib/insights/sankey.ts` — pure: build Sankey nodes/links from timeseries + breakdown.
- **Create** `web/components/insights/section-intro.tsx` — one-line plain-language header used atop every Insights section.
- **Modify** `web/app/(app)/analytics/page.tsx` — replace the breakdown table with the Overview (net worth + Sankey + section links).
- **Modify** `web/app/(app)/budgets/page.tsx`, `web/app/(app)/debt/page.tsx`, `web/app/(app)/income/page.tsx` — prepend a `<SectionIntro/>`.
- **Modify** `web/lib/shell/nav.ts` — rename the Insights top tab `Analytics` → `Overview`.
- **Create** `web/e2e/insights.spec.ts`.

---

### Task 1: Net worth placeholder card

**Files:**
- Create: `web/components/insights/net-worth-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { TrendingUp } from "@/lib/icons";

export function NetWorthCard() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-5 shadow-card" data-testid="net-worth-card">
      <div className="flex items-center gap-2 text-muted">
        <TrendingUp className="size-4" />
        <span className="text-[11px] font-bold uppercase tracking-wide">Net worth</span>
      </div>
      <p className="mt-2 text-2xl font-extrabold tracking-tight text-muted">Coming soon</p>
      <p className="mt-1 text-sm text-muted">
        Connect accounts to track assets and liabilities over time. We don&apos;t show a number until the data is real.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors (`TrendingUp` is exported from lucide; add to `lib/icons.ts` if missing).

- [ ] **Step 3: Commit**

```bash
git add web/components/insights/net-worth-card.tsx web/lib/icons.ts
git commit -m "feat(insights): add net worth placeholder card"
```

---

### Task 2: Sankey data builder

**Files:**
- Create: `web/lib/insights/sankey.ts`

- [ ] **Step 1: Write the builder**

```ts
type BreakdownRow = { dimensions?: Record<string, string | null>; total?: unknown };

export type SankeyData = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

/**
 * Income → (single "Spending" hub) → top category buckets, plus Income → Savings.
 * `income` and `categoryRows` come from the analytics endpoints. Returns recharts
 * Sankey-shaped node/link arrays. Categories beyond `topN` fold into "Other".
 */
export function buildCashFlowSankey(
  income: number,
  categoryRows: BreakdownRow[],
  topN = 6,
): SankeyData {
  const cats = categoryRows
    .map((r) => ({ name: r.dimensions?.category ?? "Uncategorized", total: Number(r.total ?? 0) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  const head = cats.slice(0, topN);
  const otherTotal = cats.slice(topN).reduce((a, c) => a + c.total, 0);
  const buckets = otherTotal > 0 ? [...head, { name: "Other", total: otherTotal }] : head;

  const spend = buckets.reduce((a, c) => a + c.total, 0);
  const savings = Math.max(0, income - spend);

  const nodes = [{ name: "Income" }, { name: "Spending" }, { name: "Savings" }, ...buckets.map((b) => ({ name: b.name }))];
  const links = [
    { source: 0, target: 1, value: spend },
    ...(savings > 0 ? [{ source: 0, target: 2, value: savings }] : []),
    ...buckets.map((b, i) => ({ source: 1, target: 3 + i, value: b.total })),
  ];
  return { nodes, links };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/lib/insights/sankey.ts
git commit -m "feat(insights): add cash-flow Sankey data builder"
```

---

### Task 3: Sankey component (recharts)

**Files:**
- Create: `web/components/insights/cash-flow-sankey.tsx`
- Create: `web/components/insights/cash-flow-sankey-impl.tsx`

- [ ] **Step 1: Write the dynamic wrapper**

`web/components/insights/cash-flow-sankey.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import type { SankeyData } from "@/lib/insights/sankey";

const Impl = dynamic(() => import("./cash-flow-sankey-impl").then((m) => m.CashFlowSankeyImpl), {
  ssr: false,
  loading: () => <div className="h-[260px] w-full animate-pulse rounded-2xl bg-chip" />,
});

export function CashFlowSankey({ data }: { data: SankeyData }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card" data-testid="cash-flow-sankey">
      <b className="text-sm">Cash flow</b>
      <p className="mb-2 text-xs text-muted">Where your income went this period — income in, spending and savings out.</p>
      {data.links.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Not enough data yet.</p>
      ) : (
        <Impl data={data} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the recharts impl**

`web/components/insights/cash-flow-sankey-impl.tsx`:

```tsx
"use client";

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import type { SankeyData } from "@/lib/insights/sankey";

export function CashFlowSankeyImpl({ data }: { data: SankeyData }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <Sankey
        data={data}
        nodePadding={24}
        link={{ stroke: "#c0b6f5" }}
        node={{ fill: "#6c5ce7" }}
        margin={{ top: 8, bottom: 8, left: 0, right: 80 }}
      >
        <Tooltip />
      </Sankey>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors. If recharts' `Sankey` typing rejects the `node`/`link` props, pass them as `node={{}}`/omit and style via defaults — the data prop is the contract that matters.

- [ ] **Step 4: Commit**

```bash
git add web/components/insights/cash-flow-sankey.tsx web/components/insights/cash-flow-sankey-impl.tsx
git commit -m "feat(insights): add cash-flow Sankey chart"
```

---

### Task 4: Section intro + apply to budgets/debt/income

**Files:**
- Create: `web/components/insights/section-intro.tsx`
- Modify: `web/app/(app)/budgets/page.tsx`, `web/app/(app)/debt/page.tsx`, `web/app/(app)/income/page.tsx`

- [ ] **Step 1: Write the intro component**

`web/components/insights/section-intro.tsx`:

```tsx
export function SectionIntro({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-3" data-testid="section-intro">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <p className="text-sm text-muted">{blurb}</p>
    </div>
  );
}
```

- [ ] **Step 2: Prepend it on each section page**

In `web/app/(app)/budgets/page.tsx`, import and render at the top of the returned root container:

```tsx
import { SectionIntro } from "@/components/insights/section-intro";
// …first child inside the page's root <div>:
<SectionIntro title="Budgets" blurb="How your spending tracks against the limits you set, this period." />
```

Repeat with appropriate copy:
- `debt/page.tsx`: `title="Debt"`, `blurb="Balances, payoff timelines, and what extra payments would do."`
- `income/page.tsx`: `title="Income"`, `blurb="Your income sources and take-home, including equity."`

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/components/insights/section-intro.tsx "web/app/(app)/budgets/page.tsx" "web/app/(app)/debt/page.tsx" "web/app/(app)/income/page.tsx"
git commit -m "feat(insights): add plain-language section intros"
```

---

### Task 5: Build the Overview (replace breakdown table)

**Files:**
- Modify: `web/app/(app)/analytics/page.tsx`
- Modify: `web/lib/shell/nav.ts` (rename `Analytics` tab → `Overview`)

- [ ] **Step 1: Write the failing e2e test**

`web/e2e/insights.spec.ts` (copy signup/authenticate helpers from `web/e2e/spend.spec.ts`):

```ts
// …helpers omitted for brevity — copy from spend.spec.ts…
test.describe("insights overview", () => {
  test("shows net worth card and cash-flow sankey", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/analytics");
    await expect(page.getByTestId("net-worth-card")).toBeVisible();
    await expect(page.getByTestId("cash-flow-sankey")).toBeVisible();
  });

  test("budgets section has a plain-language intro", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/budgets");
    await expect(page.getByTestId("section-intro")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd web && npx playwright test e2e/insights.spec.ts`
Expected: FAIL — overview not built yet.

- [ ] **Step 3: Rewrite the analytics page as the Overview**

Replace `web/app/(app)/analytics/page.tsx` body so it renders the big-picture overview (drop the dimension-picker breakdown table — that depth now lives in Spend):

```tsx
"use client";

import { useMemo } from "react";
import { useBreakdown, useTimeseries } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { buildCashFlowSankey } from "@/lib/insights/sankey";
import { NetWorthCard } from "@/components/insights/net-worth-card";
import { CashFlowSankey } from "@/components/insights/cash-flow-sankey";
import { SectionIntro } from "@/components/insights/section-intro";
import { SpendOverTime } from "@/components/spend/spend-over-time";

const num = (v: unknown) => Number(v ?? 0);

export default function InsightsOverviewPage() {
  const range = useMemo(() => presetRange("6m"), []);
  const ts = useTimeseries(range);
  const breakdown = useBreakdown(range, "category");

  const income = useMemo(
    () => (ts.data?.points ?? []).reduce((a, p) => a + num(p.income), 0),
    [ts.data],
  );
  const sankey = useMemo(
    () => buildCashFlowSankey(income, (breakdown.data?.rows ?? []) as never[]),
    [income, breakdown.data],
  );
  const points = useMemo(
    () => (ts.data?.points ?? []).map((p) => ({ label: p.period, value: num(p.net) })),
    [ts.data],
  );

  return (
    <div className="space-y-4">
      <SectionIntro title="The big picture" blurb="Net worth, cash flow, and how the pieces fit — spending detail lives in the Spend tab." />
      <div className="grid gap-4 lg:grid-cols-2">
        <NetWorthCard />
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <b className="text-sm">Net cash flow</b>
          <p className="mb-2 text-xs text-muted">Income minus spending, by month.</p>
          <SpendOverTime points={points} />
        </div>
      </div>
      <CashFlowSankey data={sankey} />
    </div>
  );
}
```

(`SpendOverTime` is reused here as a generic monthly line; if you prefer, inline `AreaChart` directly. It's labeled "Net cash flow" so the reuse reads correctly.)

- [ ] **Step 4: Rename the Insights tab**

In `web/lib/shell/nav.ts`, in `INSIGHTS_TABS`, change `{ label: "Analytics", href: "/analytics" }` to `{ label: "Overview", href: "/analytics" }`.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd web && npx playwright test e2e/insights.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + lint + regression**

Run: `cd web && npm run typecheck && npm run lint && npx playwright test e2e/redesign-surfaces.spec.ts`
Expected: all green. Note: `redesign-surfaces.spec.ts` may assert the old "Analytics" tab label — if so, update that assertion to "Overview" (the rename is intended).

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/analytics/page.tsx" web/lib/shell/nav.ts web/e2e/insights.spec.ts
git commit -m "feat(insights): replace breakdown table with big-picture overview"
```

---

## Self-Review

**Spec coverage (Insights surface):**
- Net worth (deferred placeholder, no fake number) → Task 1. ✓
- Cash-flow Sankey (income→spend→save) → Tasks 2, 3, 5. ✓
- Budgets / Debt / Income kept as sections with plain-language intros → Task 4. ✓
- Recurring/subscriptions → deferred (no endpoint; spec lists it as a risk) — explicitly out of this plan.
- Drop raw per-category table (depth moved to Spend) → Task 5 Step 3. ✓

**Placeholder scan:** No TBD/TODO. "Coming soon" net-worth copy is the intended product state, not an unfinished step. Recurring deferral is an explicit scope cut.

**Type consistency:** `SankeyData` defined in Task 2, consumed in Tasks 3, 5. `buildCashFlowSankey(income, rows, topN?)` signature consistent. `SectionIntro` props (`title`, `blurb`) consistent across Tasks 4, 5. Reuses `SpendOverTime` (Plan 2) — this plan therefore lands after Plan 2.

**Cross-plan dependency:** Task 5 imports `@/components/spend/spend-over-time` from Plan 2. Sequence Insights after Spend, or inline `AreaChart` to decouple (noted in Step 3).
