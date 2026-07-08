"use client";

import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/a11y/use-reduced-motion";

export type ComparisonPoint = { label: string; current: number; optimized: number };

export function PayoffComparisonImpl({ data, currency }: { data: ComparisonPoint[]; currency: string }) {
  const reduced = usePrefersReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} minTickGap={32} />
        <YAxis width={48} tickFormatter={(v) => formatCurrency(v, { currency, compact: true })} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--fg)", fontSize: 12 }}
          formatter={(value: number, name) => [formatCurrency(value, { currency }), name === "optimized" ? "Optimized plan" : "Current plan"]}
        />
        <Line type="monotone" dataKey="current" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={!reduced} />
        <Line type="monotone" dataKey="optimized" stroke="var(--accent)" strokeWidth={2.6} dot={false} isAnimationActive={!reduced} />
      </LineChart>
    </ResponsiveContainer>
  );
}
