import { describe, expect, it } from "vitest";
import { resolveConfig, WIDGETS } from "./registry";

describe("resolveConfig", () => {
  it("follows the global range when the item has no explicit range", () => {
    const config = resolveConfig({ type: "breakdown", config: { dimension: "category" } }, "6m");
    expect(config.range).toBe("6m");
  });

  it("lets an explicit item range override the global range", () => {
    const config = resolveConfig({ type: "netWorth", config: { range: "1y" } }, "6m");
    expect(config.range).toBe("1y");
  });

  it("leaves range undefined when neither the item nor a global range supplies one", () => {
    const config = resolveConfig({ type: "breakdown", config: { dimension: "category" } });
    expect(config.range).toBeUndefined();
  });

  it("merges defaults with partial overrides", () => {
    expect(
      resolveConfig({ type: "breakdown", config: { dimension: "category", show: { amounts: false } } }, "3m"),
    ).toMatchObject({
      range: "3m",
      dimension: "category",
      chart: "donut",
      count: 8,
      show: { legend: true, amounts: false },
    });
  });

  it("clamps count and restores invalid chart values", () => {
    const config = resolveConfig({ type: "breakdown", config: { count: 99, chart: "area" } });
    expect(config.count).toBe(12);
    expect(config.chart).toBe("donut");
  });

  it("defaults preset to standard when unset", () => {
    const config = resolveConfig({ type: "netWorth", config: {} }, "6m");
    expect(config.preset).toBe("standard");
  });

  it("keeps a valid explicit preset", () => {
    const config = resolveConfig({ type: "netWorth", config: { preset: "analytical" } });
    expect(config.preset).toBe("analytical");
  });

  it("restores an invalid preset to standard", () => {
    const config = resolveConfig({ type: "netWorth", config: { preset: "bogus" as never } });
    expect(config.preset).toBe("standard");
  });

  it("marks the slice-E minimal-mode essentials", () => {
    const essential = Object.entries(WIDGETS).filter(([, d]) => d.essential).map(([k]) => k).sort();
    expect(essential).toEqual(["aiAlert", "cashflow", "netWorth", "recentActivity", "recurring"]);
  });
});
