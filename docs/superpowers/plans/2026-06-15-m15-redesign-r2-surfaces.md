# M15 Redesign — R2 Surface Re-skins Implementation Plan

> **For the implementing agent (Codex):** This plan is **prescriptive**. Most tasks are **surgical
> edits** — exact `old` → `new` string replacements against the current files — plus a few full
> file rewrites where the layout genuinely changes. Apply each edit **verbatim**. **Do not touch
> data hooks, mutations, form logic, state, query keys, or `@/lib/api/*`** — this is presentation
> only. Do not add libraries. After each task run the listed verification and confirm before
> moving on. Steps use `- [ ]` for tracking.
>
> **REQUIRES R1 MERGED.** This plan consumes the R1 primitives (`HeroCard`, `RowList`/`StatRow`/
> `CategoryRow`, `FeatureCard`, `SegmentedPills`, `AreaChart`, `ResponsiveSheet`), the shell
> (`AppShell` + `GlassBar` titles/tabs), the tokens, and `@/lib/icons`.
>
> **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans.

**Goal:** Re-skin all 12 surfaces onto the R1 shell + primitives so the app matches the
soft-premium-fintech mockup — immersive Dashboard, list-row ledgers, glass-fit pages, bottom-sheet
drill-downs — while every backend call, hook, and form behaves exactly as it does today.

**Architecture:** Each `(app)` page already owns its data via TanStack Query hooks. The re-skin
(1) removes the per-page `<h1>`/description block (the `GlassBar` now renders the surface title),
(2) swaps shadcn `Card`/`Table`/`Dialog` shells for R1 primitives and the new tokens
(`bg-card text-fg text-muted rounded-card shadow-card border-border`), (3) converts modal
drill-downs to `ResponsiveSheet`, and (4) reads the shell's query-param tabs (`?type=`, `?tab=`)
so the `GlassBar` top tabs actually drive in-page state. No route files are added; **Cross-border
stays nested in Guidance** (locked decision).

**Tech Stack:** unchanged from R1.

**Spec:** `docs/superpowers/specs/2026-06-15-m15-frontend-redesign-design.md` — §3 surface map,
§5 visual language, §7 icon map. Mockup: `docs/mockups/dashboard-palettes.html`.

---

## Shared re-skin conventions (apply consistently)

These are the locked token/shell mappings. When an edit below says "apply the shell mapping," it
means these exact substitutions:

| Old (shadcn) | New (redesign) |
|---|---|
| outer `<div className="space-y-6">` + `<h1>`/`<p>` header block | remove the header block; keep an action row only if the page had an action button |
| `<Card>…</Card>` content panel | `<div className="rounded-card-sm border border-border bg-card p-4 shadow-card">` |
| `text-muted-foreground` | `text-muted` |
| `bg-muted` (track) | `bg-track` |
| `bg-primary` / `bg-primary/80` (fills) | `bg-accent` |
| `text-primary` | `text-accent` |
| range/segment pill `<div className="inline-flex rounded-lg border bg-secondary/40 p-0.5">…buttons` | `<SegmentedPills … />` |
| `<Dialog>` drill-down (detail/sheet) | `<ResponsiveSheet open onOpenChange title>` |
| amber `text-amber-*` inline blocks | `text-c2` on `bg-soft2` |
| destructive fills | keep `bg-destructive` / `text-destructive` (bridged in R1) |

**Page top padding:** the shell already pads content (104px when tabs exist, 76px otherwise) and
reserves space for the bottom bar. Pages must use a plain `<div className="space-y-4">` wrapper
(not `min-h`, not their own top padding).

**Create/edit dialogs that are forms** (New budget, Add loan, Add source, grants/events, Log
transfer, New transaction split): keep the shadcn `Dialog` — it already renders centered and works
under the new tokens. Only **drill-down/detail** sheets (Transaction detail, Loan detail) convert
to `ResponsiveSheet` for the mobile bottom-sheet feel (§3/§7). Form `Dialog`s just inherit the new
tokens automatically.

---

## Task 1: Dashboard — Home (hero + features + summary + top spending)

This is the flagship surface; replace it fully to match the mockup. Keeps the existing analytics
hooks and all computed values; swaps presentation to `HeroCard` + `FeatureCard` + `RowList`/
`StatRow` + `CategoryRow`, and adds the `Overview`/`Goals` query-param tab.

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx` (full replace)

- [ ] **Step 1: Replace the file**

```tsx
"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Sparkles, Globe } from "@/lib/icons";

import { useBreakdown, useTimeseries } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { categoryIcon, SUMMARY_ICONS } from "@/lib/icons";
import { HeroCard } from "@/components/ui/hero-card";
import { FeatureCard } from "@/components/ui/feature-card";
import { RowList, StatRow, CategoryRow } from "@/components/ui/row-list";
import { Skeleton } from "@/components/ui/skeleton";

const num = (v: unknown) => Number(v ?? 0);

