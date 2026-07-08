"use client";

import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";
import { ChevronRight, Landmark, Home } from "@/lib/icons";
import { Car, CreditCard, GraduationCap } from "lucide-react";
import type { ReactNode } from "react";
import type { Loan } from "@/lib/api/loans";
import { num } from "../debt-math";

const TYPE_LABEL: Record<string, string> = {
  home: "Mortgage", auto: "Auto", education: "Student",
  personal: "Personal", credit_card: "Credit card", other: "Other",
};

export function DebtList({ loans, action }: { loans: Loan[]; action?: ReactNode }) {
  const router = useRouter();
  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold tracking-tight">Your Debts</h2>
        {action}
      </div>
      <ul className="space-y-2">
        {loans.map((loan) => {
          const outstanding = num(loan.outstanding_balance ?? loan.principal);
          const progress = Math.max(0, Math.min(100, num(loan.progress_pct)));
          const LoanIcon = loan.type === "home" ? Home : loan.type === "auto" ? Car : loan.type === "credit_card" ? CreditCard : loan.type === "education" ? GraduationCap : Landmark;
          return (
            <li key={loan.id}>
              <button
                type="button"
                onClick={() => router.push(`/debt?loan=${loan.id}`)}
                className="grid w-full grid-cols-[auto_minmax(125px,1.3fr)_repeat(4,minmax(88px,1fr))_auto] items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-accent/50 max-lg:grid-cols-[auto_1fr_auto]"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <LoanIcon className="size-4" />
                </span>
                <div className="min-w-0">
                  <span className="block truncate font-semibold capitalize">{loan.name}</span>
                  <span className="block text-xs text-muted">{TYPE_LABEL[loan.type] ?? loan.type}</span>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-chip">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="mt-1 block text-[11px] font-medium text-[var(--c3)]">{Math.round(progress)}% paid</span>
                </div>
                <Metric label="Remaining Balance" value={formatCurrency(outstanding, { currency: loan.currency })} />
                <Metric label="Interest Rate" value={loan.interest_rate != null ? `${num(loan.interest_rate).toFixed(2)}%` : "—"} />
                <Metric label="Monthly Payment" value={loan.min_or_emi_amount != null ? formatCurrency(loan.min_or_emi_amount, { currency: loan.currency }) : "—"} />
                <Metric label="Next Due" value={loan.next_due_date ?? "—"} />
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="max-lg:hidden">
      <p className="text-[10px] text-muted">{label}</p>
      <p data-numeric className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
