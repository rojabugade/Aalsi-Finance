"use client";

import { useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Loan } from "@/lib/api/loans";
import { useDebtPlan } from "@/lib/api/analyst";
import { AiCoach } from "@/components/debt/analyst/ai-coach";
import { loanCoachPreamble } from "@/components/debt/debt-context";
import { num, type LoanLike } from "@/components/debt/debt-math";
import { ScenarioSimulator } from "@/components/debt/overview/scenario-simulator";
import { ScenarioDialog } from "@/components/debt/overview/scenario-dialog";
import { PayoffProjection } from "@/components/debt/overview/payoff-projection";
import { LoanHero, DueStatus } from "./loan-hero";
import { LoanInfoCard } from "./loan-info-card";
import { EditLoanSheet } from "./edit-loan-sheet";
import { PaymentHistory, UpcomingSchedule } from "./sections";
import { PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoanDetailPage({ loan }: { loan: Loan }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [simExtra, setSimExtra] = useState(0);
  const [fullOpen, setFullOpen] = useState(false);
  const [fullSeed, setFullSeed] = useState(0);
  const [coachOpen, setCoachOpen] = useState(false);
  const plan = useDebtPlan();
  const historyRef = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()).toISOString().slice(0, 10);
  const range = { from, to };
  const strategy = (plan.data?.strategy === "snowball" ? "snowball" : "avalanche") as "snowball" | "avalanche";
  const planExtra = num(plan.data?.extra_monthly);
  const affordableExtra = num(plan.data?.affordable_extra);
  const planMonthsSooner = num(plan.data?.months_sooner);
  const loanLike: LoanLike = {
    id: loan.id,
    name: loan.name,
    outstanding_balance: loan.outstanding_balance,
    principal: loan.principal,
    interest_rate: loan.interest_rate,
    min_or_emi_amount: loan.min_or_emi_amount,
    currency: loan.currency,
  };

  const scrollTo = (ref: RefObject<HTMLDivElement | null>) =>
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const openFull = (seed: number) => {
    setFullSeed(seed);
    setFullOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <nav className="text-sm">
          <Link href="/debt" className="font-semibold text-accent">‹ Debt</Link>
          <span className="text-muted"> / </span>
          <span className="font-semibold capitalize">{loan.name}</span>
        </nav>
        {!coachOpen && (
          <button
            type="button"
            onClick={() => setCoachOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold shadow-card hover:border-accent/50"
          >
            <PanelRightOpen className="size-4 text-accent" /> Open AI Coach
          </button>
        )}
      </div>

      <div className={cn("grid gap-4", coachOpen && "lg:grid-cols-[1fr_340px]")}>
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <LoanHero
              loan={loan}
              onPay={() => scrollTo(historyRef)}
              onViewStatements={() => scrollTo(historyRef)}
            />
            <DueStatus loan={loan} onViewSchedule={() => scrollTo(scheduleRef)} />
          </div>

          <LoanInfoCard loan={loan} onEdit={() => setEditing(true)} />

          <PayoffProjection
            loans={[loanLike]}
            extraMonthly={planExtra}
            scenarioExtra={simExtra}
            strategy={strategy}
            monthsSooner={planMonthsSooner}
            currency={loan.currency}
            source={plan.data?.source}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <ScenarioSimulator
              loans={[loanLike]}
              strategy={strategy}
              currency={loan.currency}
              extra={simExtra}
              onExtraChange={setSimExtra}
              onViewFull={() => openFull(simExtra || planExtra)}
            />
            <div ref={historyRef} className="rounded-card-sm border border-border bg-card p-5 shadow-card">
              <PaymentHistory loan={loan} />
            </div>
          </div>

          <div ref={scheduleRef} className="rounded-card-sm border border-border bg-card p-5 shadow-card">
            <UpcomingSchedule loan={loan} />
          </div>
        </div>

        {coachOpen && (
          <aside className="min-h-[720px] lg:min-h-0">
            <div className="h-full min-h-[720px] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
              <AiCoach
                threadId={`loan:${loan.id}`}
                range={range}
                plan={plan.data}
                preamble={loanCoachPreamble(loan, plan.data)}
                onSeeImpact={() => openFull(planExtra)}
                onCollapse={() => setCoachOpen(false)}
              />
            </div>
          </aside>
        )}
      </div>

      <EditLoanSheet
        loan={loan}
        open={editing}
        onOpenChange={setEditing}
        onDeleted={() => router.push("/debt")}
      />

      <ScenarioDialog
        open={fullOpen}
        onOpenChange={setFullOpen}
        loans={[loanLike]}
        currency={loan.currency}
        initialExtra={fullSeed}
        initialStrategy={strategy}
        affordableExtra={affordableExtra}
      />
    </div>
  );
}
