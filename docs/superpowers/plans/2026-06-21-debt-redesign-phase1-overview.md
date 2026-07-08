# Debt Redesign — Phase 1: Overview Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/debt` overview with the approved mockup — overview ring, AI Smart Prioritization, Your Debts list, Payoff Projection chart, Scenario Simulator, and Next best step — all wired to real loans and the Phase 0 `useDebtPlan()` endpoint, with a routing switch on `?loan=<id>`.

**Architecture:** A pure, unit-tested `debt-math.ts` mirrors the backend amortization so the ring, projection chart, and live simulator are instant and consistent. Presentational overview components derive from `useLoans()` synchronously; the AI-branded `smart-prioritization` and `next-best-step` consume `useDebtPlan()` (real LLM strategy + deterministic numbers from Phase 0) and switch labels on `source`. `debt/page.tsx` becomes a thin switch: no `loan` param → Overview; `?loan=<id>` → the existing `LoanDetail` sheet (Phase 2 retires the popup for a routed detail page).

**Tech Stack:** Next.js (App Router, client components), React Query (`@tanstack/react-query`), recharts@^2.15.4 (dynamic-imported, ssr:false), Tailwind with per-theme CSS-var tokens, vitest + @testing-library/react.

## Global Constraints

- **Build with tokens, never hard-code the mockup's hex.** Use `bg-card`, `border-border`, `text-muted`, `bg-accent`, `bg-accent-soft`, `text-accent`, `bg-chip`, `rounded-card-sm`, `shadow-card`, and `data-numeric` on numeric values — exactly as `app/(app)/debt/page.tsx` and `components/ui/area-chart-impl.tsx` already do.
- **AI decides, math computes.** The AI-branded cards (`smart-prioritization`, `next-best-step`) take their strategy/extra/ordering/narrative AND their displayed money figures from the `DebtPlanOut` response (Phase 0 already computed those deterministically). The `scenario-simulator` is the user's own what-if — pure client `debt-math`, **not** AI-branded.
- **Honest fallback labeling.** When `useDebtPlan().data.source === "deterministic"` (or `available === false`), the prioritization heading drops "AI" framing → "Smart Prioritization" with a small "AI coaching is off" note. When `source === "ai"`, it reads "AI Smart Prioritization".
- **No new dependencies.** No slider library — use a native `<input type="range">`. recharts is already installed.
- `formatCurrency(value, { currency, compact })` from `@/lib/format`. Coerce all loan money/rate fields with a local `num()` (they arrive as `string | number | null`).
- Gate on `npm run typecheck` and `npm run test:unit` (repo-wide `next lint` is broken; do not rely on it).
- Money math uses **monthly** compounding (consistent with the backend `loans/service.py::_project` and the spec's "monthly amortization" decision). 600-month projection cap.

---

### Task 1: `debt-math.ts` — pure amortization helpers (+ tests)

**Files:**
- Create: `web/components/debt/debt-math.ts`
- Test: `web/components/debt/debt-math.test.ts`

**Interfaces:**
- Produces:
  - `type LoanLike = { id: string; name: string; outstanding_balance?: number | string | null; principal: number | string; interest_rate?: number | string | null; min_or_emi_amount?: number | string | null; currency?: string | null }`
  - `function num(v: unknown): number`
  - `function orderLoans(loans: LoanLike[], strategy: "snowball" | "avalanche"): LoanLike[]`
  - `function amortize(balance: number, annualRatePct: number, monthlyPayment: number): { months: number; totalInterest: number; totalPaid: number; series: number[]; neverPaysOff: boolean }`
  - `function aggregateProjection(loans: LoanLike[], extraMonthly: number, strategy: "snowball" | "avalanche"): { month: number; balance: number }[]`
  - `function savingsVsBaseline(loans: LoanLike[], extraMonthly: number, strategy: "snowball" | "avalanche"): { interestSaved: number; monthsSooner: number; baselinePayoffMonths: number; optimizedPayoffMonths: number }`
  - `function weightedAvgRate(loans: LoanLike[]): number`
  - `function totalsSummary(loans: LoanLike[]): { totalOutstanding: number; totalPrincipal: number; totalMonthly: number; pctPaid: number }`

- [ ] **Step 1: Write the failing tests**

Create `web/components/debt/debt-math.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  aggregateProjection,
  amortize,
  num,
  orderLoans,
  savingsVsBaseline,
  totalsSummary,
  weightedAvgRate,
  type LoanLike,
} from "./debt-math";

const card: LoanLike = {
  id: "card", name: "Card", outstanding_balance: 10000, principal: 10000,
  interest_rate: 18, min_or_emi_amount: 300, currency: "USD",
};
const auto: LoanLike = {
  id: "auto", name: "Auto", outstanding_balance: 4000, principal: 12000,
  interest_rate: 6, min_or_emi_amount: 250, currency: "USD",
};

describe("num", () => {
  it("coerces strings, null, undefined", () => {
    expect(num("12.5")).toBe(12.5);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
  });
});

describe("amortize", () => {
  it("pays off and accrues interest", () => {
    const r = amortize(10000, 18, 300);
    expect(r.neverPaysOff).toBe(false);
    expect(r.months).toBeGreaterThan(0);
    expect(r.totalInterest).toBeGreaterThan(0);
    expect(r.series[r.series.length - 1]).toBe(0);
  });
  it("flags neverPaysOff when payment <= monthly interest", () => {
    const r = amortize(10000, 18, 150); // monthly interest = 150
    expect(r.neverPaysOff).toBe(true);
  });
  it("a bigger payment costs less interest and finishes sooner", () => {
    const slow = amortize(10000, 18, 300);
    const fast = amortize(10000, 18, 500);
    expect(fast.months).toBeLessThan(slow.months);
    expect(fast.totalInterest).toBeLessThan(slow.totalInterest);
  });
});

describe("orderLoans", () => {
  it("snowball = smallest balance first", () => {
    expect(orderLoans([card, auto], "snowball").map((l) => l.id)).toEqual(["auto", "card"]);
  });
  it("avalanche = highest rate first", () => {
    expect(orderLoans([card, auto], "avalanche").map((l) => l.id)).toEqual(["card", "auto"]);
  });
});

describe("aggregateProjection", () => {
  it("starts at the summed balance and trends to zero", () => {
    const series = aggregateProjection([card, auto], 0, "avalanche");
    expect(series[0].balance).toBeGreaterThan(13000);
    expect(series[series.length - 1].balance).toBe(0);
  });
  it("extra payment shortens the series", () => {
    const base = aggregateProjection([card, auto], 0, "avalanche");
    const boosted = aggregateProjection([card, auto], 300, "avalanche");
    expect(boosted.length).toBeLessThan(base.length);
  });
});

describe("savingsVsBaseline", () => {
  it("extra payment saves interest and months", () => {
    const s = savingsVsBaseline([card, auto], 300, "avalanche");
    expect(s.interestSaved).toBeGreaterThan(0);
    expect(s.monthsSooner).toBeGreaterThan(0);
    expect(s.optimizedPayoffMonths).toBeLessThan(s.baselinePayoffMonths);
  });
});

describe("weightedAvgRate / totalsSummary", () => {
  it("weights APR by outstanding balance", () => {
    // (10000*18 + 4000*6) / 14000 = 14.57...
    expect(weightedAvgRate([card, auto])).toBeCloseTo(14.571, 2);
  });
  it("summarizes totals and percent paid", () => {
    const t = totalsSummary([card, auto]);
    expect(t.totalOutstanding).toBe(14000);
    expect(t.totalPrincipal).toBe(22000);
    expect(t.totalMonthly).toBe(550);
    expect(t.pctPaid).toBeCloseTo(36.36, 1); // (22000-14000)/22000
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run components/debt/debt-math.test.ts`
Expected: FAIL — `Failed to resolve import "./debt-math"`.

- [ ] **Step 3: Implement the module**

Create `web/components/debt/debt-math.ts`:

```ts
export type LoanLike = {
  id: string;
  name: string;
  outstanding_balance?: number | string | null;
  principal: number | string;
  interest_rate?: number | string | null;
  min_or_emi_amount?: number | string | null;
  currency?: string | null;
};

const MONTH_CAP = 600;

export function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function outstandingOf(loan: LoanLike): number {
  return num(loan.outstanding_balance ?? loan.principal);
}

function paymentOf(loan: LoanLike): number {
  const min = num(loan.min_or_emi_amount);
  // Fallback to 2% of outstanding so a payment-less loan still terminates.
  return min > 0 ? min : Math.max(1, outstandingOf(loan) * 0.02);
}

export function orderLoans(
  loans: LoanLike[],
  strategy: "snowball" | "avalanche",
): LoanLike[] {
  const copy = [...loans];
  if (strategy === "avalanche") {
    return copy.sort(
      (a, b) =>
        num(b.interest_rate) - num(a.interest_rate) ||
        outstandingOf(a) - outstandingOf(b),
    );
  }
  return copy.sort(
    (a, b) =>
      outstandingOf(a) - outstandingOf(b) ||
      num(b.interest_rate) - num(a.interest_rate),
  );
}

export function amortize(
  balance: number,
  annualRatePct: number,
  monthlyPayment: number,
): { months: number; totalInterest: number; totalPaid: number; series: number[]; neverPaysOff: boolean } {
  const rate = annualRatePct / 100 / 12;
  let bal = Math.max(0, balance);
  const series: number[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  if (bal > 0 && monthlyPayment <= bal * rate) {
    return { months: 0, totalInterest: 0, totalPaid: 0, series: [bal], neverPaysOff: true };
  }
  let months = 0;
  for (let i = 0; i < MONTH_CAP && bal > 0; i++) {
    const interest = bal * rate;
    const principal = Math.min(bal, monthlyPayment - interest);
    bal = Math.round((bal - principal) * 100) / 100;
    totalInterest += interest;
    totalPaid += principal + interest;
    months += 1;
    series.push(bal);
  }
  return {
    months,
    totalInterest: Math.round(totalInterest * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    series,
    neverPaysOff: false,
  };
}

// Per-month summed balances. Rank-1 loan (by strategy) gets the extra; others pay their minimum.
export function aggregateProjection(
  loans: LoanLike[],
  extraMonthly: number,
  strategy: "snowball" | "avalanche",
): { month: number; balance: number }[] {
  const ordered = orderLoans(loans, strategy);
  const targetId = ordered[0]?.id;
  const runs = loans.map((loan) =>
    amortize(
      outstandingOf(loan),
      num(loan.interest_rate),
      paymentOf(loan) + (loan.id === targetId ? extraMonthly : 0),
    ),
  );
  const horizon = Math.max(0, ...runs.map((r) => r.series.length));
  const out: { month: number; balance: number }[] = [
    { month: 0, balance: loans.reduce((a, l) => a + outstandingOf(l), 0) },
  ];
  for (let m = 0; m < horizon; m++) {
    const balance = runs.reduce((a, r) => a + (m < r.series.length ? r.series[m] : 0), 0);
    out.push({ month: m + 1, balance: Math.round(balance * 100) / 100 });
  }
  return out;
}

function payoffMonths(
  loans: LoanLike[],
  extraMonthly: number,
  strategy: "snowball" | "avalanche",
): { months: number; interest: number } {
  const ordered = orderLoans(loans, strategy);
  const targetId = ordered[0]?.id;
  let months = 0;
  let interest = 0;
  for (const loan of loans) {
    const r = amortize(
      outstandingOf(loan),
      num(loan.interest_rate),
      paymentOf(loan) + (loan.id === targetId ? extraMonthly : 0),
    );
    months = Math.max(months, r.months);
    interest += r.totalInterest;
  }
  return { months, interest: Math.round(interest * 100) / 100 };
}

export function savingsVsBaseline(
  loans: LoanLike[],
  extraMonthly: number,
  strategy: "snowball" | "avalanche",
): { interestSaved: number; monthsSooner: number; baselinePayoffMonths: number; optimizedPayoffMonths: number } {
  const base = payoffMonths(loans, 0, strategy);
  const opt = payoffMonths(loans, extraMonthly, strategy);
  return {
    interestSaved: Math.max(0, Math.round((base.interest - opt.interest) * 100) / 100),
    monthsSooner: Math.max(0, base.months - opt.months),
    baselinePayoffMonths: base.months,
    optimizedPayoffMonths: opt.months,
  };
}

export function weightedAvgRate(loans: LoanLike[]): number {
  const totalBal = loans.reduce((a, l) => a + outstandingOf(l), 0);
  if (totalBal <= 0) return 0;
  const weighted = loans.reduce((a, l) => a + outstandingOf(l) * num(l.interest_rate), 0);
  return weighted / totalBal;
}

export function totalsSummary(loans: LoanLike[]): {
  totalOutstanding: number;
  totalPrincipal: number;
  totalMonthly: number;
  pctPaid: number;
} {
  const totalOutstanding = loans.reduce((a, l) => a + outstandingOf(l), 0);
  const totalPrincipal = loans.reduce((a, l) => a + num(l.principal), 0);
  const totalMonthly = loans.reduce((a, l) => a + num(l.min_or_emi_amount), 0);
  const pctPaid = totalPrincipal > 0 ? ((totalPrincipal - totalOutstanding) / totalPrincipal) * 100 : 0;
  return { totalOutstanding, totalPrincipal, totalMonthly, pctPaid };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run components/debt/debt-math.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/debt-math.ts web/components/debt/debt-math.test.ts
git commit -m "feat(debt): pure amortization + projection math (debt-math.ts)"
```

---

### Task 2: Overview ring + totals header (`overview-ring.tsx`)

**Files:**
- Create: `web/components/debt/overview/overview-ring.tsx`
- Test: `web/components/debt/overview/overview-ring.test.tsx`

**Interfaces:**
- Consumes: `totalsSummary`, `weightedAvgRate`, `num`, `type LoanLike` from `../debt-math`.
- Produces: `function OverviewRing({ loans, currency }: { loans: LoanLike[]; currency: string }): JSX.Element` — total outstanding, animated SVG %-paid ring, total monthly, balance-weighted avg APR, and an "On track" chip when no loan carries a `penalty_warning` (the parent passes only the trimmed `LoanLike`, so penalty is derived upstream — see note).

Note: `LoanLike` has no `penalty_warning`. The "On track" chip is computed by the parent (`debt-overview.tsx`, Task 8) and passed as `onTrack: boolean`. Update the signature to `{ loans, currency, onTrack }`.

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/overview/overview-ring.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewRing } from "./overview-ring";
import type { LoanLike } from "../debt-math";

