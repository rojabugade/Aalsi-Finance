"use client";

import dynamic from "next/dynamic";
import type { SankeyData } from "@/lib/insights/sankey";

const Impl = dynamic(() => import("./cash-flow-sankey-impl").then((m) => m.CashFlowSankeyImpl), {
  ssr: false,
  loading: () => <div className="h-[260px] w-full animate-pulse rounded-2xl bg-chip" />,
});

export function CashFlowSankey({ data }: { data: SankeyData }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card" data-testid="cash-flow-sankey">
      <b className="text-sm">Cash flow</b>
      <p className="mb-2 text-xs text-muted">Where your income went this period — income in, spending and savings out.</p>
      {data.links.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Not enough data yet.</p>
      ) : (
        <Impl data={data} />
      )}
    </div>
  );
}
