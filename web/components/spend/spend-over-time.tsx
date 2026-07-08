"use client";

import dynamic from "next/dynamic";
import type { SpendBar } from "./spend-bars-impl";

const Bars = dynamic(() => import("./spend-bars-impl").then((m) => m.SpendBarsImpl), {
  ssr: false,
  loading: () => <div className="h-[200px] w-full animate-pulse rounded-card-sm bg-chip" />,
});

export function SpendOverTime({
  points,
  granularityLabel = "over time",
  title = "Spending over time",
  onBarClick,
}: {
  points: SpendBar[];
  granularityLabel?: string;
  title?: string;
  onBarClick?: (bar: SpendBar) => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <b className="text-sm">{title}</b>
        <span className="text-[11px] uppercase tracking-wide text-muted">{granularityLabel}</span>
      </div>
      <div className="flex-1">
        <Bars data={points} height={200} onBarClick={onBarClick} />
      </div>
    </div>
  );
}
