import type { Granularity } from "@/lib/spend/period";

/** Human label for the chart's bucket granularity. */
export function granularityLabel(g: Granularity): string {
  return g === "day" ? "daily" : g === "week" ? "weekly" : "monthly";
}
