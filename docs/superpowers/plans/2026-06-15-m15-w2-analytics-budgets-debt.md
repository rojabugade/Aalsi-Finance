# M15 Frontend Rebuild — W2 (Analytics · Budgets · Debt) Implementation Plan

> **For the implementing agent (Codex):** This plan is **prescriptive**. Each task gives the
> **exact, complete file contents** to write. Create/replace each file with the code block
> **verbatim** — do not redesign, rename, restyle, or "improve" it. Do not add libraries.
> Do not edit files this plan does not mention. After each task, run the listed verification
> command and confirm the expected output before moving on. Steps use `- [ ]` for tracking.

**Goal:** Replace the three `ComingSoon` placeholders — **Analytics**, **Budgets**, **Debt** —
with working surfaces wired to the live backend, matching the look and conventions already
established by the Dashboard and Transactions surfaces.

**Architecture (already in place — follow it, don't reinvent):**
- Each surface is a client page under `web/app/(app)/<surface>/page.tsx`.
- Data access is through **per-domain hook modules** in `web/lib/api/*`, each defining a local
  `unwrap()` helper and exporting TanStack Query `useQuery`/`useMutation` hooks built on the
  typed `api` client from `@/lib/api/client`.
- Types come from the generated schema: `import type { components } from "@shared/api-schema"`
  then `components["schemas"]["<Name>"]`.
- **Inline English strings** (no i18n keys on feature surfaces — i18n is shell-only).
- Money values arrive from the API as **strings**; render with `formatCurrency` from
  `@/lib/format` (it accepts `string | number`); for math, wrap in `Number(...)`.
- Reuse these existing tokens/patterns: `text-success`, `text-destructive`,
  `text-muted-foreground`, `bg-muted`, `data-numeric` on numeric cells, and the proportional
  bar (`<div class="h-1.5 overflow-hidden rounded-full bg-muted">` containing
  `<div class="h-full rounded-full bg-primary/80" style={{width:`${pct}%`}} />`).

**Tech Stack:** (inherited) Next 15 App Router, React 19, TanStack Query 5, openapi-fetch,
Recharts 2, shadcn/ui. **No new dependencies and no new shadcn primitives** — everything below
uses primitives already in `web/components/ui/` (`card`, `button`, `input`, `label`, `dialog`,
`table`, `badge`, `skeleton`, `sonner`) plus styled native `<select>` elements.

---

## Environment notes (read first)

- App runs in the `web` Docker container. Run typecheck/build **inside the container**:
  `docker compose exec web npm run typecheck` and `docker compose exec web npm run build`.
- Backend is live at `http://localhost:8000` (host) / `http://api:8000` (compose). The dev app
  is at `http://localhost:3000`.
- Run **Playwright on the host**: `cd web && npx playwright test`.
- All `git` commands run from repo root `/Users/kshtj/CourseWork/Study/Projects/CodeName-Missing`.
- Working test creds: `dev@example.com` / `hunter2pass` (see `web/REBUILD_PROGRESS.md`).

## Backend contract (already verified — do not change the backend)

- `GET /analytics/breakdown?from&to&dimension&filter` → `BreakdownOut { dimension, filter?, rows: AnalyticsRow[] }`.
  `AnalyticsRow = { dimensions: Record<string,string|null>, total: string, quantity?: string|null, contribution_pct?: string|null, transaction_ids: string[] }`.
  **Valid dimensions:** `merchant`, `category`, `subcategory`, `item_type`, `tag`.
- `GET /analytics/summary?from&to&group_by[]&compare?` → `AnalyticsSummaryOut { total, rows, ... }`.
- `GET /budgets` → `BudgetOut[]`; `POST /budgets` body `BudgetIn { category_id?, period, amount, currency }`
  → `BudgetOut { ..., spent, remaining, progress_pct, overspent }` (all money fields are strings).
- `GET /categories` → `CategoryOut[] { id, name, kind, ... }`.
- `GET /loans` → `LoanOut[]`; `POST /loans` body `LoanIn`; `PATCH /loans/{loan_id}` body `LoanPatch`;
  `DELETE /loans/{loan_id}` → 204.
- `GET /loans/{loan_id}/schedule` → `PaymentScheduleOut[]`.
- `POST /loans/{loan_id}/payoff-calc` body `PayoffCalcIn { monthly_payment, extra_payments[] }`
  → `PayoffCalcOut { months, total_interest, total_paid, projection[], warning? }`.
- `POST /loans/payoff-strategy` body `PayoffStrategyIn { strategy, extra_monthly_payment }`
  → `PayoffStrategyOut { strategy, ordered_plan: PayoffStrategyLoan[] }`. **Strategy values:**
  `snowball`, `avalanche`.
- Loan `schedule_kind` values: `amortizing`, `revolving`.

## Files created/modified in W2

```
web/
  lib/api/
    analytics.ts        # MODIFY: add optional `filter` arg + DIMENSIONS const
    budgets.ts          # CREATE
    loans.ts            # CREATE
  app/(app)/
    analytics/page.tsx  # REPLACE placeholder
    budgets/page.tsx    # REPLACE placeholder
    debt/page.tsx       # REPLACE placeholder
  components/debt/
    loan-detail.tsx     # CREATE (schedule + payoff calculator dialog)
  e2e/w2.spec.ts        # CREATE (smoke)
  REBUILD_PROGRESS.md   # MODIFY: mark W2 done
```

---

## Task 1: Extend the analytics hooks

**File:** Modify `web/lib/api/analytics.ts`.

- [ ] **Step 1:** Replace the `useBreakdown` function with this version (adds an optional
  `filter` argument; the existing `useTimeseries` and `useSummary` stay unchanged), and add the
  `DIMENSIONS` export at the bottom of the file:

```ts
export function useBreakdown(range: DateRange, dimension: string, filter?: string) {
  return useQuery({
    queryKey: ["analytics", "breakdown", dimension, filter ?? "", range],
    queryFn: () =>
      unwrap(
        api.GET("/analytics/breakdown", {
          params: {
            query: { from: range.from, to: range.to, dimension, filter: filter || null },
          },
        }),
      ),
  });
}

/** Faceting dimensions the backend's breakdown endpoint accepts. */
export const DIMENSIONS = [
  { value: "category", label: "Category" },
  { value: "merchant", label: "Merchant" },
  { value: "subcategory", label: "Subcategory" },
  { value: "item_type", label: "Item type" },
  { value: "tag", label: "Tag" },
] as const;
```

- [ ] **Step 2:** Verify the Dashboard still typechecks (it calls `useBreakdown(range, "merchant")`
  with two args — still valid because `filter` is optional):

Run: `docker compose exec web npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/lib/api/analytics.ts
git commit -m "feat(web): analytics breakdown filter + shared DIMENSIONS list"
```

---

## Task 2: Budgets API hook module

**File:** Create `web/lib/api/budgets.ts` with **exactly** this content:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type Budget = components["schemas"]["BudgetOut"];
export type BudgetIn = components["schemas"]["BudgetIn"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

const KEY = ["budgets"] as const;

export function useBudgets() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => unwrap(api.GET("/budgets", {})),
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BudgetIn) => unwrap(api.POST("/budgets", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

- [ ] Verify: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/lib/api/budgets.ts
git commit -m "feat(web): budgets API hooks"
```

---

## Task 3: Loans API hook module

**File:** Create `web/lib/api/loans.ts` with **exactly** this content:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type Loan = components["schemas"]["LoanOut"];
export type LoanIn = components["schemas"]["LoanIn"];
export type LoanPatch = components["schemas"]["LoanPatch"];
export type ScheduleRow = components["schemas"]["PaymentScheduleOut"];
export type PayoffCalc = components["schemas"]["PayoffCalcOut"];
export type PayoffCalcIn = components["schemas"]["PayoffCalcIn"];
export type PayoffStrategy = components["schemas"]["PayoffStrategyOut"];
export type PayoffStrategyIn = components["schemas"]["PayoffStrategyIn"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

const KEY = ["loans"] as const;

export function useLoans() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => unwrap(api.GET("/loans", {})),
  });
}

export function useCreateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoanIn) => unwrap(api.POST("/loans", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/loans/{loan_id}", {
        params: { path: { loan_id: id } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Amortization schedule for one loan. Enabled only when a loan id is provided. */
export function useLoanSchedule(loanId: string | null) {
  return useQuery({
    queryKey: ["loans", "schedule", loanId],
    enabled: Boolean(loanId),
    queryFn: () =>
      unwrap(
        api.GET("/loans/{loan_id}/schedule", {
          params: { path: { loan_id: loanId as string } },
        }),
      ),
  });
}

export function usePayoffCalc() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PayoffCalcIn }) =>
      unwrap(
        api.POST("/loans/{loan_id}/payoff-calc", {
          params: { path: { loan_id: id } },
          body,
        }),
      ),
  });
}

export function usePayoffStrategy() {
  return useMutation({
    mutationFn: (body: PayoffStrategyIn) =>
      unwrap(api.POST("/loans/payoff-strategy", { body })),
  });
}
```

- [ ] Verify: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/lib/api/loans.ts
git commit -m "feat(web): loans + payoff API hooks"
```

---

## Task 4: Analytics surface

**File:** Replace `web/app/(app)/analytics/page.tsx` with **exactly** this content:

```tsx
"use client";

import { useMemo, useState } from "react";

import { DIMENSIONS, useBreakdown } from "@/lib/api/analytics";
import { presetRange, RANGE_PRESETS, type RangePreset } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const num = (v: unknown) => Number(v ?? 0);

type Row = { label: string; total: number; pct: number };

export default function AnalyticsPage() {
  const [preset, setPreset] = useState<RangePreset>("3m");
  const [dimension, setDimension] = useState<string>("category");
  const [filter, setFilter] = useState("");
  const range = useMemo(() => presetRange(preset), [preset]);

  const breakdown = useBreakdown(range, dimension, filter.trim() || undefined);

  const rows: Row[] = useMemo(() => {
    const raw = (breakdown.data?.rows ?? [])
      .map((r) => ({
        label: r.dimensions?.[dimension] ?? "Uncategorized",
        total: num(r.total),
      }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
    const sum = raw.reduce((a, r) => a + r.total, 0) || 1;
    return raw.map((r) => ({ ...r, pct: (r.total / sum) * 100 }));
  }, [breakdown.data, dimension]);

  const total = useMemo(() => rows.reduce((a, r) => a + r.total, 0), [rows]);
  const max = rows[0]?.total ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Break your spending down by any facet.
          </p>
        </div>
        <RangeTabs value={preset} onChange={setPreset} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {DIMENSIONS.map((d) => (
          <button
            key={d.value}
            onClick={() => setDimension(d.value)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              dimension === d.value
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            {d.label}
          </button>
        ))}
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="ml-auto h-9 w-40"
        />
      </div>

      {breakdown.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Couldn&apos;t load analytics. Check your connection and try again.
          </CardContent>
        </Card>
      ) : breakdown.isLoading ? (
        <Skeleton className="h-[360px]" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No spending in this range.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Contribution</CardTitle>
              <CardDescription>
                Share of {formatCurrency(total)} total
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {rows.slice(0, 8).map((r) => (
                <div key={r.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate capitalize">{r.label.toLowerCase()}</span>
                    <span data-numeric className="font-medium">
                      {r.pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/80"
                      style={{ width: `${(r.total / max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Breakdown</CardTitle>
              <CardDescription>By {dimension}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="capitalize">{dimension}</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.label}>
                      <TableCell className="capitalize">{r.label.toLowerCase()}</TableCell>
                      <TableCell data-numeric className="text-right font-medium">
                        {formatCurrency(r.total)}
                      </TableCell>
                      <TableCell data-numeric className="text-right text-muted-foreground">
                        {r.pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function RangeTabs({
  value,
  onChange,
}: {
  value: RangePreset;
  onChange: (v: RangePreset) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5">
      {RANGE_PRESETS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === p.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] Verify typecheck: `docker compose exec web npm run typecheck` → no errors.
- [ ] Verify it renders: `curl -s http://localhost:3000/analytics | grep -o "Analytics" | head -1`
  → prints `Analytics`. (The page is auth-guarded client-side; the HTML shell still contains the
  string. If you get nothing, restart: `docker compose restart web && sleep 6` and retry.)
- [ ] Commit:

```bash
git add "web/app/(app)/analytics/page.tsx"
git commit -m "feat(web): Analytics surface — faceted breakdown + contribution"
```

---

## Task 5: Budgets surface

**File:** Replace `web/app/(app)/budgets/page.tsx` with **exactly** this content:

```tsx
"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useBudgets, useCreateBudget, type Budget } from "@/lib/api/budgets";
import { useCategories } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const num = (v: unknown) => Number(v ?? 0);

export default function BudgetsPage() {
  const budgets = useBudgets();
  const categories = useCategories();

  const catName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories.data ?? []) m.set(c.id, c.name);
    return (id: string | null | undefined) => (id ? m.get(id) ?? "Category" : "All spending");
  }, [categories.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Budgets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set limits by category and track them against actuals.
          </p>
        </div>
        <NewBudgetDialog />
      </div>

      {budgets.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Couldn&apos;t load budgets. Check your connection and try again.
          </CardContent>
        </Card>
      ) : budgets.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (budgets.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No budgets yet. Create one to start tracking.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(budgets.data ?? []).map((b) => (
            <BudgetCard key={b.id} budget={b} label={catName(b.category_id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetCard({ budget, label }: { budget: Budget; label: string }) {
  const amount = num(budget.amount);
  const spent = num(budget.spent);
  const pct = Math.min(100, num(budget.progress_pct));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base capitalize">{label.toLowerCase()}</CardTitle>
        <CardDescription className="capitalize">{budget.period}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between text-sm">
          <span data-numeric className="font-medium">
            {formatCurrency(spent, { currency: budget.currency })}
          </span>
          <span className="text-muted-foreground">
            of {formatCurrency(amount, { currency: budget.currency })}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              budget.overspent ? "bg-destructive" : "bg-primary/80",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p
          className={cn(
            "text-xs",
            budget.overspent ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {budget.overspent
            ? `Over by ${formatCurrency(Math.abs(num(budget.remaining)), { currency: budget.currency })}`
            : `${formatCurrency(num(budget.remaining), { currency: budget.currency })} left`}
        </p>
      </CardContent>
    </Card>
  );
}

function NewBudgetDialog() {
  const [open, setOpen] = useState(false);
  const categories = useCategories();
  const create = useCreateBudget();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const categoryId = String(form.get("category_id") ?? "");
    try {
      await create.mutateAsync({
        category_id: categoryId || null,
        period: String(form.get("period") ?? "monthly"),
        amount: String(form.get("amount") ?? "0"),
        currency: String(form.get("currency") ?? "USD"),
      });
      toast.success("Budget created");
      setOpen(false);
    } catch {
      toast.error("Couldn't create budget");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New budget</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New budget</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="category_id">Category</Label>
            <select id="category_id" name="category_id" className={SELECT_CLASS} defaultValue="">
              <option value="">All spending</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="period">Period</Label>
            <select id="period" name="period" className={SELECT_CLASS} defaultValue="monthly">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" defaultValue="USD" maxLength={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Create budget"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] Verify typecheck: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add "web/app/(app)/budgets/page.tsx"
git commit -m "feat(web): Budgets surface — create + progress tracking"
```

---

## Task 6: Debt — loan detail (schedule + payoff calculator)

**File:** Create `web/components/debt/loan-detail.tsx` with **exactly** this content:

```tsx
"use client";

import { useState } from "react";

import { useLoanSchedule, usePayoffCalc, type Loan } from "@/lib/api/loans";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function LoanDetail({
  loan,
  open,
  onOpenChange,
}: {
  loan: Loan;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const schedule = useLoanSchedule(open ? loan.id : null);
  const calc = usePayoffCalc();

  async function onCalc(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    calc.mutate({
      id: loan.id,
      body: { monthly_payment: String(form.get("monthly_payment") ?? "0") },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="capitalize">{loan.name}</DialogTitle>
          <DialogDescription>
            {formatCurrency(loan.principal, { currency: loan.currency })} principal
            {loan.interest_rate ? ` · ${Number(loan.interest_rate)}% APR` : ""}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Payoff calculator</h3>
          <form onSubmit={onCalc} className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="monthly_payment">Monthly payment</Label>
              <Input
                id="monthly_payment"
                name="monthly_payment"
                type="number"
                min="0"
                step="0.01"
                required
                className="w-40"
              />
            </div>
            <Button type="submit" disabled={calc.isPending}>
              {calc.isPending ? "Calculating…" : "Calculate"}
            </Button>
          </form>
          {calc.isError && (
            <p className="text-sm text-destructive">Couldn&apos;t calculate payoff.</p>
          )}
          {calc.data && (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Metric label="Months" value={String(calc.data.months)} />
              <Metric
                label="Total interest"
                value={formatCurrency(calc.data.total_interest, { currency: loan.currency })}
              />
              <Metric
                label="Total paid"
                value={formatCurrency(calc.data.total_paid, { currency: loan.currency })}
              />
            </div>
          )}
          {calc.data?.warning && (
            <p className="text-sm text-amber-600 dark:text-amber-400">{calc.data.warning}</p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Amortization schedule</h3>
          {schedule.isLoading ? (
            <Skeleton className="h-48" />
          ) : (schedule.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No schedule available.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">Interest</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(schedule.data ?? []).slice(0, 60).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.installment_no}</TableCell>
                    <TableCell>{r.due_date}</TableCell>
                    <TableCell data-numeric className="text-right">
                      {formatCurrency(r.principal_component, { currency: loan.currency })}
                    </TableCell>
                    <TableCell data-numeric className="text-right">
                      {formatCurrency(r.interest_component, { currency: loan.currency })}
                    </TableCell>
                    <TableCell data-numeric className="text-right">
                      {formatCurrency(r.balance_after, { currency: loan.currency })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p data-numeric className="mt-1 font-semibold">
        {value}
      </p>
    </div>
  );
}
```

- [ ] Verify typecheck: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/components/debt/loan-detail.tsx
git commit -m "feat(web): loan detail — payoff calculator + amortization schedule"
```

---

## Task 7: Debt surface

**File:** Replace `web/app/(app)/debt/page.tsx` with **exactly** this content:

```tsx
"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useCreateLoan,
  useDeleteLoan,
  useLoans,
  usePayoffStrategy,
  type Loan,
} from "@/lib/api/loans";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LoanDetail } from "@/components/debt/loan-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const num = (v: unknown) => Number(v ?? 0);

export default function DebtPage() {
  const loans = useLoans();
  const [selected, setSelected] = useState<Loan | null>(null);

  const total = useMemo(
    () => (loans.data ?? []).reduce((a, l) => a + num(l.principal), 0),
    [loans.data],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Debt</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track loans, schedules, and the fastest way out.
          </p>
        </div>
        <NewLoanDialog />
      </div>

      {loans.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Couldn&apos;t load loans. Check your connection and try again.
          </CardContent>
        </Card>
      ) : loans.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : (loans.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No loans yet. Add one to see schedules and payoff plans.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Total outstanding principal</p>
              <p data-numeric className="mt-1 text-2xl font-semibold tracking-tight">
                {formatCurrency(total)}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(loans.data ?? []).map((l) => (
              <LoanCard key={l.id} loan={l} onOpen={() => setSelected(l)} />
            ))}
          </div>

          <PayoffStrategyCard />
        </>
      )}

      {selected && (
        <LoanDetail
          loan={selected}
          open={Boolean(selected)}
          onOpenChange={(v) => !v && setSelected(null)}
        />
      )}
    </div>
  );
}

function LoanCard({ loan, onOpen }: { loan: Loan; onOpen: () => void }) {
  const del = useDeleteLoan();
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base capitalize">{loan.name}</CardTitle>
          <Badge variant="secondary" className="capitalize">
            {loan.type}
          </Badge>
        </div>
        <CardDescription>
          {loan.interest_rate ? `${Number(loan.interest_rate)}% APR` : "No interest"}
          {loan.next_due_date ? ` · due ${loan.next_due_date}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p data-numeric className="text-xl font-semibold">
          {formatCurrency(loan.principal, { currency: loan.currency })}
        </p>
        {loan.penalty_warning && (
          <p className="text-xs text-destructive">{loan.penalty_warning}</p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onOpen}>
            Schedule &amp; payoff
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={del.isPending}
            onClick={() => {
              if (confirm(`Delete ${loan.name}?`)) {
                del.mutate(loan.id, {
                  onSuccess: () => toast.success("Loan deleted"),
                  onError: () => toast.error("Couldn't delete loan"),
                });
              }
            }}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PayoffStrategyCard() {
  const [strategy, setStrategy] = useState("snowball");
  const [extra, setExtra] = useState("0");
  const run = usePayoffStrategy();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payoff strategy</CardTitle>
        <CardDescription>
          Order your debts for the fastest payoff. Snowball clears smallest balances first;
          avalanche targets the highest interest first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5">
            {["snowball", "avalanche"].map((s) => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  strategy === s
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="extra">Extra monthly payment</Label>
            <Input
              id="extra"
              type="number"
              min="0"
              step="0.01"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              className="w-40"
            />
          </div>
          <Button
            onClick={() =>
              run.mutate({ strategy, extra_monthly_payment: extra || "0" })
            }
            disabled={run.isPending}
          >
            {run.isPending ? "Planning…" : "Plan payoff"}
          </Button>
        </div>

        {run.isError && (
          <p className="text-sm text-destructive">Couldn&apos;t build a strategy.</p>
        )}
        {run.data && (
          <ol className="space-y-2">
            {run.data.ordered_plan.map((p) => (
              <li
                key={p.loan_id}
                className="flex items-start gap-3 rounded-lg border p-3 text-sm"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {p.order}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium capitalize">{p.name}</span>
                    <span data-numeric className="font-medium">
                      {formatCurrency(p.principal)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.rationale}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function NewLoanDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateLoan();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const str = (k: string) => {
      const v = String(form.get(k) ?? "").trim();
      return v || null;
    };
    try {
      await create.mutateAsync({
        name: String(form.get("name") ?? ""),
        type: String(form.get("type") ?? "other"),
        schedule_kind: String(form.get("schedule_kind") ?? "amortizing"),
        principal: String(form.get("principal") ?? "0"),
        currency: String(form.get("currency") ?? "USD"),
        interest_rate: str("interest_rate"),
        compounding: "monthly",
        min_or_emi_amount: str("min_or_emi_amount"),
        due_day: form.get("due_day") ? Number(form.get("due_day")) : null,
        start_date: str("start_date"),
      });
      toast.success("Loan added");
      setOpen(false);
    } catch {
      toast.error("Couldn't add loan");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add loan</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add loan</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="type">Type</Label>
              <select id="type" name="type" className={SELECT_CLASS} defaultValue="other">
                <option value="mortgage">Mortgage</option>
                <option value="auto">Auto</option>
                <option value="student">Student</option>
                <option value="personal">Personal</option>
                <option value="credit_card">Credit card</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="schedule_kind">Schedule</Label>
              <select
                id="schedule_kind"
                name="schedule_kind"
                className={SELECT_CLASS}
                defaultValue="amortizing"
              >
                <option value="amortizing">Amortizing</option>
                <option value="revolving">Revolving</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="principal">Principal</Label>
              <Input id="principal" name="principal" type="number" min="0" step="0.01" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" defaultValue="USD" maxLength={3} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="interest_rate">Interest rate %</Label>
              <Input id="interest_rate" name="interest_rate" type="number" min="0" step="0.01" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="min_or_emi_amount">Min / EMI payment</Label>
              <Input id="min_or_emi_amount" name="min_or_emi_amount" type="number" min="0" step="0.01" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="due_day">Due day (1–31)</Label>
              <Input id="due_day" name="due_day" type="number" min="1" max="31" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="start_date">Start date</Label>
              <Input id="start_date" name="start_date" type="date" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Add loan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] Verify typecheck: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add "web/app/(app)/debt/page.tsx"
git commit -m "feat(web): Debt surface — loans, schedule, payoff calculator + strategy"
```

---

## Task 8: Playwright smoke + close-out

**File:** Create `web/e2e/w2.spec.ts` with **exactly** this content:

```ts
import { test, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("analytics surface renders with dimension tabs", async ({ page }) => {
  await login(page);
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: /analytics/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^merchant$/i })).toBeVisible();
});

test("budgets surface renders with a create action", async ({ page }) => {
  await login(page);
  await page.goto("/budgets");
  await expect(page.getByRole("heading", { name: /budgets/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /new budget/i })).toBeVisible();
});

test("debt surface renders with payoff strategy", async ({ page }) => {
  await login(page);
  await page.goto("/debt");
  await expect(page.getByRole("heading", { name: /^debt$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /add loan/i })).toBeVisible();
});
```

- [ ] **Step 1: Full typecheck + build** (in container):

Run: `docker compose exec web npm run typecheck && docker compose exec web npm run build`
Expected: clean typecheck; build succeeds.

- [ ] **Step 2: Run the smoke suite** (host; dev server up on :3000):

Run: `cd web && npx playwright test w2.spec.ts`
Expected: `3 passed`. (If login fails, confirm the creds in `REBUILD_PROGRESS.md`; create the
user with `curl -s -X POST http://localhost:8000/auth/signup -H 'Content-Type: application/json'
-d '{"email":"dev@example.com","password":"hunter2pass"}'` if it doesn't exist.)

- [ ] **Step 3: Update `web/REBUILD_PROGRESS.md`** — change the W2 line and the three surface rows:

In the **Waves** section, replace the W2 line with:
```
- [x] **W2** — Analytics (faceted breakdown + contribution), Budgets (create + track), Debt (loans, schedule, payoff calc + snowball/avalanche).
```

In the **Surfaces** table, set these three rows to `done`:
```
| Analytics | done | analytics/breakdown | faceted breakdowns by 5 dimensions + contribution bars/table + range filter |
| Budgets | done | GET/POST /budgets, /categories | create budgets; per-budget spent/remaining progress, overspent flag |
| Debt | done | /loans/*, /loans/{id}/schedule, payoff-calc, payoff-strategy | loan list/create/delete, amortization schedule, payoff calculator, snowball/avalanche plan |
```

Add a **W2 notes** section after the W1 notes:
```
## W2 notes
- Analytics breakdown is server-aggregated; the page sorts/limits client-side and computes
  contribution % from the returned row totals. `useBreakdown` now takes an optional `filter`.
- Budgets and loans expose no PATCH UI yet beyond create/delete (loans) — edit is a future pass.
- Payoff calc/strategy are POST endpoints driven as mutations on button click (no caching).
```

- [ ] **Step 4: Commit**

```bash
git add web/e2e/w2.spec.ts web/REBUILD_PROGRESS.md
git commit -m "test(web): W2 smoke; mark Analytics/Budgets/Debt done"
```

---

## W2 Done When

- `docker compose exec web npm run typecheck` is clean and `npm run build` succeeds.
- `npx playwright test w2.spec.ts` passes `3 passed`.
- `/analytics` shows a faceted breakdown: switching dimension tabs (Category/Merchant/…) and the
  range tabs re-queries; contribution bars + breakdown table render; filter input narrows rows.
- `/budgets` lists budgets with spent/remaining progress bars (overspent in red) and "New budget"
  creates one that appears in the list.
- `/debt` lists loans with total outstanding; "Add loan" creates one; "Schedule & payoff" opens a
  dialog with the amortization table and a working payoff calculator; the payoff-strategy card
  returns an ordered snowball/avalanche plan.
- `web/REBUILD_PROGRESS.md` marks W2 and the three surfaces done.

## Guardrails for the implementing agent

- **Do not** add npm packages or run `shadcn add`. Every import above already resolves.
- **Do not** modify `lib/api/client.ts`, `lib/api/auth.ts`, the layout, or any W0/W1 surface
  except the one-line-compatible change to `lib/api/analytics.ts` in Task 1.
- **Do not** introduce i18n keys on these surfaces — inline English, matching Dashboard.
- Money fields from the API are **strings**; never do arithmetic without `Number(...)`, and
  always render via `formatCurrency`.
- If typecheck fails, fix the code you just wrote to match the generated types in
  `shared/api-schema.ts` — do not edit the generated schema or the backend.
```
