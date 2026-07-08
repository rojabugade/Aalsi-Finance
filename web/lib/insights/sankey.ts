type BreakdownRow = { dimensions?: Record<string, string | null>; total?: unknown };

export type SankeyData = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

/**
 * Income → (single "Spending" hub) → top category buckets, plus Income → Savings.
 * `income` and `categoryRows` come from the analytics endpoints. Returns recharts
 * Sankey-shaped node/link arrays. Categories beyond `topN` fold into "Other".
 */
export function buildCashFlowSankey(
  income: number,
  categoryRows: BreakdownRow[],
  topN = 6,
): SankeyData {
  const cats = categoryRows
    .map((r) => ({ name: r.dimensions?.category ?? "Uncategorized", total: Number(r.total ?? 0) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  const head = cats.slice(0, topN);
  const otherTotal = cats.slice(topN).reduce((a, c) => a + c.total, 0);
  const buckets = otherTotal > 0 ? [...head, { name: "Other", total: otherTotal }] : head;

  const spend = buckets.reduce((a, c) => a + c.total, 0);
  const savings = Math.max(0, income - spend);

  // Build only the nodes that actually participate in a link. recharts' Sankey
  // (d3-sankey) emits NaN path coordinates for orphan nodes or non-positive
  // link values, so a node is created lazily the first time it is linked and
  // links with a non-finite/zero value are dropped entirely.
  const nodes: { name: string }[] = [];
  const index = new Map<string, number>();
  const nodeId = (name: string): number => {
    let i = index.get(name);
    if (i === undefined) {
      i = nodes.length;
      index.set(name, i);
      nodes.push({ name });
    }
    return i;
  };

  const links: { source: number; target: number; value: number }[] = [];
  const addLink = (from: string, to: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    links.push({ source: nodeId(from), target: nodeId(to), value });
  };

  addLink("Income", "Spending", spend);
  addLink("Income", "Savings", savings);
  for (const b of buckets) addLink("Spending", b.name, b.total);

  return { nodes, links };
}
