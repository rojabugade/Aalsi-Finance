"use client";

import type { AnalystAction } from "@/lib/api/analyst";

const ACTION_TYPES = new Set([
  "create_widget", "open_personalize", "focus_widget", "set_budget", "snooze_alert", "dismiss_alert",
]);

export function isRunnable(action: AnalystAction): boolean {
  return ACTION_TYPES.has(action.type);
}

export function ActionCard({
  action,
  onConfirm,
}: {
  action: AnalystAction;
  onConfirm: (action: AnalystAction) => void;
}) {
  if (!isRunnable(action)) {
    return <div className="rounded-lg border border-border bg-card/40 p-2 text-[12px] text-muted">{action.label}</div>;
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/40 p-2">
      <span className="text-[12px] text-fg">{action.label}</span>
      <button type="button" onClick={() => onConfirm(action)} className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-on-accent">
        Confirm
      </button>
    </div>
  );
}
