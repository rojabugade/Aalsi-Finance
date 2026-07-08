"use client";

import dynamic from "next/dynamic";
import type { CatRow } from "@/lib/spend/derive";
import { withOther } from "@/lib/spend/derive";
import { SHARE_COLORS } from "./share-donut-impl";

const OTHER_COLOR = "var(--series-other)";

const Donut = dynamic(() => import("./share-donut-impl").then((m) => m.ShareDonutImpl), {
  ssr: false,
  loading: () => <div className="h-[172px] w-full animate-pulse rounded-card-sm bg-chip" />,
});

export function ShareDonut({
  rows,
  currency = "USD",
  onSliceClick,
}: {
  rows: CatRow[];
  currency?: string;
  onSliceClick?: (categoryId: string) => void;
}) {
  // Top 5 + a rolled-up "Other" so the legend stays scannable.
  const grouped = withOther(rows, 5);
  const grand = rows.reduce((a, r) => a + r.total, 0) || 1;
  const slices = grouped.map((r) => ({
    id: "isOther" in r ? undefined : r.id,
    name: r.name,
    value: r.total,
    isOther: "isOther" in r,
  }));

  return (
    <div className="flex h-full flex-col rounded-card-sm border border-border bg-card p-4 shadow-card">
      <b className="text-sm">Share of spend</b>
      {slices.length === 0 ? (
        <p className="flex-1 py-10 text-center text-sm text-muted">No spending this period.</p>
      ) : (
        <>
          <Donut data={slices} currency={currency} onSliceClick={onSliceClick} />
          <ul className="mt-3 space-y-1.5">
            {grouped.map((r, i) => {
              const other = "isOther" in r;
              const dot = (
                <span
                  className="size-2.5 flex-none rounded-full"
                  style={{ background: other ? OTHER_COLOR : SHARE_COLORS[i % SHARE_COLORS.length] }}
                />
              );
              const label = (
                <span className="min-w-0 flex-1 truncate capitalize text-muted">
                  {other ? `Other (${(r as { count: number }).count})` : r.name.toLowerCase()}
                </span>
              );
              const pct = (
                <span className="num font-semibold">{Math.round((r.total / grand) * 100)}%</span>
              );
              return (
                <li key={r.id ?? r.name}>
                  {!other && onSliceClick && r.id ? (
                    <button
                      type="button"
                      onClick={() => onSliceClick(r.id!)}
                      className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left text-xs hover:bg-chip"
                    >
                      {dot}
                      {label}
                      {pct}
                    </button>
                  ) : (
                    <span className="flex items-center gap-2 px-1 py-0.5 text-xs">
                      {dot}
                      {label}
                      {pct}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
