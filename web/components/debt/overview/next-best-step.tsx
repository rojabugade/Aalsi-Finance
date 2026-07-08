"use client";

import { Zap } from "@/lib/icons";
import type { DebtPlan } from "@/lib/api/analyst";
import { formatCurrency } from "@/lib/format";

export function NextBestStep({
  plan,
  onDismiss,
}: {
  plan: DebtPlan;
  onDismiss: () => void;
}) {
  const top = plan.ordered?.[0];
  if (!top) return null;

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-card-sm border border-border bg-card p-4 shadow-card">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-[var(--on-accent)]">
        <Zap className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Next best step</p>
        <p className="text-xs text-muted">
          Put your extra toward <span className="font-medium capitalize">{top.name}</span> — {top.rationale}.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold"
        >
          Dismiss
        </button>
      </div>
      <div className="ml-auto hidden border-l border-border pl-5 sm:block">
        <p className="text-[11px] text-muted">Impact</p>
        <p className="mt-1 text-sm font-semibold">Save {formatCurrency(Number(plan.interest_saved ?? 0), { currency: plan.currency ?? "USD" })} <span className="ml-3">{plan.months_sooner} months</span></p>
      </div>
    </section>
  );
}
