"use client";
import { LineChart } from "lucide-react";
import { useHoldings, type Holding } from "@/lib/api/widget-data";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract, type Insight } from "@/lib/dashboard/widget-contract";

export type HoldingsVM = {
  holdings: { id: string; name: string; symbol: string | null; value: number; cost: number; gain: number; gainPct: number | null; currency: string }[];
  totalValue: number;
  totalCost: number;
  totalGain: number;
  totalGainPct: number | null;
  currency: string;
  anyUnpriced: boolean;
};

export function holdingsVM(holdings: Holding[]): HoldingsVM {
  const rows = holdings.map((h) => {
    const qty = Number(h.quantity ?? 0);
    const avg = h.avg_buy_price != null ? Number(h.avg_buy_price) : 0;
    const cost = qty * avg;
    const value = h.latest_valuation?.value != null ? Number(h.latest_valuation.value) : cost;
    const gain = value - cost;
    return { id: h.id, name: h.name, symbol: h.symbol ?? null, value, cost, gain, gainPct: cost > 0 ? gain / cost : null, currency: h.currency };
  }).sort((a, b) => b.value - a.value);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalGain = totalValue - totalCost;
  const currency = rows[0]?.currency ?? "USD";
  return {
    holdings: rows,
    totalValue, totalCost, totalGain,
    totalGainPct: totalCost > 0 ? totalGain / totalCost : null,
    currency,
    anyUnpriced: holdings.some((h) => h.latest_valuation == null),
  };
}

function gainColor(g: number) { return g >= 0 ? "text-c3" : "text-destructive"; }

export const holdingsContract: WidgetContract<HoldingsVM> = {
  useData() {
    const q = useHoldings();
    return queryState(q, {
      select: holdingsVM,
      isEmpty: (vm) => vm.holdings.length === 0,
      partialReason: (vm) => (vm.anyUnpriced ? "Some holdings unpriced" : undefined),
    });
  },
  deriveInsights(vm) {
    const chips: Insight[] = [];
    if (vm.totalGainPct != null) {
      const up = vm.totalGain >= 0;
      chips.push({ label: `${up ? "▲" : "▼"} ${Math.abs(vm.totalGainPct * 100).toFixed(1)}% total`, tone: up ? "positive" : "warning", severity: Math.min(9, Math.round(Math.abs(vm.totalGainPct * 100))) });
    }
    const top = vm.holdings[0];
    if (top) chips.push({ label: top.symbol ?? top.name, tone: "neutral", severity: 2 });
    return chips;
  },
  Body({ data, density, config }) {
    if (density === 0)
      return <CompactStat icon={LineChart} label="Portfolio" value={formatCurrency(data.totalValue, { compact: true, currency: data.currency })}
        hint={data.totalGainPct != null ? `${data.totalGain >= 0 ? "▲" : "▼"} ${Math.abs(data.totalGainPct * 100).toFixed(1)}%` : undefined} />;
    const showGain = config.show?.gain ?? true;
    const showSymbol = config.show?.symbol ?? true;
    const limit = density >= 3 ? data.holdings.length : Math.min(3, data.holdings.length);
    const rows = data.holdings.slice(0, limit);
    return (
      <div className="flex h-full flex-col">
        <p className="text-2xl font-extrabold tabular-nums tracking-tight">{formatCurrency(data.totalValue, { currency: data.currency })}</p>
        {showGain && data.totalGainPct != null && (
          <p className={`text-[11px] font-semibold ${gainColor(data.totalGain)}`}>{data.totalGain >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(data.totalGain), { currency: data.currency })} ({Math.abs(data.totalGainPct * 100).toFixed(1)}%)</p>
        )}
        <div className="mt-2 flex-1 space-y-1 overflow-hidden">
          {rows.map((h) => (
            <div key={h.id} className="flex justify-between gap-2 text-[12.5px]">
              <span className="truncate text-muted">{showSymbol && h.symbol ? h.symbol : h.name}</span>
              <span className="shrink-0 tabular-nums">{formatCurrency(h.value, { currency: h.currency })}{showGain && h.gainPct != null ? <span className={gainColor(h.gain)}> {h.gain >= 0 ? "+" : ""}{(h.gainPct * 100).toFixed(1)}%</span> : null}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },
  Focus({ data }) {
    const total = data.totalValue || 1;
    return (
      <div className="space-y-3">
        <p className="text-3xl font-extrabold tabular-nums">{formatCurrency(data.totalValue, { currency: data.currency })}</p>
        {data.totalGainPct != null && <p className={`text-[12px] font-semibold ${gainColor(data.totalGain)}`}>{data.totalGain >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(data.totalGain), { currency: data.currency })} ({Math.abs(data.totalGainPct * 100).toFixed(1)}%)</p>}
        <div className="space-y-2">
          {data.holdings.map((h) => (
            <div key={h.id} className="rounded-lg bg-chip px-3 py-2 text-[12.5px]">
              <div className="flex justify-between"><b>{h.symbol ?? h.name}</b><span className="tabular-nums">{formatCurrency(h.value, { currency: h.currency })}</span></div>
              <div className="mt-1 flex justify-between text-[11px] text-muted">
                <span>{Math.round((h.value / total) * 100)}% of portfolio</span>
                <span className={gainColor(h.gain)}>{h.gain >= 0 ? "+" : ""}{formatCurrency(h.gain, { currency: h.currency })}{h.gainPct != null ? ` (${(h.gainPct * 100).toFixed(1)}%)` : ""}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  },
  emptyHint: "No holdings tracked yet. Add an investment to see your portfolio.",
};
