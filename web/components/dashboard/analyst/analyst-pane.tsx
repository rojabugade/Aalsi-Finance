"use client";

import { useEffect, useState } from "react";
import { Activity, HelpCircle, MessageSquarePlus, Sparkles, Target, Wand2, X, type LucideIcon } from "lucide-react";
import { ChatThread } from "./chat-thread";
import { MonitorFeed } from "./monitor-feed";
import { resetThread } from "./thread-store";
import { useAnalyst, type AnalystMode } from "./use-analyst";

const TABS = [
  ["monitor", "Monitor", Activity],
  ["explain", "Explain", HelpCircle],
  ["plan", "Plan", Target],
  ["action", "Action", Wand2],
] as const satisfies readonly (readonly [AnalystMode, string, LucideIcon])[];

function makeThreadId() {
  return `dashboard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AnalystPane() {
  const { open, mode, setMode, closePane, runAction, range, focus, page, route, filters } = useAnalyst();
  const [threadId, setThreadId] = useState("dashboard");

  const startNewChat = () => {
    resetThread(threadId);
    setThreadId(makeThreadId());
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePane();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePane, open]);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/[0.08]" onClick={closePane} aria-hidden="true" />
      <aside
        id="analyst-liquid-glass"
        role="dialog"
        aria-modal="true"
        aria-label="AI Analyst"
        className="analyst-liquid-glass fixed inset-x-3 bottom-24 z-50 flex h-[min(660px,calc(100dvh-14rem))] flex-col overflow-hidden rounded-[28px] sm:inset-x-auto sm:right-6 sm:w-[min(420px,calc(100vw-3rem))]"
      >
        <header className="pointer-events-auto relative z-10 flex items-center justify-between border-b border-white/20 px-4 py-3.5">
          <span className="inline-flex items-center gap-2 text-[15px] font-bold text-fg"><Sparkles className="size-4 text-accent" /> AI Analyst</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Start new chat" title="Start new chat" onClick={startNewChat} className="grid size-7 place-items-center rounded-full border border-white/20 bg-white/10 text-muted shadow-sm transition hover:bg-white/25 hover:text-fg"><MessageSquarePlus className="size-3.5" /></button>
            <button type="button" aria-label="Close" onClick={closePane} className="grid size-7 place-items-center rounded-full border border-white/20 bg-white/10 text-muted shadow-sm transition hover:bg-white/25 hover:text-fg"><X className="size-3.5" /></button>
          </div>
        </header>
        <div role="tablist" className="pointer-events-auto relative z-10 mx-3 mt-2 flex items-center gap-1 rounded-2xl border border-white/20 bg-black/[0.04] p-1 shadow-inner">
          {TABS.map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-[12px] font-semibold transition-all ${mode === id ? "border border-white/30 bg-white/25 text-accent shadow-sm" : "border border-transparent text-muted hover:bg-white/10 hover:text-fg"}`}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <div className="pointer-events-auto relative z-10 min-h-0 flex-1 overflow-y-auto">
          {mode === "monitor" ? <MonitorFeed range={range} /> : (
            <ChatThread
              mode={mode}
              range={range}
              threadId={threadId}
              focus={focus}
              page={page}
              pageContext={{
                route,
                entity: focus?.label,
                visibleRange: `${range.from}..${range.to}`,
                filters: filters ?? undefined,
              }}
              onAction={runAction}
            />
          )}
        </div>
      </aside>
    </>
  );
}
