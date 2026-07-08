# Slice C — Data-Backed Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four data-backed dashboard widgets (Credit Card, Debt, Recurring, Holdings) to the locked D `WidgetContract` standard, plus a responsive fix to the existing Breakdown (merchant) widget.

**Architecture:** Each widget is a `WidgetContract<T>` in `web/components/dashboard/widgets/`. `useData` calls the C-be TanStack hook and maps rows to a flat view-model through the shared `queryState` helper. View-model builders and helpers are exported as pure functions so they unit-test without rendering or hook mocking (the established test pattern). Widgets are registered in `registry.tsx`. Widgets are read-only (glanceable `Body` + analytical `Focus`); no CRUD.

**Tech Stack:** Next.js (App Router), React, TypeScript, TanStack Query, Tailwind, lucide-react, Vitest + jsdom.

## Global Constraints

- Widgets MUST conform to `WidgetContract<T>` from `web/lib/dashboard/widget-contract.ts` (`useData` → `WidgetState<T>` via `queryState`; `Body(ctx)`; optional `deriveInsights`, `Focus`, `emptyHint`).
- All money rendered via `formatCurrency` from `@/lib/format` (signature: `formatCurrency(value: number, opts?: { currency?: string })`).
- `Insight` objects use `tone: "neutral" | "positive" | "warning" | "danger"` and optional numeric `severity`.
- Density 0 uses `CompactStat` from `./widget-tier`.
- These four widgets MUST NOT include `"range"` in their registry `controls.fields` (snapshot/forward widgets; no global range).
- Tests are Vitest, run with `npm run test:unit` from `web/`. Test pure exported functions only (mirror `net-worth-widget.test.tsx`); do not render or mock hooks.
- Aggregate sums assume a single household currency (same assumption as existing widgets). No multi-currency normalization.
- TypeScript strict: type all arrays explicitly (e.g. `const chips: Insight[] = []`), no implicit `any`.

---

### Task 1: Credit Card widget

**Files:**
- Create: `web/components/dashboard/widgets/credit-card-widget.tsx`
- Test: `web/components/dashboard/widgets/credit-card-widget.test.tsx`

**Interfaces:**
- Consumes: `useCreditCards`, type `CreditCard` from `@/lib/api/widget-data`; `queryState`, `WidgetContract`, `Insight` from `@/lib/dashboard/widget-contract`.
- Produces: `creditCardContract: WidgetContract<CreditCardVM>`, `creditCardVM(cards: CreditCard[]): CreditCardVM` (consumed by Task 5 registry).

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/credit-card-widget.test.tsx
import { describe, expect, it } from "vitest";
import { creditCardVM, creditCardContract } from "./credit-card-widget";
import type { CreditCard } from "@/lib/api/widget-data";

function card(over: Partial<CreditCard> & { id?: string }): CreditCard {
  return {
    loan: { id: over.id ?? "1", name: "Visa", next_due_date: "2099-01-10" } as CreditCard["loan"],
    credit_limit: "1000", statement_balance: "300", available_credit: "700",
    statement_day: 1, utilization: "0.3", detail_complete: true,
    ...over,
  } as CreditCard;
}

describe("creditCardVM", () => {
  it("aggregates balance, limit, and utilization", () => {
    const vm = creditCardVM([card({ id: "a" }), card({ id: "b", statement_balance: "200", credit_limit: "1000" })]);
    expect(vm.totalBalance).toBe(500);
    expect(vm.totalLimit).toBe(2000);
    expect(vm.aggUtil).toBeCloseTo(0.25);
  });
  it("flags incomplete cards", () => {
    const vm = creditCardVM([card({ detail_complete: false })]);
    expect(vm.anyIncomplete).toBe(true);
  });
});

