"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Cpu, Sparkles } from "lucide-react";
import { useDocuments, provenanceLabel, type DocumentRow } from "@/lib/api/documents";

export type ActivityFilter = "all" | "pending" | "confirmed" | "failed";

const PENDING = new Set(["uploaded", "processing", "needs_review"]);

export function filterDocuments(
  docs: DocumentRow[],
  filter: ActivityFilter,
  search: string,
): DocumentRow[] {
  const q = search.trim().toLowerCase();
  return docs.filter((d) => {
    const okFilter =
      filter === "all" ||
      (filter === "pending" && PENDING.has(d.status)) ||
      (filter === "confirmed" && d.status === "processed") ||
      (filter === "failed" && d.status === "failed");
    const okSearch = q === "" || (d.original_filename ?? "").toLowerCase().includes(q);
    return okFilter && okSearch;
  });
}

function statusLabel(s: string) {
  if (s === "needs_review") return "Pending confirm";
  if (s === "processed") return "Confirmed";
  if (s === "failed") return "Failed";
  if (s === "processing") return "Reading…";
  return "Received";
}

function ProcessingBadge({ processing }: { processing?: Record<string, unknown> | null }) {
  const extractor = typeof processing?.extractor === "string" ? processing.extractor : null;
  if (!extractor || extractor === "none") return null;
  const ai = extractor === "text-llm" || extractor === "vision-llm";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${ai ? "text-accent" : "text-success"}`}>
      {ai ? <Sparkles className="size-3" /> : <Cpu className="size-3" />}
      {ai ? "AI model" : "Local OCR"}
    </span>
  );
}

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "failed", label: "Failed" },
];

const PAGE_SIZE = 8;

export function ActivityList({
  initialFilter = "all",
  embedded = false,
}: {
  initialFilter?: ActivityFilter;
  embedded?: boolean;
} = {}) {
  const docs = useDocuments();
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const items = filterDocuments(docs.data ?? [], filter, search);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const visible = items.slice(start, start + PAGE_SIZE);

  // A new filter/search narrows the list — jump back to the first page.
  useEffect(() => {
    setPage(0);
  }, [filter, search]);

  return (
    <div
      className={
        embedded
          ? "flex min-h-0 flex-1 flex-col"
          : "rounded-card-sm border border-border bg-card p-4 shadow-card"
      }
    >
      {!embedded && (
        <h2 className="mb-3 text-base font-bold tracking-tight">Recent activity</h2>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors " +
              (filter === f.value ? "border-accent bg-accent/10 text-accent" : "border-border text-muted")
            }
          >
            {f.label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files…"
          aria-label="Search recent activity"
          className="ml-auto w-32 rounded border border-border bg-background px-2 py-1 text-xs"
        />
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing here yet.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 animate-in fade-in slide-in-from-top-1"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {d.original_filename || `${d.source_channel} ${d.type}`}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="capitalize">{d.source_channel}</span> · {d.type} · {statusLabel(d.status)}
                  <ProcessingBadge processing={d.processing} />
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted">{provenanceLabel(d.transactions)}</span>
            </li>
          ))}
        </ul>
      )}
      {items.length > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
          <span className="tabular-nums">
            {start + 1}–{Math.min(start + PAGE_SIZE, items.length)} of {items.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous page"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 transition-colors hover:bg-card disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="size-3.5" /> Prev
            </button>
            <span className="tabular-nums">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 transition-colors hover:bg-card disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Next <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
