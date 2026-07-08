import { describe, it, expect } from "vitest";
import { DENSITY_MODES, baselineFor, effectiveDensityFor } from "./density-modes";

describe("density-modes", () => {
  it("maps each mode to a baseline preset + grid density", () => {
    expect(DENSITY_MODES.calm.baselinePreset).toBe("compact");
    expect(DENSITY_MODES.power.baselinePreset).toBe("analytical");
    expect(DENSITY_MODES.minimal.essentialOnly).toBe(true);
    expect(DENSITY_MODES.balanced.gridDensity).toBe("cozy");
  });
  it("uses the mode baseline when the widget has no preset override", () => {
    // power baseline = analytical (level 3), large widget can show it
    expect(effectiveDensityFor(undefined, "power", 5, 2)).toBe(3);
    // per-widget preset overrides the baseline
    expect(effectiveDensityFor("compact", "power", 5, 2)).toBe(0);
    // size still caps: analytical baseline on a 1x1 → 0
    expect(effectiveDensityFor(undefined, "power", 1, 1)).toBe(0);
  });
  // baselineFor is the public accessor the render path uses
  it("exposes the baseline preset per mode", () => {
    expect(baselineFor("calm")).toBe("compact");
  });
});
