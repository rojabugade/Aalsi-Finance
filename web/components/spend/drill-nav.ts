"use client";

import { createContext, useContext } from "react";
import type { Category, Transaction } from "@/lib/api/transactions";

export type DrillFrame =
  | { kind: "category"; id: string }
  | { kind: "merchant"; name: string }
  | { kind: "transaction"; id: string }
  | { kind: "bucket"; from: string; to: string; label: string };

export type DrillNav = { push: (f: DrillFrame) => void; pop: () => void; depth: number };

export const DrillNavContext = createContext<DrillNav | null>(null);

export function useDrillNav(): DrillNav {
  const ctx = useContext(DrillNavContext);
  if (!ctx) throw new Error("useDrillNav must be used within a DrillStack");
  return ctx;
}

export function frameKey(f: DrillFrame): string {
  switch (f.kind) {
    case "category": return `category:${f.id}`;
    case "merchant": return `merchant:${f.name}`;
    case "transaction": return `transaction:${f.id}`;
    case "bucket": return `bucket:${f.from}:${f.to}`;
  }
}

export function frameTitle(f: DrillFrame, cats: Category[], txns: Transaction[]): string {
  switch (f.kind) {
    case "category": return cats.find((c) => c.id === f.id)?.name ?? "Category";
    case "merchant": return f.name;
    case "transaction": return txns.find((t) => t.id === f.id)?.merchant ?? "Transaction";
    case "bucket": return f.label;
  }
}
