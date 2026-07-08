import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type PaymentMethod = components["schemas"]["PaymentMethodOut"];
export type PaymentMethodIn = components["schemas"]["PaymentMethodIn"];
export type PaymentMethodPatch = components["schemas"]["PaymentMethodPatch"];
export type CreditCard = components["schemas"]["CreditCardOut"];
export type CreditCardDetailIn = components["schemas"]["CreditCardDetailIn"];
export type RecurringSeries = components["schemas"]["RecurringSeriesOut"];
export type RecurringSeriesIn = components["schemas"]["RecurringSeriesIn"];
export type RecurringSeriesPatch = components["schemas"]["RecurringSeriesPatch"];
export type Holding = components["schemas"]["HoldingOut"];
export type HoldingIn = components["schemas"]["HoldingIn"];
export type HoldingPatch = components["schemas"]["HoldingPatch"];
export type Valuation = components["schemas"]["ValuationOut"];
export type ValuationIn = components["schemas"]["ValuationIn"];

async function unwrap<T>(promise: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

const PAYMENT_METHODS = ["payment-methods"] as const;
const CREDIT_CARDS = ["credit-cards"] as const;
const RECURRING = ["recurring-series"] as const;
const HOLDINGS = ["holdings"] as const;

export function usePaymentMethods() {
  return useQuery<PaymentMethod[]>({
    queryKey: PAYMENT_METHODS,
    queryFn: () => unwrap(api.GET("/payment-methods", {})),
  });
}

export function useCreatePaymentMethod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PaymentMethodIn) => unwrap(api.POST("/payment-methods", { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: PAYMENT_METHODS }),
  });
}

export function usePatchPaymentMethod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PaymentMethodPatch }) =>
      unwrap(api.PATCH("/payment-methods/{method_id}", { params: { path: { method_id: id } }, body })),
    onSuccess: () => client.invalidateQueries({ queryKey: PAYMENT_METHODS }),
  });
}

export function useDeletePaymentMethod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/payment-methods/{method_id}", { params: { path: { method_id: id } } });
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: PAYMENT_METHODS }),
  });
}

export function useCreditCards() {
  return useQuery<CreditCard[]>({
    queryKey: CREDIT_CARDS,
    queryFn: () => unwrap(api.GET("/credit-cards", {})),
  });
}

export function usePutCreditCardDetail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ loanId, body }: { loanId: string; body: CreditCardDetailIn }) =>
      unwrap(api.PUT("/loans/{loan_id}/credit-card-detail", { params: { path: { loan_id: loanId } }, body })),
    onSuccess: () => client.invalidateQueries({ queryKey: CREDIT_CARDS }),
  });
}

export function useRecurringSeries(status?: string) {
  return useQuery<RecurringSeries[]>({
    queryKey: [...RECURRING, status ?? "all"],
    queryFn: () => unwrap(api.GET("/recurring-series", { params: { query: { status } } })),
  });
}

export function useCreateRecurringSeries() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: RecurringSeriesIn) => unwrap(api.POST("/recurring-series", { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: RECURRING }),
  });
}

export function usePatchRecurringSeries() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RecurringSeriesPatch }) =>
      unwrap(api.PATCH("/recurring-series/{series_id}", { params: { path: { series_id: id } }, body })),
    onSuccess: () => client.invalidateQueries({ queryKey: RECURRING }),
  });
}

export function useDeleteRecurringSeries() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/recurring-series/{series_id}", { params: { path: { series_id: id } } });
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: RECURRING }),
  });
}

export function useHoldings() {
  return useQuery<Holding[]>({
    queryKey: HOLDINGS,
    queryFn: () => unwrap(api.GET("/holdings", {})),
  });
}

export function useCreateHolding() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: HoldingIn) => unwrap(api.POST("/holdings", { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: HOLDINGS }),
  });
}

export function usePatchHolding() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: HoldingPatch }) =>
      unwrap(api.PATCH("/holdings/{holding_id}", { params: { path: { holding_id: id } }, body })),
    onSuccess: () => client.invalidateQueries({ queryKey: HOLDINGS }),
  });
}

export function useDeleteHolding() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/holdings/{holding_id}", { params: { path: { holding_id: id } } });
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: HOLDINGS }),
  });
}

export function useHoldingValuations(holdingId: string | null) {
  return useQuery<Valuation[]>({
    queryKey: [...HOLDINGS, holdingId, "valuations"],
    enabled: Boolean(holdingId),
    queryFn: () =>
      unwrap(api.GET("/holdings/{holding_id}/valuations", { params: { path: { holding_id: holdingId as string } } })),
  });
}

export function useCreateHoldingValuation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ holdingId, body }: { holdingId: string; body: ValuationIn }) =>
      unwrap(api.POST("/holdings/{holding_id}/valuations", { params: { path: { holding_id: holdingId } }, body })),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: HOLDINGS });
      client.invalidateQueries({ queryKey: [...HOLDINGS, variables.holdingId, "valuations"] });
    },
  });
}
