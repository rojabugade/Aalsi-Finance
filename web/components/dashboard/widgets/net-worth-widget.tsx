"use client";
import { TrendingUp } from "lucide-react";
import { useNetWorth } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { AreaChart } from "@/components/ui/area-chart";
import { CompactStat } from "./widget-tier";
import { Private } from "@/components/dashboard/privacy-provider";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type NetWorthData = { value: string; compactValue?: string; delta: number | null; points: { label: string; value: number }[]; months: number; currency: string };

export const netWorthContract: WidgetContract<NetWorthData> = {
  useData(config) {
    const nw = useNetWorth(presetRange(config.range ?? "6m"));
    return queryState(nw, {
      select: (d): NetWorthData => {
        const points = d.points.map((p) => ({ label: p.period, value: Number(p.net_worth) }));
        const last = Number(d.net_worth);
        const first = points[0]?.value ?? 0;
        return {
          value: formatCurrency(last, { currency: d.currency }),
          compactValue: formatCurrency(last, { currency: d.currency, compact: true }),
          currency: d.currency,
          delta: first === 0 ? null : ((last - first) / Math.abs(first)) * 100,
          points,
          months: points.length,
        };
      },
      isEmpty: (t) => t.points.length === 0,
    });
  },
  deriveInsights(d) {
    if (d.delta === null) return [];
    const up = d.delta >= 0;
    return [{
      label: `${up ? "▲" : "▼"} ${Math.abs(d.delta).toFixed(1)}% / ${d.months}mo`,
      tone: up ? "positive" : "warning",
      severity: Math.min(9, Math.round(Math.abs(d.delta))),
    }];
  },
  Body({ data, config, density }) {
    const showDelta = config.show?.delta ?? true;
    if (density === 0) {
      return <CompactStat icon={TrendingUp} label="Net worth" value={data.compactValue ?? data.value}
        hint={showDelta && data.delta !== null ? `${data.delta >= 0 ? "▲" : "▼"} ${Math.abs(data.delta).toFixed(1)}%` : undefined} />;
    }
    const showChart = (config.show?.chart ?? true) && density >= 2;
    return (
      <div className="flex h-full flex-col">
        <p className="text-3xl font-extrabold tabular-nums tracking-tight"><Private kind="money">{data.value}</Private></p>
        {showDelta && data.delta !== null && (
          <p className={`text-sm font-semibold ${data.delta >= 0 ? "text-c3" : "text-destructive"}`}>
            {data.delta >= 0 ? "▲" : "▼"} {Math.abs(data.delta).toFixed(1)}% over {data.months} mo
          </p>
        )}
        {showChart && <div className="mt-2 flex-1"><AreaChart data={data.points} height={density >= 3 ? 140 : 90} /></div>}
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-3">
        <p className="text-4xl font-extrabold tabular-nums tracking-tight"><Private kind="money">{data.value}</Private></p>
        <AreaChart data={data.points} height={220} />
        <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
          {data.points.map((p) => (
            <div key={p.label} className="flex justify-between rounded-lg bg-chip px-2 py-1">
              <span className="text-muted">{p.label}</span>
              <b className="tabular-nums">{formatCurrency(p.value, { currency: data.currency })}</b>
            </div>
          ))}
        </div>
      </div>
    );
  },
  emptyHint: "No net-worth history yet.",
};
