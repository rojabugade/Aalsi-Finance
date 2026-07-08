# Debt Redesign — Phase 2: Routed Loan Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ResponsiveSheet` loan popup with a routed detail page at `/debt?loan=<id>` — breadcrumb `‹ Debt / <Loan name>` + back, an enriched loan info card, and the existing header-stats / payment-history / upcoming-schedule / payoff-calculator / edit-delete sections restyled onto the page.

**Architecture:** Extract the section components currently nested inside `components/debt/loan-detail.tsx` into a shared `components/debt/detail/sections.tsx` (verbatim move, with `UpcomingSchedule` no longer gated on an `open` prop). Build `loan-info-card.tsx` (the requested enrichment) and `loan-detail-page.tsx` (breadcrumb + back + sections). Rewire `app/(app)/debt/page.tsx` so `?loan=<id>` renders `LoanDetailPage` instead of the sheet; delete `loan-detail.tsx` and stop using `ResponsiveSheet`/`InfoRail` for loans.

**Tech Stack:** Next.js App Router client components, `next/link` (breadcrumb), React Query loan hooks (`@/lib/api/loans`), Tailwind CSS-var tokens, vitest + @testing-library/react.

## Global Constraints

- **Tokens, never hex** — reuse the established vocabulary (`bg-card`, `border-border`, `text-muted`, `bg-accent-soft`, `text-accent`, `rounded-card-sm`, `shadow-card`, `data-numeric`).
- **Breadcrumb mirrors `components/spend/category-drill.tsx`** — a `next/link` `<Link href="/debt">‹ Debt</Link>` that clears the `loan` param, followed by `/ <Loan name>`.
- **No behavior regressions** — payment logging, schedule paging, payoff calc, edit, and delete keep their exact current logic from `loan-detail.tsx`. On delete, route to `/debt` (was: close sheet).
- This phase depends on Phase 1 having rewired `debt/page.tsx` to switch on `?loan=`. If Phase 1 is not yet merged, this plan still applies — it changes the `?loan=` branch from `<LoanDetail>` (sheet) to `<LoanDetailPage>`.
- Gate on `npm run typecheck` and `npm run test:unit`.

---

### Task 1: Extract section components into `detail/sections.tsx`

**Files:**
- Create: `web/components/debt/detail/sections.tsx`
- Test: `web/components/debt/detail/sections.test.tsx`
- Modify: `web/components/debt/loan-detail.tsx` (temporarily import from the new module — fully removed in Task 4)

**Interfaces:**
- Produces (exported from `detail/sections.tsx`), preserving current behavior from `loan-detail.tsx`:
  - `function HeaderStats({ loan, onEdit }: { loan: Loan; onEdit: () => void }): JSX.Element`
  - `function PaymentHistory({ loan }: { loan: Loan }): JSX.Element`
  - `function UpcomingSchedule({ loan }: { loan: Loan }): JSX.Element` — **signature change:** drops the `open` prop; always calls `useLoanSchedule(loan.id)` (a routed page is always "open").
  - `function PayoffCalculator({ loan }: { loan: Loan }): JSX.Element`
  - `function EditSection({ loan, onDone, onDeleted }: { loan: Loan; onDone: () => void; onDeleted: () => void }): JSX.Element`
  - `function Metric({ label, value }: { label: string; value: string }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/detail/sections.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/loans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/loans")>("@/lib/api/loans");
  return {
    ...actual,
    useLoanSchedule: () => ({ data: [], isLoading: false }),
    useLoanPayments: () => ({ data: { items: [], total: 0 }, isLoading: false }),
    usePayoffCalc: () => ({ mutate: vi.fn(), isPending: false }),
    useCreatePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeletePayment: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

import { HeaderStats, Metric } from "./sections";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "card", name: "Card", type: "credit_card", currency: "USD",
  principal: 10000, outstanding_balance: 8000, total_paid: 2000, total_interest_paid: 500,
  next_due_date: "2024-06-01",
} as unknown as Loan;

describe("detail sections", () => {
  it("HeaderStats renders the key metrics", () => {
    render(<HeaderStats loan={loan} onEdit={() => {}} />);
    expect(screen.getByText(/Outstanding/i)).toBeInTheDocument();
    expect(screen.getByText(/8,000/)).toBeInTheDocument();
  });
  it("Metric renders label and value", () => {
    render(<Metric label="Months" value="42" />);
    expect(screen.getByText("Months")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/detail/sections.test.tsx`
