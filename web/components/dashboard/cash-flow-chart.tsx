"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency, monthLabel, toFinite } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/a11y/use-reduced-motion";

export type CashFlowPoint = {
  period: string;
  spend: number;
  income: number;
  net: number;
};

export function CashFlowChart({ data }: { data: CashFlowPoint[] }) {
  const safe = data.map((d) => ({
    ...d,
    spend: toFinite(d.spend),
    income: toFinite(d.income),
    net: toFinite(d.net),
  }));
  const reduced = usePrefersReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={safe} barGap={4} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="period"
          tickFormatter={monthLabel}
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
            borderRadius: "0.5rem",
            color: "var(--fg)",
            fontSize: 12,
          }}
          formatter={(value: number, name: string) => [
            formatCurrency(value),
            name.charAt(0).toUpperCase() + name.slice(1),
          ]}
          labelFormatter={monthLabel}
        />
        <Bar dataKey="income" fill="var(--accent)" radius={[4, 4, 0, 0]} isAnimationActive={!reduced} />
        <Bar dataKey="spend" fill="var(--c2)" radius={[4, 4, 0, 0]} isAnimationActive={!reduced} />
      </BarChart>
    </ResponsiveContainer>
  );
}
