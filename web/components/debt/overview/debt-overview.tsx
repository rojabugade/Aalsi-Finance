"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useDebtPlan, type DebtAggressionLevel } from "@/lib/api/analyst";
import type { Loan } from "@/lib/api/loans";
import { Skeleton } from "@/components/ui/skeleton";
import { num, type LoanLike } from "../debt-math";
import { OverviewRing } from "./overview-ring";
import { SmartPrioritization } from "./smart-prioritization";
import { PayoffProjection } from "./payoff-projection";
import { ScenarioSimulator } from "./scenario-simulator";
import { ScenarioDialog } from "./scenario-dialog";
import { DebtList } from "./debt-list";
import { NextBestStep } from "./next-best-step";
import { AiCoach } from "@/components/debt/analyst/ai-coach";
import { debtPlanPreamble } from "@/components/debt/debt-context";
import { PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export function DebtOverview({ loans: allLoans, addLoanAction }: { loans: Loan[]; addLoanAction?: ReactNode }) {
  const loans = allLoans.filter((l) => l.type !== "credit_card");
  const [aggressionLevel, setAggressionLevel] = useState<DebtAggressionLevel>("balanced");
  const plan = useDebtPlan(aggressionLevel);
  const [simExtra, setSimExtra] = useState(0);
  const [fullOpen, setFullOpen] = useState(false);
  const [fullSeed, setFullSeed] = useState(0);
  const [stepDismissed, setStepDismissed] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);

  const currency = loans[0]?.currency ?? "USD";
  const onTrack = loans.every((l) => !l.penalty_warning);
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()).toISOString().slice(0, 10);
  const range = { from, to };
  const strategy = (plan.data?.strategy === "snowball" ? "snowball" : "avalanche") as "snowball" | "avalanche";
  const coachPreamble = useMemo(() => debtPlanPreamble(plan.data), [plan.data]);

  const loanLikes = useMemo<LoanLike[]>(
    () =>
      loans.map((l) => ({
        id: l.id, name: l.name,
        outstanding_balance: l.outstanding_balance, principal: l.principal,
        interest_rate: l.interest_rate, min_or_emi_amount: l.min_or_emi_amount, currency: l.currency,
      })),
    [loans],
  );

  if (loans.length === 0) {
    return (
      <div className="rounded-card-sm border border-border bg-card py-16 text-center shadow-card">
        <p className="text-base font-semibold">No debts yet</p>
        <p className="mt-1 text-sm text-muted">Add a loan to see your payoff plan, projection, and savings.</p>
        {addLoanAction && <div className="mt-4">{addLoanAction}</div>}
      </div>
    );
  }

  const planExtra = num(plan.data?.extra_monthly);
  const affordableExtra = num(plan.data?.affordable_extra);
  // Single source of truth: the backend now runs the same rollover engine as the
  // chart (debt-math simulateStrategy), so the card and the projection footer
  // read the same months-sooner figure instead of recomputing it here.
  const planMonthsSooner = num(plan.data?.months_sooner);
  const openFull = (seed: number) => {
    setFullSeed(seed);
    setFullOpen(true);
  };

  return (
    <div className={cn("grid items-stretch gap-4", coachOpen && "xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]")}>
      <div className="grid min-w-0 gap-4">
        {!coachOpen && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setCoachOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold shadow-card hover:border-accent/50"
            >
              <PanelRightOpen className="size-4 text-accent" /> Open AI Coach
            </button>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <OverviewRing loans={loanLikes} currency={currency} onTrack={onTrack} />
        {plan.isLoading || !plan.data ? (
          <Skeleton className="h-48" />
        ) : (
          <SmartPrioritization
            plan={plan.data}
            currency={currency}
            aggressionLevel={aggressionLevel}
            onAggressionChange={setAggressionLevel}
            onApply={openFull}
          />
        )}
        </div>
        <DebtList loans={loans} action={addLoanAction} />
        <div className="grid gap-4 md:grid-cols-[1.1fr_.9fr]">
          <PayoffProjection
            loans={loanLikes}
            extraMonthly={planExtra}
            scenarioExtra={simExtra}
            strategy={strategy}
            monthsSooner={planMonthsSooner}
            currency={currency}
            source={plan.data?.source}
          />
          <ScenarioSimulator
            loans={loanLikes}
            strategy={strategy}
            currency={currency}
            extra={simExtra}
            onExtraChange={setSimExtra}
            onViewFull={() => openFull(simExtra || planExtra)}
          />
        </div>
        {plan.data && !stepDismissed && (
          <NextBestStep plan={plan.data} onDismiss={() => setStepDismissed(true)} />
        )}
      </div>
      {coachOpen && (
        <aside className="min-h-[720px] xl:min-h-0">
          <div className="h-full min-h-[720px] xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)]">
            <AiCoach threadId="debt" range={range} plan={plan.data} preamble={coachPreamble} onSeeImpact={() => openFull(planExtra)} onCollapse={() => setCoachOpen(false)} />
          </div>
        </aside>
      )}
      <ScenarioDialog
        open={fullOpen}
        onOpenChange={setFullOpen}
        loans={loanLikes}
        currency={currency}
        initialExtra={fullSeed}
        initialStrategy={strategy}
        affordableExtra={affordableExtra}
      />
    </div>
  );
}
