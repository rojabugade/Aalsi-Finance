"use client";

import { formatCurrency } from "@/lib/format";
import { totalsSummary, weightedAvgRate, type LoanLike } from "../debt-math";

export function OverviewRing({
  loans,
  currency,
  onTrack,
}: {
  loans: LoanLike[];
  currency: string;
  onTrack: boolean;
}) {
  const { totalOutstanding, totalMonthly, pctPaid } = totalsSummary(loans);
  const apr = weightedAvgRate(loans);
  const pct = Math.max(0, Math.min(100, pctPaid));
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <section className="flex min-h-[250px] flex-col rounded-card-sm border border-border bg-card p-5 shadow-card">
      <h2 className="text-base font-bold tracking-tight">Debt Overview</h2>
      <div className="mt-3 flex flex-1 items-start justify-between gap-5">
        <div>
          <p className="text-xs text-muted">Total</p>
          <p data-numeric className="mt-1 text-3xl font-medium tracking-tight">{formatCurrency(totalOutstanding, { currency })}</p>
          <p className="mt-1 text-xs text-muted">Across {loans.length} {loans.length === 1 ? "account" : "accounts"}</p>
        </div>
        <div className="relative grid size-32 shrink-0 place-items-center">
          <svg viewBox="0 0 120 120" className="size-32 -rotate-90">
            <circle cx="60" cy="60" r={r} fill="none" stroke="var(--chip)" strokeWidth="6" />
            <circle cx="60" cy="60" r="43" fill="none" stroke="var(--border)" strokeWidth="1.5" />
            <circle
              cx="60" cy="60" r={r} fill="none" stroke="var(--accent)" strokeWidth="6"
              strokeLinecap="round" strokeDasharray={`${dash} ${circ}`}
              style={{ transition: "stroke-dasharray 700ms ease" }}
            />
          </svg>
          <div className="absolute text-center">
            <p data-numeric className="text-xl font-extrabold tracking-tight">{Math.round(pct)}%</p>
            <p className="text-[11px] text-muted">Paid off</p>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label="Monthly payment" value={formatCurrency(totalMonthly, { currency })} badge={onTrack ? "On track" : undefined} />
        <Stat label="Interest rate (avg.)" value={`${apr.toFixed(1)}%`} />
      </div>
    </section>
  );
}

function Stat({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs text-muted">{label}</p>
      <p data-numeric className="mt-2 text-lg font-bold tracking-tight">{value}</p>
      {badge && <span className="mt-2 inline-flex rounded-full bg-[var(--soft3)] px-2 py-0.5 text-[11px] font-semibold text-[var(--c3)]">{badge}</span>}
    </div>
  );
}
