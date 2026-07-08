import { apiBaseUrl } from "@/lib/api/client";
import { authStore } from "@/lib/api/auth";
import { db, type QueuedCapture } from "./db";

export type UploadResult =
  | { ok: true; documentId: string }
  | { ok: false; status: number; error: string; unauthorized?: boolean };

/**
 * Multipart upload to POST /documents. Uses a hand-built fetch (not openapi-fetch)
 * because the endpoint is multipart/form-data with a File part.
 */
export async function uploadDocument(
  file: Blob,
  opts: { filename: string; docType?: string; sourceLabel?: string; batchId?: string; groupHint?: string },
): Promise<UploadResult> {
  const token = authStore.access;
  if (!token) return { ok: false, status: 401, error: "Not signed in", unauthorized: true };

  const form = new FormData();
  form.append("file", file, opts.filename);
  if (opts.docType) form.append("type", opts.docType);
  form.append("source_channel", "upload");
  if (opts.sourceLabel) form.append("source_label", opts.sourceLabel);
  if (opts.batchId) form.append("batch_id", opts.batchId);
  if (opts.groupHint) form.append("group_hint", opts.groupHint);

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "Network error" };
  }

  if (res.status === 401) return { ok: false, status: 401, error: "Session expired", unauthorized: true };
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: detail || `Upload failed (${res.status})` };
  }
  const body = (await res.json()) as { id: string };
  return { ok: true, documentId: body.id };
}

export async function enqueueCapture(
  file: Blob,
  opts: { filename: string; docType?: string; sourceLabel?: string; batchId?: string; groupHint?: string },
): Promise<QueuedCapture> {
  const item: QueuedCapture = {
    id: crypto.randomUUID(),
    blob: file,
    filename: opts.filename,
    contentType: file.type || "application/octet-stream",
    docType: opts.docType ?? "",
    sourceLabel: opts.sourceLabel,
    batchId: opts.batchId,
    groupHint: opts.groupHint,
    createdAt: Date.now(),
    attempts: 0,
    status: "queued",
  };
  await db.captures.add(item);
  return item;
}

let flushing = false;

/**
 * Drain the queue. Each item is marked `syncing` before upload so a concurrent
 * flush skips it; on success it is deleted (so a re-run never re-uploads it →
 * no duplication), on failure it is marked `failed` with the error.
 */
export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  if (flushing) return { synced: 0, failed: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, failed: 0 };
  }
  flushing = true;
  let synced = 0;
  let failed = 0;
  try {
    const pending = await db.captures
      .filter((c) => c.status !== "syncing")
      .toArray();
    for (const item of pending) {
      await db.captures.update(item.id, { status: "syncing", lastError: undefined });
      const result = await uploadDocument(item.blob, {
        filename: item.filename,
        docType: item.docType || undefined,
        sourceLabel: item.sourceLabel,
        batchId: item.batchId,
        groupHint: item.groupHint,
      });
      if (result.ok) {
        await db.captures.delete(item.id);
        synced += 1;
      } else {
        failed += 1;
        await db.captures.update(item.id, {
          status: "failed",
          attempts: item.attempts + 1,
          lastError: result.unauthorized ? "Sign in again to sync." : result.error,
        });
        if (result.unauthorized) break;
      }
    }
  } finally {
    flushing = false;
  }
  return { synced, failed };
}

export function removeCapture(id: string) {
  return db.captures.delete(id);
}

export async function retryCapture(id: string) {
  await db.captures.update(id, { status: "queued", lastError: undefined });
  return flushQueue();
}
