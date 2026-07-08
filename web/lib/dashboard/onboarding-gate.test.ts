import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldOnboard, markOnboarded, ONBOARD_PREFIX } from "./onboarding-gate";
import { STORAGE_PREFIX } from "./layout-store";

// minimal localStorage shim for the node test env (matches layout-store.test.ts)
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});

describe("onboarding gate", () => {
  it("opens when no flag and no saved board", () => {
    expect(shouldOnboard("dashboard")).toBe(true);
  });

  it("does not open once marked onboarded", () => {
    markOnboarded("dashboard");
    expect(localStorage.getItem(ONBOARD_PREFIX + "dashboard")).toBe("1");
    expect(shouldOnboard("dashboard")).toBe(false);
  });

  it("treats an existing saved board as already onboarded and sets the flag", () => {
    localStorage.setItem(STORAGE_PREFIX + "dashboard", JSON.stringify({ version: 4, items: [], prefs: {} }));
    expect(shouldOnboard("dashboard")).toBe(false);
    expect(localStorage.getItem(ONBOARD_PREFIX + "dashboard")).toBe("1");
  });
});