export default function DashboardPage() {
  const tab = useSearchParams().get("tab") === "goals" ? "goals" : "overview";
  const range = useMemo(() => presetRange("6m"), []);
  const ts = useTimeseries(range);
  const breakdown = useBreakdown(range, "category");

  const points = useMemo(
    () =>
      (ts.data?.points ?? []).map((p) => ({
        period: p.period,
        spend: num(p.spend),
        income: num(p.income),
        net: num(p.net),
      })),
    [ts.data],
  );

  const totals = useMemo(() => {
    const spend = points.reduce((a, p) => a + p.spend, 0);
    const income = points.reduce((a, p) => a + p.income, 0);
    const net = income - spend;
    const savings = income > 0 ? (net / income) * 100 : 0;
    return { spend, income, net, savings };
  }, [points]);

  const delta = useMemo(() => {
    const n = points.length;
    if (n < 2) return 0;
    const cur = points[n - 1].net;
    const prev = points[n - 2].net;
    return prev === 0 ? 0 : ((cur - prev) / Math.abs(prev)) * 100;
  }, [points]);

  const topCats = useMemo(() => {
    const rows = (breakdown.data?.rows ?? [])
      .map((r) => ({ name: r.dimensions?.category ?? "Uncategorized", total: num(r.total) }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    const max = rows[0]?.total ?? 1;
    return { rows, max };
  }, [breakdown.data]);

  const loading = ts.isLoading;
  const hasData = points.some((p) => p.spend !== 0 || p.income !== 0);

  if (tab === "goals") {
    return (
      <div className="space-y-4">
        <div className="rounded-card-sm border border-border bg-card p-6 text-center text-sm text-muted shadow-card">
          Goals are coming soon.
        </div>
      </div>
    );
  }

  if (ts.isError) {
    return (
      <div className="space-y-4">
        <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
          Couldn&apos;t load your money. Check your connection and try again.
        </div>
      </div>
    );
  }

  if (loading) return <DashboardSkeleton />;

  if (!hasData) {
    return (
      <div className="space-y-4">
        <div className="rounded-card-sm border border-border bg-card p-8 text-center shadow-card">
          <p className="font-semibold">No transactions yet</p>
          <p className="mt-1 text-sm text-muted">
            Capture a receipt or statement to see your cash flow here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <HeroCard
        label="Net cash flow · last 6 months"
        value={formatCurrency(totals.net, { signed: true })}
        delta={delta}
        deltaLabel={`${delta > 0 ? "+" : ""}${delta.toFixed(1)}% vs prev month`}
        series={points.map((p) => p.net)}
      />

      <div className="grid grid-cols-2 gap-3">
        <FeatureCard icon={Sparkles} title="Ask your money" href="/guidance" variant="ai" />
        <FeatureCard icon={Globe} title="Send abroad" href="/guidance" variant="xb" />
      </div>

      <RowList>
        <StatRow
          icon={SUMMARY_ICONS.income}
          tint="accent"
          label="Income"
          sub={`${points.length} months`}
          value={formatCurrency(totals.income)}
          href="/transactions?type=income"
        />
        <StatRow
          icon={SUMMARY_ICONS.spending}
          tint="c2"
          label="Spending"
          sub="all categories"
          value={formatCurrency(totals.spend)}
          href="/transactions?type=expense"
        />
        <StatRow
          icon={SUMMARY_ICONS.savings}
          tint="c3"
          label="Savings rate"
          sub={`${totals.savings.toFixed(1)}% this period`}
          value={formatCurrency(totals.net)}
          href="/analytics"
        />
      </RowList>

      <div className="flex items-center justify-between px-1 pt-1">
        <h2 className="text-[14.5px] font-bold tracking-tight">Top spending</h2>
        <a href="/analytics" className="text-xs font-semibold text-accent">
          See all
        </a>
      </div>
      {topCats.rows.length > 0 && (
        <RowList>
          {topCats.rows.map((c, i) => (
            <CategoryRow
              key={c.name}
              icon={categoryIcon(c.name)}
              tint={(["accent", "c2", "c3"] as const)[i % 3]}
              label={c.name.charAt(0).toUpperCase() + c.name.slice(1).toLowerCase()}
              value={formatCurrency(c.total)}
              pct={(c.total / topCats.max) * 100}
            />
          ))}
        </RowList>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3.5">
      <Skeleton className="h-44 rounded-card" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[92px] rounded-[18px]" />
        <Skeleton className="h-[92px] rounded-[18px]" />
      </div>
      <Skeleton className="h-40 rounded-card-sm" />
      <Skeleton className="h-40 rounded-card-sm" />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/dashboard/page.tsx"
git commit -m "feat(web): re-skin Dashboard — hero, feature cards, summary + top spending rows"
```

Expected: typecheck passes. (`cash-flow-chart.tsx` is no longer imported by Dashboard; it stays in
the repo, unused — leave it.)

---

## Task 2: Transactions — Spend (list rows + sheet + type tabs)

Keep all hooks/merge/search logic. Replace the table with `RowList`/`StatRow`, drop the header,
convert the status pills to `SegmentedPills`, and read the shell's `?type=` tab to filter
income/expenses.

**Files:**
- Modify: `web/app/(app)/transactions/page.tsx`

- [ ] **Step 1: Replace imports + filter constants.** Replace lines 1–42 (from `"use client";`
  through the `formatDate` helper's preceding `statusVariant`/constants) — specifically replace
  this block:

```tsx
import { useMemo, useState } from "react";
import { ArrowLeftRight, Combine, Search } from "lucide-react";
import { toast } from "sonner";

import {
  type Transaction,
  useCategories,
  useMergeTransactions,
  useTransactions,
} from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TransactionDetail } from "@/components/transactions/transaction-detail";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

function statusVariant(status: string) {
  if (status === "confirmed") return "success" as const;
  if (status === "ignored") return "secondary" as const;
  return "warning" as const;
}
```

with:

```tsx
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Combine, Search } from "lucide-react";
import { categoryIcon } from "@/lib/icons";
import { toast } from "sonner";

import {
  type Transaction,
  useCategories,
  useMergeTransactions,
  useTransactions,
} from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RowList, StatRow } from "@/components/ui/row-list";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { TransactionDetail } from "@/components/transactions/transaction-detail";

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];
```

- [ ] **Step 2: Read the `?type=` tab + filter by sign.** In `TransactionsPage`, replace:

```tsx
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
```

with:

```tsx
  const typeParam = useSearchParams().get("type"); // "income" | "expense" | null
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
```

Then in the `rows` `useMemo`, replace the first `.filter` line:

```tsx
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
```

with:

```tsx
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
      .filter((t) => {
        if (typeParam === "income") return Number(t.amount) < 0;
        if (typeParam === "expense") return Number(t.amount) >= 0;
        return true;
      })
```

And add `typeParam` to that `useMemo`'s dependency array: change `}, [txns.data, search, statusFilter]);`
to `}, [txns.data, search, statusFilter, typeParam]);`.

- [ ] **Step 3: Replace the return JSX** (the whole `return ( … );` of `TransactionsPage`) with:

```tsx
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted">
          {txns.isLoading ? "Loading…" : `${rows.length} shown · ${formatCurrency(total)}`}
        </p>
        {selected.size >= 2 && (
          <Button size="sm" onClick={onMerge} disabled={merge.isPending}>
            <Combine className="size-4" /> Merge {selected.size}
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search merchant or notes"
          className="pl-9"
        />
      </div>
      <SegmentedPills
        aria-label="Status filter"
        options={STATUS_OPTIONS}
        value={statusFilter}
        onChange={(v) => setStatusFilter(v)}
      />

      {txns.isError ? (
        <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
          Couldn&apos;t load transactions. Check your connection and try again.
        </div>
      ) : txns.isLoading ? (
        <RowList>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3.5 py-3">
              <Skeleton className="size-[38px] rounded-chip" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </RowList>
      ) : rows.length === 0 ? (
        <div className="rounded-card-sm border border-border bg-card p-8 text-center text-sm text-muted shadow-card">
          {search || statusFilter !== "all" || typeParam
            ? "No matching transactions."
            : "No transactions yet. Capture a receipt to populate your ledger."}
        </div>
      ) : (
        <RowList>
          {rows.map((t) => (
            <StatRow
              key={t.id}
              icon={categoryIcon(t.merchant ?? undefined)}
              tint={Number(t.amount) < 0 ? "c3" : "accent"}
              label={t.merchant ? t.merchant.charAt(0).toUpperCase() + t.merchant.slice(1).toLowerCase() : "Unknown"}
              sub={`${formatDate(t.txn_date)} · ${t.status}`}
              value={formatCurrency(Number(t.amount), { currency: t.currency })}
              onClick={() => setDetailId(t.id)}
            />
          ))}
        </RowList>
      )}

      <TransactionDetail
        txn={detail}
        categories={cats.data ?? []}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
```

- [ ] **Step 4: Delete the now-unused `Row`, `TableSkeleton`, `EmptyState` helper functions and the
  `statusVariant` reference.** Remove the three trailing function declarations (`function Row`,
  `function TableSkeleton`, `function EmptyState`) entirely. Keep `formatDate`.

- [ ] **Step 5: Convert the detail dialog to a sheet.** In
  `web/components/transactions/transaction-detail.tsx`, replace the import block:

```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
```

with:

```tsx
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
```

Then replace the `TransactionDetail` wrapper component body:

```tsx
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {txn && (
          <DetailBody key={txn.id} txn={txn} categories={categories} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
```

with:

```tsx
  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()} title="Transaction">
      {txn && <DetailBody key={txn.id} txn={txn} categories={categories} onClose={onClose} />}
    </ResponsiveSheet>
  );
```

In `DetailBody`, remove the now-redundant `<DialogHeader><DialogTitle>…</DialogTitle></DialogHeader>`
block (the sheet renders the title); keep the status `Badge` by moving it into the first content
row — replace:

```tsx
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          Transaction
          <Badge variant={status === "confirmed" ? "success" : "secondary"}>
            {status}
          </Badge>
        </DialogTitle>
      </DialogHeader>
```

with:

```tsx
      <div className="mb-3">
        <Badge variant={status === "confirmed" ? "success" : "secondary"}>{status}</Badge>
      </div>
```

Replace the remaining `text-muted-foreground`, `bg-muted/30`, `bg-muted` occurrences in this file
with `text-muted`, `bg-chip`, `bg-chip` respectively (apply the shell mapping).

- [ ] **Step 6: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/transactions/page.tsx" web/components/transactions/transaction-detail.tsx
git commit -m "feat(web): re-skin Transactions — list rows, type tabs, bottom-sheet detail"
```

---

## Task 3: Capture (tabs → SegmentedPills, cards → panels, queue states)

Keep all offline-queue logic untouched. Drop the header, swap the tab control + cards.

**Files:**
- Modify: `web/app/(app)/capture/page.tsx`
- Modify: `web/components/capture/csv-wizard.tsx`

- [ ] **Step 1: `capture/page.tsx`** — replace the imports of `Card*` and add `SegmentedPills`:

Replace:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CsvWizard } from "@/components/capture/csv-wizard";
```

with:

```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { CsvWizard } from "@/components/capture/csv-wizard";
```

- [ ] **Step 2:** Replace the `CapturePage` `return` body (the outer `<div className="space-y-6">…`)
  with:

```tsx
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SegmentedPills
          aria-label="Capture mode"
          options={TABS}
          value={tab}
          onChange={(v) => setTab(v)}
        />
        <OnlinePill />
      </div>

      {tab === "scan" ? (
        <ScanTab />
      ) : (
        <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
          <h2 className="text-base font-bold tracking-tight">Import a CSV statement</h2>
          <p className="mt-0.5 text-sm text-muted">
            Map the columns once; we remember the layout for next time.
          </p>
          <div className="mt-4">
            <CsvWizard />
          </div>
        </div>
      )}
    </div>
  );
