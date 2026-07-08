import { describe, expect, it } from "vitest";
import { ADD_NAV, BOTTOM_TABS, routeSwitch, surfaceTabs, surfaceTitle } from "./nav";

describe("ADD_NAV", () => {
  it("points the universal Add entry at /capture", () => {
    expect(ADD_NAV.href).toBe("/capture");
    expect(ADD_NAV.label).toBe("Add");
  });
  it("keeps the capture surface titled", () => {
    expect(surfaceTitle("/capture")).toBe("Capture");
  });
});

describe("nav cards tab", () => {
  it("exposes a Cards tab in the Insights cluster", () => {
    const tabs = surfaceTabs("/cards");
    expect(tabs.some((t) => t.href === "/cards" && t.label === "Cards")).toBe(true);
  });

  it("lights the Insights bottom tab on /cards", () => {
    const insights = BOTTOM_TABS.find((t) => t.key === "insights")!;
    expect(insights.match).toContain("/cards");
  });
});

describe("classic spend tabs", () => {
  it("keeps the classic spend navbar available", () => {
    expect(surfaceTabs("/transactions/classic")).toEqual([
      { label: "Categories", href: "/transactions/classic" },
      { label: "Transactions", href: "/transactions/classic?view=all" },
    ]);
  });
});

describe("version switch", () => {
  it("labels the dashboard version currently being viewed", () => {
    expect(routeSwitch("/dashboard")).toEqual({ label: "New", href: "/dashboard/classic" });
    expect(routeSwitch("/dashboard/classic")).toEqual({ label: "Classic", href: "/dashboard" });
  });
});
