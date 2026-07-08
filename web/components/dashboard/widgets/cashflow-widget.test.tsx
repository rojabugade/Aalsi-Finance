import { describe, expect, it } from "vitest";
import { cashflowContract } from "./cashflow-widget";

const data = {
  lines: [
    { label: "Income", amount: 100, kind: "income" },
    { label: "Everyday spend", amount: -80, kind: "discretionary" },
  ],
  income: 100,
  spend: 80,
  net: 20,
  currency: "USD",
};

describe("cashflowContract.deriveInsights", () => {
  it("emits a positive net chip when net is positive", () => {
    expect(cashflowContract.deriveInsights!(data, {}).some((chip) => chip.tone === "positive")).toBe(true);
  });

  it("emits a warning chip when net is negative", () => {
    expect(cashflowContract.deriveInsights!({ ...data, net: -50 }, {}).some((chip) => chip.tone === "warning")).toBe(true);
  });
});
