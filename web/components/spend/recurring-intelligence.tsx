"use client";

import { useMemo } from "react";
import { Repeat } from "lucide-react";
import type { Category, Transaction } from "@/lib/api/transactions";
import { useRecurringSeries, type RecurringSeries } from "@/lib/api/widget-data";
import { formatCurrency } from "@/lib/format";
import { spendAmount } from "@/lib/spend/derive";

const CADENCE_FACTOR: Record<string, number> = {
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
  irregular: 0,
};

function monthlyAmount(amount: number, cadence: string) {
  return amount * (CADENCE_FACTOR[cadence] ?? 0);
}

function canonicalRow(s: RecurringSeries) {
  const amount = Number(s.amount ?? 0);
  return {
    id: s.id,
    name: s.name,
    amount,
    monthly: monthlyAmount(amount, s.cadence),
    cadence: s.cadence,
    type: s.type,
    status: s.status,
    nextDue: s.next_due_date ?? null,
    merchant: s.merchant_name ?? null,
    currency: s.currency,
    source: "series" as const,
  };
}

export function RecurringIntelligence({
  txns,
  cats,
  currency,
  onMerchant,
}: {
  txns: Transaction[];
  cats: Category[];
  currency: string;
  onMerchant: (merchant: string) => void;
}) {
  const series = useRecurringSeries("active");
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  const heuristicRows = useMemo(() => {
    const m = new Map<string, { total: number; count: number; months: Set<string>; currency: string }>();
    for (const t of txns) {
      const merchant = t.merchant?.trim();
      if (!merchant) continue;
      const spend = spendAmount(t, byId);
      if (spend <= 0) continue;
      const key = merchant.toLowerCase();
      const row = m.get(key) ?? { total: 0, count: 0, months: new Set(), currency: t.currency };
      row.total += spend;
      row.count += 1;
      row.months.add(t.txn_date.slice(0, 7));
      m.set(key, row);
    }
    return [...m.entries()]
      .filter(([, r]) => r.months.size >= 3)
      .map(([name, r]) => ({
        id: `merchant:${name}`,
        name,
        amount: r.total / Math.max(1, r.count),
        monthly: r.total / Math.max(1, r.months.size),
        cadence: "monthly",
        type: "merchant pattern",
        status: "detected",
        nextDue: null,
        merchant: name,
        currency: r.currency,
        source: "heuristic" as const,
      }))
      .sort((a, b) => b.monthly - a.monthly);
  }, [txns, byId]);

  const canonical = useMemo(() => (series.data ?? []).map(canonicalRow), [series.data]);
  const rows = canonical.length > 0 ? canonical : heuristicRows;
  const totalMonthly = rows.reduce((sum, r) => sum + r.monthly, 0);

  return (
    <div className="space-y-3" data-testid="spend-recurring-intelligence">
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-card-sm border border-border bg-gradient-to-br from-accent-soft/70 to-card p-4 shadow-card">
          <Repeat className="size-5 text-accent" />
          <p className="mt-3 text-2xl font-extrabold tabular-nums">
            {formatCurrency(totalMonthly, { currency })}<span className="text-sm font-semibold text-muted">/mo</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            {canonical.length > 0 ? "Canonical recurring series" : "Detected from merchant cadence"}
          </p>
        </div>
        <div className="rounded-card-sm border border-border bg-card p-4 shadow-card lg:col-span-2">
          <b className="text-sm">Fixed expense frame</b>
          <p className="mt-1 text-sm text-muted">
            Bills and subscriptions stay here. Debt payoff and loan details remain on Debt.
          </p>
        </div>
      </div>

      {series.isLoading ? (
        <div className="rounded-card-sm border border-border bg-card p-8 text-center text-sm text-muted shadow-card">Loading recurring spend...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-card-sm border border-border bg-card p-8 text-center text-sm text-muted shadow-card">
          No recurring obligations detected yet. Upload statements or add recurring items from Income.
        </div>
      ) : (
        <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => r.merchant && onMerchant(r.merchant)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-chip"
            >
              <span className="grid size-9 flex-none place-items-center rounded-xl bg-accent-soft text-accent">
                <Repeat className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                <span className="block text-[11px] text-muted">
                  {r.type} · {r.cadence} · {r.status}{r.nextDue ? ` · next ${r.nextDue}` : ""}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-sm font-extrabold tabular-nums">{formatCurrency(r.amount, { currency: r.currency })}</span>
                <span className="block text-[11px] text-muted">{formatCurrency(r.monthly, { currency: r.currency })}/mo</span>
              </span>
              {r.merchant && <span className="text-muted">›</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
