"use client";

import { useMemo } from "react";
import type { Category, Transaction } from "@/lib/api/transactions";
import {
  categoryRowsWithDeltas,
  merchantSeries,
  spendAmount,
  topProductsForMerchant,
  type CatRow,
} from "@/lib/spend/derive";
import { inRange, type Period } from "@/lib/spend/period";
import { formatCurrency } from "@/lib/format";
import { SpendOverTime } from "./spend-over-time";
import { useDrillNav } from "./drill-nav";
import { granularityLabel } from "./granularity";

/**
 * Merchant drill body — rendered inside the shared DrillStack. Clicking one of
 * this merchant's categories or transactions pushes a new frame onto the stack
 * via useDrillNav (mirror of the category→merchant drill), so navigation is
 * symmetric. Period comes in as a prop.
 */
export function MerchantDrillBody({
  merchant,
  txns,
  cats,
  currency,
  period,
}: {
  merchant: string;
  txns: Transaction[];
  cats: Category[];
  currency: string;
  period: Period;
}) {
  const { from, to, prevFrom, prevTo } = period;
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const needle = merchant.toLowerCase();
  const { push } = useDrillNav();

  const inMerchant = useMemo(
    () => txns.filter((t) => (t.merchant?.trim().toLowerCase() ?? "unknown") === needle),
    [txns, needle],
  );

  const total = useMemo(
    () => inMerchant.filter((t) => inRange(t.txn_date, from, to)).reduce((a, t) => a + spendAmount(t, byId), 0),
    [inMerchant, from, to, byId],
  );
  const prevTotal = useMemo(
    () =>
      prevFrom && prevTo
        ? inMerchant.filter((t) => inRange(t.txn_date, prevFrom, prevTo)).reduce((a, t) => a + spendAmount(t, byId), 0)
        : 0,
    [inMerchant, prevFrom, prevTo, byId],
  );
  const deltaPct = !prevFrom || prevTotal === 0 ? null : ((total - prevTotal) / prevTotal) * 100;

  const monthTxns = useMemo(
    () => inMerchant.filter((t) => inRange(t.txn_date, from, to) && spendAmount(t, byId) > 0),
    [inMerchant, from, to, byId],
  );
  const visits = monthTxns.length;
  const avg = visits ? total / visits : 0;

  const catRows: CatRow[] = useMemo(
    () => categoryRowsWithDeltas(inMerchant, cats, from, to, prevFrom, prevTo),
    [inMerchant, cats, from, to, prevFrom, prevTo],
  );
  const products = useMemo(() => topProductsForMerchant(inMerchant, merchant, from, to), [inMerchant, merchant, from, to]);
  const series = useMemo(
    () => merchantSeries(inMerchant, cats, merchant, period.buckets, from, period.granularity),
    [inMerchant, cats, merchant, period.buckets, from, period.granularity],
  );

  const recent = useMemo(() => [...monthTxns].sort((a, b) => b.txn_date.localeCompare(a.txn_date)), [monthTxns]);
  const catMax = catRows[0]?.total ?? 1;

  return (
    <div className="space-y-3" data-testid="spend-merchant-drill">
      {/* header: total + activity */}
      <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3">
        <div className="flex flex-col justify-center rounded-card-sm border border-border bg-gradient-to-br from-accent-soft/70 to-card p-4 shadow-card">
          <span className="grid size-9 place-items-center rounded-xl bg-card text-xs font-bold uppercase text-accent">
            {merchant.slice(0, 2)}
          </span>
          <p className="mt-2 text-[28px] font-extrabold leading-none tabular-nums">{formatCurrency(total, { currency })}</p>
          <p className="mt-1.5 text-xs font-semibold">
            {deltaPct !== null && (
              <span className={deltaPct > 0 ? "text-destructive" : "text-c3"}>
                {deltaPct > 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(0)}% {period.compareLabel ?? ""}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col justify-center rounded-card-sm border border-border bg-card p-4 shadow-card lg:col-span-2">
          <b className="text-sm">Activity</b>
          <p className="mt-1 text-sm text-muted">
            {visits} {visits === 1 ? "purchase" : "purchases"} this period · {formatCurrency(avg, { currency })} average
            {catRows[0] ? <> · mostly <span className="capitalize">{catRows[0].name.toLowerCase()}</span></> : null}.
          </p>
        </div>
      </div>

      <SpendOverTime points={series} granularityLabel={granularityLabel(period.granularity)} title={`${merchant} over time`} />

      <div className="grid gap-3 lg:grid-cols-2">
        {/* by category for this merchant — clickable (symmetry with category drill) */}
        <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
          <b className="text-sm">Spending by category</b>
          {catRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No spending this period.</p>
          ) : (
            catRows.map((c) => {
              const real = c.id !== "__uncategorized__" && cats.some((x) => x.id === c.id);
              const Inner = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm capitalize">{c.name.toLowerCase()}</span>
                    <span className="mt-1 block h-[5px] overflow-hidden rounded-full bg-track">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (c.total / catMax) * 100)}%` }} />
                    </span>
                  </span>
                  <span className="text-sm font-bold tabular-nums">{formatCurrency(c.total, { currency })}</span>
                  {real && <span className="text-muted">›</span>}
                </>
              );
              return real ? (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => push({ kind: "category", id: c.id })}
                  className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-chip"
                >
                  {Inner}
                </button>
              ) : (
                <div key={c.id} className="flex items-center gap-3 px-1 py-2">
                  {Inner}
                </div>
              );
            })
          )}
        </div>

        {/* top products (line items) */}
        <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
          <b className="text-sm">Top products</b>
          {products.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No itemized receipts for this merchant yet.</p>
          ) : (
            products.map((p) => (
              <div key={p.name} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.name}
                  {p.qty > 1 && <span className="block text-[11px] text-muted">×{p.qty}</span>}
                </span>
                <span className="text-sm font-bold tabular-nums">{formatCurrency(p.total, { currency })}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* transactions */}
      <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
        <div className="mb-1 flex items-center justify-between px-1">
          <b className="text-sm">Transactions</b>
          <span className="text-[11px] uppercase tracking-wide text-muted">{recent.length} · this period</span>
        </div>
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No transactions this period.</p>
        ) : (
          recent.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => push({ kind: "transaction", id: t.id })}
              className="flex w-full items-center gap-3 py-2 text-left hover:bg-chip"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {merchant}
                <span className="block text-[11px] text-muted">{t.txn_date.slice(0, 10)} · {t.status}</span>
              </span>
              <span className="text-sm font-bold tabular-nums">
                {formatCurrency(Math.abs(Number(t.amount)), { currency: t.currency })}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
