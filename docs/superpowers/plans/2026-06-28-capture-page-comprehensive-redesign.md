# Capture Page Comprehensive Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/capture` ("Add anything") into a comprehensive, guided, live-feeling page: a two-column layout with a per-batch document-type picker (Auto-detect default), upload guidance + info, a "these are one receipt" toggle, and optimistic/animated/always-visible Review + Recent activity with filter/search and per-file progress.

**Architecture:** Frontend-led. `page.tsx` becomes a thin two-column orchestrator holding `docType` + `oneReceipt` state and passing them into `ingest()`. UI is split into focused components under `web/components/capture/`. A small backend slice threads a `group_hint` signal end-to-end so the toggle can force same-receipt merges that the heuristic clustering would otherwise reject.

**Tech Stack:** Next.js (App Router) + React + TypeScript, TanStack Query, Dexie (offline queue), Tailwind + `tailwindcss-animate` (CSS transitions — no framer-motion), vitest + Testing Library (web); FastAPI + SQLAlchemy async, pytest (backend).

## Global Constraints

- Motion uses CSS / Tailwind transitions only — do **not** add framer-motion or any animation dependency.
- Respect `prefers-reduced-motion` for fade/opacity, but **not** for layout motion (project note: reduce-motion must not kill core motion).
- Document types sent to the backend are exactly: `receipt`, `statement`, `paystub`, `invoice`, `csv`, `other`. Auto-detect sends **no** `type`.
- CSV/XLSX always route to the mapping wizard client-side regardless of the type picker (`classifyFile`).
- Privacy copy stays accurate: files are read on-device with local OCR and not sent to any AI service.
- Backend tests run in the api container against the `finance_test` DB (local `.venv` is broken); web tests run with `npm run test` / `vitest`.
- One `batchId` per drop (already the convention) — preserve it.

---

### Task 1: Backend — persist `group_hint` and force same-receipt grouping

**Files:**
- Modify: `backend/app/documents/router.py:72-99` (add `group_hint` Form param, pass through)
- Modify: `backend/app/documents/service.py` (`create_document` signature + `ingest_meta`)
- Modify: `backend/app/ocr/grouping.py:104-141` (`group_review_documents` honors `group_hint=single`)
- Test: `backend/tests/test_ocr_grouping.py`

**Interfaces:**
- Consumes: existing `create_document(...)`, `group_review_documents(documents)`.
- Produces:
  - `create_document(..., group_hint: str | None = None)` persisting `ocr_meta["ingest"]["group_hint"]`.
  - `upload_document` accepts `group_hint: str | None = Form(default=None)`.
  - `group_review_documents`: docs in a batch whose `ingest.group_hint == "single"` are forced into ONE group (bypassing `_compatible`), still merged via `merge_extractions`.

- [ ] **Step 1: Write the failing grouping test**

Add to `backend/tests/test_ocr_grouping.py` (follow the existing fake-document helpers in that file; if a `_doc(...)` style builder exists, reuse it — otherwise mirror how other tests in the file construct documents with `ocr_meta`):

```python
def test_group_hint_single_forces_one_group_despite_conflicts():
    # Two receipts in the same batch with DIFFERENT merchants and totals would
    # normally stay separate; group_hint="single" must override and merge them.
    a = _doc(id="a", type="receipt", batch_id="b1",
             data={"merchant": "Costco", "total": "10.00"},
             group_hint="single")
    b = _doc(id="b", type="receipt", batch_id="b1",
             data={"merchant": "Target", "total": "99.00"},
             group_hint="single")

    groups, loose = group_review_documents([a, b])

    assert len(groups) == 1
    assert set(groups[0].member_ids) == {"a", "b"}
    assert loose == []
```

If `_doc` in this file does not yet accept `group_hint`, extend that helper so it writes `ocr_meta["ingest"]["group_hint"]` (alongside how it already sets `batch_id`).

- [ ] **Step 2: Run the test to verify it fails**

Run (in the api container):
`pytest tests/test_ocr_grouping.py::test_group_hint_single_forces_one_group_despite_conflicts -v`
Expected: FAIL — currently the two conflicting receipts go to `loose`, so `len(groups) == 0`.

- [ ] **Step 3: Implement `group_hint` in grouping**

In `backend/app/ocr/grouping.py`, add a reader and branch the batch handling:

```python
def _group_hint(document) -> str | None:
    return ((document.ocr_meta or {}).get("ingest", {}) or {}).get("group_hint")
```

In `group_review_documents`, replace the per-batch clustering loop body so a forced batch skips the compatibility clustering:

```python
    for members in batches.values():
        forced = len(members) >= 2 and all(_group_hint(m) == "single" for m in members)
        clusters = [members] if forced else _cluster_compatible(members)
        for cluster in clusters:
            if len(cluster) < 2:
                continue
            data, summary = merge_extractions(cluster)
            groups.append(
                ReviewGroup(
                    member_ids=[str(m.id) for m in cluster],
                    data=data,
                    summary=summary,
                    doc_type=cluster[0].type,
                    confidence=min(_ocr_confidence(m) for m in cluster),
                )
            )
            grouped_ids.update(m.id for m in cluster)
```

