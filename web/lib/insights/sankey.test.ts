import { describe, expect, it } from "vitest";
import { buildCashFlowSankey, type SankeyData } from "./sankey";

/** recharts' Sankey (d3-sankey) emits NaN path coordinates when a node is
 *  orphaned (no link references it) or a link has a non-positive/non-finite
 *  value. Assert the builder never produces such a degenerate graph. */
function assertValidGraph(d: SankeyData) {
  const referenced = new Set<number>();
  for (const l of d.links) {
    expect(Number.isFinite(l.value)).toBe(true);
    expect(l.value).toBeGreaterThan(0);
    expect(l.source).toBeGreaterThanOrEqual(0);
    expect(l.source).toBeLessThan(d.nodes.length);
    expect(l.target).toBeGreaterThanOrEqual(0);
    expect(l.target).toBeLessThan(d.nodes.length);
    referenced.add(l.source);
    referenced.add(l.target);
  }
  // every node participates in at least one link (no orphans)
  d.nodes.forEach((_, i) => expect(referenced.has(i)).toBe(true));
}

describe("buildCashFlowSankey", () => {
  it("produces no orphan nodes when savings is zero (income <= spend)", () => {
    assertValidGraph(buildCashFlowSankey(100, [{ dimensions: { category: "Food" }, total: 150 }]));
  });

  it("produces no zero-value links when there is no spend", () => {
    assertValidGraph(buildCashFlowSankey(500, []));
  });

  it("returns an empty graph for empty input", () => {
    const d = buildCashFlowSankey(0, []);
    expect(d.nodes).toHaveLength(0);
    expect(d.links).toHaveLength(0);
  });

  it("still builds a healthy graph with savings and categories", () => {
    const d = buildCashFlowSankey(1000, [
      { dimensions: { category: "Food" }, total: 300 },
      { dimensions: { category: "Rent" }, total: 200 },
    ]);
    assertValidGraph(d);
    expect(d.nodes.map((n) => n.name)).toContain("Savings");
    expect(d.nodes.map((n) => n.name)).toContain("Food");
  });
});
