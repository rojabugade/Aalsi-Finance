import { describe, expect, it } from "vitest";
import { creditCardVM, creditCardContract } from "./credit-card-widget";
import type { CreditCard } from "@/lib/api/widget-data";

function card(over: Partial<CreditCard> & { id?: string }): CreditCard {
  return {
    loan: { id: over.id ?? "1", name: "Visa", principal: "300", outstanding_balance: "300", next_due_date: "2099-01-10" } as CreditCard["loan"],
    credit_limit: "1000", statement_balance: "300", available_credit: "700",
    statement_day: 1, utilization: "30", detail_complete: true,
    ...over,
  } as CreditCard;
}

describe("creditCardVM", () => {
  it("aggregates balance, limit, and utilization", () => {
    const vm = creditCardVM([card({ id: "a" }), card({ id: "b", loan: { id: "b", name: "Visa", principal: "200", outstanding_balance: "200", next_due_date: "2099-01-10" } as CreditCard["loan"], statement_balance: "1700", credit_limit: "1000" })]);
    expect(vm.totalBalance).toBe(500);
    expect(vm.totalLimit).toBe(2000);
    expect(vm.aggUtil).toBeCloseTo(0.25);
  });
  it("keeps separate card rows and normalizes percent utilization", () => {
    const vm = creditCardVM([
      card({ id: "a", credit_limit: null, utilization: "85.44" }),
      card({ id: "b", credit_limit: null, utilization: "85.44" }),
    ]);
    expect(vm.cards).toHaveLength(2);
    expect(vm.cards[0].utilization).toBeCloseTo(0.8544);
  });
  it("flags incomplete cards", () => {
    const vm = creditCardVM([card({ detail_complete: false })]);
    expect(vm.anyIncomplete).toBe(true);
  });
});

describe("creditCardContract.deriveInsights", () => {
  it("warns when aggregate utilization is high", () => {
    const vm = creditCardVM([card({ statement_balance: "600", credit_limit: "1000", utilization: "0.6" })]);
    const chips = creditCardContract.deriveInsights!(vm, {});
    expect(chips.some((c) => /Utilization/.test(c.label) && (c.tone === "warning" || c.tone === "danger"))).toBe(true);
  });
});
