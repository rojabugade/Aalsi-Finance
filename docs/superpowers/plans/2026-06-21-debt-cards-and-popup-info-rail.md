# Debt Cards Clarity + Popup Info Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make loan cards self-explanatory and equal-height, add a collapsible right-side info+analyst rail to the loan detail popup, and default the upcoming schedule to the next 3 installments with full pagination.

**Architecture:** Pure frontend. `LoanCard` gets labeled fields and a flex layout that pins the footer. `ResponsiveSheet` gains an opt-in `aside` prop that switches the desktop dialog to a two-pane layout (existing single-pane callers untouched). A new `InfoRail` (in `loan-detail.tsx`) renders a static glossary plus an "ask the analyst" form that reuses the existing `POST /analyst/ask` endpoint via `useAnalystAsk`; the loan context is composed client-side by a pure, unit-tested `loanContextPreamble` helper. `UpcomingSchedule` slices the already-loaded schedule client-side.

**Tech Stack:** Next.js App Router + React + TypeScript + Tailwind + Radix Dialog + TanStack Query + vitest.

## Global Constraints

- All paths are under `/Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/`. Frontend commands run from `web/`.
- No backend changes. AI help reuses `useAnalystAsk()` from `web/lib/api/analyst.ts` (`POST /analyst/ask`, body `{ mode: "explain", question: string }`, returns `{ answer: string; available: boolean; suggestions?: ... }`).
- Desktop vs mobile is decided by `useIsDesktop()` from `@/lib/shell/use-is-desktop` (named export, returns `boolean`).
- Currency formatting via `formatCurrency(value, { currency })` from `@/lib/format`.
- Tailwind tokens already in use in this codebase: `bg-card`, `bg-chip`, `bg-accent`, `bg-accent-soft`, `text-accent`, `text-muted`, `text-fg`, `border-border`, `rounded-card`, `rounded-card-sm`, `shadow-card`. Reuse; don't invent.
- Existing `ResponsiveSheet` callers pass no `aside` — their rendering must remain byte-for-byte identical.
- Verify after each task: `cd web && npm run typecheck` clean; `npm run test:unit` all pass. (`npm run lint` is broken repo-wide — `next lint` was removed in Next 16 and no eslint config exists — do NOT treat its failure as a regression.)
- Commit messages end with the two trailer lines:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01XDn6fCM7yc2SgXAPdVZfZG`

---

## Task 1: Loan card — labeled fields + equal height

**Files:**
- Modify: `web/app/(app)/debt/page.tsx` (the `LoanCard` function only)

**Interfaces:**
- Consumes: `Loan` (already imported), `formatCurrency`, `Badge`, `Landmark`, `TYPE_LABEL`, `num` (all already in the file).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Replace the `LoanCard` function**

Replace the entire existing `function LoanCard({ loan, onClick }: ...) { ... }` block in `web/app/(app)/debt/page.tsx` with:

```tsx
function LoanCard({ loan, onClick }: { loan: Loan; onClick: () => void }) {
  const principal = num(loan.principal);
  const outstanding = num(loan.outstanding_balance ?? loan.principal);
  const progress = Math.max(0, Math.min(100, num(loan.progress_pct)));
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full flex-col rounded-card-sm border border-border bg-card p-5 text-left shadow-card transition-colors hover:border-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Landmark className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold capitalize tracking-tight">{loan.name}</p>
            <p className="text-xs text-muted">{TYPE_LABEL[loan.type] ?? loan.type}</p>
          </div>
        </div>
        {loan.interest_rate != null && (
          <Badge variant="secondary">{Number(loan.interest_rate)}% APR</Badge>
        )}
      </div>

      <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted">
        Remaining balance
      </p>
      <p data-numeric className="text-2xl font-extrabold tracking-tight">
        {formatCurrency(outstanding, { currency: loan.currency })}
      </p>
      <p className="text-xs text-muted">
        {Math.round(progress)}% paid · of {formatCurrency(principal, { currency: loan.currency })}
      </p>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-chip">
        <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-auto pt-4">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Monthly</p>
            <p data-numeric className="text-sm font-semibold">
              {loan.min_or_emi_amount != null
                ? `${formatCurrency(loan.min_or_emi_amount, { currency: loan.currency })}/mo`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Next due</p>
            <p data-numeric className="text-sm font-semibold">{loan.next_due_date ?? "—"}</p>
          </div>
        </div>
        <div className="mt-3 min-h-[1.5rem]">
          {loan.penalty_warning && (
            <Badge variant="warning">{loan.penalty_warning}</Badge>
          )}
        </div>
      </div>
    </button>
  );
}
```

Key changes vs the old card: `flex h-full flex-col` root + `mt-auto` footer (equal height via grid stretch); uppercase caption labels; `capitalize` on the name; `min-h-[1.5rem]` reserved penalty-chip row so badge-less cards keep the same height.

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Unit regression**

Run: `cd web && npm run test:unit`
Expected: all pass (cards are presentational; no test references them).

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/debt/page.tsx"
git commit -m "feat(debt): labeled, equal-height loan cards

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDn6fCM7yc2SgXAPdVZfZG"
```

