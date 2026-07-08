"use client";

import dynamic from "next/dynamic";

export type AreaPoint = { label: string; value: number };

const Impl = dynamic(() => import("./area-chart-impl").then((m) => m.AreaChartImpl), {
  ssr: false,
  loading: () => <div className="h-[220px] w-full animate-pulse rounded-card-sm bg-chip" />,
});

export function AreaChart(props: { data: AreaPoint[]; height?: number }) {
  return <Impl {...props} />;
}
