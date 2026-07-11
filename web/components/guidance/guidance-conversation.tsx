"use client";

import { useEffect, useRef, useState } from "react";

import { GuidanceAnswer } from "@/components/guidance/guidance-answer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useGuidanceAsk,
  useGuidanceThread,
  type AskOut,
  type Citation,
  type GuidanceDomain,
  type GuidanceThread,
} from "@/lib/api/guidance";

export type PlanDraft = {
  question: string;
  answer: string;
  citations: Citation[];
  domain: GuidanceDomain;
  threadId: "overview" | "cross-border";
};

type ConversationMessage =
  | { role: "user"; text: string }
  | { role: "analyst"; question: string; result: AskOut };

type ThreadMessages = {
  threadId: "overview" | "cross-border";
  items: ConversationMessage[];
};

function hydrateMessages(thread: GuidanceThread): ConversationMessage[] {
  let lastQuestion = "Guidance answer";

  return (thread.messages ?? []).map((message) => {
    if (message.role === "user") {
      lastQuestion = message.text;
      return { role: "user", text: message.text };
    }

    return {
      role: "analyst",
      question: lastQuestion,
      result: {
        answer: message.text,
        citations: message.citations ?? [],
        disclaimer: message.disclaimer ?? "",
      },
    };
  });
}

function sameMessage(left: ConversationMessage, right: ConversationMessage) {
  if (left.role === "user") {
    return right.role === "user" && left.text === right.text;
  }

  return (
    right.role === "analyst" &&
    left.question === right.question &&
    left.result.answer === right.result.answer
  );
}

function mergeMessages(serverMessages: ConversationMessage[], localMessages: ConversationMessage[]) {
  for (let overlap = Math.min(serverMessages.length, localMessages.length); overlap > 0; overlap -= 1) {
    const serverOverlap = serverMessages.slice(-overlap);
    if (serverOverlap.every((message, index) => sameMessage(message, localMessages[index]))) {
      return [...serverMessages, ...localMessages.slice(overlap)];
    }
  }

  return [...serverMessages, ...localMessages];
}

export function GuidanceConversation({
  domain,
  threadId,
  prompts,
  defaultCountry = "",
  defaultTopic = "",
  onSave,
}: {
  domain: GuidanceDomain;
  threadId: "overview" | "cross-border";
  prompts: string[];
  defaultCountry?: string;
  defaultTopic?: string;
  onSave: (draft: PlanDraft) => void;
}) {
  const ask = useGuidanceAsk();
  const history = useGuidanceThread(threadId);
  const hydratedThreadId = useRef<ThreadMessages["threadId"] | null>(null);
  const [conversation, setConversation] = useState<ThreadMessages>({ threadId, items: [] });
  const [question, setQuestion] = useState("");
  const [country, setCountry] = useState(defaultCountry);
  const [topic, setTopic] = useState(defaultTopic);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const messages = conversation.threadId === threadId ? conversation.items : [];

  useEffect(() => {
    if (!history.data || hydratedThreadId.current === threadId) return;
    hydratedThreadId.current = threadId;
    const serverMessages = hydrateMessages(history.data);
    setConversation((current) => {
      const localMessages = current.threadId === threadId ? current.items : [];
      return {
        threadId,
        items: mergeMessages(serverMessages, localMessages),
      };
    });
  }, [history.data, threadId]);

  const submit = async (value: string) => {
    const trimmedQuestion = value.trim();
    if (!trimmedQuestion || isSubmitting || ask.isPending) return;

    setIsSubmitting(true);
    setFailedQuestion(null);
    try {
      const result = await ask.mutateAsync({
        question: trimmedQuestion,
        domain,
        thread_id: threadId,
        country: country.trim() || null,
        topic: topic.trim() || null,
      });
      setConversation((current) => ({
        threadId,
        items: [
          ...(current.threadId === threadId ? current.items : []),
          { role: "user", text: trimmedQuestion },
          { role: "analyst", question: trimmedQuestion, result },
        ],
      }));
      setQuestion("");
    } catch {
      setFailedQuestion(trimmedQuestion);
    } finally {
      setIsSubmitting(false);
    }
  };

  const pending = isSubmitting || ask.isPending;

  return (
    <section className="space-y-4 rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="space-y-3" data-testid="guidance-answers" aria-live="polite">
        {messages.length === 0 && !history.isLoading && (
          <div className="flex flex-wrap gap-2">
            {prompts.map((prompt) => (
              <Button
                key={prompt}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void submit(prompt)}
              >
                {prompt}
              </Button>
            ))}
          </div>
        )}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <p
              key={`user-${index}`}
              className="ml-auto w-fit max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-sm text-on-accent"
            >
              {message.text}
            </p>
          ) : (
            <GuidanceAnswer
              key={`analyst-${index}`}
              result={message.result}
              onSave={() =>
                onSave({
                  question: message.question,
                  answer: message.result.answer,
                  citations: message.result.citations,
                  domain,
                  threadId,
                })
              }
            />
          ),
        )}

        {pending && (
          <p className="text-sm text-muted">Searching the guidance corpus…</p>
        )}

        {failedQuestion && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            <span>We couldn&apos;t get an answer. Your question is still here.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void submit(failedQuestion)}>
              Retry
            </Button>
          </div>
        )}
      </div>

      <form
        data-testid="guidance-composer"
        className="space-y-3 border-t border-border pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(question);
        }}
      >
        <label className="space-y-1">
          <span className="text-sm font-medium">Question</span>
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask a guidance question…"
          />
        </label>

        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Add country and topic</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Country</span>
              <Input value={country} onChange={(event) => setCountry(event.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Topic</span>
              <Input value={topic} onChange={(event) => setTopic(event.target.value)} />
            </label>
          </div>
        </details>

        <Button type="submit" disabled={!question.trim() || pending}>
          {pending ? "Searching…" : "Ask guidance"}
        </Button>
      </form>
    </section>
  );
}