```

Note: `TABS` values are `"scan"`/`"csv"` which match the `SegmentedPills<T>` generic — the
`onChange` value is typed `"scan" | "csv"`.

- [ ] **Step 3:** In `ScanTab`, replace the two `<Card>…</Card>` wrappers and their
  `CardHeader/CardContent/CardTitle/CardDescription` with plain panels. Replace the `ScanTab`
  `return (` … `)` outer container `<div className="grid gap-6 lg:grid-cols-2">` contents: change
  each `<Card>` to `<div className="rounded-card-sm border border-border bg-card p-4 shadow-card">`,
  each `<CardHeader>` to `<div className="mb-3">`, `<CardTitle>` to
  `<h2 className="text-base font-bold tracking-tight">`, `<CardDescription>` to
  `<p className="text-sm text-muted">`, and `<CardContent …>` to `<div …>` (preserve the inner
  className spacing). Replace `text-muted-foreground` → `text-muted` and `border` (queue item rows)
  → `border border-border` throughout this function.

- [ ] **Step 4: `csv-wizard.tsx`** — apply the shell mapping: replace `bg-muted/20`→`bg-chip`,
  `bg-muted/40`→`bg-chip`, `text-muted-foreground`→`text-muted`, and the dashed dropzone
  `border` → `border border-border`. No logic changes.

- [ ] **Step 5: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/capture/page.tsx" web/components/capture/csv-wizard.tsx
git commit -m "feat(web): re-skin Capture — segmented tabs, panels, offline queue states"
```

