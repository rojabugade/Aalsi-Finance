import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type ReviewItem = components["schemas"]["ReviewItemOut"];
export type ReviewGroup = components["schemas"]["ReviewGroupOut"];
export type ReviewQueue = components["schemas"]["ReviewQueueOut"];
export type ResolveAction = "confirm" | "reject";

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

const KEY = ["review-queue"] as const;

/** Suggested same-receipt groups + loose items awaiting confirmation. */
export function useReviewQueue(opts?: { poll?: boolean }) {
  return useQuery<ReviewQueue>({
    queryKey: KEY,
    queryFn: () => unwrap(api.GET("/review-queue", {})),
    refetchInterval: opts?.poll ? 2500 : false,
  });
}

export function useResolveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      action,
      data,
    }: {
      documentId: string;
      action: ResolveAction;
      data?: Record<string, unknown> | null;
    }) =>
      unwrap(
        api.POST("/review-queue/{document_id}/resolve", {
          params: { path: { document_id: documentId } },
          // OpenAPI types `data` as an empty-object dict; cast our payload through.
          body: { action, data: (data ?? null) as Record<string, never> | null },
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      // Confirming an item creates/updates a transaction.
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/** Confirm or split a suggested same-receipt group. */
export function useResolveGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      memberDocumentIds,
      action,
      data,
    }: {
      memberDocumentIds: string[];
      action: "confirm" | "split";
      data?: Record<string, unknown> | null;
    }) =>
      unwrap(
        api.POST("/review-queue/group/resolve", {
          body: {
            member_document_ids: memberDocumentIds,
            action,
            data: (data ?? null) as Record<string, never> | null,
          },
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
