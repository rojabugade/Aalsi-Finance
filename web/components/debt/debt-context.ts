import type { Loan } from "@/lib/api/loans";
import type { DebtPlan } from "@/lib/api/analyst";
import { loanContextPreamble } from "./loan-context";

export function loanCoachPreamble(loan: Loan, plan?: DebtPlan | null): string {
  const base = loanContextPreamble(loan);
  if (plan && plan.source === "ai") {
    return `${base}; Recommended strategy: ${plan.strategy}; suggested extra: ${plan.extra_monthly}`;
  }
  return base;
}

export function debtPlanPreamble(plan?: DebtPlan | null): string | undefined {
  if (!plan) return undefined;
  const order = (plan.ordered ?? [])
    .map((item) => `${item.order}. ${item.name} (${item.interest_rate ?? "unknown"}% APR, balance ${item.balance ?? "unknown"})`)
    .join("; ");
  const milestones = plan.milestones
    ? `first payoff ${plan.milestones.first_loan_paid_off_months ?? "unknown"} months; next payoff ${plan.milestones.next_loan_paid_off_months ?? "unknown"} months; ${plan.months_sooner} months sooner; interest saved ${plan.interest_saved}; cash left ${plan.milestones.monthly_cash_still_left}`
    : `${plan.months_sooner} months sooner; interest saved ${plan.interest_saved}`;
  const risks = plan.reasoning?.risk_notes?.join("; ");
  return [
    "Use this precomputed debt decision-engine plan as ground truth; do not invent payoff numbers",
    `strategy ${plan.strategy}`,
    plan.aggression_level ? `aggression ${plan.aggression_level}` : undefined,
    `extra monthly payoff ${plan.extra_monthly}`,
    `priority order ${order}`,
    `milestones ${milestones}`,
    plan.reasoning?.why_this_loan_first,
    plan.reasoning?.why_this_extra_amount,
    plan.reasoning?.investing_note,
    risks ? `risks ${risks}` : undefined,
    plan.final_recommendation,
  ].filter(Boolean).join(". ");
}
