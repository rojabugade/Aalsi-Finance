import { describe, expect, it } from "vitest";
import { loanContextPreamble } from "./loan-context";
import type { Loan } from "@/lib/api/loans";

const base = {
  id: "1",
  name: "Car Loan",
  type: "auto",
  currency: "USD",
  principal: "10000",
  outstanding_balance: "9100",
  interest_rate: "5",
  min_or_emi_amount: "300",
  next_due_date: "2026-02-01",
} as Loan;

describe("loanContextPreamble", () => {
  it("includes the key loan facts", () => {
    const s = loanContextPreamble(base);
    expect(s).toContain("Car Loan");
    expect(s).toContain("9100");
    expect(s).toContain("10000");
    expect(s).toContain("5% APR");
    expect(s).toContain("2026-02-01");
  });

  it("omits fields that are null/undefined", () => {
    const s = loanContextPreamble({
      ...base,
      interest_rate: null,
      min_or_emi_amount: null,
      next_due_date: null,
    } as Loan);
    expect(s).not.toContain("APR");
    expect(s).not.toContain("Monthly payment");
    expect(s).not.toContain("Next due");
  });

  it("falls back to principal when outstanding is missing", () => {
    const s = loanContextPreamble({ ...base, outstanding_balance: null } as Loan);
    expect(s).toContain("Outstanding balance: 10000");
  });
});
