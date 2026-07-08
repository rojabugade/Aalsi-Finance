import { describe, it, expect } from "vitest";
import { THEME_PRESETS, PALETTES, presetSupportsMode, isThemeId, THEME_BG } from "./themes";

describe("theme presets", () => {
  it("includes the 5 named presets plus the 3 originals", () => {
    const ids = THEME_PRESETS.map((p) => p.palette);
    for (const p of ["dollar","glass","editorial","neon","softmin","emerald","indigo","ink","midnight"]) expect(ids).toContain(p);
  });
  it("registers Neon Nights (midnight) as a dark-only theme", () => {
    expect(PALETTES).toContain("midnight");
    const t = THEME_PRESETS.find((x) => x.palette === "midnight");
    expect(t).toBeDefined();
    expect(t!.name).toBe("Neon Nights");
    expect(t!.id).toBe("midnight-dark");
    expect(t!.modes).toEqual(["dark"]);
  });
  it("locks mode for single-mode presets", () => {
    expect(presetSupportsMode("glass", "light")).toBe(false); // Liquid Glass = dark only
    expect(presetSupportsMode("glass", "dark")).toBe(true);
    expect(presetSupportsMode("softmin", "light")).toBe(true);
    expect(presetSupportsMode("softmin", "dark")).toBe(true);
  });
  it("every authored preset id is a valid theme id with a bg color", () => {
    for (const p of THEME_PRESETS) for (const m of p.modes) {
      const id = `${p.palette}-${m}`;
      expect(isThemeId(id)).toBe(true);
      expect(THEME_BG[id as keyof typeof THEME_BG]).toMatch(/^#/);
    }
  });
});
