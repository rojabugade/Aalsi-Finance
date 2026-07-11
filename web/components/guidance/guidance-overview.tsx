"use client";

import { useState } from "react";

import { GuidanceConversation, type PlanDraft } from "@/components/guidance/guidance-conversation";
import { PlanBuilder } from "@/components/guidance/plan-builder";
import { PlanItemDialog } from "@/components/guidance/plan-item-dialog";
import { Button } from "@/components/ui/button";
import { usePlanItems } from "@/lib/api/guidance";

const STARTER_PROMPTS = [
  "Review my financial readiness",
  "Explore investing in India",
  "Check cross-border obligations",
];

export function GuidanceOverview() {
  const plan = usePlanItems("open");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const openItems = plan.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-fg">Guidance overview</h2>
          <p className="mt-1 text-sm text-muted">Ask a sourced money question or build a checklist you can keep.</p>
        </div>
        <Button type="button" onClick={() => setBuilderOpen((open) => !open)}>
          Build my guidance plan
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <GuidanceConversation
          domain="general"
          threadId="overview"
          prompts={STARTER_PROMPTS}
          onSave={(nextDraft) => setDraft(nextDraft)}
        />
        <aside className="rounded-card-sm border border-border bg-card p-4 shadow-card" aria-labelledby="guidance-plan-preview-title">
          <div className="flex items-center justify-between gap-3">
            <h3 id="guidance-plan-preview-title" className="font-semibold">My Plan</h3>
            <a className="text-sm font-medium text-accent hover:underline" href="?section=plan">Open plan</a>
          </div>
          {plan.isLoading ? (
            <p className="mt-3 text-sm text-muted">Loading your plan…</p>
          ) : openItems.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Save an answer or build a checklist to start your plan.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {openItems.slice(0, 3).map((item) => <li key={item.id} className="rounded-md bg-chip px-3 py-2">{item.title}</li>)}
            </ul>
          )}
        </aside>
      </div>

      {builderOpen && <PlanBuilder />}
      <PlanItemDialog draft={draft} open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)} />
    </div>
  );
}
