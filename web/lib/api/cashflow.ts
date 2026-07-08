import { useQuery } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type CashflowSummary = components["schemas"]["CashflowSummary"];
export type CashflowLine = components["schemas"]["CashflowLine"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useCashflowSummary(months = 6) {
  return useQuery<CashflowSummary>({
    queryKey: ["cashflow", "summary", months],
    queryFn: () => unwrap(api.GET("/cashflow/summary", { params: { query: { months } } })),
  });
}
