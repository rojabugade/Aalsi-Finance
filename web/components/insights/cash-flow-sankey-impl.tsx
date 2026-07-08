"use client";

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import type { SankeyData } from "@/lib/insights/sankey";

export function CashFlowSankeyImpl({ data }: { data: SankeyData }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <Sankey
        data={data}
        nodePadding={24}
        link={{ stroke: "color-mix(in srgb, var(--accent) 32%, transparent)" }}
        node={{ fill: "var(--accent)" }}
        margin={{ top: 8, bottom: 8, left: 0, right: 80 }}
      >
        <Tooltip />
      </Sankey>
    </ResponsiveContainer>
  );
}
