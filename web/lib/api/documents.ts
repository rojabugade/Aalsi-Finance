import { useQuery } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type DocumentRow = components["schemas"]["DocumentOut"];
export type TransactionRef = components["schemas"]["TransactionRef"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

/** A document is mid-pipeline until OCR finishes (or fails). */
const PENDING_STATUSES = new Set(["uploaded", "processing"]);

export function documentsPending(docs: DocumentRow[] | undefined): boolean {
  return !!docs?.some((d) => PENDING_STATUSES.has(d.status));
}

export function useDocuments() {
  return useQuery<DocumentRow[]>({
    queryKey: ["documents"],
    queryFn: () => unwrap(api.GET("/documents", {})),
    // OCR runs in a background worker; poll while anything is still processing so
    // "Recent activity" and the review queue update without a manual refresh.
    refetchInterval: (query) => (documentsPending(query.state.data) ? 2500 : false),
  });
}

export function provenanceLabel(txns: TransactionRef[] | undefined): string {
  if (!txns || txns.length === 0) return "—";
  const t = txns[0];
  const at = t.merchant ? ` at ${t.merchant}` : "";
  const more = txns.length > 1 ? ` (+${txns.length - 1} more)` : "";
  return `→ $${t.amount}${at}${more}`;
}
