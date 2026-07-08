"use client";
import { CreditCard as CreditCardIcon } from "lucide-react";
import { useCreditCards, type CreditCard } from "@/lib/api/widget-data";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract, type Insight } from "@/lib/dashboard/widget-contract";

export type CreditCardVM = {
  cards: { id: string; name: string; balance: number; limit: number | null; utilization: number | null; dueDate: string | null; detailComplete: boolean; currency: string }[];
  totalBalance: number;
  totalLimit: number;
  currency: string;
  aggUtil: number | null;
  nextDue: { name: string; dueDate: string } | null;
  anyIncomplete: boolean;
};

function normalizeUtilization(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function nextFutureDueDate(dateStr: string | null | undefined, dueDay?: number | null): string | null {
  if (!dateStr) return null;
  const due = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due >= today || !dueDay) return dateStr;
  const next = new Date(today.getFullYear(), today.getMonth(), dueDay);
  if (next < today) next.setMonth(next.getMonth() + 1);
  const day = Math.min(dueDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate());
  next.setDate(day);
  return next.toISOString().slice(0, 10);
}

export function creditCardVM(cards: CreditCard[]): CreditCardVM {
  const rows = cards.map((c) => ({
    id: c.loan.id,
    name: c.loan.name,
    balance: Number(c.loan.outstanding_balance ?? c.loan.principal ?? c.statement_balance ?? 0),
    limit: c.credit_limit != null ? Number(c.credit_limit) : null,
    utilization: c.credit_limit != null && Number(c.credit_limit) > 0
      ? Number(c.loan.outstanding_balance ?? c.loan.principal ?? c.statement_balance ?? 0) / Number(c.credit_limit)
      : normalizeUtilization(c.utilization),
    dueDate: nextFutureDueDate(c.loan.next_due_date ?? null, c.loan.due_day ?? null),
    detailComplete: c.detail_complete,
    currency: c.loan.currency,
  }));
  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
  const totalLimit = rows.reduce((s, r) => s + (r.limit ?? 0), 0);
  const currency = rows[0]?.currency ?? "USD";
  const withDue = rows.filter((r) => r.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  return {
    cards: rows,
    totalBalance,
    totalLimit,
    currency,
    aggUtil: totalLimit > 0 ? totalBalance / totalLimit : null,
    nextDue: withDue[0] ? { name: withDue[0].name, dueDate: withDue[0].dueDate! } : null,
    anyIncomplete: rows.some((r) => !r.detailComplete),
  };
}

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + "T00:00:00").getTime() - today.getTime()) / 86_400_000);
}

function utilColor(u: number) { return u >= 0.5 ? "var(--destructive)" : "var(--accent)"; }

export const creditCardContract: WidgetContract<CreditCardVM> = {
  useData() {
    const q = useCreditCards();
    return queryState(q, {
      select: creditCardVM,
      isEmpty: (vm) => vm.cards.length === 0,
      partialReason: (vm) => (vm.anyIncomplete ? "Some cards missing limits" : undefined),
    });
  },
  deriveInsights(vm) {
    const chips: Insight[] = [];
    if (vm.nextDue) {
      const n = daysUntil(vm.nextDue.dueDate);
      if (n >= 0) chips.push({ label: `Due in ${n}d`, tone: n <= 3 ? "warning" : "neutral", severity: n <= 3 ? 8 : 3 });
    }
    if (vm.aggUtil != null && vm.aggUtil >= 0.3)
      chips.push({ label: `Utilization ${Math.round(vm.aggUtil * 100)}%`, tone: vm.aggUtil >= 0.5 ? "danger" : "warning", severity: Math.round(vm.aggUtil * 10) });
    return chips;
  },
  Body({ data, density, config }) {
    if (density === 0)
      return <CompactStat icon={CreditCardIcon} label="Card balance" value={formatCurrency(data.totalBalance, { compact: true, currency: data.currency })}
        hint={data.nextDue ? `Next due ${data.nextDue.dueDate}` : undefined} />;
    const showUtil = config.show?.utilization ?? true;
    const showDue = config.show?.due ?? true;
    const showAmounts = config.show?.amounts ?? true;
    const fallbackLimit = density >= 3 ? data.cards.length : Math.min(3, data.cards.length);
    const limit = Math.max(1, Math.min(data.cards.length, Math.round(Number(config.count ?? fallbackLimit))));
    const rows = [...data.cards].sort((a, b) => b.balance - a.balance).slice(0, limit);
    return (
      <div className="flex h-full flex-col">
        <p className="text-2xl font-extrabold tabular-nums tracking-tight">{formatCurrency(data.totalBalance, { currency: data.currency })}</p>
        <p className="text-[11px] font-semibold text-muted">total balance{data.totalLimit > 0 ? ` · ${formatCurrency(data.totalLimit, { currency: data.currency })} limit` : ""}</p>
        <div className="mt-2 flex-1 space-y-1.5 overflow-hidden">
          {rows.map((c) => (
            <div key={c.id} className="text-[12.5px]">
              <div className="flex justify-between gap-2">
                <span className="truncate text-muted">{c.name}</span>
                <span className="shrink-0 tabular-nums">{showAmounts ? formatCurrency(c.balance, { currency: c.currency }) : ""}{showDue && c.dueDate ? `${showAmounts ? " · " : ""}${c.dueDate}` : ""}</span>
              </div>
              {showUtil && c.utilization != null && (
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-track">
                  <span className="block h-full rounded" style={{ width: `${Math.min(100, Math.round(c.utilization * 100))}%`, background: utilColor(c.utilization) }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-3">
        <p className="text-3xl font-extrabold tabular-nums">{formatCurrency(data.totalBalance, { currency: data.currency })}</p>
        <div className="space-y-2">
          {data.cards.map((c) => (
            <div key={c.id} className="rounded-lg bg-chip px-3 py-2">
              <div className="flex justify-between text-[13px]"><b>{c.name}</b><span className="tabular-nums">{formatCurrency(c.balance, { currency: c.currency })}{c.limit != null ? ` / ${formatCurrency(c.limit, { currency: c.currency })}` : ""}</span></div>
              {c.utilization != null && (
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-track"><span className="block h-full rounded" style={{ width: `${Math.min(100, Math.round(c.utilization * 100))}%`, background: utilColor(c.utilization) }} /></div>
              )}
              <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{c.dueDate ? `Due ${c.dueDate}` : "No due date"}</span><span>{c.utilization != null ? `${Math.round(c.utilization * 100)}% util` : "—"}</span></div>
            </div>
          ))}
        </div>
      </div>
    );
  },
  emptyHint: "No credit cards yet. Add one to track balances and due dates.",
};
