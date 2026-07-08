import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type Transaction = components["schemas"]["TransactionOut"];
export type LineItem = components["schemas"]["LineItemOut"];
export type TransactionPatch = components["schemas"]["TransactionPatch"];
export type TransactionCreate = components["schemas"]["TransactionCreate"];
export type Category = components["schemas"]["CategoryOut"];
export type SplitPart = components["schemas"]["SplitPartIn"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

const KEY = ["transactions"] as const;

/** All household transactions (server returns them unfiltered; filtering is client-side). */
export function useTransactions() {
  return useQuery<Transaction[]>({
    queryKey: KEY,
    queryFn: () => unwrap(api.GET("/transactions", {})),
  });
}

export function useCategories() {
  return useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => unwrap(api.GET("/categories", {})),
    staleTime: 5 * 60_000,
  });
}

export function usePatchTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TransactionPatch }) =>
      unwrap(
        api.PATCH("/transactions/{transaction_id}", {
          params: { path: { transaction_id: id } },
          body: patch,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useConfirmTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST("/transactions/{transaction_id}/confirm", {
          params: { path: { transaction_id: id } },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/transactions/{transaction_id}", {
        params: { path: { transaction_id: id } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSplitTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parts }: { id: string; parts: SplitPart[] }) =>
      unwrap(
        api.POST("/transactions/{transaction_id}/split", {
          params: { path: { transaction_id: id } },
          body: { parts },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransactionCreate) => unwrap(api.POST("/transactions", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useMergeTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, notes }: { ids: string[]; notes?: string | null }) =>
      unwrap(
        api.POST("/transactions/merge", {
          body: { transaction_ids: ids, notes: notes ?? null },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
