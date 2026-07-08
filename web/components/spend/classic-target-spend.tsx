"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Combine } from "lucide-react";
import { categoryIcon } from "@/lib/icons";
import { toast } from "sonner";

import {
  useCategories,
  useMergeTransactions,
  useTransactions,
} from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RowList, StatRow } from "@/components/ui/row-list";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { TransactionDetail } from "@/components/transactions/transaction-detail";
import {
  categoryRowsWithDeltas,
  largestPurchase,
  merchantRowsWithDeltas,
  rangeIncome,
  rangeSpend,
  spendSeries,
  topMover,
} from "@/lib/spend/derive";
import { bucketRange, inRange, spanDays, useSpendPeriod, ymd } from "@/lib/spend/period";
import { InsightStrip } from "@/components/spend/insight-strip";
import { SpendOverTime } from "@/components/spend/spend-over-time";
import { ShareDonut } from "@/components/spend/share-donut";
import { CategoryList } from "@/components/spend/category-list";
import { MerchantList } from "@/components/spend/merchant-list";
import { granularityLabel } from "@/components/spend/granularity";
import {
  AMOUNT_BANDS,
  EMPTY_FILTERS,
  FilterToolbar,
  type SpendFilters,
} from "@/components/spend/filter-toolbar";
import { PeriodPicker } from "@/components/spend/period-picker";
import { DrillStack } from "@/components/spend/drill-stack";
import type { DrillFrame } from "@/components/spend/drill-nav";
import { useAnalyst } from "@/components/dashboard/analyst/use-analyst";
import { QuickAdd } from "@/components/spend/quick-add";

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

