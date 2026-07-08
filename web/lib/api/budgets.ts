import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type Budget = components["schemas"]["BudgetOut"];
export type BudgetIn = components["schemas"]["BudgetIn"];
export type BudgetPatch = components["schemas"]["BudgetPatch"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

const KEY = ["budgets"] as const;

export function useBudgets() {
  return useQuery<Budget[]>({
    queryKey: KEY,
    queryFn: () => unwrap(api.GET("/budgets", {})),
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BudgetIn) => unwrap(api.POST("/budgets", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: BudgetPatch & { id: string }) =>
      unwrap(api.PATCH("/budgets/{budget_id}", { params: { path: { budget_id: id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/budgets/{budget_id}", { params: { path: { budget_id: id } } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
