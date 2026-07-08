"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTransactions } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";

export function RecentActivityCard() {
  const txns = useTransactions();
  const recent = useMemo(
    () => [...(txns.data ?? [])].sort((a, b) => b.txn_date.localeCompare(a.txn_date)).slice(0, 5),
    [txns.data],
  );
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card" data-testid="recent-activity-card">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm">Recent activity</b>
        <Link href="/transactions?view=all" className="text-xs font-semibold text-accent">
          See all
        </Link>
      </div>
      {recent.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No transactions yet.</p>
      ) : (
        <div className="space-y-1">
          {recent.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-1.5">
              <span className="flex-1 truncate text-sm">
                {t.merchant ?? "Unknown"}
                <span className="block text-[11px] text-muted">{t.txn_date}</span>
              </span>
              <span className="text-sm font-bold tabular-nums">
                {formatCurrency(Number(t.amount), { currency: t.currency })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
