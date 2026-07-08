"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCategories, useTransactions } from "@/lib/api/transactions";
import { categoryRowsWithDeltas } from "@/lib/spend/derive";
import { resolvePeriod } from "@/lib/spend/period";
import { formatCurrency } from "@/lib/format";
import { categoryIcon } from "@/lib/icons";

export function TopMoversCard() {
  const txns = useTransactions();
  const cats = useCategories();

  const movers = useMemo(() => {
    const { from, to, prevFrom, prevTo } = resolvePeriod("month");
    const rows = categoryRowsWithDeltas(txns.data ?? [], cats.data ?? [], from, to, prevFrom, prevTo);
    return rows
      .filter((r) => r.deltaPct !== null)
      .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))
      .slice(0, 3);
  }, [txns.data, cats.data]);

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
            <Link
              key={r.id}
              href={`/transactions?cat=${encodeURIComponent(r.id)}`}
              className="flex items-center gap-3 py-1.5"
            >
              <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent">
                <Icon className="size-4" />
              </span>
              <span className="flex-1 truncate text-sm capitalize">{r.name.toLowerCase()}</span>
              <span className={`text-xs font-bold ${up ? "text-destructive" : "text-c3"}`}>
                {up ? "▲" : "▼"}
                {Math.abs(r.deltaPct ?? 0).toFixed(0)}%
              </span>
              <span className="text-sm font-bold tabular-nums">{formatCurrency(r.total)}</span>
            </Link>
          );
        })
      )}
    </div>
  );
}
