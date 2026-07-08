"use client";

import { useMemo } from "react";

import { useBreakdown, useTimeseries } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { buildCashFlowSankey } from "@/lib/insights/sankey";
import { NetWorthCard } from "@/components/insights/net-worth-card";
import { CashFlowSankey } from "@/components/insights/cash-flow-sankey";
import { SectionIntro } from "@/components/insights/section-intro";
import { AreaChart } from "@/components/ui/area-chart";

const num = (v: unknown) => Number(v ?? 0);

export default function InsightsOverviewPage() {
  const range = useMemo(() => presetRange("6m"), []);
  const ts = useTimeseries(range);
  const breakdown = useBreakdown(range, "category");

  const income = useMemo(
    () => (ts.data?.points ?? []).reduce((a, p) => a + num(p.income), 0),
    [ts.data],
  );
  const sankey = useMemo(
    () => buildCashFlowSankey(income, (breakdown.data?.rows ?? []) as never[]),
    [income, breakdown.data],
  );
  const points = useMemo(
    () => (ts.data?.points ?? []).map((p) => ({ label: p.period, value: num(p.net) })),
    [ts.data],
  );

  return (
    <div className="space-y-4">
      <SectionIntro
        title="The big picture"
        blurb="Net worth, cash flow, and how the pieces fit — spending detail lives in the Spend tab."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <NetWorthCard />
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <b className="text-sm">Net cash flow</b>
          <p className="mb-2 text-xs text-muted">Income minus spending, by month.</p>
          <AreaChart data={points} height={200} />
        </div>
      </div>
      <CashFlowSankey data={sankey} />
    </div>
  );
}
