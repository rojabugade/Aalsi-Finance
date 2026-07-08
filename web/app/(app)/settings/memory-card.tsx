"use client";

import { toast } from "sonner";

import { useMemoryStatus, useReindexMemory } from "@/lib/api/analyst";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const LABELS: Record<string, string> = {
  transaction: "transactions",
  loan: "loans",
  recurring: "recurring items",
  document: "documents",
  note: "notes",
  account: "accounts",
  account_balance: "account balances",
  payment_method: "payment methods",
  budget: "budgets",
  merchant: "merchants",
  category: "categories",
  tag: "tags",
  rule: "rules",
  income_source: "income sources",
  investment_holding: "investment holdings",
  holding_valuation: "holding valuations",
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function MemoryCard() {
  const status = useMemoryStatus();
  const reindex = useReindexMemory();

  const coverage = (status.data?.sources ?? [])
    .filter((s) => s.count > 0)
    .map((s) => `${s.count.toLocaleString()} ${LABELS[s.source_type] ?? s.source_type}`)
    .join(", ");

  async function resync() {
    try {
      await reindex.mutateAsync();
      toast.success("Memory re-synced");
    } catch {
      toast.error("Couldn't re-sync memory");
    }
  }

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">Memory</h2>
        <p className="text-sm text-muted">What the analyst has indexed and can recall.</p>
      </div>
      {status.isLoading ? (
        <Skeleton className="h-10" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {coverage || "Nothing indexed yet."}
            {status.data?.last_synced && (
              <span className="text-muted"> · last synced {timeAgo(status.data.last_synced)}</span>
            )}
          </p>
          <Button variant="outline" onClick={resync} disabled={reindex.isPending}>
            {reindex.isPending ? "Syncing…" : "Re-sync now"}
          </Button>
        </div>
      )}
    </div>
  );
}
