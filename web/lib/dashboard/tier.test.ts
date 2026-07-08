import { describe, expect, it } from "vitest";
import { capacity, rowCapacity, resolveTier } from "./tier";

describe("capacity", () => {
  it("1×1 → 0", () => expect(capacity(1, 1)).toBe(0));
  it("2×1, 1×2 → 1", () => { expect(capacity(2, 1)).toBe(1); expect(capacity(1, 2)).toBe(1); });
  it("2×2 → 2", () => expect(capacity(2, 2)).toBe(2));
  it("4×2 → 3", () => expect(capacity(4, 2)).toBe(3));
  it("5×3 → 3", () => expect(capacity(5, 3)).toBe(3));
});

describe("rowCapacity", () => {
  it("5×2 cozy → 6 rows", () => expect(rowCapacity(5, 2)).toBe(6));
  it("5×3 cozy → 11 rows", () => expect(rowCapacity(5, 3)).toBe(11));
  it("grows monotonically with h", () => {
    expect(rowCapacity(5, 3)).toBeGreaterThan(rowCapacity(5, 2));
    expect(rowCapacity(5, 2)).toBeGreaterThan(rowCapacity(5, 1));
  });
  it("compact cellH=88 yields fewer rows than cozy", () =>
    expect(rowCapacity(5, 2, 88)).toBeLessThanOrEqual(rowCapacity(5, 2, 104)));
});

describe("resolveTier — compact / stat", () => {
  it("compact preset always → stat regardless of size", () => {
    const t = resolveTier({ preset: "compact", w: 5, h: 3 });
    expect(t.kind).toBe("stat");
    expect(t.form).toBeNull();
  });
  it("1×1 (cap=0) → stat", () => {
    const t = resolveTier({ preset: "standard", w: 1, h: 1 });
    expect(t.kind).toBe("stat");
  });
});

describe("resolveTier — the §1 bug fix", () => {
  it("standard + 5×3 + donut + [donut,bars,list] → chart/donut", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 3, form: "donut", supportedForms: ["donut", "bars", "list"] });
    expect(t.kind).toBe("chart");
    expect(t.form).toBe("donut");
  });
  it("standard + 5×2 + donut + [donut,bars,list] → chart/donut (not a list)", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2, form: "donut", supportedForms: ["donut", "bars", "list"] });
    expect(t.kind).toBe("chart");
    expect(t.form).toBe("donut");
  });
});

describe("resolveTier — form fallback", () => {
  it("donut at cap=1 (2×1) falls back to bars when bars is supported", () => {
    const t = resolveTier({ preset: "standard", w: 2, h: 1, form: "donut", supportedForms: ["donut", "bars", "list"] });
    expect(t.form).not.toBe("donut");
    expect(t.kind).toBe("chart");
    expect(t.form).toBe("bars");
  });
  it("donut at cap=1 falls back to list when only donut+list supported", () => {
    const t = resolveTier({ preset: "standard", w: 2, h: 1, form: "donut", supportedForms: ["donut", "list"] });
    expect(t.kind).toBe("list");
    expect(t.form).toBeNull();
  });
});

describe("resolveTier — default form (no explicit choice)", () => {
  it("picks richest supported form at cap≥2", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2, supportedForms: ["donut", "bars", "list"] });
    expect(t.form).toBe("donut");
  });
  it("picks bars over list at cap=1", () => {
    const t = resolveTier({ preset: "standard", w: 2, h: 1, supportedForms: ["donut", "bars", "list"] });
    expect(t.form).toBe("bars");
    expect(t.kind).toBe("chart");
  });
  it("falls to list when no supportedForms given", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2 });
    expect(t.kind).toBe("list");
    expect(t.form).toBeNull();
  });
});

describe("resolveTier — extras / preset tuning", () => {
  it("detailed preset → extras=true", () => {
    const t = resolveTier({ preset: "detailed", w: 5, h: 2, supportedForms: ["donut"] });
    expect(t.extras).toBe(true);
  });
  it("standard preset at a small (cap<3) cell → extras=false", () => {
    const t = resolveTier({ preset: "standard", w: 2, h: 2, supportedForms: ["donut"] });
    expect(t.extras).toBe(false);
  });
  it("standard preset at a large (cap=3) cell → extras=true (room for legend)", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2, supportedForms: ["donut"] });
    expect(t.extras).toBe(true);
  });
  it("analytical preset → extras=true", () => {
    const t = resolveTier({ preset: "analytical", w: 5, h: 3, supportedForms: ["donut"] });
    expect(t.extras).toBe(true);
  });
});

describe("resolveTier — rows", () => {
  it("rows capped by rowCapacity: 5×2, count=20 → 6", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2, count: 20, dataLength: 20 });
    expect(t.rows).toBe(6);
  });
  it("rows capped by count: 5×3, count=3 → 3", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 3, count: 3, dataLength: 20 });
    expect(t.rows).toBe(3);
  });
  it("rows capped by dataLength: 5×2, count=10, dataLength=2 → 2", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2, count: 10, dataLength: 2 });
    expect(t.rows).toBe(2);
  });
  it("rows is at least 1 in list/chart mode", () => {
    const t = resolveTier({ preset: "standard", w: 2, h: 1, count: 5, dataLength: 5 });
    expect(t.rows).toBeGreaterThanOrEqual(1);
  });
});
