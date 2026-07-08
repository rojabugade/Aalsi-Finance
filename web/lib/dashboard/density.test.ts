import { describe, expect, it } from "vitest";
import { effectiveDensity, maxLevelForSize, chipCap, PRESET_LEVEL } from "./density";

describe("maxLevelForSize", () => {
  it("smallest 1x1 caps at level 0", () => expect(maxLevelForSize(1, 1)).toBe(0));
  it("one-dimension growth allows level 1", () => {
    expect(maxLevelForSize(2, 1)).toBe(1);
    expect(maxLevelForSize(1, 2)).toBe(1);
  });
  it("2x2 allows level 2", () => expect(maxLevelForSize(2, 2)).toBe(2));
  it("wide+tall allows level 3", () => expect(maxLevelForSize(5, 2)).toBe(3));
});

describe("effectiveDensity", () => {
  it("clamps analytical preset down to what the size allows", () =>
    expect(effectiveDensity("analytical", 1, 1)).toBe(0));
  it("respects a compact preset on a large widget (no forced detail)", () =>
    expect(effectiveDensity("compact", 5, 3)).toBe(0));
  it("defaults missing preset to standard (level 1)", () =>
    expect(effectiveDensity(undefined, 5, 3)).toBe(1));
  it("returns the lower of intent and capacity", () =>
    expect(effectiveDensity("detailed", 2, 2)).toBe(2));
});

describe("chipCap", () => {
  it("ladders 1,2,3,3 by level", () => {
    expect(chipCap(0)).toBe(1);
    expect(chipCap(1)).toBe(2);
    expect(chipCap(2)).toBe(3);
    expect(chipCap(3)).toBe(3);
  });
});

describe("PRESET_LEVEL", () => {
  it("maps the four presets to 0..3", () =>
    expect(PRESET_LEVEL).toEqual({ compact: 0, standard: 1, detailed: 2, analytical: 3 }));
});
