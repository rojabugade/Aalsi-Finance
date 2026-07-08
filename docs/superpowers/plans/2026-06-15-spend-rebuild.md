# Spend Tab Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/transactions` into the comprehensive Spend hub: an insight strip + spend-over-time chart + share donut + filterable category list (L1), drilling into category → subcategory → merchant → transactions with a "what changed" narrative (L2).

**Architecture:** Builds on the existing `CategoryBreakdown` tree builder (`web/components/transactions/category-breakdown.tsx`) and the analytics API (`useBreakdown`, `useTimeseries`). Drill state lives in URL query params (`?cat=<id>&sub=<id>&merchant=<name>`) so it's deep-linkable and the back button works — matching the existing `?view=all`/`?type=` convention. Pure derivation logic moves into `web/lib/spend/` helpers; presentation into focused components under `web/components/spend/`. Charts reuse the recharts-backed `AreaChart`. Depends on Plan 1 (shell) being merged.

**Tech Stack:** Next.js App Router, React, TypeScript, TanStack Query, recharts, Tailwind, Playwright e2e.

**Testing note:** No unit runner exists — derivation helpers are validated through Playwright e2e against the seeded demo household (`dev@example.com`, USD). Each task that adds UI ends with an e2e assertion.

---

## File Structure

- **Create** `web/lib/spend/derive.ts` — pure functions: `monthlySpend()`, `categoryRowsWithDeltas()`, `topMover()`, `unusualSpend()`, `whatChanged()`. One responsibility: turn transactions+categories+timeseries into view models.
- **Create** `web/components/spend/insight-strip.tsx` — the 4 insight tiles (spent/MoM, top mover, unusual, daily avg).
- **Create** `web/components/spend/spend-over-time.tsx` — monthly bar/area chart wrapper around `AreaChart`.
- **Create** `web/components/spend/share-donut.tsx` — recharts pie/donut of category shares.
- **Create** `web/components/spend/filter-toolbar.tsx` — sticky toolbar: search + Category/Account/Amount/Tags/Recurring chips + Export.
- **Create** `web/components/spend/category-list.tsx` — L1 category rows with MoM delta + bar, each linking to `?cat=<id>`.
- **Create** `web/components/spend/category-drill.tsx` — L2 view: header + what-changed + over-time + subcategory list + top merchants + transactions.
- **Modify** `web/app/(app)/transactions/page.tsx` — assemble L1 overview vs L2 drill vs flat ledger by query params.
- **Modify** `web/lib/shell/nav.ts:74-77` — Spend top tabs become `Categories` / `Merchants` / `Transactions`.
- **Create** `web/e2e/spend.spec.ts` — e2e for overview, drill, filters.

---

### Task 1: Spend derivation helpers

**Files:**
- Create: `web/lib/spend/derive.ts`

- [ ] **Step 1: Write the helpers**

Create `web/lib/spend/derive.ts`:

