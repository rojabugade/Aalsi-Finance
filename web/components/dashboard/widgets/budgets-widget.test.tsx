import { describe, expect, it } from "vitest";
import { budgetsContract } from "./budgets-widget";

describe("budgetsContract.deriveInsights", () => {
  it("flags an over-budget category as danger", () => {
    const rows = [{ id: "1", name: "Dining", limit: 200, spent: 220, pct: 110, over: true, currency: "USD" }, { id: "2", name: "Gas", limit: 100, spent: 40, pct: 40, over: false, currency: "USD" }];
    const chips = budgetsContract.deriveInsights!({ rows, onTrack: 1, currency: "USD" }, {});
    expect(chips.some((chip) => chip.tone === "danger" && /Dining/.test(chip.label))).toBe(true);
  });
});
