"use client";

import { Loader2, ScanText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DocumentRow } from "@/lib/api/documents";

/**
 * Live view of documents the server is still reading (OCR/extraction). Sourced
 * from the documents query, which polls while anything is pending — so a row
 * appears here the moment an upload lands and disappears when it reaches review,
 * giving the user continuous feedback without a manual refresh.
 */
export function ProcessingList({ docs }: { docs: DocumentRow[] }) {
  if (docs.length === 0) return null;

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <ScanText className="size-4 text-accent" />
        <h2 className="text-base font-bold tracking-tight">Reading your {docs.length > 1 ? "documents" : "document"}…</h2>
      </div>
      <ul className="space-y-2">
        {docs.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{doc.original_filename ?? "Document"}</p>
              <p className="text-xs capitalize text-muted">
                {doc.type}
                {doc.page_count ? ` · ${doc.page_count} page${doc.page_count > 1 ? "s" : ""}` : ""}
              </p>
            </div>
            <Badge variant="secondary">
              <Loader2 className="size-3 animate-spin" />
              {doc.status === "uploaded" ? "queued" : "reading"}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
