import { describe, expect, it } from "vitest";
import { debtVM, debtContract } from "./debt-widget";
import type { Loan } from "@/lib/api/loans";

function loan(over: Partial<Loan>): Loan {
  return { id: "1", name: "Car", type: "auto", principal: "10000", interest_rate: "5",
    min_or_emi_amount: "300", next_due_date: "2099-02-01", currency: "USD", ...over } as Loan;
}

describe("debtVM", () => {
  it("sums outstanding balances and monthly payments, excludes credit cards by default", () => {
    const vm = debtVM([loan({ id: "a", outstanding_balance: "7500" }), loan({ id: "b", type: "credit_card", principal: "5000" })], false);
    expect(vm.totalDebt).toBe(7500);
    expect(vm.loans).toHaveLength(1);
  });
  it("includes credit-card debt when includeCC is true", () => {
    const vm = debtVM([loan({ id: "a" }), loan({ id: "b", type: "credit_card", principal: "5000" })], true);
    expect(vm.totalDebt).toBe(15000);
    expect(vm.loans).toHaveLength(2);
  });
});

describe("debtContract.deriveInsights", () => {
  it("emits the highest APR", () => {
    const vm = debtVM([loan({ interest_rate: "5" }), loan({ id: "c", interest_rate: "19" })], false);
    const chips = debtContract.deriveInsights!(vm, {});
    expect(chips.some((c) => /19/.test(c.label))).toBe(true);
  });
});