function formatDate(d: string) {
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? d
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function ClassicTargetSpend() {
  const txns = useTransactions();
  const cats = useCategories();
  const merge = useMergeTransactions();

  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const catId = params.get("cat");
  const merchantParam = params.get("merchant");
  const view = params.get("view"); // "all" | "merchants" | "items" | "recurring" | null (=categories)
  const qParam = params.get("q") ?? "";

  const { period } = useSpendPeriod();
  const { from, to, prevFrom, prevTo, buckets, granularity } = period;

  // Keep the AI analyst's window aligned with the period the user is viewing.
  const { setRange: setAnalystRange } = useAnalyst();
  useEffect(() => { setAnalystRange({ from, to }); }, [from, to, setAnalystRange]);

  const [filters, setFilters] = useState<SpendFilters>({ ...EMPTY_FILTERS, q: qParam });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rootFrame, setRootFrame] = useState<DrillFrame | null>(null);

  const allTxns = useMemo(() => txns.data ?? [], [txns.data]);
  const allCats = useMemo(() => cats.data ?? [], [cats.data]);
  const currency = allTxns[0]?.currency ?? "USD";
  const byId = useMemo(() => new Map(allCats.map((c) => [c.id, c])), [allCats]);

  // A merchant counts as "recurring" when it appears in 3+ distinct months.
  const recurringMerchants = useMemo(() => {
    const months = new Map<string, Set<string>>();
    for (const t of allTxns) {
      const m = (t.merchant ?? "").toLowerCase();
      if (!m) continue;
      if (!months.has(m)) months.set(m, new Set());
      months.get(m)!.add(t.txn_date.slice(0, 7));
    }
    return new Set([...months].filter(([, s]) => s.size >= 3).map(([m]) => m));
  }, [allTxns]);

  // Children of a selected parent category (for the Category filter).
  const childrenOf = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of allCats) {
      if (!c.parent_id) continue;
      if (!m.has(c.parent_id)) m.set(c.parent_id, new Set());
      m.get(c.parent_id)!.add(c.id);
    }
    return m;
  }, [allCats]);

  // Flat-ledger rows respect the active period + all toolbar filters.
  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const band = AMOUNT_BANDS.find((b) => b.value === filters.amount) ?? AMOUNT_BANDS[0];
    const kids = filters.categoryId ? childrenOf.get(filters.categoryId) : null;
    return allTxns
      .filter((t) => inRange(t.txn_date, from, to))
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
      .filter((t) => {
        if (filters.direction === "out") return Number(t.amount) < 0;
        if (filters.direction === "in") return Number(t.amount) > 0;
        return true;
      })
      .filter((t) => !filters.recurring || recurringMerchants.has((t.merchant ?? "").toLowerCase()))
      .filter((t) => {
        if (!filters.categoryId) return true;
        return t.category_id === filters.categoryId || (t.category_id != null && (kids?.has(t.category_id) ?? false));
      })
      .filter((t) => {
        const abs = Math.abs(Number(t.amount));
        return abs >= band.min && abs < band.max;
      })
      .filter((t) => {
        if (!q) return true;
        return (
          (t.merchant ?? "").toLowerCase().includes(q) ||
          (t.notes ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.txn_date.localeCompare(a.txn_date));
  }, [allTxns, filters, recurringMerchants, statusFilter, childrenOf, from, to]);

  const ledgerTotal = useMemo(() => rows.reduce((a, t) => a + Number(t.amount), 0), [rows]);

  const detail = useMemo(
    () => allTxns.find((t) => t.id === detailId) ?? null,
    [allTxns, detailId],
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onMerge() {
    const ids = [...selected];
    if (ids.length < 2) return;
    try {
      await merge.mutateAsync({ ids });
      toast.success(`Merged ${ids.length} transactions`);
      setSelected(new Set());
    } catch {
      toast.error("Couldn't merge those transactions");
    }
  }

  function exportCsv() {
    const catName = (id: string | null | undefined) => (id ? byId.get(id)?.name ?? "" : "");
    const header = ["date", "merchant", "category", "amount", "currency", "status", "notes"];
    const lines = rows.map((t) =>
      [t.txn_date, t.merchant ?? "", catName(t.category_id), t.amount, t.currency, t.status, (t.notes ?? "").replace(/[\n,]/g, " ")]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- drill openers — feed the shared DrillStack via rootFrame --------------
  // Category / merchant roots also write the URL so they stay deep-linkable;
  // bucket / transaction roots (opened from charts/cards) are state-only.
  function withRootDrill(key: "cat" | "merchant", val: string) {
    const sp = new URLSearchParams(params.toString());
    sp.delete("cat");
    sp.delete("merchant");
    sp.set(key, val);
    return `${pathname}?${sp.toString()}`;
  }
  function openCategory(id: string) {
    setRootFrame({ kind: "category", id });
    router.replace(withRootDrill("cat", id), { scroll: false });
  }
  function openMerchant(name: string) {
    setRootFrame({ kind: "merchant", name });
    router.replace(withRootDrill("merchant", name), { scroll: false });
  }
  function openBucket(b: { from: string; to: string; label: string }) {
    setRootFrame({ kind: "bucket", ...b });
  }
  function openTransaction(id: string) {
    setRootFrame({ kind: "transaction", id });
  }
  function closeDrill() {
    setRootFrame(null);
    const sp = new URLSearchParams(params.toString());
    sp.delete("cat");
    sp.delete("merchant");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Seed the drill from a deep link (?cat= / ?merchant=) on first load / nav.
  useEffect(() => {
    if (catId) setRootFrame({ kind: "category", id: catId });
    else if (merchantParam) setRootFrame({ kind: "merchant", name: merchantParam });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catId, merchantParam]);

  const isError = txns.isError;
  const isLoading = txns.isLoading;

  if (isError) {
    return (
      <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
        Couldn&apos;t load transactions. Check your connection and try again.
      </div>
    );
  }

  // ---- tab bodies -------------------------------------------------------------
  let body: React.ReactNode;

  if (view === "all") {
    body = (
      <>
        <QuickAdd categories={allCats} defaultCurrency={currency} />
        <FilterToolbar filters={filters} onChange={setFilters} categories={allCats} currency={currency} onExport={exportCsv} />
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-muted">
            {isLoading ? "Loading…" : `${rows.length} shown · ${formatCurrency(ledgerTotal, { currency })}`}
          </p>
          {selected.size >= 2 && (
            <Button size="sm" onClick={onMerge} disabled={merge.isPending}>
              <Combine className="size-4" /> Merge {selected.size}
            </Button>
          )}
        </div>
        <SegmentedPills
          aria-label="Status filter"
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
        />
        {isLoading ? (
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
            {filters.q || statusFilter !== "all" || filters.categoryId || filters.amount !== "any" || filters.direction !== "all" || filters.recurring
              ? "No matching transactions in this period."
              : "No transactions in this period. Capture a receipt or widen the range."}
          </div>
        ) : (
          <RowList>
            {rows.map((t) => (
              <div key={t.id} className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  aria-label={`Select ${t.merchant ?? "transaction"}`}
                  checked={selected.has(t.id)}
                  onChange={() => toggleSelect(t.id)}
                  className="size-4 flex-none accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <StatRow
                    icon={categoryIcon(t.merchant ?? undefined)}
                    tint={Number(t.amount) >= 0 ? "c3" : "accent"}
                    label={t.merchant ? t.merchant.charAt(0).toUpperCase() + t.merchant.slice(1).toLowerCase() : "Unknown"}
                    sub={`${formatDate(t.txn_date)} · ${t.status}`}
                    value={formatCurrency(Number(t.amount), { currency: t.currency })}
                    onClick={() => setDetailId(t.id)}
                  />
                </div>
              </div>
            ))}
          </RowList>
        )}
      </>
    );
  } else {
    // ---- L1 categories (default) ---------------------------------------------
    if (isLoading) {
      body = (
        <>
          <Skeleton className="h-24" />
          <div className="grid gap-3 lg:grid-cols-3">
            <Skeleton className="h-[240px] lg:col-span-2" />
            <Skeleton className="h-[240px]" />
          </div>
          <Skeleton className="h-64" />
        </>
      );
    } else {
      const catRows = categoryRowsWithDeltas(allTxns, allCats, from, to, prevFrom, prevTo);
      const merchantRows = merchantRowsWithDeltas(allTxns, allCats, from, to, prevFrom, prevTo);
      const spent = rangeSpend(allTxns, allCats, from, to);
      const prevSpent = prevFrom && prevTo ? rangeSpend(allTxns, allCats, prevFrom, prevTo) : 0;
      const points = spendSeries(allTxns, allCats, buckets, from, granularity);
      const income = rangeIncome(allTxns, allCats, from, to);
      const incomePct = income > 0 ? (spent / income) * 100 : null;

      // Daily average over the elapsed window (clamps "all time" to first txn).
      const today = ymd(new Date());
      const end = to < today ? to : today;
      const inWindow = allTxns.map((t) => t.txn_date.slice(0, 10)).filter((d) => d >= from && d <= end);
      const avgFrom = period.presetKey === "all" && inWindow.length ? inWindow.reduce((m, d) => (d < m ? d : m), end) : from;
      const dailyAvg = spent / Math.max(1, spanDays(avgFrom, end));

      body = (
        <>
          <InsightStrip
            spent={spent}
            prevSpent={prevSpent}
            mover={topMover(catRows)}
            unusual={largestPurchase(allTxns, allCats, from, to)}
            dailyAvg={dailyAvg}
            incomePct={incomePct}
            currency={currency}
            onMover={openCategory}
            onLargest={openTransaction}
          />
          <div className="grid items-stretch gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SpendOverTime points={points} granularityLabel={granularityLabel(granularity)} onBarClick={(bar) => openBucket(bucketRange(bar.key, granularity))} />
            </div>
            <ShareDonut rows={catRows} currency={currency} onSliceClick={openCategory} />
          </div>
          <CategoryList rows={catRows} currency={currency} onSelect={openCategory} />
          <div data-testid="top-merchants-card">
            <MerchantList rows={merchantRows.slice(0, 8)} currency={currency} onSelect={openMerchant} />
          </div>
        </>
      );
    }
  }

  return (
    <div className="space-y-3">
      <PeriodPicker />
      {body}

      {/* one slide-over stack — pushes slide left/right, no navigation away */}
      <DrillStack
        rootFrame={rootFrame}
        rootBackLabel="Spend"
        onClose={closeDrill}
        txns={allTxns}
        cats={allCats}
        currency={currency}
        period={period}
      />

      <TransactionDetail
        txn={detail}
        categories={allCats}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
