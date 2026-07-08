"use client";

import { useMemo } from "react";
import type { Transaction } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { inRange } from "@/lib/spend/period";
import { useDrillNav } from "./drill-nav";

/**
 * Bucket drill body — the transactions inside a single chart bar's date range.
 * Rendered inside the shared DrillStack; each row pushes a transaction frame.
 */
export function BucketDrillBody({
  from, to, txns, currency,
}: { from: string; to: string; txns: Transaction[]; currency: string }) {
  const { push } = useDrillNav();
  const rows = useMemo(
    () => txns.filter((t) => inRange(t.txn_date, from, to)).sort((a, b) => b.txn_date.localeCompare(a.txn_date)),
    [txns, from, to],
  );
  const total = useMemo(() => rows.reduce((a, t) => a + Math.abs(Number(t.amount)), 0), [rows]);

  return (
    <div className="space-y-3" data-testid="spend-bucket-drill">
      <div className="rounded-card-sm border border-border bg-gradient-to-br from-accent-soft/70 to-card p-4 shadow-card">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{rows.length} transactions</p>
        <p className="mt-1 text-[28px] font-extrabold leading-none tabular-nums">{formatCurrency(total, { currency })}</p>
      </div>
      <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No transactions in this period.</p>
        ) : (
          rows.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => push({ kind: "transaction", id: t.id })}
              className="flex w-full items-center gap-3 py-2 text-left hover:bg-chip"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {t.merchant ?? "Unknown"}
                <span className="block text-[11px] text-muted">{t.txn_date.slice(0, 10)}</span>
              </span>
              <span className="text-sm font-bold tabular-nums">
                {formatCurrency(Math.abs(Number(t.amount)), { currency: t.currency })}
              </span>
              <span className="text-muted">›</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