---

## Task 2: `ResponsiveSheet` opt-in `aside` (two-pane desktop)

**Files:**
- Modify: `web/components/ui/responsive-sheet.tsx`

**Interfaces:**
- Consumes: `useIsDesktop`, Radix `Dialog`, `X` icon, `cn` (all already imported).
- Produces: `ResponsiveSheet` now accepts optional `aside?: React.ReactNode`. When `aside` is provided and on desktop, renders a two-pane layout (`children` left + `aside` right). On mobile, `aside` renders stacked after `children`. With no `aside`, behavior is unchanged.

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `web/components/ui/responsive-sheet.tsx` with:

```tsx
"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useIsDesktop } from "@/lib/shell/use-is-desktop";
import { cn } from "@/lib/utils";

export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  children,
  aside,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const twoPane = isDesktop && aside != null;

  const header = (
    <div className={cn("flex items-center justify-between", twoPane ? "px-5 pb-3 pt-5" : "mb-3")}>
      <Dialog.Title className="text-base font-extrabold tracking-tight">{title}</Dialog.Title>
      <Dialog.Close
        aria-label="Close"
        className="grid size-8 place-items-center rounded-full bg-chip text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X className="size-4" />
      </Dialog.Close>
    </div>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-card text-fg shadow-card focus:outline-none",
            !isDesktop &&
              "inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[22px] p-5 pb-[max(20px,env(safe-area-inset-bottom))] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
            isDesktop &&
              "left-1/2 top-1/2 max-h-[88vh] -translate-x-1/2 -translate-y-1/2 rounded-card data-[state=open]:animate-in data-[state=open]:zoom-in-95",
            isDesktop && !twoPane && "w-[min(92vw,520px)] overflow-y-auto p-5",
            twoPane && "w-[min(94vw,880px)] overflow-hidden",
          )}
        >
          {twoPane ? (
            <div className="flex h-full max-h-[88vh] flex-col">
              {header}
              <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
                <div className="shrink-0 overflow-y-auto border-l border-border">{aside}</div>
              </div>
            </div>
          ) : (
            <>
              {header}
              {children}
              {!isDesktop && aside}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

Notes: single-pane desktop keeps `w-[min(92vw,520px)] overflow-y-auto p-5` (same as before plus the height cap already added). Two-pane uses `overflow-hidden` on the content and scrolls each column independently within `max-h-[88vh]`.

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Unit regression**

Run: `cd web && npm run test:unit`
Expected: all pass (existing sheet consumers pass no `aside`).

- [ ] **Step 4: Commit**

```bash
git add web/components/ui/responsive-sheet.tsx
git commit -m "feat(ui): optional two-pane aside for ResponsiveSheet

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDn6fCM7yc2SgXAPdVZfZG"
```

---

## Task 3: Upcoming schedule — next 3 then paginate

**Files:**
- Modify: `web/components/debt/loan-detail.tsx` (the `UpcomingSchedule` function only)

**Interfaces:**
- Consumes: `useLoanSchedule`, `Skeleton`, `Table`/`TableBody`/`TableCell`/`TableHead`/`TableHeader`/`TableRow`, `Button`, `formatCurrency`, `PAGE` (all already imported/defined in the file).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Replace the `UpcomingSchedule` function**

Replace the entire existing `function UpcomingSchedule({ loan, open }: ...) { ... }` block in `web/components/debt/loan-detail.tsx` with:

```tsx
const PEEK = 3;

