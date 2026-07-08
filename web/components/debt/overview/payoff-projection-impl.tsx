"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/a11y/use-reduced-motion";
import type { ProjectionPoint } from "./payoff-projection";

export function PayoffProjectionImpl({
  data,
  currency,
  showScenario = false,
  optimizedLabel = "Optimized plan",
}: {
  data: ProjectionPoint[];
  currency: string;
  showScenario?: boolean;
  optimizedLabel?: string;
}) {
  const reduced = usePrefersReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} minTickGap={32} />
        <YAxis
          width={48}
          tickFormatter={(v) => formatCurrency(v, { currency, compact: true })}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
        />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            color: "var(--fg)",
            fontSize: 12,
          }}
          formatter={(value: number, name) => [
            formatCurrency(value, { currency }),
            name === "plan" ? optimizedLabel : name === "scenario" ? "Your scenario" : "Current",
          ]}
        />
        <Line type="monotone" dataKey="current" stroke="var(--muted)" strokeWidth={2} strokeOpacity={0.7} dot={false} isAnimationActive={!reduced} />
        <Line type="monotone" dataKey="plan" stroke="var(--accent)" strokeWidth={2.8} dot={false} isAnimationActive={!reduced} />
        {showScenario && (
          <Line type="monotone" dataKey="scenario" stroke="var(--c3)" strokeWidth={2.2} strokeDasharray="5 4" dot={false} isAnimationActive={!reduced} />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