Expected: FAIL — cannot resolve `./sections`.

- [ ] **Step 3: Create `detail/sections.tsx` by moving the components verbatim**

Create `web/components/debt/detail/sections.tsx`. Move these functions **verbatim** from `web/components/debt/loan-detail.tsx`: `HeaderStats`, `PaymentHistory`, `UpcomingSchedule`, `PayoffCalculator`, `EditSection`, `Metric`, plus the `PAGE`/`PEEK` constants. Add `export` to each function. Apply exactly these two changes during the move:

1. `UpcomingSchedule` signature: change `function UpcomingSchedule({ loan, open }: { loan: Loan; open: boolean })` → `export function UpcomingSchedule({ loan }: { loan: Loan })`, and change `useLoanSchedule(open ? loan.id : null)` → `useLoanSchedule(loan.id)`.
2. Keep the `"use client";` directive at the top.

Required imports for `sections.tsx` (the subset the moved code uses):

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useCreatePayment,
  useDeleteLoan,
  useDeletePayment,
  useLoanPayments,
  useLoanSchedule,
  usePatchLoan,
  usePayoffCalc,
  type Loan,
} from "@/lib/api/loans";
import { formatCurrency } from "@/lib/format";
import { LoanForm } from "@/components/debt/loan-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const PAGE = 12;
const PEEK = 3;
```

(The component bodies are exactly as they appear in `loan-detail.tsx` today — copy them, prefixing each with `export`.)

- [ ] **Step 4: Point `loan-detail.tsx` at the extracted module (interim)**

In `web/components/debt/loan-detail.tsx`, delete the now-moved function definitions (`HeaderStats`, `PaymentHistory`, `UpcomingSchedule`, `PayoffCalculator`, `EditSection`, `Metric`, and the `PAGE`/`PEEK` consts) and import them instead:

```tsx
import {
  EditSection, HeaderStats, PayoffCalculator, PaymentHistory, UpcomingSchedule,
} from "@/components/debt/detail/sections";
```

Update the one call site that passed `open`: `<UpcomingSchedule loan={loan} open={open} />` → `<UpcomingSchedule loan={loan} />`. `Metric` is still used by `InfoRailBody`? No — `Metric` is only used by `HeaderStats`/`PayoffCalculator` (now in sections). Remove the local `Metric` and any now-unused imports flagged by typecheck.

- [ ] **Step 5: Run test + typecheck**

Run: `cd web && npx vitest run components/debt/detail/sections.test.tsx`
Expected: PASS

Run: `cd web && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/components/debt/detail/sections.tsx web/components/debt/detail/sections.test.tsx web/components/debt/loan-detail.tsx
git commit -m "refactor(debt): extract loan detail sections into detail/sections.tsx"
```

---

### Task 2: Enriched loan info card (`loan-info-card.tsx`)

**Files:**
- Create: `web/components/debt/detail/loan-info-card.tsx`
- Test: `web/components/debt/detail/loan-info-card.test.tsx`

**Interfaces:**
- Consumes: `type Loan` from `@/lib/api/loans`; `formatCurrency`.
- Produces: `function LoanInfoCard({ loan }: { loan: Loan }): JSX.Element` — a definition grid: loan type, schedule kind (revolving/amortizing/EMI) with a one-line plain-English meaning, compounding, original principal, APR, term (`start_date → end_date`), due day, EMI/min payment, currency.

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/detail/loan-info-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoanInfoCard } from "./loan-info-card";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "card", name: "Card", type: "credit_card", schedule_kind: "revolving",
  compounding: "monthly", principal: 10000, currency: "USD", interest_rate: 18,
  min_or_emi_amount: 300, due_day: 5, start_date: "2023-01-01", end_date: "2028-01-01",
} as unknown as Loan;

describe("LoanInfoCard", () => {
  it("renders enriched loan facts with a schedule-kind explanation", () => {
    render(<LoanInfoCard loan={loan} />);
    expect(screen.getByText(/Schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/Revolving/i)).toBeInTheDocument();
    expect(screen.getByText(/balance can go up and down/i)).toBeInTheDocument(); // plain-English meaning
    expect(screen.getByText(/18%/)).toBeInTheDocument();
    expect(screen.getByText(/Day 5/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/detail/loan-info-card.test.tsx`
