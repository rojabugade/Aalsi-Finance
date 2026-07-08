"use client";

import { Check } from "lucide-react";
import { Private } from "@/components/dashboard/privacy-provider";
import type { DateRange } from "@/lib/dates";
import { useMonitor, useAcknowledgeAlert, type AnalystAction, type PersistentAlert } from "@/lib/api/analyst";
import { useAnalyst } from "./use-analyst";

const TONE: Record<PersistentAlert["tone"], string> = {
  danger: "border-red-500/40 bg-red-500/10",
  warning: "border-amber-500/40 bg-amber-500/10",
  info: "border-border bg-card/40",
  positive: "border-emerald-500/40 bg-emerald-500/10",
};

export function AlertList({
  alerts,
  onAction,
  onAcknowledge,
}: {
  alerts: PersistentAlert[];
  onAction: (action: AnalystAction) => void;
  onAcknowledge: (id: string) => void;
}) {
  if (!alerts.length) {
    return <p className="p-4 text-[13px] text-muted">All clear — nothing needs your attention.</p>;
  }
  return (
    <ul className="space-y-2 p-3">
      {alerts.map((alert) => {
        const acknowledged = alert.state === "acknowledged";
        const sources = Array.from(new Set((alert.supporting_refs ?? []).map((r) => r.source_type)));
        return (
          <li key={alert.id} className={`rounded-xl border p-3 ${TONE[alert.tone]} ${acknowledged ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-fg">{alert.title}</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  <Private kind="money">{alert.detail}</Private>
                </p>
                {sources.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted">Sources: {sources.join(", ")}</p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  {alert.suggested_action && (
                    <button
                      type="button"
                      onClick={() => onAction(alert.suggested_action!)}
                      className="rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-on-accent"
                    >
                      {alert.suggested_action.label}
                    </button>
                  )}
                  {acknowledged ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                      <Check className="size-3" /> Acknowledged
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAcknowledge(alert.id)}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted hover:text-fg"
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function MonitorFeed({ range }: { range: DateRange }) {
  const { runAction } = useAnalyst();
  const query = useMonitor(range);
  const acknowledge = useAcknowledgeAlert();
  if (query.isLoading) {
    return <div className="space-y-2 p-3">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-chip" />)}</div>;
  }
  if (query.isError) {
    return <div className="p-4 text-[13px] text-muted">Couldn’t load alerts. <button type="button" className="font-semibold text-accent" onClick={() => query.refetch()}>Retry</button></div>;
  }
  return <AlertList alerts={query.data?.alerts ?? []} onAction={runAction} onAcknowledge={(id) => acknowledge.mutate(id)} />;
}
