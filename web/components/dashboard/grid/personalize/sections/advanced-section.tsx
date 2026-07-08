"use client";
import type { useDashboard } from "@/lib/dashboard/use-dashboard";

export function AdvancedSection({ controller }: { controller: ReturnType<typeof useDashboard> }) {
  const { reset } = controller;
  return (
    <div>
      <button onClick={reset} className="w-full rounded-xl border border-border py-2.5 text-[12px] text-muted hover:text-fg">↺ Reset layout</button>
    </div>
  );
}
