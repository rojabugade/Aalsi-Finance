"use client";

import { AlertTriangle, CheckCircle2, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import type { RangePreset } from "@/lib/dates";
import { AddMenu } from "@/components/shell/add-menu";
import { DateRangePicker } from "@/components/date-range-picker";
import { AskAiBar } from "./ask-ai-bar";

/**
 * Slice B — Global Controls Layer (widgets.md §1.1). A page-level command bar for
 * the dashboard surface. REAL now: date range (drives the board's global range),
 * Customize toggle, Add menu (existing capture routes). STUBBED (present-but-inert
 * until their slices): Ask-AI bar (G), Review chip (H). The AI Analyst opens
 * from the floating dashboard blob.
 */
export function DashboardControls({
  range,
  onRangeChange,
  editing,
  onToggleEditing,
  personalizeSlot,
  embedded = false,
}: {
  range: RangePreset;
  onRangeChange: (v: RangePreset) => void;
  editing: boolean;
  onToggleEditing: () => void;
  personalizeSlot?: ReactNode;
  embedded?: boolean;
}) {
  // Stub: review count is wired to the Review Queue in slice H. Hidden while zero.
  const reviewCount = 0;

  return (
    <div
      data-testid="dashboard-controls"
      className={embedded
        ? "relative z-10 flex flex-wrap items-center gap-2 bg-transparent"
        : "relative z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/60 p-2 backdrop-blur-md"}
    >
      <AddMenu />

      {!embedded && <div className="hidden min-w-0 flex-1 sm:block">
        <AskAiBar />
      </div>}

      <div className="ml-auto flex items-center gap-2">
        <DateRangePicker mode="controlled" preset={range} onPresetChange={onRangeChange} />

        <button
          type="button"
          onClick={onToggleEditing}
          aria-pressed={editing}
          className={`inline-flex items-center gap-1.5 rounded-chip border px-3 py-2 text-xs font-semibold transition-[color,background-color,border-color] duration-200 ${
            editing
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
              : "border-border text-muted hover:text-fg"
          }`}
        >
          {editing ? <CheckCircle2 className="size-4" /> : <Settings2 className="size-4" />}
          {editing ? "Done" : "Personalize"}
        </button>

        {/* STUB — Review Queue chip (slice H). Hidden until there is something to review. */}
        {reviewCount > 0 && (
          <span
            data-testid="review-chip"
            className="hidden items-center gap-1.5 rounded-chip border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-600 md:inline-flex dark:text-amber-400"
          >
            <AlertTriangle className="size-3.5" /> {reviewCount} need review
          </span>
        )}
      </div>

      {/* STUB — sync / data-trust indicator (widgets.md §15) */}
      <span
        data-testid="sync-status"
        className="hidden w-full items-center gap-1.5 px-1 text-[11px] font-medium text-muted lg:flex lg:w-auto"
      >
        <span className="size-1.5 rounded-full bg-emerald-500" /> Synced just now
      </span>

      {personalizeSlot && (
        <div className="w-full">
          {personalizeSlot}
        </div>
      )}
    </div>
  );
}
