import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type Loan = components["schemas"]["LoanOut"];
export type LoanIn = components["schemas"]["LoanIn"];
export type LoanPatch = components["schemas"]["LoanPatch"];
export type ScheduleRow = components["schemas"]["PaymentScheduleOut"];
export type PayoffCalc = components["schemas"]["PayoffCalcOut"];
export type PayoffCalcIn = components["schemas"]["PayoffCalcIn"];
export type PayoffStrategy = components["schemas"]["PayoffStrategyOut"];
export type PayoffStrategyIn = components["schemas"]["PayoffStrategyIn"];
export type LoanPayment = components["schemas"]["LoanPaymentOut"];
export type LoanPaymentIn = components["schemas"]["LoanPaymentIn"];
export type LoanPaymentList = components["schemas"]["LoanPaymentListOut"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

const KEY = ["loans"] as const;

export function useLoans() {
  return useQuery<Loan[]>({
    queryKey: KEY,
    queryFn: () => unwrap(api.GET("/loans", {})),
  });
}

export function useCreateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoanIn) => unwrap(api.POST("/loans", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/loans/{loan_id}", {
        params: { path: { loan_id: id } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Amortization schedule for one loan. Enabled only when a loan id is provided. */
export function useLoanSchedule(loanId: string | null) {
  return useQuery<ScheduleRow[]>({
    queryKey: ["loans", "schedule", loanId],
    enabled: Boolean(loanId),
    queryFn: () =>
      unwrap(
        api.GET("/loans/{loan_id}/schedule", {
          params: { path: { loan_id: loanId as string } },
        }),
      ),
  });
}

export function usePayoffCalc() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PayoffCalcIn }) =>
      unwrap(
        api.POST("/loans/{loan_id}/payoff-calc", {
          params: { path: { loan_id: id } },
          body,
        }),
      ),
  });
}

export function usePayoffStrategy() {
  return useMutation({
    mutationFn: (body: PayoffStrategyIn) =>
      unwrap(api.POST("/loans/payoff-strategy", { body })),
  });
}

export function usePatchLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LoanPatch }) =>
      unwrap(api.PATCH("/loans/{loan_id}", { params: { path: { loan_id: id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useLoanPayments(
  loanId: string | null,
  opts: { limit: number; offset: number },
) {
  return useQuery<LoanPaymentList>({
    queryKey: ["loans", "payments", loanId, opts.limit, opts.offset],
    enabled: Boolean(loanId),
    queryFn: () =>
      unwrap(
        api.GET("/loans/{loan_id}/payments", {
          params: {
            path: { loan_id: loanId as string },
            query: { limit: opts.limit, offset: opts.offset },
          },
        }),
      ),
  });
}

function invalidateLoan(qc: ReturnType<typeof useQueryClient>, loanId: string) {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ["loans", "schedule", loanId] });
  qc.invalidateQueries({ queryKey: ["loans", "payments", loanId] });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LoanPaymentIn }) =>
      unwrap(
        api.POST("/loans/{loan_id}/payments", { params: { path: { loan_id: id } }, body }),
      ),
    onSuccess: (_d, vars) => invalidateLoan(qc, vars.id),
  });
}

export function useDeletePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, paymentId }: { id: string; paymentId: string }) => {
      const { error } = await api.DELETE("/loans/{loan_id}/payments/{payment_id}", {
        params: { path: { loan_id: id, payment_id: paymentId } },
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => invalidateLoan(qc, vars.id),
  });
}
