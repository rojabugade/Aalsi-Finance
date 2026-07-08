"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCurrency } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/a11y/use-reduced-motion";

// Theme-derived: every slice re-colours itself across all 11 palettes instead
// of being locked to indigo. Driven by the --series-* tokens in globals.css.
export const SHARE_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];
const OTHER_COLOR = "var(--series-other)";

export type DonutSlice = { id?: string; name: string; value: number; isOther?: boolean };

/** Centred donut: fixed cx/cy so it never drifts when the card grows, a hairline
 *  gap between slices, and the period total stacked in the hole. "Other" gets a
 *  muted grey so it reads as the rolled-up tail rather than a real category.
 *  Real-category slices are clickable when onSliceClick is supplied. */
export function ShareDonutImpl({
  data,
  currency = "USD",
  onSliceClick,
}: {
  data: DonutSlice[];
  currency?: string;
  onSliceClick?: (categoryId: string) => void;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const reduced = usePrefersReducedMotion();
  const summary = data.length
    ? `Spending breakdown, total ${formatCurrency(total, { currency })}. ${data
        .map((d) => `${d.name} ${formatCurrency(d.value, { currency })}`)
        .join(", ")}.`
    : "No spending data.";
  return (
    <div className="relative" role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height={172}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={58}
            outerRadius={82}
            paddingAngle={1}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={!reduced}
          >
            {data.map((d, i) => (
              <Cell
                key={d.name}
                fill={d.isOther ? OTHER_COLOR : SHARE_COLORS[i % SHARE_COLORS.length]}
                className={onSliceClick && !d.isOther && d.id ? "cursor-pointer" : undefined}
                onClick={() => !d.isOther && d.id && onSliceClick?.(d.id)}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number) => formatCurrency(v, { currency })}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--fg)",
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Total</span>
        <span className="num text-base font-extrabold">{formatCurrency(total, { currency, compact: true })}</span>
      </div>
    </div>
  );
}
