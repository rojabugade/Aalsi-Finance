import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type AskIn = components["schemas"]["GuidanceAskIn"];
export type AskOut = components["schemas"]["GuidanceAskOut"];
export type WizardIn = components["schemas"]["GuidanceWizardIn"];
export type WizardOut = components["schemas"]["GuidanceWizardOut"];
export type Transfer = components["schemas"]["CrossBorderTransferOut"];
export type TransferIn = components["schemas"]["CrossBorderTransferIn"];
export type Limits = components["schemas"]["LimitsOut"];
export type Citation = components["schemas"]["Citation"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

/** Ask guidance. `crossBorder` routes to the cross-border-specialised endpoint. */
export function useAsk() {
  return useMutation({
    mutationFn: ({ crossBorder, body }: { crossBorder: boolean; body: AskIn }) =>
      unwrap(api.POST(crossBorder ? "/cross-border/ask" : "/guidance/ask", { body })),
  });
}

export function useWizard() {
  return useMutation({
    mutationFn: ({ crossBorder, body }: { crossBorder: boolean; body: WizardIn }) =>
      unwrap(api.POST(crossBorder ? "/cross-border/wizard" : "/guidance/wizard", { body })),
  });
}

export function useTransfers() {
  return useQuery<Transfer[]>({
    queryKey: ["cross-border", "transfers"],
    queryFn: () => unwrap(api.GET("/cross-border/transfers", {})),
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransferIn) => unwrap(api.POST("/cross-border/transfers", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cross-border", "transfers"] }),
  });
}

export function useLimits() {
  return useQuery<Limits>({
    queryKey: ["cross-border", "limits"],
    queryFn: () => unwrap(api.GET("/cross-border/limits", {})),
  });
}
