"use client";

import { useState } from "react";
import { CheckCircle2, Layers, Scissors } from "lucide-react";
import type { ReviewGroup, ResolveAction } from "@/lib/api/review";
import { Button } from "@/components/ui/button";
import { ConfirmCard } from "./confirm-card";

type Data = Record<string, unknown>;

export function SuggestedGroupCard({
  group,
  pending,
  onConfirm,
  onSplitResolve,
}: {
  group: ReviewGroup;
  pending: boolean;
  onConfirm: (memberIds: string[]) => void | Promise<void>;
  onSplitResolve: (documentId: string, action: ResolveAction, data?: Data) => Promise<void>;
}) {
  const [split, setSplit] = useState(false);
  const s = (group.suggested.summary ?? {}) as Data;
  const merchant = String(s.merchant ?? "Receipt");
  const total = s.total != null ? String(s.total) : "—";
  const count = group.member_document_ids.length;

  if (split) {
    return (
      <li className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-2">
        <p className="px-1 text-xs text-muted">Splitting group — confirm each item on its own.</p>
        <ul className="space-y-2">
          {group.members.map((m) => (
            <ConfirmCard
              key={m.document_id}
              item={m}
              pending={pending}
              onResolve={(action, data) => onSplitResolve(m.document_id, action, data)}
            />
          ))}
        </ul>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-accent/50 bg-accent/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Layers className="size-4 text-accent" /> {merchant} · {total}
          </p>
          <p className="text-xs text-muted">Looks like one receipt — from {count} images</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" disabled={pending} onClick={() => onConfirm(group.member_document_ids)}>
            <CheckCircle2 className="size-4" /> Confirm
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setSplit(true)}>
            <Scissors className="size-4" /> Split apart
          </Button>
        </div>
      </div>
    </li>
  );
}