const loans: LoanLike[] = [
  { id: "a", name: "Card", outstanding_balance: 10000, principal: 10000, interest_rate: 18, min_or_emi_amount: 300, currency: "USD" },
  { id: "b", name: "Auto", outstanding_balance: 4000, principal: 12000, interest_rate: 6, min_or_emi_amount: 250, currency: "USD" },
];

describe("OverviewRing", () => {
  it("renders total, monthly, weighted APR, and on-track chip", () => {
    render(<OverviewRing loans={loans} currency="USD" onTrack />);
    expect(screen.getByText(/14,000/)).toBeInTheDocument(); // total outstanding
    expect(screen.getByText(/550/)).toBeInTheDocument(); // total monthly
    expect(screen.getByText(/14\.6%/)).toBeInTheDocument(); // weighted avg APR
    expect(screen.getByText(/On track/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/overview/overview-ring.test.tsx`
Expected: FAIL — cannot resolve `./overview-ring`.

- [ ] **Step 3: Implement the component**

Create `web/components/debt/overview/overview-ring.tsx`:

```tsx
"use client";

import { formatCurrency } from "@/lib/format";
import { totalsSummary, weightedAvgRate, type LoanLike } from "../debt-math";

export function OverviewRing({
  loans,
  currency,
  onTrack,
}: {
  loans: LoanLike[];
  currency: string;
  onTrack: boolean;
}) {
  const { totalOutstanding, totalMonthly, pctPaid } = totalsSummary(loans);
  const apr = weightedAvgRate(loans);
  const pct = Math.max(0, Math.min(100, pctPaid));
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-6">
        <div className="relative grid size-32 place-items-center">
          <svg viewBox="0 0 120 120" className="size-32 -rotate-90">
            <circle cx="60" cy="60" r={r} fill="none" stroke="var(--chip)" strokeWidth="12" />
            <circle
              cx="60" cy="60" r={r} fill="none" stroke="var(--accent)" strokeWidth="12"
              strokeLinecap="round" strokeDasharray={`${dash} ${circ}`}
              style={{ transition: "stroke-dasharray 700ms ease" }}
            />
          </svg>
          <div className="absolute text-center">
            <p data-numeric className="text-xl font-extrabold tracking-tight">{Math.round(pct)}%</p>
            <p className="text-[11px] text-muted">paid</p>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Total outstanding" value={formatCurrency(totalOutstanding, { currency })} />
          <Stat label="Total monthly" value={`${formatCurrency(totalMonthly, { currency })}/mo`} />
          <Stat label="Avg APR" value={`${apr.toFixed(1)}%`} />
        </div>

        {onTrack && (
          <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
            On track
          </span>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p data-numeric className="mt-0.5 text-lg font-extrabold tracking-tight">{value}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/debt/overview/overview-ring.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/overview/overview-ring.tsx web/components/debt/overview/overview-ring.test.tsx
git commit -m "feat(debt): overview ring + totals header"
```

---

### Task 3: Your Debts list with routing (`debt-list.tsx`)

**Files:**
- Create: `web/components/debt/overview/debt-list.tsx`
- Test: `web/components/debt/overview/debt-list.test.tsx`

**Interfaces:**
- Consumes: `useRouter` from `next/navigation`, `formatCurrency`, `num` from `../debt-math`, `type Loan` from `@/lib/api/loans`.
- Produces: `function DebtList({ loans }: { loans: Loan[] }): JSX.Element` — one keyboard-accessible row per loan (type icon, name, type, remaining, rate, monthly, next due, progress bar, chevron); clicking a row calls `router.push('/debt?loan=<id>')`.

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/overview/debt-list.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DebtList } from "./debt-list";
import type { Loan } from "@/lib/api/loans";

const loans = [
  { id: "card", name: "Card", type: "credit_card", outstanding_balance: 10000, principal: 10000, interest_rate: 18, min_or_emi_amount: 300, next_due_date: "2024-06-01", progress_pct: 0, currency: "USD" },
] as unknown as Loan[];

describe("DebtList", () => {
  it("renders a row and routes to the loan on click", () => {
    render(<DebtList loans={loans} />);
    fireEvent.click(screen.getByRole("button", { name: /Card/ }));
    expect(push).toHaveBeenCalledWith("/debt?loan=card");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/overview/debt-list.test.tsx`
Expected: FAIL — cannot resolve `./debt-list`.

- [ ] **Step 3: Implement the component**

Create `web/components/debt/overview/debt-list.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";
import { ChevronRight, Landmark } from "@/lib/icons";
import type { Loan } from "@/lib/api/loans";
import { num } from "../debt-math";

const TYPE_LABEL: Record<string, string> = {
  home: "Mortgage", auto: "Auto", education: "Student",
  personal: "Personal", credit_card: "Credit card", other: "Other",
};

export function DebtList({ loans }: { loans: Loan[] }) {
  const router = useRouter();
  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <h2 className="mb-3 text-base font-bold tracking-tight">Your debts</h2>
      <ul className="space-y-2">
        {loans.map((loan) => {
          const outstanding = num(loan.outstanding_balance ?? loan.principal);
          const progress = Math.max(0, Math.min(100, num(loan.progress_pct)));
          return (
            <li key={loan.id}>
              <button
                type="button"
                onClick={() => router.push(`/debt?loan=${loan.id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-accent/40"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Landmark className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold capitalize">{loan.name}</span>
                    <span data-numeric className="font-semibold">
                      {formatCurrency(outstanding, { currency: loan.currency })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>
                      {TYPE_LABEL[loan.type] ?? loan.type}
                      {loan.interest_rate != null ? ` · ${num(loan.interest_rate)}% APR` : ""}
                    </span>
                    <span>
                      {loan.min_or_emi_amount != null
                        ? `${formatCurrency(loan.min_or_emi_amount, { currency: loan.currency })}/mo`
                        : "—"}
                      {loan.next_due_date ? ` · due ${loan.next_due_date}` : ""}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-chip">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/debt/overview/debt-list.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/overview/debt-list.tsx web/components/debt/overview/debt-list.test.tsx
git commit -m "feat(debt): Your Debts list with routing to ?loan=<id>"
```

---

### Task 4: AI Smart Prioritization (`smart-prioritization.tsx`)

**Files:**
- Create: `web/components/debt/overview/smart-prioritization.tsx`
- Test: `web/components/debt/overview/smart-prioritization.test.tsx`

**Interfaces:**
- Consumes: `type DebtPlan` from `@/lib/api/analyst` (Phase 0: `components["schemas"]["DebtPlanOut"]`), `formatCurrency`, `Sparkles` from `@/lib/icons`.
- Produces: `function SmartPrioritization({ plan, currency, onApply }: { plan: DebtPlan; currency: string; onApply: (extra: number) => void }): JSX.Element`.
  - `source === "ai"` → heading "AI Smart Prioritization" (+ Sparkles); else "Smart Prioritization" + a muted "AI coaching is off — showing the math-based plan." note.
  - Renders `plan.headline`, the deterministic `plan.interest_saved` / `plan.months_sooner`, the `plan.ordered` rows (extra allocation + "Highest impact" badge where `impact === "Highest impact"`), and an "Apply plan" button calling `onApply(Number(plan.extra_monthly))`.

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/overview/smart-prioritization.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SmartPrioritization } from "./smart-prioritization";
import type { DebtPlan } from "@/lib/api/analyst";

const base = {
  strategy: "avalanche", extra_monthly: "200", headline: "Hit the card first",
  narrative: "", ordered: [
    { loan_id: "card", name: "Card", order: 1, extra_allocation: "200", rationale: "highest rate", impact: "Highest impact" },
  ],
  currency: "USD", interest_saved: "1234.50", months_sooner: 7,
  baseline_payoff_date: null, optimized_payoff_date: null, updated_at: "2026-06-21T00:00:00Z",
} as const;

describe("SmartPrioritization", () => {
  it("AI source shows AI heading and applies the plan's extra", () => {
    const onApply = vi.fn();
    render(<SmartPrioritization plan={{ ...base, available: true, source: "ai" } as unknown as DebtPlan} currency="USD" onApply={onApply} />);
    expect(screen.getByText(/AI Smart Prioritization/i)).toBeInTheDocument();
    expect(screen.getByText(/Hit the card first/)).toBeInTheDocument();
    expect(screen.getByText(/Highest impact/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Apply plan/i }));
    expect(onApply).toHaveBeenCalledWith(200);
  });
  it("deterministic source drops AI framing and shows the off note", () => {
    render(<SmartPrioritization plan={{ ...base, available: false, source: "deterministic" } as unknown as DebtPlan} currency="USD" onApply={vi.fn()} />);
    expect(screen.queryByText(/AI Smart Prioritization/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Smart Prioritization/i)).toBeInTheDocument();
    expect(screen.getByText(/AI coaching is off/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/overview/smart-prioritization.test.tsx`
Expected: FAIL — cannot resolve `./smart-prioritization`.

- [ ] **Step 3: Implement the component**

Create `web/components/debt/overview/smart-prioritization.tsx`:

```tsx
"use client";

import { formatCurrency } from "@/lib/format";
import { Sparkles } from "@/lib/icons";
import type { DebtPlan } from "@/lib/api/analyst";

export function SmartPrioritization({
  plan,
  currency,
  onApply,
}: {
  plan: DebtPlan;
  currency: string;
  onApply: (extra: number) => void;
}) {
  const isAi = plan.source === "ai";
  const num = (v: unknown) => Number(v ?? 0);

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2">
        {isAi && <Sparkles className="size-4 text-accent" />}
        <h2 className="text-base font-bold tracking-tight">
          {isAi ? "AI Smart Prioritization" : "Smart Prioritization"}
        </h2>
      </div>
      {!isAi && (
        <p className="mt-1 text-xs text-muted">AI coaching is off — showing the math-based plan.</p>
      )}

      <p className="mt-2 text-sm">{plan.headline}</p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-chip p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted">Interest saved</p>
          <p data-numeric className="text-lg font-extrabold tracking-tight">
            {formatCurrency(num(plan.interest_saved), { currency })}
          </p>
        </div>
        <div className="rounded-lg bg-chip p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted">Sooner</p>
          <p data-numeric className="text-lg font-extrabold tracking-tight">
            {plan.months_sooner} mo
          </p>
        </div>
      </div>

      <ol className="mt-3 space-y-2">
        {plan.ordered.map((item) => (
          <li key={item.loan_id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
              {item.order}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium capitalize">{item.name}</span>
                {item.impact === "Highest impact" && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                    Highest impact
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                +{formatCurrency(num(item.extra_allocation), { currency })}/mo · {item.rationale}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => onApply(num(plan.extra_monthly))}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[var(--on-accent)]"
      >
        Apply plan
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/debt/overview/smart-prioritization.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/overview/smart-prioritization.tsx web/components/debt/overview/smart-prioritization.test.tsx
git commit -m "feat(debt): AI Smart Prioritization card with honest fallback labeling"
```

---

### Task 5: Payoff Projection chart (`payoff-projection.tsx` + impl)

**Files:**
- Create: `web/components/debt/overview/payoff-projection.tsx`
- Create: `web/components/debt/overview/payoff-projection-impl.tsx`
- Test: `web/components/debt/overview/payoff-projection.test.tsx`

**Interfaces:**
- Consumes: `aggregateProjection`, `type LoanLike` from `../debt-math`; `next/dynamic`; `recharts`.
- Produces:
  - `type ProjectionPoint = { label: string; current: number; plan: number }`
  - `function PayoffProjection({ loans, extraMonthly, strategy, monthsSooner, currency }: { loans: LoanLike[]; extraMonthly: number; strategy: "snowball" | "avalanche"; monthsSooner: number; currency: string }): JSX.Element` — zips a current (extra 0) and plan (extra) `aggregateProjection` into one series and renders the dynamic chart with an "N months sooner" callout.

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/overview/payoff-projection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Stub the dynamic recharts impl so the test stays DOM-light.
vi.mock("./payoff-projection-impl", () => ({
  PayoffProjectionImpl: () => <div data-testid="chart" />,
}));

import { PayoffProjection } from "./payoff-projection";
import type { LoanLike } from "../debt-math";

const loans: LoanLike[] = [
  { id: "a", name: "Card", outstanding_balance: 10000, principal: 10000, interest_rate: 18, min_or_emi_amount: 300, currency: "USD" },
];

describe("PayoffProjection", () => {
  it("renders the chart and the months-sooner callout", () => {
    render(<PayoffProjection loans={loans} extraMonthly={200} strategy="avalanche" monthsSooner={7} currency="USD" />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByText(/7 months sooner/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/overview/payoff-projection.test.tsx`
Expected: FAIL — cannot resolve `./payoff-projection`.

- [ ] **Step 3: Implement the wrapper**

Create `web/components/debt/overview/payoff-projection.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { aggregateProjection, type LoanLike } from "../debt-math";

export type ProjectionPoint = { label: string; current: number; plan: number };

const Impl = dynamic(
  () => import("./payoff-projection-impl").then((m) => m.PayoffProjectionImpl),
  { ssr: false, loading: () => <div className="h-[240px] w-full animate-pulse rounded-card-sm bg-chip" /> },
);

export function PayoffProjection({
  loans,
  extraMonthly,
  strategy,
  monthsSooner,
  currency,
}: {
  loans: LoanLike[];
  extraMonthly: number;
  strategy: "snowball" | "avalanche";
  monthsSooner: number;
  currency: string;
}) {
  const data = useMemo<ProjectionPoint[]>(() => {
    const current = aggregateProjection(loans, 0, strategy);
    const plan = aggregateProjection(loans, extraMonthly, strategy);
    const horizon = Math.max(current.length, plan.length);
    const out: ProjectionPoint[] = [];
    for (let i = 0; i < horizon; i++) {
      out.push({
        label: `M${i}`,
        current: current[i]?.balance ?? 0,
        plan: plan[i]?.balance ?? 0,
      });
    }
    return out;
  }, [loans, extraMonthly, strategy]);

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold tracking-tight">Payoff projection</h2>
        {monthsSooner > 0 && (
          <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
            {monthsSooner} months sooner
          </span>
        )}
      </div>
      <Impl data={data} currency={currency} />
    </section>
  );
}
```

- [ ] **Step 4: Implement the recharts impl**

Create `web/components/debt/overview/payoff-projection-impl.tsx` (mirrors `components/ui/area-chart-impl.tsx` token usage):

```tsx
"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";
import type { ProjectionPoint } from "./payoff-projection";

export function PayoffProjectionImpl({
  data,
  currency,
}: {
  data: ProjectionPoint[];
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} minTickGap={32} />
        <YAxis
          width={48}
          tickFormatter={(v) => formatCurrency(v, { currency, compact: true })}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
        />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            color: "var(--fg)",
            fontSize: 12,
          }}
          formatter={(value: number, name) => [formatCurrency(value, { currency }), name === "plan" ? "AI plan" : "Current"]}
        />
        <Line type="monotone" dataKey="current" stroke="var(--muted)" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="plan" stroke="var(--accent)" strokeWidth={2.6} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run components/debt/overview/payoff-projection.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/components/debt/overview/payoff-projection.tsx web/components/debt/overview/payoff-projection-impl.tsx web/components/debt/overview/payoff-projection.test.tsx
git commit -m "feat(debt): payoff projection chart (current vs AI plan)"
```

---

### Task 6: Scenario Simulator (`scenario-simulator.tsx`)

**Files:**
- Create: `web/components/debt/overview/scenario-simulator.tsx`
- Test: `web/components/debt/overview/scenario-simulator.test.tsx`

**Interfaces:**
- Consumes: `savingsVsBaseline`, `type LoanLike` from `../debt-math`; `formatCurrency`; React `useState`/`useImperativeHandle`/`forwardRef`.
- Produces: `const ScenarioSimulator = forwardRef<{ setExtra: (n: number) => void }, { loans: LoanLike[]; strategy: "snowball" | "avalanche"; currency: string }>(...)` — a native range slider ($0–$2000), live `savingsVsBaseline` output (interest saved + months sooner). Exposes `setExtra` via ref so "Apply plan" (Task 4) can drive it. **Not AI-branded.**

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/overview/scenario-simulator.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScenarioSimulator } from "./scenario-simulator";
import type { LoanLike } from "../debt-math";

const loans: LoanLike[] = [
  { id: "a", name: "Card", outstanding_balance: 10000, principal: 10000, interest_rate: 18, min_or_emi_amount: 300, currency: "USD" },
];

describe("ScenarioSimulator", () => {
  it("updates savings when the slider moves", () => {
    render(<ScenarioSimulator loans={loans} strategy="avalanche" currency="USD" />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "300" } });
    expect(screen.getByText(/\$300/)).toBeInTheDocument(); // extra label
    // Interest-saved figure becomes non-zero text
    expect(screen.getByTestId("sim-interest-saved").textContent).not.toMatch(/\$0\.00$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/overview/scenario-simulator.test.tsx`
Expected: FAIL — cannot resolve `./scenario-simulator`.

- [ ] **Step 3: Implement the component**

Create `web/components/debt/overview/scenario-simulator.tsx`:

```tsx
"use client";

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { savingsVsBaseline, type LoanLike } from "../debt-math";

export type SimulatorHandle = { setExtra: (n: number) => void };

export const ScenarioSimulator = forwardRef<
  SimulatorHandle,
  { loans: LoanLike[]; strategy: "snowball" | "avalanche"; currency: string }
>(function ScenarioSimulator({ loans, strategy, currency }, ref) {
  const [extra, setExtra] = useState(0);
  useImperativeHandle(ref, () => ({ setExtra: (n) => setExtra(Math.round(n)) }), []);

  const savings = useMemo(
    () => savingsVsBaseline(loans, extra, strategy),
    [loans, extra, strategy],
  );

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <h2 className="text-base font-bold tracking-tight">What if you paid more?</h2>
      <p className="mt-1 text-xs text-muted">Drag to see how an extra monthly payment changes your payoff.</p>

      <div className="mt-4 flex items-center gap-4">
        <input
          type="range"
          min={0}
          max={2000}
          step={25}
          value={extra}
          onChange={(e) => setExtra(Number(e.target.value))}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-chip accent-[var(--accent)]"
          aria-label="Extra monthly payment"
        />
        <span data-numeric className="w-20 text-right text-sm font-bold">
          {formatCurrency(extra, { currency })}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-chip p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted">Interest saved</p>
          <p data-testid="sim-interest-saved" data-numeric className="text-lg font-extrabold tracking-tight">
            {formatCurrency(savings.interestSaved, { currency })}
          </p>
        </div>
        <div className="rounded-lg bg-chip p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted">Sooner</p>
          <p data-numeric className="text-lg font-extrabold tracking-tight">{savings.monthsSooner} mo</p>
        </div>
      </div>
    </section>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/debt/overview/scenario-simulator.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/overview/scenario-simulator.tsx web/components/debt/overview/scenario-simulator.test.tsx
git commit -m "feat(debt): scenario simulator (client what-if, not AI-branded)"
```

---

### Task 7: Next best step (`next-best-step.tsx`)

**Files:**
- Create: `web/components/debt/overview/next-best-step.tsx`
- Test: `web/components/debt/overview/next-best-step.test.tsx`

**Interfaces:**
- Consumes: `type DebtPlan` from `@/lib/api/analyst`; `useRouter` from `next/navigation`; `Zap` from `@/lib/icons`.
- Produces: `function NextBestStep({ plan, onDismiss }: { plan: DebtPlan; onDismiss: () => void }): JSX.Element | null` — renders a bar from `plan.ordered[0]` ("Set up payment" routes to that loan's detail; "Not now" calls `onDismiss`). Returns `null` when `ordered` is empty.

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/overview/next-best-step.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { NextBestStep } from "./next-best-step";
import type { DebtPlan } from "@/lib/api/analyst";

const plan = {
  source: "ai", strategy: "avalanche", ordered: [
    { loan_id: "card", name: "Card", order: 1, extra_allocation: "200", rationale: "highest rate", impact: "Highest impact" },
  ],
} as unknown as DebtPlan;

describe("NextBestStep", () => {
  it("routes to the top loan and dismisses", () => {
    const onDismiss = vi.fn();
    render(<NextBestStep plan={plan} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /Set up payment/i }));
    expect(push).toHaveBeenCalledWith("/debt?loan=card");
    fireEvent.click(screen.getByRole("button", { name: /Not now/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/overview/next-best-step.test.tsx`
Expected: FAIL — cannot resolve `./next-best-step`.

- [ ] **Step 3: Implement the component**

Create `web/components/debt/overview/next-best-step.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Zap } from "@/lib/icons";
import type { DebtPlan } from "@/lib/api/analyst";

export function NextBestStep({
  plan,
  onDismiss,
}: {
  plan: DebtPlan;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const top = plan.ordered[0];
  if (!top) return null;

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-card-sm border border-border bg-accent-soft p-4 shadow-card">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-[var(--on-accent)]">
        <Zap className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Next best step</p>
        <p className="text-xs text-muted">
          Put your extra toward <span className="font-medium capitalize">{top.name}</span> — {top.rationale}.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => router.push(`/debt?loan=${top.loan_id}`)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-[var(--on-accent)]"
        >
          Set up payment
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/debt/overview/next-best-step.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/overview/next-best-step.tsx web/components/debt/overview/next-best-step.test.tsx
git commit -m "feat(debt): next best step bar from debt-plan top item"
```

---

### Task 8: Compose overview + rewire `debt/page.tsx` routing switch

**Files:**
- Create: `web/components/debt/overview/debt-overview.tsx`
- Modify: `web/app/(app)/debt/page.tsx`
- Test: `web/components/debt/overview/debt-overview.test.tsx`

**Interfaces:**
- Consumes: every Task 2–7 component; `useDebtPlan` from `@/lib/api/analyst`; `type Loan` from `@/lib/api/loans`; `SimulatorHandle`.
- Produces: `function DebtOverview({ loans }: { loans: Loan[] }): JSX.Element` — composes ring, smart-prioritization, projection, simulator, debt-list, next-best-step; owns the shared `strategy`/`extraMonthly` state and the simulator ref so "Apply plan" sets the simulator and the projection. Zero loans → empty hero (hides chart/simulator/prioritization, keeps the page's "Add loan").

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/overview/debt-overview.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/analyst", () => ({
  useDebtPlan: () => ({
    data: {
      available: true, source: "ai", strategy: "avalanche", extra_monthly: "200",
      headline: "Hit the card first", narrative: "", currency: "USD",
      interest_saved: "1000", months_sooner: 5, ordered: [
        { loan_id: "card", name: "Card", order: 1, extra_allocation: "200", rationale: "rate", impact: "Highest impact" },
      ],
      baseline_payoff_date: null, optimized_payoff_date: null, updated_at: "2026-06-21T00:00:00Z",
    },
    isLoading: false,
  }),
}));
vi.mock("./payoff-projection-impl", () => ({ PayoffProjectionImpl: () => <div data-testid="chart" /> }));

import { DebtOverview } from "./debt-overview";
import type { Loan } from "@/lib/api/loans";

const loans = [
  { id: "card", name: "Card", type: "credit_card", outstanding_balance: 10000, principal: 10000, interest_rate: 18, min_or_emi_amount: 300, next_due_date: "2024-06-01", progress_pct: 0, currency: "USD", penalty_warning: null },
] as unknown as Loan[];

describe("DebtOverview", () => {
  it("renders the surfaces from real loans + plan", () => {
    render(<DebtOverview loans={loans} />);
    expect(screen.getByText(/AI Smart Prioritization/i)).toBeInTheDocument();
    expect(screen.getByText(/Your debts/i)).toBeInTheDocument();
    expect(screen.getByText(/What if you paid more/i)).toBeInTheDocument();
  });
  it("zero loans shows the empty hero and hides AI cards", () => {
    render(<DebtOverview loans={[]} />);
    expect(screen.getByText(/No debts yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Smart Prioritization/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/overview/debt-overview.test.tsx`
Expected: FAIL — cannot resolve `./debt-overview`.

- [ ] **Step 3: Implement the composition**

Create `web/components/debt/overview/debt-overview.tsx`:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { useDebtPlan } from "@/lib/api/analyst";
import type { Loan } from "@/lib/api/loans";
import { Skeleton } from "@/components/ui/skeleton";
import { num, type LoanLike } from "../debt-math";
import { OverviewRing } from "./overview-ring";
import { SmartPrioritization } from "./smart-prioritization";
import { PayoffProjection } from "./payoff-projection";
import { ScenarioSimulator, type SimulatorHandle } from "./scenario-simulator";
import { DebtList } from "./debt-list";
import { NextBestStep } from "./next-best-step";

export function DebtOverview({ loans }: { loans: Loan[] }) {
  const plan = useDebtPlan();
  const simRef = useRef<SimulatorHandle>(null);
  const [extraMonthly, setExtraMonthly] = useState(0);
  const [stepDismissed, setStepDismissed] = useState(false);

  const currency = loans[0]?.currency ?? "USD";
  const onTrack = loans.every((l) => !l.penalty_warning);
  const strategy = (plan.data?.strategy === "snowball" ? "snowball" : "avalanche") as "snowball" | "avalanche";

  const loanLikes = useMemo<LoanLike[]>(
    () =>
      loans.map((l) => ({
        id: l.id, name: l.name,
        outstanding_balance: l.outstanding_balance, principal: l.principal,
        interest_rate: l.interest_rate, min_or_emi_amount: l.min_or_emi_amount, currency: l.currency,
      })),
    [loans],
  );

  if (loans.length === 0) {
    return (
      <div className="rounded-card-sm border border-border bg-card py-16 text-center shadow-card">
        <p className="text-base font-semibold">No debts yet</p>
        <p className="mt-1 text-sm text-muted">Add a loan to see your payoff plan, projection, and savings.</p>
      </div>
    );
  }

  const apply = (extra: number) => {
    setExtraMonthly(extra);
    simRef.current?.setExtra(extra);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <OverviewRing loans={loanLikes} currency={currency} onTrack={onTrack} />
        {plan.isLoading || !plan.data ? (
          <Skeleton className="h-48" />
        ) : (
          <SmartPrioritization plan={plan.data} currency={currency} onApply={apply} />
        )}
        <PayoffProjection
          loans={loanLikes}
          extraMonthly={extraMonthly || num(plan.data?.extra_monthly)}
          strategy={strategy}
          monthsSooner={plan.data?.months_sooner ?? 0}
          currency={currency}
        />
        <ScenarioSimulator ref={simRef} loans={loanLikes} strategy={strategy} currency={currency} />
      </div>
      <div className="space-y-4">
        {plan.data && !stepDismissed && (
          <NextBestStep plan={plan.data} onDismiss={() => setStepDismissed(true)} />
        )}
        <DebtList loans={loans} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewire the page to a routing switch**

Replace the body of `web/app/(app)/debt/page.tsx` so it switches on `?loan=<id>`: no param → `DebtOverview`; valid id → existing `LoanDetail` sheet (Phase 2 replaces this with the routed detail page). Keep the existing `NewLoanDialog`, loading/error states, and `SectionIntro`. Remove the old `LoanCard`, `PayoffStrategyCard`, and the inline totals (now inside `DebtOverview`).

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useCreateLoan, useLoans } from "@/lib/api/loans";
import { LoanDetail } from "@/components/debt/loan-detail";
import { LoanForm } from "@/components/debt/loan-form";
import { DebtOverview } from "@/components/debt/overview/debt-overview";
import { SectionIntro } from "@/components/insights/section-intro";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export default function DebtPage() {
  const loans = useLoans();
  const params = useSearchParams();
  const router = useRouter();
  const loanId = params.get("loan");
  const selected = useMemo(
    () => (loanId ? (loans.data ?? []).find((l) => l.id === loanId) ?? null : null),
    [loanId, loans.data],
  );

  return (
    <div className="space-y-4">
      <SectionIntro title="Debt" blurb="Balances, payoff timelines, and what extra payments would do." />
      <div className="flex justify-end">
        <NewLoanDialog />
      </div>

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
      ) : (
        <DebtOverview loans={loans.data ?? []} />
      )}

      {selected && (
        <LoanDetail
          loan={selected}
          open={Boolean(selected)}
          onOpenChange={(v) => !v && router.push("/debt")}
        />
      )}
    </div>
  );
}

function NewLoanDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateLoan();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add loan</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add loan</DialogTitle>
        </DialogHeader>
        <LoanForm
          pending={create.isPending}
          submitLabel="Add loan"
          onSubmit={async (payload) => {
            try {
              await create.mutateAsync(payload);
              toast.success("Loan added");
              setOpen(false);
            } catch {
              toast.error("Couldn't add loan");
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
```

Note: an unknown `?loan=` id falls through to `selected = null` → renders the overview (spec: "Unknown `?loan=` id → render overview (no crash).").

- [ ] **Step 5: Run the component test + typecheck + full unit suite**

Run: `cd web && npx vitest run components/debt/overview/debt-overview.test.tsx`
Expected: PASS

Run: `cd web && npm run typecheck`
Expected: PASS (no errors)

Run: `cd web && npm run test:unit`
Expected: PASS (all, including the pre-existing `loan-context`/`loan-form` suites)

- [ ] **Step 6: Commit**

```bash
git add web/components/debt/overview/debt-overview.tsx "web/app/(app)/debt/page.tsx" web/components/debt/overview/debt-overview.test.tsx
git commit -m "feat(debt): compose overview surface + route debt page on ?loan="
```

---

## Self-Review

**Spec coverage (Phase 1 scope, design §"Phase 1 — Overview"):**
- `debt-math.ts` pure helpers (`amortize`, `aggregateProjection`, `savingsVsBaseline`, `weightedAvgRate`, `totalsSummary`) + unit tests incl. `neverPaysOff`/edge → Task 1. ✓
- Debt Overview card: total, animated %-paid ring, total monthly, weighted avg APR, "On track" chip → Task 2. ✓
- AI Smart Prioritization: `useDebtPlan` strategy + `ordered` + "Highest impact" + deterministic `interest_saved`/`months_sooner` + honest fallback labeling; "Apply plan" sets the simulator → Tasks 4, 8. ✓
- Your Debts rows + `router.push('/debt?loan=<id>')`, keyboard-accessible → Task 3. ✓
- Payoff Projection (recharts, current vs AI plan, "N months sooner") → Task 5. ✓
- Scenario Simulator ($0–$2000 slider, live `savingsVsBaseline`, not AI-branded) → Task 6. ✓
- Next best step from `ordered[0]` ("Set up payment" routes; "Not now" dismisses for session) → Task 7. ✓
- Routing switch on `?loan=` (no param → overview; unknown id → overview) → Task 8. ✓
- Empty/loading/error states, zero-loans empty hero → Tasks 8 (page + overview). ✓
- "Apply plan" persistence is **out of scope** (no write endpoint) — the button only drives local simulator/projection state, per spec §Out of scope. ✓

**Decisions flagged (consistent with spec phasing):**
- `?loan=<id>` in Phase 1 still opens the existing `LoanDetail` sheet; **Phase 2** swaps it for the routed detail page and retires the popup. This keeps Phase 1 independently shippable with no regression.
- No slider component exists → native `<input type="range">` with `accent-[var(--accent)]`; avoids a new dependency per Global Constraints.
- "Apply plan" / simulator coupling uses a `forwardRef` `SimulatorHandle` rather than lifting all simulator state, keeping the simulator's debounced internal state local.

**Placeholder scan:** none — every step has full code or an exact command + expected output.

**Type consistency:** `LoanLike`, `orderLoans`, `aggregateProjection`, `savingsVsBaseline`, `totalsSummary`, `weightedAvgRate`, `num` are defined in Task 1 and consumed with identical signatures in Tasks 2/5/6/8. `DebtPlan` (= `DebtPlanOut`) field names (`source`, `strategy`, `extra_monthly`, `headline`, `interest_saved`, `months_sooner`, `ordered[].{loan_id,name,order,extra_allocation,rationale,impact}`) match the Phase 0 Pydantic schema and the regenerated `api-schema.ts`. `SimulatorHandle.setExtra` matches between Task 6 (definition) and Task 8 (caller).

**Risk note:** recharts `LineChart` with two `<Line>` series is standard; the impl mirrors the existing `area-chart-impl.tsx` token usage exactly. The `debt-overview.test.tsx` mocks `payoff-projection-impl` and `useDebtPlan` to stay DOM-light, mirroring how other component tests avoid the dynamic recharts import.
