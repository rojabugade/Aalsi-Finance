"use client";

import { Sparkles } from "lucide-react";
import { useMonitor } from "@/lib/api/analyst";
import { useAnalyst } from "./use-analyst";

export function AnalystBlob() {
  const { toggle, open, range } = useAnalyst();
  const query = useMonitor(range);
  // The server already omits resolved alerts; acknowledged ones still count.
  const alerts = query.data?.alerts ?? [];
  const urgent = alerts.some((alert) => alert.severity >= 7);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="AI Analyst"
      aria-expanded={open}
      className="fixed bottom-6 right-6 z-50 grid size-14 place-items-center rounded-full border border-border bg-card/90 text-accent shadow-card backdrop-blur-xl transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {urgent && <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-accent/40 motion-reduce:animate-none" />}
      <Sparkles className="size-6" />
      {alerts.length > 0 && (
        <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
          {alerts.length}
        </span>
      )}
    </button>
  );
}
