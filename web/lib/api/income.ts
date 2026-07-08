import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type IncomeSource = components["schemas"]["IncomeSourceOut"];
export type IncomeSourceIn = components["schemas"]["IncomeSourceIn"];
export type TakeHome = components["schemas"]["TakeHomeOut"];
export type EquityGrant = components["schemas"]["EquityGrantOut"];
export type EquityGrantIn = components["schemas"]["EquityGrantIn"];
export type EquityEvent = components["schemas"]["EquityEventOut"];
export type EquityEventIn = components["schemas"]["EquityEventIn"];
export type EquitySummary = components["schemas"]["EquitySummaryOut"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useIncomeSources() {
  return useQuery<IncomeSource[]>({
    queryKey: ["income-sources"],
    queryFn: () => unwrap(api.GET("/income-sources", {})),
  });
}

export function useCreateIncomeSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IncomeSourceIn) => unwrap(api.POST("/income-sources", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["income-sources"] }),
  });
}

/** Take-home estimate for one source. Enabled only when a source id is set. */
export function useTakeHome(sourceId: string | null) {
  return useQuery<TakeHome>({
    queryKey: ["income", "take-home", sourceId],
    enabled: Boolean(sourceId),
    queryFn: () =>
      unwrap(
        api.GET("/income/take-home", {
          params: { query: { source_id: sourceId as string } },
        }),
      ),
  });
}

export function useEquitySummary() {
  return useQuery<EquitySummary>({
    queryKey: ["equity", "summary"],
    queryFn: () => unwrap(api.GET("/equity/summary", {})),
  });
}

export function useEquityGrants() {
  return useQuery<EquityGrant[]>({
    queryKey: ["equity", "grants"],
    queryFn: () => unwrap(api.GET("/equity/grants", {})),
  });
}

export function useCreateEquityGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EquityGrantIn) => unwrap(api.POST("/equity/grants", { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equity", "grants"] });
      qc.invalidateQueries({ queryKey: ["equity", "summary"] });
    },
  });
}

export function useEquityEvents() {
  return useQuery<EquityEvent[]>({
    queryKey: ["equity", "events"],
    queryFn: () => unwrap(api.GET("/equity/events", {})),
  });
}

export function useCreateEquityEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EquityEventIn) => unwrap(api.POST("/equity/events", { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equity", "events"] });
      qc.invalidateQueries({ queryKey: ["equity", "summary"] });
    },
  });
}
