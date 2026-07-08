import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import type { DateRange } from "@/lib/dates";
import { api } from "./client";

export type Monitor = components["schemas"]["MonitorOut"];
export type PersistentAlert = components["schemas"]["PersistentAlert"];
export type AnalystAction = components["schemas"]["AnalystAction"];
export type AskIn = Omit<components["schemas"]["AnalystAskIn"], "page_context"> & {
  focus_kind?: "merchant" | "category";
  focus_label?: string;
  focus_id?: string;
  page?: string;
  thread_id?: string;
  page_context?: {
    route?: string | null;
    entity?: string | null;
    visible_range?: string | null;
    filters?: Record<string, unknown> | null;
  };
};
export type AskOut = Omit<components["schemas"]["AnalystAskOut"], "citations"> & {
  citations?: { source_type: string; source_id: string }[];
};
export type ThreadMessage = { role: "user" | "analyst"; text: string };
export type DebtAggressionLevel = "comfortable" | "balanced" | "aggressive" | "asap";
export type DebtPlan = Omit<components["schemas"]["DebtPlanOut"], "ordered"> & {
  aggression_level?: DebtAggressionLevel | null;
  recommendation_name?: string | null;
  ordered?: Array<components["schemas"]["DebtPlanOrderItem"] & {
    interest_rate?: string | number | null;
    balance?: string | number | null;
    priority_reason?: string | null;
  }>;
  milestones?: {
    first_loan_paid_off_months?: number | null;
    next_loan_paid_off_months?: number | null;
    payoff_accelerated_months?: number | null;
    estimated_interest_saved?: string | number | null;
    monthly_cash_still_left?: string | number | null;
    confidence_level?: "Low" | "Medium" | "High" | null;
  } | null;
  phases?: Array<{
    phase: string;
    action: string;
    extra_payment_target: string;
    expected_result: string;
    roll_payments: string;
  }>;
  reasoning?: {
    why_this_loan_first: string;
    why_this_extra_amount: string;
    tradeoff: string;
    investing_note: string;
    risk_notes: string[];
  } | null;
  alternatives?: Array<{
    aggression_level: DebtAggressionLevel;
    label: string;
    extra_payoff_amount: string | number;
    estimated_payoff_improvement_months: number;
    interest_saved: string | number;
    best_for: string;
  }>;
  final_recommendation?: string | null;
};

async function unwrap<T>(request: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await request;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useMonitor(range: DateRange) {
  return useQuery<Monitor>({
    queryKey: ["analyst", "monitor", range],
    queryFn: () => unwrap(api.GET("/analyst/monitor", {
      params: { query: { from: range.from, to: range.to } },
    })),
  });
}

export function useAnalystAsk() {
  return useMutation({
    mutationFn: (body: AskIn) => unwrap(api.POST("/analyst/ask", {
      body: body as components["schemas"]["AnalystAskIn"],
    })) as Promise<AskOut>,
  });
}

export function useThreadHistory(key: string) {
  return useQuery<{ messages: ThreadMessage[] }>({
    queryKey: ["analyst", "thread", key],
    queryFn: async () => {
      const data = await unwrap(api.GET("/analyst/thread/{key}/messages", {
        params: { path: { key } },
      }));
      return { messages: data.messages ?? [] };
    },
    staleTime: Infinity,
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/analyst/alerts/{alert_id}/acknowledge", { params: { path: { alert_id: id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analyst", "monitor"] }),
  });
}

export const DEBT_PLAN_KEY = ["analyst", "debt-plan"] as const;

export function useDebtPlan(aggressionLevel?: DebtAggressionLevel) {
  return useQuery<DebtPlan>({
    queryKey: [...DEBT_PLAN_KEY, aggressionLevel ?? "legacy-ai"],
    queryFn: () =>
      unwrap(api.POST("/analyst/debt-plan", {
        body: aggressionLevel ? { aggression_level: aggressionLevel } : undefined,
      } as Parameters<typeof api.POST>[1])),
    staleTime: 60_000,
  });
}

// Manual recalc: bypass the server-side cache (force=true) and write the fresh
// plan straight into the query cache so every consumer updates at once.
export function useRecalcDebtPlan(aggressionLevel?: DebtAggressionLevel) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.POST("/analyst/debt-plan", {
        params: { query: { force: true } },
        body: aggressionLevel ? { aggression_level: aggressionLevel } : undefined,
      } as Parameters<typeof api.POST>[1])),
    onSuccess: (plan) => qc.setQueryData([...DEBT_PLAN_KEY, aggressionLevel ?? "legacy-ai"], plan),
  });
}

export type MemoryStatus = components["schemas"]["MemoryStatusOut"];

export function useMemoryStatus() {
  return useQuery<MemoryStatus>({
    queryKey: ["analyst", "memory", "status"],
    queryFn: () => unwrap(api.GET("/analyst/memory/status", {})),
  });
}

export function useReindexMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/analyst/reindex", {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analyst", "memory", "status"] }),
  });
}
