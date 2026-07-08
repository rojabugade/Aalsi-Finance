"use client";
import { Bell, Sparkles, Check } from "lucide-react";
import { useMonitor, useAcknowledgeAlert, type AnalystAction, type PersistentAlert } from "@/lib/api/analyst";
import { useAnalyst } from "@/components/dashboard/analyst/use-analyst";
import { presetRange } from "@/lib/dates";
import { queryState, type WidgetContract, type Insight } from "@/lib/dashboard/widget-contract";

type AlertData = {
  alerts: PersistentAlert[];
  top: PersistentAlert | null;
  acknowledge: (id: string) => void;
  runAction: (action: AnalystAction) => void;
};

const toneClass: Record<string, string> = {
  danger: "text-destructive",
  warning: "text-c2",
  positive: "text-c3",
  info: "text-accent",
};

function insightTone(tone: PersistentAlert["tone"]): Insight["tone"] {
  if (tone === "info") return "neutral";
  return tone;
}

export const aiAlertContract: WidgetContract<AlertData> = {
  useData(config) {
    const analyst = useAnalyst();
    const acknowledge = useAcknowledgeAlert();
    const monitor = useMonitor(presetRange(config.range ?? "3m"));
    return queryState(monitor, {
      select: (data): AlertData => {
        const alerts = data.alerts ?? [];
        return { alerts, top: alerts[0] ?? null, acknowledge: (id) => acknowledge.mutate(id), runAction: analyst.runAction };
      },
      isEmpty: () => false,
    });
  },
  deriveInsights(data) {
    return data.top
      ? [{ label: data.top.title, tone: insightTone(data.top.tone), severity: data.top.severity }]
      : [{ label: "All clear", tone: "positive", severity: 3 }];
  },
  Body({ data, config, density }) {
    if (!data.top) return <div className="flex h-full flex-col justify-center text-[12.5px]"><span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold uppercase text-accent"><Sparkles className="size-3" />Analyst</span><p className="mt-2 leading-relaxed">Nothing needs your attention right now.</p></div>;
    const small = density === 0;
    const alert = data.top;
    const action = alert.suggested_action;
    return (
      <div className="flex h-full flex-col text-[12.5px]">
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold uppercase text-accent"><Sparkles className="size-3" />Analyst</span>
        <p className={`mt-2 text-[13px] font-bold leading-snug ${toneClass[alert.tone] ?? "text-fg"}`}>{alert.title}</p>
        {!small && <p className="mt-1 line-clamp-3 leading-relaxed text-muted">{alert.detail}</p>}
        {!small && (config.show?.actions ?? true) && (
          <div className="mt-auto flex min-w-0 gap-2 pt-2">
            {action && (
              <button
                type="button"
                onClick={() => data.runAction(action)}
                className="inline-flex min-w-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-on-accent"
              >
                <Bell className="size-3" />
                <span className="truncate">{action.label}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => data.acknowledge(alert.id)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted hover:text-fg"
            >
              <Check className="size-3" />
              Acknowledge
            </button>
          </div>
        )}
      </div>
    );
  },
  Focus({ data }) {
    return data.alerts.length > 0 ? (
      <div className="space-y-2">
        {data.alerts.map((alert) => (
          <div key={alert.id} className="rounded-lg bg-chip px-3 py-2 text-[13px]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`font-bold ${toneClass[alert.tone] ?? "text-fg"}`}>{alert.title}</p>
                <p className="mt-0.5 text-muted">{alert.detail}</p>
              </div>
              <button type="button" onClick={() => data.acknowledge(alert.id)} className="shrink-0 rounded p-1 text-muted hover:bg-card hover:text-fg" aria-label={`Acknowledge ${alert.title}`}>
                <Check className="size-4" />
              </button>
            </div>
            {alert.suggested_action && (
              <button type="button" onClick={() => data.runAction(alert.suggested_action!)} className="mt-2 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-on-accent">
                {alert.suggested_action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    ) : <p className="text-[13px]">Nothing needs your attention right now.</p>;
  },
};
