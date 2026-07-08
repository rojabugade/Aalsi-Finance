import { describe, expect, it } from "vitest";
import { provenanceLabel } from "./documents";

describe("provenanceLabel", () => {
  it("summarizes a produced transaction", () => {
    expect(
      provenanceLabel([{ id: "t1", merchant: "Trader Joe's", amount: "42.10", currency: "USD", status: "draft" }]),
    ).toBe("→ $42.10 at Trader Joe's");
  });
  it("returns a dash when nothing was produced", () => {
    expect(provenanceLabel([])).toBe("—");
  });
});
