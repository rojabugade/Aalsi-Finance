"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { DateRange } from "@/lib/dates";
import { useAnalystAsk, useThreadHistory, type AnalystAction } from "@/lib/api/analyst";
import { ActionCard } from "./action-card";
import type { AnalystMode } from "./use-analyst";
import { appendMessage, getThread, useThread } from "./thread-store";

const PROMPTS: Record<Exclude<AnalystMode, "monitor">, string[]> = {
  explain: ["Why did my cash flow drop?", "What changed vs last month?"],
  plan: ["Help me cut spending", "Plan to pay off my cards"],
  action: ["Create a coffee-spending widget", "Set a dining budget"],
};

export function ChatThread({
  mode,
  range,
  threadId,
  preamble,
  focus,
  page,
  pageContext,
  onAction,
}: {
  mode: Exclude<AnalystMode, "monitor">;
  range: DateRange;
  threadId: string;
  preamble?: string;
  focus?: { kind: "merchant" | "category"; label: string; id?: string } | null;
  page?: string;
  pageContext?: {
    route?: string;
    entity?: string;
    visibleRange?: string;
    filters?: Record<string, unknown>;
  } | null;
  onAction?: (action: AnalystAction) => void;
}) {
  const ask = useAnalystAsk();
  const [input, setInput] = useState("");
  const messages = useThread(threadId);
  const history = useThreadHistory(threadId);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current || getThread(threadId).length > 0) return;
    const serverMessages = history.data?.messages;
    if (!serverMessages || serverMessages.length === 0) return;
    hydrated.current = true;
    for (const message of serverMessages) {
      appendMessage(threadId, { role: message.role, text: message.text });
    }
  }, [history.data, threadId]);

  const submit = async (question: string) => {
    const value = question.trim();
    if (!value || ask.isPending) return;
    setInput("");
    appendMessage(threadId, { role: "user", text: value });
    try {
      const result = await ask.mutateAsync({
        mode,
        question: preamble ? `${preamble}. ${value}` : value,
        range_from: range.from,
        range_to: range.to,
        thread_id: threadId,
        ...(page ? { page } : {}),
        ...(focus ? { focus_kind: focus.kind, focus_label: focus.label, focus_id: focus.id } : {}),
        ...(pageContext ? {
          page_context: {
            route: pageContext.route ?? null,
            entity: pageContext.entity ?? null,
            visible_range: pageContext.visibleRange ?? null,
            filters: pageContext.filters ?? null,
          },
        } : {}),
      });
      appendMessage(threadId, { role: "analyst", text: result.answer, result });
    } catch {
      appendMessage(threadId, { role: "analyst", text: "Something went wrong. Try again." });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {PROMPTS[mode].map((prompt) => (
              <button key={prompt} type="button" onClick={() => void submit(prompt)} className="rounded-chip bg-chip px-2.5 py-1.5 text-[12px] font-medium text-fg hover:bg-accent-soft/30">
                {prompt}
              </button>
            ))}
          </div>
        )}
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto w-fit max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-[13px] text-on-accent" : "mr-auto w-full max-w-[92%] space-y-2"}>
            {message.role === "analyst" ? (
              <>
                <div className={`whitespace-pre-wrap rounded-2xl border p-3 text-[13px] ${message.result?.available === false ? "border-amber-500/40 bg-amber-500/10 text-muted" : "border-border bg-card/50 text-fg"}`}>
                  {message.text}
                </div>
                {message.result?.citations && message.result.citations.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted">
                    Sources: {Array.from(new Set(message.result.citations.map((c) => c.source_type))).join(", ")}
                  </p>
                )}
              </>
            ) : message.text}
            {onAction && message.result?.suggestions?.map((action, actionIndex) => (
              <ActionCard key={`${action.type}-${actionIndex}`} action={action} onConfirm={onAction} />
            ))}
          </div>
        ))}
        {ask.isPending && <div className="mr-auto w-fit rounded-2xl border border-border bg-card/50 px-3 py-2 text-[13px] text-muted">Thinking…</div>}
      </div>
      <form data-testid="analyst-composer" onSubmit={(event) => { event.preventDefault(); void submit(input); }} className="flex items-center gap-2 border-t border-border p-3">
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask the analyst…" className="min-w-0 flex-1 rounded-chip border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent" />
        <button type="submit" disabled={!input.trim() || ask.isPending} aria-label="Send" className="grid size-9 place-items-center rounded-chip bg-accent text-on-accent disabled:opacity-50">
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
