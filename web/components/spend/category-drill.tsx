"use client";

import { useMemo } from "react";
import type { Category, Transaction } from "@/lib/api/transactions";
import {
  categoryRowsWithDeltas,
  spendAmount,
  spendSeries,
  whatChanged,
  type CatRow,
} from "@/lib/spend/derive";
import { inRange, type Period } from "@/lib/spend/period";
import { formatCurrency } from "@/lib/format";
import { categoryIcon } from "@/lib/icons";
import { SpendOverTime } from "./spend-over-time";
import { useDrillNav } from "./drill-nav";
import { granularityLabel } from "./granularity";

/**
 * Category drill body — rendered inside the shared DrillStack. Drilling a
 * subcategory, merchant, or transaction pushes a new frame onto the stack via
 * useDrillNav, so the current view slides left and the next slides in. Period
 * comes in as a prop so the whole stack shares one range.
 */
export function CategoryDrillBody({
  parent,
  txns,
  cats,
  currency,
  period,
}: {
  parent: Category;
  txns: Transaction[];
  cats: Category[];
  currency: string;
  period: Period;
}) {
  const { from, to, prevFrom, prevTo } = period;
  const { push } = useDrillNav();

  const childIds = useMemo(
    () => new Set(cats.filter((c) => c.parent_id === parent.id).map((c) => c.id)),
    [cats, parent.id],
  );
  const inCat = useMemo(
    () => txns.filter((t) => t.category_id === parent.id || (t.category_id && childIds.has(t.category_id))),
    [txns, parent.id, childIds],
  );

  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  const subRows: CatRow[] = useMemo(
    () =>
      categoryRowsWithDeltas(
        inCat,
        cats.map((c) => (c.id === parent.id ? c : { ...c, parent_id: null })),
        from,
        to,
        prevFrom,
        prevTo,
      ),
    [inCat, cats, parent.id, from, to, prevFrom, prevTo],
  );

  const total = useMemo(
    () => inCat.filter((t) => inRange(t.txn_date, from, to)).reduce((a, t) => a + spendAmount(t, byId), 0),
    [inCat, from, to, byId],
  );
  const prevTotal = useMemo(
    () =>
      prevFrom && prevTo
        ? inCat.filter((t) => inRange(t.txn_date, prevFrom, prevTo)).reduce((a, t) => a + spendAmount(t, byId), 0)
        : 0,
    [inCat, prevFrom, prevTo, byId],
  );
  const headRow: CatRow = {
    id: parent.id,
    name: parent.name,
    total,
    prev: prevTotal,
    deltaPct: !prevFrom || prevTotal === 0 ? null : ((total - prevTotal) / prevTotal) * 100,
  };
  const series = useMemo(
    () => spendSeries(inCat, cats, period.buckets, from, period.granularity),
    [inCat, cats, period.buckets, from, period.granularity],
  );
  const subMax = subRows[0]?.total ?? 1;

  const merchants = useMemo(() => {
    const m = new Map<string, { name: string; total: number; count: number }>();
    for (const t of inCat) {
      if (!inRange(t.txn_date, from, to)) continue;
      const spend = spendAmount(t, byId);
      if (spend === 0) continue;
      const display = t.merchant?.trim() || "Unknown";
      const key = display.toLowerCase();
      const e = m.get(key) ?? { name: display, total: 0, count: 0 };
      e.total += spend;
      e.count += 1;
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total).slice(0, 6);
  }, [inCat, from, to, byId]);

  const recent = useMemo(
    () =>
      [...inCat]
        .filter((t) => inRange(t.txn_date, from, to))
        .sort((a, b) => b.txn_date.localeCompare(a.txn_date))
        .slice(0, 15),
    [inCat, from, to],
  );
  const Icon = categoryIcon(parent.name);

  return (
    <div className="space-y-3" data-testid="spend-category-drill">
      <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3">
        <div className="flex flex-col justify-center rounded-card-sm border border-border bg-gradient-to-br from-accent-soft/70 to-card p-4 shadow-card">
          <span className="grid size-9 place-items-center rounded-xl bg-card text-accent">
            <Icon className="size-[18px]" />
          </span>
          <p className="mt-2 text-[28px] font-extrabold leading-none tabular-nums">{formatCurrency(total, { currency })}</p>
          {headRow.deltaPct !== null && (
            <p className={`mt-1.5 text-xs font-semibold ${headRow.deltaPct > 0 ? "text-destructive" : "text-c3"}`}>
              {headRow.deltaPct > 0 ? "▲" : "▼"} {Math.abs(headRow.deltaPct).toFixed(0)}% {period.compareLabel ?? ""}
            </p>
          )}
        </div>
        <div className="flex flex-col justify-center rounded-card-sm border border-border bg-card p-4 shadow-card lg:col-span-2">
          <b className="text-sm">What changed</b>
          <p className="mt-1 text-sm text-muted">{whatChanged(headRow, subRows)}</p>
        </div>
      </div>

      <SpendOverTime points={series} granularityLabel={granularityLabel(period.granularity)} title={`${parent.name} over time`} />

      <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
        <b className="text-sm">Subcategories</b>
        {subRows.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => push({ kind: "category", id: s.id })}
            className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-chip"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm capitalize">{s.name.toLowerCase()}</span>
              <span className="mt-1 block h-[5px] overflow-hidden rounded-full bg-track">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (s.total / subMax) * 100)}%` }} />
              </span>
            </span>
            {s.deltaPct !== null && (
              <span className={`text-xs font-bold ${s.deltaPct > 0 ? "text-destructive" : "text-c3"}`}>
                {s.deltaPct > 0 ? "▲" : "▼"}
                {Math.abs(s.deltaPct).toFixed(0)}%
              </span>
            )}
            <span className="text-sm font-bold tabular-nums">{formatCurrency(s.total, { currency })}</span>
            <span className="text-muted">›</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
          <b className="text-sm">Top merchants</b>
          {merchants.map((m) => (
            <button
              key={m.name}
              type="button"
              onClick={() => push({ kind: "merchant", name: m.name })}
              className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-chip"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {m.name}
                <span className="block text-[11px] text-muted">{m.count} visits</span>
              </span>
              <span className="text-sm font-bold tabular-nums">{formatCurrency(m.total, { currency })}</span>
              <span className="text-muted">›</span>
            </button>
          ))}
        </div>
        <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
          <b className="text-sm">Transactions</b>
          {recent.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => push({ kind: "transaction", id: t.id })}
              className="flex w-full items-center gap-3 py-2 text-left hover:bg-chip"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {t.merchant ?? "Unknown"}
                <span className="block text-[11px] text-muted">{t.txn_date.slice(0, 10)}</span>
              </span>
              <span className="text-sm font-bold tabular-nums">{formatCurrency(Math.abs(Number(t.amount)), { currency: t.currency })}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
