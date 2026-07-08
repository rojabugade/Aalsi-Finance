import { describe, expect, it } from "vitest";
import { useCashflowSummary } from "./cashflow";

describe("useCashflowSummary", () => {
  it("is a callable hook factory", () => {
    expect(typeof useCashflowSummary).toBe("function");
  });
});
