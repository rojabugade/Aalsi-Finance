import { describe, expect, it } from "vitest";
import { netBalance } from "./connections";

describe("netBalance", () => {
  it("sums signed friend balances", () => {
    expect(netBalance([{ friend: "A", amount: "10.00", currency: "USD" }, { friend: "B", amount: "-4.00", currency: "USD" }])).toBe(6);
  });
  it("handles empty", () => {
    expect(netBalance([])).toBe(0);
  });
});