- [ ] **Step 4: Run the grouping test to verify it passes**

Run: `pytest tests/test_ocr_grouping.py -v`
Expected: PASS (new test + all existing grouping tests still green).

- [ ] **Step 5: Write the failing router/service persistence test**

Add to `backend/tests/test_m5_ocr.py` (or the existing document-upload test module — match where `upload_document` / `create_document` is already exercised). Mirror the existing upload-test setup for `store`, `session`, `household_id`:

```python
@pytest.mark.asyncio
async def test_create_document_persists_group_hint(session, store, household):
    doc = await service.create_document(
        session, store,
        household_id=household.id,
        uploaded_by_user_id=None,
        file_bytes=_PNG_BYTES,            # reuse the module's sample image bytes
        filename="r.png",
        content_type="image/png",
        batch_id="b1",
        group_hint="single",
    )
    assert doc.ocr_meta["ingest"]["group_hint"] == "single"
```

Use whatever fixtures the surrounding tests already use; if they call `create_document` with a different fixture set, copy that exact setup.

- [ ] **Step 6: Run it to verify it fails**

Run: `pytest tests/test_m5_ocr.py::test_create_document_persists_group_hint -v`
Expected: FAIL — `create_document` has no `group_hint` parameter (TypeError).

- [ ] **Step 7: Thread `group_hint` through service + router**

In `backend/app/documents/service.py`, add the parameter to `create_document`:

```python
    batch_id: str | None = None,
    group_hint: str | None = None,
    settings: Settings | None = None,
```

and after the `if batch_id:` block in `ingest_meta`:

```python
    if group_hint:
        ingest_meta["group_hint"] = group_hint
```

In `backend/app/documents/router.py`, add the Form param and pass it:

```python
    batch_id: str | None = Form(default=None),
    group_hint: str | None = Form(default=None),
```

```python
            batch_id=batch_id,
            group_hint=group_hint,
```

- [ ] **Step 8: Run the persistence test to verify it passes**

Run: `pytest tests/test_m5_ocr.py::test_create_document_persists_group_hint -v`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/documents/router.py backend/app/documents/service.py backend/app/ocr/grouping.py backend/tests/test_ocr_grouping.py backend/tests/test_m5_ocr.py
git commit -m "feat(capture): group_hint forces same-receipt merge end-to-end"
```

---

### Task 2: Offline plumbing — thread `groupHint` through the upload queue

**Files:**
- Modify: `web/lib/offline/db.ts:4-19` (`QueuedCapture` field)
- Modify: `web/lib/offline/sync.ts:13-65,82-93` (`uploadDocument`, `enqueueCapture`, flush mapping)
- Test: `web/lib/offline/__tests__/sync.test.ts` (create if absent — check `web/lib/offline/` for an existing sync test first and extend it instead)

**Interfaces:**
- Consumes: Task 1's `group_hint` multipart field.
- Produces:
  - `QueuedCapture` gains `groupHint?: string`.
  - `uploadDocument(file, opts)` and `enqueueCapture(file, opts)` `opts` gain `groupHint?: string`; when set, `uploadDocument` appends `form.append("group_hint", opts.groupHint)`.

- [ ] **Step 1: Write the failing test**

In `web/lib/offline/__tests__/sync.test.ts`, mock `fetch` and assert the field is sent:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { uploadDocument } from "@/lib/offline/sync";
import { authStore } from "@/lib/api/auth";

describe("uploadDocument group_hint", () => {
  beforeEach(() => { authStore.access = "tok"; });

  it("appends group_hint when provided", async () => {
    const seen: FormData[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init.body as FormData);
      return new Response(JSON.stringify({ id: "d1" }), { status: 201 });
    }));

    await uploadDocument(new Blob(["x"]), { filename: "r.png", groupHint: "single" });

    expect(seen[0].get("group_hint")).toBe("single");
  });
});
```

If an `authStore` import shape differs, match how other web tests set the access token.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run lib/offline/__tests__/sync.test.ts`
Expected: FAIL — `group_hint` is not on the FormData (returns `null`).

- [ ] **Step 3: Implement the field threading**

In `web/lib/offline/db.ts`, add to `QueuedCapture`:

```ts
  /** Forces same-receipt merge for this drop when "single". */
  groupHint?: string;
```

In `web/lib/offline/sync.ts`, extend `uploadDocument` opts + body:

```ts
  opts: { filename: string; docType?: string; sourceLabel?: string; batchId?: string; groupHint?: string },
```

```ts
  if (opts.batchId) form.append("batch_id", opts.batchId);
  if (opts.groupHint) form.append("group_hint", opts.groupHint);