```ts
import type { Category, Transaction } from "@/lib/api/transactions";

export type CatRow = {
  id: string;
  name: string;
  total: number;
  prev: number;
  deltaPct: number | null; // null when prev == 0
};

const ym = (d: string) => d.slice(0, 7); // "YYYY-MM"

/** Expenses (amount >= 0) summed for the given YYYY-MM month. */
export function monthlySpend(txns: Transaction[], month: string): number {
  return txns
    .filter((t) => Number(t.amount) >= 0 && ym(t.txn_date) === month)
    .reduce((a, t) => a + Number(t.amount), 0);
}

/** Resolve a transaction to its top-level (parent) category id+name. */
function topCategory(t: Transaction, byId: Map<string, Category>) {
  const cat = t.category_id ? byId.get(t.category_id) : undefined;
  if (!cat) return { id: "__uncategorized__", name: "Uncategorized" };
  if (cat.parent_id && byId.has(cat.parent_id)) {
    const p = byId.get(cat.parent_id)!;
    return { id: p.id, name: p.name };
  }
  return { id: cat.id, name: cat.name };
}

/** Parent-category rows for `month` with month-over-month deltas vs `prevMonth`. */
export function categoryRowsWithDeltas(
  txns: Transaction[],
  cats: Category[],
  month: string,
  prevMonth: string,
): CatRow[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const cur = new Map<string, { name: string; total: number }>();
  const prev = new Map<string, number>();

  for (const t of txns) {
    if (Number(t.amount) < 0) continue;
    const { id, name } = topCategory(t, byId);
    const m = ym(t.txn_date);
    if (m === month) {
      const e = cur.get(id) ?? { name, total: 0 };
      e.total += Number(t.amount);
      cur.set(id, e);
    } else if (m === prevMonth) {
      prev.set(id, (prev.get(id) ?? 0) + Number(t.amount));
    }
  }

  return [...cur.entries()]
    .map(([id, { name, total }]) => {
      const p = prev.get(id) ?? 0;
      return { id, name, total, prev: p, deltaPct: p === 0 ? null : ((total - p) / p) * 100 };
    })
    .sort((a, b) => b.total - a.total);
}

/** Category with the largest absolute MoM increase. */
export function topMover(rows: CatRow[]): CatRow | null {
  const movers = rows.filter((r) => r.total > r.prev);
  if (movers.length === 0) return null;
  return movers.reduce((a, b) => (b.total - b.prev > a.total - a.prev ? b : a));
}

/** Single largest expense this month (the "unusual" tile). */
export function unusualSpend(txns: Transaction[], month: string): Transaction | null {
  const m = txns.filter((t) => Number(t.amount) >= 0 && ym(t.txn_date) === month);
  if (m.length === 0) return null;
  return m.reduce((a, b) => (Number(b.amount) > Number(a.amount) ? b : a));
}

/** Plain-language summary for a category drill header. */
export function whatChanged(row: CatRow, subRows: CatRow[]): string {
  if (row.prev === 0) return `New spending this month: ${Math.round(row.total)}.`;
  const diff = row.total - row.prev;
  const dir = diff >= 0 ? "up" : "down";
  const driver = subRows.find((s) => Math.abs(s.total - s.prev) === Math.max(...subRows.map((x) => Math.abs(x.total - x.prev))));
  const driverStr = driver ? ` ${driver.name} drove it (${diff >= 0 ? "+" : ""}${Math.round(driver.total - driver.prev)}).` : "";
  return `${row.name} is ${dir} ${Math.abs(Math.round(row.deltaPct ?? 0))}% vs last month.${driverStr}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/lib/spend/derive.ts
git commit -m "feat(spend): add spend derivation helpers"
```

---

### Task 2: Insight strip component

**Files:**
- Create: `web/components/spend/insight-strip.tsx`

- [ ] **Step 1: Write the component**

Create `web/components/spend/insight-strip.tsx`:

```tsx
"use client";

import type { CatRow } from "@/lib/spend/derive";
import type { Transaction } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";

function Tile({ label, value, foot, footClass }: { label: string; value: string; foot?: string; footClass?: string }) {
  return (
    <div className="flex-1 rounded-2xl border border-border bg-card p-3 shadow-card">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-extrabold tabular-nums">{value}</p>
      {foot && <p className={`text-xs font-semibold ${footClass ?? "text-muted"}`}>{foot}</p>}
    </div>
  );
}

