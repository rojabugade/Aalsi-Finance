# Universal Add + Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single universal `/capture` ingest page (drag-drop anywhere, multi-upload, auto-detect-first, inline review queue, sidebar entry, manual-entry fallback), XLSX ingestion, a real Plaid Link flow, and a read-only Splitwise connection.

**Architecture:** Frontend is Next.js (App Router) + React Query + Tailwind; API hooks live in `web/lib/api/*`, typed against `shared/api-schema.ts` (generated from the backend OpenAPI). Backend is FastAPI; ingestion integrations live in `backend/app/ingestion/` and follow a uniform `IntegrationUnavailable`-when-unconfigured gateway pattern. New endpoints reuse existing `PlaidItem` / `IngestionConnection` models and household scoping.

**Tech Stack:** Next.js, React 19, @tanstack/react-query, vitest + @testing-library/react, FastAPI, SQLAlchemy async, pytest + pytest-asyncio, plaid-python, openpyxl, react-plaid-link.

## Global Constraints

- Web tests: `cd web && npx vitest run` — the existing suite (245 tests) MUST stay green.
- Backend tests: `cd backend && uv run --no-project pytest -q` (needs Postgres at `postgresql+asyncpg://finance:finance@localhost:5433/finance`; tests `pytest.skip` when absent). If the local venv is broken, run pytest inside the `api` container instead.
- Types are generated: after ANY backend schema change, regenerate `shared/api-schema.ts` with the API running via `cd web && npm run gen:api` (hits `http://localhost:8000/openapi.json`). Never hand-edit `shared/api-schema.ts`.
- All new backend endpoints use `require_role("owner", "member")` and household/user scoping, matching `backend/app/ingestion/router.py`.
- Gateways raise `IntegrationUnavailable` when credentials are unset so the UI degrades gracefully.
- Money fields cross the wire as strings (openapi-typescript renders `Decimal` as `string`).
- Follow existing file conventions: API hooks use the `unwrap()` helper + `useMutation`/`useQuery`; dialogs follow the `NewBudgetDialog` pattern in `web/app/(app)/budgets/page.tsx`.

---

## Phase 1 — Universal Add page + nav + manual transaction

### Task 1: `useCreateTransaction` hook

**Files:**
- Modify: `web/lib/api/transactions.ts` (append a hook; add type alias near the top alongside `TransactionPatch`)
- Test: `web/lib/api/transactions.create.test.ts` (create)

**Interfaces:**
- Consumes: existing `unwrap`, `api`, `KEY` from `transactions.ts`; type `components["schemas"]["TransactionCreate"]`.
- Produces: `useCreateTransaction()` → React Query mutation; `mutateAsync(body: TransactionCreate)` returns the created `Transaction`. Type alias `TransactionCreate = components["schemas"]["TransactionCreate"]`.

- [ ] **Step 1: Write the failing test**

`web/lib/api/transactions.create.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const post = vi.fn(async () => ({ data: { id: "t1", merchant: "Cafe" }, error: undefined }));
const invalidate = vi.fn();
vi.mock("./client", () => ({ api: { POST: (...a: unknown[]) => post(...a) } }));
vi.mock("@tanstack/react-query", async (orig) => {
  const mod = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...mod, useQueryClient: () => ({ invalidateQueries: invalidate }) };
});

import { useCreateTransaction } from "./transactions";

describe("useCreateTransaction", () => {
  beforeEach(() => { post.mockClear(); invalidate.mockClear(); });

  it("posts to /transactions and invalidates the transactions key", async () => {
    const { mutationFn, onSuccess } = useCreateTransaction() as unknown as {
      mutationFn: (b: unknown) => Promise<unknown>;
      onSuccess: () => void;
    };
    const body = { merchant: "Cafe", amount: "4.50", currency: "USD", txn_date: "2026-06-22" };
    const result = await mutationFn(body);
    expect(post).toHaveBeenCalledWith("/transactions", { body });
    expect(result).toEqual({ id: "t1", merchant: "Cafe" });
    onSuccess();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["transactions"] });
  });
});
```

> Note: this test calls the hook outside a React render and reads `mutationFn`/`onSuccess` off the returned options object. That works because `useMutation` returns an object carrying these through in this version; if `useMutation` does not expose them, fall back to mocking `useMutation` to return its argument: add `useMutation: (opts: unknown) => opts` to the react-query mock and call `useCreateTransaction()` to get `{ mutationFn, onSuccess }`. Prefer the mock-`useMutation` form for stability.

Use the mock-`useMutation` form. Final react-query mock:

```ts
vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: unknown) => opts,
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/api/transactions.create.test.ts`
Expected: FAIL — `useCreateTransaction is not exported`.

- [ ] **Step 3: Write minimal implementation**

Add near the top type aliases in `web/lib/api/transactions.ts`:

```ts
export type TransactionCreate = components["schemas"]["TransactionCreate"];
```

Append at the end of `web/lib/api/transactions.ts`:

```ts
export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransactionCreate) => unwrap(api.POST("/transactions", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/api/transactions.create.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/api/transactions.ts web/lib/api/transactions.create.test.ts
git commit -m "feat(web): add useCreateTransaction hook for manual entry"
```

---

### Task 2: Manual transaction entry form

**Files:**
- Create: `web/components/capture/manual-transaction-entry.tsx`
- Test: `web/components/capture/manual-transaction-entry.test.tsx`

**Interfaces:**
- Consumes: `useCreateTransaction` (Task 1), `useCategories`, `usePaymentMethods` (`web/lib/api/widget-data.ts`), `Dialog*` from `@/components/ui/dialog`, `Button`, `Input`, `Label`, `toast`.
- Produces: `<ManualTransactionEntry />` — a button that opens a dialog; on submit posts a draft transaction and closes. Default export not used; named export `ManualTransactionEntry`.

- [ ] **Step 1: Write the failing test**

`web/components/capture/manual-transaction-entry.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn(async () => ({ id: "t1" }));
vi.mock("@/lib/api/transactions", () => ({
  useCreateTransaction: () => ({ mutateAsync, isPending: false }),
  useCategories: () => ({ data: [{ id: "c1", name: "Dining" }] }),
}));
vi.mock("@/lib/api/widget-data", () => ({
  usePaymentMethods: () => ({ data: [{ id: "p1", name: "Visa" }] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ManualTransactionEntry } from "./manual-transaction-entry";

afterEach(() => mutateAsync.mockClear());

describe("ManualTransactionEntry", () => {
  it("submits a draft transaction with amount, currency and date", async () => {
    render(<ManualTransactionEntry />);
    fireEvent.click(screen.getByRole("button", { name: /enter manually/i }));
    fireEvent.change(screen.getByLabelText(/merchant/i), { target: { value: "Cafe" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "4.50" } });
    fireEvent.change(screen.getByLabelText(/^date$/i), { target: { value: "2026-06-22" } });
    fireEvent.submit(screen.getByTestId("manual-tx-form"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const body = mutateAsync.mock.calls[0][0];
    expect(body).toMatchObject({
      merchant: "Cafe", amount: "4.50", txn_date: "2026-06-22",
      currency: "USD", source_channel: "manual", status: "draft",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/capture/manual-transaction-entry.test.tsx`
Expected: FAIL — cannot resolve `./manual-transaction-entry`.

- [ ] **Step 3: Write minimal implementation**