```

Extend `enqueueCapture` opts and item:

```ts
  opts: { filename: string; docType?: string; sourceLabel?: string; batchId?: string; groupHint?: string },
```

```ts
    batchId: opts.batchId,
    groupHint: opts.groupHint,
```

In `flushQueue`, pass it through:

```ts
      const result = await uploadDocument(item.blob, {
        filename: item.filename,
        docType: item.docType || undefined,
        sourceLabel: item.sourceLabel,
        batchId: item.batchId,
        groupHint: item.groupHint,
      });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npx vitest run lib/offline/__tests__/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/offline/db.ts web/lib/offline/sync.ts web/lib/offline/__tests__/sync.test.ts
git commit -m "feat(capture): thread groupHint through offline upload queue"
```

---

### Task 3: `type-selector.tsx` — per-batch document-type picker

**Files:**
- Create: `web/components/capture/type-selector.tsx`
- Test: `web/components/capture/__tests__/type-selector.test.tsx`

**Interfaces:**
- Produces:
  - `export type CaptureType = "auto" | "receipt" | "invoice" | "statement" | "paystub" | "spreadsheet" | "other";`
  - `export const CAPTURE_TYPES: { value: CaptureType; label: string }[]` (Auto-detect first).
  - `export function captureTypeToDocType(t: CaptureType): string | undefined` — returns the backend `type` for the doc pipeline, or `undefined` for `auto`/`spreadsheet`.
  - `export function TypeSelector({ value, onChange }: { value: CaptureType; onChange: (t: CaptureType) => void })` — segmented control.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TypeSelector, captureTypeToDocType } from "@/components/capture/type-selector";

describe("TypeSelector", () => {
  it("maps types to backend doc types", () => {
    expect(captureTypeToDocType("auto")).toBeUndefined();
    expect(captureTypeToDocType("spreadsheet")).toBeUndefined();
    expect(captureTypeToDocType("receipt")).toBe("receipt");
    expect(captureTypeToDocType("paystub")).toBe("paystub");
  });

  it("calls onChange when a type is picked", () => {
    const onChange = vi.fn();
    render(<TypeSelector value="auto" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /receipt/i }));
    expect(onChange).toHaveBeenCalledWith("receipt");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run components/capture/__tests__/type-selector.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
"use client";

export type CaptureType =
  | "auto" | "receipt" | "invoice" | "statement" | "paystub" | "spreadsheet" | "other";

export const CAPTURE_TYPES: { value: CaptureType; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "receipt", label: "Receipt" },
  { value: "invoice", label: "Invoice" },
  { value: "statement", label: "Statement" },
  { value: "paystub", label: "Paystub" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "other", label: "Other" },
];

/** Backend `type` to send for the document pipeline. auto = let server infer;
 * spreadsheet = handled by the CSV wizard client-side, so no doc type. */
export function captureTypeToDocType(t: CaptureType): string | undefined {
  if (t === "auto" || t === "spreadsheet") return undefined;
  return t;
}

export function TypeSelector({
  value,
  onChange,
}: {
  value: CaptureType;
  onChange: (t: CaptureType) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Document type">
      {CAPTURE_TYPES.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(t.value)}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
              (active
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:bg-card")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npx vitest run components/capture/__tests__/type-selector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/capture/type-selector.tsx web/components/capture/__tests__/type-selector.test.tsx
git commit -m "feat(capture): per-batch document type selector"
```

---

### Task 4: `capture-stats.tsx` — summary stat strip

**Files:**
- Create: `web/components/capture/capture-stats.tsx`
- Test: `web/components/capture/__tests__/capture-stats.test.tsx`

