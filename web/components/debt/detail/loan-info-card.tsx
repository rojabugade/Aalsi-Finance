"use client";

import { formatCurrency } from "@/lib/format";
import type { Loan } from "@/lib/api/loans";
import { Button } from "@/components/ui/button";
import { loanTypeLabel } from "./loan-images";

const SCHEDULE: Record<string, { label: string; meaning: string }> = {
  revolving: { label: "Revolving", meaning: "balance can go up and down; minimum due each month" },
  amortizing: { label: "Amortizing", meaning: "fixed payments that steadily retire the balance" },
  emi: { label: "EMI", meaning: "equal monthly installments over a set term" },
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd data-numeric className="text-sm font-semibold">{value}</dd>
    </div>
  );
}

export function LoanInfoCard({ loan, onEdit }: { loan: Loan; onEdit: () => void }) {
  const schedule = SCHEDULE[loan.schedule_kind ?? ""] ?? { label: loan.schedule_kind ?? "—", meaning: "" };
  const term =
    loan.start_date && loan.end_date
      ? `${loan.start_date} → ${loan.end_date}`
      : loan.start_date ? `from ${loan.start_date}` : "—";

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold tracking-tight">Loan details</h2>
        <Button variant="outline" onClick={onEdit}>Edit details</Button>
      </div>
      <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
        <Row label="Type" value={loanTypeLabel(loan.type)} />
        <Row label="Schedule" value={schedule.label} />
        <Row label="Compounding" value={loan.compounding ?? "—"} />
        <Row label="Original principal" value={formatCurrency(loan.principal, { currency: loan.currency })} />
        <Row label="APR" value={loan.interest_rate != null ? `${Number(loan.interest_rate)}%` : "—"} />
        <Row label="Term" value={term} />
        <Row label="Due day" value={loan.due_day != null ? `Day ${loan.due_day}` : "—"} />
        <Row label="Monthly" value={loan.min_or_emi_amount != null ? formatCurrency(loan.min_or_emi_amount, { currency: loan.currency }) : "—"} />
        <Row label="Currency" value={loan.currency} />
      </dl>
      {schedule.meaning && <p className="mt-2 text-xs text-muted">{schedule.label} — {schedule.meaning}.</p>}
    </section>
  );
}
