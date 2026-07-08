"use client";
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, WifiOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function WidgetLoading() {
  return <Skeleton className="h-full w-full rounded-lg" />;
}

export function WidgetEmpty({ hint }: { hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-muted">
      <Inbox className="size-5 opacity-70" />
      <p className="text-[11.5px] leading-snug">{hint ?? "Nothing to show yet."}</p>
    </div>
  );
}

export function WidgetError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-muted">
      <AlertTriangle className="size-5 text-destructive/80" />
      <p className="text-[11.5px] leading-snug">Couldn&apos;t load this widget.</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-0.5 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-fg hover:bg-chip"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function WidgetPartial({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
        <WifiOff className="size-3 shrink-0" />
        <span className="truncate">{reason}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
