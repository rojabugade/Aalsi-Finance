"use client";
import { LifeBuoy } from "lucide-react";
import { useCashflowSummary } from "@/lib/api/cashflow";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type SafeData = { safe: number; value: string; compactValue?: string; currency: string };

export const safeToSpendContract: WidgetContract<SafeData> = {
  useData() {
    const q = useCashflowSummary();
    return queryState(q, {
      select: (data): SafeData => {
        const safe = Math.max(0, Number(data.leftover_monthly ?? 0));
        const currency = data.currency ?? "USD";
        return { safe, currency, value: formatCurrency(safe, { currency }), compactValue: formatCurrency(safe, { compact: true, currency }) };
      },
      isEmpty: () => false,
    });
  },
  deriveInsights(data) {
    return data.safe <= 0
      ? [{ label: "Nothing left this month", tone: "warning", severity: 8 }]
      : [{ label: `Safe: ${data.value}`, tone: "positive", severity: 4 }];
  },
  Body({ data, density }) {
    if (density === 0) return <CompactStat icon={LifeBuoy} label="Safe to spend" value={data.compactValue ?? data.value} hint="left after obligations" />;
    return (
      <div className="flex h-full flex-col justify-center rounded-xl bg-accent-soft p-3">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Safe to spend</span>
        <p className="mt-1 text-2xl font-extrabold tabular-nums text-c3">{data.value}</p>
        <p className="mt-0.5 text-[11px] text-muted">Left after bills, debt &amp; everyday spend</p>
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-2">
        <p className="text-4xl font-extrabold tabular-nums text-c3">{data.value}</p>
        <p className="text-[13px] text-muted">Monthly income left after recurring, debt and your average spend.</p>
      </div>
    );
  },
  emptyHint: "Add income and spending so I can compute what's left.",
};
