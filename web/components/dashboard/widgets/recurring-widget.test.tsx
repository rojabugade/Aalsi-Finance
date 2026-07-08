import { describe, expect, it } from "vitest";
import { monthlyFromCadence, recurringVM, recurringContract } from "./recurring-widget";
import type { RecurringSeries } from "@/lib/api/widget-data";

function series(over: Partial<RecurringSeries>): RecurringSeries {
  return { id: "1", name: "Netflix", amount: "15", currency: "USD", cadence: "monthly",
    type: "subscription", status: "active", next_due_date: "2099-01-05", ...over } as RecurringSeries;
}

describe("monthlyFromCadence", () => {
  it("normalizes annual to monthly", () => { expect(monthlyFromCadence(120, "annual")).toBeCloseTo(10); });
  it("normalizes weekly to monthly", () => { expect(monthlyFromCadence(10, "weekly")).toBeCloseTo(43.3); });
  it("excludes irregular from monthly total", () => { expect(monthlyFromCadence(50, "irregular")).toBe(0); });
});

describe("recurringVM", () => {
  it("sums monthly cost and sorts by next due", () => {
    const vm = recurringVM([
      series({ id: "a", amount: "15", cadence: "monthly", next_due_date: "2099-02-01" }),
      series({ id: "b", amount: "120", cadence: "annual", next_due_date: "2099-01-01" }),
    ]);
    expect(vm.totalMonthly).toBeCloseTo(25);
    expect(vm.items[0].name).toBe("Netflix");
    expect(vm.nextUp?.nextDue).toBe("2099-01-01");
  });
});

describe("recurringContract.deriveInsights", () => {
  it("emits a monthly-cost chip", () => {
    const vm = recurringVM([series({ amount: "20", cadence: "monthly" })]);
    const chips = recurringContract.deriveInsights!(vm, {});
    expect(chips.some((c) => /\/mo/.test(c.label))).toBe(true);
  });
});
