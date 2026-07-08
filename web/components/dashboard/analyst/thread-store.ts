"use client";

import { useSyncExternalStore } from "react";
import type { AskOut } from "@/lib/api/analyst";

export type ChatMessage = { role: "user" | "analyst"; text: string; result?: AskOut };

const EMPTY: ChatMessage[] = [];
const threads = new Map<string, ChatMessage[]>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getThread(id: string): ChatMessage[] {
  return threads.get(id) ?? EMPTY;
}

export function appendMessage(id: string, message: ChatMessage): void {
  threads.set(id, [...getThread(id), message]);
  emit();
}

export function resetThread(id: string): void {
  if (threads.delete(id)) emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThread(id: string): ChatMessage[] {
  return useSyncExternalStore(
    subscribe,
    () => getThread(id),
    () => getThread(id),
  );
}
