"use client";

import { useState } from "react";

import { CrossBorderModule } from "@/components/guidance/cross-border-module";
import { GuidanceConversation, type PlanDraft } from "@/components/guidance/guidance-conversation";
import { PlanItemDialog } from "@/components/guidance/plan-item-dialog";

const STARTER_PROMPTS = [
  "How does residency affect my reporting?",
  "What remittance rules should I review?",
  "Which account types may need reporting?",
  "How do cross-border tax concepts apply?",
];

export function CrossBorderGuidance() {
  const [draft, setDraft] = useState<PlanDraft | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-fg">International Money</h2>
        <p className="mt-1 text-sm text-muted">Transfers, reporting, and sourced information.</p>
      </div>

      <div data-testid="cross-border-guidance-layout" className="grid gap-6 lg:grid-cols-2">
        <GuidanceConversation
          domain="cross_border"
          threadId="cross-border"
          prompts={STARTER_PROMPTS}
          onSave={setDraft}
        />
        <CrossBorderModule />
      </div>

      <PlanItemDialog draft={draft} open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)} />
    </div>
  );
}