**Interfaces:**
- Consumes: `DocumentRow` from `@/lib/api/documents`.
- Produces:
  - `export function computeCaptureStats(docs: DocumentRow[], waitingCount: number, now?: Date): { waiting: number; addedThisWeek: number; failed: number }` — `addedThisWeek` counts docs with `status === "processed"` and `created_at` within the last 7 days; `failed` counts `status === "failed"`; `waiting` is passed in from the review queue.
  - `export function CaptureStats({ waiting, addedThisWeek, failed, onWaitingClick }: { waiting: number; addedThisWeek: number; failed: number; onWaitingClick?: () => void })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { computeCaptureStats } from "@/components/capture/capture-stats";

const now = new Date("2026-06-28T00:00:00Z");
const day = (n: number) => new Date(now.getTime() - n * 86400000).toISOString();

describe("computeCaptureStats", () => {
  it("counts added-this-week and failed", () => {
    const docs = [
      { status: "processed", created_at: day(1) },
      { status: "processed", created_at: day(10) }, // too old
      { status: "failed", created_at: day(1) },
    ] as any;
    const s = computeCaptureStats(docs, 2, now);
    expect(s).toEqual({ waiting: 2, addedThisWeek: 1, failed: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run components/capture/__tests__/capture-stats.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
"use client";

import type { DocumentRow } from "@/lib/api/documents";

export function computeCaptureStats(
  docs: DocumentRow[],
  waitingCount: number,
  now: Date = new Date(),
): { waiting: number; addedThisWeek: number; failed: number } {
  const weekAgo = now.getTime() - 7 * 86400000;
  let addedThisWeek = 0;
  let failed = 0;
  for (const d of docs) {
    if (d.status === "failed") failed += 1;
    if (d.status === "processed" && new Date(d.created_at).getTime() >= weekAgo) {
      addedThisWeek += 1;
    }
  }
  return { waiting: waitingCount, addedThisWeek, failed };
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-sm font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex items-baseline gap-1.5 hover:underline">
      {body}
    </button>
  ) : (
    <span className="flex items-baseline gap-1.5">{body}</span>
  );
}

export function CaptureStats({
  waiting,
  addedThisWeek,
  failed,
  onWaitingClick,
}: {
  waiting: number;
  addedThisWeek: number;
  failed: number;
  onWaitingClick?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Stat label="waiting to confirm" value={waiting} onClick={waiting > 0 ? onWaitingClick : undefined} />
      <Stat label="added this week" value={addedThisWeek} />
      <Stat label="failed" value={failed} />
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npx vitest run components/capture/__tests__/capture-stats.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/capture/capture-stats.tsx web/components/capture/__tests__/capture-stats.test.tsx
git commit -m "feat(capture): summary stat strip"
```

---

### Task 5: `upload-info.tsx` — "What you can upload" + privacy

**Files:**
- Create: `web/components/capture/upload-info.tsx`
- Test: `web/components/capture/__tests__/upload-info.test.tsx`

**Interfaces:**
- Produces: `export function UploadInfo()` — static info card listing supported inputs and the privacy line.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UploadInfo } from "@/components/capture/upload-info";

