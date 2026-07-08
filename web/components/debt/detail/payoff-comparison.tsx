"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { Loan } from "@/lib/api/loans";
import { useDebtPlan } from "@/lib/api/analyst";
import { formatCurrency } from "@/lib/format";
import { amortize, num, savingsVsBaseline, type LoanLike } from "../debt-math";
import type { ComparisonPoint } from "./payoff-comparison-impl";

const Impl = dynamic(() => import("./payoff-comparison-impl").then((m) => m.PayoffComparisonImpl), {
  ssr: false,
  loading: () => <div className="h-[220px] w-full animate-pulse rounded-card-sm bg-chip" />,
});

const DEFAULT_EXTRA = 50;

export function PayoffComparison({ loan }: { loan: Loan }) {
  const plan = useDebtPlan();
  const cur = loan.currency;
  const outstanding = num(loan.outstanding_balance ?? loan.principal);
  const rate = num(loan.interest_rate);
  const basePayment = num(loan.min_or_emi_amount) || Math.max(1, outstanding * 0.02);
  const extra = Math.max(0, Math.round(num(plan.data?.extra_monthly) || DEFAULT_EXTRA));

  const { data, savings } = useMemo(() => {
    const baseline = amortize(outstanding, rate, basePayment);
    const optimized = amortize(outstanding, rate, basePayment + extra);
    const horizon = Math.max(baseline.series.length, optimized.series.length);
    const points: ComparisonPoint[] = [{ label: "Now", current: outstanding, optimized: outstanding }];
    for (let m = 0; m < horizon; m++) {
      points.push({
        label: `M${m + 1}`,
        current: m < baseline.series.length ? baseline.series[m] : 0,
        optimized: m < optimized.series.length ? optimized.series[m] : 0,
      });
    }
    const loanLike: LoanLike = loan as unknown as LoanLike;
    return { data: points, savings: savingsVsBaseline([loanLike], extra, "avalanche") };
  }, [loan, outstanding, rate, basePayment, extra]);

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
        <div>
          <h2 className="mb-3 text-base font-bold tracking-tight">Payoff comparison</h2>
          <Impl data={data} currency={cur} />
        </div>
        <div className="space-y-3 rounded-card-sm bg-accent-soft p-4">
          <p className="text-sm font-semibold text-accent">Optimize and save</p>
          <div>
            <p className="text-[11px] text-muted">Interest saved with +{formatCurrency(extra, { currency: cur })}/mo</p>
            <p data-testid="cmp-interest-saved" data-numeric className="text-2xl font-extrabold tracking-tight">
              {formatCurrency(savings.interestSaved, { currency: cur })}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted">Pay off sooner</p>
            <p data-testid="cmp-months-sooner" data-numeric className="text-lg font-bold">{savings.monthsSooner} months</p>
          </div>
        </div>
      </div>
    </section>
  );
}
