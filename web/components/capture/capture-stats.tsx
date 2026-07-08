"use client";

import type { DocumentRow } from "@/lib/api/documents";

export function computeCaptureStats(
  docs: DocumentRow[],
  waitingCount: number,
  now: Date = new Date(),
): { waiting: number; addedThisWeek: number; failed: number } {
  const weekAgo = now.getTime() - 7 * 86400000;
  let addedThisWeek = 0;
  let failed = 0;
  for (const d of docs) {
    if (d.status === "failed") failed += 1;
    if (d.status === "processed" && new Date(d.created_at).getTime() >= weekAgo) {
      addedThisWeek += 1;
    }
  }
  return { waiting: waitingCount, addedThisWeek, failed };
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-sm font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex items-baseline gap-1.5 hover:underline">
      {body}
    </button>
  ) : (
    <span className="flex items-baseline gap-1.5">{body}</span>
  );
}

export function CaptureStats({
  waiting,
  addedThisWeek,
  failed,
  onWaitingClick,
  onFailedClick,
}: {
  waiting: number;
  addedThisWeek: number;
  failed: number;
  onWaitingClick?: () => void;
  onFailedClick?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Stat label="to review" value={waiting} onClick={waiting > 0 ? onWaitingClick : undefined} />
      <Stat label="added this week" value={addedThisWeek} />
      <Stat label="failed" value={failed} onClick={failed > 0 ? onFailedClick : undefined} />
    </div>
  );
}
