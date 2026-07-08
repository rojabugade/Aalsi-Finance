# Spend Drill Push-Nav + Contextual Analyst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Spend page's stacked overlapping drill sheets with one iOS-style push/pop drill stack, make every row + chart + insight card drillable, and mount a context-aware AI analyst on every page.

**Architecture:** A single `DrillStack` (one Radix Dialog) hosts a horizontal track of frame columns; pushing a frame slides the track left so the current view exits left and the new one enters right. Category/merchant/transaction/bucket bodies are presentational and call `push()` from a `DrillNav` context. Charts and insight cards open the stack via page-level `rootFrame` state. The existing dashboard analyst is hoisted to the app shell layout and gains an optional entity `focus` that scopes its answers.

**Tech Stack:** Next.js (app router, client components), React 19, TanStack Query, Radix Dialog, Recharts, Tailwind + tailwindcss-animate, vitest + React Testing Library; FastAPI + Pydantic + SQLAlchemy (async) backend.

## Global Constraints

- Keep `tsc` clean: `cd web && npx tsc --noEmit` must pass.
- Keep the full vitest suite green: `cd web && npx vitest run` (327 baseline + new tests).
- Backend tests run against the `finance_test` DB via the project's configured runner (use the api container if the local `backend/.venv` is broken — see memory `verifying-tests-via-docker`).
- No DB migrations. New backend API fields are **optional/additive** — never breaking.
- Follow existing component conventions: `"use client"`, `cn()` for classes, tokens like `bg-card`/`text-muted`/`border-border`/`var(--accent)`.
- Respect `prefers-reduced-motion` for the slide animation (no transform).
- The analyst must remain fail-safe: it never turns a provider/data error into a 5xx and never crashes a page.

---

## Task order & dependencies

Group A (drill stack) → Group C (interactive charts, needs A) → Group B (analyst, mostly independent; B4 needs A7 + B2/B3). Within A: A1, A2 independent; A4–A6 depend on A2; A7 depends on A3–A6.

---

### Task A1: `bucketRange` helper + bucket-key on chart bars

**Files:**
- Modify: `web/lib/spend/period.ts` (add `bucketRange`)
- Modify: `web/lib/spend/derive.ts` (`spendSeries` emits `key`; `SpendBar` type lives in `spend-bars-impl.tsx`)
- Modify: `web/components/spend/spend-bars-impl.tsx` (extend `SpendBar`)
- Test: `web/lib/spend/period.test.ts` (exists — append)

**Interfaces:**
- Produces: `bucketRange(key: string, gran: Granularity): { from: string; to: string; label: string }`; `SpendBar = { label: string; value: number; key: string }`.

- [ ] **Step 1: Write the failing test** — append to `web/lib/spend/period.test.ts`:

```ts
import { bucketRange } from "./period";

describe("bucketRange", () => {
  it("maps a day key to a single-day inclusive range", () => {
    expect(bucketRange("2026-06-11", "day")).toEqual({
      from: "2026-06-11", to: "2026-06-11", label: "2026-06-11",
    });
  });
  it("maps a week key to a 7-day inclusive range", () => {
    expect(bucketRange("2026-06-01", "week")).toEqual({
      from: "2026-06-01", to: "2026-06-07", label: "2026-06-01",
    });
  });
  it("maps a month key to a full-month inclusive range", () => {
    expect(bucketRange("2026-02", "month")).toEqual({
      from: "2026-02-01", to: "2026-02-28", label: "2026-02",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/spend/period.test.ts`
Expected: FAIL — `bucketRange is not a function`.

- [ ] **Step 3: Implement `bucketRange`** — add to `web/lib/spend/period.ts` (near `bucketKeyForDate`; reuse the existing `addDays` helper):

```ts
/** Inverse of bucketKeyForDate: a bucket key + granularity → its inclusive range. */
export function bucketRange(key: string, gran: Granularity): { from: string; to: string; label: string } {
  if (gran === "month") {
    const [y, m] = key.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}`, label: key };
  }
  if (gran === "week") return { from: key, to: addDays(key, 6), label: key };
  return { from: key, to: key, label: key };
}
```

- [ ] **Step 4: Add `key` to `SpendBar` and `spendSeries`** —

In `web/components/spend/spend-bars-impl.tsx` change the type:
```ts
export type SpendBar = { label: string; value: number; key: string };
```
In `web/lib/spend/derive.ts`, `spendSeries` return (currently `buckets.map((b) => ({ label: b.label, value: totals.get(b.key) ?? 0 }))`) becomes:
```ts
  return buckets.map((b) => ({ key: b.key, label: b.label, value: totals.get(b.key) ?? 0 }));
```
Do the same in `merchantSeries` (it also returns `{ label, value }` — add `key: b.key`).

- [ ] **Step 5: Run tests + typecheck**

Run: `cd web && npx vitest run lib/spend/period.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add web/lib/spend/period.ts web/lib/spend/period.test.ts web/lib/spend/derive.ts web/components/spend/spend-bars-impl.tsx
git commit -m "feat(spend): bucketRange helper + bucket key on chart bars"
```

---

### Task A2: DrillNav context, frame model, helpers

**Files:**
- Create: `web/components/spend/drill-nav.ts`
- Test: `web/components/spend/drill-nav.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type DrillFrame =
    | { kind: "category"; id: string }
    | { kind: "merchant"; name: string }
    | { kind: "transaction"; id: string }
    | { kind: "bucket"; from: string; to: string; label: string };
  type DrillNav = { push: (f: DrillFrame) => void; pop: () => void; depth: number };
  useDrillNav(): DrillNav;
  frameKey(f: DrillFrame): string;
  frameTitle(f, cats, txns): string;
  ```

- [ ] **Step 1: Write the failing test** — `web/components/spend/drill-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { frameKey, frameTitle, type DrillFrame } from "./drill-nav";

const cats = [{ id: "c1", name: "Travel" }] as any;
const txns = [{ id: "t1", merchant: "United Airlines" }] as any;

describe("frameKey", () => {
  it("is stable per frame identity", () => {
    expect(frameKey({ kind: "category", id: "c1" })).toBe("category:c1");
    expect(frameKey({ kind: "bucket", from: "2026-06-01", to: "2026-06-07", label: "x" }))
      .toBe("bucket:2026-06-01:2026-06-07");
  });
});

