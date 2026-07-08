"use client";

import Link from "next/link";
import { useBudgets } from "@/lib/api/budgets";
import { formatCurrency } from "@/lib/format";

const num = (v: unknown) => Number(v ?? 0);

export function BudgetStatusCard() {
  const budgets = useBudgets();

  const rows = (budgets.data ?? []).slice(0, 4).map((b) => {
    const spent = num(b.spent);
    const limit = num(b.amount);
    const pct = Math.min(100, num(b.progress_pct));
    return { id: b.id, currency: b.currency, limit, spent, pct, over: b.overspent };
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card" data-testid="budget-status-card">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm">Budget status</b>
        <Link href="/budgets" className="text-xs font-semibold text-accent">
          See all
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No budgets set yet.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.id}>
              <div className="flex justify-between text-xs">
                <span className="tabular-nums">
                  {formatCurrency(r.spent, { currency: r.currency })} / {formatCurrency(r.limit, { currency: r.currency })}
                </span>
                <span className={r.over ? "font-bold text-destructive" : "text-muted"}>{r.pct.toFixed(0)}%</span>
              </div>
              <span className="mt-1 block h-[6px] overflow-hidden rounded-full bg-track">
                <span
                  className={`block h-full rounded-full ${r.over ? "bg-destructive" : "bg-accent"}`}
                  style={{ width: `${r.pct}%` }}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
