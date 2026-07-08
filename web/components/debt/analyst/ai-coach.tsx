"use client";

import { ArrowRight, PanelRightClose, RotateCcw, Sparkles } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { DateRange } from "@/lib/dates";
import type { DebtPlan } from "@/lib/api/analyst";
import { ChatThread } from "@/components/dashboard/analyst/chat-thread";

export function AiCoach({
  threadId,
  range,
  plan,
  preamble,
  onCollapse,
  onSeeImpact,
}: {
  threadId: string;
  range: DateRange;
  plan?: DebtPlan | null;
  preamble?: string;
  onCollapse?: () => void;
  onSeeImpact?: () => void;
}) {
  const isAi = plan?.source === "ai";

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-card-sm border border-border bg-card shadow-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="inline-flex items-center gap-2 text-base font-bold">AI Coach <span className="rounded bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">BETA</span></span>
        <span className="flex items-center gap-2 text-muted">
          <RotateCcw className="size-4" />
          {onCollapse && (
            <button type="button" onClick={onCollapse} aria-label="Collapse AI Coach" className="rounded-md p-1.5 hover:bg-chip hover:text-fg">
              <PanelRightClose className="size-4" />
            </button>
          )}
        </span>
      </header>

      {plan && (
        <div className="mx-4 mt-5 rounded-xl border border-accent/30 bg-accent-soft/30 p-4">
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold text-accent"><Sparkles className="size-3.5" />{isAi ? "Top recommendation" : "Recommended plan"}</p>
          <p className="mt-5 text-base font-semibold capitalize">{plan.recommendation_name || `${plan.strategy} Boost`}</p>
          <p className="mt-1 text-xs leading-5 text-muted">{plan.narrative || plan.headline}</p>
          <div className="mt-5 grid grid-cols-2 divide-x divide-border border-y border-border py-3 text-center">
            <div><p className="text-[10px] text-muted">Save</p><p className="mt-1 font-semibold">{formatCurrency(Number(plan.interest_saved), { currency: plan.currency ?? "USD" })}</p><p className="text-[10px] text-muted">in interest</p></div>
            <div><p className="text-[10px] text-muted">Become debt free</p><p className="mt-1 font-semibold">{plan.months_sooner} months</p><p className="text-[10px] text-muted">sooner</p></div>
          </div>
          {plan.final_recommendation && (
            <p className="mt-4 text-xs leading-5 text-muted">{plan.final_recommendation}</p>
          )}
          <button type="button" onClick={onSeeImpact} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[var(--on-accent)]">See impact <ArrowRight className="size-4" /></button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <ChatThread mode="explain" range={range} threadId={threadId} preamble={preamble} />
      </div>

      <p className="border-t border-border px-4 py-2 text-[11px] text-muted">
        AI responses can make mistakes — verify important numbers.
      </p>
    </section>
  );
}