Expected: FAIL — cannot resolve `./loan-info-card`.

- [ ] **Step 3: Implement the component**

Create `web/components/debt/detail/loan-info-card.tsx`:

```tsx
"use client";

import { formatCurrency } from "@/lib/format";
import type { Loan } from "@/lib/api/loans";

const TYPE_LABEL: Record<string, string> = {
  home: "Mortgage", auto: "Auto", education: "Student",
  personal: "Personal", credit_card: "Credit card", other: "Other",
};

const SCHEDULE: Record<string, { label: string; meaning: string }> = {
  revolving: { label: "Revolving", meaning: "balance can go up and down; minimum due each month" },
  amortizing: { label: "Amortizing", meaning: "fixed payments that steadily retire the balance" },
  emi: { label: "EMI", meaning: "equal monthly installments over a set term" },
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd data-numeric className="text-sm font-semibold">{value}</dd>
    </div>
  );
}

export function LoanInfoCard({ loan }: { loan: Loan }) {
  const schedule = SCHEDULE[loan.schedule_kind ?? ""] ?? { label: loan.schedule_kind ?? "—", meaning: "" };
  const term =
    loan.start_date && loan.end_date
      ? `${loan.start_date} → ${loan.end_date}`
      : loan.start_date
        ? `from ${loan.start_date}`
        : "—";

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <h2 className="mb-2 text-base font-bold tracking-tight">Loan details</h2>
      <dl>
        <Row label="Type" value={TYPE_LABEL[loan.type] ?? loan.type} />
        <Row label="Schedule" value={schedule.label} />
        {schedule.meaning && (
          <p className="py-1 text-xs text-muted">{schedule.label} — {schedule.meaning}.</p>
        )}
        <Row label="Compounding" value={loan.compounding ?? "—"} />
        <Row label="Original principal" value={formatCurrency(loan.principal, { currency: loan.currency })} />
        <Row label="APR" value={loan.interest_rate != null ? `${Number(loan.interest_rate)}%` : "—"} />
        <Row label="Term" value={term} />
        <Row label="Due day" value={loan.due_day != null ? `Day ${loan.due_day}` : "—"} />
        <Row
          label="Monthly"
          value={loan.min_or_emi_amount != null ? formatCurrency(loan.min_or_emi_amount, { currency: loan.currency }) : "—"}
        />
        <Row label="Currency" value={loan.currency} />
      </dl>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/debt/detail/loan-info-card.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/detail/loan-info-card.tsx web/components/debt/detail/loan-info-card.test.tsx
git commit -m "feat(debt): enriched loan info card"
```

---

### Task 3: Routed detail page (`loan-detail-page.tsx`)

**Files:**
- Create: `web/components/debt/detail/loan-detail-page.tsx`
- Test: `web/components/debt/detail/loan-detail-page.test.tsx`

**Interfaces:**
- Consumes: `HeaderStats`, `PaymentHistory`, `UpcomingSchedule`, `PayoffCalculator`, `EditSection` from `./sections`; `LoanInfoCard` from `./loan-info-card`; `next/link`; `useRouter` from `next/navigation`; `type Loan`.
- Produces: `function LoanDetailPage({ loan }: { loan: Loan }): JSX.Element` — breadcrumb (`‹ Debt` Link to `/debt` + `/ <name>`), then either the edit section or the stacked detail sections; on delete, `router.push('/debt')`.

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/detail/loan-detail-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/loans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/loans")>("@/lib/api/loans");
  return {
    ...actual,
    useLoanSchedule: () => ({ data: [], isLoading: false }),
    useLoanPayments: () => ({ data: { items: [], total: 0 }, isLoading: false }),
    usePayoffCalc: () => ({ mutate: vi.fn(), isPending: false }),
    useCreatePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeletePayment: () => ({ mutate: vi.fn(), isPending: false }),
    usePatchLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import { LoanDetailPage } from "./loan-detail-page";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "card", name: "My Card", type: "credit_card", schedule_kind: "revolving",
  compounding: "monthly", principal: 10000, outstanding_balance: 8000, currency: "USD",
  interest_rate: 18, min_or_emi_amount: 300, due_day: 5, start_date: "2023-01-01",
} as unknown as Loan;

