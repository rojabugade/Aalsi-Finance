# Loan Detail Page Redesign + Neon Nights Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the routed loan detail page (`/debt?loan=<id>`) to the approved mockup — image hero with a real stat strip + due status, re-laid loan-details card, payoff-comparison chart with an optimize panel, scenario simulator + payment history, and the existing AI Coach as a right rail — plus a new app-wide "Neon Nights" theme.

**Architecture:** Pure frontend. Add a new `midnight` palette to the existing CSS-var theme system. Build focused new components under `web/components/debt/detail/` (`loan-images.ts`, `loan-hero.tsx`, `payoff-comparison.tsx` + dynamic `-impl`, `edit-loan-sheet.tsx`), restyle `loan-info-card.tsx`, and rewrite the `loan-detail-page.tsx` composition. Reuse existing `sections.tsx`, `ScenarioSimulator`, `AiCoach`, and `debt-math` helpers — no backend changes.

**Tech Stack:** Next.js App Router client components, Tailwind CSS-var tokens, recharts (dynamic import), Radix-based `ui/sheet.tsx`, React Query loan/analyst hooks, vitest + @testing-library/react.

## Global Constraints

- **Tokens, never hex** in components — use `bg-card`, `border-border`, `text-muted`, `bg-accent-soft`, `text-accent`, `bg-accent`, `text-[var(--on-accent)]`, `bg-chip`, `rounded-card-sm`, `shadow-card`, `data-numeric`. Hex is allowed **only** inside the `globals.css` theme token block (Task 1).
- **Real data only** — no lender, loan number, asset subtitle, fabricated deltas, or refinance rates. Every figure comes from `LoanOut`, the loan/analyst endpoints, or `debt-math`. A field that is null renders `—` or is omitted.
- **Reuse, don't duplicate:** `amortize`, `savingsVsBaseline`, `num`, `type LoanLike` from `components/debt/debt-math.ts`; `ScenarioSimulator` from `components/debt/overview/scenario-simulator.tsx`; `AiCoach` from `components/debt/analyst/ai-coach.tsx`; sections from `components/debt/detail/sections.tsx`; `Sheet`/`SheetContent`/`SheetTitle` from `components/ui/sheet.tsx`.
- All commands run from `web/`. Gate every task on the test command shown; final task also runs `npm run typecheck`.

## Reference signatures (already exist — do not redefine)

```ts
// components/debt/debt-math.ts
type LoanLike = { id: string; name: string; outstanding_balance?: number|string|null;
  principal: number|string; interest_rate?: number|string|null;
  min_or_emi_amount?: number|string|null; currency?: string|null };
function num(v: unknown): number;
function amortize(balance: number, annualRatePct: number, monthlyPayment: number):
  { months: number; totalInterest: number; totalPaid: number; series: number[]; neverPaysOff: boolean };
function savingsVsBaseline(loans: LoanLike[], extraMonthly: number, strategy: "snowball"|"avalanche"):
  { interestSaved: number; monthsSooner: number; baselinePayoffMonths: number; optimizedPayoffMonths: number };

// components/debt/overview/scenario-simulator.tsx
const ScenarioSimulator: React.FC<{ loans: LoanLike[]; strategy: "snowball"|"avalanche"; currency: string }>;

// components/debt/analyst/ai-coach.tsx
function AiCoach(props: { threadId: string; range: { from: string; to: string }; plan?: DebtPlan|null; preamble?: string }): JSX.Element;

// lib/api/analyst.ts
type DebtPlan = { available: boolean; source: "ai"|"deterministic"; strategy: string;
  extra_monthly: string; interest_saved: string; months_sooner: number; currency: string; /* … */ };
function useDebtPlan(): { data?: DebtPlan };

// components/debt/debt-context.ts
function loanCoachPreamble(loan: Loan, plan?: DebtPlan|null): string;

// lib/api/loans.ts
type Loan = components["schemas"]["LoanOut"]; // fields: name,type,schedule_kind,compounding,principal,
//   currency,interest_rate,min_or_emi_amount,due_day,start_date,end_date,next_due_date,penalty_warning,
//   outstanding_balance,total_paid,total_principal_paid,total_interest_paid,progress_pct
```

