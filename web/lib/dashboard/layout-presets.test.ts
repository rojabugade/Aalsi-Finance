import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadLayouts, saveLayout, switchLayout, deleteLayout } from "./layout-presets";

const items = [{ id: "a", type: "netWorth", x: 0, y: 0, w: 5, h: 2 }];

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});

describe("layout-presets", () => {
  it("saves, lists, switches and deletes named layouts", () => {
    saveLayout("dashboard", "Daily", items as any);
    expect(loadLayouts("dashboard").layouts.map((l) => l.name)).toEqual(["Daily"]);
    expect(switchLayout("dashboard", "Daily")).toHaveLength(1);
    expect(loadLayouts("dashboard").active).toBe("Daily");
    expect(switchLayout("dashboard", "Nope")).toBeNull();
    deleteLayout("dashboard", "Daily");
    expect(loadLayouts("dashboard").layouts).toHaveLength(0);
  });
  it("overwrites a layout saved under an existing name", () => {
    saveLayout("dashboard", "X", items as any);
    saveLayout("dashboard", "X", [...items, { id: "b", type: "debt", x: 5, y: 0, w: 5, h: 2 }] as any);
    expect(loadLayouts("dashboard").layouts).toHaveLength(1);
    expect(switchLayout("dashboard", "X")).toHaveLength(2);
  });
});
