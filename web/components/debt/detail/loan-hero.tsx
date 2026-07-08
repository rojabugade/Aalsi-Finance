"use client";

import type { Loan } from "@/lib/api/loans";
import { formatCurrency, formatDateShort, formatRelativeDueDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { loanImage, loanTypeLabel } from "./loan-images";

function Stat({ label, value, bar }: { label: string; value: string; bar?: number }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p data-numeric className="mt-0.5 text-lg font-bold tracking-tight">{value}</p>
      {bar != null && (
        <div className="mt-1 h-1 w-full rounded-full bg-chip">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </div>
      )}
    </div>
  );
}

export function LoanHero({ loan, onPay, onViewStatements }: { loan: Loan; onPay: () => void; onViewStatements: () => void }) {
  const outstanding = Number(loan.outstanding_balance ?? loan.principal);
  const active = outstanding > 0;
  const cur = loan.currency;
  return (
    <section className="relative overflow-hidden rounded-card-sm border border-border shadow-card">
      <img src={loanImage(loan)} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--app-bg)] via-[var(--app-bg)]/80 to-transparent" />
      <div className="relative grid gap-6 p-6 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{loanTypeLabel(loan.type)}</span>
            {active && <span className="rounded-full bg-[color:var(--soft3)] px-2 py-0.5 text-xs font-semibold text-[color:var(--c3)]">Active</span>}
          </div>
          <h1 className="text-2xl font-extrabold capitalize tracking-tight">{loan.name}</h1>
          <div className="flex gap-2">
            <Button onClick={onPay}>Make a payment</Button>
            <Button variant="outline" onClick={onViewStatements}>View statements</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 self-center rounded-card-sm bg-card/70 p-4 backdrop-blur sm:grid-cols-4 md:grid-cols-2">
          <Stat label="Outstanding" value={formatCurrency(outstanding, { currency: cur })} />
          <Stat label="APR" value={loan.interest_rate != null ? `${Number(loan.interest_rate)}%` : "—"} />
          <Stat label="Monthly" value={loan.min_or_emi_amount != null ? formatCurrency(loan.min_or_emi_amount, { currency: cur }) : "—"} />
          <Stat label="Payoff progress" value={loan.progress_pct != null ? `${Number(loan.progress_pct)}%` : "—"} bar={loan.progress_pct != null ? Number(loan.progress_pct) : undefined} />
        </div>
      </div>
    </section>
  );
}

export function DueStatus({ loan, onViewSchedule }: { loan: Loan; onViewSchedule: () => void }) {
  const due = loan.next_due_date;
  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <h2 className="text-sm font-semibold">Due status</h2>
      {due ? (
        <div className="mt-2">
          <p className="text-base font-bold">{formatRelativeDueDate(due)}</p>
          <p data-numeric className="mt-0.5 text-xs text-muted">{formatDateShort(due)}</p>
        </div>
      ) : (
        <p className="mt-2 text-base font-bold text-[color:var(--c3)]">All caught up</p>
      )}
      {loan.penalty_warning && <p className="mt-1 text-xs text-c2">{loan.penalty_warning}</p>}
      <Button variant="outline" className="mt-3" onClick={onViewSchedule}>View schedule</Button>
    </section>
  );
}