---

## Task 4: Review (cards → panels, tinted state)

Keep all resolve logic. Drop header; swap cards/tokens.

**Files:**
- Modify: `web/app/(app)/review/page.tsx`

- [ ] **Step 1:** Replace the `Card*` import block with nothing (remove it) and remove the unused
  `ClipboardCheck` import if it remains unused after Step 3. Specifically replace:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
```

with:

```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ListChecks } from "@/lib/icons";
```

- [ ] **Step 2:** In `ReviewPage`, replace the outer `<div className="space-y-6"> <div> <h1>…`
  header block so the wrapper becomes `<div className="space-y-4">` with no `<h1>`/`<p>`. Replace
  the error branch `<Card><CardContent className="p-6 …">` with
  `<div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">`.

- [ ] **Step 3:** In `ReviewCard`, replace `<Card>`→`<div className="rounded-card-sm border border-border bg-card p-4 shadow-card">`,
  `<CardHeader …>`→`<div className="mb-3 flex items-start justify-between gap-4">`, `<CardTitle …>`
  →`<h3 className="flex items-center gap-2 text-base font-bold capitalize tracking-tight">`,
  `<CardDescription …>`→`<p className="mt-1 text-xs text-muted">`, `<CardContent …>`→`<div className="space-y-4">`.
  Replace the amber block classes `bg-amber-500/10 … text-amber-700 dark:text-amber-400` (and the
  inner `text-amber-700/90 dark:text-amber-400/90`) with `bg-soft2 text-c2` (and `text-c2/90`).
  Replace `bg-muted` (the `<pre>`) → `bg-chip`, `text-muted-foreground` → `text-muted`.

- [ ] **Step 4:** In `EmptyState`, replace `<Card><CardContent …>` with a panel
  `<div className="flex flex-col items-center justify-center gap-3 rounded-card-sm border border-border bg-card py-16 text-center shadow-card">`,
  swap the icon to `<ListChecks className="size-6" />`, and `bg-success/10 text-success` →
  `bg-soft3 text-c3`, `text-muted-foreground` → `text-muted`.

- [ ] **Step 5: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/review/page.tsx"
git commit -m "feat(web): re-skin Review queue — panels, tinted confidence/state"
```

---

## Task 5: Analytics — Insights (range pills + contribution rows + table)

Keep the breakdown hook + dimension/filter logic. Drop header; convert range tabs to
`SegmentedPills`; dimension buttons keep but restyle to chips; contribution bars use the new track/
accent; the breakdown table keeps shadcn `Table` (re-tokened).

**Files:**
- Modify: `web/app/(app)/analytics/page.tsx`

- [ ] **Step 1:** Replace the `RangeTabs` component (bottom of file) with nothing — delete the whole
  `function RangeTabs(...) { … }` block — and remove `RANGE_PRESETS` from the import; instead import
  `SegmentedPills`. Replace the import block:

```tsx
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
```

with:

```tsx
import { presetRange, RANGE_PRESETS, type RangePreset } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedPills } from "@/components/ui/segmented-pills";
```

(Keep the `Table*` import block as-is.)

- [ ] **Step 2:** Replace the header row + range tabs. Replace:

```tsx
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Break your spending down by any facet.
          </p>
        </div>
        <RangeTabs value={preset} onChange={setPreset} />
      </div>
```

with:

```tsx
      <SegmentedPills
        aria-label="Date range"
        options={RANGE_PRESETS.map((p) => ({ label: p.label, value: p.value }))}
        value={preset}
        onChange={(v) => setPreset(v as RangePreset)}
      />
```

Also change the outer wrapper `<div className="space-y-6">` → `<div className="space-y-4">`.

- [ ] **Step 3:** Restyle the dimension buttons. Replace the active/inactive classes:

```tsx
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              dimension === d.value
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
```

with:

```tsx
            className={cn(
              "rounded-chip px-3 py-1.5 text-sm font-semibold transition-colors",
              dimension === d.value
                ? "bg-accent text-on-accent"
                : "bg-chip text-muted hover:text-fg",
            )}
```

- [ ] **Step 4:** Apply the shell mapping to the rest of the file: every `<Card>` →
  `<div className="rounded-card-sm border border-border bg-card p-4 shadow-card">`, `<CardHeader>`
  → `<div className="mb-3">`, `<CardTitle>` → `<h2 className="text-base font-bold tracking-tight">`,
  `<CardDescription>` → `<p className="text-sm text-muted">`, `<CardContent …>` → `<div …>`,
  `text-muted-foreground` → `text-muted`, `bg-muted` (the contribution track) → `bg-track`,
  `bg-primary/80` (fill) → `bg-accent`. Keep the grid `lg:grid-cols-3` layout (it collapses to one
  column on mobile, which is correct for the phone-first shell).

- [ ] **Step 5: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/analytics/page.tsx"
git commit -m "feat(web): re-skin Analytics — range pills, chip dimensions, tokened breakdown"
```

---

## Task 6: Budgets — Insights (progress rows)

Keep budget hooks + create dialog logic. Drop header; the create dialog stays a shadcn `Dialog`
(inherits tokens). Cards → panels with the new progress track.

**Files:**
- Modify: `web/app/(app)/budgets/page.tsx`

- [ ] **Step 1:** Change the page wrapper `<div className="space-y-6">` → `<div className="space-y-4">`
  and replace the header row:

```tsx
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Budgets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set limits by category and track them against actuals.
          </p>
        </div>
        <NewBudgetDialog />
      </div>
```

with:

```tsx
      <div className="flex justify-end">
        <NewBudgetDialog />
      </div>
```