describe("LoanDetailPage", () => {
  it("renders breadcrumb to /debt and the loan name + info card", () => {
    render(<LoanDetailPage loan={loan} />);
    const crumb = screen.getByRole("link", { name: /Debt/i });
    expect(crumb).toHaveAttribute("href", "/debt");
    expect(screen.getByText(/My Card/)).toBeInTheDocument();
    expect(screen.getByText(/Loan details/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/detail/loan-detail-page.test.tsx`
Expected: FAIL — cannot resolve `./loan-detail-page`.

- [ ] **Step 3: Implement the page**

Create `web/components/debt/detail/loan-detail-page.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Loan } from "@/lib/api/loans";
import { Button } from "@/components/ui/button";
import { LoanInfoCard } from "./loan-info-card";
import {
  EditSection, HeaderStats, PayoffCalculator, PaymentHistory, UpcomingSchedule,
} from "./sections";

export function LoanDetailPage({ loan }: { loan: Loan }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-4">
      <nav className="text-sm">
        <Link href="/debt" className="font-semibold text-accent">‹ Debt</Link>
        <span className="text-muted"> / </span>
        <span className="font-semibold capitalize">{loan.name}</span>
      </nav>

      {editing ? (
        <div className="rounded-card-sm border border-border bg-card p-5 shadow-card">
          <EditSection
            loan={loan}
            onDone={() => setEditing(false)}
            onDeleted={() => router.push("/debt")}
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-card-sm border border-border bg-card p-5 shadow-card">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h1 className="text-lg font-extrabold capitalize tracking-tight">{loan.name}</h1>
                <Button variant="outline" onClick={() => setEditing(true)}>Edit loan</Button>
              </div>
              <HeaderStats loan={loan} onEdit={() => setEditing(true)} />
            </div>
            <div className="rounded-card-sm border border-border bg-card p-5 shadow-card">
              <PaymentHistory loan={loan} />
            </div>
            <div className="rounded-card-sm border border-border bg-card p-5 shadow-card">
              <UpcomingSchedule loan={loan} />
            </div>
            <div className="rounded-card-sm border border-border bg-card p-5 shadow-card">
              <PayoffCalculator loan={loan} />
            </div>
          </div>
          <div className="space-y-4">
            <LoanInfoCard loan={loan} />
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: `HeaderStats` already renders its own "Edit loan" button; the page also shows one in the title row for discoverability. Both call `setEditing(true)` — harmless. If a reviewer objects to the duplicate, drop the `onEdit` button inside `HeaderStats` usage by passing a no-op and keeping the title-row button; left as-is here to avoid editing the shared section.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/debt/detail/loan-detail-page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/detail/loan-detail-page.tsx web/components/debt/detail/loan-detail-page.test.tsx
git commit -m "feat(debt): routed loan detail page with breadcrumb + info card"
```

---

### Task 4: Wire the page + retire the popup

**Files:**
- Modify: `web/app/(app)/debt/page.tsx`
- Delete: `web/components/debt/loan-detail.tsx`

**Interfaces:**
- Consumes: `LoanDetailPage` from `@/components/debt/detail/loan-detail-page`.
- Produces: `/debt?loan=<id>` renders `LoanDetailPage`; no param renders the overview; unknown id renders the overview.

- [ ] **Step 1: Write the failing test**

Add to a page-level test (create `web/app/(app)/debt/page.test.tsx` if absent):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const search = new URLSearchParams("loan=card");
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/api/loans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/loans")>("@/lib/api/loans");
  return {
    ...actual,
    useLoans: () => ({ data: [{ id: "card", name: "My Card", type: "credit_card", schedule_kind: "revolving", principal: 10000, outstanding_balance: 8000, currency: "USD", interest_rate: 18, min_or_emi_amount: 300, start_date: "2023-01-01" }], isLoading: false, isError: false }),
    useCreateLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useLoanSchedule: () => ({ data: [], isLoading: false }),
    useLoanPayments: () => ({ data: { items: [], total: 0 }, isLoading: false }),
    usePayoffCalc: () => ({ mutate: vi.fn(), isPending: false }),
    useCreatePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeletePayment: () => ({ mutate: vi.fn(), isPending: false }),
    usePatchLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import DebtPage from "./page";

describe("DebtPage routing", () => {
  it("renders the routed detail page when ?loan=<id> resolves", () => {
    render(<DebtPage />);
    expect(screen.getByRole("link", { name: /Debt/i })).toHaveAttribute("href", "/debt");
    expect(screen.getByText(/My Card/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run "app/(app)/debt/page.test.tsx"`
Expected: FAIL — page still renders the `LoanDetail` sheet (no breadcrumb link), or `LoanDetailPage` not imported.

- [ ] **Step 3: Swap the `?loan=` branch**

In `web/app/(app)/debt/page.tsx`:

1. Replace the import `import { LoanDetail } from "@/components/debt/loan-detail";` with `import { LoanDetailPage } from "@/components/debt/detail/loan-detail-page";`.
2. Replace the render branch. When `selected` is set, render `LoanDetailPage` **instead of** the overview + sheet (the detail page is a full surface, so hide the overview while drilled):

```tsx
      {loans.isError ? (
        <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
          Couldn&apos;t load loans. Check your connection and try again.
        </div>
      ) : loans.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : selected ? (
        <LoanDetailPage loan={selected} />
      ) : (
        <DebtOverview loans={loans.data ?? []} />
      )}
```

3. Remove the now-dead trailing `{selected && (<LoanDetail … />)}` block.

- [ ] **Step 4: Delete the popup**

```bash
git rm web/components/debt/loan-detail.tsx
```

If `web/components/debt/loan-context.ts` / `loanContextPreamble` was only used by `loan-detail.tsx`'s InfoRail, leave it — Phase 3's AI Coach reuses it. (Do not delete `loan-context.ts`.)

- [ ] **Step 5: Run test + typecheck + full suite**

Run: `cd web && npx vitest run "app/(app)/debt/page.test.tsx"`
Expected: PASS

Run: `cd web && npm run typecheck`
Expected: PASS (no dangling `LoanDetail`/`ResponsiveSheet` references)

Run: `cd web && npm run test:unit`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/debt/page.tsx"
git commit -m "feat(debt): route ?loan= to detail page; retire ResponsiveSheet popup"
```

---

## Self-Review

**Spec coverage (design §"Phase 2 — Loan detail"):**
- Breadcrumb `‹ Debt / <Loan name>` clearing `loan`, mirroring `category-drill.tsx` → Task 3. ✓
- Loan info card enrichment (type, schedule kind + plain-English meaning, compounding, principal, APR, term, due day, EMI, currency) → Task 2. ✓
- Header stats, payment history, upcoming schedule, payoff calculator reused with current logic → Tasks 1, 3. ✓
- Edit/delete reuse `EditSection`; on delete route to `/debt` → Tasks 1, 3. ✓
- Retire popup: remove `ResponsiveSheet`/`InfoRail`, delete `loan-detail.tsx` → Task 4. ✓
- Unknown `?loan=` id → overview (handled by Phase 1's `selected = … ?? null`; this plan preserves that fall-through) → Task 4. ✓

**Placeholder scan:** none. Task 1 Step 3 references the existing repo file `loan-detail.tsx` as the verbatim source (not another task's code), with the two exact deltas spelled out — a precise mechanical instruction, not a placeholder.

**Type consistency:** `UpcomingSchedule` loses its `open` prop in Task 1 and every call site (interim `loan-detail.tsx` in Task 1 Step 4, then `loan-detail-page.tsx` in Task 3) passes only `loan`. `EditSection({ loan, onDone, onDeleted })`, `HeaderStats({ loan, onEdit })`, `Metric({ label, value })` signatures are identical between definition (Task 1) and consumers (Task 3). `LoanDetailPage({ loan })` matches the page's call in Task 4.

**Decision flagged:** the drilled detail page replaces the overview (full-surface swap) rather than layering over it, consistent with the spend tab's drill behavior and the spec's "mirrors the spend tab's category drill." The duplicate "Edit loan" button (title row + inside `HeaderStats`) is noted inline in Task 3 with a one-line remediation if a reviewer objects, avoiding a change to the shared section.

**Risk note:** `InfoRailBody` in the old popup used `useAnalystAsk` + `loanContextPreamble`; that ask-the-analyst affordance is intentionally dropped here and returns in **Phase 3** as the persistent AI Coach pane (`debt-context.ts` reuses `loanContextPreamble`). `loan-context.ts` is therefore kept, not deleted.
