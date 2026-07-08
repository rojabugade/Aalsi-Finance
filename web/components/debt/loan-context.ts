import type { Loan } from "@/lib/api/loans";

/** Compose a short, model-readable summary of a loan's key facts. Pure. */
export function loanContextPreamble(loan: Loan): string {
  const parts: (string | null)[] = [
    `Loan: ${loan.name} (${loan.type})`,
    `Outstanding balance: ${loan.outstanding_balance ?? loan.principal} ${loan.currency}`,
    `Original principal: ${loan.principal} ${loan.currency}`,
    loan.interest_rate != null ? `Interest rate: ${loan.interest_rate}% APR` : null,
    loan.min_or_emi_amount != null
      ? `Monthly payment: ${loan.min_or_emi_amount} ${loan.currency}`
      : null,
    loan.next_due_date ? `Next due: ${loan.next_due_date}` : null,
  ];
  return parts.filter((p): p is string => Boolean(p)).join("; ");
}