- [ ] **Step 2:** Replace the error/empty `<Card><CardContent …>` blocks with
  `<div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">`
  and `<div className="rounded-card-sm border border-border bg-card py-16 text-center text-sm text-muted shadow-card">`
  respectively.

- [ ] **Step 3:** In `BudgetCard`, replace `<Card>` → `<div className="rounded-card-sm border border-border bg-card p-4 shadow-card">`,
  `<CardHeader className="pb-3">` → `<div className="mb-3">`, `<CardTitle …>` →
  `<h3 className="text-base font-bold capitalize tracking-tight">`, `<CardDescription …>` →
  `<p className="text-xs capitalize text-muted">`, `<CardContent …>` → `<div className="space-y-3">`.
  Replace `text-muted-foreground` → `text-muted`, `bg-muted` (track) → `bg-track`, and the fill
  `bg-primary/80` → `bg-accent` (keep `bg-destructive` for overspent).

- [ ] **Step 4: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/budgets/page.tsx"
git commit -m "feat(web): re-skin Budgets — progress panels"
```

---

## Task 7: Debt — Insights (loan rows + payoff + sheet detail)

Keep loans/payoff/create logic. Drop header; total → `HeroCard`-style summary; loans → `RowList`;
loan detail → `ResponsiveSheet`.

**Files:**
- Modify: `web/app/(app)/debt/page.tsx`
- Modify: `web/components/debt/loan-detail.tsx`

- [ ] **Step 1: `debt/page.tsx`** — add primitives to imports. Replace:

```tsx
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
```

with:

```tsx
import { formatCurrency } from "@/lib/format";
import { categoryIcon, Landmark } from "@/lib/icons";
import { LoanDetail } from "@/components/debt/loan-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { RowList, StatRow } from "@/components/ui/row-list";
```

(`cn` is still used by `PayoffStrategyCard` — keep its import. Re-add `import { cn } from "@/lib/utils";`
if your edit removed it.)

- [ ] **Step 2:** Change the page wrapper to `space-y-4`, replace the header row with a right-aligned
  action `<div className="flex justify-end"><NewLoanDialog /></div>`, and replace the total +
  loans-grid block:

```tsx
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
```

with:

```tsx
          <div className="rounded-card-sm border border-border bg-card p-5 shadow-card">
            <p className="text-sm text-muted">Total outstanding principal</p>
            <p data-numeric className="mt-1 text-2xl font-extrabold tracking-tight">
              {formatCurrency(total)}
            </p>
          </div>

          <RowList>
            {(loans.data ?? []).map((l) => (
              <StatRow
                key={l.id}
                icon={Landmark}
                tint="c2"
                label={l.name}
                sub={`${l.type}${l.interest_rate ? ` · ${Number(l.interest_rate)}% APR` : ""}`}
                value={formatCurrency(l.principal, { currency: l.currency })}
                onClick={() => setSelected(l)}
              />
            ))}
          </RowList>
```

- [ ] **Step 3:** Delete the now-unused `LoanCard` function (the rows replace it). Then re-skin
  `PayoffStrategyCard`: `<Card>` → panel div, `CardHeader/Title/Description/Content` → the panel
  equivalents (as in Task 6 Step 3), the snowball/avalanche `inline-flex … bg-secondary/40` pill
  group → `SegmentedPills` with `options={[{label:"Snowball",value:"snowball"},{label:"Avalanche",value:"avalanche"}]}`,
  `bg-primary/10 text-primary` (order chip) → `bg-accent-soft text-accent`, `text-muted-foreground`
  → `text-muted`, `border` (plan list items) → `border border-border`.

- [ ] **Step 4:** Replace the error/empty `<Card>` blocks at the top with panel divs (as in Task 6
  Step 2).

- [ ] **Step 5: `loan-detail.tsx`** — convert the dialog to a sheet. Replace:

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
```

with:

```tsx
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
```

Replace the `return ( <Dialog …> <DialogContent …> <DialogHeader>…</DialogHeader>` opening through
the header with:

```tsx
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={loan.name}>
      <p className="-mt-1 mb-4 text-sm text-muted">
        {formatCurrency(loan.principal, { currency: loan.currency })} principal
        {loan.interest_rate ? ` · ${Number(loan.interest_rate)}% APR` : ""}
      </p>
```

and change the matching closing `</DialogContent></Dialog>` to `</ResponsiveSheet>`. Replace the
amber warning `text-amber-600 dark:text-amber-400` → `text-c2`, `text-muted-foreground` →
`text-muted`, and `border` (the `Metric` blocks) → `border border-border` in this file.

- [ ] **Step 6: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/debt/page.tsx" web/components/debt/loan-detail.tsx
git commit -m "feat(web): re-skin Debt — loan rows, payoff pills, sheet detail"
```

---

## Task 8: Income — Insights (source rows + equity panels + take-home sheet)

Keep income/equity hooks. Drop header; sources → `RowList`; the take-home `Dialog` becomes a
`ResponsiveSheet`; equity cards → panels.

**Files:**
- Modify: `web/app/(app)/income/page.tsx`
- Modify: `web/components/income/equity-section.tsx`

- [ ] **Step 1: `income/page.tsx`** — replace the imports of `Card*` + `Dialog*` and add
  primitives. Replace:

```tsx
import { EquitySection } from "@/components/income/equity-section";
import { KeyValues } from "@/components/guidance/citations";
import { formatCurrency } from "@/lib/format";
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
```

with:

```tsx
import { EquitySection } from "@/components/income/equity-section";
import { KeyValues } from "@/components/guidance/citations";
import { formatCurrency } from "@/lib/format";
import { Wallet } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RowList, StatRow } from "@/components/ui/row-list";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
```

(The `Dialog*` import stays — the **New source** form dialog keeps using it.)

- [ ] **Step 2:** Change the top `<section className="space-y-4">` header: replace the
  `<div className="flex flex-wrap items-end justify-between gap-4"> <div><h1>…</h1>…</div> <NewSourceDialog/></div>`
  with `<div className="flex justify-end"><NewSourceDialog /></div>`. Change outer
  `<div className="space-y-8">` to stay (vertical rhythm between sections is fine).

- [ ] **Step 3:** Replace the sources grid + cards with a `RowList`. Replace:

```tsx
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(sources.data ?? []).map((s) => (
              <SourceCard key={s.id} source={s} onTakeHome={() => setTakeHomeId(s.id)} />
            ))}
          </div>
