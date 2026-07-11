"use client";

import { useState } from "react";

import { CrossBorderModule } from "@/components/guidance/cross-border-module";
import { GuidanceConversation, type PlanDraft } from "@/components/guidance/guidance-conversation";
import { PlanItemDialog } from "@/components/guidance/plan-item-dialog";
import { useLimits, type Citation } from "@/lib/api/guidance";

const STARTER_PROMPTS = [
  "How does residency affect my reporting?",
  "What remittance rules should I review?",
  "Which account types may need reporting?",
  "How do cross-border tax concepts apply?",
];

function warningText(warning: Record<string, unknown>) {
  const message = warning.message;
  return typeof message === "string" && message.trim()
    ? message
    : "Review this corpus-defined cross-border warning before acting.";
}

function warningScore(warning: Record<string, unknown>) {
  const ratio = Number(warning.ratio);
  return Number.isFinite(ratio) ? ratio : 0;
}

function warningDraft(warning: Record<string, unknown>, citations: Citation[]): PlanDraft {
  const limitTitle = typeof warning.limit_title === "string" && warning.limit_title.trim()
    ? `Review ${warning.limit_title}`
    : "Review cross-border warning";

  return {
    question: limitTitle,
    answer: warningText(warning),
    citations,
    domain: "cross_border",
    threadId: "cross-border",
  };
}

export function CrossBorderGuidance() {
  const limits = useLimits();
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const warnings = (limits.data?.warnings ?? []) as Record<string, unknown>[];
  const highestWarning = warnings.reduce<Record<string, unknown> | null>(
    (highest, warning) => (!highest || warningScore(warning) > warningScore(highest) ? warning : highest),
    null,
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-fg">Cross-border guidance</h2>
        <p className="mt-1 text-sm text-muted">Ask sourced questions, track transfers, and review corpus-defined limits.</p>
      </div>

      <section className="rounded-card-sm border border-border bg-card p-4 shadow-card" aria-labelledby="cross-border-summary-title">
        <h3 id="cross-border-summary-title" className="text-sm font-semibold">Current limit summary</h3>
        {limits.isLoading ? (
          <p className="mt-1 text-sm text-muted">Loading corpus-defined limits…</p>
        ) : limits.isError ? (
          <p className="mt-1 text-sm text-destructive">Current limits are unavailable. Retry below.</p>
        ) : highestWarning ? (
          <p className="mt-1 text-sm text-destructive">{warningText(highestWarning)}</p>
        ) : (
          <p className="mt-1 text-sm text-muted">No current corpus-defined warning.</p>
        )}
      </section>

      <div data-testid="cross-border-guidance-layout" className="grid gap-6 lg:grid-cols-2">
        <GuidanceConversation
          domain="cross_border"
          threadId="cross-border"
          prompts={STARTER_PROMPTS}
          onSave={setDraft}
        />
        <CrossBorderModule onSaveWarning={(warning, citations) => setDraft(warningDraft(warning, citations))} />
      </div>

      <PlanItemDialog draft={draft} open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)} />
    </div>
  );
}
