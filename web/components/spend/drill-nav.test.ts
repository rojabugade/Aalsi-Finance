import { describe, expect, it } from "vitest";
import { frameKey, frameTitle, type DrillFrame } from "./drill-nav";

const cats = [{ id: "c1", name: "Travel" }] as any;
const txns = [{ id: "t1", merchant: "United Airlines" }] as any;

describe("frameKey", () => {
  it("is stable per frame identity", () => {
    expect(frameKey({ kind: "category", id: "c1" })).toBe("category:c1");
    expect(frameKey({ kind: "bucket", from: "2026-06-01", to: "2026-06-07", label: "x" }))
      .toBe("bucket:2026-06-01:2026-06-07");
  });
});

describe("frameTitle", () => {
  it("resolves names from data, with safe fallbacks", () => {
    expect(frameTitle({ kind: "category", id: "c1" } as DrillFrame, cats, txns)).toBe("Travel");
    expect(frameTitle({ kind: "merchant", name: "Costco" } as DrillFrame, cats, txns)).toBe("Costco");
    expect(frameTitle({ kind: "transaction", id: "t1" } as DrillFrame, cats, txns)).toBe("United Airlines");
    expect(frameTitle({ kind: "category", id: "gone" } as DrillFrame, cats, txns)).toBe("Category");
  });
});