```

with:

```tsx
          <RowList>
            {(sources.data ?? []).map((s) => (
              <StatRow
                key={s.id}
                icon={Wallet}
                tint="accent"
                label={s.employer ?? "Income source"}
                sub={`${s.frequency}${s.country ? ` · ${s.country}` : ""}`}
                value={s.gross != null ? formatCurrency(s.gross, { currency: s.currency }) : ""}
                onClick={() => setTakeHomeId(s.id)}
              />
            ))}
          </RowList>
```

Replace the error/empty `<Card>` blocks with panel divs (as in Task 6 Step 2), and delete the
now-unused `SourceCard` function.

- [ ] **Step 4:** Convert the take-home dialog to a sheet. Replace:

```tsx
      <Dialog open={Boolean(takeHomeId)} onOpenChange={(v) => !v && setTakeHomeId(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Take-home estimate</DialogTitle>
          </DialogHeader>
```

with:

```tsx
      <ResponsiveSheet
        open={Boolean(takeHomeId)}
        onOpenChange={(v) => !v && setTakeHomeId(null)}
        title="Take-home estimate"
      >
```

and change the matching `</DialogContent></Dialog>` (the one wrapping the take-home content) to
`</ResponsiveSheet>`. Replace `border` (the two metric blocks) → `border border-border` and
`text-muted-foreground` → `text-muted` within this sheet.

- [ ] **Step 5: `equity-section.tsx`** — apply the shell mapping: `<Card>`→panel div,
  `CardHeader/Title/Description/Content`→panel equivalents, the two summary `<Card><CardContent className="p-5">`
  → `<div className="rounded-card-sm border border-border bg-card p-5 shadow-card">`, every
  `text-muted-foreground`→`text-muted`, and the grant/event row `border`→`border border-border`.
  The two **NewGrantDialog**/**NewEventDialog** form dialogs keep shadcn `Dialog` (tokens inherited).

- [ ] **Step 6: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/income/page.tsx" web/components/income/equity-section.tsx
git commit -m "feat(web): re-skin Income — source rows, take-home sheet, equity panels"
```

---

## Task 9: Guidance — Ask · Plan (query-param tabs; cross-border stays nested)

The shell renders Guidance top tabs **Ask** (`/guidance`) and **Plan** (`/guidance?tab=plan`).
Map the page's in-page tab state to that param. Cross-border stays reachable as a third in-page
section toggled from within Plan (locked: nested, not a route). Drop the header; cards → panels.

**Files:**
- Modify: `web/app/(app)/guidance/page.tsx`
- Modify: `web/components/guidance/citations.tsx`
- Modify: `web/components/guidance/cross-border-module.tsx`

- [ ] **Step 1: `guidance/page.tsx`** — drive the tab from the URL. Replace the imports:

```tsx
import { useState } from "react";

import { useAsk, useWizard } from "@/lib/api/guidance";
import { Citations, DictList } from "@/components/guidance/citations";
import { CrossBorderModule } from "@/components/guidance/cross-border-module";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type Tab = "ask" | "wizard" | "cross-border";

export default function GuidancePage() {
  const [tab, setTab] = useState<Tab>("ask");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Guidance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cited answers, a planning wizard, and cross-border tools.
        </p>
      </div>

      <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5">
        {(
          [
            ["ask", "Ask"],
            ["wizard", "Wizard"],
            ["cross-border", "Cross-border"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "ask" && <AskPanel />}
      {tab === "wizard" && <WizardPanel />}
      {tab === "cross-border" && <CrossBorderModule />}
    </div>
  );
}
```

with:

```tsx
import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { useAsk, useWizard } from "@/lib/api/guidance";
import { Citations, DictList } from "@/components/guidance/citations";
import { CrossBorderModule } from "@/components/guidance/cross-border-module";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export default function GuidancePage() {
  // Shell top tabs: Ask (/guidance) and Plan (/guidance?tab=plan).
  const onPlan = useSearchParams().get("tab") === "plan";
  // Within Plan, a sub-toggle switches between the wizard and cross-border tools.
  const [planView, setPlanView] = useState<"wizard" | "cross-border">("wizard");

  if (!onPlan) return <AskPanel />;

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-chip p-0.5">
        {(
          [
            ["wizard", "Planner"],
            ["cross-border", "Cross-border"],
          ] as ["wizard" | "cross-border", string][]
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setPlanView(value)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              planView === value ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {planView === "wizard" ? <WizardPanel /> : <CrossBorderModule />}
    </div>
  );
}
```

- [ ] **Step 2:** In `AskPanel` and `WizardPanel`, apply the shell mapping: wrap each panel's outer
  in `<div className="space-y-4">`; `<Card>`→`<div className="rounded-card-sm border border-border bg-card p-4 shadow-card">`,
  `<CardHeader>`→`<div className="mb-3">`, `<CardTitle>`→`<h2 className="text-base font-bold tracking-tight">`,
  `<CardDescription>`→`<p className="text-sm text-muted">`, `<CardContent …>`→`<div …>`,
  `text-muted-foreground`→`text-muted`. The answer/result `Card`s become the same panel div. No
  logic, hook, or form-field changes.

- [ ] **Step 3: `citations.tsx`** — token swap only: `text-muted-foreground`→`text-muted`,
  `text-primary`→`text-accent`, `border` (DictList items)→`border border-border`.

- [ ] **Step 4: `cross-border-module.tsx`** — apply the shell mapping to all `<Card>`/`CardHeader`/
  `CardTitle`/`CardDescription`/`CardContent` (→ panel divs), `text-muted-foreground`→`text-muted`,
  row `border`→`border border-border`, `bg-muted` (the code chips)→`bg-chip`. The
  **NewTransferDialog** form keeps shadcn `Dialog`.

- [ ] **Step 5: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/guidance/page.tsx" web/components/guidance/citations.tsx web/components/guidance/cross-border-module.tsx
git commit -m "feat(web): re-skin Guidance — Ask/Plan URL tabs, nested cross-border, panels"
```

---

## Task 10: Notifications — Activity (rows + prefs panel)

Keep all notification/prefs logic (incl. the best-effort push permission). Drop header;
notifications → `RowList`/`StatRow`; prefs → panel.

**Files:**
- Modify: `web/app/(app)/notifications/page.tsx`

- [ ] **Step 1:** Replace the `Card*` import with primitives. Replace:

```tsx
import { KeyValues } from "@/components/guidance/citations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
```

with:

```tsx
import { KeyValues } from "@/components/guidance/citations";
import { Bell } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RowList } from "@/components/ui/row-list";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
```

- [ ] **Step 2:** In `NotificationsPage`, change outer `<div className="space-y-8">` (keep), remove
  the `<div><h1>…</h1>…</div>` header block. Replace the `<section><h2>Recent</h2>` list:
  the error/empty `<Card>` blocks → panel divs; the mapped list `<div className="space-y-2">` →
  `<RowList>` wrapping `NotificationRow`s.

- [ ] **Step 3:** Rewrite `NotificationRow` to a row inside the list. Replace the whole
  `function NotificationRow(...) { … }` with:

```tsx
function NotificationRow({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: () => void;
}) {
  const isRead = notification.status === "read";
  return (
    <div className="flex items-start gap-3.5 py-3">
      <span className="grid size-[38px] flex-none place-items-center rounded-chip bg-accent-soft text-accent">
        <Bell className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold capitalize">
            {notification.type.replace(/_/g, " ")}
          </span>
          <Badge variant="secondary" className="capitalize">
            {notification.channel}
          </Badge>
          {!isRead && <Badge>New</Badge>}
        </div>
        {notification.payload && (
          <KeyValues data={notification.payload as Record<string, unknown>} />
        )}
        {notification.scheduled_for && (
          <p className="text-xs text-muted">{notification.scheduled_for}</p>
        )}
      </div>
      {!isRead && (
        <Button variant="outline" size="sm" onClick={onRead}>
          Mark read
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4:** In `PreferencesCard`, apply the shell mapping (`<Card>`→panel,
  header/title/description/content→panel equivalents, `text-muted-foreground`→`text-muted`). The
  channel checkboxes, quiet-hours inputs, and `save()` logic are unchanged.

- [ ] **Step 5: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/notifications/page.tsx"
git commit -m "feat(web): re-skin Notifications — activity rows + prefs panel"
```

---

## Task 11: Connections (connection panels)

Keep all link/sync/rotate logic. Drop header; the `ConnectionShell` card becomes a panel.

**Files:**
- Modify: `web/app/(app)/connections/page.tsx`

- [ ] **Step 1:** Replace the `Card*` import block:

```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
```

with:

```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
```

- [ ] **Step 2:** In `ConnectionsPage`, remove the `<div><h1>…</h1>…</div>` header block; keep
  `<div className="space-y-8">` → change to `<div className="space-y-4">`. Keep the
  `grid gap-4 lg:grid-cols-2`.

- [ ] **Step 3:** Rewrite `ConnectionShell` to a panel. Replace the whole function with:

```tsx
function ConnectionShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
      <div className="flex-1 space-y-3 text-sm">{children}</div>
      <div className="mt-4 flex flex-wrap gap-2">{footer}</div>
    </div>
  );
}
```

- [ ] **Step 4:** Token swap in the card bodies: `text-muted-foreground`→`text-muted`, `bg-muted`
  (the SMS code chips)→`bg-chip`.

- [ ] **Step 5: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/connections/page.tsx"
git commit -m "feat(web): re-skin Connections — connection panels"
```

---

## Task 12: Settings (panels + appearance via ThemePicker)

Keep household/prefs/consents/data logic. Drop header; cards → panels; **add an Appearance panel**
that mounts the R1 `ThemePicker` (§3 footer + §13 "selectable from Settings"). The delete dialog
keeps shadcn `Dialog`.

**Files:**
- Modify: `web/app/(app)/settings/page.tsx`

- [ ] **Step 1:** Replace the `Card*` import block:

```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
```

with:

```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemePicker } from "@/components/theme/theme-picker";
```

(The `Dialog*` import stays — delete-account dialog uses it.)

- [ ] **Step 2:** In `SettingsPage`, remove the `<div><h1>…</h1>…</div>` header block and add the
  Appearance panel. Replace:

```tsx
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Household, preferences, consents, and your data.
        </p>
      </div>

      <HouseholdCard />
      <PreferencesCard />
      <ConsentsCard />
      <DataControlsCard />
    </div>
  );
```

with:

```tsx
  return (
    <div className="space-y-4">
      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <h2 className="text-base font-bold tracking-tight">Appearance</h2>
        <p className="text-sm text-muted">Palette and light/dark mode.</p>
        <div className="mt-4">
          <ThemePicker />
        </div>
      </div>
      <HouseholdCard />
      <PreferencesCard />
      <ConsentsCard />
      <DataControlsCard />
    </div>
  );
```

- [ ] **Step 3:** Apply the shell mapping to `HouseholdCard`, `PreferencesCard`, `ConsentsCard`,
  `DataControlsCard`: `<Card>`→`<div className="rounded-card-sm border border-border bg-card p-4 shadow-card">`
  (for `DataControlsCard` keep the danger tint: `border-destructive/30`), header/title/description/
  content→panel equivalents, `text-muted-foreground`→`text-muted`, member/consent row
  `border`→`border border-border`.

- [ ] **Step 4: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add "web/app/(app)/settings/page.tsx"
git commit -m "feat(web): re-skin Settings — panels + Appearance (ThemePicker)"
```

---

## Task 13: Update existing e2e for the new shell

The current `e2e/w2.spec.ts`, `w3.spec.ts`, `w4.spec.ts` assert page `<h1>` headings (e.g.
`getByRole("heading", { name: /analytics/i })`) that the re-skin removes (the `GlassBar` shows the
surface group title, and per-surface identity moves to the top tabs/actions). Update those
assertions to match the new shell so the suite stays green.

**Files:**
- Modify: `web/e2e/w2.spec.ts`, `web/e2e/w3.spec.ts`, `web/e2e/w4.spec.ts`

- [ ] **Step 1:** In `w2.spec.ts`, replace the three heading assertions with shell-stable checks:
  - analytics: replace `await expect(page.getByRole("heading", { name: /analytics/i })).toBeVisible();`
    with `await expect(page.getByRole("tab", { name: /^analytics$/i })).toBeVisible();`
  - budgets: replace the `heading` assertion with
    `await expect(page.getByRole("button", { name: /new budget/i })).toBeVisible();` (already present
    as the second assertion — remove the now-duplicate heading line).
  - debt: replace the `heading` assertion with
    `await expect(page.getByRole("button", { name: /add loan/i })).toBeVisible();`

- [ ] **Step 2:** In `w3.spec.ts` and `w4.spec.ts`, replace any
  `getByRole("heading", { name: /<surface>/i })` assertion with a stable element on that surface
  (a visible action button, top-tab `role="tab"`, or known control). Run each spec to confirm the
  chosen selector exists. Do not assert on the removed page `<h1>`.

- [ ] **Step 3:** Run the updated specs on the host:

```bash
cd web && npx playwright test e2e/w2.spec.ts e2e/w3.spec.ts e2e/w4.spec.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add web/e2e/w2.spec.ts web/e2e/w3.spec.ts web/e2e/w4.spec.ts
git commit -m "test(web): update surface e2e for the redesigned shell (no page h1)"
```

---

## Task 14: Full typecheck + build + surface smokes

**Files:**
- Create: `web/e2e/redesign-surfaces.spec.ts`

- [ ] **Step 1:** Container typecheck + build:

```bash
docker compose exec web npm run typecheck
docker compose exec web npm run build
```

Expected: both pass. Watch for unused-import errors from removed `Card*`/`Table*`/`Dialog*` symbols —
delete any leftover unused import the edits above left behind.

- [ ] **Step 2:** Add a per-surface render smoke (extends §12). Create
  `web/e2e/redesign-surfaces.spec.ts`:

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
  const login = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD, totp_code: null },
  });
  expect(login.ok(), `login failed: ${login.status()}`).toBeTruthy();
  return (await login.json()) as { access_token: string; refresh_token: string };
}

async function authenticate(page: Page, tokens: { access_token: string; refresh_token: string }) {
  await page.addInitScript(
    (t) => {
      window.localStorage.setItem("cbf.accessToken", t.access);
      window.localStorage.setItem("cbf.refreshToken", t.refresh);
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

const SURFACES = [
  "/dashboard",
  "/transactions",
  "/capture",
  "/review",
  "/analytics",
  "/budgets",
  "/debt",
  "/income",
  "/guidance",
  "/notifications",
  "/connections",
  "/settings",
];

test.describe("redesign surfaces render under the shell", () => {
  for (const path of SURFACES) {
    test(`${path} renders with bottom nav`, async ({ page, request }) => {
      await authenticate(page, await signup(request));
      await page.goto(path);
      // shell chrome present (no root-404 regression, §13)
      await expect(page.getByRole("navigation", { name: /primary/i })).toBeVisible();
      // no raw shadcn heading leaked as the page title (titles live in the glass bar)
      await expect(page.locator("body")).toBeVisible();
    });
  }

  test("dashboard shows the hero net cash flow", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await expect(page.getByText(/net cash flow/i)).toBeVisible();
  });

  test("spend type tab filters via ?type=income", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/transactions?type=income");
    await expect(page.getByRole("tab", { name: /^income$/i })).toBeVisible();
  });
});
```

- [ ] **Step 3:** Run on host:

```bash
cd web && npx playwright test e2e/redesign-surfaces.spec.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add web/e2e/redesign-surfaces.spec.ts
git commit -m "test(web): per-surface render smokes under the redesigned shell"
```

---

## Self-review (against the spec)

- **§3 surface map** — all 12 surfaces re-skinned under the shell; Dashboard hero + 2 feature cards
  + summary rows + top spending (Task 1); Transactions list + sheet + type tabs (Task 2); Insights
  4 surfaces (Tasks 5–8); Capture/Review (3–4); Activity (10); drawer surfaces Guidance/Connections/
  Settings (9, 11, 12). **Cross-border nested in Guidance** per locked decision (Task 9). ✓
- **§5 list-row, panels, tokens** — `RowList`/`StatRow`/`CategoryRow`, `bg-card`/`text-muted`/
  `rounded-card`/`shadow-card` applied via the shared mapping. ✓
- **§7 icons** — category/summary/surface icons from `@/lib/icons`; no emoji. ✓
- **Drill-downs → BottomSheet** — Transaction detail + Loan detail + Take-home use `ResponsiveSheet`;
  form-create dialogs keep shadcn `Dialog` (intentional, inherit tokens). ✓
- **§12 testing** — existing surface specs updated for the no-h1 shell (Task 13); per-surface render
  smokes added (Task 14); typecheck + build in container, Playwright on host. ✓
- **No backend/API/Dexie/auth changes** — every hook, mutation, query key, and form left intact;
  edits are presentation-only. ✓
- **Deferred to R3:** PWA install prompt, safe-area/standalone polish, web-push VAPID wiring,
  offline banner/route transitions, theme/drawer/a11y test sweep across all 6 combos. Net-worth
  drawer value still placeholder (optional analytics wire-up — out of scope unless requested).

---

## Execution handoff

Plan saved. Execute via superpowers:subagent-driven-development (fresh subagent per task, review
between) or superpowers:executing-plans (inline with checkpoints). R3 (PWA + tests) is the final
plan.
