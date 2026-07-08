import { describe, it, expect, beforeEach, vi } from "vitest";
import { BOARD_VERSION } from "./boards";
import { loadBoard, saveBoard, STORAGE_PREFIX } from "./layout-store";

// minimal localStorage shim for the node test env
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});

describe("layout-store", () => {
  it("returns the default board when nothing is saved", () => {
    const b = loadBoard("dashboard");
    expect(b.items.length).toBeGreaterThan(0);
    expect(b.prefs.density).toBe("cozy");
    expect(b.prefs.range).toBe("3m");
  });
  it("seeds tailored range overrides and lets other widgets follow the global range", () => {
    const b = loadBoard("dashboard");
    const netWorth = b.items.find((i) => i.type === "netWorth");
    const breakdown = b.items.find((i) => i.type === "breakdown");
    expect(netWorth?.config?.range).toBe("6m"); // explicit override
    expect(breakdown?.config?.range).toBeUndefined(); // follows global
  });
  it("fills a missing prefs.range from defaults on load (non-destructive)", () => {
    localStorage.setItem(
      STORAGE_PREFIX + "dashboard",
      JSON.stringify({ version: BOARD_VERSION, items: [{ id: "n-1", type: "netWorth", x: 0, y: 0, w: 5, h: 2 }], prefs: { density: "cozy", radius: 20, glass: 0 } }),
    );
    const loaded = loadBoard("dashboard");
    expect(loaded.prefs.range).toBe("3m");
    expect(loaded.items).toHaveLength(1); // items preserved, not reset
  });
  it("round-trips a saved board", () => {
    const b = loadBoard("dashboard");
    b.prefs.radius = 12;
    saveBoard("dashboard", b);
    expect(localStorage.getItem(STORAGE_PREFIX + "dashboard")).toContain('"radius":12');
    expect(loadBoard("dashboard").prefs.radius).toBe(12);
  });
  it("round-trips widget config", () => {
    const b = loadBoard("dashboard");
    b.items[0].config = { range: "3m", show: { chart: false }, accent: "#123456" };
    saveBoard("dashboard", b);
    expect(loadBoard("dashboard").items[0].config).toEqual({ range: "3m", show: { chart: false }, accent: "#123456" });
  });
  it("falls back to default on a version mismatch", () => {
    localStorage.setItem(STORAGE_PREFIX + "dashboard", JSON.stringify({ version: 0, items: [], prefs: {} }));
    expect(loadBoard("dashboard").items.length).toBeGreaterThan(0);
  });
  it("migrates 4-column v2 layouts to the 10-column grid", () => {
    localStorage.setItem(STORAGE_PREFIX + "dashboard", JSON.stringify({
      version: 2,
      items: [{ id: "breakdown-1", type: "breakdown", x: 2, y: 1, w: 2, h: 1, config: { title: "Merchants" } }],
      prefs: { density: "compact", radius: 16, glass: 10 },
    }));

    const migrated = loadBoard("dashboard");
    expect(migrated.version).toBe(BOARD_VERSION);
    expect(migrated.items[0]).toMatchObject({ x: 5, y: 1, w: 5, h: 1, config: { title: "Merchants" } });
    expect(migrated.prefs).toMatchObject({ density: "compact", radius: 16, glass: 10, range: "3m" });
    expect(JSON.parse(localStorage.getItem(STORAGE_PREFIX + "dashboard") ?? "{}").version).toBe(BOARD_VERSION);
  });
});

describe("slice-E prefs migration", () => {
  it("fills new personalization prefs with defaults without wiping a v4 board", () => {
    const legacy = { version: BOARD_VERSION, items: [{ id: "a", type: "netWorth", x: 0, y: 0, w: 5, h: 2 }],
      prefs: { density: "compact", radius: 20, glass: 0, range: "3m" } };
    localStorage.setItem(STORAGE_PREFIX + "dashboard", JSON.stringify(legacy));
    const loaded = loadBoard("dashboard");
    expect(loaded.items).toHaveLength(1);            // not wiped
    expect(loaded.prefs.privacy).toBe("off");
    expect(loaded.prefs.accent).toBeNull();
    expect(loaded.prefs.shadow).toBe(0);
    // densityMode derived from saved grid density: compact -> power
    expect(loaded.prefs.densityMode).toBe("power");
  });

  it("derives densityMode from grid density (spacious->calm, cozy->balanced)", () => {
    for (const [density, mode] of [["spacious", "calm"], ["cozy", "balanced"]] as const) {
      localStorage.setItem(STORAGE_PREFIX + "dashboard", JSON.stringify({
        version: BOARD_VERSION, items: [], prefs: { density, radius: 20, glass: 0, range: "3m" } }));
      expect(loadBoard("dashboard").prefs.densityMode).toBe(mode);
    }
  });
});
