"use client";
import { useMemo } from "react";
import { useBudgets } from "@/lib/api/budgets";
import { useCategories } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type Row = { id: string; name: string; limit: number; spent: number; pct: number; over: boolean; currency: string };
type BudgetsData = { rows: Row[]; onTrack: number; currency: string };

export const budgetsContract: WidgetContract<BudgetsData> = {
  useData(config) {
    void config;
    const budgets = useBudgets();
    const categories = useCategories();
    const categoryName = useMemo(() => {
      const names = new Map((categories.data ?? []).map((category) => [category.id, category.name]));
      return (id: string | null | undefined) => id ? names.get(id) ?? "Category" : "All spending";
    }, [categories.data]);
    return queryState(budgets, {
      select: (data): BudgetsData => {
        const rows = (data ?? []).map((budget) => {
          const limit = Number(budget.amount ?? 0);
          const spent = Number(budget.spent ?? 0);
          const pct = Number(budget.progress_pct ?? (limit > 0 ? (spent / limit) * 100 : 0));
          return { id: budget.id, name: categoryName(budget.category_id), limit, spent, pct, over: budget.overspent, currency: budget.currency };
        });
        return { rows, currency: rows[0]?.currency ?? "USD", onTrack: rows.filter((row) => !row.over).length };
      },
      isEmpty: (data) => data.rows.length === 0,
    });
  },
  deriveInsights(data) {
    const over = data.rows.filter((row) => row.over).sort((a, b) => b.pct - a.pct)[0];
    return over
      ? [{ label: `${over.name} ${Math.round(over.pct)}%`, tone: "danger", severity: 9 }]
      : [{ label: `${data.onTrack}/${data.rows.length} on track`, tone: "positive", severity: 3 }];
  },
  Body({ data, config, density, h }) {
    if (density === 0) return <CompactStat label="Budgets" value={`${data.onTrack} / ${data.rows.length}`} hint="on track" />;
    const rows = [...data.rows].sort((a, b) => b.pct - a.pct);
    const fallbackCount = h >= 3 ? rows.length : h >= 2 ? 4 : 2;
    const count = Math.max(1, Math.min(rows.length, Math.round(Number(config.count ?? fallbackCount))));
    const showAmounts = config.show?.amounts ?? true;
    return (
      <div className="flex h-full flex-col gap-2 overflow-hidden">
        {rows.slice(0, count).map((row) => (
          <div key={row.id}>
            <div className="flex justify-between gap-2 text-[13px]"><span className="truncate">{row.name}</span>{showAmounts && <span className="shrink-0 tabular-nums"><span className={row.over ? "text-destructive" : ""}>{formatCurrency(row.spent, { currency: row.currency })}</span><span className="text-muted"> / {formatCurrency(row.limit, { currency: row.currency })}</span></span>}</div>
            {(config.show?.bars ?? true) && <div className="mt-1 h-1.5 overflow-hidden rounded bg-track"><span className="block h-full rounded" style={{ width: `${Math.min(100, row.pct)}%`, background: row.over ? "var(--c2)" : "var(--accent)" }} /></div>}
          </div>
        ))}
      </div>
    );
  },
  Focus({ data }) {
    return <div className="space-y-2">{data.rows.map((row) => <div key={row.id}><div className="flex justify-between text-[13px]"><span>{row.name}</span><span className="tabular-nums"><span className={row.over ? "text-destructive" : ""}>{formatCurrency(row.spent, { currency: row.currency })}</span><span className="text-muted"> / {formatCurrency(row.limit, { currency: row.currency })}</span></span></div><div className="mt-1 h-2 overflow-hidden rounded bg-track"><span className="block h-full rounded" style={{ width: `${Math.min(100, row.pct)}%`, background: row.over ? "var(--c2)" : "var(--accent)" }} /></div></div>)}</div>;
  },
  emptyHint: "No budgets set up yet.",
};