function UpcomingSchedule({ loan, open }: { loan: Loan; open: boolean }) {
  const schedule = useLoanSchedule(open ? loan.id : null);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const rows = schedule.data ?? [];
  const total = rows.length;
  const visible = expanded
    ? rows.slice(page * PAGE, page * PAGE + PAGE)
    : rows.slice(0, PEEK);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Upcoming schedule</h3>
      {schedule.isLoading ? (
        <Skeleton className="h-48" />
      ) : total === 0 ? (
        <p className="text-sm text-muted">No upcoming installments — loan is paid off.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.installment_no}</TableCell>
                  <TableCell>{r.due_date}</TableCell>
                  <TableCell data-numeric className="text-right">{formatCurrency(r.principal_component, { currency: loan.currency })}</TableCell>
                  <TableCell data-numeric className="text-right">{formatCurrency(r.interest_component, { currency: loan.currency })}</TableCell>
                  <TableCell data-numeric className="text-right">{formatCurrency(r.balance_after, { currency: loan.currency })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!expanded && total > PEEK && (
            <Button variant="outline" onClick={() => { setExpanded(true); setPage(0); }}>
              Show all ({total})
            </Button>
          )}

          {expanded && (
            <div className="space-y-2">
              {total > PAGE && (
                <div className="flex items-center justify-between text-sm">
                  <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    Previous
                  </Button>
                  <span className="text-muted">
                    {page * PAGE + 1}–{Math.min(page * PAGE + PAGE, total)} of {total}
                  </span>
                  <Button variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              )}
              <Button variant="ghost" onClick={() => { setExpanded(false); setPage(0); }}>
                Show less
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
```

Note: add `const PEEK = 3;` immediately after the existing `const PAGE = 12;` line (shown inline above as the first line of the block; if your editor inserts it inside the function, move it to module scope next to `PAGE`).

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Unit regression**

Run: `cd web && npm run test:unit`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add web/components/debt/loan-detail.tsx
git commit -m "feat(debt): upcoming schedule shows next 3 then paginates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDn6fCM7yc2SgXAPdVZfZG"
```

---

## Task 4: Info rail — glossary + analyst ask

**Files:**
- Create: `web/components/debt/loan-context.ts` (pure helper)
- Create: `web/components/debt/loan-context.test.ts` (vitest)
- Modify: `web/lib/icons.ts` (export `Info`, `ChevronRight`)
- Modify: `web/components/debt/loan-detail.tsx` (add `InfoRail` + `InfoRailBody`, wire as `aside`, add imports)

**Interfaces:**
- Consumes: `Loan` (`@/lib/api/loans`); `useAnalystAsk` (`@/lib/api/analyst`); `useIsDesktop` (`@/lib/shell/use-is-desktop`); `Info`, `ChevronRight` (`@/lib/icons`); `Input`, `Button` (already imported in `loan-detail.tsx`).
- Produces:
  - `loanContextPreamble(loan: Loan): string` — pure; semicolon-joined loan facts, omitting null fields.
  - `InfoRail({ loan }: { loan: Loan })` — collapsible rail; desktop strip/panel, mobile `<details>`.

- [ ] **Step 1: Write the failing test for `loanContextPreamble`**

Create `web/components/debt/loan-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loanContextPreamble } from "./loan-context";
import type { Loan } from "@/lib/api/loans";

const base = {
  id: "1",
  name: "Car Loan",
  type: "auto",
  currency: "USD",
  principal: "10000",
  outstanding_balance: "9100",
  interest_rate: "5",
  min_or_emi_amount: "300",
  next_due_date: "2026-02-01",
} as Loan;

describe("loanContextPreamble", () => {
  it("includes the key loan facts", () => {
    const s = loanContextPreamble(base);
    expect(s).toContain("Car Loan");
    expect(s).toContain("9100");
    expect(s).toContain("10000");
    expect(s).toContain("5% APR");
    expect(s).toContain("2026-02-01");
  });

  it("omits fields that are null/undefined", () => {
    const s = loanContextPreamble({
      ...base,
      interest_rate: null,
      min_or_emi_amount: null,
      next_due_date: null,
    } as Loan);
    expect(s).not.toContain("APR");
    expect(s).not.toContain("Monthly payment");
    expect(s).not.toContain("Next due");
  });

  it("falls back to principal when outstanding is missing", () => {
    const s = loanContextPreamble({ ...base, outstanding_balance: null } as Loan);
    expect(s).toContain("Outstanding balance: 10000");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm run test:unit -- loan-context`
Expected: FAIL — cannot resolve `./loan-context`.

- [ ] **Step 3: Implement `loan-context.ts`**

Create `web/components/debt/loan-context.ts`:

```ts
import type { Loan } from "@/lib/api/loans";

/** Compose a short, model-readable summary of a loan's key facts. Pure. */
export function loanContextPreamble(loan: Loan): string {
  const parts: (string | null)[] = [
    `Loan: ${loan.name} (${loan.type})`,
    `Outstanding balance: ${loan.outstanding_balance ?? loan.principal} ${loan.currency}`,
    `Original principal: ${loan.principal} ${loan.currency}`,
    loan.interest_rate != null ? `Interest rate: ${loan.interest_rate}% APR` : null,
    loan.min_or_emi_amount != null
      ? `Monthly payment: ${loan.min_or_emi_amount} ${loan.currency}`
      : null,
    loan.next_due_date ? `Next due: ${loan.next_due_date}` : null,
  ];
  return parts.filter((p): p is string => Boolean(p)).join("; ");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npm run test:unit -- loan-context`
Expected: PASS (3 tests).

- [ ] **Step 5: Export the two icons**

In `web/lib/icons.ts`, add `Info` and `ChevronRight` to BOTH the `import { ... } from "lucide-react"` block and the `export { ... }` block. After the edit the import block contains `ChevronRight,` (next to `ChevronLeft,`) and `Info,`; the export block contains `ChevronRight,` and `Info,`.

- [ ] **Step 6: Add imports to `loan-detail.tsx`**

In `web/components/debt/loan-detail.tsx`, add these imports alongside the existing ones (place near the other `@/lib` and `@/components` imports):

```tsx
import { useAnalystAsk } from "@/lib/api/analyst";
import { useIsDesktop } from "@/lib/shell/use-is-desktop";
import { ChevronRight, Info } from "@/lib/icons";
import { loanContextPreamble } from "@/components/debt/loan-context";
```

`Input` and `Button` are already imported. Confirm `useState` is already imported from `react` (it is).

- [ ] **Step 7: Add `InfoRailBody` and `InfoRail`**

Append to `web/components/debt/loan-detail.tsx` (e.g. just above the final `Metric` helper):

```tsx
const GLOSSARY: { term: string; def: string }[] = [
  { term: "Outstanding", def: "What you still owe — principal minus what you've repaid." },
  { term: "Paid to date", def: "Total of every payment you've logged." },
  { term: "Interest paid", def: "The portion of your payments that went to interest, not principal." },
  { term: "Next due", def: "The date of your next scheduled installment." },
  { term: "Monthly", def: "Your minimum or EMI payment each month." },
  { term: "APR", def: "Annual interest rate charged on the loan." },
];

const SUGGESTED = ["How fast can I pay this off?", "How much interest will I pay?"];

function InfoRailBody({ loan }: { loan: Loan }) {
  const ask = useAnalystAsk();
  const [q, setQ] = useState("");

  function submit(question: string) {
    const text = question.trim();
    if (!text) return;
    ask.mutate({ mode: "explain", question: `${loanContextPreamble(loan)}. ${text}` });
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">What these mean</h4>
        <dl className="space-y-2">
          {GLOSSARY.map((g) => (
            <div key={g.term}>
              <dt className="font-medium">{g.term}</dt>
              <dd className="text-xs text-muted">{g.def}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Ask the analyst</h4>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => submit(p)}
              className="rounded-full bg-chip px-2.5 py-1 text-xs text-muted hover:text-fg"
            >
              {p}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(q);
            setQ("");
          }}
          className="space-y-2"
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this loan…" />
          <Button type="submit" className="w-full" disabled={ask.isPending}>
            {ask.isPending ? "Thinking…" : "Ask"}
          </Button>
        </form>
        {ask.isError && <p className="text-xs text-destructive">Couldn&apos;t reach the analyst.</p>}
        {ask.data &&
          (ask.data.available === false ? (
            <p className="text-xs text-muted">AI help isn&apos;t configured yet.</p>
          ) : (
            <p className="whitespace-pre-wrap text-xs text-fg">{ask.data.answer}</p>
          ))}
      </div>
    </div>
  );
}

function InfoRail({ loan }: { loan: Loan }) {
  const isDesktop = useIsDesktop();
  const [expanded, setExpanded] = useState(false);

  if (!isDesktop) {
    return (
      <details className="mt-6 rounded-lg border border-border">
        <summary className="cursor-pointer list-none p-3 text-sm font-semibold">Info &amp; help</summary>
        <div className="border-t border-border p-3">
          <InfoRailBody loan={loan} />
        </div>
      </details>
    );
  }

  if (!expanded) {
    return (
      <div className="flex h-full w-12 justify-center pt-5">
        <button
          type="button"
          aria-label="Show info and help"
          onClick={() => setExpanded(true)}
          className="grid size-8 place-items-center rounded-full bg-chip text-muted hover:text-fg"
        >
          <Info className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="h-full w-[300px] overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Info &amp; help</h3>
        <button
          type="button"
          aria-label="Collapse info and help"
          onClick={() => setExpanded(false)}
          className="grid size-7 place-items-center rounded-full bg-chip text-muted hover:text-fg"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <InfoRailBody loan={loan} />
    </div>
  );
}
```

- [ ] **Step 8: Wire `InfoRail` as the sheet `aside`**

In `web/components/debt/loan-detail.tsx`, update the `LoanDetail` return so the `ResponsiveSheet` receives `aside` (only in the non-editing view):

```tsx
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={loan.name}
      aside={editing ? undefined : <InfoRail loan={loan} />}
    >
      {editing ? (
        <EditSection loan={loan} onDone={() => setEditing(false)} onDeleted={() => onOpenChange(false)} />
      ) : (
        <div className="space-y-6">
          <HeaderStats loan={loan} onEdit={() => setEditing(true)} />
          <PaymentHistory loan={loan} />
          <UpcomingSchedule loan={loan} open={open} />
          <PayoffCalculator loan={loan} />
        </div>
      )}
    </ResponsiveSheet>
  );
```

- [ ] **Step 9: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Full unit suite**

Run: `cd web && npm run test:unit`
Expected: all pass, including the new `loan-context` tests and existing `loan-form`.

- [ ] **Step 11: Manual verification**

With the dev stack up (`web` at `:3000`, backend `:8000`):
1. `/debt` — cards are equal height whether or not a card shows "Due soon"; each value has a label; names are Capitalized.
2. Open a loan (desktop) — popup is wider with a thin right strip showing an ⓘ button. Click it → glossary + "Ask the analyst" panel; the chevron collapses it back.
3. Type a question (or click a suggestion) → an answer renders, or "AI help isn't configured yet." if the LLM is off.
4. Narrow the window / mobile — the rail appears as an "Info & help" `<details>` below the content; no side-by-side.
5. "Upcoming schedule" shows 3 rows + "Show all (N)"; expand → 12/page with Previous/Next and "Show less".

- [ ] **Step 12: Commit**

```bash
git add web/lib/icons.ts web/components/debt/loan-context.ts web/components/debt/loan-context.test.ts web/components/debt/loan-detail.tsx
git commit -m "feat(debt): collapsible info+analyst rail in loan detail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDn6fCM7yc2SgXAPdVZfZG"
```

---

## Self-Review Notes

- **Spec coverage:** labeled equal-height cards (Task 1); `ResponsiveSheet` opt-in two-pane `aside`, default path unchanged (Task 2); upcoming schedule next-3 + 12/page pagination (Task 3); glossary + analyst ask with `available=false` fallback, mobile `<details>` fallback, pure tested `loanContextPreamble` (Task 4). Non-goals respected: no backend changes, analyst suggestions not rendered.
- **Type consistency:** `loanContextPreamble(loan: Loan): string` defined in Task 4 Step 3, consumed in Step 7 and tested in Step 1. `useAnalystAsk` body `{ mode: "explain", question }` matches `AnalystAskIn`. `aside?: React.ReactNode` defined in Task 2, supplied in Task 4 Step 8. `PEEK`/`PAGE` both module-scope constants in `loan-detail.tsx`.
- **Placeholder scan:** none — every code step shows full code.
- **Known cosmetic:** when the desktop rail is collapsed the sheet stays 880px wide (left content reclaims the freed space); acceptable per spec.
```
