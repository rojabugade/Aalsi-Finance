"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CloudOff, History, Landmark, Layers, Loader2, Upload, Wifi } from "lucide-react";
import { toast } from "sonner";

import { enqueueCapture, flushQueue } from "@/lib/offline/sync";
import { useCaptureQueue } from "@/lib/offline/use-capture-queue";
import { useDocuments, documentsPending } from "@/lib/api/documents";
import { useReviewQueue } from "@/lib/api/review";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CsvWizard } from "@/components/capture/csv-wizard";
import { ManualTransactionEntry } from "@/components/capture/manual-transaction-entry";
import { TypeSelector, captureTypeToDocType, type CaptureType } from "@/components/capture/type-selector";
import { CaptureStats, computeCaptureStats } from "@/components/capture/capture-stats";
import { UploadProgress } from "@/components/capture/upload-progress";
import { ProcessingList } from "@/components/capture/processing-list";
import { ActivityList, type ActivityFilter } from "@/components/capture/activity-list";
import { ReviewList } from "@/components/capture/review-list";
import { classifyFile } from "./classify";
import Link from "next/link";

export default function CapturePage() {
  const { items, online } = useCaptureQueue();
  const qc = useQueryClient();
  const docs = useDocuments();
  const pending = documentsPending(docs.data);
  const processingDocs = (docs.data ?? []).filter(
    (d) => d.status === "uploaded" || d.status === "processing",
  );
  const review = useReviewQueue({ poll: pending });
  const waiting =
    (review.data?.groups?.length ?? 0) + (review.data?.items?.length ?? 0);
  const stats = computeCaptureStats(docs.data ?? [], waiting);

  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sheets, setSheets] = useState<File[]>([]);
  const [docType, setDocType] = useState<CaptureType>("auto");
  const [oneReceipt, setOneReceipt] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentFilter, setRecentFilter] = useState<ActivityFilter>("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  const recentRef = useRef<HTMLDivElement>(null);
  const openRecent = useCallback((filter: ActivityFilter = "all") => {
    setRecentFilter(filter);
    setRecentOpen(true);
    requestAnimationFrame(() =>
      recentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, []);

  const refreshFeeds = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["documents"] });
    qc.invalidateQueries({ queryKey: ["review-queue"] });
  }, [qc]);

  // When the last document finishes processing, `pending` flips false and polling
  // stops. Pull the review queue once more on that edge so a just-finished item
  // shows up immediately rather than only after a manual refresh.
  const wasPending = useRef(pending);
  useEffect(() => {
    if (wasPending.current && !pending) {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
    }
    wasPending.current = pending;
  }, [pending, qc]);

  const ingest = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const sheetFiles = files.filter((f) => classifyFile(f) === "spreadsheet");
    const docFiles = files.filter((f) => classifyFile(f) === "doc");
    if (sheetFiles.length > 0) setSheets((q) => [...q, ...sheetFiles]);
    if (docFiles.length === 0) return;
    setBusy(true);
    const batchId = crypto.randomUUID();
    const type = captureTypeToDocType(docType);
    const groupHint = oneReceipt ? "single" : undefined;
    try {
      for (const file of docFiles) {
        await enqueueCapture(file, { filename: file.name, docType: type, batchId, groupHint });
      }
      const { synced, failed } = await flushQueue();
      if (synced > 0) toast.success(`Uploaded ${synced} document${synced > 1 ? "s" : ""} — reading it now…`);
      if (failed > 0 && synced === 0) toast.message("Queued — will sync when connected");
      refreshFeeds();
    } catch {
      toast.error("Couldn't queue those files");
    } finally {
      setBusy(false);
      setOneReceipt(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [docType, oneReceipt, refreshFeeds]);

  useEffect(() => {
    const onOver = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer?.types?.includes("Files")) setDragging(true); };
    const onLeave = (e: DragEvent) => { if (e.relatedTarget === null) setDragging(false); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void ingest(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [ingest]);

  const hasUploads = items.length > 0;
  const hasReview = waiting > 0;

  return (
    // Full-bleed: cancel the shell's px-8 py-6 gutter so the surface owns the page,
    // then fill the viewport height dynamically (dvh adapts as the window resizes).
    <div className="relative -mx-8 -my-6 flex min-h-[calc(100dvh-7.25rem)] flex-col px-8 py-6 2xl:-mx-10 2xl:px-10">
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-accent/10 backdrop-blur-sm">
          <div className="rounded-card-sm border-2 border-dashed border-accent bg-card px-8 py-6 text-center shadow-card">
            <Upload className="mx-auto size-8 text-accent" />
            <p className="mt-2 text-sm font-semibold">Drop to add — we&rsquo;ll detect the type</p>
          </div>
        </div>
      )}

      {/* Header — title + status */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">Add anything</h1>
        <Badge variant={online ? "success" : "warning"}>
          {online ? <Wifi className="size-3.5" /> : <CloudOff className="size-3.5" />}
          {online ? "Online" : "Offline"}
        </Badge>
      </div>

      <div className="mt-3">
        <CaptureStats
          waiting={stats.waiting}
          addedThisWeek={stats.addedThisWeek}
          failed={stats.failed}
          onWaitingClick={() => confirmRef.current?.scrollIntoView({ behavior: "smooth" })}
          onFailedClick={() => openRecent("failed")}
        />
      </div>

      <div className="mt-4">
        <TypeSelector value={docType} onChange={setDocType} />
      </div>

      {/* Borderless drop surface — fills the remaining height, click to browse */}
      <button
        type="button"
        aria-label="Upload files"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="group mt-4 flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-card-sm text-center transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="grid size-16 place-items-center rounded-full bg-accent/10 text-accent transition-colors group-hover:bg-accent/15">
          {busy ? <Loader2 className="size-8 animate-spin" /> : <Upload className="size-8" />}
        </span>
        <span className="text-lg font-semibold">Drop files here, or click to browse</span>
        <span className="text-xs text-muted">
          {docType === "auto"
            ? "Receipts, PDFs, CSV or XLSX — we detect the type."
            : `Uploading as ${docType}.`}
        </span>
      </button>

      <input
        ref={fileRef}
        data-testid="capture-file-input"
        type="file"
        accept="image/*,application/pdf,.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        multiple
        className="hidden"
        onChange={(e) => { void ingest(Array.from(e.target.files ?? [])); }}
      />

      {/* Controls — stay attached under the drop surface */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ManualTransactionEntry />
          <Link
            href="/debt"
            className="inline-flex items-center gap-1.5 rounded-chip border border-border px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-card"
          >
            <Landmark className="size-4" /> Add loan
          </Link>
        </div>
        <label
          className="flex items-center gap-2 text-sm"
          title="Turn on when one receipt, invoice, or statement is split across several photos or pages — we merge them into a single item instead of adding separate ones."
        >
          <button
            type="button"
            role="switch"
            aria-checked={oneReceipt}
            aria-label="These files are one document"
            onClick={() => setOneReceipt((v) => !v)}
            className={
              "relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg " +
              (oneReceipt ? "bg-accent" : "bg-border")
            }
          >
            <span
              className={
                "absolute top-0.5 size-4 rounded-full bg-white transition-all " +
                (oneReceipt ? "left-[18px]" : "left-0.5")
              }
            />
          </button>
          <span className="inline-flex items-center gap-1.5">
            <Layers className="size-4 text-muted" /> One document
          </span>
        </label>
      </div>

      {/* Progressive: live uploads, then items waiting to confirm */}
      {hasUploads && (
        <div className="mt-4">
          <UploadProgress items={items} />
        </div>
      )}
      {processingDocs.length > 0 && (
        <div className="mt-4">
          <ProcessingList docs={processingDocs} />
        </div>
      )}
      {hasReview && (
        <div ref={confirmRef} className="mt-4">
          <ReviewList poll={pending} />
        </div>
      )}

      {sheets.length > 0 && (
        <div className="mt-4 rounded-card-sm border border-border bg-card p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold tracking-tight">
              Map &ldquo;{sheets[0].name}&rdquo;
              {sheets.length > 1 && (
                <span className="ml-2 text-xs font-normal text-muted">(1 of {sheets.length})</span>
              )}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setSheets((q) => q.slice(1))}>Skip</Button>
          </div>
          <CsvWizard key={sheets[0].name} initialFile={sheets[0]} onDone={() => setSheets((q) => q.slice(1))} />
        </div>
      )}

      {/* Recent activity — footer expander; opens right where the trigger is */}
      <div className="mt-6 border-t border-border pt-3">
        <button
          type="button"
          aria-expanded={recentOpen}
          onClick={() => (recentOpen ? setRecentOpen(false) : openRecent("all"))}
          className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md text-sm font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="inline-flex items-center gap-2">
            <History className="size-4" /> Recent activity
          </span>
          <ChevronDown
            className={"size-4 transition-transform " + (recentOpen ? "rotate-180" : "")}
          />
        </button>
        {recentOpen && (
          <div ref={recentRef} className="mt-3 animate-in fade-in slide-in-from-top-2">
            <ActivityList key={recentFilter} initialFilter={recentFilter} embedded />
          </div>
        )}
      </div>
    </div>
  );
}
