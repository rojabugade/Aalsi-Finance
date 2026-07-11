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
export type GuidanceThread = components["schemas"]["GuidanceThreadOut"];
export type GuidanceChecklistItem = components["schemas"]["GuidanceChecklistItem"];
export type GuidancePlanItem = components["schemas"]["GuidancePlanItemOut"];
export type GuidancePlanItemCreate = components["schemas"]["GuidancePlanItemCreate"];
export type GuidancePlanItemUpdate = components["schemas"]["GuidancePlanItemUpdate"];
export type GuidanceDomain = NonNullable<AskIn["domain"]>;
export type GuidancePlanStatus = GuidancePlanItem["status"];
type LegacyWizardIn = Omit<WizardIn, "create_reminders"> & {
  create_reminders?: boolean;
};

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useGuidanceAsk() {
  return useMutation({
    mutationFn: (body: AskIn) => unwrap(api.POST("/guidance/ask", { body })),
  });
}

export function useGuidanceThread(key: string | null | undefined) {
  return useQuery<GuidanceThread>({
    queryKey: ["guidance", "thread", key],
    queryFn: () =>
      unwrap(
        api.GET("/guidance/thread/{key}/messages", {
          params: { path: { key: key ?? "" } },
        }),
      ),
    enabled: Boolean(key),
  });
}

export function usePlanItems(status?: GuidancePlanStatus) {
  return useQuery<GuidancePlanItem[]>({
    queryKey: ["guidance", "plan-items", status ?? "all"],
    queryFn: () =>
      unwrap(
        api.GET("/guidance/plan-items", {
          params: { query: { status } },
        }),
      ),
  });
}

export function useCreatePlanItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GuidancePlanItemCreate) =>
      unwrap(api.POST("/guidance/plan-items", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["guidance", "plan-items"] }),
  });
}

export function useUpdatePlanItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: GuidancePlanItemUpdate }) =>
      unwrap(
        api.PATCH("/guidance/plan-items/{item_id}", {
          params: { path: { item_id: id } },
          body,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["guidance", "plan-items"] }),
  });
}

export function useWizard() {
  return useMutation({
    mutationFn: ({ crossBorder, body }: { crossBorder: boolean; body: LegacyWizardIn }) =>
      unwrap(
        api.POST(crossBorder ? "/cross-border/wizard" : "/guidance/wizard", {
          body: { ...body, create_reminders: body.create_reminders ?? true },
        }),
      ),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cross-border", "transfers"] });
      qc.invalidateQueries({ queryKey: ["cross-border", "limits"] });
    },
  });
}

export function useLimits() {
  return useQuery<Limits>({
    queryKey: ["cross-border", "limits"],
    queryFn: () => unwrap(api.GET("/cross-border/limits", {})),
  });
}
