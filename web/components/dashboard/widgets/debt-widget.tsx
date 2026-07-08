"use client";
import { Landmark } from "lucide-react";
import { useLoans, type Loan } from "@/lib/api/loans";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract, type Insight } from "@/lib/dashboard/widget-contract";

export type DebtVM = {
  loans: { id: string; name: string; balance: number; rate: number | null; monthly: number | null; nextDue: string | null; currency: string }[];
  totalDebt: number;
  totalMonthly: number;
  currency: string;
  maxRate: number | null;
  nextPayment: { name: string; nextDue: string } | null;
};

export function debtVM(loans: Loan[], includeCC: boolean): DebtVM {
  const rows = loans
    .filter((l) => includeCC || l.type !== "credit_card")
    .map((l) => ({
      id: l.id,
      name: l.name,
      balance: Number(l.outstanding_balance ?? l.principal ?? 0),
      rate: l.interest_rate != null ? Number(l.interest_rate) : null,
      monthly: l.min_or_emi_amount != null ? Number(l.min_or_emi_amount) : null,
      nextDue: l.next_due_date ?? null,
      currency: l.currency,
    }));
  const withDue = rows.filter((r) => r.nextDue).sort((a, b) => a.nextDue!.localeCompare(b.nextDue!));
  const rates = rows.map((r) => r.rate).filter((r): r is number => r != null);
  const currency = rows[0]?.currency ?? "USD";
  return {
    loans: rows,
    totalDebt: rows.reduce((s, r) => s + r.balance, 0),
    totalMonthly: rows.reduce((s, r) => s + (r.monthly ?? 0), 0),
    currency,
    maxRate: rates.length ? Math.max(...rates) : null,
    nextPayment: withDue[0] ? { name: withDue[0].name, nextDue: withDue[0].nextDue! } : null,
  };
}

export const debtContract: WidgetContract<DebtVM> = {
  useData(config) {
    const includeCC = config.show?.includeCC ?? false;
    const q = useLoans();
    return queryState(q, {
      select: (loans) => debtVM(loans, includeCC),
      isEmpty: (vm) => vm.loans.length === 0,
    });
  },
  deriveInsights(vm) {
    const chips: Insight[] = [];
    if (vm.nextPayment) chips.push({ label: `Next: ${vm.nextPayment.nextDue}`, tone: "neutral", severity: 4 });
    if (vm.maxRate != null) chips.push({ label: `APR ${vm.maxRate}%`, tone: vm.maxRate >= 15 ? "warning" : "neutral", severity: Math.min(9, Math.round(vm.maxRate / 2)) });
    return chips;
  },
  Body({ data, density, config }) {
    if (density === 0)
      return <CompactStat icon={Landmark} label="Total debt" value={formatCurrency(data.totalDebt, { compact: true, currency: data.currency })}
        hint={data.nextPayment ? `Next ${data.nextPayment.nextDue}` : undefined} />;
    const showRate = config.show?.rate ?? true;
    const showMonthly = config.show?.monthly ?? true;
    const limit = density >= 3 ? data.loans.length : Math.min(3, data.loans.length);
    const rows = [...data.loans].sort((a, b) => b.balance - a.balance).slice(0, limit);
    return (
      <div className="flex h-full flex-col">
        <p className="text-2xl font-extrabold tabular-nums tracking-tight">{formatCurrency(data.totalDebt, { currency: data.currency })}</p>
        {showMonthly && data.totalMonthly > 0 && <p className="text-[11px] font-semibold text-muted">{formatCurrency(data.totalMonthly, { currency: data.currency })}/mo across {data.loans.length}</p>}
        <div className="mt-2 flex-1 space-y-1 overflow-hidden">
          {rows.map((l) => (
            <div key={l.id} className="flex justify-between gap-2 text-[12.5px]">
              <span className="truncate text-muted">{l.name}{showRate && l.rate != null ? ` · ${l.rate}%` : ""}</span>
              <span className="shrink-0 tabular-nums">{formatCurrency(l.balance, { currency: l.currency })}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-3">
        <p className="text-3xl font-extrabold tabular-nums">{formatCurrency(data.totalDebt, { currency: data.currency })}</p>
        <p className="text-[12px] text-muted">{formatCurrency(data.totalMonthly, { currency: data.currency })}/mo total</p>
        <div className="space-y-2">
          {data.loans.map((l) => {
            const months = l.monthly && l.monthly > 0 ? Math.ceil(l.balance / l.monthly) : null;
            return (
              <div key={l.id} className="rounded-lg bg-chip px-3 py-2 text-[12.5px]">
                <div className="flex justify-between"><b>{l.name}</b><span className="tabular-nums">{formatCurrency(l.balance, { currency: l.currency })}</span></div>
                <div className="mt-1 flex justify-between text-[11px] text-muted">
                  <span>{l.rate != null ? `${l.rate}% APR` : "—"}{l.monthly != null ? ` · ${formatCurrency(l.monthly, { currency: l.currency })}/mo` : ""}</span>
                  <span>{months != null ? `~${months} mo left` : l.nextDue ? `Due ${l.nextDue}` : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
  emptyHint: "No loans tracked yet. Add a loan to see debt and payoff progress.",
};
