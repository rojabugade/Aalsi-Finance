"use client";

import { formatCurrency } from "@/lib/format";
import { RefreshCw, Sparkles } from "@/lib/icons";
import { useRecalcDebtPlan, type DebtAggressionLevel, type DebtPlan } from "@/lib/api/analyst";
import { cn } from "@/lib/utils";

const AGGRESSION_OPTIONS: { value: DebtAggressionLevel; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Aggressive" },
  { value: "asap", label: "ASAP" },
];

export function SmartPrioritization({
  plan,
  currency,
  aggressionLevel,
  onAggressionChange,
  onApply,
}: {
  plan: DebtPlan;
  currency: string;
  aggressionLevel?: DebtAggressionLevel;
  onAggressionChange?: (level: DebtAggressionLevel) => void;
  onApply: (extra: number) => void;
}) {
  const isAi = plan.source === "ai";
  const num = (v: unknown) => Number(v ?? 0);
  const recalc = useRecalcDebtPlan(aggressionLevel);
  const milestones = plan.milestones as
    | {
        first_loan_paid_off_months?: number | null;
        monthly_cash_still_left?: string | number | null;
        confidence_level?: string | null;
      }
    | undefined;

  return (
    <section className="flex min-h-[250px] flex-col rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2">
        {isAi && <Sparkles className="size-4 text-accent" />}
        <h2 className="text-base font-bold tracking-tight">
          {isAi ? "AI Smart Prioritization" : "Smart Prioritization"}
        </h2>
        <button
          type="button"
          onClick={() => recalc.mutate()}
          disabled={recalc.isPending}
          title="Recalculate now"
          aria-label="Recalculate now"
          className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:border-accent/50 hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", recalc.isPending && "animate-spin")} />
        </button>
      </div>
      {!isAi && (
        <p className="mt-1 text-xs text-muted">AI coaching is off — showing the math-based plan.</p>
      )}
      {aggressionLevel && onAggressionChange && (
        <div className="mt-4 grid grid-cols-4 rounded-lg border border-border p-1">
          {AGGRESSION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onAggressionChange(option.value)}
              className={cn(
                "min-h-8 rounded-md px-2 text-xs font-semibold text-muted",
                aggressionLevel === option.value && "bg-accent text-[var(--on-accent)]",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-sm leading-6 text-muted">
        You&apos;ll save <span className="font-semibold text-fg">{formatCurrency(num(plan.interest_saved), { currency })}</span> in interest and be debt free <span className="font-semibold text-fg">{plan.months_sooner} months sooner.</span>
      </p>
      <p className="sr-only">{plan.headline}</p>
      {milestones && (
        <div className="mt-3 grid grid-cols-3 divide-x divide-border border-y border-border py-3 text-center">
          <div>
            <p className="text-[10px] text-muted">First payoff</p>
            <p className="mt-1 text-sm font-semibold">
              {milestones.first_loan_paid_off_months ? `${milestones.first_loan_paid_off_months} mo` : "n/a"}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted">Cash left</p>
            <p className="mt-1 text-sm font-semibold">{formatCurrency(num(milestones.monthly_cash_still_left), { currency })}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted">Confidence</p>
            <p className="mt-1 text-sm font-semibold">{milestones.confidence_level ?? "Medium"}</p>
          </div>
        </div>
      )}

      <ol className="mt-3 space-y-2">
        {(plan.ordered ?? []).map((item) => (
          <li key={item.loan_id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
              {item.order}
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 flex-1 truncate font-medium capitalize">{item.name}</span>
                <span className="shrink-0 text-xs text-muted">Extra {formatCurrency(num(item.extra_allocation), { currency })}/mo</span>
                {item.impact === "Highest impact" && (
                  <span className="hidden rounded-full bg-[var(--soft2)] px-2 py-0.5 text-[10px] font-semibold text-[var(--c2)] sm:inline-flex">
                    Highest impact
                  </span>
                )}
            </div>
          </li>
        ))}
      </ol>

      {/* mt-auto bottom-pins the button to align with the sibling card; pt-4 keeps a
          guaranteed gap above it once the loan list grows tall enough to collapse mt-auto. */}
      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={() => onApply(num(plan.extra_monthly))}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[var(--on-accent)]"
        >
          Apply plan
        </button>
      </div>
    </section>
  );
}
