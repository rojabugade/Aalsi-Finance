"use client";

import { AlertCircle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { QueuedCapture } from "@/lib/offline/db";
import { flushQueue, removeCapture, retryCapture } from "@/lib/offline/sync";

export function UploadProgress({ items }: { items: QueuedCapture[] }) {
  const qc = useQueryClient();

  async function syncNow() {
    const { synced, failed } = await flushQueue();
    if (synced > 0) {
      toast.success(`Synced ${synced}`);
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["review-queue"] });
    } else if (failed > 0) {
      toast.error("Still couldn't sync - check your connection");
    } else {
      toast.message("Nothing to sync");
    }
  }

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Upload progress</h2>
          <p className="text-sm text-muted">{items.length ? `${items.length} pending file${items.length > 1 ? "s" : ""}` : "No files waiting"}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={syncNow}>
          <RefreshCw className="size-4" /> Sync
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted">
          Files appear here while they upload.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition-all duration-200"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.filename}</p>
                <p className="text-xs text-muted">
                  {item.docType || "auto"}
                  {item.groupHint === "single" ? " - one receipt" : ""}
                  {item.lastError && (
                    <span className="ml-1 inline-flex items-center gap-1 text-destructive">
                      <AlertCircle className="size-3" /> {item.lastError}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {item.status === "syncing" ? (
                  <Badge variant="secondary">
                    <Loader2 className="size-3 animate-spin" /> syncing
                  </Badge>
                ) : item.status === "failed" ? (
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => retryCapture(item.id)}>
                    <RefreshCw className="size-4" />
                  </Button>
                ) : (
                  <Badge variant="warning">queued</Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted"
                  onClick={() => removeCapture(item.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
