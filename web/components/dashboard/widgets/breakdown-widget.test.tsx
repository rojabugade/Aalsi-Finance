import { describe, expect, it } from "vitest";
import { breakdownContract, breakdownViews, breakdownFocus, type BreakdownVM } from "./breakdown-widget";
import type { Tier } from "@/lib/dashboard/tier";
import type { Insight } from "@/lib/dashboard/widget-contract";

const mockVM: BreakdownVM = {
  top: { label: "Amazon", value: 320 },
  topPct: 78,
  rows: [
    { label: "Amazon", value: 320 },
    { label: "Uber", value: 90 },
    { label: "Starbucks", value: 40 },
  ],
  total: 450,
  dimension: "merchant",
  showAmounts: true,
};

const listTier: Tier = { kind: "list", form: null, rows: 3, extras: false, chartPx: 0 };
const donutTier: Tier = { kind: "chart", form: "donut", rows: 8, extras: true, chartPx: 180 };
const barsTier: Tier = { kind: "chart", form: "bars", rows: 5, extras: false, chartPx: 140 };

describe("breakdownContract.deriveInsights", () => {
  it("names the top entry in a chip", () => {
    const chips = breakdownContract.deriveInsights!(mockVM, {}) as Insight[];
    expect(chips.some((c) => /Amazon/.test(c.label))).toBe(true);
  });
  it("warning tone when top ≥40%", () => {
    const chips = breakdownContract.deriveInsights!(mockVM, {}) as Insight[];
    expect(chips.some((c) => c.tone === "warning")).toBe(true);
  });
  it("neutral tone when top <40%", () => {
    const vm: BreakdownVM = { ...mockVM, topPct: 30, top: { label: "Uber", value: 90 } };
    const chips = breakdownContract.deriveInsights!(vm, {}) as Insight[];
    expect(chips.some((c) => c.tone === "neutral")).toBe(true);
  });
  it("returns [] when no top entry", () => {
    const vm: BreakdownVM = { ...mockVM, top: undefined, rows: [] };
    expect(breakdownContract.deriveInsights!(vm, {})).toHaveLength(0);
  });
});

describe("breakdownViews.stat", () => {
  it("returns a stat block with merchant label", () => {
    const [block] = breakdownViews.stat(mockVM);
    expect(block.kind).toBe("stat");
    if (block.kind === "stat") {
      expect(block.label).toMatch(/merchant/i);
      expect(block.value).toBe("Amazon");
      expect(block.hint).toContain("78%");
    }
  });
  it("uses category label when dimension=category", () => {
    const [block] = breakdownViews.stat({ ...mockVM, dimension: "category" });
    if (block.kind === "stat") expect(block.label).toMatch(/category/i);
  });
  it("falls back to em-dash when no top", () => {
    const [block] = breakdownViews.stat({ ...mockVM, top: undefined });
    if (block.kind === "stat") expect(block.value).toBe("—");
  });
});

describe("breakdownViews.list", () => {
  it("returns a list block sliced to tier.rows", () => {
    const [block] = breakdownViews.list(mockVM, listTier);
    expect(block.kind).toBe("list");
    if (block.kind === "list") {
      expect(block.rows).toHaveLength(3);
      expect(block.rows[0].label).toBe("Amazon");
    }
  });
  it("row blocks carry a bar sub-key with pct > 0", () => {
    const [block] = breakdownViews.list(mockVM, { ...listTier, rows: 1 });
    if (block.kind === "list") {
      expect(block.rows[0].bar).toBeDefined();
      expect(block.rows[0].bar!.pct).toBeGreaterThan(0);
    }
  });
  it("formats value as percentage when showAmounts=false", () => {
    const vm: BreakdownVM = { ...mockVM, showAmounts: false };
    const [block] = breakdownViews.list(vm, { ...listTier, rows: 1 });
    if (block.kind === "list") expect(block.rows[0].value).toMatch(/%/);
  });
});

describe("breakdownViews.chart", () => {
  it("returns bars block when tier.form=bars", () => {
    const [block] = breakdownViews.chart(mockVM, barsTier);
    expect(block.kind).toBe("bars");
    if (block.kind === "bars") expect(block.rows[0].label).toBe("Amazon");
  });
  it("returns donut block when tier.form=donut", () => {
    const [block] = breakdownViews.chart(mockVM, donutTier);
    expect(block.kind).toBe("donut");
    if (block.kind === "donut") {
      expect(block.slices.some((s) => s.label === "Amazon")).toBe(true);
      expect(block.legend).toBe(true);
    }
  });
  it("donut legend=false when extras=false", () => {
    const [block] = breakdownViews.chart(mockVM, { ...donutTier, extras: false });
    if (block.kind === "donut") expect(block.legend).toBe(false);
  });
  it("adds Other slice when rows do not sum to total", () => {
    const [block] = breakdownViews.chart({ ...mockVM, rows: [mockVM.rows[0]], total: 500 }, donutTier);
    if (block.kind === "donut") expect(block.slices.some((s) => s.label === "Other")).toBe(true);
  });
});

describe("breakdownFocus", () => {
  it("returns donut block with legend=true", () => {
    const [block] = breakdownFocus(mockVM);
    expect(block.kind).toBe("donut");
    if (block.kind === "donut") expect(block.legend).toBe(true);
  });
  it("limits to 8 slices max (plus possible Other)", () => {
    const manyRows = Array.from({ length: 12 }, (_, i) => ({ label: `Row ${i}`, value: 10 }));
    const vm: BreakdownVM = { ...mockVM, rows: manyRows, total: 120 };
    const [block] = breakdownFocus(vm);
    if (block.kind === "donut") expect(block.slices.length).toBeLessThanOrEqual(9);
  });
});
