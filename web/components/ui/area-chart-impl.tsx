"use client";

import {
  Area,
  AreaChart as RcAreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency, toFinite } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/a11y/use-reduced-motion";
import type { AreaPoint } from "./area-chart";

export function AreaChartImpl({ data, height = 220 }: { data: AreaPoint[]; height?: number }) {
  const safe = data.map((d) => ({ ...d, value: toFinite(d.value) }));
  const reduced = usePrefersReducedMotion();
  const first = safe[0];
  const last = safe[safe.length - 1];
  const summary =
    first && last
      ? `Trend from ${first.label} (${formatCurrency(first.value)}) to ${last.label} (${formatCurrency(last.value)}).`
      : "No trend data.";
  return (
    <div role="img" aria-label={summary} className="h-full w-full">
    <ResponsiveContainer width="100%" height={height}>
      <RcAreaChart data={safe} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="cf-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
        />
        <YAxis
          width={48}
          tickFormatter={(v) => formatCurrency(v, { compact: true })}
          tickLine={false}
          axisLine={false}
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
          formatter={(value: number) => [formatCurrency(value), "Net"]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--accent)"
          strokeWidth={2.6}
          fill="url(#cf-area)"
          isAnimationActive={!reduced}
        />
      </RcAreaChart>
    </ResponsiveContainer>
    </div>
  );
}