---

### Task 1: Add the "Neon Nights" theme (`midnight` palette)

**Files:**
- Modify: `web/lib/theme/themes.ts`
- Modify: `web/app/globals.css`
- Test: `web/lib/theme/themes.test.ts`

**Interfaces:**
- Produces: a registered theme id `"midnight-dark"`, palette key `"midnight"`, display name `"Neon Nights"`.

- [ ] **Step 1: Write the failing test**

In `web/lib/theme/themes.test.ts`, the first test loops palette keys asserting each is a registered id. Add `"midnight"` to that loop array. Add a new test:

```ts
import { THEMES, PALETTES } from "./themes";

it("registers Neon Nights (midnight) as a dark-only theme", () => {
  expect(PALETTES).toContain("midnight");
  const t = THEMES.find((x) => x.palette === "midnight");
  expect(t).toBeDefined();
  expect(t!.name).toBe("Neon Nights");
  expect(t!.id).toBe("midnight-dark");
  expect(t!.modes).toEqual(["dark"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- themes.test.ts`
Expected: FAIL — `PALETTES` does not contain `"midnight"`.

- [ ] **Step 3: Register the palette in `themes.ts`**

Add `"midnight"` to the `PALETTES` tuple. Extend `THEME_ID_PATTERN` to include `midnight` in the alternation, e.g. `"^(emerald|indigo|ink|dollar|glass|editorial|neon|softmin|midnight)-(light|dark)$"`. Add `"midnight-dark": "#0b1020"` to the bg-color map. Add `midnight: "#7c6cff"` to the accent map. Add to the `THEMES` array:

```ts
{ palette: "midnight", name: "Neon Nights", modes: ["dark"], id: "midnight-dark" },
```

- [ ] **Step 4: Add the token block in `globals.css`**

After the `[data-theme="neon-dark"]` block, add (hex allowed here only):

```css
  [data-theme="midnight-dark"] {
    --app-bg:#0b1020; --fg:#e9ecfb; --muted:#7e87a8; --accent:#7c6cff; --accent-soft:#1b1838; --on-accent:#0a0820;
    --c2:#f0794f; --soft2:#2a1814; --c3:#41d6ff; --soft3:#0c2233; --card:#121829; --border:#222a44;
    --card-shadow:none; --chip:#171d31; --track:#222a44;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- themes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/lib/theme/themes.ts web/app/globals.css web/lib/theme/themes.test.ts
git commit -m "feat(theme): add Neon Nights (midnight-dark) palette"
```

---

### Task 2: Loan type→image map (`loan-images.ts`)

**Files:**
- Create: `web/components/debt/detail/loan-images.ts`
- Test: `web/components/debt/detail/loan-images.test.ts`

**Interfaces:**
- Produces:
  - `function loanImage(loan: { type: string }): string`
  - `function loanTypeLabel(type: string): string`

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/detail/loan-images.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loanImage, loanTypeLabel } from "./loan-images";

describe("loanImage", () => {
  it("returns the pexels auto image for auto loans", () => {
    expect(loanImage({ type: "auto" })).toContain("images.pexels.com/photos/35592262");
  });
  it("falls back to the 'other' image for unknown types", () => {
    expect(loanImage({ type: "spaceship" })).toBe(loanImage({ type: "other" }));
  });
});