describe("creditCardContract.deriveInsights", () => {
  it("warns when aggregate utilization is high", () => {
    const vm = creditCardVM([card({ statement_balance: "600", credit_limit: "1000", utilization: "0.6" })]);
    const chips = creditCardContract.deriveInsights!(vm, {});
    expect(chips.some((c) => /Utilization/.test(c.label) && (c.tone === "warning" || c.tone === "danger"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/credit-card-widget.test.tsx`
Expected: FAIL — cannot find module `./credit-card-widget`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/components/dashboard/widgets/credit-card-widget.tsx
"use client";
import { CreditCard as CreditCardIcon } from "lucide-react";
import { useCreditCards, type CreditCard } from "@/lib/api/widget-data";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract, type Insight } from "@/lib/dashboard/widget-contract";

export type CreditCardVM = {
  cards: { id: string; name: string; balance: number; limit: number | null; utilization: number | null; dueDate: string | null; detailComplete: boolean }[];
  totalBalance: number;
  totalLimit: number;
  aggUtil: number | null;
  nextDue: { name: string; dueDate: string } | null;
  anyIncomplete: boolean;
};

export function creditCardVM(cards: CreditCard[]): CreditCardVM {
  const rows = cards.map((c) => ({
    id: c.loan.id,
    name: c.loan.name,
    balance: Number(c.statement_balance ?? 0),
    limit: c.credit_limit != null ? Number(c.credit_limit) : null,
    utilization: c.utilization != null ? Number(c.utilization) : null,
    dueDate: c.loan.next_due_date ?? null,
    detailComplete: c.detail_complete,
  }));
  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
  const totalLimit = rows.reduce((s, r) => s + (r.limit ?? 0), 0);
  const withDue = rows.filter((r) => r.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  return {
    cards: rows,
    totalBalance,
    totalLimit,
    aggUtil: totalLimit > 0 ? totalBalance / totalLimit : null,
    nextDue: withDue[0] ? { name: withDue[0].name, dueDate: withDue[0].dueDate! } : null,
    anyIncomplete: rows.some((r) => !r.detailComplete),
  };
}

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + "T00:00:00").getTime() - today.getTime()) / 86_400_000);
}

function utilColor(u: number) { return u >= 0.5 ? "var(--destructive)" : "var(--accent)"; }

export const creditCardContract: WidgetContract<CreditCardVM> = {
  useData() {
    const q = useCreditCards();
    return queryState(q, {
      select: creditCardVM,
      isEmpty: (vm) => vm.cards.length === 0,
      partialReason: (vm) => (vm.anyIncomplete ? "Some cards missing limits" : undefined),
    });
  },
  deriveInsights(vm) {
    const chips: Insight[] = [];
    if (vm.nextDue) {
      const n = daysUntil(vm.nextDue.dueDate);
      if (n >= 0) chips.push({ label: `Due in ${n}d`, tone: n <= 3 ? "warning" : "neutral", severity: n <= 3 ? 8 : 3 });
    }
    if (vm.aggUtil != null && vm.aggUtil >= 0.3)
      chips.push({ label: `Utilization ${Math.round(vm.aggUtil * 100)}%`, tone: vm.aggUtil >= 0.5 ? "danger" : "warning", severity: Math.round(vm.aggUtil * 10) });
    return chips;
  },
  Body({ data, density, config }) {
    if (density === 0)
      return <CompactStat icon={CreditCardIcon} label="Card balance" value={formatCurrency(data.totalBalance)}
        hint={data.nextDue ? `Next due ${data.nextDue.dueDate}` : undefined} />;
    const showUtil = config.show?.utilization ?? true;
    const showDue = config.show?.due ?? true;
    const limit = density >= 3 ? data.cards.length : Math.min(3, data.cards.length);
    const rows = [...data.cards].sort((a, b) => b.balance - a.balance).slice(0, limit);
    return (
      <div className="flex h-full flex-col">
        <p className="text-2xl font-extrabold tabular-nums tracking-tight">{formatCurrency(data.totalBalance)}</p>
        <p className="text-[11px] font-semibold text-muted">total balance{data.totalLimit > 0 ? ` · ${formatCurrency(data.totalLimit)} limit` : ""}</p>
        <div className="mt-2 flex-1 space-y-1.5 overflow-hidden">
          {rows.map((c) => (
            <div key={c.id} className="text-[12.5px]">
              <div className="flex justify-between gap-2">
                <span className="truncate text-muted">{c.name}</span>
                <span className="shrink-0 tabular-nums">{formatCurrency(c.balance)}{showDue && c.dueDate ? ` · ${c.dueDate}` : ""}</span>
              </div>
              {showUtil && c.utilization != null && (
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-track">
                  <span className="block h-full rounded" style={{ width: `${Math.min(100, Math.round(c.utilization * 100))}%`, background: utilColor(c.utilization) }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-3">
        <p className="text-3xl font-extrabold tabular-nums">{formatCurrency(data.totalBalance)}</p>
        <div className="space-y-2">
          {data.cards.map((c) => (
            <div key={c.id} className="rounded-lg bg-chip px-3 py-2">
              <div className="flex justify-between text-[13px]"><b>{c.name}</b><span className="tabular-nums">{formatCurrency(c.balance)}{c.limit != null ? ` / ${formatCurrency(c.limit)}` : ""}</span></div>
              {c.utilization != null && (
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-track"><span className="block h-full rounded" style={{ width: `${Math.min(100, Math.round(c.utilization * 100))}%`, background: utilColor(c.utilization) }} /></div>
              )}
              <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{c.dueDate ? `Due ${c.dueDate}` : "No due date"}</span><span>{c.utilization != null ? `${Math.round(c.utilization * 100)}% util` : "—"}</span></div>
            </div>
          ))}
        </div>
      </div>
    );
  },
  emptyHint: "No credit cards yet. Add one to track balances and due dates.",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/widgets/credit-card-widget.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/widgets/credit-card-widget.tsx web/components/dashboard/widgets/credit-card-widget.test.tsx
git commit -m "feat(dashboard): credit card widget (slice C)"
```

---

### Task 2: Debt widget

**Files:**
- Create: `web/components/dashboard/widgets/debt-widget.tsx`
- Test: `web/components/dashboard/widgets/debt-widget.test.tsx`

**Interfaces:**
- Consumes: `useLoans`, type `Loan` from `@/lib/api/loans`; `queryState`, `WidgetContract`, `Insight`.
- Produces: `debtContract: WidgetContract<DebtVM>`, `debtVM(loans: Loan[], includeCC: boolean): DebtVM`.

Note: Focus is render-only (per-loan rows + client-side rough payoff months = `principal / monthly`). Live snowball/avalanche via `usePayoffStrategy` is deferred (mutation wiring + body schema out of scope for this slice).

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/debt-widget.test.tsx
import { describe, expect, it } from "vitest";
import { debtVM, debtContract } from "./debt-widget";
import type { Loan } from "@/lib/api/loans";

function loan(over: Partial<Loan>): Loan {
  return { id: "1", name: "Car", type: "auto", principal: "10000", interest_rate: "5",
    min_or_emi_amount: "300", next_due_date: "2099-02-01", currency: "USD", ...over } as Loan;
}

describe("debtVM", () => {
  it("sums principal and monthly, excludes credit cards by default", () => {
    const vm = debtVM([loan({ id: "a" }), loan({ id: "b", type: "credit_card", principal: "5000" })], false);
    expect(vm.totalDebt).toBe(10000);
    expect(vm.loans).toHaveLength(1);
  });
  it("includes credit-card debt when includeCC is true", () => {
    const vm = debtVM([loan({ id: "a" }), loan({ id: "b", type: "credit_card", principal: "5000" })], true);
    expect(vm.totalDebt).toBe(15000);
    expect(vm.loans).toHaveLength(2);
  });
});

describe("debtContract.deriveInsights", () => {
  it("emits the highest APR", () => {
    const vm = debtVM([loan({ interest_rate: "5" }), loan({ id: "c", interest_rate: "19" })], false);
    const chips = debtContract.deriveInsights!(vm, {});
    expect(chips.some((c) => /19/.test(c.label))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/debt-widget.test.tsx`
Expected: FAIL — cannot find module `./debt-widget`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/components/dashboard/widgets/debt-widget.tsx
"use client";
import { Landmark } from "lucide-react";
import { useLoans, type Loan } from "@/lib/api/loans";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract, type Insight } from "@/lib/dashboard/widget-contract";

export type DebtVM = {
  loans: { id: string; name: string; principal: number; rate: number | null; monthly: number | null; nextDue: string | null }[];
  totalDebt: number;
  totalMonthly: number;
  maxRate: number | null;
  nextPayment: { name: string; nextDue: string } | null;
};

export function debtVM(loans: Loan[], includeCC: boolean): DebtVM {
  const rows = loans
    .filter((l) => includeCC || l.type !== "credit_card")
    .map((l) => ({
      id: l.id,
      name: l.name,
      principal: Number(l.principal ?? 0),
      rate: l.interest_rate != null ? Number(l.interest_rate) : null,
      monthly: l.min_or_emi_amount != null ? Number(l.min_or_emi_amount) : null,
      nextDue: l.next_due_date ?? null,
    }));
  const withDue = rows.filter((r) => r.nextDue).sort((a, b) => a.nextDue!.localeCompare(b.nextDue!));
  const rates = rows.map((r) => r.rate).filter((r): r is number => r != null);
  return {
    loans: rows,
    totalDebt: rows.reduce((s, r) => s + r.principal, 0),
    totalMonthly: rows.reduce((s, r) => s + (r.monthly ?? 0), 0),
    maxRate: rates.length ? Math.max(...rates) : null,
    nextPayment: withDue[0] ? { name: withDue[0].name, nextDue: withDue[0].nextDue! } : null,
  };
}

export const debtContract: WidgetContract<DebtVM> = {
  useData(config) {
    const includeCC = config.show?.includeCC ?? false;
    const q = useLoans();
    return queryState(q, {
      select: (loans) => debtVM(loans, includeCC),
      isEmpty: (vm) => vm.loans.length === 0,
    });
  },
  deriveInsights(vm) {
    const chips: Insight[] = [];
    if (vm.nextPayment) chips.push({ label: `Next: ${vm.nextPayment.nextDue}`, tone: "neutral", severity: 4 });
    if (vm.maxRate != null) chips.push({ label: `APR ${vm.maxRate}%`, tone: vm.maxRate >= 15 ? "warning" : "neutral", severity: Math.min(9, Math.round(vm.maxRate / 2)) });
    return chips;
  },
  Body({ data, density, config }) {
    if (density === 0)
      return <CompactStat icon={Landmark} label="Total debt" value={formatCurrency(data.totalDebt)}
        hint={data.nextPayment ? `Next ${data.nextPayment.nextDue}` : undefined} />;
    const showRate = config.show?.rate ?? true;
    const showMonthly = config.show?.monthly ?? true;
    const limit = density >= 3 ? data.loans.length : Math.min(3, data.loans.length);
    const rows = [...data.loans].sort((a, b) => b.principal - a.principal).slice(0, limit);
    return (
      <div className="flex h-full flex-col">
        <p className="text-2xl font-extrabold tabular-nums tracking-tight">{formatCurrency(data.totalDebt)}</p>
        {showMonthly && data.totalMonthly > 0 && <p className="text-[11px] font-semibold text-muted">{formatCurrency(data.totalMonthly)}/mo across {data.loans.length}</p>}
        <div className="mt-2 flex-1 space-y-1 overflow-hidden">
          {rows.map((l) => (
            <div key={l.id} className="flex justify-between gap-2 text-[12.5px]">
              <span className="truncate text-muted">{l.name}{showRate && l.rate != null ? ` · ${l.rate}%` : ""}</span>
              <span className="shrink-0 tabular-nums">{formatCurrency(l.principal)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-3">
        <p className="text-3xl font-extrabold tabular-nums">{formatCurrency(data.totalDebt)}</p>
        <p className="text-[12px] text-muted">{formatCurrency(data.totalMonthly)}/mo total</p>
        <div className="space-y-2">
          {data.loans.map((l) => {
            const months = l.monthly && l.monthly > 0 ? Math.ceil(l.principal / l.monthly) : null;
            return (
              <div key={l.id} className="rounded-lg bg-chip px-3 py-2 text-[12.5px]">
                <div className="flex justify-between"><b>{l.name}</b><span className="tabular-nums">{formatCurrency(l.principal)}</span></div>
                <div className="mt-1 flex justify-between text-[11px] text-muted">
                  <span>{l.rate != null ? `${l.rate}% APR` : "—"}{l.monthly != null ? ` · ${formatCurrency(l.monthly)}/mo` : ""}</span>
                  <span>{months != null ? `~${months} mo left` : l.nextDue ? `Due ${l.nextDue}` : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
  emptyHint: "No loans tracked yet. Add a loan to see debt and payoff progress.",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/widgets/debt-widget.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/widgets/debt-widget.tsx web/components/dashboard/widgets/debt-widget.test.tsx
git commit -m "feat(dashboard): debt widget (slice C)"
```

---

### Task 3: Recurring widget

**Files:**
- Create: `web/components/dashboard/widgets/recurring-widget.tsx`
- Test: `web/components/dashboard/widgets/recurring-widget.test.tsx`

**Interfaces:**
- Consumes: `useRecurringSeries`, type `RecurringSeries` from `@/lib/api/widget-data`; `queryState`, `WidgetContract`, `Insight`.
- Produces: `recurringContract: WidgetContract<RecurringVM>`, `monthlyFromCadence(amount: number, cadence: string): number`, `recurringVM(series: RecurringSeries[]): RecurringVM`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/recurring-widget.test.tsx
import { describe, expect, it } from "vitest";
import { monthlyFromCadence, recurringVM, recurringContract } from "./recurring-widget";
import type { RecurringSeries } from "@/lib/api/widget-data";

function series(over: Partial<RecurringSeries>): RecurringSeries {
  return { id: "1", name: "Netflix", amount: "15", currency: "USD", cadence: "monthly",
    type: "subscription", status: "active", next_due_date: "2099-01-05", ...over } as RecurringSeries;
}

describe("monthlyFromCadence", () => {
  it("normalizes annual to monthly", () => { expect(monthlyFromCadence(120, "annual")).toBeCloseTo(10); });
  it("normalizes weekly to monthly", () => { expect(monthlyFromCadence(10, "weekly")).toBeCloseTo(43.3); });
  it("excludes irregular from monthly total", () => { expect(monthlyFromCadence(50, "irregular")).toBe(0); });
});

describe("recurringVM", () => {
  it("sums monthly cost and sorts by next due", () => {
    const vm = recurringVM([
      series({ id: "a", amount: "15", cadence: "monthly", next_due_date: "2099-02-01" }),
      series({ id: "b", amount: "120", cadence: "annual", next_due_date: "2099-01-01" }),
    ]);
    expect(vm.totalMonthly).toBeCloseTo(25);
    expect(vm.items[0].name).toBe("Netflix");
    expect(vm.nextUp?.nextDue).toBe("2099-01-01");
  });
});

describe("recurringContract.deriveInsights", () => {
  it("emits a monthly-cost chip", () => {
    const vm = recurringVM([series({ amount: "20", cadence: "monthly" })]);
    const chips = recurringContract.deriveInsights!(vm, {});
    expect(chips.some((c) => /\/mo/.test(c.label))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/recurring-widget.test.tsx`
Expected: FAIL — cannot find module `./recurring-widget`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/components/dashboard/widgets/recurring-widget.tsx
"use client";
import { Repeat } from "lucide-react";
import { useRecurringSeries, type RecurringSeries } from "@/lib/api/widget-data";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract, type Insight } from "@/lib/dashboard/widget-contract";

const CADENCE_FACTOR: Record<string, number> = {
  weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, annual: 1 / 12, irregular: 0,
};

export function monthlyFromCadence(amount: number, cadence: string): number {
  return amount * (CADENCE_FACTOR[cadence] ?? 0);
}

export type RecurringVM = {
  items: { id: string; name: string; amount: number; cadence: string; monthly: number; nextDue: string | null; type: string; merchant: string | null }[];
  totalMonthly: number;
  nextUp: { name: string; nextDue: string } | null;
};

export function recurringVM(series: RecurringSeries[]): RecurringVM {
  const items = series.map((s) => {
    const amount = Number(s.amount ?? 0);
    return {
      id: s.id, name: s.name, amount, cadence: s.cadence,
      monthly: monthlyFromCadence(amount, s.cadence),
      nextDue: s.next_due_date ?? null, type: s.type, merchant: s.merchant_name ?? null,
    };
  }).sort((a, b) => (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999"));
  const withDue = items.filter((i) => i.nextDue);
  return {
    items,
    totalMonthly: items.reduce((s, i) => s + i.monthly, 0),
    nextUp: withDue[0] ? { name: withDue[0].name, nextDue: withDue[0].nextDue! } : null,
  };
}

export const recurringContract: WidgetContract<RecurringVM> = {
  useData() {
    const q = useRecurringSeries("active");
    return queryState(q, {
      select: recurringVM,
      isEmpty: (vm) => vm.items.length === 0,
    });
  },
  deriveInsights(vm) {
    const chips: Insight[] = [];
    if (vm.nextUp) chips.push({ label: `Next: ${vm.nextUp.name} ${vm.nextUp.nextDue}`, tone: "neutral", severity: 5 });
    if (vm.totalMonthly > 0) chips.push({ label: `${formatCurrency(vm.totalMonthly)}/mo`, tone: "neutral", severity: 3 });
    return chips;
  },
  Body({ data, density, config }) {
    if (density === 0)
      return <CompactStat icon={Repeat} label="Recurring" value={`${formatCurrency(data.totalMonthly)}/mo`}
        hint={data.nextUp ? `Next ${data.nextUp.name}` : undefined} />;
    const showBills = config.show?.bills ?? true;
    const showSubs = config.show?.subscriptions ?? true;
    const filtered = data.items.filter((i) =>
      (i.type === "bill" ? showBills : true) && (i.type === "subscription" ? showSubs : true));
    const limit = density >= 3 ? filtered.length : Math.min(5, filtered.length);
    const rows = filtered.slice(0, limit);
    const showAmounts = config.show?.amounts ?? true;
    return (
      <div className="flex h-full flex-col">
        <p className="text-2xl font-extrabold tabular-nums tracking-tight">{formatCurrency(data.totalMonthly)}<span className="text-sm font-semibold text-muted">/mo</span></p>
        <div className="mt-2 flex-1 space-y-1 overflow-hidden">
          {rows.map((i) => (
            <div key={i.id} className="flex justify-between gap-2 text-[12.5px]">
              <span className="truncate text-muted">{i.name}{i.nextDue ? ` · ${i.nextDue}` : ""}</span>
              {showAmounts && <span className="shrink-0 tabular-nums">{formatCurrency(i.amount)}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  },
  Focus({ data }) {
    const groups = ["subscription", "bill", "income", "transfer", "other"].map((type) => ({
      type, rows: data.items.filter((i) => i.type === type),
    })).filter((g) => g.rows.length > 0);
    return (
      <div className="space-y-3">
        <p className="text-3xl font-extrabold tabular-nums">{formatCurrency(data.totalMonthly)}<span className="text-base font-semibold text-muted">/mo</span></p>
        {groups.map((g) => (
          <div key={g.type}>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">{g.type}</p>
            <div className="space-y-1">
              {g.rows.map((i) => (
                <div key={i.id} className="flex justify-between rounded-lg bg-chip px-3 py-1.5 text-[12.5px]">
                  <span className="truncate">{i.name}<span className="text-muted"> · {i.cadence}</span></span>
                  <span className="tabular-nums">{formatCurrency(i.amount)}{i.nextDue ? ` · ${i.nextDue}` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  },
  emptyHint: "No recurring payments detected yet. Upload a statement and I'll start finding patterns.",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/widgets/recurring-widget.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/widgets/recurring-widget.tsx web/components/dashboard/widgets/recurring-widget.test.tsx
git commit -m "feat(dashboard): recurring payments widget (slice C)"
```

---

### Task 4: Holdings widget

**Files:**
- Create: `web/components/dashboard/widgets/holdings-widget.tsx`
- Test: `web/components/dashboard/widgets/holdings-widget.test.tsx`

**Interfaces:**
- Consumes: `useHoldings`, type `Holding` from `@/lib/api/widget-data`; `queryState`, `WidgetContract`, `Insight`.
- Produces: `holdingsContract: WidgetContract<HoldingsVM>`, `holdingsVM(holdings: Holding[]): HoldingsVM`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/holdings-widget.test.tsx
import { describe, expect, it } from "vitest";
import { holdingsVM, holdingsContract } from "./holdings-widget";
import type { Holding } from "@/lib/api/widget-data";

function holding(over: Partial<Holding>): Holding {
  return { id: "1", name: "Apple", symbol: "AAPL", asset_type: "stock", quantity: "10",
    avg_buy_price: "100", currency: "USD",
    latest_valuation: { price: "150", value: "1500" } as Holding["latest_valuation"], ...over } as Holding;
}

describe("holdingsVM", () => {
  it("computes value, cost, and gain", () => {
    const vm = holdingsVM([holding({})]);
    expect(vm.totalValue).toBe(1500);
    expect(vm.totalGain).toBe(500);
    expect(vm.totalGainPct).toBeCloseTo(0.5);
  });
  it("falls back to cost basis when unpriced and flags partial", () => {
    const vm = holdingsVM([holding({ latest_valuation: null })]);
    expect(vm.totalValue).toBe(1000);
    expect(vm.anyUnpriced).toBe(true);
  });
});

describe("holdingsContract.deriveInsights", () => {
  it("emits a total-gain chip with positive tone on a gain", () => {
    const vm = holdingsVM([holding({})]);
    const chips = holdingsContract.deriveInsights!(vm, {});
    expect(chips.some((c) => c.tone === "positive")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/holdings-widget.test.tsx`
Expected: FAIL — cannot find module `./holdings-widget`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/components/dashboard/widgets/holdings-widget.tsx
"use client";
import { LineChart } from "lucide-react";
import { useHoldings, type Holding } from "@/lib/api/widget-data";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract, type Insight } from "@/lib/dashboard/widget-contract";

export type HoldingsVM = {
  holdings: { id: string; name: string; symbol: string | null; value: number; cost: number; gain: number; gainPct: number | null }[];
  totalValue: number;
  totalCost: number;
  totalGain: number;
  totalGainPct: number | null;
  anyUnpriced: boolean;
};

export function holdingsVM(holdings: Holding[]): HoldingsVM {
  const rows = holdings.map((h) => {
    const qty = Number(h.quantity ?? 0);
    const avg = h.avg_buy_price != null ? Number(h.avg_buy_price) : 0;
    const cost = qty * avg;
    const value = h.latest_valuation?.value != null ? Number(h.latest_valuation.value) : cost;
    const gain = value - cost;
    return { id: h.id, name: h.name, symbol: h.symbol ?? null, value, cost, gain, gainPct: cost > 0 ? gain / cost : null };
  }).sort((a, b) => b.value - a.value);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalGain = totalValue - totalCost;
  return {
    holdings: rows,
    totalValue, totalCost, totalGain,
    totalGainPct: totalCost > 0 ? totalGain / totalCost : null,
    anyUnpriced: holdings.some((h) => h.latest_valuation == null),
  };
}

function gainColor(g: number) { return g >= 0 ? "text-c3" : "text-destructive"; }

export const holdingsContract: WidgetContract<HoldingsVM> = {
  useData() {
    const q = useHoldings();
    return queryState(q, {
      select: holdingsVM,
      isEmpty: (vm) => vm.holdings.length === 0,
      partialReason: (vm) => (vm.anyUnpriced ? "Some holdings unpriced" : undefined),
    });
  },
  deriveInsights(vm) {
    const chips: Insight[] = [];
    if (vm.totalGainPct != null) {
      const up = vm.totalGain >= 0;
      chips.push({ label: `${up ? "▲" : "▼"} ${Math.abs(vm.totalGainPct * 100).toFixed(1)}% total`, tone: up ? "positive" : "warning", severity: Math.min(9, Math.round(Math.abs(vm.totalGainPct * 100))) });
    }
    const top = vm.holdings[0];
    if (top) chips.push({ label: top.symbol ?? top.name, tone: "neutral", severity: 2 });
    return chips;
  },
  Body({ data, density, config }) {
    if (density === 0)
      return <CompactStat icon={LineChart} label="Portfolio" value={formatCurrency(data.totalValue)}
        hint={data.totalGainPct != null ? `${data.totalGain >= 0 ? "▲" : "▼"} ${Math.abs(data.totalGainPct * 100).toFixed(1)}%` : undefined} />;
    const showGain = config.show?.gain ?? true;
    const showSymbol = config.show?.symbol ?? true;
    const limit = density >= 3 ? data.holdings.length : Math.min(3, data.holdings.length);
    const rows = data.holdings.slice(0, limit);
    return (
      <div className="flex h-full flex-col">
        <p className="text-2xl font-extrabold tabular-nums tracking-tight">{formatCurrency(data.totalValue)}</p>
        {showGain && data.totalGainPct != null && (
          <p className={`text-[11px] font-semibold ${gainColor(data.totalGain)}`}>{data.totalGain >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(data.totalGain))} ({Math.abs(data.totalGainPct * 100).toFixed(1)}%)</p>
        )}
        <div className="mt-2 flex-1 space-y-1 overflow-hidden">
          {rows.map((h) => (
            <div key={h.id} className="flex justify-between gap-2 text-[12.5px]">
              <span className="truncate text-muted">{showSymbol && h.symbol ? h.symbol : h.name}</span>
              <span className="shrink-0 tabular-nums">{formatCurrency(h.value)}{showGain && h.gainPct != null ? <span className={gainColor(h.gain)}> {h.gain >= 0 ? "+" : ""}{(h.gainPct * 100).toFixed(1)}%</span> : null}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },
  Focus({ data }) {
    const total = data.totalValue || 1;
    return (
      <div className="space-y-3">
        <p className="text-3xl font-extrabold tabular-nums">{formatCurrency(data.totalValue)}</p>
        {data.totalGainPct != null && <p className={`text-[12px] font-semibold ${gainColor(data.totalGain)}`}>{data.totalGain >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(data.totalGain))} ({Math.abs(data.totalGainPct * 100).toFixed(1)}%)</p>}
        <div className="space-y-2">
          {data.holdings.map((h) => (
            <div key={h.id} className="rounded-lg bg-chip px-3 py-2 text-[12.5px]">
              <div className="flex justify-between"><b>{h.symbol ?? h.name}</b><span className="tabular-nums">{formatCurrency(h.value)}</span></div>
              <div className="mt-1 flex justify-between text-[11px] text-muted">
                <span>{Math.round((h.value / total) * 100)}% of portfolio</span>
                <span className={gainColor(h.gain)}>{h.gain >= 0 ? "+" : ""}{formatCurrency(h.gain)}{h.gainPct != null ? ` (${(h.gainPct * 100).toFixed(1)}%)` : ""}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  },
  emptyHint: "No holdings tracked yet. Add an investment to see your portfolio.",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/widgets/holdings-widget.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/widgets/holdings-widget.tsx web/components/dashboard/widgets/holdings-widget.test.tsx
git commit -m "feat(dashboard): holdings widget (slice C)"
```

---

### Task 5: Register the four widgets

**Files:**
- Modify: `web/lib/dashboard/registry.tsx` (imports near lines 1-20; `WIDGETS` map entries before the closing `};` at line ~128)

**Interfaces:**
- Consumes: `creditCardContract`, `debtContract`, `recurringContract`, `holdingsContract` from Tasks 1-4.
- Produces: four new keys in `WIDGETS` (`creditCard`, `debt`, `recurring`, `holdings`).

- [ ] **Step 1: Add icon + contract imports**

Add to the lucide import block (lines 2-10) the icons `CreditCard`, `Landmark`, `Repeat`, `LineChart`. After the existing contract imports (line 20), add:

```tsx
import { creditCardContract } from "@/components/dashboard/widgets/credit-card-widget";
import { debtContract } from "@/components/dashboard/widgets/debt-widget";
import { recurringContract } from "@/components/dashboard/widgets/recurring-widget";
import { holdingsContract } from "@/components/dashboard/widgets/holdings-widget";
```

- [ ] **Step 2: Add four entries to the `WIDGETS` map**

Insert before the closing `};` of `WIDGETS` (after the `aiAlert` entry, ~line 127):

```tsx
  creditCard: {
    title: "Credit Cards",
    icon: CreditCard,
    defW: 5,
    defH: 2,
    controls: { fields: ["count", ...SHARED_FIELDS], countRange: [1, 6], toggles: [{ key: "utilization", label: "Utilization" }, { key: "due", label: "Due dates" }, { key: "amounts", label: "Amounts" }] },
    defaults: { preset: "standard", count: 3, show: { utilization: true, due: true, amounts: true }, accent: null },
    contract: creditCardContract as WidgetContract<unknown>,
  },
  debt: {
    title: "Debt",
    icon: Landmark,
    defW: 5,
    defH: 2,
    controls: { fields: ["count", ...SHARED_FIELDS], countRange: [1, 6], toggles: [{ key: "rate", label: "APR" }, { key: "monthly", label: "Monthly" }, { key: "includeCC", label: "Include cards" }] },
    defaults: { preset: "standard", count: 3, show: { rate: true, monthly: true, includeCC: false }, accent: null },
    contract: debtContract as WidgetContract<unknown>,
  },
  recurring: {
    title: "Recurring",
    icon: Repeat,
    defW: 5,
    defH: 2,
    controls: { fields: ["count", ...SHARED_FIELDS], countRange: [1, 8], toggles: [{ key: "bills", label: "Bills" }, { key: "subscriptions", label: "Subscriptions" }, { key: "amounts", label: "Amounts" }] },
    defaults: { preset: "standard", count: 5, show: { bills: true, subscriptions: true, amounts: true }, accent: null },
    contract: recurringContract as WidgetContract<unknown>,
  },
  holdings: {
    title: "Holdings",
    icon: LineChart,
    defW: 5,
    defH: 2,
    controls: { fields: ["count", ...SHARED_FIELDS], countRange: [1, 8], toggles: [{ key: "gain", label: "Gain/loss" }, { key: "symbol", label: "Symbol" }] },
    defaults: { preset: "standard", count: 3, show: { gain: true, symbol: true }, accent: null },
    contract: holdingsContract as WidgetContract<unknown>,
  },
```

- [ ] **Step 3: Typecheck and run the full widget test suite**

Run: `cd web && npx tsc --noEmit && npm run test:unit`
Expected: tsc clean; all widget tests pass (existing + 4 new files).

- [ ] **Step 4: Commit**

```bash
git add web/lib/dashboard/registry.tsx
git commit -m "feat(dashboard): register credit-card/debt/recurring/holdings widgets (slice C)"
```

---

### Task 6: Breakdown widget responsive fix

**Files:**
- Modify: `web/components/dashboard/widgets/breakdown-widget.tsx` (donut tier in `Body`, ~lines 62-70; add a `donutSize(w, h)` helper)
- Modify: `web/components/dashboard/widgets/breakdown-widget.test.tsx` (add a test for `donutSize`)

**Interfaces:**
- Produces: `donutSize(w: number, h: number): string` (exported pure helper returning a Tailwind size class).

- [ ] **Step 1: Write the failing test**

Add to `web/components/dashboard/widgets/breakdown-widget.test.tsx`:

```tsx
import { donutSize } from "./breakdown-widget";

describe("donutSize", () => {
  it("grows the donut at taller footprints", () => {
    const small = donutSize(2, 2);
    const tall = donutSize(5, 3);
    expect(small).not.toBe(tall);
    expect(tall).toBe("size-36");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/breakdown-widget.test.tsx`
Expected: FAIL — `donutSize` is not exported.

- [ ] **Step 3: Add the helper and fix the donut tier**

Add the exported helper near the other module helpers (e.g. after `OTHER_COLOR`):

```tsx
export function donutSize(w: number, h: number): string {
  if (h >= 3) return "size-36";
  if (w >= 5 && h >= 2) return "size-28";
  if (w >= 4 && h >= 2) return "size-24";
  return "size-20";
}
```

Replace the donut-tier return block (currently lines ~62-70, the `density >= 2` donut branch) with a vertically centered layout that uses the helper and centers horizontally when the legend is hidden:

```tsx
    const chartRows = withOtherRow(visible, total);
    const showLegend = config.show?.legend ?? true;
    return (
      <div className="flex h-full min-h-0 flex-col justify-center overflow-hidden">
        <div className={`flex min-h-0 items-center gap-5 ${showLegend ? "" : "justify-center"}`}>
          <div className={`${donutSize(w, h)} shrink-0 rounded-full`} style={{ background: `conic-gradient(${donutStops(chartRows, total)})`, mask: "radial-gradient(transparent 52%,#000 53%)", WebkitMask: "radial-gradient(transparent 52%,#000 53%)" }} />
          {showLegend && <Legend rows={chartRows} total={total} showAmounts={showAmounts} />}
        </div>
      </div>
    );
```

(Changes vs. original: `justify-start ... pt-1` → `justify-center`; inner row `items-start` → `items-center` plus conditional `justify-center`; fixed `size-28/size-20` ternary → `donutSize(w, h)`; legend gated on `showLegend`.)

- [ ] **Step 4: Run tests to verify pass**

Run: `cd web && npx vitest run components/dashboard/widgets/breakdown-widget.test.tsx`
Expected: PASS (existing breakdown tests + new `donutSize` test).

- [ ] **Step 5: Manual visual verification**

Run: `cd web && npm run dev`, open the dashboard, place a Breakdown widget, and resize to footprints 2×2, 5×2, 4×3, 5×3 with legend on and off. Confirm: donut + legend stay vertically centered (no dead band at h≥3), donut grows at h≥3, and donut centers horizontally when the legend is off.

- [ ] **Step 6: Commit**

```bash
git add web/components/dashboard/widgets/breakdown-widget.tsx web/components/dashboard/widgets/breakdown-widget.test.tsx
git commit -m "fix(dashboard): center + scale breakdown donut tier (slice C)"
```

---

## Self-Review Notes

- **Spec coverage:** Credit Card (Task 1), Debt (Task 2), Recurring (Task 3), Holdings (Task 4), registry/no-range (Task 5), breakdown responsive fix (Task 6). Merchant intentionally absent (covered by breakdown). All spec sections mapped.
- **Deferred (documented):** Debt live snowball/avalanche via `usePayoffStrategy` — Focus uses a client-side `principal / monthly` month estimate instead. Multi-currency normalization — out of scope per spec.
- **Type consistency:** VM builder names (`creditCardVM`/`debtVM`/`recurringVM`/`holdingsVM`), contract names (`*Contract`), and the registry keys (`creditCard`/`debt`/`recurring`/`holdings`) are consistent across tasks. All `deriveInsights` return `Insight[]`.
- **Verify field shapes at execution:** `CreditCardOut.loan` exposes `id`, `name`, `next_due_date` (confirmed in `backend/app/loans/schemas.py`); `RecurringSeriesOut.merchant_name`, `HoldingOut.latest_valuation.value` confirmed in `backend/app/widget_data/schemas.py`. The generated `shared/api-schema.ts` types these as strings (Decimals serialize to string) — `Number(...)` coercion is applied throughout.
