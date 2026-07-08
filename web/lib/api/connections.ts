import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type PlaidLinkToken = components["schemas"]["PlaidLinkTokenOut"];
export type EmailOAuthStart = components["schemas"]["EmailOAuthStartOut"];
export type EmailSync = components["schemas"]["EmailSyncOut"];
export type SmsToken = components["schemas"]["SmsTokenOut"];
export type SplitwiseOAuthStart = components["schemas"]["SplitwiseOAuthStartOut"];
export type SplitwiseSync = components["schemas"]["SplitwiseSyncOut"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) {
    const detail = error && typeof error === "object" && "detail" in error
      ? (error as { detail?: unknown }).detail
      : undefined;
    throw new Error(typeof detail === "string" ? detail : "Request failed");
  }
  return data;
}

export function usePlaidLinkToken() {
  return useMutation({
    mutationFn: (body: { plaid_item_id?: string | null } = {}) =>
      unwrap(api.POST("/plaid/link-token", { body })),
  });
}

export type PlaidExchange = components["schemas"]["PlaidExchangeIn"];
export type PlaidExchangeOut = components["schemas"]["PlaidExchangeOut"];
export type PlaidSyncOut = components["schemas"]["PlaidSyncOut"];

export function useExchangePlaidToken() {
  return useMutation({
    mutationFn: (body: PlaidExchange) => unwrap(api.POST("/plaid/exchange", { body })),
  });
}

export function useSyncPlaid() {
  return useMutation({
    mutationFn: (body: { plaid_item_id?: string | null } = {}) =>
      unwrap(api.POST("/plaid/sync", { body })),
  });
}

export type PlaidItem = components["schemas"]["PlaidItemOut"];

export function usePlaidItems() {
  return useQuery<PlaidItem[]>({
    queryKey: ["plaid-items"],
    queryFn: () => unwrap(api.GET("/plaid/items", {})),
  });
}

export function useDisconnectPlaidItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await api.DELETE("/plaid/items/{item_id}", { params: { path: { item_id: itemId } } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plaid-items"] }),
  });
}

export function useEmailOAuthStart() {
  return useMutation({ mutationFn: () => unwrap(api.POST("/email/oauth/start", {})) });
}

export function useEmailSync() {
  return useMutation({ mutationFn: () => unwrap(api.POST("/email/sync", {})) });
}

export function useDisconnectEmail() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/email/connection", {});
      if (error) throw error;
    },
  });
}

export function useRotateSmsToken() {
  return useMutation({ mutationFn: () => unwrap(api.POST("/sms/token/rotate", {})) });
}

export function useDisconnectSms() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/sms/connection", {});
      if (error) throw error;
    },
  });
}

export function useSplitwiseOAuthStart() {
  return useMutation({
    mutationFn: () => unwrap(api.POST("/splitwise/oauth/start", {})),
  });
}

export function useSplitwiseSync() {
  return useMutation({
    mutationFn: () => unwrap(api.POST("/splitwise/sync", {})),
  });
}

export function useDisconnectSplitwise() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/splitwise/connection", {});
      if (error) throw error;
    },
  });
}

export type SplitwiseBalances = components["schemas"]["SplitwiseBalancesOut"];
export type SplitwiseBalanceRow = { friend?: string; amount: string; currency?: string };

export function useSplitwiseBalances() {
  return useQuery<SplitwiseBalances>({
    queryKey: ["splitwise-balances"],
    queryFn: () => unwrap(api.GET("/splitwise/balances", {})),
  });
}

export function netBalance(balances: SplitwiseBalanceRow[]): number {
  return balances.reduce((sum, b) => sum + Number(b.amount), 0);
}
