"use client";

import { useState } from "react";
import { Search, Sparkles } from "lucide-react";

/** Quick actions surfaced on focus (widgets.md §3). Inert until the AI Analyst slice (G). */
const QUICK_ACTIONS = [
  "Analyze this month",
  "Find subscriptions",
  "Show unusual spending",
  "Compare with last month",
  "Find uncategorized transactions",
  "Review upcoming bills",
];

/**
 * STUB. Presentational search / Ask-AI command bar. The input and quick actions
 * render but do not execute — real search + AI land in slice G (AI Analyst Pane).
 */
export function AskAiBar() {
  const [focused, setFocused] = useState(false);

  return (
    <div className="relative min-w-0 flex-1">
      <form
        onSubmit={(e) => e.preventDefault()}
        className="flex items-center gap-2 rounded-chip border border-border bg-card px-3 py-2 focus-within:border-accent"
      >
        <Search className="size-4 shrink-0 text-muted" />
        <input
          data-testid="ask-ai-input"
          type="text"
          placeholder="Search or ask about your money"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        />
        <span className="hidden items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted sm:inline-flex">
          <Sparkles className="size-3.5" /> AI
        </span>
      </form>

      {focused && (
        <div
          data-testid="ask-ai-quick-actions"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 rounded-xl border border-border bg-popover p-2 shadow-lg"
        >
          <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">Quick actions · coming soon</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a}
                type="button"
                disabled
                title="Coming soon"
                className="cursor-not-allowed rounded-chip bg-chip px-2.5 py-1.5 text-xs font-medium text-muted"
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
