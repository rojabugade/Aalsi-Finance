import type { Loan } from "@/lib/api/loans";
import { formatCurrency } from "@/lib/format";

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

function utilizationTint(pct: number) {
  if (pct >= 0.9) return "bg-destructive";
  if (pct >= 0.5) return "bg-[var(--c2)]";
  return "bg-accent";
}

export function CardTile({ loan }: { loan: Loan }) {
  const d = loan.credit_card_detail ?? null;
  const ccy = loan.currency ?? "USD";
  const balance = n(loan.outstanding_balance ?? loan.principal);
  const limit = n(d?.credit_limit);
  const util = d?.utilization ?? (limit > 0 ? balance / limit : null);
  const utilPct = util != null ? Math.round(util * 100) : null;

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">{loan.name}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {formatCurrency(balance, { currency: ccy })} of {formatCurrency(limit, { currency: ccy })}
          </p>
        </div>
        {loan.penalty_warning ? (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
            {loan.penalty_warning}
          </span>
        ) : null}
      </div>

      {utilPct != null && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>Utilization</span>
            <span className="tabular-nums">{utilPct}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-chip">
            <div className={`h-full ${utilizationTint(util ?? 0)}`} style={{ width: `${Math.min(100, utilPct)}%` }} />
          </div>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Detail label="Available">{d?.available_credit != null ? formatCurrency(n(d.available_credit), { currency: ccy }) : "—"}</Detail>
        <Detail label="Statement balance">{d?.statement_balance != null ? formatCurrency(n(d.statement_balance), { currency: ccy }) : "—"}</Detail>
        <Detail label="Minimum payment">{loan.min_or_emi_amount != null ? formatCurrency(n(loan.min_or_emi_amount), { currency: ccy }) : "—"}</Detail>
        <Detail label="Due">{loan.next_due_date ?? (loan.due_day ? `Day ${loan.due_day}` : "—")}</Detail>
        <Detail label="APR">{loan.interest_rate != null ? `${n(loan.interest_rate).toFixed(2)}%` : "—"}</Detail>
        <Detail label="Statement day">{d?.statement_day != null ? `Day ${d.statement_day}` : "—"}</Detail>
      </dl>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