`web/components/capture/manual-transaction-entry.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCreateTransaction, useCategories } from "@/lib/api/transactions";
import { usePaymentMethods } from "@/lib/api/widget-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function ManualTransactionEntry() {
  const [open, setOpen] = useState(false);
  const categories = useCategories();
  const methods = usePaymentMethods();
  const create = useCreateTransaction();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const categoryId = String(f.get("category_id") ?? "");
    const methodId = String(f.get("payment_method_id") ?? "");
    try {
      await create.mutateAsync({
        merchant: String(f.get("merchant") ?? "") || null,
        amount: String(f.get("amount") ?? "0"),
        currency: String(f.get("currency") ?? "USD") || "USD",
        txn_date: String(f.get("txn_date") ?? ""),
        category_id: categoryId || null,
        payment_method_id: methodId || null,
        notes: String(f.get("notes") ?? "") || null,
        source_channel: "manual",
        status: "draft",
      });
      toast.success("Transaction added");
      setOpen(false);
    } catch {
      toast.error("Couldn't add that transaction");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Enter manually</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add transaction manually</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} data-testid="manual-tx-form" className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="merchant">Merchant</Label>
            <Input id="merchant" name="merchant" placeholder="Where did you spend?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" type="number" step="0.01" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" defaultValue="USD" maxLength={3} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="txn_date">Date</Label>
            <Input id="txn_date" name="txn_date" type="date" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="category_id">Category</Label>
            <select id="category_id" name="category_id" className={SELECT_CLASS} defaultValue="">
              <option value="">No category</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="payment_method_id">Payment method</Label>
            <select id="payment_method_id" name="payment_method_id" className={SELECT_CLASS} defaultValue="">
              <option value="">Unspecified</option>
              {(methods.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="Optional" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving..." : "Add transaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

> Verify the `Label` import path matches the budgets page (`@/components/ui/label`). If `usePaymentMethods` is not exported from `widget-data.ts`, it is (see `web/lib/api/widget-data.ts:30`). The `<Input type="date">` `aria`-label is its `<Label htmlFor>`; the test regex `/^date$/i` matches "Date".

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/capture/manual-transaction-entry.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/capture/manual-transaction-entry.tsx web/components/capture/manual-transaction-entry.test.tsx
git commit -m "feat(web): manual transaction entry dialog"
```

---

### Task 3: Nav — single Add action + sidebar entry

**Files:**
- Modify: `web/lib/shell/nav.ts` (remove `ADD_ACTIONS` + its `AddAction` type usage; add an `ADD_NAV` entry)
- Modify: `web/components/shell/add-menu.tsx` (dropdown → single link button)
- Modify: `web/components/shell/desktop-rail.tsx` (render Add at top of nav)
- Modify: `web/components/shell/drawer.tsx` (render Add at top of items)
- Test: `web/lib/shell/nav.test.ts` (create)

**Interfaces:**
- Consumes: `Plus` from `@/lib/icons`.
- Produces: `ADD_NAV = { key: "add", label: "Add", href: "/capture", icon: Plus }` exported from `nav.ts`. `add-menu.tsx` exports `AddMenu` as a single `<Link href="/capture">` styled button.

- [ ] **Step 1: Write the failing test**

`web/lib/shell/nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ADD_NAV, surfaceTitle } from "./nav";

describe("ADD_NAV", () => {
  it("points the universal Add entry at /capture", () => {
    expect(ADD_NAV.href).toBe("/capture");
    expect(ADD_NAV.label).toBe("Add");
  });
  it("keeps the capture surface titled", () => {
    expect(surfaceTitle("/capture")).toBe("Capture");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/shell/nav.test.ts`
Expected: FAIL — `ADD_NAV` not exported.

- [ ] **Step 3: Write minimal implementation**

In `web/lib/shell/nav.ts`:
1. Delete the `ADD_ACTIONS` array and the `AddAction` type (and the now-unused `Camera`, `FileText`, `PenLine` icon imports IF unused elsewhere in the file — `Camera`/`FileText` are still used by `DRAWER_ITEMS`? check; remove only genuinely-unused imports).
2. Add `Plus` to the `@/lib/icons` import.
3. Add:

```ts
export const ADD_NAV = { key: "add", label: "Add", href: "/capture", icon: Plus } as const;
```

In `web/components/shell/add-menu.tsx`, replace the whole file with a single styled link:

```tsx
"use client";

import Link from "next/link";
import { Plus } from "@/lib/icons";

export function AddMenu() {
  return (
    <Link
      href="/capture"
      className="inline-flex items-center gap-1.5 rounded-chip bg-accent px-3.5 py-2 text-sm font-semibold text-on-accent transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Plus className="size-4" /> Add
    </Link>
  );
}
```

In `web/components/shell/desktop-rail.tsx`, import `ADD_NAV` and render it as the first `RailLink` inside the `<nav>` (above `BOTTOM_TABS.map`):

```tsx
import { ADD_NAV, BOTTOM_TABS, DRAWER_ITEMS, activeBottomKey } from "@/lib/shell/nav";
```
```tsx
<nav className="flex-1 space-y-0.5 overflow-y-auto" aria-label="Primary">
  <RailLink href={ADD_NAV.href} label={ADD_NAV.label} Icon={ADD_NAV.icon} active={isActive(ADD_NAV.href)} collapsed={collapsed} />
  <div className="my-2 border-t border-border" />
  {BOTTOM_TABS.map(/* unchanged */)}
```

In `web/components/shell/drawer.tsx`, import `ADD_NAV` and render an Add link as the first item before the `DRAWER_ITEMS` loop (match the existing item markup/class names in that file).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/shell/nav.test.ts`
Expected: PASS.
Run: `cd web && npx vitest run` (full suite — confirm removing `ADD_ACTIONS` broke nothing; if `add-menu` had a test, update it).
Expected: PASS (245+ tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/shell/nav.ts web/lib/shell/nav.test.ts web/components/shell/add-menu.tsx web/components/shell/desktop-rail.tsx web/components/shell/drawer.tsx
git commit -m "feat(web): single universal Add action + sidebar entry"
```

---

### Task 4: Rebuild the capture page (universal ingest surface)

**Files:**
- Modify: `web/app/(app)/capture/page.tsx` (full rebuild)
- Test: `web/app/(app)/capture/page.test.tsx` (create)

**Interfaces:**
- Consumes: `useCaptureQueue` + `enqueueCapture`/`flushQueue`/`retryCapture`/`removeCapture` (`@/lib/offline/*`), `CsvWizard` (`@/components/capture/csv-wizard`), `ManualTransactionEntry` (Task 2), `useReviewQueue`/`useResolveReview` (`@/lib/api/review`), `toast`.
- Produces: default-export `CapturePage` rendering one surface: a page-wide dropzone, an Upload button (multi-file), the upload queue, an embedded review queue, and the manual-entry trigger. A helper `classifyFile(file: File): "doc" | "spreadsheet"` is exported for the unit test.

- [ ] **Step 1: Write the failing test**

`web/app/(app)/capture/page.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/use-capture-queue", () => ({
  useCaptureQueue: () => ({ items: [], online: true }),
}));
vi.mock("@/lib/offline/sync", () => ({
  enqueueCapture: vi.fn(), flushQueue: vi.fn(async () => ({ synced: 0, failed: 0 })),
  retryCapture: vi.fn(), removeCapture: vi.fn(),
}));
vi.mock("@/lib/api/review", () => ({
  useReviewQueue: () => ({ data: [] }), useResolveReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { classifyFile } from "./page";

describe("classifyFile", () => {
  it("routes spreadsheets to the wizard", () => {
    expect(classifyFile(new File([""], "stmt.csv", { type: "text/csv" }))).toBe("spreadsheet");
    expect(classifyFile(new File([""], "stmt.xlsx"))).toBe("spreadsheet");
  });
  it("routes images and pdfs to document upload", () => {
    expect(classifyFile(new File([""], "r.jpg", { type: "image/jpeg" }))).toBe("doc");
    expect(classifyFile(new File([""], "r.pdf", { type: "application/pdf" }))).toBe("doc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/\(app\)/capture/page.test.tsx`
