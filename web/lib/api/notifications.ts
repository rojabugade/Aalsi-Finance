import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type Notification = components["schemas"]["NotificationOut"];
export type NotificationPreferences = components["schemas"]["NotificationPreferences"];
export type NotificationPreferencesPatch = components["schemas"]["NotificationPreferencesPatch"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useNotifications() {
  return useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => unwrap(api.GET("/notifications", {})),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST("/notifications/{notification_id}/read", {
          params: { path: { notification_id: id } },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useNotificationPreferences() {
  return useQuery<NotificationPreferences>({
    queryKey: ["notifications", "preferences"],
    queryFn: () => unwrap(api.GET("/notifications/preferences", {})),
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NotificationPreferencesPatch) =>
      unwrap(api.PATCH("/notifications/preferences", { body })),
    onSuccess: (data) => qc.setQueryData(["notifications", "preferences"], data),
  });
}
