"use client";

import { useMemo } from "react";
import { formatCurrency } from "@/lib/format";
import {
  allocationBreakdown,
  savingsVsBaseline,
  suggestedExtraMax,
  type LoanLike,
} from "../debt-math";

export function ScenarioSimulator({
  loans,
  strategy,
  currency,
  extra,
  onExtraChange,
  onViewFull,
}: {
  loans: LoanLike[];
  strategy: "snowball" | "avalanche";
  currency: string;
  extra: number;
  onExtraChange: (n: number) => void;
  onViewFull: () => void;
}) {
  const savings = useMemo(
    () => savingsVsBaseline(loans, extra, strategy),
    [loans, extra, strategy],
  );
  const split = useMemo(
    () => allocationBreakdown(loans, extra, strategy),
    [loans, extra, strategy],
  );
  const sliderMax = useMemo(
    () => Math.max(suggestedExtraMax(loans), Math.ceil(extra / 250) * 250),
    [loans, extra],
  );
  const sliderStep = Math.max(25, Math.round(sliderMax / 80 / 25) * 25);
  const extraTotal = split.reduce((a, r) => a + r.extra, 0) || 1;
  const targetTag = strategy === "avalanche" ? "Highest APR" : "Smallest balance";

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <h2 className="text-base font-bold tracking-tight">Scenario Simulator</h2>
      <span className="sr-only">What if you paid more?</span>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">What if I pay extra…</p>
        <div className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1">
          <span className="text-sm text-muted">{currency === "USD" ? "$" : ""}</span>
          <input
            type="number"
            min={0}
            step={25}
            value={extra}
            onChange={(e) => onExtraChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            className="w-24 bg-transparent text-right text-sm font-semibold tabular-nums outline-none"
            aria-label="Extra monthly payment"
          />
          <span className="text-[10px] text-muted">/mo</span>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={sliderMax}
        step={sliderStep}
        value={Math.min(extra, sliderMax)}
        onChange={(e) => onExtraChange(Number(e.target.value))}
        className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-chip accent-[var(--accent)]"
        aria-label="Extra monthly payment slider"
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>$0</span>
        <span>{formatCurrency(sliderMax, { currency, compact: true })}+</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-chip p-3">
          <p className="text-[11px] text-muted">Interest saved</p>
          <p data-testid="sim-interest-saved" data-numeric className="text-lg font-extrabold tracking-tight">
            {formatCurrency(savings.interestSaved, { currency })}
          </p>
        </div>
        <div className="rounded-lg bg-chip p-3">
          <p className="text-[11px] text-muted">New payoff</p>
          <p data-numeric className="text-lg font-extrabold tracking-tight">{savings.monthsSooner} mo sooner</p>
        </div>
      </div>

      {extra > 0 && split.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-chip/40 p-3" data-testid="sim-allocation">
          <p className="text-[11px] font-semibold text-muted">
            Where your {formatCurrency(extra, { currency })} extra goes
            <span className="ml-1 font-normal capitalize text-muted/80">· {strategy}</span>
          </p>
          <ul className="mt-2.5 space-y-2.5">
            {split.map((a, i) => (
              <li key={a.id} data-testid="sim-alloc-row">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium capitalize">{a.name}</span>
                    {i === 0 && (
                      <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                        {targetTag}
                      </span>
                    )}
                  </span>
                  <span data-numeric className={"shrink-0 font-semibold " + (a.extra > 0 ? "text-accent" : "text-muted")}>
                    {a.extra > 0 ? `+${formatCurrency(a.extra, { currency })}` : "min only"}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(a.extra / extraTotal) * 100}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-muted">
                  {formatCurrency(a.total, { currency })}/mo total
                  {a.clears && <span className="ml-1 font-medium text-[var(--c3)]">· clears this month</span>}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onViewFull}
        className="mt-4 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[var(--on-accent)]"
      >
        View full scenario
      </button>
    </section>
  );
}
