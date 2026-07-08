import { describe, expect, it } from "vitest";
import { loanCoachPreamble } from "./debt-context";
import type { Loan } from "@/lib/api/loans";
import type { DebtPlan } from "@/lib/api/analyst";

const loan = {
  name: "Card", type: "credit_card", principal: 10000, outstanding_balance: 8000,
  currency: "USD", interest_rate: 18, min_or_emi_amount: 300, next_due_date: "2024-06-01",
} as unknown as Loan;

describe("loanCoachPreamble", () => {
  it("includes loan facts", () => {
    const text = loanCoachPreamble(loan);
    expect(text).toMatch(/Card/);
    expect(text).toMatch(/8000/);
  });
  it("adds the AI strategy when an AI plan is supplied", () => {
    const plan = { source: "ai", strategy: "avalanche", extra_monthly: "200" } as unknown as DebtPlan;
    const text = loanCoachPreamble(loan, plan);
    expect(text).toMatch(/avalanche/);
    expect(text).toMatch(/200/);
  });
  it("omits strategy for a deterministic plan", () => {
    const plan = { source: "deterministic", strategy: "snowball", extra_monthly: "100" } as unknown as DebtPlan;
    expect(loanCoachPreamble(loan, plan)).not.toMatch(/snowball/);
  });
});
