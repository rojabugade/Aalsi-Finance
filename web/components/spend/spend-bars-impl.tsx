"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/a11y/use-reduced-motion";

export type SpendBar = { label: string; value: number; key: string };

/** Spend columns for the selected range, already bucketed + labelled by the
 *  derive layer (daily / weekly / monthly). The most-recent bucket is
 *  highlighted; the rest use the track colour. */
export function SpendBarsImpl({
  data,
  height = 200,
  onBarClick,
}: {
  data: SpendBar[];
  height?: number;
  onBarClick?: (bar: SpendBar) => void;
}) {
  const lastIndex = data.length - 1;
  const reduced = usePrefersReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          interval="preserveStartEnd"
          minTickGap={16}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
        />
        <YAxis
          width={52}
          tickFormatter={(v) => formatCurrency(v, { compact: true })}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
        />
        <Tooltip
          cursor={{ fill: "var(--chip)" }}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            color: "var(--fg)",
            fontSize: 12,
          }}
          formatter={(value: number) => [formatCurrency(value), "Spent"]}
        />
        <Bar
          dataKey="value"
          radius={[6, 6, 0, 0]}
          maxBarSize={46}
          isAnimationActive={!reduced}
          className={onBarClick ? "cursor-pointer" : undefined}
          onClick={(entry: { payload?: SpendBar }) => entry?.payload && onBarClick?.(entry.payload)}
        >
          {data.map((d, i) => (
            <Cell key={d.label + i} fill={i === lastIndex ? "var(--accent)" : "var(--track)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