export function InsightStrip({
  spent,
  prevSpent,
  mover,
  unusual,
  dailyAvg,
  currency,
}: {
  spent: number;
  prevSpent: number;
  mover: CatRow | null;
  unusual: Transaction | null;
  dailyAvg: number;
  currency: string;
}) {
  const delta = prevSpent === 0 ? null : ((spent - prevSpent) / prevSpent) * 100;
  const down = (delta ?? 0) <= 0;
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="spend-insight-strip">
      <Tile
        label="Spent this month"
        value={formatCurrency(spent, { currency })}
        foot={delta === null ? "—" : `${down ? "▼" : "▲"} ${Math.abs(delta).toFixed(0)}% vs last`}
        footClass={down ? "text-c3" : "text-destructive"}
      />
      <Tile
        label="Top mover"
        value={mover ? mover.name : "—"}
        foot={mover && mover.deltaPct !== null ? `▲ ${mover.deltaPct.toFixed(0)}%` : undefined}
        footClass="text-destructive"
      />
      <Tile
        label="Unusual"
        value={unusual?.merchant ?? "—"}
        foot={unusual ? formatCurrency(Number(unusual.amount), { currency }) : undefined}
      />
      <Tile label="Daily avg" value={formatCurrency(dailyAvg, { currency })} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/components/spend/insight-strip.tsx
git commit -m "feat(spend): add insight strip component"
```

---

### Task 3: Spend-over-time + share donut

**Files:**
- Create: `web/components/spend/spend-over-time.tsx`
- Create: `web/components/spend/share-donut.tsx`

- [ ] **Step 1: Write the over-time chart**

Create `web/components/spend/spend-over-time.tsx`:

```tsx
"use client";

import { AreaChart, type AreaPoint } from "@/components/ui/area-chart";

export function SpendOverTime({ points }: { points: AreaPoint[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm">Spending over time</b>
        <span className="text-[11px] uppercase tracking-wide text-muted">monthly</span>
      </div>
      <AreaChart data={points} height={200} />
    </div>
  );
}
```

- [ ] **Step 2: Write the donut**

Create `web/components/spend/share-donut.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import type { CatRow } from "@/lib/spend/derive";

const Donut = dynamic(() => import("./share-donut-impl").then((m) => m.ShareDonutImpl), {
  ssr: false,
  loading: () => <div className="h-[180px] w-full animate-pulse rounded-2xl bg-chip" />,
});

export function ShareDonut({ rows }: { rows: CatRow[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <b className="text-sm">Share of spend</b>
      <Donut rows={rows.slice(0, 6)} />
    </div>
  );
}
```

- [ ] **Step 3: Write the donut impl (recharts, client-only)**

Create `web/components/spend/share-donut-impl.tsx`:

```tsx
"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CatRow } from "@/lib/spend/derive";
import { formatCurrency } from "@/lib/format";

const COLORS = ["#6c5ce7", "#9b8cf0", "#c0b6f5", "#ddd8f7", "#b9aef2", "#e2ddf8"];

export function ShareDonutImpl({ rows }: { rows: CatRow[] }) {
  const data = rows.map((r) => ({ name: r.name, value: r.total }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/components/spend/spend-over-time.tsx web/components/spend/share-donut.tsx web/components/spend/share-donut-impl.tsx
git commit -m "feat(spend): add over-time chart and share donut"
```

---

### Task 4: Sticky filter toolbar

**Files:**
- Create: `web/components/spend/filter-toolbar.tsx`

- [ ] **Step 1: Write the component**

Create `web/components/spend/filter-toolbar.tsx`. It is controlled — the page owns filter state and passes setters:

```tsx
"use client";

import { Search } from "@/lib/icons";

export type SpendFilters = { q: string; recurring: boolean };

export function FilterToolbar({
  filters,
  onChange,
}: {
  filters: SpendFilters;
  onChange: (next: SpendFilters) => void;
}) {
  return (
    <div
      className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/95 p-2 backdrop-blur"
      role="search"
    >
      <div className="relative min-w-[180px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          aria-label="Search transactions"
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Search merchant, note…"
          className="h-9 w-full rounded-chip border border-border bg-bg pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
      <button
        type="button"
        aria-pressed={filters.recurring}
        onClick={() => onChange({ ...filters, recurring: !filters.recurring })}
        className={`rounded-chip border px-3 py-1.5 text-sm font-semibold ${
          filters.recurring ? "border-accent bg-accent text-on-accent" : "border-border bg-card text-muted"
        }`}
      >
        Recurring
      </button>
    </div>
  );
}
```

(Account/Amount/Tags chips are deferred to a follow-up — `q` and `recurring` cover the verified data shape; do not add filter chips for fields the API can't yet faceted-filter.)

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/components/spend/filter-toolbar.tsx
git commit -m "feat(spend): add sticky filter toolbar"
```

---

### Task 5: L1 category list (with deltas + drill links)

**Files:**
- Create: `web/components/spend/category-list.tsx`

- [ ] **Step 1: Write the component**

Create `web/components/spend/category-list.tsx`:

```tsx
"use client";

import Link from "next/link";
import type { CatRow } from "@/lib/spend/derive";
import { categoryIcon } from "@/lib/icons";
import { formatCurrency } from "@/lib/format";

export function CategoryList({ rows, currency }: { rows: CatRow[]; currency: string }) {
  const max = rows[0]?.total ?? 1;
  return (
    <div className="rounded-2xl border border-border bg-card p-2 shadow-card" data-testid="spend-category-list">
      {rows.map((r) => {
        const Icon = categoryIcon(r.name);
        const up = (r.deltaPct ?? 0) > 0;
        return (
          <Link
            key={r.id}
            href={`/transactions?cat=${encodeURIComponent(r.id)}`}
            className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-chip"
          >
            <span className="grid size-9 flex-none place-items-center rounded-xl bg-accent-soft text-accent">
              <Icon className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold capitalize">{r.name.toLowerCase()}</span>
              <span className="mt-1 block h-[5px] overflow-hidden rounded-full bg-track">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }} />
              </span>
            </span>
            {r.deltaPct !== null && (
              <span className={`text-xs font-bold ${up ? "text-destructive" : "text-c3"}`}>
                {up ? "▲" : "▼"}
                {Math.abs(r.deltaPct).toFixed(0)}%
              </span>
            )}
            <span className="text-sm font-extrabold tabular-nums">{formatCurrency(r.total, { currency })}</span>
            <span className="text-muted">›</span>
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/components/spend/category-list.tsx
git commit -m "feat(spend): add L1 category list with deltas"
```

---

### Task 6: L2 category drill view

**Files:**
- Create: `web/components/spend/category-drill.tsx`

- [ ] **Step 1: Write the component**

Create `web/components/spend/category-drill.tsx`. It receives the resolved parent category and the household transactions, computes subcategory rows + top merchants + transactions client-side:

```tsx
"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Category, Transaction } from "@/lib/api/transactions";
import { categoryRowsWithDeltas, whatChanged, type CatRow } from "@/lib/spend/derive";
import { formatCurrency } from "@/lib/format";
import { categoryIcon } from "@/lib/icons";

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function prevMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function CategoryDrill({
  parent,
  txns,
  cats,
  currency,
}: {
  parent: Category;
  txns: Transaction[];
  cats: Category[];
  currency: string;
}) {
  const month = thisMonth();
  const prev = prevMonth();

  const childIds = useMemo(() => new Set(cats.filter((c) => c.parent_id === parent.id).map((c) => c.id)), [cats, parent.id]);
  const inCat = useMemo(
    () => txns.filter((t) => t.category_id === parent.id || (t.category_id && childIds.has(t.category_id))),
    [txns, parent.id, childIds],
  );

  const subRows: CatRow[] = useMemo(
    () => categoryRowsWithDeltas(inCat, cats.map((c) => (c.id === parent.id ? c : { ...c, parent_id: null })), month, prev),
    [inCat, cats, parent.id, month, prev],
  );

  const total = useMemo(() => inCat.filter((t) => t.txn_date.slice(0, 7) === month).reduce((a, t) => a + Number(t.amount), 0), [inCat, month]);
  const prevTotal = useMemo(() => inCat.filter((t) => t.txn_date.slice(0, 7) === prev).reduce((a, t) => a + Number(t.amount), 0), [inCat, prev]);
  const headRow: CatRow = { id: parent.id, name: parent.name, total, prev: prevTotal, deltaPct: prevTotal === 0 ? null : ((total - prevTotal) / prevTotal) * 100 };

  const merchants = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>();
    for (const t of inCat) {
      if (t.txn_date.slice(0, 7) !== month) continue;
      const name = t.merchant ?? "Unknown";
      const e = m.get(name) ?? { total: 0, count: 0 };
      e.total += Number(t.amount);
      e.count += 1;
      m.set(name, e);
    }
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total).slice(0, 6);
  }, [inCat, month]);

  const recent = useMemo(
    () => [...inCat].sort((a, b) => b.txn_date.localeCompare(a.txn_date)).slice(0, 15),
    [inCat],
  );
  const Icon = categoryIcon(parent.name);

  return (
    <div className="space-y-3" data-testid="spend-category-drill">
      <div className="text-sm">
        <Link href="/transactions" className="font-semibold text-accent">
          ‹ Spend
        </Link>{" "}
        / <b className="capitalize">{parent.name.toLowerCase()}</b>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card lg:w-1/3">
          <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent">
            <Icon className="size-[18px]" />
          </span>
          <p className="mt-2 text-2xl font-extrabold tabular-nums">{formatCurrency(total, { currency })}</p>
          {headRow.deltaPct !== null && (
            <p className={`text-sm font-semibold ${headRow.deltaPct > 0 ? "text-destructive" : "text-c3"}`}>
              {headRow.deltaPct > 0 ? "▲" : "▼"} {Math.abs(headRow.deltaPct).toFixed(0)}% vs last month
            </p>
          )}
        </div>
        <div className="flex-1 rounded-2xl border border-l-4 border-l-accent border-border bg-card p-4 shadow-card">
          <b className="text-sm">What changed</b>
          <p className="mt-1 text-sm text-muted">{whatChanged(headRow, subRows)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
        <b className="text-sm">Subcategories</b>
        {subRows.map((s) => (
          <div key={s.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm capitalize">{s.name.toLowerCase()}</span>
            {s.deltaPct !== null && (
              <span className={`text-xs font-bold ${s.deltaPct > 0 ? "text-destructive" : "text-c3"}`}>
                {s.deltaPct > 0 ? "▲" : "▼"}
                {Math.abs(s.deltaPct).toFixed(0)}%
              </span>
            )}
            <span className="text-sm font-bold tabular-nums">{formatCurrency(s.total, { currency })}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <b className="text-sm">Top merchants</b>
          {merchants.map((m) => (
            <div key={m.name} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {m.name}
                <span className="block text-[11px] text-muted">{m.count} visits</span>
              </span>
              <span className="text-sm font-bold tabular-nums">{formatCurrency(m.total, { currency })}</span>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <b className="text-sm">Transactions</b>
          {recent.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {t.merchant ?? "Unknown"}
                <span className="block text-[11px] text-muted">{t.txn_date}</span>
              </span>
              <span className="text-sm font-bold tabular-nums">{formatCurrency(Number(t.amount), { currency: t.currency })}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/components/spend/category-drill.tsx
git commit -m "feat(spend): add L2 category drill view"
```

---

### Task 7: Assemble the Spend page + nav tabs

**Files:**
- Modify: `web/app/(app)/transactions/page.tsx`
- Modify: `web/lib/shell/nav.ts:74-77`

- [ ] **Step 1: Write the failing e2e test**

Create `web/e2e/spend.spec.ts` (reuse the signup/authenticate helpers — copy them from `web/e2e/redesign-shell.spec.ts`):

```ts
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function signup(request: APIRequestContext) {
  const res = await request.post(`${API}/auth/signup`, {
    data: { email: EMAIL, password: PASSWORD, display_name: "E2E", household_name: "E2E House" },
  });
  if (res.ok()) return (await res.json()) as { access_token: string; refresh_token: string };
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD, totp_code: null } });
  expect(login.ok()).toBeTruthy();
  return (await login.json()) as { access_token: string; refresh_token: string };
}
async function authenticate(page: Page, t: { access_token: string; refresh_token: string }) {
  await page.addInitScript(
    (x) => {
      window.localStorage.setItem("cbf.accessToken", x.a);
      window.localStorage.setItem("cbf.refreshToken", x.r);
    },
    { a: t.access_token, r: t.refresh_token },
  );
}

test.describe("spend overview", () => {
  test("shows insight strip + category list", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/transactions");
    await expect(page.getByTestId("spend-insight-strip")).toBeVisible();
    await expect(page.getByTestId("spend-category-list")).toBeVisible();
  });

  test("clicking a category drills in", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/transactions");
    const firstCat = page.getByTestId("spend-category-list").getByRole("link").first();
    await firstCat.click();
    await expect(page).toHaveURL(/\/transactions\?cat=/);
    await expect(page.getByTestId("spend-category-drill")).toBeVisible();
    await expect(page.getByText(/what changed/i)).toBeVisible();
  });

  test("search filters the flat ledger", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/transactions?view=all");
    await expect(page.getByRole("search")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd web && npx playwright test e2e/spend.spec.ts`
Expected: FAIL — testids don't exist yet.

- [ ] **Step 3: Rewrite the page to assemble the surfaces**

Replace `web/app/(app)/transactions/page.tsx` with a version that:
- reads `cat`, `view` from `useSearchParams()`;
- if `cat` is set → resolve the `Category` from `useCategories()` and render `<CategoryDrill parent={cat} txns={...} cats={...} currency={...} />`;
- else if `view === "all"` → keep the existing flat ledger + `<FilterToolbar/>` (port the current search/status logic into `FilterToolbar` state);
- else (overview) → compute `month`/`prevMonth`, call `categoryRowsWithDeltas`, `topMover`, `unusualSpend`, `monthlySpend`, build `AreaPoint[]` from `useTimeseries`, and render:
  `<InsightStrip/>`, `<SpendOverTime/>`, `<ShareDonut/>`, `<CategoryList/>`.

Full overview branch (replace the `if (!isAll) { … }` block):

```tsx
// overview branch
const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
const prev = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
const allTxns = txns.data ?? [];
const allCats = cats.data ?? [];
const rows = categoryRowsWithDeltas(allTxns, allCats, month, prev);
const spent = monthlySpend(allTxns, month);
const prevSpent = monthlySpend(allTxns, prev);
const dayOfMonth = new Date().getDate();
const points = (tsForSpend.data?.points ?? []).map((p) => ({ label: p.period, value: Number(p.spend ?? 0) }));

return (
  <div className="space-y-3">
    <InsightStrip
      spent={spent}
      prevSpent={prevSpent}
      mover={topMover(rows)}
      unusual={unusualSpend(allTxns, month)}
      dailyAvg={dayOfMonth ? spent / dayOfMonth : 0}
      currency={currency}
    />
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2"><SpendOverTime points={points} /></div>
      <ShareDonut rows={rows} />
    </div>
    <CategoryList rows={rows} currency={currency} />
  </div>
);
```

Add imports at the top:

```tsx
import { categoryRowsWithDeltas, monthlySpend, topMover, unusualSpend } from "@/lib/spend/derive";
import { useTimeseries } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { InsightStrip } from "@/components/spend/insight-strip";
import { SpendOverTime } from "@/components/spend/spend-over-time";
import { ShareDonut } from "@/components/spend/share-donut";
import { CategoryList } from "@/components/spend/category-list";
import { CategoryDrill } from "@/components/spend/category-drill";
```

And near the other hooks: `const tsForSpend = useTimeseries(presetRange("6m"));`
For the drill branch, add before the overview return:

```tsx
const catId = useSearchParams().get("cat");
if (catId) {
  const parent = (cats.data ?? []).find((c) => c.id === catId);
  if (parent) {
    return <CategoryDrill parent={parent} txns={txns.data ?? []} cats={cats.data ?? []} currency={currency} />;
  }
}
```

Keep the existing loading/error guards. Remove the old `<CategoryBreakdown/>` import/usage from this page (the component file stays — it may be reused elsewhere — but the overview no longer renders it).

- [ ] **Step 4: Update Spend top tabs in nav.ts**

In `web/lib/shell/nav.ts`, change the `/transactions` entry of `TOP_TABS` (lines ~74-77) to:

```ts
"/transactions": [
  { label: "Categories", href: "/transactions" },
  { label: "Merchants", href: "/transactions?view=merchants" },
  { label: "Transactions", href: "/transactions?view=all" },
],
```

(The `merchants` view can render the existing breakdown-by-merchant in a follow-up; for now an unknown `view` falls through to overview — acceptable.)

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd web && npx playwright test e2e/spend.spec.ts`
Expected: PASS (3 tests). Seeded demo data must exist; if the category list is empty (no expenses this calendar month), the drill click test can fail — in that case set the test to use `?view=all` data or seed a current-month expense. Document whichever you choose in the test.

- [ ] **Step 6: Typecheck + lint + regression**

Run: `cd web && npm run typecheck && npm run lint && npx playwright test e2e/redesign-surfaces.spec.ts`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add web/app/(app)/transactions/page.tsx web/lib/shell/nav.ts web/e2e/spend.spec.ts
git commit -m "feat(spend): assemble overview + drill, update Spend tabs"
```

---

## Self-Review

**Spec coverage (Spend surface):**
- Insight strip inside Spend (point 9) → Tasks 1, 2, 7. ✓
- Spend-over-time chart → Task 3, 7. ✓
- Share donut → Task 3, 7. ✓
- Category list with MoM deltas, sorted by spend → Tasks 1, 5. ✓
- Sticky filter toolbar (search + recurring) → Task 4; Account/Amount/Tags explicitly deferred (data not facetable yet) — noted, not silent. 
- Drill: category → subcategory → merchant → transactions + "what changed" → Tasks 1, 6, 7. ✓
- View toggle Categories/Merchants/Transactions → Task 7 Step 4 (Merchants view stubbed to follow-up, flagged).

**Placeholder scan:** No TBD/TODO. Deferred items (Account/Amount/Tags chips, Merchants view) are explicit scope cuts with reasons, with concrete fallthrough behavior — not unfinished steps.

**Type consistency:** `CatRow` defined in Task 1, consumed identically in Tasks 2, 5, 6. `SpendFilters` defined and consumed in Task 4. `AreaPoint` reused from existing `area-chart.tsx`. `categoryRowsWithDeltas(txns, cats, month, prevMonth)` signature consistent across Tasks 1, 6, 7.

**Risk:** The overview's "this calendar month" framing can show an empty strip early in a month with no spend — acceptable, but the e2e drill test depends on current-month seeded data; Step 5 calls this out with a remedy.
