"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { toFinite } from "@/lib/format";
import { aggregateProjection, monthsToLabel, type LoanLike } from "../debt-math";

export type ProjectionPoint = { label: string; current: number; plan: number; scenario?: number };

const Impl = dynamic(
  () => import("./payoff-projection-impl").then((m) => m.PayoffProjectionImpl),
  { ssr: false, loading: () => <div className="h-[240px] w-full animate-pulse rounded-card-sm bg-chip" /> },
);

export function PayoffProjection({
  loans,
  extraMonthly,
  scenarioExtra = 0,
  strategy,
  monthsSooner,
  currency,
  source,
}: {
  loans: LoanLike[];
  extraMonthly: number;
  scenarioExtra?: number;
  strategy: "snowball" | "avalanche";
  monthsSooner: number;
  currency: string;
  source?: string;
}) {
  // Only draw the live "your scenario" line when it actually differs from the
  // recommended plan, so the chart doesn't show a redundant overlapping line.
  const showScenario = scenarioExtra > 0 && scenarioExtra !== extraMonthly;
  const optimizedLabel = source === "ai" ? "AI optimized" : "Optimized plan";

  const data = useMemo<ProjectionPoint[]>(() => {
    const current = aggregateProjection(loans, 0, strategy);
    const plan = aggregateProjection(loans, extraMonthly, strategy);
    const scenario = showScenario ? aggregateProjection(loans, scenarioExtra, strategy) : [];
    const horizon = Math.max(current.length, plan.length, scenario.length);
    const out: ProjectionPoint[] = [];
    for (let i = 0; i < horizon; i++) {
      out.push({
        label: monthsToLabel(i),
        current: toFinite(current[i]?.balance),
        plan: toFinite(plan[i]?.balance),
        ...(showScenario ? { scenario: toFinite(scenario[i]?.balance) } : {}),
      });
    }
    return out;
  }, [loans, extraMonthly, scenarioExtra, strategy, showScenario]);

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold tracking-tight">Payoff Projection</h2>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-muted/70" />Current plan</span>
          <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-accent" />{optimizedLabel}</span>
          {showScenario && (
            <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-[var(--c3)]" />Your scenario</span>
          )}
        </div>
      </div>
      <Impl data={data} currency={currency} showScenario={showScenario} optimizedLabel={optimizedLabel} />
      <div className="mt-3 grid grid-cols-2 divide-x divide-border border-t border-border pt-3">
        <div>
          <p className="text-xs text-muted">Current payoff</p>
          <p className="mt-1 text-base font-semibold">Current plan</p>
        </div>
        <div className="pl-4">
          <p className="text-xs text-muted">{optimizedLabel} payoff</p>
          <p className="mt-1 text-base font-semibold">Optimized <span className="ml-1 text-xs text-[var(--c3)]">{monthsSooner} months sooner</span></p>
        </div>
      </div>
    </section>
  );
}
