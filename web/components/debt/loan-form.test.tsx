import { describe, expect, it } from "vitest";
import { loanToFormDefaults } from "./loan-form";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "1",
  name: "Car",
  type: "auto",
  schedule_kind: "amortizing",
  principal: "10000",
  currency: "USD",
  interest_rate: "5",
  min_or_emi_amount: "300",
  due_day: 15,
  start_date: "2026-01-01",
} as Loan;

describe("loanToFormDefaults", () => {
  it("maps a loan to string defaults for editing", () => {
    const d = loanToFormDefaults(loan);
    expect(d.name).toBe("Car");
    expect(d.principal).toBe("10000");
    expect(d.interest_rate).toBe("5");
    expect(d.due_day).toBe("15");
    expect(d.start_date).toBe("2026-01-01");
  });

  it("returns empty/sensible defaults when no loan given", () => {
    const d = loanToFormDefaults();
    expect(d.name).toBe("");
    expect(d.type).toBe("other");
    expect(d.currency).toBe("USD");
  });
});
