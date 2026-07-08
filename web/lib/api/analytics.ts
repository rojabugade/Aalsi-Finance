import { useQuery } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";
import type { DateRange } from "@/lib/dates";

export type AnalyticsSummary = components["schemas"]["AnalyticsSummaryOut"];
export type AnalyticsTimeseries = components["schemas"]["TimeSeriesOut"];
export type Breakdown = components["schemas"]["BreakdownOut"];
export type NetWorth = components["schemas"]["NetWorthOut"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

/** Monthly cash-flow points (spend/income/net) over the range. */
export function useTimeseries(range: DateRange) {
  return useQuery<AnalyticsTimeseries>({
    queryKey: ["analytics", "timeseries", range],
    queryFn: () =>
      unwrap(
        api.GET("/analytics/timeseries", {
          // metric "all" returns spend+income+net (named metrics are stripped server-side)
          params: { query: { from: range.from, to: range.to, metric: "all", interval: "monthly" } },
        }),
      ),
  });
}

/** Signed total for the range (negative total = net positive cash flow). */
export function useSummary(range: DateRange) {
  return useQuery<AnalyticsSummary>({
    queryKey: ["analytics", "summary", range],
    queryFn: () =>
      unwrap(
        api.GET("/analytics/summary", {
          params: { query: { from: range.from, to: range.to } },
        }),
      ),
  });
}

/** Net worth: latest balance per account (assets minus liabilities) + monthly trend.
 *  Defaults to a trailing 6-month window server-side. */
export function useNetWorth(range?: DateRange) {
  return useQuery<NetWorth>({
    queryKey: ["analytics", "net-worth", range],
    queryFn: () =>
      unwrap(
        api.GET("/analytics/net-worth", {
          params: range ? { query: { from: range.from, to: range.to } } : undefined,
        }),
      ),
  });
}

export function useBreakdown(range: DateRange, dimension: string, filter?: string) {
  return useQuery<Breakdown>({
    queryKey: ["analytics", "breakdown", dimension, filter ?? "", range],
    queryFn: () =>
      unwrap(
        api.GET("/analytics/breakdown", {
          params: {
            query: { from: range.from, to: range.to, dimension, filter: filter || null },
          },
        }),
      ),
  });
}

/** Faceting dimensions the backend's breakdown endpoint accepts. */
export const DIMENSIONS = [
  { value: "category", label: "Category" },
  { value: "merchant", label: "Merchant" },
  { value: "subcategory", label: "Subcategory" },
  { value: "item_type", label: "Item type" },
  { value: "tag", label: "Tag" },
] as const;