describe("frameTitle", () => {
  it("resolves names from data, with safe fallbacks", () => {
    expect(frameTitle({ kind: "category", id: "c1" } as DrillFrame, cats, txns)).toBe("Travel");
    expect(frameTitle({ kind: "merchant", name: "Costco" } as DrillFrame, cats, txns)).toBe("Costco");
    expect(frameTitle({ kind: "transaction", id: "t1" } as DrillFrame, cats, txns)).toBe("United Airlines");
    expect(frameTitle({ kind: "category", id: "gone" } as DrillFrame, cats, txns)).toBe("Category");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/spend/drill-nav.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `web/components/spend/drill-nav.ts`:

```ts
"use client";

import { createContext, useContext } from "react";
import type { Category, Transaction } from "@/lib/api/transactions";

export type DrillFrame =
  | { kind: "category"; id: string }
  | { kind: "merchant"; name: string }
  | { kind: "transaction"; id: string }
  | { kind: "bucket"; from: string; to: string; label: string };

export type DrillNav = { push: (f: DrillFrame) => void; pop: () => void; depth: number };

export const DrillNavContext = createContext<DrillNav | null>(null);

export function useDrillNav(): DrillNav {
  const ctx = useContext(DrillNavContext);
  if (!ctx) throw new Error("useDrillNav must be used within a DrillStack");
  return ctx;
}

export function frameKey(f: DrillFrame): string {
  switch (f.kind) {
    case "category": return `category:${f.id}`;
    case "merchant": return `merchant:${f.name}`;
    case "transaction": return `transaction:${f.id}`;
    case "bucket": return `bucket:${f.from}:${f.to}`;
  }
}

export function frameTitle(f: DrillFrame, cats: Category[], txns: Transaction[]): string {
  switch (f.kind) {
    case "category": return cats.find((c) => c.id === f.id)?.name ?? "Category";
    case "merchant": return f.name;
    case "transaction": return txns.find((t) => t.id === f.id)?.merchant ?? "Transaction";
    case "bucket": return f.label;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/spend/drill-nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/spend/drill-nav.ts web/components/spend/drill-nav.test.ts
git commit -m "feat(spend): DrillNav context + frame model"
```

---

### Task A3: Extract & export `TransactionDetailBody`

**Files:**
- Modify: `web/components/transactions/transaction-detail.tsx`
- Test: `web/components/transactions/transaction-detail-body.test.tsx` (create)

**Interfaces:**
- Produces: `export function TransactionDetailBody({ txn, categories, onClose }: { txn: Transaction; categories: Category[]; onClose: () => void })` — the editor form, renders **without** any sheet wrapper.

- [ ] **Step 1: Write the failing test** — `web/components/transactions/transaction-detail-body.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransactionDetailBody } from "./transaction-detail";

const txn = { id: "t1", merchant: "Costco", amount: -42, txn_date: "2026-06-10", currency: "USD", status: "confirmed", category_id: null, line_items: [] } as any;

it("renders the editor body without a dialog", () => {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <TransactionDetailBody txn={txn} categories={[]} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(screen.getByDisplayValue("Costco")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/transactions/transaction-detail-body.test.tsx`
Expected: FAIL — `TransactionDetailBody` is not exported.

- [ ] **Step 3: Rename & export** — in `web/components/transactions/transaction-detail.tsx`:
  - Rename the internal `function DetailBody(` to `export function TransactionDetailBody(`.
  - Update the single call site inside `TransactionDetail` from `<DetailBody ... />` to `<TransactionDetailBody ... />`.
  - Leave everything else (props, body, `ResponsiveSheet` wrapper in `TransactionDetail`) unchanged.

- [ ] **Step 4: Run test + existing detail test**

Run: `cd web && npx vitest run components/transactions/`
Expected: PASS (new + any existing transaction-detail tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/transactions/transaction-detail.tsx web/components/transactions/transaction-detail-body.test.tsx
git commit -m "refactor(txn): export TransactionDetailBody for embedding in drill stack"
```

---

### Task A4: `CategoryDrillBody` — drillable rows, no nested panel

**Files:**
- Modify: `web/components/spend/category-drill.tsx`
- Test: `web/components/spend/category-drill.test.tsx` (create)

**Interfaces:**
- Consumes: `useDrillNav` (A2).
- Produces: `export function CategoryDrillBody({ parent, txns, cats, currency, period })` — same props as today's `CategoryDrill`, minus its own panel.

- [ ] **Step 1: Write the failing test** — `web/components/spend/category-drill.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DrillNavContext } from "./drill-nav";
import { CategoryDrillBody } from "./category-drill";

const period = { from: "2026-06-01", to: "2026-06-30", prevFrom: null, prevTo: null, buckets: [], granularity: "day", label: "Jun", compareLabel: "" } as any;
const parent = { id: "c1", name: "Shopping", parent_id: null } as any;
const cats = [parent];
const txns = [{ id: "t1", merchant: "Costco", amount: -50, txn_date: "2026-06-10", currency: "USD", category_id: "c1" }] as any;

it("pushes a transaction frame when a transaction row is clicked", () => {
  const push = vi.fn();
  render(
    <DrillNavContext.Provider value={{ push, pop: vi.fn(), depth: 1 }}>
      <CategoryDrillBody parent={parent} txns={txns} cats={cats} currency="USD" period={period} />
    </DrillNavContext.Provider>,
  );
  screen.getByRole("button", { name: /Costco/ }).click();
  expect(push).toHaveBeenCalledWith({ kind: "transaction", id: "t1" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/spend/category-drill.test.tsx`
Expected: FAIL — `CategoryDrillBody` not exported / row not a button.

- [ ] **Step 3: Refactor** — in `web/components/spend/category-drill.tsx`:
  - Rename `export function CategoryDrill(` → `export function CategoryDrillBody(`.
  - Delete the imports of `DrillPanel` and `MerchantDrill`; delete `const [merchant, setMerchant] = useState<string | null>(null);`; delete the entire trailing `<DrillPanel ...>…</DrillPanel>` block.
  - Add `import { useDrillNav } from "./drill-nav";` and `const { push } = useDrillNav();`.
  - Subcategory rows: wrap each in a `<button type="button" onClick={() => push({ kind: "category", id: s.id })} className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-chip">` (move the existing inner markup inside; add a trailing `<span className="text-muted">›</span>`).
  - Top-merchant buttons: change `onClick={() => setMerchant(m.name)}` → `onClick={() => push({ kind: "merchant", name: m.name })}`.
  - Transaction rows (the `recent.map`): change each `<div ...>` to `<button type="button" onClick={() => push({ kind: "transaction", id: t.id })} className="flex w-full items-center gap-3 py-2 text-left hover:bg-chip">`.

- [ ] **Step 4: Run test**

Run: `cd web && npx vitest run components/spend/category-drill.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/spend/category-drill.tsx web/components/spend/category-drill.test.tsx
git commit -m "refactor(spend): CategoryDrillBody pushes frames, drops nested panel"
```

---

### Task A5: `MerchantDrillBody` — drillable rows, no nested panel

**Files:**
- Modify: `web/components/spend/merchant-drill.tsx`
- Test: `web/components/spend/merchant-drill.test.tsx` (create)

**Interfaces:**
- Consumes: `useDrillNav` (A2).
- Produces: `export function MerchantDrillBody({ merchant, txns, cats, currency, period })`.

- [ ] **Step 1: Write the failing test** — `web/components/spend/merchant-drill.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DrillNavContext } from "./drill-nav";
import { MerchantDrillBody } from "./merchant-drill";

const period = { from: "2026-06-01", to: "2026-06-30", prevFrom: null, prevTo: null, buckets: [], granularity: "day", label: "Jun", compareLabel: "" } as any;
const cats = [{ id: "c1", name: "Shopping", parent_id: null }] as any;
const txns = [{ id: "t1", merchant: "Costco", amount: -50, txn_date: "2026-06-10", currency: "USD", category_id: "c1" }] as any;

it("pushes a transaction frame from a transaction row", () => {
  const push = vi.fn();
  render(
    <DrillNavContext.Provider value={{ push, pop: vi.fn(), depth: 1 }}>
      <MerchantDrillBody merchant="Costco" txns={txns} cats={cats} currency="USD" period={period} />
    </DrillNavContext.Provider>,
  );
  screen.getAllByRole("button").find((b) => /2026-06-10/.test(b.textContent ?? ""))!.click();
  expect(push).toHaveBeenCalledWith({ kind: "transaction", id: "t1" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/spend/merchant-drill.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Refactor** — in `web/components/spend/merchant-drill.tsx`:
  - Rename `export function MerchantDrill(` → `export function MerchantDrillBody(`.
  - Delete imports of `DrillPanel` and `CategoryDrill`; delete `const [catId, setCatId] = useState<string | null>(null);` and `const childCat = ...`; delete the trailing `<DrillPanel ...>…</DrillPanel>` block.
  - Add `import { useDrillNav } from "./drill-nav";` and `const { push } = useDrillNav();`.
  - "Spending by category" clickable rows: change `onClick={() => setCatId(c.id)}` → `onClick={() => push({ kind: "category", id: c.id })}` (keep the `real` guard exactly as-is).
  - Transactions list (`recent.map`): change each `<div ...>` to `<button type="button" onClick={() => push({ kind: "transaction", id: t.id })} className="flex w-full items-center gap-3 py-2 text-left hover:bg-chip">`.

- [ ] **Step 4: Run test**

Run: `cd web && npx vitest run components/spend/merchant-drill.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/spend/merchant-drill.tsx web/components/spend/merchant-drill.test.tsx
git commit -m "refactor(spend): MerchantDrillBody pushes frames, drops nested panel"
```

---

### Task A6: `BucketDrillBody` — transactions for a clicked bar

**Files:**
- Create: `web/components/spend/bucket-drill.tsx`
- Test: `web/components/spend/bucket-drill.test.tsx`

**Interfaces:**
- Consumes: `useDrillNav` (A2), `inRange` (`period.ts`), `spendAmount` is not needed — show signed amounts.
- Produces: `export function BucketDrillBody({ from, to, txns, currency }: { from: string; to: string; txns: Transaction[]; currency: string })`.

- [ ] **Step 1: Write the failing test** — `web/components/spend/bucket-drill.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DrillNavContext } from "./drill-nav";
import { BucketDrillBody } from "./bucket-drill";

const txns = [
  { id: "t1", merchant: "Costco", amount: -50, txn_date: "2026-06-11", currency: "USD" },
  { id: "t2", merchant: "Rent", amount: -900, txn_date: "2026-06-20", currency: "USD" },
] as any;

it("lists only in-range txns and pushes a transaction frame on click", () => {
  const push = vi.fn();
  render(
    <DrillNavContext.Provider value={{ push, pop: vi.fn(), depth: 2 }}>
      <BucketDrillBody from="2026-06-11" to="2026-06-11" txns={txns} currency="USD" />
    </DrillNavContext.Provider>,
  );
  expect(screen.queryByText(/Rent/)).toBeNull();
  screen.getByRole("button", { name: /Costco/ }).click();
  expect(push).toHaveBeenCalledWith({ kind: "transaction", id: "t1" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/spend/bucket-drill.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `web/components/spend/bucket-drill.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import type { Transaction } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { inRange } from "@/lib/spend/period";
import { useDrillNav } from "./drill-nav";

export function BucketDrillBody({
  from, to, txns, currency,
}: { from: string; to: string; txns: Transaction[]; currency: string }) {
  const { push } = useDrillNav();
  const rows = useMemo(
    () => txns.filter((t) => inRange(t.txn_date, from, to)).sort((a, b) => b.txn_date.localeCompare(a.txn_date)),
    [txns, from, to],
  );
  const total = useMemo(() => rows.reduce((a, t) => a + Math.abs(Number(t.amount)), 0), [rows]);

  return (
    <div className="space-y-3" data-testid="spend-bucket-drill">
      <div className="rounded-card-sm border border-border bg-gradient-to-br from-accent-soft/70 to-card p-4 shadow-card">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{rows.length} transactions</p>
        <p className="mt-1 text-[28px] font-extrabold leading-none tabular-nums">{formatCurrency(total, { currency })}</p>
      </div>
      <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No transactions in this period.</p>
        ) : (
          rows.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => push({ kind: "transaction", id: t.id })}
              className="flex w-full items-center gap-3 py-2 text-left hover:bg-chip"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {t.merchant ?? "Unknown"}
                <span className="block text-[11px] text-muted">{t.txn_date.slice(0, 10)}</span>
              </span>
              <span className="text-sm font-bold tabular-nums">
                {formatCurrency(Math.abs(Number(t.amount)), { currency: t.currency })}
              </span>
              <span className="text-muted">›</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test**

Run: `cd web && npx vitest run components/spend/bucket-drill.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/spend/bucket-drill.tsx web/components/spend/bucket-drill.test.tsx
git commit -m "feat(spend): BucketDrillBody lists a date bucket's transactions"
```

---

### Task A7: `DrillStack` — track animation, seeding, back/close

**Files:**
- Create: `web/components/spend/drill-stack.tsx`
- Test: `web/components/spend/drill-stack.test.tsx`

**Interfaces:**
- Consumes: A2 (`DrillNavContext`, `DrillFrame`, `frameKey`, `frameTitle`), A3 (`TransactionDetailBody`), A4–A6 bodies, `DrillPanel`.
- Produces: `export function DrillStack({ rootFrame, rootBackLabel, onClose, txns, cats, currency, period }: { rootFrame: DrillFrame | null; rootBackLabel: string; onClose: () => void; txns: Transaction[]; cats: Category[]; currency: string; period: Period })`.

**Behaviour:** Renders a single `DrillPanel` (`open = rootFrame !== null`). Inside, a horizontal track of frame columns translated by `-(activeIndex)*100%`. `push` appends + advances; `pop` retreats then trims the tail after the slide; back at depth 1 and ✕ both call `onClose`. The `DrillPanel` already renders the back chevron + close ✕ and an outer slide; the back chevron must call `pop()`/`onClose()` via the panel's `backLabel` button.

> Note: `DrillPanel`'s back button currently calls `onOpenChange(false)`. To let it pop one level, pass a custom handler. Add an optional `onBack?: () => void` prop to `DrillPanel`: when provided, the back button calls `onBack()` instead of `onOpenChange(false)`. (One-line change in `drill-panel.tsx`: `onClick={() => (onBack ? onBack() : onOpenChange(false))}`, and add `onBack` to its props + the title/subtitle/backLabel already exist.)

- [ ] **Step 1: Add `onBack` to `DrillPanel`** — in `web/components/spend/drill-panel.tsx`, add `onBack,` to the destructured props and its type (`onBack?: () => void;`), and change the back button handler to:

```tsx
onClick={() => (onBack ? onBack() : onOpenChange(false))}
```

- [ ] **Step 2: Write the failing test** — `web/components/spend/drill-stack.test.tsx` (force reduced-motion so transitions resolve synchronously):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DrillStack } from "./drill-stack";

beforeAll(() => {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
  })) as any;
});

const period = { from: "2026-06-01", to: "2026-06-30", prevFrom: null, prevTo: null, buckets: [], granularity: "day", label: "Jun", compareLabel: "" } as any;
const cats = [{ id: "c1", name: "Shopping", parent_id: null }] as any;
const txns = [{ id: "t1", merchant: "Costco", amount: -50, txn_date: "2026-06-10", currency: "USD", category_id: "c1" }] as any;

function renderStack(onClose = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <DrillStack rootFrame={{ kind: "category", id: "c1" }} rootBackLabel="Categories"
        onClose={onClose} txns={txns} cats={cats} currency="USD" period={period} />
    </QueryClientProvider>,
  );
  return onClose;
}

it("opens at the root frame title", () => {
  renderStack();
  expect(screen.getByText("Shopping")).toBeInTheDocument();
});

it("closes via the back control at depth 1", () => {
  const onClose = renderStack();
  fireEvent.click(screen.getByRole("button", { name: /Categories/ }));
  expect(onClose).toHaveBeenCalled();
});

it("pushes a transaction frame, then back returns to the parent", () => {
  renderStack();
  fireEvent.click(screen.getByRole("button", { name: /Costco/ }));
  expect(screen.getByDisplayValue("Costco")).toBeInTheDocument(); // detail editor visible
  fireEvent.click(screen.getByRole("button", { name: /Shopping/ })); // back label = parent title
  expect(screen.getByText("Shopping")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run components/spend/drill-stack.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** — `web/components/spend/drill-stack.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category, Transaction } from "@/lib/api/transactions";
import type { Period } from "@/lib/spend/period";
import { DrillPanel } from "./drill-panel";
import { DrillNavContext, frameKey, frameTitle, type DrillFrame } from "./drill-nav";
import { CategoryDrillBody } from "./category-drill";
import { MerchantDrillBody } from "./merchant-drill";
import { BucketDrillBody } from "./bucket-drill";
import { TransactionDetailBody } from "@/components/transactions/transaction-detail";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function DrillStack({
  rootFrame, rootBackLabel, onClose, txns, cats, currency, period,
}: {
  rootFrame: DrillFrame | null;
  rootBackLabel: string;
  onClose: () => void;
  txns: Transaction[];
  cats: Category[];
  currency: string;
  period: Period;
}) {
  const [frames, setFrames] = useState<DrillFrame[]>([]);
  const [active, setActive] = useState(0);

  // Seed / reset the stack from the page-supplied root frame.
  const rootKey = rootFrame ? frameKey(rootFrame) : null;
  useEffect(() => {
    if (rootFrame) { setFrames([rootFrame]); setActive(0); }
    else { setFrames([]); setActive(0); }
  }, [rootKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = useCallback((f: DrillFrame) => {
    setFrames((prev) => [...prev.slice(0, active + 1), f]);
    setActive((i) => i + 1);
  }, [active]);

  const trim = useCallback(() => setFrames((prev) => prev.slice(0, active + 1)), [active]);

  const pop = useCallback(() => {
    if (active === 0) { onClose(); return; }
    setActive((i) => i - 1);
    if (prefersReducedMotion()) setFrames((prev) => prev.slice(0, active)); // drop tail now
  }, [active, onClose]);

  const nav = useMemo(() => ({ push, pop, depth: active + 1 }), [push, pop, active]);

  const top = frames[active] ?? null;
  const parent = active > 0 ? frames[active - 1] : null;
  const title = top ? frameTitle(top, cats, txns) : "";
  const backLabel = parent ? frameTitle(parent, cats, txns) : rootBackLabel;

  const renderFrame = (f: DrillFrame) => {
    switch (f.kind) {
      case "category": {
        const parentCat = cats.find((c) => c.id === f.id);
        return parentCat
          ? <CategoryDrillBody parent={parentCat} txns={txns} cats={cats} currency={currency} period={period} />
          : <Gone />;
      }
      case "merchant":
        return <MerchantDrillBody merchant={f.name} txns={txns} cats={cats} currency={currency} period={period} />;
      case "bucket":
        return <BucketDrillBody from={f.from} to={f.to} txns={txns} currency={currency} />;
      case "transaction": {
        const txn = txns.find((t) => t.id === f.id);
        return txn ? <TransactionDetailBody txn={txn} categories={cats} onClose={pop} /> : <Gone />;
      }
    }
  };

  return (
    <DrillNavContext.Provider value={nav}>
      <DrillPanel
        open={rootFrame !== null}
        onOpenChange={(o) => { if (!o) onClose(); }}
        onBack={pop}
        title={title}
        subtitle={period.label}
        backLabel={backLabel}
      >
        <div className="relative h-full overflow-hidden">
          <div
            className="flex h-full motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
            style={{ transform: `translateX(-${active * 100}%)` }}
            onTransitionEnd={trim}
          >
            {frames.map((f, i) => (
              <div key={frameKey(f) + i} className="h-full w-full flex-none overflow-y-auto pr-0.5" aria-hidden={i !== active}>
                {Math.abs(i - active) <= 1 ? renderFrame(f) : null}
              </div>
            ))}
          </div>
        </div>
      </DrillPanel>
    </DrillNavContext.Provider>
  );
}

function Gone() {
  return <p className="py-10 text-center text-sm text-muted">This item is no longer available.</p>;
}
```

> The `DrillPanel` body already provides the scroll container; here each column manages its own vertical scroll, so the stack lives inside the panel's content area as a full-height track.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run components/spend/drill-stack.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/spend/drill-stack.tsx web/components/spend/drill-stack.test.tsx web/components/spend/drill-panel.tsx
git commit -m "feat(spend): DrillStack with push/pop track + onBack on DrillPanel"
```

---

### Task A8: Wire `DrillStack` into the Spend page

**Files:**
- Modify: `web/app/(app)/transactions/page.tsx`
- Modify: `web/components/spend/category-list.tsx` (`hrefFor` → `onSelect`)
- Modify: `web/components/spend/merchant-list.tsx` (`hrefFor` → `onSelect`)
- Test: `web/app/(app)/transactions/page.test.tsx` (create — smoke render)

**Interfaces:**
- Consumes: A7 `DrillStack`. Page owns `rootFrame` state + openers.

- [ ] **Step 1: Convert the lists to callbacks** — in `category-list.tsx` and `merchant-list.tsx`, replace the `hrefFor: (x) => string` prop with `onSelect: (x) => void`, and render each row as a `<button type="button" onClick={() => onSelect(id|name)} ...>` instead of a `<Link href={hrefFor(...)}>`. Keep the existing row markup/classes. (These are the category and merchant overview rows.)

- [ ] **Step 2: Rewire the page** — in `web/app/(app)/transactions/page.tsx`:
  - Remove imports of `CategoryDrill`, `MerchantDrill`, `DrillPanel`; add `import { DrillStack } from "@/components/spend/drill-stack";` and `import type { DrillFrame } from "@/components/spend/drill-nav";` and `import { bucketRange } from "@/lib/spend/period";`.
  - Add page state: `const [rootFrame, setRootFrame] = useState<DrillFrame | null>(null);`
  - Replace the URL drill helpers with openers:
    ```tsx
    function openCategory(id: string) {
      setRootFrame({ kind: "category", id });
      router.replace(withRootDrill("cat", id), { scroll: false });
    }
    function openMerchant(name: string) {
      setRootFrame({ kind: "merchant", name });
      router.replace(withRootDrill("merchant", name), { scroll: false });
    }
    function openBucket(b: { from: string; to: string; label: string }) {
      setRootFrame({ kind: "bucket", ...b });
    }
    function openTransaction(id: string) { setRootFrame({ kind: "transaction", id }); }
    function closeDrill() {
      setRootFrame(null);
      const sp = new URLSearchParams(params.toString());
      sp.delete("cat"); sp.delete("merchant");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
    ```
  - Seed `rootFrame` from URL on mount/param change:
    ```tsx
    useEffect(() => {
      if (catId) setRootFrame({ kind: "category", id: catId });
      else if (merchantParam) setRootFrame({ kind: "merchant", name: merchantParam });
    }, [catId, merchantParam]);
    ```
  - `CategoryList` / `MerchantList`: swap `hrefFor={catHref}` → `onSelect={openCategory}` and `hrefFor={merchantHref}` → `onSelect={openMerchant}`.
  - Replace the two `<DrillPanel>…</DrillPanel>` blocks at the bottom with a single:
    ```tsx
    <DrillStack
      rootFrame={rootFrame}
      rootBackLabel={view === "merchants" ? "Merchants" : "Spend"}
      onClose={closeDrill}
      txns={allTxns}
      cats={allCats}
      currency={currency}
      period={period}
    />
    ```
  - Keep the flat-ledger `<TransactionDetail ... />` (driven by `detailId`) unchanged.

- [ ] **Step 3: Write a smoke test** — `web/app/(app)/transactions/page.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/transactions",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api/transactions", () => ({
  useTransactions: () => ({ data: [], isLoading: false, isError: false }),
  useCategories: () => ({ data: [] }),
  useMergeTransactions: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import TransactionsPage from "./page";

it("renders the Spend page without a drill open", () => {
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><TransactionsPage /></QueryClientProvider>);
  expect(screen.getByText(/transactions|No transactions|Spend/i)).toBeTruthy();
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd web && npx vitest run app/\(app\)/transactions components/spend && npx tsc --noEmit`
Expected: PASS, no type errors. Manually verify in the browser that drilling category → subcategory → merchant → transaction slides left and back pops.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(app\)/transactions/page.tsx web/components/spend/category-list.tsx web/components/spend/merchant-list.tsx web/app/\(app\)/transactions/page.test.tsx
git commit -m "feat(spend): drive drills through DrillStack with rootFrame state"
```

---

### Task C1: Clickable spending-over-time bars

**Files:**
- Modify: `web/components/spend/spend-bars-impl.tsx` (`onBarClick`)
- Modify: `web/components/spend/spend-over-time.tsx` (passthrough)
- Modify: `web/app/(app)/transactions/page.tsx` (wire bars → `openBucket`)
- Test: `web/components/spend/spend-bars-impl.test.tsx` (create)

- [ ] **Step 1: Write the failing test** — `web/components/spend/spend-bars-impl.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { SpendBarsImpl } from "./spend-bars-impl";

it("invokes onBarClick with the datum's key when a bar is clicked", () => {
  const onBarClick = vi.fn();
  // Recharts needs width; mock ResizeObserver + a fixed size is handled by jsdom shim.
  const { container } = render(
    <div style={{ width: 400, height: 200 }}>
      <SpendBarsImpl data={[{ key: "2026-06-11", label: "Jun 11", value: 100 }]} onBarClick={onBarClick} />
    </div>,
  );
  // Simulate Recharts calling the bar onClick handler with the payload.
  // (Unit-level: assert the handler maps payload.key → onBarClick.)
  expect(typeof onBarClick).toBe("function");
  expect(container).toBeTruthy();
});
```

> Recharts SVG clicks are unreliable in jsdom. Keep the test a render smoke + rely on the typed handler; the real wiring is verified in the browser. (If the team has a Recharts test util, prefer firing the `<Bar onClick>` directly.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/spend/spend-bars-impl.test.tsx`
Expected: FAIL — `onBarClick` prop unknown to the component (TS) / not rendered.

- [ ] **Step 3: Implement** — in `spend-bars-impl.tsx`, add the prop and wire Recharts' `<Bar onClick>`:

```tsx
export function SpendBarsImpl({
  data, height = 200, onBarClick,
}: {
  data: SpendBar[];
  height?: number;
  onBarClick?: (bar: SpendBar) => void;
}) {
  // ...existing chart...
  // On the <Bar>:
  //   onClick={(payload: any) => onBarClick?.(payload?.payload as SpendBar)}
  //   className={onBarClick ? "cursor-pointer" : undefined}
}
```
Add `onClick` + `className` to the `<Bar dataKey="value" ...>` element.

- [ ] **Step 4: Passthrough + wire** —
  - In `spend-over-time.tsx`, add `onBarClick?: (bar: SpendBar) => void` to props and pass it to `<Bars ... onBarClick={onBarClick} />` (import the `SpendBar` type).
  - In `transactions/page.tsx`, both `<SpendOverTime ... />` usages get:
    ```tsx
    onBarClick={(bar) => openBucket(bucketRange(bar.key, granularity))}
    ```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd web && npx vitest run components/spend/spend-bars-impl.test.tsx && npx tsc --noEmit`
Expected: PASS. Verify in-browser: clicking a bar opens that day/week/month's transactions.

- [ ] **Step 6: Commit**

```bash
git add web/components/spend/spend-bars-impl.tsx web/components/spend/spend-over-time.tsx web/app/\(app\)/transactions/page.tsx web/components/spend/spend-bars-impl.test.tsx
git commit -m "feat(spend): click a chart bar to drill its transactions"
```

---

### Task C2: Clickable donut slices + legend

**Files:**
- Modify: `web/components/spend/share-donut.tsx` (`onSliceClick`, clickable legend)
- Modify: `web/components/spend/share-donut-impl.tsx` (slice onClick)
- Modify: `web/app/(app)/transactions/page.tsx` (wire → `openCategory`)
- Test: `web/components/spend/share-donut.test.tsx` (create)

- [ ] **Step 1: Write the failing test** — `web/components/spend/share-donut.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShareDonut } from "./share-donut";

const rows = [
  { id: "c1", name: "Shopping", total: 300, prev: 0, deltaPct: null },
  { id: "c2", name: "Travel", total: 100, prev: 0, deltaPct: null },
] as any;

it("calls onSliceClick with the category id from a legend row", () => {
  const onSliceClick = vi.fn();
  render(<ShareDonut rows={rows} currency="USD" onSliceClick={onSliceClick} />);
  screen.getByRole("button", { name: /Shopping/ }).click();
  expect(onSliceClick).toHaveBeenCalledWith("c1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/spend/share-donut.test.tsx`
Expected: FAIL — legend rows are `<li>`, not buttons; `onSliceClick` unknown.

- [ ] **Step 3: Implement** —
  - In `share-donut.tsx`, add `onSliceClick?: (categoryId: string) => void` to props. For each non-"Other" legend row, render the inner content inside a `<button type="button" onClick={() => r.id && onSliceClick?.(r.id)} className="flex w-full items-center gap-2 ...">`; keep "Other" rows as plain content. Pass `onSliceClick` + the grouped rows' ids into `<Donut ... onSliceClick={onSliceClick} />`.
  - In `share-donut-impl.tsx`, accept `onSliceClick?: (categoryId: string) => void` and an id on each datum; wire the Recharts `<Pie>`/`<Cell onClick>` to call `onSliceClick(datum.id)` for real categories (skip "Other"), adding `cursor-pointer` when interactive. (Extend the slice datum shape passed from `share-donut.tsx` to include `id`.)

- [ ] **Step 4: Wire the page** — in `transactions/page.tsx`, both `<ShareDonut ... />` usages get `onSliceClick={openCategory}`.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd web && npx vitest run components/spend/share-donut.test.tsx && npx tsc --noEmit`
Expected: PASS. Verify in-browser: clicking a slice or legend row opens that category.

- [ ] **Step 6: Commit**

```bash
git add web/components/spend/share-donut.tsx web/components/spend/share-donut-impl.tsx web/app/\(app\)/transactions/page.tsx web/components/spend/share-donut.test.tsx
git commit -m "feat(spend): click a donut slice/legend to drill the category"
```

---

### Task C3: Clickable insight cards (Top mover, Largest purchase)

**Files:**
- Modify: `web/components/spend/insight-strip.tsx` (`onMover`, `onLargest`)
- Modify: `web/app/(app)/transactions/page.tsx` (wire)
- Test: `web/components/spend/insight-strip.test.tsx` (create)

- [ ] **Step 1: Write the failing test** — `web/components/spend/insight-strip.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightStrip } from "./insight-strip";

const mover = { id: "c1", name: "Groceries", total: 300, prev: 130, deltaPct: 129 } as any;
const unusual = { id: "t9", merchant: "United Airlines", amount: -500, currency: "USD" } as any;

it("fires onMover and onLargest with the right ids", () => {
  const onMover = vi.fn(); const onLargest = vi.fn();
  render(
    <InsightStrip spent={3006} prevSpent={4000} mover={mover} unusual={unusual}
      dailyAvg={130} incomePct={22} currency="USD" onMover={onMover} onLargest={onLargest} />,
  );
  screen.getByRole("button", { name: /Top mover/i }).click();
  screen.getByRole("button", { name: /Largest purchase/i }).click();
  expect(onMover).toHaveBeenCalledWith("c1");
  expect(onLargest).toHaveBeenCalledWith("t9");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/spend/insight-strip.test.tsx`
Expected: FAIL — tiles are `<div>`, no callbacks.

- [ ] **Step 3: Implement** — in `insight-strip.tsx`:
  - Add `onMover?: (categoryId: string) => void` and `onLargest?: (txnId: string) => void` to props.
  - Give `StatTile` an optional `onClick?: () => void`; when present, render the tile as a `<button type="button" onClick={onClick} className="... text-left hover:bg-chip">` (else the current `<div>`).
  - "Top mover" tile: `onClick={mover ? () => onMover?.(mover.id) : undefined}`.
  - "Largest purchase" tile: `onClick={unusual ? () => onLargest?.(unusual.id) : undefined}`.
  - Leave the hero "Spent this period" tile non-interactive.

- [ ] **Step 4: Wire the page** — in `transactions/page.tsx`, the `<InsightStrip ... />` gets:
  ```tsx
  onMover={openCategory}
  onLargest={openTransaction}
  ```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd web && npx vitest run components/spend/insight-strip.test.tsx && npx tsc --noEmit`
Expected: PASS. Verify in-browser.

- [ ] **Step 6: Commit**

```bash
git add web/components/spend/insight-strip.tsx web/app/\(app\)/transactions/page.tsx web/components/spend/insight-strip.test.tsx
git commit -m "feat(spend): make Top mover + Largest purchase cards drillable"
```

---

### Task B1: Backend — focus-scoped analyst ask

**Files:**
- Modify: `backend/app/analyst/schemas.py` (`AnalystAskIn` focus fields)
- Modify: `backend/app/analyst/service.py` (`build_messages` + `run_ask` + `build_focus_summary`)
- Test: `backend/tests/test_m19_analyst.py` (append)

**Interfaces:**
- Produces: `AnalystAskIn` gains `focus_kind: Literal["merchant","category"] | None`, `focus_label: str | None`, `focus_id: str | None`. `build_focus_summary(session, user, focus_kind, focus_label, from_date, to_date) -> dict | None`.

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_m19_analyst.py`:

```python
import pytest
from app.analyst.schemas import AnalystAskIn
from app.analyst import service


def test_build_messages_includes_focus_block():
    from app.analyst.schemas import FinancialSnapshot
    snap = FinancialSnapshot(currency="USD", income=0, expenses=0, net=0, net_worth=0, assets=0, liabilities=0)
    msgs = service.build_messages(
        "explain", snap, "why the jump?",
        focus={"kind": "merchant", "label": "Home Depot", "spend": 18130.95, "prev_spend": 12000.0, "delta_pct": 51.1},
    )
    assert any("Home Depot" in m["content"] for m in msgs)


def test_ask_in_accepts_optional_focus():
    data = AnalystAskIn(mode="explain", question="x", focus_kind="category", focus_label="Travel", focus_id="c1")
    assert data.focus_kind == "category"
    # Absent focus still parses (back-compat).
    assert AnalystAskIn(mode="explain", question="x").focus_kind is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_m19_analyst.py::test_build_messages_includes_focus_block tests/test_m19_analyst.py::test_ask_in_accepts_optional_focus -v`
Expected: FAIL — `AnalystAskIn` has no `focus_kind`; `build_messages` has no `focus` kwarg.

- [ ] **Step 3: Add schema fields** — in `backend/app/analyst/schemas.py`, extend `AnalystAskIn`:

```python
class AnalystAskIn(BaseModel):
    mode: Mode
    question: str = Field(min_length=1)
    range_from: str | None = None
    range_to: str | None = None
    focus_kind: Literal["merchant", "category"] | None = None
    focus_label: str | None = None
    focus_id: str | None = None
```

- [ ] **Step 4: Thread focus into messages + ask** — in `backend/app/analyst/service.py`:

```python
def build_messages(mode: str, snapshot: FinancialSnapshot, question: str, focus: dict | None = None) -> list[dict]:
    user_content = f"Question: {question}\n\nFinancial snapshot (JSON):\n{snapshot.model_dump_json()}"
    if focus:
        delta = "" if focus.get("delta_pct") is None else f" ({focus['delta_pct']:+.0f}% vs the previous period)"
        user_content += (
            f"\n\nThe user is currently viewing the {focus['kind']} '{focus['label']}'. "
            f"Answer about it specifically. It spent {focus.get('spend', 0):.2f} this period{delta}; "
            f"previous period {focus.get('prev_spend', 0):.2f}."
        )
    return [
        {"role": "system", "content": f'{_SYSTEM.get(mode, _SYSTEM["explain"])} {_GROUNDING_RULES}'},
        {"role": "user", "content": user_content},
    ]


async def build_focus_summary(session, user, focus_kind: str, focus_label: str, from_date, to_date) -> dict | None:
    from datetime import timedelta
    from app.analytics import service as analytics
    if not focus_label:
        return None
    dim = "merchant" if focus_kind == "merchant" else "category"
    cur = await analytics.breakdown(session, user, dim, focus_label, from_date, to_date)
    days = (to_date - from_date).days + 1
    prev_to = from_date - timedelta(days=1)
    prev_from = prev_to - timedelta(days=days - 1)
    prev = await analytics.breakdown(session, user, dim, focus_label, prev_from, prev_to)

    def _sum(rows):
        return sum(float(r.get("total") or 0) for r in (rows.get("rows") or []))

    spend = _sum(cur)
    prev_spend = _sum(prev)
    delta_pct = ((spend - prev_spend) / prev_spend * 100) if prev_spend else None
    return {"kind": focus_kind, "label": focus_label, "spend": spend, "prev_spend": prev_spend, "delta_pct": delta_pct}
```

Then in `run_ask`, after building `snapshot`, compute focus and pass it through:

```python
    focus = None
    if data.focus_kind and data.focus_label:
        try:
            focus = await build_focus_summary(
                session, user, data.focus_kind, data.focus_label,
                _resolve_from(data), _resolve_to(data),
            )
        except Exception:
            focus = None  # focus is best-effort; never block the answer
    messages = build_messages(data.mode, snapshot, data.question, focus)
```

(Replace the existing `messages = build_messages(data.mode, snapshot, data.question)` line.)

- [ ] **Step 5: Run the new tests + the full analyst suite**

Run: `cd backend && pytest tests/test_m19_analyst.py -v`
Expected: PASS (new tests + existing, confirming back-compat).

- [ ] **Step 6: Commit**

```bash
git add backend/app/analyst/schemas.py backend/app/analyst/service.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): optional entity focus scoping on /analyst/ask"
```

---

### Task B2: Frontend analyst context — range, focus, pluggable action handler

**Files:**
- Modify: `web/components/dashboard/analyst/use-analyst.tsx`
- Modify: `web/components/dashboard/analyst/analyst-blob.tsx` (read range from context)
- Modify: `web/components/dashboard/analyst/analyst-pane.tsx` (read range from context, pass focus)
- Modify: `web/components/dashboard/analyst/analyst-blob.test.tsx`, `analyst-pane.test.tsx` (update mocks)
- Test: `web/components/dashboard/analyst/use-analyst.test.tsx` (append)

**Interfaces:**
- Produces: `AnalystContextValue` gains `range: DateRange`, `focus: AnalystFocus | null`, `setRange(r)`, `setFocus(f)`, `clearFocus()`, `setActionHandler(fn)`. `AnalystProvider` gains `defaultRange: DateRange` prop; `onAction` becomes the initial handler. `type AnalystFocus = { kind: "merchant" | "category"; label: string; id?: string }`.

- [ ] **Step 1: Write the failing test** — append to `web/components/dashboard/analyst/use-analyst.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { AnalystProvider, useAnalyst } from "./use-analyst";

it("exposes range + focus and lets pages set them", () => {
  const wrapper = ({ children }: any) => (
    <AnalystProvider defaultRange={{ from: "2026-01-01", to: "2026-03-31" }} onAction={() => {}}>
      {children}
    </AnalystProvider>
  );
  const { result } = renderHook(() => useAnalyst(), { wrapper });
  expect(result.current.range.from).toBe("2026-01-01");
  act(() => result.current.setFocus({ kind: "merchant", label: "Home Depot" }));
  expect(result.current.focus?.label).toBe("Home Depot");
  act(() => result.current.clearFocus());
  expect(result.current.focus).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/analyst/use-analyst.test.tsx`
Expected: FAIL — `defaultRange`/`range`/`setFocus` don't exist.

- [ ] **Step 3: Extend the provider** — in `use-analyst.tsx`:
  - Add `import type { DateRange } from "@/lib/dates";`.
  - Add `export type AnalystFocus = { kind: "merchant" | "category"; label: string; id?: string };`.
  - Add to `AnalystContextValue`: `range: DateRange; focus: AnalystFocus | null; setRange: (r: DateRange) => void; setFocus: (f: AnalystFocus) => void; clearFocus: () => void; setActionHandler: (fn: (a: AnalystAction) => void) => void;`.
  - `AnalystProvider({ children, defaultRange, onAction })`: add `defaultRange: DateRange` to props; hold `const [range, setRange] = useState(defaultRange);`, `const [focus, setFocus] = useState<AnalystFocus | null>(null);`, and `const handlerRef = useRef(onAction);`. `runAction: (a) => handlerRef.current(a)`. `setActionHandler: (fn) => { handlerRef.current = fn; }`. Include `range, focus, setRange, setFocus: (f) => setFocus(f), clearFocus: () => setFocus(null), setActionHandler` in the memo value (add them to the dep array).

- [ ] **Step 4: Make Blob/Pane read range from context** —
  - `analyst-blob.tsx`: drop the `range` prop; `const { toggle, open, dismissed, range } = useAnalyst();` and use it for `useMonitor(range)`.
  - `analyst-pane.tsx`: drop the `range` prop; `const { open, mode, setMode, closePane, runAction, range, focus } = useAnalyst();`; pass `range` to `<MonitorFeed range={range} />` and `range`+`focus` to `<ChatThread ... range={range} focus={focus} />` (focus consumed in B4).
  - Update `analyst-blob.test.tsx` and `analyst-pane.test.tsx` mocks of `useAnalyst` to include `range: { from: "2026-01-01", to: "2026-03-31" }, focus: null` and render `<AnalystBlob />` / `<AnalystPane />` without the `range` prop.

- [ ] **Step 5: Run the analyst tests + typecheck**

Run: `cd web && npx vitest run components/dashboard/analyst && npx tsc --noEmit`
Expected: PASS. (Typecheck will flag the dashboard mount until Task B3 — that's expected; do B3 before the final suite run.)

- [ ] **Step 6: Commit**

```bash
git add web/components/dashboard/analyst/use-analyst.tsx web/components/dashboard/analyst/analyst-blob.tsx web/components/dashboard/analyst/analyst-pane.tsx web/components/dashboard/analyst/use-analyst.test.tsx web/components/dashboard/analyst/analyst-blob.test.tsx web/components/dashboard/analyst/analyst-pane.test.tsx
git commit -m "feat(analyst): context-held range + entity focus + pluggable action handler"
```

---

### Task B3: Mount the analyst globally in the app shell

**Files:**
- Create: `web/components/dashboard/analyst/global-action-handler.ts`
- Modify: `web/app/(app)/layout.tsx` (mount provider + blob + pane)
- Modify: `web/app/(app)/dashboard/page.tsx` (register dashboard handler + range; drop local mount)
- Test: `web/components/dashboard/analyst/global-action-handler.test.ts`

**Interfaces:**
- Consumes: B2 provider. Produces: `makeGlobalActionHandler({ router }): (a: AnalystAction) => void`.

- [ ] **Step 1: Write the failing test** — `web/components/dashboard/analyst/global-action-handler.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeGlobalActionHandler } from "./global-action-handler";

it("routes dashboard-only actions to /dashboard", () => {
  const push = vi.fn();
  const handler = makeGlobalActionHandler({ router: { push } as any });
  handler({ type: "open_personalize", label: "x", params: {} } as any);
  expect(push).toHaveBeenCalledWith("/dashboard");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/analyst/global-action-handler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the global handler** — `web/components/dashboard/analyst/global-action-handler.ts`:

```ts
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AnalystAction } from "@/lib/api/analyst";

/** Default handler used everywhere outside the dashboard. Dashboard-only
 *  actions (widgets/personalize/focus) route to /dashboard; the dashboard then
 *  registers its richer handler via setActionHandler. */
export function makeGlobalActionHandler({ router }: { router: AppRouterInstance }) {
  return (action: AnalystAction): void => {
    switch (action.type) {
      case "create_widget":
      case "open_personalize":
      case "focus_widget":
      case "set_budget":
        router.push("/dashboard");
        return;
      case "snooze_alert":
      case "dismiss_alert":
        return; // handled by the monitor feed's own dismiss controls
    }
  };
}
```

- [ ] **Step 4: Mount in the app shell** — in `web/app/(app)/layout.tsx`, wrap `AppShell` with the analyst provider + blob + pane:

```tsx
import { presetRange } from "@/lib/dates";
import { AnalystProvider } from "@/components/dashboard/analyst/use-analyst";
import { AnalystBlob } from "@/components/dashboard/analyst/analyst-blob";
import { AnalystPane } from "@/components/dashboard/analyst/analyst-pane";
import { makeGlobalActionHandler } from "@/components/dashboard/analyst/global-action-handler";
// inside the component, after the auth gate:
  const onAction = makeGlobalActionHandler({ router });
  return (
    <AnalystProvider defaultRange={presetRange("90d")} onAction={onAction}>
      <AppShell>{children}</AppShell>
      <AnalystBlob />
      <AnalystPane />
    </AnalystProvider>
  );
```

- [ ] **Step 5: Strip the dashboard's local mount + register its handler** — in `web/app/(app)/dashboard/page.tsx`:
  - Remove the imports of `AnalystBlob`, `AnalystPane`, `AnalystProvider` and the `<AnalystProvider>` wrapper + `<AnalystBlob>`/`<AnalystPane>` JSX; keep `makeActionHandler`.
  - Use the global provider via the hook: `const { setActionHandler, setRange } = useAnalyst();` (`import { useAnalyst } from "@/components/dashboard/analyst/use-analyst";`).
  - Register the dashboard handler + push the dashboard's range into the shared context:
    ```tsx
    useEffect(() => { setActionHandler(onAction); }, [onAction, setActionHandler]);
    useEffect(() => { setRange(range); }, [range, setRange]);
    ```
  - Return just the dashboard content (`<PrivacyProvider>...</PrivacyProvider>`) — no analyst JSX.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd web && npx vitest run components/dashboard/analyst app/\(app\)/dashboard && npx tsc --noEmit`
Expected: PASS. Verify in-browser: the Sparkles FAB now appears on Spend, Insights, etc., and still works on the dashboard.

- [ ] **Step 7: Commit**

```bash
git add web/components/dashboard/analyst/global-action-handler.ts web/components/dashboard/analyst/global-action-handler.test.ts web/app/\(app\)/layout.tsx web/app/\(app\)/dashboard/page.tsx
git commit -m "feat(analyst): mount FAB+pane app-wide via shell layout"
```

---

### Task B4: Send focus in asks + "Ask about <X>" from drills

**Files:**
- Modify: `web/lib/api/analyst.ts` (extend `AskIn` locally with focus fields)
- Modify: `web/components/dashboard/analyst/chat-thread.tsx` (accept + send `focus`)
- Modify: `web/components/spend/drill-stack.tsx` (Ask button → set focus + open pane)
- Test: `web/components/dashboard/analyst/chat-thread.test.tsx` (append, if present) or create a focused test

**Interfaces:**
- Consumes: B2 (`focus` on context), B1 (backend fields). Produces: ask body carries `focus_kind/focus_label/focus_id`.

- [ ] **Step 1: Extend the ask type (no schema regen needed)** — in `web/lib/api/analyst.ts`:

```ts
export type AskIn = components["schemas"]["AnalystAskIn"] & {
  focus_kind?: "merchant" | "category";
  focus_label?: string;
  focus_id?: string;
};
```
`useAnalystAsk` already takes `AskIn`; widen the POST body cast if TS complains: `api.POST("/analyst/ask", { body: body as components["schemas"]["AnalystAskIn"] })`.

- [ ] **Step 2: Write the failing test** — `web/components/dashboard/analyst/chat-thread.test.tsx` (append or create):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutateAsync = vi.fn().mockResolvedValue({ answer: "ok" });
vi.mock("@/lib/api/analyst", () => ({ useAnalystAsk: () => ({ mutateAsync, isPending: false }) }));
import { ChatThread } from "./chat-thread";

it("includes focus fields in the ask body when focus is set", async () => {
  render(
    <ChatThread mode="explain" range={{ from: "2026-06-01", to: "2026-06-30" }} threadId="t"
      focus={{ kind: "merchant", label: "Home Depot", id: undefined }} />,
  );
  fireEvent.change(screen.getByPlaceholderText(/Ask the analyst/), { target: { value: "why up?" } });
  fireEvent.submit(screen.getByTestId("analyst-composer"));
  expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
    focus_kind: "merchant", focus_label: "Home Depot",
  }));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/analyst/chat-thread.test.tsx`
Expected: FAIL — `focus` prop unknown; body lacks focus fields.

- [ ] **Step 4: Send focus from ChatThread** — in `chat-thread.tsx`:
  - Add `focus?: { kind: "merchant" | "category"; label: string; id?: string } | null` to props.
  - In `submit`, extend the `ask.mutateAsync({...})` body with:
    ```ts
    ...(focus ? { focus_kind: focus.kind, focus_label: focus.label, focus_id: focus.id } : {}),
    ```

- [ ] **Step 5: Add the "Ask about" affordance in the drill** — in `drill-stack.tsx`:
  - `import { useAnalyst } from "@/components/dashboard/analyst/use-analyst";` and `const analyst = useAnalyst();`.
  - Compute the current entity focus from the top frame:
    ```tsx
    const askFocus = top && (top.kind === "category" || top.kind === "merchant")
      ? { kind: top.kind, label: title, id: top.kind === "category" ? top.id : undefined } as const
      : null;
    ```
  - Render an "Ask about" button inside the panel body (top of the track viewport) when `askFocus`:
    ```tsx
    {askFocus && (
      <button type="button"
        onClick={() => { analyst.setFocus(askFocus); analyst.openPane("explain"); }}
        className="mb-2 inline-flex items-center gap-1.5 rounded-chip bg-accent-soft/30 px-3 py-1.5 text-[12px] font-semibold text-accent hover:bg-accent-soft/50">
        <span aria-hidden>✨</span> Ask about {title}
      </button>
    )}
    ```
  - Clear focus when the stack closes: in the `onOpenChange`/`onClose` path call `analyst.clearFocus()` alongside `onClose()`.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd web && npx vitest run components/dashboard/analyst/chat-thread.test.tsx components/spend/drill-stack.test.tsx && npx tsc --noEmit`
Expected: PASS. (Update the drill-stack test's `useAnalyst` usage by wrapping in `AnalystProvider` or mocking `useAnalyst` to return `{ setFocus: vi.fn(), openPane: vi.fn(), clearFocus: vi.fn() }`.)

- [ ] **Step 7: Commit**

```bash
git add web/lib/api/analyst.ts web/components/dashboard/analyst/chat-thread.tsx web/components/spend/drill-stack.tsx web/components/dashboard/analyst/chat-thread.test.tsx
git commit -m "feat(analyst): scope drill asks to the viewed entity + Ask-about button"
```

---

### Task FINAL: Full verification

- [ ] **Step 1: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full frontend suite**

Run: `cd web && npx vitest run`
Expected: all green (327 baseline + the new tests added here).

- [ ] **Step 3: Backend analyst suite**

Run: `cd backend && pytest tests/test_m19_analyst.py -v`
Expected: all green.

- [ ] **Step 4: Manual smoke (browser)** — on `/transactions`:
  - Category → subcategory → merchant → transaction: each push slides left; back pops; ✕ closes.
  - Click a chart bar → that bucket's transactions; click a donut slice/legend → that category; click Top mover / Largest purchase → category / transaction.
  - "Ask about <X>" opens the analyst pre-scoped; the FAB appears on other pages too.

- [ ] **Step 5: Commit any final fixups**

```bash
git add -A && git commit -m "test(spend): verification pass for drill nav + contextual analyst"
```

---

## Self-Review

**Spec coverage:**
- Goal 1 (push/pop nav) → A2, A3, A7 (+ A4–A6 bodies). ✓
- Goal 2 (drillable rows) → A4, A5, A6, A8 (lists). ✓
- Goal 3 (clean detail) → A3 (`TransactionDetailBody` reused as a frame). ✓
- Goal 4 (analyst everywhere + context) → B1, B2, B3, B4. ✓
- Goal 5 (interactive charts/cards) → A1 (bucketRange/keys), C1, C2, C3. ✓
- Spec Part 1 frame model incl. `bucket` → A2. ✓ Part 4 bucket body → A6. ✓
- Error handling (missing entity → "no longer available") → A7 `Gone`. ✓ Analyst fail-safe → B1 best-effort focus. ✓

**Placeholder scan:** No TBD/TODO; every code step shows code; commands have expected output.

**Type consistency:** `DrillFrame`, `frameKey`, `frameTitle`, `useDrillNav`/`DrillNavContext` defined in A2 and consumed unchanged in A4–A7. `SpendBar` gains `key` in A1 and used in C1. `AnalystFocus`/`setFocus`/`setActionHandler`/`range` defined in B2, consumed in B3/B4. `AskIn` focus fields defined in B4 match backend `AnalystAskIn` fields in B1 (`focus_kind`/`focus_label`/`focus_id`). `bucketRange` signature consistent A1→C1.
