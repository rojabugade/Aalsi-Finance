import { describe, expect, it } from "vitest";
import { holdingsVM, holdingsContract } from "./holdings-widget";
import type { Holding } from "@/lib/api/widget-data";

function holding(over: Partial<Holding>): Holding {
  return { id: "1", name: "Apple", symbol: "AAPL", asset_type: "stock", quantity: "10",
    avg_buy_price: "100", currency: "USD",
    latest_valuation: { price: "150", value: "1500" } as Holding["latest_valuation"], ...over } as Holding;
}

describe("holdingsVM", () => {
  it("computes value, cost, and gain", () => {
    const vm = holdingsVM([holding({})]);
    expect(vm.totalValue).toBe(1500);
    expect(vm.totalGain).toBe(500);
    expect(vm.totalGainPct).toBeCloseTo(0.5);
  });
  it("falls back to cost basis when unpriced and flags partial", () => {
    const vm = holdingsVM([holding({ latest_valuation: null })]);
    expect(vm.totalValue).toBe(1000);
    expect(vm.anyUnpriced).toBe(true);
  });
});

describe("holdingsContract.deriveInsights", () => {
  it("emits a total-gain chip with positive tone on a gain", () => {
    const vm = holdingsVM([holding({})]);
    const chips = holdingsContract.deriveInsights!(vm, {});
    expect(chips.some((c) => c.tone === "positive")).toBe(true);
  });
});