describe("loanTypeLabel", () => {
  it("humanises known types", () => {
    expect(loanTypeLabel("credit_card")).toBe("Credit card");
    expect(loanTypeLabel("auto")).toBe("Auto");
  });
  it("passes unknown types through", () => {
    expect(loanTypeLabel("weird")).toBe("weird");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- loan-images.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `web/components/debt/detail/loan-images.ts`:

```ts
// Decorative, type-derived hero images. SEAM: a future per-loan image_url field
// or AI/asset-picked URL replaces these defaults.
const LOAN_IMAGES: Record<string, string> = {
  auto: "https://images.pexels.com/photos/35592262/pexels-photo-35592262.jpeg",
  home: "https://images.pexels.com/photos/1396122/pexels-photo-1396122.jpeg",
  education: "https://images.pexels.com/photos/207692/pexels-photo-207692.jpeg",
  personal: "https://images.pexels.com/photos/3943716/pexels-photo-3943716.jpeg",
  credit_card: "https://images.pexels.com/photos/259200/pexels-photo-259200.jpeg",
  other: "https://images.pexels.com/photos/210607/pexels-photo-210607.jpeg",
};

export function loanImage(loan: { type: string }): string {
  return LOAN_IMAGES[loan.type] ?? LOAN_IMAGES.other;
}

const TYPE_LABEL: Record<string, string> = {
  home: "Mortgage", auto: "Auto", education: "Student",
  personal: "Personal", credit_card: "Credit card", other: "Other",
};

export function loanTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- loan-images.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/detail/loan-images.ts web/components/debt/detail/loan-images.test.ts
git commit -m "feat(debt): loan type to hero-image map"
```

---

### Task 3: Hero banner + due status (`loan-hero.tsx`)

**Files:**
- Create: `web/components/debt/detail/loan-hero.tsx`
- Test: `web/components/debt/detail/loan-hero.test.tsx`

**Interfaces:**
- Consumes: `loanImage`, `loanTypeLabel` (Task 2); `formatCurrency` from `@/lib/format`; `type Loan` from `@/lib/api/loans`.
- Produces:
  - `function LoanHero(props: { loan: Loan; onPay: () => void; onViewStatements: () => void }): JSX.Element`
  - `function DueStatus(props: { loan: Loan; onViewSchedule: () => void }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/detail/loan-hero.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoanHero, DueStatus } from "./loan-hero";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "l1", name: "Car Loan", type: "auto", currency: "USD",
  principal: 5000, outstanding_balance: 400.4, interest_rate: 9,
  min_or_emi_amount: 50, progress_pct: 8, next_due_date: null,
} as unknown as Loan;

describe("LoanHero", () => {
  it("shows the name, Active pill, and real stat strip", () => {
    render(<LoanHero loan={loan} onPay={vi.fn()} onViewStatements={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /Car Loan/ })).toBeInTheDocument();
    expect(screen.getByText(/Active/)).toBeInTheDocument();
    expect(screen.getByText("9%")).toBeInTheDocument();
    expect(screen.getByText(/\$400\.40/)).toBeInTheDocument();
  });
  it("fires onPay when Make a payment is clicked", async () => {
    const onPay = vi.fn();
    render(<LoanHero loan={loan} onPay={onPay} onViewStatements={vi.fn()} />);
    screen.getByRole("button", { name: /Make a payment/i }).click();
    expect(onPay).toHaveBeenCalled();
  });
});

describe("DueStatus", () => {
  it("shows 'All caught up' when nothing is due", () => {
    render(<DueStatus loan={loan} onViewSchedule={vi.fn()} />);
    expect(screen.getByText(/All caught up/i)).toBeInTheDocument();
  });
  it("shows the due date when next_due_date is set", () => {
    render(<DueStatus loan={{ ...loan, next_due_date: "2026-07-21" } as Loan} onViewSchedule={vi.fn()} />);
    expect(screen.getByText(/2026-07-21/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- loan-hero.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `web/components/debt/detail/loan-hero.tsx`:

```tsx
"use client";

import type { Loan } from "@/lib/api/loans";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { loanImage, loanTypeLabel } from "./loan-images";

function Stat({ label, value, bar }: { label: string; value: string; bar?: number }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p data-numeric className="mt-0.5 text-lg font-bold tracking-tight">{value}</p>
      {bar != null && (
        <div className="mt-1 h-1 w-full rounded-full bg-chip">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </div>
      )}
    </div>
  );
}

export function LoanHero({ loan, onPay, onViewStatements }: { loan: Loan; onPay: () => void; onViewStatements: () => void }) {
  const outstanding = Number(loan.outstanding_balance ?? loan.principal);
  const active = outstanding > 0;
  const cur = loan.currency;
  return (
    <section className="relative overflow-hidden rounded-card-sm border border-border shadow-card">
      <img src={loanImage(loan)} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--app-bg)] via-[var(--app-bg)]/80 to-transparent" />
      <div className="relative grid gap-6 p-6 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{loanTypeLabel(loan.type)}</span>
            {active && <span className="rounded-full bg-[color:var(--soft3)] px-2 py-0.5 text-xs font-semibold text-[color:var(--c3)]">Active</span>}
          </div>
          <h1 className="text-2xl font-extrabold capitalize tracking-tight">{loan.name}</h1>
          <div className="flex gap-2">
            <Button onClick={onPay}>Make a payment</Button>
            <Button variant="outline" onClick={onViewStatements}>View statements</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 self-center rounded-card-sm bg-card/70 p-4 backdrop-blur sm:grid-cols-4 md:grid-cols-2">
          <Stat label="Outstanding" value={formatCurrency(outstanding, { currency: cur })} />
          <Stat label="APR" value={loan.interest_rate != null ? `${Number(loan.interest_rate)}%` : "—"} />
          <Stat label="Monthly" value={loan.min_or_emi_amount != null ? formatCurrency(loan.min_or_emi_amount, { currency: cur }) : "—"} />
          <Stat label="Payoff progress" value={loan.progress_pct != null ? `${Number(loan.progress_pct)}%` : "—"} bar={loan.progress_pct != null ? Number(loan.progress_pct) : undefined} />
        </div>
      </div>
    </section>
  );
}

export function DueStatus({ loan, onViewSchedule }: { loan: Loan; onViewSchedule: () => void }) {
  const due = loan.next_due_date;
  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <h2 className="text-sm font-semibold">Due status</h2>
      {due ? (
        <p className="mt-2 text-base font-bold">Payment due <span data-numeric>{due}</span></p>
      ) : (
        <p className="mt-2 text-base font-bold text-[color:var(--c3)]">All caught up</p>
      )}
      {loan.penalty_warning && <p className="mt-1 text-xs text-c2">{loan.penalty_warning}</p>}
      <Button variant="outline" className="mt-3" onClick={onViewSchedule}>View schedule</Button>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- loan-hero.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/detail/loan-hero.tsx web/components/debt/detail/loan-hero.test.tsx
git commit -m "feat(debt): loan detail hero + due-status card"
```

---

### Task 4: Payoff comparison chart (`payoff-comparison.tsx` + `-impl`)

**Files:**
- Create: `web/components/debt/detail/payoff-comparison-impl.tsx`
- Create: `web/components/debt/detail/payoff-comparison.tsx`
- Test: `web/components/debt/detail/payoff-comparison.test.tsx`

**Interfaces:**
- Consumes: `amortize`, `savingsVsBaseline`, `num` from `../debt-math`; `useDebtPlan` from `@/lib/api/analyst`; `formatCurrency`.
- Produces:
  - `type ComparisonPoint = { label: string; current: number; optimized: number }`
  - `function PayoffComparison(props: { loan: Loan }): JSX.Element`
  - `function PayoffComparisonImpl(props: { data: ComparisonPoint[]; currency: string }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/detail/payoff-comparison.test.tsx`. The chart impl is mocked (recharts needs a DOM size); we assert the optimize panel numbers come from `savingsVsBaseline`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/analyst", () => ({ useDebtPlan: () => ({ data: { extra_monthly: "50", strategy: "avalanche" } }) }));
vi.mock("./payoff-comparison-impl", () => ({ PayoffComparisonImpl: () => <div data-testid="chart" /> }));

import { PayoffComparison } from "./payoff-comparison";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "l1", name: "Car Loan", type: "auto", currency: "USD",
  principal: 5000, outstanding_balance: 4000, interest_rate: 9, min_or_emi_amount: 200,
} as unknown as Loan;

describe("PayoffComparison", () => {
  it("renders the chart and a deterministic interest-saved figure > 0", () => {
    render(<PayoffComparison loan={loan} />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByText(/Optimize and save/i)).toBeInTheDocument();
    const saved = screen.getByTestId("cmp-interest-saved").textContent ?? "";
    expect(saved).toMatch(/\$/);
    expect(saved).not.toMatch(/\$0\.00$/);
  });
  it("still renders with no plan (extra falls back)", () => {
    render(<PayoffComparison loan={{ ...loan } as Loan} />);
    expect(screen.getByTestId("cmp-months-sooner")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- payoff-comparison.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the dynamic chart impl**

Create `web/components/debt/detail/payoff-comparison-impl.tsx`:

```tsx
"use client";

import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";

export type ComparisonPoint = { label: string; current: number; optimized: number };

export function PayoffComparisonImpl({ data, currency }: { data: ComparisonPoint[]; currency: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} minTickGap={32} />
        <YAxis width={48} tickFormatter={(v) => formatCurrency(v, { currency, compact: true })} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--fg)", fontSize: 12 }}
          formatter={(value: number, name) => [formatCurrency(value, { currency }), name === "optimized" ? "Optimized plan" : "Current plan"]}
        />
        <Line type="monotone" dataKey="current" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
        <Line type="monotone" dataKey="optimized" stroke="var(--accent)" strokeWidth={2.6} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Write the container**

Create `web/components/debt/detail/payoff-comparison.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { Loan } from "@/lib/api/loans";
import { useDebtPlan } from "@/lib/api/analyst";
import { formatCurrency } from "@/lib/format";
import { amortize, num, savingsVsBaseline, type LoanLike } from "../debt-math";
import type { ComparisonPoint } from "./payoff-comparison-impl";

const Impl = dynamic(() => import("./payoff-comparison-impl").then((m) => m.PayoffComparisonImpl), {
  ssr: false,
  loading: () => <div className="h-[220px] w-full animate-pulse rounded-card-sm bg-chip" />,
});

const DEFAULT_EXTRA = 50;

export function PayoffComparison({ loan }: { loan: Loan }) {
  const plan = useDebtPlan();
  const cur = loan.currency;
  const outstanding = num(loan.outstanding_balance ?? loan.principal);
  const rate = num(loan.interest_rate);
  const basePayment = num(loan.min_or_emi_amount) || Math.max(1, outstanding * 0.02);
  const extra = Math.max(0, Math.round(num(plan.data?.extra_monthly) || DEFAULT_EXTRA));

  const { data, savings } = useMemo(() => {
    const baseline = amortize(outstanding, rate, basePayment);
    const optimized = amortize(outstanding, rate, basePayment + extra);
    const horizon = Math.max(baseline.series.length, optimized.series.length);
    const points: ComparisonPoint[] = [{ label: "Now", current: outstanding, optimized: outstanding }];
    for (let m = 0; m < horizon; m++) {
      points.push({
        label: `M${m + 1}`,
        current: m < baseline.series.length ? baseline.series[m] : 0,
        optimized: m < optimized.series.length ? optimized.series[m] : 0,
      });
    }
    const loanLike: LoanLike = loan as unknown as LoanLike;
    return { data: points, savings: savingsVsBaseline([loanLike], extra, "avalanche") };
  }, [loan, outstanding, rate, basePayment, extra]);

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
        <div>
          <h2 className="mb-3 text-base font-bold tracking-tight">Payoff comparison</h2>
          <Impl data={data} currency={cur} />
        </div>
        <div className="space-y-3 rounded-card-sm bg-accent-soft p-4">
          <p className="text-sm font-semibold text-accent">Optimize and save</p>
          <div>
            <p className="text-[11px] text-muted">Interest saved with +{formatCurrency(extra, { currency: cur })}/mo</p>
            <p data-testid="cmp-interest-saved" data-numeric className="text-2xl font-extrabold tracking-tight">
              {formatCurrency(savings.interestSaved, { currency: cur })}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted">Pay off sooner</p>
            <p data-testid="cmp-months-sooner" data-numeric className="text-lg font-bold">{savings.monthsSooner} months</p>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- payoff-comparison.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/debt/detail/payoff-comparison.tsx web/components/debt/detail/payoff-comparison-impl.tsx web/components/debt/detail/payoff-comparison.test.tsx
git commit -m "feat(debt): per-loan payoff comparison chart + optimize panel"
```

---

### Task 5: Edit slide-over (`edit-loan-sheet.tsx`)

**Files:**
- Create: `web/components/debt/detail/edit-loan-sheet.tsx`
- Test: `web/components/debt/detail/edit-loan-sheet.test.tsx`

**Interfaces:**
- Consumes: `EditSection` from `./sections`; `Sheet`, `SheetContent`, `SheetTitle` from `@/components/ui/sheet`.
- Produces: `function EditLoanSheet(props: { loan: Loan; open: boolean; onOpenChange: (v: boolean) => void; onDeleted: () => void }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/detail/edit-loan-sheet.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/loans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/loans")>("@/lib/api/loans");
  return {
    ...actual,
    usePatchLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import { EditLoanSheet } from "./edit-loan-sheet";
import type { Loan } from "@/lib/api/loans";

const loan = { id: "l1", name: "Car Loan", type: "auto", schedule_kind: "amortizing", principal: 5000, currency: "USD" } as unknown as Loan;

describe("EditLoanSheet", () => {
  it("renders the edit form when open", () => {
    render(<EditLoanSheet loan={loan} open onOpenChange={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByText(/Edit loan/i)).toBeInTheDocument();
  });
  it("renders nothing visible when closed", () => {
    render(<EditLoanSheet loan={loan} open={false} onOpenChange={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.queryByText(/Edit loan/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- edit-loan-sheet.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `web/components/debt/detail/edit-loan-sheet.tsx`:

```tsx
"use client";

import type { Loan } from "@/lib/api/loans";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EditSection } from "./sections";

export function EditLoanSheet({
  loan, open, onOpenChange, onDeleted,
}: { loan: Loan; open: boolean; onOpenChange: (v: boolean) => void; onDeleted: () => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetTitle className="mb-4">Edit {loan.name}</SheetTitle>
        <EditSection
          loan={loan}
          onDone={() => onOpenChange(false)}
          onDeleted={onDeleted}
        />
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- edit-loan-sheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/detail/edit-loan-sheet.tsx web/components/debt/detail/edit-loan-sheet.test.tsx
git commit -m "feat(debt): edit loan in a slide-over sheet"
```

---

### Task 6: Restyle the loan-details card (`loan-info-card.tsx`)

**Files:**
- Modify: `web/components/debt/detail/loan-info-card.tsx`
- Test: `web/components/debt/detail/loan-info-card.test.tsx`

**Interfaces:**
- Consumes: `loanTypeLabel` from `./loan-images` (Task 2).
- Produces (signature change): `function LoanInfoCard(props: { loan: Loan; onEdit: () => void }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/detail/loan-info-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoanInfoCard } from "./loan-info-card";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "l1", name: "Car Loan", type: "auto", schedule_kind: "amortizing", compounding: "monthly",
  principal: 5000, currency: "USD", interest_rate: 9, min_or_emi_amount: 50, due_day: 21,
  start_date: "2025-06-21", end_date: "2026-06-21",
} as unknown as Loan;

describe("LoanInfoCard", () => {
  it("shows real loan-detail rows and the human type label", () => {
    render(<LoanInfoCard loan={loan} onEdit={vi.fn()} />);
    expect(screen.getByText(/Loan details/i)).toBeInTheDocument();
    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText("9%")).toBeInTheDocument();
  });
  it("fires onEdit when Edit details is clicked", () => {
    const onEdit = vi.fn();
    render(<LoanInfoCard loan={loan} onEdit={onEdit} />);
    screen.getByRole("button", { name: /Edit details/i }).click();
    expect(onEdit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- loan-info-card.test.tsx`
Expected: FAIL — `LoanInfoCard` does not accept `onEdit` / no Edit button.

- [ ] **Step 3: Rewrite the component**

Replace the contents of `web/components/debt/detail/loan-info-card.tsx`:

```tsx
"use client";

import { formatCurrency } from "@/lib/format";
import type { Loan } from "@/lib/api/loans";
import { Button } from "@/components/ui/button";
import { loanTypeLabel } from "./loan-images";

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

export function LoanInfoCard({ loan, onEdit }: { loan: Loan; onEdit: () => void }) {
  const schedule = SCHEDULE[loan.schedule_kind ?? ""] ?? { label: loan.schedule_kind ?? "—", meaning: "" };
  const term =
    loan.start_date && loan.end_date
      ? `${loan.start_date} → ${loan.end_date}`
      : loan.start_date ? `from ${loan.start_date}` : "—";

  return (
    <section className="rounded-card-sm border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold tracking-tight">Loan details</h2>
        <Button variant="outline" onClick={onEdit}>Edit details</Button>
      </div>
      <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
        <Row label="Type" value={loanTypeLabel(loan.type)} />
        <Row label="Schedule" value={schedule.label} />
        <Row label="Compounding" value={loan.compounding ?? "—"} />
        <Row label="Original principal" value={formatCurrency(loan.principal, { currency: loan.currency })} />
        <Row label="APR" value={loan.interest_rate != null ? `${Number(loan.interest_rate)}%` : "—"} />
        <Row label="Term" value={term} />
        <Row label="Due day" value={loan.due_day != null ? `Day ${loan.due_day}` : "—"} />
        <Row label="Monthly" value={loan.min_or_emi_amount != null ? formatCurrency(loan.min_or_emi_amount, { currency: loan.currency }) : "—"} />
        <Row label="Currency" value={loan.currency} />
      </dl>
      {schedule.meaning && <p className="mt-2 text-xs text-muted">{schedule.label} — {schedule.meaning}.</p>}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- loan-info-card.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/detail/loan-info-card.tsx web/components/debt/detail/loan-info-card.test.tsx
git commit -m "feat(debt): re-lay loan details card + edit trigger"
```

---

### Task 7: Recompose the detail page (`loan-detail-page.tsx`)

**Files:**
- Modify: `web/components/debt/detail/loan-detail-page.tsx`
- Modify: `web/components/debt/detail/loan-detail-page.test.tsx`

**Interfaces:**
- Consumes: `LoanHero`, `DueStatus` (Task 3); `PayoffComparison` (Task 4); `EditLoanSheet` (Task 5); `LoanInfoCard` (Task 6); `PaymentHistory`, `UpcomingSchedule` from `./sections`; `ScenarioSimulator` from `@/components/debt/overview/scenario-simulator`; `AiCoach`; `loanCoachPreamble`; `useDebtPlan`.
- Produces: `function LoanDetailPage(props: { loan: Loan }): JSX.Element` (unchanged public signature — `page.tsx` already calls `<LoanDetailPage loan={selected} />`).

- [ ] **Step 1: Update the existing test**

Edit `web/components/debt/detail/loan-detail-page.test.tsx`. The current top-of-file mocks stay. Replace the single test body with:

```tsx
describe("LoanDetailPage", () => {
  it("renders breadcrumb, hero name, details card, and AI coach rail", () => {
    render(<LoanDetailPage loan={loan} />);
    const crumb = screen.getByRole("link", { name: /Debt/i });
    expect(crumb).toHaveAttribute("href", "/debt");
    expect(screen.getAllByText(/My Card/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Loan details/i)).toBeInTheDocument();
    expect(screen.getByTestId("coach")).toBeInTheDocument();
  });

  it("opens the edit sheet when Edit details is clicked", () => {
    render(<LoanDetailPage loan={loan} />);
    expect(screen.queryByText(/Edit My Card/i)).not.toBeInTheDocument();
    screen.getByRole("button", { name: /Edit details/i }).click();
    expect(screen.getByText(/Edit My Card/i)).toBeInTheDocument();
  });
});
```

Note: the existing mock for `@/lib/api/analyst` returns `{ data: null }` — keep it; `PayoffComparison` and `AiCoach` both tolerate a null plan. Add `useCreateLoan` is not needed here.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- loan-detail-page.test.tsx`
Expected: FAIL — no "Edit details" button yet (current page renders "Edit loan" inline).

- [ ] **Step 3: Rewrite the component**

Replace the contents of `web/components/debt/detail/loan-detail-page.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Loan } from "@/lib/api/loans";
import { useDebtPlan } from "@/lib/api/analyst";
import { AiCoach } from "@/components/debt/analyst/ai-coach";
import { loanCoachPreamble } from "@/components/debt/debt-context";
import { ScenarioSimulator } from "@/components/debt/overview/scenario-simulator";
import { LoanHero, DueStatus } from "./loan-hero";
import { LoanInfoCard } from "./loan-info-card";
import { PayoffComparison } from "./payoff-comparison";
import { EditLoanSheet } from "./edit-loan-sheet";
import { PaymentHistory, UpcomingSchedule } from "./sections";

export function LoanDetailPage({ loan }: { loan: Loan }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const plan = useDebtPlan();
  const historyRef = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()).toISOString().slice(0, 10);
  const range = { from, to };
  const strategy = (plan.data?.strategy === "snowball" ? "snowball" : "avalanche") as "snowball" | "avalanche";

  const scrollTo = (ref: React.RefObject<HTMLDivElement>) =>
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-4">
      <nav className="text-sm">
        <Link href="/debt" className="font-semibold text-accent">‹ Debt</Link>
        <span className="text-muted"> / </span>
        <span className="font-semibold capitalize">{loan.name}</span>
      </nav>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <LoanHero
              loan={loan}
              onPay={() => scrollTo(historyRef)}
              onViewStatements={() => scrollTo(historyRef)}
            />
            <DueStatus loan={loan} onViewSchedule={() => scrollTo(scheduleRef)} />
          </div>

          <LoanInfoCard loan={loan} onEdit={() => setEditing(true)} />

          <PayoffComparison loan={loan} />

          <div className="grid gap-4 lg:grid-cols-2">
            <ScenarioSimulator loans={[loan]} strategy={strategy} currency={loan.currency} />
            <div ref={historyRef} className="rounded-card-sm border border-border bg-card p-5 shadow-card">
              <PaymentHistory loan={loan} />
            </div>
          </div>

          <div ref={scheduleRef} className="rounded-card-sm border border-border bg-card p-5 shadow-card">
            <UpcomingSchedule loan={loan} />
          </div>
        </div>

        <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <AiCoach
            threadId={`loan:${loan.id}`}
            range={range}
            plan={plan.data}
            preamble={loanCoachPreamble(loan, plan.data)}
          />
        </div>
      </div>

      <EditLoanSheet
        loan={loan}
        open={editing}
        onOpenChange={setEditing}
        onDeleted={() => router.push("/debt")}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- loan-detail-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full gate — typecheck + whole suite**

Run: `npm run typecheck && npm run test:unit`
Expected: typecheck clean; all unit tests pass. Fix any fallout (e.g. a stray import of the removed `HeaderStats`/`PayoffCalculator` usage, or the old `EditSection` inline path) before committing.

- [ ] **Step 6: Commit**

```bash
git add web/components/debt/detail/loan-detail-page.tsx web/components/debt/detail/loan-detail-page.test.tsx
git commit -m "feat(debt): recompose loan detail page to mockup layout"
```

---

## Self-review notes

- **Spec coverage:** theme (T1), images/seam (T2), hero+stats+due status (T3), payoff comparison + optimize panel (T4), edit slide-over (T5), re-laid details card (T6), full composition incl. simulator/history/schedule/AI rail (T7). "Make a payment"/"View statements"/"View schedule" wired via refs in T7.
- **Reuse:** `ScenarioSimulator`, `PaymentHistory`, `UpcomingSchedule`, `EditSection`, `AiCoach`, `amortize`/`savingsVsBaseline` all reused, not reimplemented.
- **Real-data-only:** no lender/loan#/asset/refinance anywhere; null fields render `—`.
- **Note for executor:** `HeaderStats` and `PayoffCalculator` exports in `sections.tsx` may become unused after T7. Leave them (still covered by `sections.test.tsx`); do not delete in this plan.
