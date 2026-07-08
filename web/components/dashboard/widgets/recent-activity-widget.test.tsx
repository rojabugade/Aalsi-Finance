import { describe, expect, it } from "vitest";
import { recentActivityContract } from "./recent-activity-widget";

describe("recentActivityContract.deriveInsights", () => {
  it("reports the transaction count", () => {
    const txns = [{ id: "1", title: "A", amount: -5, date: "Jun 1", category: "Food", currency: "USD" }, { id: "2", title: "B", amount: -8, date: "Jun 2", category: "Gas", currency: "USD" }];
    expect(recentActivityContract.deriveInsights!({ txns }, {}).some((chip) => /2/.test(chip.label))).toBe(true);
  });
});
