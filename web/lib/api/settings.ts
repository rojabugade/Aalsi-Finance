import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api, apiBaseUrl } from "./client";
import { authStore } from "./auth";

export type Settings = components["schemas"]["SettingsOut"];
export type SettingsPatch = components["schemas"]["SettingsPatch"];
export type Consent = components["schemas"]["ConsentOut"];
export type Workspace = components["schemas"]["WorkspaceOut"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useSettings() {
  return useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: () => unwrap(api.GET("/settings", {})),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsPatch) => unwrap(api.PATCH("/settings", { body })),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function usePingLlm() {
  return useMutation({
    mutationFn: () => unwrap(api.POST("/admin/llm/ping", {})),
  });
}

export function useConsents() {
  return useQuery<Consent[]>({
    queryKey: ["consents"],
    queryFn: () => unwrap(api.GET("/consents", {})),
  });
}

export function useRevokeConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channel: string) =>
      unwrap(api.POST("/consents/{channel}/revoke", { params: { path: { channel } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consents"] }),
  });
}

export function useWorkspace() {
  return useQuery<Workspace>({
    queryKey: ["workspace"],
    queryFn: () => unwrap(api.GET("/workspace", {})),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (confirmation: string) => {
      const { error } = await api.DELETE("/account", { body: { confirmation } });
      if (error) throw error;
    },
  });
}

/**
 * Streamed file export. openapi-fetch is awkward with binary downloads, so we
 * hand-build the fetch (mirrors the W1 multipart-upload approach) and attach the
 * bearer token directly. `csv` returns a zip, `pdf` returns a PDF summary.
 */
export async function downloadExport(format: "csv" | "pdf"): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/export?format=${format}`, {
    headers: authStore.access ? { Authorization: `Bearer ${authStore.access}` } : {},
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = format === "csv" ? "finance-export.zip" : "finance-summary.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