Expected: FAIL — `classifyFile` not exported.

- [ ] **Step 3: Write minimal implementation**

Rebuild `web/app/(app)/capture/page.tsx`. Keep the existing `OnlinePill` + upload-queue list markup from the current file (lines 68–76 and 174–242 are good references — reuse them). Replace the tabbed shell with one surface. Add the page-wide dropzone via window listeners and the `classifyFile` helper.

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CloudOff, Loader2, RefreshCw, Trash2, Upload, Wifi } from "lucide-react";
import { toast } from "sonner";

import { enqueueCapture, flushQueue, removeCapture, retryCapture } from "@/lib/offline/sync";
import { useCaptureQueue } from "@/lib/offline/use-capture-queue";
import { useReviewQueue, useResolveReview } from "@/lib/api/review";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CsvWizard } from "@/components/capture/csv-wizard";
import { ManualTransactionEntry } from "@/components/capture/manual-transaction-entry";

const SPREADSHEET_EXT = /\.(csv|xlsx)$/i;
const SPREADSHEET_MIME = new Set([
  "text/csv", "application/csv", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** Decide whether a dropped/picked file goes to the document pipeline or the mapping wizard. */
export function classifyFile(file: File): "doc" | "spreadsheet" {
  if (SPREADSHEET_MIME.has(file.type) || SPREADSHEET_EXT.test(file.name)) return "spreadsheet";
  return "doc";
}

export default function CapturePage() {
  const { items, online } = useCaptureQueue();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [spreadsheet, setSpreadsheet] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ingest = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const sheets = files.filter((f) => classifyFile(f) === "spreadsheet");
    const docs = files.filter((f) => classifyFile(f) === "doc");
    if (sheets.length > 0) setSpreadsheet(sheets[0]); // wizard handles one at a time
    if (docs.length === 0) return;
    setBusy(true);
    try {
      for (const file of docs) {
        await enqueueCapture(file, { filename: file.name }); // no docType → auto-detect
      }
      const { synced, failed } = await flushQueue();
      if (synced > 0) toast.success(`Uploaded ${synced} document${synced > 1 ? "s" : ""}`);
      if (failed > 0 && synced === 0) toast.message("Queued — will sync when connected");
    } catch {
      toast.error("Couldn't queue those files");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, []);

  // Page-wide drag-and-drop: dropping anywhere on the window ingests.
  useEffect(() => {
    const onOver = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer?.types?.includes("Files")) setDragging(true); };
    const onLeave = (e: DragEvent) => { if (e.relatedTarget === null) setDragging(false); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      void ingest(dropped);
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
            <p className="mt-2 text-sm font-semibold">Drop to add — we’ll detect the type</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold tracking-tight">Add anything</h1>
        <Badge variant={online ? "success" : "warning"}>
          {online ? <Wifi className="size-3.5" /> : <CloudOff className="size-3.5" />}
          {online ? "Online" : "Offline — queuing"}
        </Badge>
      </div>

      {/* One ingest surface */}
      <div className="rounded-card-sm border border-dashed border-border bg-card p-8 text-center shadow-card">
        <Upload className="mx-auto size-7 text-muted" />
        <p className="mt-2 text-sm font-semibold">Drag &amp; drop receipts, PDFs, CSV or XLSX anywhere</p>
        <p className="text-xs text-muted">We auto-detect what each file is. You don’t pick a type.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload files
          </Button>
          <ManualTransactionEntry />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          className="hidden"
          onChange={(e) => { void ingest(Array.from(e.target.files ?? [])); }}
        />
      </div>

      {spreadsheet && (
        <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold tracking-tight">Map “{spreadsheet.name}”</h2>
            <Button variant="ghost" size="sm" onClick={() => setSpreadsheet(null)}>Dismiss</Button>
          </div>
          <CsvWizard initialFile={spreadsheet} />
        </div>
      )}

      <UploadQueue items={items} />
      <ReviewQueueInline />
    </div>
  );
}
```

Add `UploadQueue` (port the existing queue list from the current file — the `<ul>` with retry/remove buttons, taking `items` as a prop) and `ReviewQueueInline` (uses `useReviewQueue`/`useResolveReview`, renders each item with Confirm/Reject calling `mutateAsync({ documentId, action })`; empty state "Nothing needs review."). Keep both small and in this file.

> `CsvWizard` currently takes no props. Add an **optional** `initialFile?: File` prop to it in Task 6; until then the `initialFile={spreadsheet}` prop is ignored harmlessly (extra props on a component are dropped). Wiring it is Task 6.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run app/\(app\)/capture/page.test.tsx`
Expected: PASS.
Run: `cd web && npx vitest run` — full suite green.

- [ ] **Step 5: Manual smoke + commit**

Manual: `cd web && npm run dev`, open `/capture`, drag a PNG onto the page → it queues/uploads; drop a CSV → wizard appears; "Enter manually" → form submits. Confirm `/capture` shows in the sidebar.

```bash
git add web/app/\(app\)/capture/page.tsx web/app/\(app\)/capture/page.test.tsx
git commit -m "feat(web): rebuild capture as a universal drag-drop ingest page"
```

---

## Phase 2 — XLSX ingestion (backend + wizard)

### Task 5: Backend detects and parses XLSX

**Files:**
- Modify: `backend/app/documents/processing.py` (`detect_kind` + add `xlsx_to_rows`)
- Modify: `backend/pyproject.toml` (add `openpyxl`)
- Test: `backend/tests/test_xlsx_ingest.py` (create)

**Interfaces:**
- Consumes: existing `detect_kind`, `UnsupportedFile`.
- Produces: `detect_kind(...)` returns `"csv"` for `.xlsx` uploads (so the existing CSV branch handles them); new `xlsx_to_rows(data: bytes) -> list[list[str]]` returning the first worksheet's rows as strings.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_xlsx_ingest.py`:

```python
import io
import openpyxl
from app.documents.processing import detect_kind, xlsx_to_rows

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx_bytes() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["date", "merchant", "amount"])
    ws.append(["2026-06-01", "Cafe", 4.5])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_detect_kind_classifies_xlsx_as_csv_branch():
    data = _xlsx_bytes()
    assert detect_kind("statement.xlsx", XLSX_MIME, data) == "csv"


def test_xlsx_to_rows_reads_first_sheet():
    rows = xlsx_to_rows(_xlsx_bytes())
    assert rows[0] == ["date", "merchant", "amount"]
    assert rows[1] == ["2026-06-01", "Cafe", "4.5"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run --no-project pytest tests/test_xlsx_ingest.py -q`
Expected: FAIL — `openpyxl` import error or `xlsx_to_rows` undefined.

- [ ] **Step 3: Write minimal implementation**

Add `openpyxl` to `backend/pyproject.toml` dependencies, then `uv sync` (or rebuild the api image).

In `backend/app/documents/processing.py`:

```python
XLSX_TYPES = {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
XLSX_EXTS = {".xlsx"}
```

In `detect_kind`, before the final `raise UnsupportedFile`, add (XLSX files are ZIP archives starting with `PK\x03\x04`; trust extension/mime then magic bytes):

```python
    if ct in XLSX_TYPES or ext in XLSX_EXTS or (len(data) >= 4 and data[:4] == b"PK\x03\x04" and ext in XLSX_EXTS):
        return "csv"
```

Add a parser:

```python
def xlsx_to_rows(data: bytes) -> list[list[str]]:
    """Read the first worksheet of an .xlsx into rows of strings."""
    import io
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows: list[list[str]] = []
    for row in ws.iter_rows(values_only=True):
        rows.append(["" if c is None else str(c) for c in row])
    wb.close()
    return rows
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run --no-project pytest tests/test_xlsx_ingest.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/documents/processing.py backend/pyproject.toml backend/uv.lock backend/tests/test_xlsx_ingest.py
git commit -m "feat(api): detect and parse .xlsx uploads into the CSV mapping flow"
```

---

### Task 6: CsvWizard accepts XLSX (frontend)

**Files:**
- Modify: `web/components/capture/csv-wizard.tsx` (add optional `initialFile?: File`; accept `.xlsx` in its own file input; parse client-side)
- Test: `web/components/capture/csv-wizard.xlsx.test.tsx` (create) — unit-test the row-extraction helper.

**Interfaces:**
- Consumes: a SheetJS-style parser. Use the lightweight, already-available approach: if the file is `.xlsx`, parse with the browser-friendly `xlsx` package (add dep) OR send the raw file to `POST /documents` and let the backend wizard map it. **Chosen approach:** send xlsx/csv files through the same `POST /documents` upload (auto-detect) — the wizard's job becomes column-mapping confirmation on the server-stored doc. To keep scope tight here, the wizard's client only needs to (a) accept `.xlsx` in its file input and (b) read CSV text as today; for XLSX it hands the file to `enqueueCapture` (document pipeline) and shows "spreadsheet queued for mapping".

Given that, the wizard change is minimal: widen the accept attr and branch on extension.

- [ ] **Step 1: Write the failing test**

`web/components/capture/csv-wizard.xlsx.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { isSpreadsheetFile } from "./csv-wizard";

describe("isSpreadsheetFile", () => {
  it("accepts csv and xlsx", () => {
    expect(isSpreadsheetFile(new File([""], "a.csv"))).toBe(true);
    expect(isSpreadsheetFile(new File([""], "a.xlsx"))).toBe(true);
    expect(isSpreadsheetFile(new File([""], "a.png"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/capture/csv-wizard.xlsx.test.tsx`
Expected: FAIL — `isSpreadsheetFile` not exported.

- [ ] **Step 3: Write minimal implementation**

In `web/components/capture/csv-wizard.tsx`:
1. Add and export:

```ts
export function isSpreadsheetFile(file: File): boolean {
  return /\.(csv|xlsx)$/i.test(file.name);
}
```

2. Add an optional prop `initialFile?: File` to the component signature; if present, preload it into the wizard's file state on mount (`useEffect(() => { if (initialFile) handleFile(initialFile); }, [initialFile])`).
3. Widen the file input `accept` to include `.xlsx` and the XLSX mime.
4. For an `.xlsx` selection, route to the document upload path (`enqueueCapture(file, { filename: file.name })`) and show a "Spreadsheet uploaded — map columns once it’s processed" notice, since server-side parsing (Task 5) now produces rows for the mapping flow. CSV continues to parse inline as today.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run components/capture/csv-wizard.xlsx.test.tsx`
Expected: PASS.
Run: `cd web && npx vitest run` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add web/components/capture/csv-wizard.tsx web/components/capture/csv-wizard.xlsx.test.tsx
git commit -m "feat(web): CsvWizard accepts xlsx and an initial file"
```

---

## Phase 3 — Plaid Link

### Task 7: Plaid exchange + sync hooks

**Files:**
- Modify: `web/lib/api/connections.ts` (add `useExchangePlaidToken`, `useSyncPlaid`, types)
- Test: `web/lib/api/connections.plaid.test.ts` (create)

**Interfaces:**
- Consumes: existing `unwrap`, `api`.
- Produces:
  - `useExchangePlaidToken()` → `mutateAsync({ public_token, institution_name?, accounts? })` → `PlaidExchangeOut`.
  - `useSyncPlaid()` → `mutateAsync({ plaid_item_id? }?)` → `PlaidSyncOut`.
  - Types `PlaidExchange = components["schemas"]["PlaidExchangeIn"]`, `PlaidSyncOut = components["schemas"]["PlaidSyncOut"]`.

- [ ] **Step 1: Write the failing test**

`web/lib/api/connections.plaid.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const post = vi.fn(async () => ({ data: { plaid_item_id: "i1", accounts_created: 2, status: "active" }, error: undefined }));
vi.mock("./client", () => ({ api: { POST: (...a: unknown[]) => post(...a) } }));
vi.mock("@tanstack/react-query", () => ({ useMutation: (opts: unknown) => opts }));

import { useExchangePlaidToken, useSyncPlaid } from "./connections";

describe("plaid hooks", () => {
  beforeEach(() => post.mockClear());
  it("exchange posts the public token", async () => {
    const { mutationFn } = useExchangePlaidToken() as unknown as { mutationFn: (b: unknown) => Promise<unknown> };
    await mutationFn({ public_token: "pt", institution_name: "Chase", accounts: [] });
    expect(post).toHaveBeenCalledWith("/plaid/exchange", { body: { public_token: "pt", institution_name: "Chase", accounts: [] } });
  });
  it("sync posts an optional item id", async () => {
    const { mutationFn } = useSyncPlaid() as unknown as { mutationFn: (b?: unknown) => Promise<unknown> };
    await mutationFn({ plaid_item_id: "i1" });
    expect(post).toHaveBeenCalledWith("/plaid/sync", { body: { plaid_item_id: "i1" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/api/connections.plaid.test.ts`
Expected: FAIL — hooks not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `web/lib/api/connections.ts`:

```ts
export type PlaidExchange = components["schemas"]["PlaidExchangeIn"];
export type PlaidExchangeOut = components["schemas"]["PlaidExchangeOut"];
export type PlaidSyncOut = components["schemas"]["PlaidSyncOut"];

export function useExchangePlaidToken() {
  return useMutation({
    mutationFn: (body: PlaidExchange) => unwrap(api.POST("/plaid/exchange", { body })),
  });
}

export function useSyncPlaid() {
  return useMutation({
    mutationFn: (body: { plaid_item_id?: string | null } = {}) =>
      unwrap(api.POST("/plaid/sync", { body })),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/api/connections.plaid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/api/connections.ts web/lib/api/connections.plaid.test.ts
git commit -m "feat(web): plaid exchange + sync hooks"
```

---

### Task 8: Backend `GET /plaid/items`

**Files:**
- Modify: `backend/app/ingestion/schemas.py` (add `PlaidItemOut`)
- Modify: `backend/app/ingestion/service.py` (add `list_plaid_items`)
- Modify: `backend/app/ingestion/router.py` (add `GET /plaid/items`)
- Test: `backend/tests/test_plaid_items.py` (create)

**Interfaces:**
- Consumes: `PlaidItem`, `AccountLogical` models; `select`.
- Produces:
  - `PlaidItemOut(BaseModel)`: `id: uuid.UUID`, `institution_name: str | None`, `account_count: int`, `status: str`, `sync_cursor: str | None`.
  - `service.list_plaid_items(session, user) -> list[dict]`.
  - `GET /plaid/items` → `list[PlaidItemOut]`, role-guarded, household-scoped.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_plaid_items.py` (mirror the `test_m11_ingestion.py` fixtures — copy the `engine`/`session`/`_user` fixtures and `FakePlaid`):

```python
import pytest
from app.ingestion.schemas import PlaidExchangeIn
from app.ingestion.service import plaid_exchange, list_plaid_items
# ... copy engine/session/_user fixtures + FakePlaid from test_m11_ingestion.py ...

@pytest.mark.asyncio
async def test_list_plaid_items_returns_connected(session):
    user = await _user(session)
    await plaid_exchange(session, user, PlaidExchangeIn(public_token="pt", institution_name="Chase", accounts=[{"name": "Checking", "account_id": "a1", "type": "depository"}]), FakePlaid())
    items = await list_plaid_items(session, user)
    assert len(items) == 1
    assert items[0]["institution_name"] == "Chase"
    assert items[0]["account_count"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run --no-project pytest tests/test_plaid_items.py -q`
Expected: FAIL — `list_plaid_items` undefined (skips if no Postgres).

- [ ] **Step 3: Write minimal implementation**

In `backend/app/ingestion/schemas.py`:

```python
class PlaidItemOut(BaseModel):
    id: uuid.UUID
    institution_name: str | None = None
    account_count: int = 0
    status: str
    sync_cursor: str | None = None
```
(Add `import uuid` if not present.)

In `backend/app/ingestion/service.py`:

```python
from sqlalchemy import func  # add to imports if missing

async def list_plaid_items(session: AsyncSession, user: User) -> list[dict]:
    items = list((await session.execute(
        select(PlaidItem).where(PlaidItem.household_id == user.household_id, PlaidItem.status == "active")
    )).scalars().all())
    out = []
    for item in items:
        count = (await session.execute(
            select(func.count()).select_from(AccountLogical).where(AccountLogical.plaid_item_id == item.id)
        )).scalar_one()
        out.append({
            "id": item.id,
            "institution_name": item.institution_name,
            "account_count": int(count),
            "status": item.status,
            "sync_cursor": item.sync_cursor,
        })
    return out
```

In `backend/app/ingestion/router.py` (add `PlaidItemOut` to the schema import, and):

```python
@router.get("/plaid/items", response_model=list[PlaidItemOut])
async def plaid_items(user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    return await service.list_plaid_items(session, user)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run --no-project pytest tests/test_plaid_items.py -q`
Expected: PASS (or skip if no Postgres — then verify against the api container).

- [ ] **Step 5: Regenerate types + commit**

With the API running: `cd web && npm run gen:api` (updates `shared/api-schema.ts` with `PlaidItemOut`).

```bash
git add backend/app/ingestion/schemas.py backend/app/ingestion/service.py backend/app/ingestion/router.py backend/tests/test_plaid_items.py shared/api-schema.ts shared/openapi.json
git commit -m "feat(api): GET /plaid/items lists connected institutions"
```

---

### Task 9: `usePlaidItems` hook

**Files:**
- Modify: `web/lib/api/connections.ts` (add query hook + invalidation keys)
- Test: `web/lib/api/connections.items.test.ts` (create)

**Interfaces:**
- Produces: `usePlaidItems()` → `useQuery` for `GET /plaid/items`, queryKey `["plaid-items"]`; type `PlaidItem = components["schemas"]["PlaidItemOut"]`. Also add a `useDisconnectPlaidItem()` → `DELETE /plaid/items/{item_id}` mutation invalidating `["plaid-items"]`.

- [ ] **Step 1: Write the failing test**

`web/lib/api/connections.items.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
const get = vi.fn(async () => ({ data: [{ id: "i1", institution_name: "Chase", account_count: 2, status: "active" }], error: undefined }));
vi.mock("./client", () => ({ api: { GET: (...a: unknown[]) => get(...a) } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (opts: { queryFn: () => unknown }) => opts, useMutation: (o: unknown) => o, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
import { usePlaidItems } from "./connections";

describe("usePlaidItems", () => {
  it("queries /plaid/items", async () => {
    const { queryKey, queryFn } = usePlaidItems() as unknown as { queryKey: unknown[]; queryFn: () => Promise<unknown> };
    expect(queryKey).toEqual(["plaid-items"]);
    await queryFn();
    expect(get).toHaveBeenCalledWith("/plaid/items", {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/api/connections.items.test.ts`
Expected: FAIL.

> The connections file currently imports only `useMutation`. Update the import to `import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";`.

- [ ] **Step 3: Write minimal implementation**

In `web/lib/api/connections.ts`:

```ts
export type PlaidItem = components["schemas"]["PlaidItemOut"];

export function usePlaidItems() {
  return useQuery<PlaidItem[]>({
    queryKey: ["plaid-items"],
    queryFn: () => unwrap(api.GET("/plaid/items", {})),
  });
}

export function useDisconnectPlaidItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await api.DELETE("/plaid/items/{item_id}", { params: { path: { item_id: itemId } } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plaid-items"] }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/api/connections.items.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/api/connections.ts web/lib/api/connections.items.test.ts
git commit -m "feat(web): usePlaidItems + disconnect hook"
```

---

### Task 10: Real Plaid Link in `PlaidCard`

**Files:**
- Modify: `web/package.json` (add `react-plaid-link`)
- Modify: `web/app/(app)/connections/page.tsx` (`PlaidCard` rewrite)
- Test: `web/app/(app)/connections/plaid-card.test.tsx` (create)

**Interfaces:**
- Consumes: `usePlaidLinkToken`, `useExchangePlaidToken`, `useSyncPlaid`, `usePlaidItems`, `useDisconnectPlaidItem`; `usePlaidLink` from `react-plaid-link`.
- Produces: `PlaidCard` that opens Link, exchanges, syncs, and lists connected items.

- [ ] **Step 1: Install dependency**

Run: `cd web && npm install react-plaid-link`

- [ ] **Step 2: Write the failing test**

`web/app/(app)/connections/plaid-card.test.tsx` (mock `react-plaid-link` and the hooks):

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const open = vi.fn();
let capturedOnSuccess: ((t: string, m: unknown) => void) | undefined;
vi.mock("react-plaid-link", () => ({
  usePlaidLink: (cfg: { onSuccess: (t: string, m: unknown) => void }) => {
    capturedOnSuccess = cfg.onSuccess;
    return { open, ready: true };
  },
}));
const linkMutate = vi.fn(async () => ({ link_token: "lt" }));
const exchangeMutate = vi.fn(async () => ({ plaid_item_id: "i1", accounts_created: 1, status: "active" }));
const syncMutate = vi.fn(async () => ({ documents_created: 1, transactions_created: 3 }));
vi.mock("@/lib/api/connections", () => ({
  usePlaidLinkToken: () => ({ mutateAsync: linkMutate, isPending: false }),
  useExchangePlaidToken: () => ({ mutateAsync: exchangeMutate, isPending: false }),
  useSyncPlaid: () => ({ mutateAsync: syncMutate, isPending: false }),
  usePlaidItems: () => ({ data: [] }),
  useDisconnectPlaidItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { PlaidCard } from "./plaid-card";

afterEach(() => { linkMutate.mockClear(); exchangeMutate.mockClear(); syncMutate.mockClear(); });

describe("PlaidCard", () => {
  it("requests a token, opens Link, exchanges and syncs on success", async () => {
    render(<PlaidCard />);
    fireEvent.click(screen.getByRole("button", { name: /connect bank/i }));
    await waitFor(() => expect(linkMutate).toHaveBeenCalled());
    expect(open).toHaveBeenCalled();
    capturedOnSuccess?.("public-tok", { institution: { name: "Chase" }, accounts: [] });
    await waitFor(() => expect(exchangeMutate).toHaveBeenCalled());
    await waitFor(() => expect(syncMutate).toHaveBeenCalled());
  });
});
```

> Extract `PlaidCard` into its own file `web/app/(app)/connections/plaid-card.tsx` and import it from `page.tsx`, so it can be unit-tested in isolation. (The other cards may stay in `page.tsx`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run app/\(app\)/connections/plaid-card.test.tsx`
Expected: FAIL — `./plaid-card` not found.

- [ ] **Step 4: Write minimal implementation**

Create `web/app/(app)/connections/plaid-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { toast } from "sonner";
import {
  usePlaidLinkToken, useExchangePlaidToken, useSyncPlaid, usePlaidItems, useDisconnectPlaidItem,
} from "@/lib/api/connections";
import { Button } from "@/components/ui/button";
import { ConnectionShell } from "./connection-shell";

export function PlaidCard() {
  const linkToken = usePlaidLinkToken();
  const exchange = useExchangePlaidToken();
  const sync = useSyncPlaid();
  const items = usePlaidItems();
  const disconnect = useDisconnectPlaidItem();
  const [token, setToken] = useState<string | null>(null);

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (publicToken, metadata) => {
      try {
        const res = await exchange.mutateAsync({
          public_token: publicToken,
          institution_name: metadata?.institution?.name ?? null,
          accounts: (metadata?.accounts ?? []) as Record<string, never>[],
        });
        toast.success(`Linked ${res.accounts_created} account(s)`);
        const synced = await sync.mutateAsync({ plaid_item_id: res.plaid_item_id });
        toast.success(`Imported ${synced.transactions_created} transaction(s)`);
        void items.refetch?.();
      } catch {
        toast.error("Couldn't finish connecting your bank");
      }
    },
  });

  async function connect() {
    try {
      const res = await linkToken.mutateAsync();
      setToken(res.link_token);
      // usePlaidLink needs a tick to register the new token before open() works.
      setTimeout(() => { if (ready || token) open(); }, 0);
    } catch {
      toast.error("Plaid isn't configured in this environment");
    }
  }

  const connected = items.data ?? [];

  return (
    <ConnectionShell
      title="Bank (Plaid)"
      description="Securely import bank & card transactions."
      footer={
        <Button onClick={connect} disabled={linkToken.isPending || exchange.isPending}>
          {linkToken.isPending ? "Requesting…" : "Connect bank"}
        </Button>
      }
    >
      {connected.length === 0 ? (
        <p className="text-muted">No banks connected yet. Connect to import transactions automatically.</p>
      ) : (
        <ul className="space-y-2">
          {connected.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <span className="text-sm font-medium">{item.institution_name ?? "Bank"} · {item.account_count} acct</span>
              <span className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={() => sync.mutateAsync({ plaid_item_id: item.id }).then(() => toast.success("Synced")).catch(() => toast.error("Sync failed"))}>Sync</Button>
                <Button variant="ghost" size="sm" onClick={() => disconnect.mutateAsync(item.id).then(() => toast.success("Disconnected")).catch(() => toast.error("Couldn't disconnect"))}>Disconnect</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </ConnectionShell>
  );
}
```

Extract the existing `ConnectionShell` (lines 31–52 of the current `connections/page.tsx`) into `web/app/(app)/connections/connection-shell.tsx` and import it from both `page.tsx` and `plaid-card.tsx`. Update `page.tsx` to import `PlaidCard` from `./plaid-card` and remove the old inline `PlaidCard`.

> If `metadata.institution`/`accounts` typing from `react-plaid-link` differs, cast through `as { institution?: { name?: string }; accounts?: unknown[] }`. The `open()`-after-token sequencing: simplest robust pattern is a `useEffect` that calls `open()` when `ready && token && shouldOpen`, toggling a `shouldOpen` state in `connect()`. Use that effect form if the `setTimeout` proves flaky in manual testing.

- [ ] **Step 5: Run test + full suite**

Run: `cd web && npx vitest run app/\(app\)/connections/plaid-card.test.tsx`
Expected: PASS.
Run: `cd web && npx vitest run` — green.

- [ ] **Step 6: Live verification + commit**

Set `PLAID_CLIENT_ID` / `PLAID_SECRET` (sandbox) + `PLAID_ENVIRONMENT=sandbox` in the API env; ensure `plaid-python` is installed in the api image. Manual: connect a Plaid **sandbox** bank (`user_good` / `pass_good`) → see accounts linked → transactions imported → item listed with Sync/Disconnect.

```bash
git add web/package.json web/package-lock.json web/app/\(app\)/connections/
git commit -m "feat(web): real Plaid Link flow with connected-items list"
```

---

## Phase 4 — Splitwise (read-only)

### Task 11: Config + SplitwiseGateway

**Files:**
- Modify: `backend/app/config.py` (add splitwise settings)
- Modify: `backend/app/ingestion/gateways.py` (add `SplitwiseGateway`, `get_splitwise_gateway`)
- Test: `backend/tests/test_splitwise_gateway.py` (create)

**Interfaces:**
- Produces:
  - Settings: `splitwise_consumer_key=""`, `splitwise_secret=""`, `splitwise_redirect_uri="http://localhost:8000/splitwise/oauth/callback"`.
  - `SplitwiseGateway`: `authorization_url(state: str) -> str`; `async exchange_code(code: str) -> dict`; `async get_balances(access_token: str) -> list[dict]` (friends with non-zero balances). Each raises `IntegrationUnavailable` when keys unset.
  - `get_splitwise_gateway() -> SplitwiseGateway`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_splitwise_gateway.py`:

```python
import pytest
from app.config import Settings
from app.ingestion.gateways import SplitwiseGateway, IntegrationUnavailable


def test_authorization_url_requires_creds():
    gw = SplitwiseGateway(Settings(splitwise_consumer_key="", splitwise_secret=""))
    with pytest.raises(IntegrationUnavailable):
        gw.authorization_url("state123")


def test_authorization_url_includes_state_and_client():
    gw = SplitwiseGateway(Settings(splitwise_consumer_key="ck", splitwise_secret="cs"))
    url = gw.authorization_url("state123")
    assert "client_id=ck" in url
    assert "state=state123" in url
    assert url.startswith("https://secure.splitwise.com/oauth/authorize")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run --no-project pytest tests/test_splitwise_gateway.py -q`
Expected: FAIL — `SplitwiseGateway` undefined.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/config.py`, alongside the gmail settings:

```python
    splitwise_consumer_key: str = ""
    splitwise_secret: str = ""
    splitwise_redirect_uri: str = "http://localhost:8000/splitwise/oauth/callback"
```

In `backend/app/ingestion/gateways.py` (Splitwise uses OAuth2; base API `https://secure.splitwise.com/api/v3.0`):

```python
class SplitwiseGateway:
    AUTH_URL = "https://secure.splitwise.com/oauth/authorize"
    TOKEN_URL = "https://secure.splitwise.com/oauth/token"
    API_BASE = "https://secure.splitwise.com/api/v3.0"

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def _require(self) -> None:
        if not self.settings.splitwise_consumer_key or not self.settings.splitwise_secret:
            raise IntegrationUnavailable("Splitwise credentials are not configured")

    def authorization_url(self, state: str) -> str:
        self._require()
        from urllib.parse import urlencode
        q = urlencode({
            "response_type": "code",
            "client_id": self.settings.splitwise_consumer_key,
            "redirect_uri": self.settings.splitwise_redirect_uri,
            "state": state,
        })
        return f"{self.AUTH_URL}?{q}"

    async def exchange_code(self, code: str) -> dict:
        self._require()
        import httpx
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(self.TOKEN_URL, data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": self.settings.splitwise_consumer_key,
                "client_secret": self.settings.splitwise_secret,
                "redirect_uri": self.settings.splitwise_redirect_uri,
            })
            resp.raise_for_status()
            return resp.json()

    async def get_balances(self, access_token: str) -> list[dict]:
        self._require()
        import httpx
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(f"{self.API_BASE}/get_friends", headers={"Authorization": f"Bearer {access_token}"})
            resp.raise_for_status()
            friends = resp.json().get("friends", [])
        events: list[dict] = []
        for friend in friends:
            for bal in friend.get("balance", []):
                amount = bal.get("amount")
                if amount and float(amount) != 0:
                    events.append({
                        "friend": f"{friend.get('first_name', '')} {friend.get('last_name', '') or ''}".strip(),
                        "amount": amount,
                        "currency": bal.get("currency_code", "USD"),
                    })
        return events
```

Add `get_splitwise_gateway`:

```python
def get_splitwise_gateway() -> SplitwiseGateway:
    return SplitwiseGateway()
```

> `httpx` is already a transitive dep of the project (FastAPI test client). Confirm it's in `pyproject.toml`; if not, add it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run --no-project pytest tests/test_splitwise_gateway.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/app/ingestion/gateways.py backend/tests/test_splitwise_gateway.py
git commit -m "feat(api): SplitwiseGateway (OAuth2, read balances)"
```

---

### Task 12: Splitwise service + endpoints + schemas

**Files:**
- Modify: `backend/app/ingestion/schemas.py` (add `SplitwiseOAuthStartOut`, `SplitwiseOAuthCallbackOut`, `SplitwiseSyncOut`)
- Modify: `backend/app/ingestion/service.py` (add `splitwise_oauth_start`, `splitwise_oauth_callback`, `splitwise_sync`, `delete_splitwise_connection`)
- Modify: `backend/app/ingestion/router.py` (add 4 endpoints)
- Test: `backend/tests/test_splitwise_service.py` (create)

**Interfaces:**
- Reuses `IngestionConnection` with `channel="splitwise"`, `provider="splitwise"`.
- Produces:
  - `splitwise_oauth_start(user, gateway) -> {"authorization_url", "state"}`.
  - `splitwise_oauth_callback(session, user, code, state, gateway) -> {"connection_id", "status"}`.
  - `splitwise_sync(session, user, gateway) -> {"events": list, "balances_count": int}` — pulls balances and stores them as a Document (`source_channel="splitwise"`) plus returns the owed/owing events.
  - `delete_splitwise_connection(session, user) -> None`.
  - Endpoints: `POST /splitwise/oauth/start`, `GET /splitwise/oauth/callback`, `POST /splitwise/sync`, `DELETE /splitwise/connection`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_splitwise_service.py` (copy fixtures from `test_m11_ingestion.py`; add a fake gateway):

```python
import pytest
from app.ingestion.service import splitwise_oauth_callback, splitwise_sync, delete_splitwise_connection
# ... copy engine/session/_user fixtures ...

class FakeSplitwise:
    def authorization_url(self, state): return f"https://secure.splitwise.com/oauth/authorize?state={state}"
    async def exchange_code(self, code): return {"access_token": f"at-{code}"}
    async def get_balances(self, access_token): return [{"friend": "Alice", "amount": "-24.00", "currency": "USD"}]

@pytest.mark.asyncio
async def test_callback_then_sync_returns_events(session):
    user = await _user(session)
    await splitwise_oauth_callback(session, user, code="abc", state=f"{user.id}:x", gateway=FakeSplitwise())
    out = await splitwise_sync(session, user, FakeSplitwise())
    assert out["balances_count"] == 1
    assert out["events"][0]["friend"] == "Alice"

@pytest.mark.asyncio
async def test_disconnect_revokes(session):
    user = await _user(session)
    await splitwise_oauth_callback(session, user, code="abc", state=f"{user.id}:x", gateway=FakeSplitwise())
    await delete_splitwise_connection(session, user)
    out = await splitwise_sync(session, user, FakeSplitwise())  # no active conn
    assert out["balances_count"] == 0  # or raises NotFound — assert accordingly
```

> Decide one behavior for "no active connection": either return zeros or raise `service.NotFound`. Implement and assert consistently. Recommended: raise `NotFound` (matches `email_sync`); change the second test to `with pytest.raises(NotFound): await splitwise_sync(...)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run --no-project pytest tests/test_splitwise_service.py -q`
Expected: FAIL — functions undefined.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/ingestion/schemas.py`:

```python
class SplitwiseOAuthStartOut(BaseModel):
    authorization_url: str
    state: str

class SplitwiseOAuthCallbackOut(BaseModel):
    connection_id: uuid.UUID
    status: str

class SplitwiseSyncOut(BaseModel):
    events: list[dict]
    balances_count: int
```

In `backend/app/ingestion/service.py` (import `SplitwiseGateway` in the gateways import line; add):

```python
async def splitwise_oauth_start(user: User, gateway) -> dict:
    state = f"{user.id}:{secrets.token_urlsafe(18)}"
    return {"authorization_url": gateway.authorization_url(state), "state": state}


async def splitwise_oauth_callback(session: AsyncSession, user: User, code: str, state: str, gateway) -> dict:
    if not state.startswith(str(user.id)):
        raise NotFound("OAuth state does not match user")
    token = await gateway.exchange_code(code)
    row = IngestionConnection(user_id=user.id, channel="splitwise", provider="splitwise", token_encrypted=encrypt_string(token.get("access_token") or ""), config={"token_meta": {k: v for k, v in token.items() if k != "access_token"}}, status="active")
    session.add(row)
    await record_consent(session, user, "splitwise")
    await session.commit()
    await session.refresh(row)
    return {"connection_id": row.id, "status": row.status}


async def splitwise_sync(session: AsyncSession, user: User, gateway) -> dict:
    conn = (await session.execute(select(IngestionConnection).where(IngestionConnection.user_id == user.id, IngestionConnection.channel == "splitwise", IngestionConnection.status == "active"))).scalars().first()
    if conn is None:
        raise NotFound("Splitwise connection not found")
    token = decrypt_string(conn.token_encrypted) or ""
    events = await gateway.get_balances(token)
    doc = Document(household_id=user.household_id, uploaded_by_user_id=user.id, storage_key=f"splitwise://{uuid.uuid4()}", type="other", source_channel="splitwise", status="processed", ocr_meta={"splitwise": {"events": events}})
    session.add(doc)
    await session.commit()
    return {"events": events, "balances_count": len(events)}


async def delete_splitwise_connection(session: AsyncSession, user: User) -> None:
    rows = list((await session.execute(select(IngestionConnection).where(IngestionConnection.user_id == user.id, IngestionConnection.channel == "splitwise"))).scalars().all())
    for row in rows:
        row.status = "revoked"
        row.token_encrypted = None
    await record_consent(session, user, "splitwise", granted=False)
    await session.commit()
```

In `backend/app/ingestion/router.py` (add the schema imports + `get_splitwise_gateway` to the gateways import):

```python
@router.post("/splitwise/oauth/start", response_model=SplitwiseOAuthStartOut)
async def splitwise_oauth_start(user: User = Depends(require_role("owner", "member")), gateway=Depends(get_splitwise_gateway)):
    try:
        return await service.splitwise_oauth_start(user, gateway)
    except IntegrationUnavailable as exc:
        _bad_gateway(exc)


@router.get("/splitwise/oauth/callback", response_model=SplitwiseOAuthCallbackOut)
async def splitwise_oauth_callback(code: str = Query(...), state: str = Query(...), user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session), gateway=Depends(get_splitwise_gateway)):
    try:
        return await service.splitwise_oauth_callback(session, user, code, state, gateway)
    except IntegrationUnavailable as exc:
        _bad_gateway(exc)
    except service.NotFound as exc:
        _not_found(exc)


@router.post("/splitwise/sync", response_model=SplitwiseSyncOut)
async def splitwise_sync(user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session), gateway=Depends(get_splitwise_gateway)):
    try:
        return await service.splitwise_sync(session, user, gateway)
    except IntegrationUnavailable as exc:
        _bad_gateway(exc)
    except service.NotFound as exc:
        _not_found(exc)


@router.delete("/splitwise/connection", status_code=status.HTTP_204_NO_CONTENT)
async def splitwise_delete(user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    await service.delete_splitwise_connection(session, user)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run --no-project pytest tests/test_splitwise_service.py -q`
Expected: PASS.
Run: `cd backend && uv run --no-project pytest -q` — full backend suite green.

- [ ] **Step 5: Regenerate types + commit**

With API running: `cd web && npm run gen:api`.

```bash
git add backend/app/ingestion/ backend/tests/test_splitwise_service.py shared/api-schema.ts shared/openapi.json
git commit -m "feat(api): Splitwise OAuth connect + balance sync endpoints"
```

---

### Task 13: Splitwise frontend hooks + card

**Files:**
- Modify: `web/lib/api/connections.ts` (3 hooks)
- Modify: `web/app/(app)/connections/page.tsx` (add `SplitwiseCard`)
- Test: `web/lib/api/connections.splitwise.test.ts` (create)

**Interfaces:**
- Produces: `useSplitwiseOAuthStart()` (`POST /splitwise/oauth/start`), `useSplitwiseSync()` (`POST /splitwise/sync`), `useDisconnectSplitwise()` (`DELETE /splitwise/connection`). `SplitwiseCard` mirrors `EmailCard`.

- [ ] **Step 1: Write the failing test**

`web/lib/api/connections.splitwise.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
const post = vi.fn(async () => ({ data: { authorization_url: "https://secure.splitwise.com/oauth/authorize", state: "s" }, error: undefined }));
vi.mock("./client", () => ({ api: { POST: (...a: unknown[]) => post(...a), DELETE: vi.fn(async () => ({ error: undefined })) } }));
vi.mock("@tanstack/react-query", () => ({ useMutation: (o: unknown) => o, useQuery: (o: unknown) => o, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
import { useSplitwiseOAuthStart, useSplitwiseSync } from "./connections";

describe("splitwise hooks", () => {
  it("start posts to /splitwise/oauth/start", async () => {
    const { mutationFn } = useSplitwiseOAuthStart() as unknown as { mutationFn: () => Promise<unknown> };
    await mutationFn();
    expect(post).toHaveBeenCalledWith("/splitwise/oauth/start", {});
  });
  it("sync posts to /splitwise/sync", async () => {
    post.mockClear();
    const { mutationFn } = useSplitwiseSync() as unknown as { mutationFn: () => Promise<unknown> };
    await mutationFn();
    expect(post).toHaveBeenCalledWith("/splitwise/sync", {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/api/connections.splitwise.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Append to `web/lib/api/connections.ts`:

```ts
export type SplitwiseStart = components["schemas"]["SplitwiseOAuthStartOut"];
export type SplitwiseSync = components["schemas"]["SplitwiseSyncOut"];

export function useSplitwiseOAuthStart() {
  return useMutation({ mutationFn: () => unwrap(api.POST("/splitwise/oauth/start", {})) });
}
export function useSplitwiseSync() {
  return useMutation({ mutationFn: () => unwrap(api.POST("/splitwise/sync", {})) });
}
export function useDisconnectSplitwise() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/splitwise/connection", {});
      if (error) throw error;
    },
  });
}
```

In `web/app/(app)/connections/page.tsx`, add a `SplitwiseCard` modeled on `EmailCard` (Connect → opens `authorization_url` in a new tab; Sync now → toast with `balances_count`; Disconnect). Render it in the grid alongside the other cards (before `BotCard`).

```tsx
function SplitwiseCard() {
  const start = useSplitwiseOAuthStart();
  const sync = useSplitwiseSync();
  const disconnect = useDisconnectSplitwise();

  async function connect() {
    try {
      const res = await start.mutateAsync();
      window.open(res.authorization_url, "_blank", "noopener,noreferrer");
      toast.success("Opening Splitwise authorization…");
    } catch {
      toast.error("Splitwise isn't configured in this environment");
    }
  }
  async function runSync() {
    try {
      const res = await sync.mutateAsync();
      toast.success(`${res.balances_count} balance(s) updated`);
    } catch {
      toast.error("Couldn't sync Splitwise");
    }
  }
  async function remove() {
    try { await disconnect.mutateAsync(); toast.success("Splitwise disconnected"); }
    catch { toast.error("Couldn't disconnect"); }
  }

  return (
    <ConnectionShell
      title="Splitwise"
      description="See who you owe and who owes you."
      footer={
        <>
          <Button onClick={connect} disabled={start.isPending}>{start.isPending ? "Starting…" : "Connect Splitwise"}</Button>
          <Button variant="outline" onClick={runSync} disabled={sync.isPending}>{sync.isPending ? "Syncing…" : "Sync now"}</Button>
          <Button variant="ghost" onClick={remove} disabled={disconnect.isPending}>Disconnect</Button>
        </>
      }
    >
      <p className="text-muted">Connect to pull current balances — “you owe Alice $24”, “Bob owes you $10”.</p>
    </ConnectionShell>
  );
}
```

Add the imports (`useSplitwiseOAuthStart`, `useSplitwiseSync`, `useDisconnectSplitwise`) and place `<SplitwiseCard />` in the grid.

- [ ] **Step 4: Run tests + full suite**

Run: `cd web && npx vitest run lib/api/connections.splitwise.test.ts`
Expected: PASS.
Run: `cd web && npx vitest run` — green.

- [ ] **Step 5: Live verification + commit**

Set `SPLITWISE_CONSUMER_KEY` / `SPLITWISE_SECRET` in the API env. Manual: Connect Splitwise → authorize → Sync now → balances toast.

```bash
git add web/lib/api/connections.ts web/lib/api/connections.splitwise.test.ts web/app/\(app\)/connections/page.tsx
git commit -m "feat(web): Splitwise connection card + hooks"
```

---

## Self-Review

**Spec coverage:**
- Universal Add page (single surface, page-wide drag-drop, multi-upload, auto-detect-first, inline review queue, manual entry) → Tasks 1, 2, 4. ✅
- Sidebar entry + single `+Add` action → Task 3. ✅
- XLSX ingestion (backend parse + wizard accept) → Tasks 5, 6. ✅
- Plaid Link (install, exchange/sync hooks, GET /plaid/items, items list, Link UI, env) → Tasks 7–10. ✅
- Splitwise (config+gateway, service+endpoints, hooks+card, env) → Tasks 11–13. ✅
- Bot stays "on hold" → unchanged `BotCard`. ✅
- Existing suites stay green → asserted in Tasks 3, 4, 6, 10, 12, 13. ✅

**Placeholder scan:** Every code step contains real code. Two intentional decision points are flagged with a recommended default (open()-sequencing in Task 10 → use the effect form if setTimeout is flaky; no-active-connection behavior in Task 12 → raise `NotFound`). No TBD/TODO left as work.

**Type consistency:** `TransactionCreate`, `PlaidExchangeIn/Out`, `PlaidSyncOut`, `PlaidItemOut`, `SplitwiseOAuthStartOut/SplitwiseSyncOut` are all generated into `shared/api-schema.ts` and referenced by the exact generated names. Hook names are stable across tasks (`useCreateTransaction`, `useExchangePlaidToken`, `useSyncPlaid`, `usePlaidItems`, `useDisconnectPlaidItem`, `useSplitwiseOAuthStart`, `useSplitwiseSync`, `useDisconnectSplitwise`). `ConnectionShell` is extracted once (Task 10) and reused (Task 13).

## Notes / risks

- `useMutation`/`useQuery` are mocked as identity functions in unit tests to read options off the returned object — this avoids needing a React render + QueryClient and matches the codebase's preference for pure-function tests. If a future react-query upgrade changes option passthrough, the mock form still works because the tests mock react-query directly.
- Plaid + Splitwise live verification requires the API running with sandbox/live credentials and the respective Python deps (`plaid-python`, `httpx`) present in the api image.
- Type regeneration (`npm run gen:api`) needs the API up at `localhost:8000`; do it after Tasks 8 and 12.
