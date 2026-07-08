"use client";
import type { Insight } from "@/lib/dashboard/widget-contract";

const TONE: Record<NonNullable<Insight["tone"]>, string> = {
  neutral: "bg-chip text-muted",
  positive: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  danger: "bg-destructive/12 text-destructive",
};

export function InsightChips({ insights, cap }: { insights: Insight[]; cap: number }) {
  if (insights.length === 0) return null;
  const shown = [...insights]
    .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))
    .slice(0, Math.max(0, cap));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((c, i) => (
        <span
          key={`${c.label}-${i}`}
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight ${TONE[c.tone ?? "neutral"]}`}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