describe("UploadInfo", () => {
  it("lists supported inputs and the privacy note", () => {
    render(<UploadInfo />);
    expect(screen.getByText(/receipts/i)).toBeInTheDocument();
    expect(screen.getByText(/statements/i)).toBeInTheDocument();
    expect(screen.getByText(/paystubs/i)).toBeInTheDocument();
    expect(screen.getByText(/CSV/i)).toBeInTheDocument();
    expect(screen.getByText(/local OCR/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run components/capture/__tests__/upload-info.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
"use client";

import { FileText, Receipt, Landmark, Wallet, Table2, ShieldCheck } from "lucide-react";

const ITEMS = [
  { icon: Receipt, title: "Receipts", note: "Photos or PDFs — one purchase per receipt." },
  { icon: Landmark, title: "Bank & card statements", note: "PDF statements; we extract the lines." },
  { icon: Wallet, title: "Paystubs", note: "Income documents." },
  { icon: FileText, title: "Invoices", note: "Bills you've paid or owe." },
  { icon: Table2, title: "CSV / XLSX exports", note: "Map columns in the wizard." },
];

export function UploadInfo() {
  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <h2 className="mb-3 inline-flex items-center gap-1.5 text-base font-bold tracking-tight">
        What you can upload
      </h2>
      <ul className="space-y-2">
        {ITEMS.map((it) => (
          <li key={it.title} className="flex items-start gap-2">
            <it.icon className="mt-0.5 size-4 shrink-0 text-muted" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{it.title}</p>
              <p className="text-xs text-muted">{it.note}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
        <ShieldCheck className="size-3.5 text-success" />
        Read on-device with local OCR — your files aren&rsquo;t sent to any AI service.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npx vitest run components/capture/__tests__/upload-info.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/capture/upload-info.tsx web/components/capture/__tests__/upload-info.test.tsx
git commit -m "feat(capture): what-you-can-upload info card"
```

---

### Task 6: `upload-progress.tsx` — per-file upload progress (upgraded queue)

**Files:**
- Create: `web/components/capture/upload-progress.tsx` (moves the `UploadQueue` logic out of `page.tsx`)
- Test: `web/components/capture/__tests__/upload-progress.test.tsx`

**Interfaces:**
- Consumes: `QueuedCapture` (`@/lib/offline/db`), `flushQueue`/`retryCapture`/`removeCapture` (`@/lib/offline/sync`).
- Produces:
  - `export function fileStateLabel(status: QueuedCapture["status"]): string` — `queued → "Queued"`, `syncing → "Uploading…"`, `failed → "Failed"`.
  - `export function UploadProgress({ items }: { items: QueuedCapture[] })` — per-file rows with state chip + retry (failed) + remove; renders friendly empty state instead of returning null.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UploadProgress, fileStateLabel } from "@/components/capture/upload-progress";
import type { QueuedCapture } from "@/lib/offline/db";

const item = (over: Partial<QueuedCapture>): QueuedCapture => ({
  id: "1", blob: new Blob(), filename: "r.png", contentType: "image/png",
  docType: "", createdAt: 0, attempts: 0, status: "queued", ...over,
});

describe("UploadProgress", () => {
  it("labels per-file state", () => {
    expect(fileStateLabel("queued")).toBe("Queued");
    expect(fileStateLabel("syncing")).toBe("Uploading…");
    expect(fileStateLabel("failed")).toBe("Failed");
  });

  it("shows a friendly empty state", () => {
    render(<UploadProgress items={[]} />);
    expect(screen.getByText(/no files uploading/i)).toBeInTheDocument();
  });

  it("renders a row per file", () => {
    render(<UploadProgress items={[item({ id: "a", filename: "a.png" })]} />);
    expect(screen.getByText("a.png")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run components/capture/__tests__/upload-progress.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Port the existing `UploadQueue` from `page.tsx` into this file, renamed and with a non-null empty state and the exported label helper. Keep the `syncNow` invalidation behavior.

```tsx
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { flushQueue, removeCapture, retryCapture } from "@/lib/offline/sync";
import type { QueuedCapture } from "@/lib/offline/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function fileStateLabel(status: QueuedCapture["status"]): string {
  if (status === "syncing") return "Uploading…";
  if (status === "failed") return "Failed";
  return "Queued";
}

export function UploadProgress({ items }: { items: QueuedCapture[] }) {
  const qc = useQueryClient();
  async function syncNow() {
    const { synced, failed } = await flushQueue();
    if (synced > 0) {
      toast.success(`Synced ${synced}`);
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["review-queue"] });
    } else if (failed > 0) toast.error("Still couldn't sync — check your connection");
    else toast.message("Nothing to sync");
  }

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold tracking-tight">Uploading</h2>
          <p className="text-sm text-muted">{items.length} pending</p>
        </div>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={syncNow}>
            <RefreshCw className="size-4" /> Sync now
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No files uploading right now.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 animate-in fade-in slide-in-from-top-1"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.filename}</p>
                <p className="text-xs text-muted">
                  {item.docType || "auto"}
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
                    <Loader2 className="size-3 animate-spin" /> {fileStateLabel(item.status)}
                  </Badge>
                ) : item.status === "failed" ? (
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => retryCapture(item.id)}>
                    <RefreshCw className="size-4" />
                  </Button>
                ) : (
                  <Badge variant="warning">{fileStateLabel(item.status)}</Badge>
                )}
                <Button variant="ghost" size="icon" className="size-8 text-muted" onClick={() => removeCapture(item.id)}>
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npx vitest run components/capture/__tests__/upload-progress.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/capture/upload-progress.tsx web/components/capture/__tests__/upload-progress.test.tsx
git commit -m "feat(capture): per-file upload progress component"
```

---

### Task 7: `activity-list.tsx` — Recent activity with filter/search + motion

**Files:**
- Create: `web/components/capture/activity-list.tsx` (moves `RecentActivity` + `ProcessingBadge` + `statusLabel` out of `page.tsx`)
- Test: `web/components/capture/__tests__/activity-list.test.tsx`

**Interfaces:**
- Consumes: `useDocuments`, `provenanceLabel` (`@/lib/api/documents`), `DocumentRow`.
- Produces:
  - `export type ActivityFilter = "all" | "pending" | "confirmed" | "failed";`
  - `export function filterDocuments(docs: DocumentRow[], filter: ActivityFilter, search: string): DocumentRow[]` — filter maps: pending→`{uploaded,processing,needs_review}`, confirmed→`processed`, failed→`failed`; search matches `original_filename` (case-insensitive substring); empty search = no text filter.
  - `export function ActivityList()` — renders filter chips + search input + animated rows + empty state.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { filterDocuments } from "@/components/capture/activity-list";

const docs = [
  { id: "1", status: "processed", original_filename: "costco.png" },
  { id: "2", status: "needs_review", original_filename: "target.pdf" },
  { id: "3", status: "failed", original_filename: "blurry.jpg" },
] as any;

describe("filterDocuments", () => {
  it("filters by status bucket", () => {
    expect(filterDocuments(docs, "confirmed", "").map((d: any) => d.id)).toEqual(["1"]);
    expect(filterDocuments(docs, "pending", "").map((d: any) => d.id)).toEqual(["2"]);
    expect(filterDocuments(docs, "failed", "").map((d: any) => d.id)).toEqual(["3"]);
  });
  it("searches filename", () => {
    expect(filterDocuments(docs, "all", "costco").map((d: any) => d.id)).toEqual(["1"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run components/capture/__tests__/activity-list.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Port `statusLabel`, `ProcessingBadge`, and `RecentActivity` from `page.tsx` into this file; add the pure `filterDocuments` helper, filter chips, and a search input. Rows get an entry animation.

```tsx
"use client";

import { useState } from "react";
import { Cpu, Sparkles } from "lucide-react";
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

export function ActivityList() {
  const docs = useDocuments();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [search, setSearch] = useState("");
  const items = filterDocuments(docs.data ?? [], filter, search);

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">Recent activity</h2>
        <p className="text-sm text-muted">Everything you&rsquo;ve added and where it went.</p>
      </div>
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
          {items.map((d) => (
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
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npx vitest run components/capture/__tests__/activity-list.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/capture/activity-list.tsx web/components/capture/__tests__/activity-list.test.tsx
git commit -m "feat(capture): recent activity filter/search + motion"
```

---

### Task 8: `review-list.tsx` — motion + always-visible Confirm section

**Files:**
- Create: `web/components/capture/review-list.tsx` (moves `ReviewQueueInline` out of `page.tsx`)
- Test: `web/components/capture/__tests__/review-list.test.tsx`

**Interfaces:**
- Consumes: `useReviewQueue`, `useResolveReview`, `useResolveGroup`, `ReviewGroup`, `ReviewItem` (`@/lib/api/review`); `ConfirmCard`, `SuggestedGroupCard`.
- Produces: `export function ReviewList({ poll }: { poll: boolean })` — renders group + item cards with entry animation and a friendly empty state (already non-null today; keep it and add motion + a clear heading).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api/review", () => ({
  useReviewQueue: () => ({ data: { groups: [], items: [] } }),
  useResolveReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResolveGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ReviewList } from "@/components/capture/review-list";

it("shows empty state when nothing to confirm", () => {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ReviewList poll={false} />
    </QueryClientProvider>,
  );
  expect(screen.getByText(/nothing waiting to confirm/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run components/capture/__tests__/review-list.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Port `ReviewQueueInline` from `page.tsx` into this file as `ReviewList`, keeping the `act`/`confirmGroup` handlers and toasts; wrap each rendered card `<li>`-level element with the entry animation class (`animate-in fade-in slide-in-from-top-1`). The existing `SuggestedGroupCard`/`ConfirmCard` render `<li>` themselves, so add the animation by passing a wrapper class — wrap each in a `<li className="animate-in …">` only if they don't already emit one; since both already emit `<li>`, instead wrap the list mapping items in keyed fragments and add the animation class to a surrounding `<div>` inside is not possible. Keep it simple: add `className`-free wrappers are unnecessary — apply the animation by adding the utility classes directly to the existing `<li>` in `ConfirmCard` and `SuggestedGroupCard`.

Concretely:
- In `web/components/capture/confirm-card.tsx`, change the root `<li className="rounded-lg border border-border px-3 py-2">` to append ` animate-in fade-in slide-in-from-top-1`.
- In `web/components/capture/suggested-group-card.tsx`, append the same classes to its root `<li>` (the non-split branch root and the split branch root).

Then `review-list.tsx`:

```tsx
"use client";

import { toast } from "sonner";
import {
  useReviewQueue, useResolveReview, useResolveGroup,
  type ReviewGroup, type ReviewItem,
} from "@/lib/api/review";
import { ConfirmCard } from "./confirm-card";
import { SuggestedGroupCard } from "./suggested-group-card";

export function ReviewList({ poll }: { poll: boolean }) {
  const queue = useReviewQueue({ poll });
  const resolve = useResolveReview();
  const resolveGroup = useResolveGroup();
  const groups: ReviewGroup[] = queue.data?.groups ?? [];
  const items: ReviewItem[] = queue.data?.items ?? [];

  async function act(documentId: string, action: "confirm" | "reject", data?: Record<string, unknown>) {
    try {
      await resolve.mutateAsync({ documentId, action, data });
      toast.success(action === "confirm" ? "Confirmed" : "Rejected");
    } catch {
      toast.error("Couldn't update that item");
    }
  }

  async function confirmGroup(memberIds: string[]) {
    try {
      await resolveGroup.mutateAsync({ memberDocumentIds: memberIds, action: "confirm" });
      toast.success("Merged receipt confirmed");
    } catch {
      toast.error("Couldn't merge those images");
    }
  }

  const empty = groups.length === 0 && items.length === 0;

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">Confirm to add</h2>
        <p className="text-sm text-muted">Detected items wait here until you confirm them as transactions.</p>
      </div>
      {empty ? (
        <p className="py-6 text-center text-sm text-muted">Nothing waiting to confirm.</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => (
            <SuggestedGroupCard
              key={group.member_document_ids.join("-")}
              group={group}
              pending={resolveGroup.isPending || resolve.isPending}
              onConfirm={confirmGroup}
              onSplitResolve={act}
            />
          ))}
          {items.map((item) => (
            <ConfirmCard
              key={item.document_id}
              item={item}
              pending={resolve.isPending}
              onResolve={(action, data) => act(item.document_id, action, data)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npx vitest run components/capture/__tests__/review-list.test.tsx`
Expected: PASS. Also run the existing card tests to confirm the `<li>` class change didn't break them:
`cd web && npx vitest run components/capture/confirm-card.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add web/components/capture/review-list.tsx web/components/capture/confirm-card.tsx web/components/capture/suggested-group-card.tsx web/components/capture/__tests__/review-list.test.tsx
git commit -m "feat(capture): always-visible animated review list"
```

---

### Task 9: `page.tsx` — two-column orchestrator wiring everything

**Files:**
- Modify: `web/app/(app)/capture/page.tsx` (rewrite; remove the now-extracted `UploadQueue`, `RecentActivity`, `ReviewQueueInline`, `statusLabel`, `ProcessingBadge`)
- Test: `web/app/(app)/capture/__tests__/capture-page.test.tsx` (extend existing test dir)

**Interfaces:**
- Consumes: `TypeSelector`, `captureTypeToDocType`, `CaptureType` (Task 3); `CaptureStats`, `computeCaptureStats` (Task 4); `UploadInfo` (Task 5); `UploadProgress` (Task 6); `ActivityList` (Task 7); `ReviewList` (Task 8); `enqueueCapture`/`flushQueue` with `groupHint` (Task 2); `useReviewQueue` count for waiting stat.
- Produces: the redesigned default-export `CapturePage`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const enqueueCapture = vi.fn(async () => ({}));
const flushQueue = vi.fn(async () => ({ synced: 1, failed: 0 }));

vi.mock("@/lib/offline/sync", () => ({
  enqueueCapture: (...a: unknown[]) => enqueueCapture(...a),
  flushQueue: () => flushQueue(),
  retryCapture: vi.fn(), removeCapture: vi.fn(),
}));
vi.mock("@/lib/offline/use-capture-queue", () => ({
  useCaptureQueue: () => ({ items: [], online: true }),
}));
vi.mock("@/lib/api/documents", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/documents")>()),
  useDocuments: () => ({ data: [] }),
}));
vi.mock("@/lib/api/review", () => ({
  useReviewQueue: () => ({ data: { groups: [], items: [] } }),
  useResolveReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResolveGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import CapturePage from "@/app/(app)/capture/page";

function renderPage() {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><CapturePage /></QueryClientProvider>);
}

describe("CapturePage", () => {
  it("uploads with the chosen type and one-receipt hint", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^receipt$/i }));
    fireEvent.click(screen.getByRole("switch", { name: /one receipt/i }));

    const input = screen.getByTestId("capture-file-input") as HTMLInputElement;
    const file = new File(["x"], "a.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(enqueueCapture).toHaveBeenCalled());
    const opts = enqueueCapture.mock.calls[0][1] as { docType?: string; groupHint?: string };
    expect(opts.docType).toBe("receipt");
    expect(opts.groupHint).toBe("single");
  });

  it("shows the info card and always-visible sections", () => {
    renderPage();
    expect(screen.getByText(/what you can upload/i)).toBeInTheDocument();
    expect(screen.getByText(/confirm to add/i)).toBeInTheDocument();
    expect(screen.getByText(/recent activity/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run "app/(app)/capture/__tests__/capture-page.test.tsx"`
Expected: FAIL — the page has no type chips / one-receipt switch / `capture-file-input` test id yet.

- [ ] **Step 3: Rewrite `page.tsx`**

Replace the file with the two-column orchestrator. Keep page-wide drag/drop, route spreadsheets to the CSV wizard, and pass `docType` + `groupHint` into `enqueueCapture`.

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, Layers, Loader2, Upload, Wifi } from "lucide-react";
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
import { UploadInfo } from "@/components/capture/upload-info";
import { UploadProgress } from "@/components/capture/upload-progress";
import { ActivityList } from "@/components/capture/activity-list";
import { ReviewList } from "@/components/capture/review-list";
import { classifyFile } from "./classify";

export default function CapturePage() {
  const { items, online } = useCaptureQueue();
  const qc = useQueryClient();
  const docs = useDocuments();
  const pending = documentsPending(docs.data);
  const review = useReviewQueue({ poll: pending });
  const waiting =
    (review.data?.groups?.length ?? 0) + (review.data?.items?.length ?? 0);
  const stats = computeCaptureStats(docs.data ?? [], waiting);

  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sheets, setSheets] = useState<File[]>([]);
  const [docType, setDocType] = useState<CaptureType>("auto");
  const [oneReceipt, setOneReceipt] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  const refreshFeeds = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["documents"] });
    qc.invalidateQueries({ queryKey: ["review-queue"] });
  }, [qc]);

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

  return (
    <div className="relative space-y-4">
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-accent/10 backdrop-blur-sm">
          <div className="rounded-card-sm border-2 border-dashed border-accent bg-card px-8 py-6 text-center shadow-card">
            <Upload className="mx-auto size-8 text-accent" />
            <p className="mt-2 text-sm font-semibold">Drop to add — we&rsquo;ll detect the type</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-bold tracking-tight">Add anything</h1>
        <div className="flex items-center gap-3">
          <CaptureStats
            waiting={stats.waiting}
            addedThisWeek={stats.addedThisWeek}
            failed={stats.failed}
            onWaitingClick={() => confirmRef.current?.scrollIntoView({ behavior: "smooth" })}
          />
          <Badge variant={online ? "success" : "warning"}>
            {online ? <Wifi className="size-3.5" /> : <CloudOff className="size-3.5" />}
            {online ? "Online" : "Offline — queuing"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left rail — the "do" side */}
        <div className="space-y-4">
          <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
            <p className="mb-2 text-xs font-semibold text-muted">Document type</p>
            <TypeSelector value={docType} onChange={setDocType} />

            <div className="mt-4 rounded-card-sm border border-dashed border-border p-6 text-center">
              <Upload className="mx-auto size-7 text-muted" />
              <p className="mt-2 text-sm font-semibold">Drag &amp; drop receipts, PDFs, CSV or XLSX</p>
              <p className="text-xs text-muted">
                {docType === "auto" ? "We auto-detect what each file is." : `Uploading as ${docType}.`}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload files
                </Button>
                <ManualTransactionEntry />
              </div>
              <input
                ref={fileRef}
                data-testid="capture-file-input"
                type="file"
                accept="image/*,application/pdf,.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                multiple
                className="hidden"
                onChange={(e) => { void ingest(Array.from(e.target.files ?? [])); }}
              />
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <button
                type="button"
                role="switch"
                aria-checked={oneReceipt}
                aria-label="These are one receipt"
                onClick={() => setOneReceipt((v) => !v)}
                className={
                  "relative h-5 w-9 rounded-full transition-colors " +
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
                <Layers className="size-4 text-muted" /> These files are one receipt
              </span>
            </label>
            <p className="mt-1 text-xs text-muted">
              Turn on when one receipt is split across several photos or pages.
            </p>
          </div>

          {/* Grouping guidance */}
          <div className="rounded-card-sm border border-accent/40 bg-accent/5 p-4 text-sm">
            <p className="font-semibold">A quick tip</p>
            <p className="mt-1 text-muted">
              Uploading one receipt split across several images? Drop them together and we&rsquo;ll
              merge them into one transaction. Uploading different purchases? Those can go in the
              same drop too — we keep them separate. For best results, add one transaction-event at
              a time so nothing gets mixed up.
            </p>
          </div>

          <UploadInfo />
        </div>

        {/* Right column — the "watch" side */}
        <div className="space-y-4">
          <UploadProgress items={items} />
          <div ref={confirmRef}>
            <ReviewList poll={pending} />
          </div>
          <ActivityList />
        </div>
      </div>

      {sheets.length > 0 && (
        <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
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
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npx vitest run "app/(app)/capture/__tests__/capture-page.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Typecheck + full capture test sweep**

Run:
```bash
cd web && npx tsc --noEmit && npx vitest run components/capture app/\(app\)/capture lib/offline
```
Expected: no type errors; all capture/offline tests pass.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/capture/page.tsx" "web/app/(app)/capture/__tests__/capture-page.test.tsx"
git commit -m "feat(capture): two-column add page wiring type, toggle, live sections"
```

---

## Self-Review

**Spec coverage:**
- Type picker (Auto-detect default, per-batch) → Tasks 3, 9. ✓
- "These are one receipt" toggle (forced merge) → Tasks 1, 2, 9. ✓
- Grouping guidance / tip → Task 9. ✓
- Info section "what you can upload" + privacy → Task 5, 9. ✓
- Summary stat strip → Tasks 4, 9. ✓
- Per-file upload progress → Task 6, 9. ✓
- Review: optimistic+live, motion, inline, always-visible → Task 8 (motion + always-visible; inline actions already exist; live via `poll`). ✓
- Recent: filter/search + motion + always-visible → Task 7. ✓
- Two-column responsive layout → Task 9. ✓
- CSV/XLSX always to wizard → Task 9 (`classifyFile` + `captureTypeToDocType` returns undefined for spreadsheet). ✓
- Motion = CSS only, reduced-motion respected for fades not layout → uses `animate-in` utilities (tailwindcss-animate). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `CaptureType`, `captureTypeToDocType`, `computeCaptureStats`, `filterDocuments`, `fileStateLabel`, `UploadProgress`, `ActivityList`, `ReviewList` names match between producing and consuming tasks. ✓

**Note for executor:** "Optimistic" review/recent is delivered via existing polling + motion on entry; if true pre-server optimistic placeholders are wanted later, that's a follow-up (not in these tasks). The `useReviewQueue({ poll })` signature is taken from the current `page.tsx`; confirm it accepts `{ poll }` (it does today) before Task 9.
