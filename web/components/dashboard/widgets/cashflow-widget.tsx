"use client";
import { useCashflowSummary } from "@/lib/api/cashflow";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type Line = { label: string; amount: number; kind: string };
type CashflowData = { lines: Line[]; income: number; spend: number; net: number; currency: string };

function monthsFromRange(range: unknown): number {
  if (range === "3m") return 3;
  if (range === "12m" || range === "1y") return 12;
  return 6;
}

export const cashflowContract: WidgetContract<CashflowData> = {
  useData(config) {
    const cashflow = useCashflowSummary(monthsFromRange(config.range));
    return queryState(cashflow, {
      select: (data): CashflowData => {
        const lines = (data.breakdown ?? [])
          .filter((line) => line.kind !== "leftover")
          .map((line) => ({
            label: line.label,
            kind: line.kind,
            amount: Number(line.amount ?? 0),
          }));
        const income = Number(data.income_monthly ?? 0);
        const spend =
          Number(data.recurring_monthly ?? 0) +
          Number(data.debt_emi_monthly ?? 0) +
          Number(data.card_min_monthly ?? 0) +
          Number(data.discretionary_monthly ?? 0);
        const net = Number(data.leftover_monthly ?? income - spend);
        return { lines, income, spend, net, currency: data.currency ?? "USD" };
      },
      isEmpty: (data) => data.income === 0 && data.spend === 0 && data.net === 0,
    });
  },
  deriveInsights(data) {
    return [{
      label: `Net ${formatCurrency(data.net, { currency: data.currency, signed: true })}`,
      tone: data.net >= 0 ? "positive" : "warning",
      severity: data.net >= 0 ? 4 : 7,
    }];
  },
  Body({ data, config, density, w, h }) {
    if (density === 0) return <CompactStat label="Net flow" value={formatCurrency(data.net, { currency: data.currency, signed: true, compact: true })} hint="monthly" />;
    const showIn = config.show?.in ?? true;
    const showOut = config.show?.out ?? true;
    const showNet = config.show?.net ?? true;
    const bars = data.lines.filter((line) => (line.amount >= 0 ? showIn : showOut));
    const max = Math.max(1, ...bars.map((line) => Math.abs(line.amount)), showNet ? Math.abs(data.net) : 0);
    const compact = w < 3 || h < 2;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-end gap-4">
          {showIn && <div><span className="text-[10px] uppercase text-muted">In</span><p className="text-sm font-bold text-c3">{formatCurrency(data.income, { currency: data.currency })}</p></div>}
          {showOut && <div><span className="text-[10px] uppercase text-muted">Out</span><p className="text-sm font-bold text-c2">{formatCurrency(data.spend, { currency: data.currency })}</p></div>}
          {showNet && <p className={`ml-auto text-sm font-bold tabular-nums ${data.net >= 0 ? "text-c3" : "text-c2"}`}>{formatCurrency(data.net, { currency: data.currency, signed: true })}</p>}
        </div>
        <div className="mt-2 flex min-h-0 flex-1 items-end gap-2">
          {bars.map((line) => (
            <div key={line.kind} className="flex min-w-0 flex-1 flex-col justify-end gap-1">
              <span
                className={`block rounded-t ${line.amount >= 0 ? "bg-c3" : "bg-c2"}`}
                style={{ height: `${Math.max(8, (Math.abs(line.amount) / max) * 100)}%`, minHeight: 8, opacity: 0.88 }}
                title={`${line.label}: ${formatCurrency(Math.abs(line.amount), { currency: data.currency })}`}
              />
              {!compact && <span className="truncate text-center text-[10px] text-muted">{line.label}</span>}
            </div>
          ))}
          {showNet && (
            <div className="flex min-w-0 flex-1 flex-col justify-end gap-1">
              <span
                className={`block rounded-t ${data.net >= 0 ? "bg-accent" : "bg-destructive"}`}
                style={{ height: `${Math.max(8, (Math.abs(data.net) / max) * 100)}%`, minHeight: 8, opacity: 0.88 }}
                title={`Left over: ${formatCurrency(data.net, { currency: data.currency, signed: true })}`}
              />
              {!compact && <span className="truncate text-center text-[10px] text-muted">Left over</span>}
            </div>
          )}
        </div>
        {density >= 2 && (
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted">
            {data.lines.slice(0, 4).map((line) => (
              <div key={line.kind} className="flex justify-between gap-2">
                <span className="truncate">{line.label}</span>
                <span className="shrink-0 tabular-nums">{formatCurrency(Math.abs(line.amount), { currency: data.currency, compact: true })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-3">
        <div className="flex gap-6">
          <div><span className="text-[10px] uppercase text-muted">In</span><p className="text-xl font-bold text-c3">{formatCurrency(data.income, { currency: data.currency })}</p></div>
          <div><span className="text-[10px] uppercase text-muted">Out</span><p className="text-xl font-bold text-c2">{formatCurrency(data.spend, { currency: data.currency })}</p></div>
          <div className="ml-auto"><span className="text-[10px] uppercase text-muted">Net</span><p className="text-xl font-bold tabular-nums">{formatCurrency(data.net, { currency: data.currency, signed: true })}</p></div>
        </div>
        <div className="space-y-1">
          {data.lines.map((line) => <div key={line.kind} className="flex justify-between rounded-lg bg-chip px-2 py-1 text-[12px]"><span className="text-muted">{line.label}</span><span className="tabular-nums">{formatCurrency(Math.abs(line.amount), { currency: data.currency })}</span></div>)}
        </div>
      </div>
    );
  },
  emptyHint: "No cashflow in this range.",
};
