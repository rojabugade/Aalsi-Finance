# Slice F — Templates + Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blank/default first-run dashboard with a goal-driven onboarding flow that generates a preset board, and let any user re-pick a template later from the Personalize pane.

**Architecture:** A thin data + UI layer over the existing board engine. Six pure-data templates compose existing pooled widgets; a deterministic builder turns a template into `GridItem[]`; both onboarding and manual paths apply via the existing `useDashboard().applySetup(items, prefs)`. A localStorage flag gates first-run. No engine, schema, or backend changes; no `BOARD_VERSION` bump.

**Tech Stack:** Next.js (App Router, client components), TypeScript, Vitest (pure-fn + RTL), Playwright (e2e), shadcn `Dialog` (Radix), lucide-react icons, Tailwind.

## Global Constraints

- Grid is 10 columns (`GRID_COLS = 10`, `web/lib/dashboard/grid.ts`). Default widget size is `5×2`.
- Every template widget type MUST be a member of `BOARDS.dashboard.pool` (`web/lib/dashboard/boards.ts`).
- Apply path is the existing `useDashboard().applySetup(items, prefs)` only — do NOT add new controller mutations.
- Do NOT bump `BOARD_VERSION` (stays `4`). Templates do not migrate or wipe saved boards.
- No backend, no new widget types, no LLM calls (goal→board is deterministic; AI is slice G).
- `next lint` is unavailable in this repo. Verify with `npx tsc --noEmit`, `npx vitest run`, and Playwright.
- All localStorage access must guard `typeof localStorage === "undefined"` (SSR-safe), mirroring `web/lib/dashboard/layout-presets.ts`.
- Inline English strings (no i18n keys), per repo convention.
- Vision→type mapping (fixed): "Upcoming Bills"→`recurring`; "Top Alert"/"Analyst Alerts"→`aiAlert`; "Investments"→`holdings`; "Merchant Spending"→`breakdown` with `config.dimension: "merchant"`.

---

### Task 1: Template data + builder (`templates.ts`)

**Files:**
- Create: `web/lib/dashboard/templates.ts`
- Test: `web/lib/dashboard/templates.test.ts`

**Interfaces:**
- Consumes: `WidgetType`, `WidgetConfig`, `GridItem` from `./grid`; `BoardPrefs` from `./boards`; `LucideIcon` from `lucide-react`.
- Produces:
  - `type TemplateId = "starter" | "minimal" | "debt" | "creditCard" | "spending" | "netWorth"`
  - `type TemplateSpec = { type: WidgetType; x: number; y: number; w: number; h: number; config?: WidgetConfig }`
  - `type DashboardTemplate = { id: TemplateId; goal: string; name: string; description: string; icon: LucideIcon; blurb: string; items: TemplateSpec[]; prefs?: Partial<BoardPrefs> }`
  - `const TEMPLATES: DashboardTemplate[]` (6 entries, ordered as below)
  - `function itemsFromTemplate(t: DashboardTemplate): GridItem[]`
  - `function getTemplate(id: TemplateId): DashboardTemplate`

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/dashboard/templates.test.ts
import { describe, expect, it } from "vitest";
import { TEMPLATES, itemsFromTemplate, getTemplate, type TemplateId } from "./templates";
import { BOARDS } from "./boards";
import { GRID_COLS, collide, type GridItem } from "./grid";

const GOALS = [
  "Understand my money", "Keep it minimal", "Pay off debt",
  "Manage credit cards", "Track spending", "Build net worth",
];

describe("dashboard templates", () => {
  it("defines exactly 6 templates with unique ids", () => {
    expect(TEMPLATES).toHaveLength(6);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(6);
  });

  it("covers each onboarding goal exactly once", () => {
    expect(TEMPLATES.map((t) => t.goal).sort()).toEqual([...GOALS].sort());
  });

  it("only uses widget types offered by the dashboard board pool", () => {
    const pool = new Set(BOARDS.dashboard.pool);
    for (const t of TEMPLATES) {
      for (const item of t.items) {
        expect(pool.has(item.type), `${t.id}:${item.type}`).toBe(true);
      }
    }
  });

  it("places every widget inside the grid with no overlaps", () => {
    for (const t of TEMPLATES) {
      const items = itemsFromTemplate(t);
      for (const it of items) {
        expect(it.x).toBeGreaterThanOrEqual(0);
        expect(it.x + it.w).toBeLessThanOrEqual(GRID_COLS);
        expect(it.h).toBeGreaterThan(0);
      }
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          expect(collide(items[i] as GridItem, items[j] as GridItem)).toBe(false);
        }
      }
    }
  });

  it("builds items with unique fresh ids prefixed by type", () => {
    const t = getTemplate("debt" as TemplateId);
    const items = itemsFromTemplate(t);
    expect(items).toHaveLength(t.items.length);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items[0]?.id.startsWith(items[0]?.type ?? "")).toBe(true);
  });

  it("carries spec config through to built items", () => {
    const cc = getTemplate("creditCard" as TemplateId);
    const built = itemsFromTemplate(cc);
    const breakdown = built.find((i) => i.type === "breakdown");
    expect(breakdown?.config?.dimension).toBe("merchant");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/dashboard/templates.test.ts`
Expected: FAIL — cannot find module `./templates`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/lib/dashboard/templates.ts
import {
  Compass, Minimize2, TrendingDown, CreditCard as CreditCardIcon,
  ShoppingBag, LineChart, type LucideIcon,
} from "lucide-react";
import type { GridItem, WidgetConfig, WidgetType } from "./grid";
import type { BoardPrefs } from "./boards";

export type TemplateId = "starter" | "minimal" | "debt" | "creditCard" | "spending" | "netWorth";

export type TemplateSpec = {
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: WidgetConfig;
};

export type DashboardTemplate = {
  id: TemplateId;
  goal: string;        // onboarding modal label
  name: string;        // template name
  description: string; // card subtitle
  icon: LucideIcon;
  blurb: string;       // post-apply confirmation message
  items: TemplateSpec[];
  prefs?: Partial<BoardPrefs>;
};

// Two 5-wide widgets per row on the 10-col grid.
const r = (n: number) => n * 2; // row y for the nth row
const L = 0;
const R = 5;

export const TEMPLATES: DashboardTemplate[] = [
  {
    id: "starter",
    goal: "Understand my money",
    name: "Starter",
    description: "A balanced view of spending, bills, and budgets.",
    icon: Compass,
    blurb: "I set up this dashboard to focus on cashflow, recent activity, and budget risk. You can customize anything.",
    items: [
      { type: "cashflow", x: L, y: r(0), w: 5, h: 2, config: { range: "6m" } },
      { type: "recentActivity", x: R, y: r(0), w: 5, h: 2 },
      { type: "budgets", x: L, y: r(1), w: 5, h: 2 },
      { type: "recurring", x: R, y: r(1), w: 5, h: 2 },
      { type: "aiAlert", x: L, y: r(2), w: 5, h: 2 },
    ],
  },
  {
    id: "minimal",
    goal: "Keep it minimal",
    name: "Minimal Money",
    description: "Just the essentials — net worth, cashflow, and what's due.",
    icon: Minimize2,
    blurb: "I kept it minimal: net worth, cashflow, upcoming bills, and your top alert.",
    items: [
      { type: "netWorth", x: L, y: r(0), w: 5, h: 2, config: { range: "6m" } },
      { type: "cashflow", x: R, y: r(0), w: 5, h: 2, config: { range: "6m" } },
      { type: "recurring", x: L, y: r(1), w: 5, h: 2 },
      { type: "aiAlert", x: R, y: r(1), w: 5, h: 2 },
    ],
    prefs: { densityMode: "calm", density: "spacious" },
  },
  {
    id: "debt",
    goal: "Pay off debt",
    name: "Debt Payoff",
    description: "Track balances, cashflow, and budget room to pay down debt.",
    icon: TrendingDown,
    blurb: "I focused this dashboard on your debt, cashflow, budgets, and credit cards.",
    items: [
      { type: "debt", x: L, y: r(0), w: 5, h: 2 },
      { type: "cashflow", x: R, y: r(0), w: 5, h: 2, config: { range: "6m" } },
      { type: "budgets", x: L, y: r(1), w: 5, h: 2 },
      { type: "creditCard", x: R, y: r(1), w: 5, h: 2 },
      { type: "aiAlert", x: L, y: r(2), w: 5, h: 2 },
    ],
  },
  {
    id: "creditCard",
    goal: "Manage credit cards",
    name: "Credit Card",
    description: "Card activity, recurring charges, and merchant spend.",
    icon: CreditCardIcon,
    blurb: "I set this up around your cards: balances, recent activity, recurring charges, and merchant spend.",
    items: [
      { type: "creditCard", x: L, y: r(0), w: 5, h: 2 },
      { type: "recentActivity", x: R, y: r(0), w: 5, h: 2 },
      { type: "recurring", x: L, y: r(1), w: 5, h: 2 },
      { type: "breakdown", x: R, y: r(1), w: 5, h: 2, config: { dimension: "merchant", title: "Merchant Spending" } },
      { type: "aiAlert", x: L, y: r(2), w: 5, h: 2 },
    ],
  },
  {
    id: "spending",
    goal: "Track spending",
    name: "Spending Tracker",
    description: "Where your money goes — budgets, merchants, and activity.",
    icon: ShoppingBag,
    blurb: "I focused this dashboard on your spending: budgets, merchants, recent activity, and recurring charges.",
    items: [
      { type: "budgets", x: L, y: r(0), w: 5, h: 2 },
      { type: "breakdown", x: R, y: r(0), w: 5, h: 2, config: { dimension: "merchant", title: "Merchant Spending" } },
      { type: "recentActivity", x: L, y: r(1), w: 5, h: 2 },
      { type: "recurring", x: R, y: r(1), w: 5, h: 2 },
      { type: "cashflow", x: L, y: r(2), w: 5, h: 2, config: { range: "6m" } },
    ],
  },
  {
    id: "netWorth",
    goal: "Build net worth",
    name: "Net Worth",
    description: "Wealth over time — net worth, investments, and debt.",
    icon: LineChart,
    blurb: "I set this up to track wealth: net worth, cashflow, investments, and debt.",
    items: [
      { type: "netWorth", x: L, y: r(0), w: 5, h: 2, config: { range: "6m", preset: "detailed" } },
      { type: "cashflow", x: R, y: r(0), w: 5, h: 2, config: { range: "6m" } },
      { type: "holdings", x: L, y: r(1), w: 5, h: 2 },
      { type: "debt", x: R, y: r(1), w: 5, h: 2 },
      { type: "aiAlert", x: L, y: r(2), w: 5, h: 2 },
    ],
  },
];

let idSeq = 0;
export function itemsFromTemplate(t: DashboardTemplate): GridItem[] {
  return t.items.map((spec) => ({
    id: `${spec.type}-${Date.now()}-${idSeq++}`,
    type: spec.type,
    x: spec.x,
    y: spec.y,
    w: spec.w,
    h: spec.h,
    ...(spec.config ? { config: { ...spec.config } } : {}),
  }));
}

export function getTemplate(id: TemplateId): DashboardTemplate {
  const found = TEMPLATES.find((t) => t.id === id);
  if (!found) throw new Error(`Unknown template: ${id}`);
  return found;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/dashboard/templates.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/dashboard/templates.ts web/lib/dashboard/templates.test.ts
git commit -m "feat(dashboard): preset template data + itemsFromTemplate builder"
```

---

### Task 2: First-run gate (`onboarding-gate.ts`) + protect existing e2e

**Files:**
- Create: `web/lib/dashboard/onboarding-gate.ts`
- Test: `web/lib/dashboard/onboarding-gate.test.ts`
- Modify: `web/e2e/dashboard-personalize.spec.ts`, `web/e2e/dashboard-grid.spec.ts`, `web/e2e/widget-rendering.spec.ts` (their `addInitScript` blocks)

**Interfaces:**
- Consumes: `STORAGE_PREFIX` from `./layout-store` (board key = `cf-board:<boardId>`).
- Produces:
  - `function shouldOnboard(boardId: string): boolean`
  - `function markOnboarded(boardId: string): void`
  - `const ONBOARD_PREFIX = "cf-onboarded:"`

**Gate rule:** open the modal only when the onboarded flag is absent. If a saved board already exists (pre-F user), silently set the flag and return `false` (never disturb existing customizations).

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/dashboard/onboarding-gate.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { shouldOnboard, markOnboarded, ONBOARD_PREFIX } from "./onboarding-gate";
import { STORAGE_PREFIX } from "./layout-store";

afterEach(() => localStorage.clear());

describe("onboarding gate", () => {
  it("opens when no flag and no saved board", () => {
    expect(shouldOnboard("dashboard")).toBe(true);
  });

  it("does not open once marked onboarded", () => {
    markOnboarded("dashboard");
    expect(localStorage.getItem(ONBOARD_PREFIX + "dashboard")).toBe("1");
    expect(shouldOnboard("dashboard")).toBe(false);
  });

  it("treats an existing saved board as already onboarded and sets the flag", () => {
    localStorage.setItem(STORAGE_PREFIX + "dashboard", JSON.stringify({ version: 4, items: [], prefs: {} }));
    expect(shouldOnboard("dashboard")).toBe(false);
    expect(localStorage.getItem(ONBOARD_PREFIX + "dashboard")).toBe("1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/dashboard/onboarding-gate.test.ts`
Expected: FAIL — cannot find module `./onboarding-gate`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/lib/dashboard/onboarding-gate.ts
import { STORAGE_PREFIX } from "./layout-store";

export const ONBOARD_PREFIX = "cf-onboarded:";

export function markOnboarded(boardId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ONBOARD_PREFIX + boardId, "1");
}

export function shouldOnboard(boardId: string): boolean {
  if (typeof localStorage === "undefined") return false;
  if (localStorage.getItem(ONBOARD_PREFIX + boardId)) return false;
  // Pre-F user with an existing board: never interrupt — flag and skip.
  if (localStorage.getItem(STORAGE_PREFIX + boardId)) {
    markOnboarded(boardId);
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/dashboard/onboarding-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Protect the three e2e specs that wipe the board**

In each of `web/e2e/dashboard-personalize.spec.ts`, `web/e2e/dashboard-grid.spec.ts`, and `web/e2e/widget-rendering.spec.ts`, find the `addInitScript` block inside `authenticate(...)` that contains:

```ts
        window.localStorage.removeItem("cf-board:dashboard");
        window.sessionStorage.setItem("cf.e2eDashboardSeeded", "1");
```

Add the onboarded flag immediately after the `removeItem` line so the onboarding modal never auto-opens in these suites:

```ts
        window.localStorage.removeItem("cf-board:dashboard");
        window.localStorage.setItem("cf-onboarded:dashboard", "1");
        window.sessionStorage.setItem("cf.e2eDashboardSeeded", "1");
```

- [ ] **Step 6: Commit**

```bash
git add web/lib/dashboard/onboarding-gate.ts web/lib/dashboard/onboarding-gate.test.ts \
  web/e2e/dashboard-personalize.spec.ts web/e2e/dashboard-grid.spec.ts web/e2e/widget-rendering.spec.ts
git commit -m "feat(dashboard): first-run onboarding gate + shield existing e2e from modal"
```

---

### Task 3: `TemplateGallery` component

**Files:**
- Create: `web/components/dashboard/onboarding/template-gallery.tsx`
- Test: `web/components/dashboard/onboarding/template-gallery.test.tsx`

**Interfaces:**
- Consumes: `TEMPLATES`, `type TemplateId` from `@/lib/dashboard/templates`.
- Produces: `function TemplateGallery(props: { onPick: (id: TemplateId) => void; selectedId?: TemplateId | null; labelKey?: "goal" | "name" })`
  - `labelKey` selects the card's primary line — `"goal"` for the onboarding modal, `"name"` for the pane. Defaults to `"name"`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/onboarding/template-gallery.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplateGallery } from "./template-gallery";
import { TEMPLATES } from "@/lib/dashboard/templates";

describe("TemplateGallery", () => {
  it("renders a card per template", () => {
    render(<TemplateGallery onPick={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(TEMPLATES.length);
  });

  it("fires onPick with the template id", () => {
    const onPick = vi.fn();
    render(<TemplateGallery onPick={onPick} labelKey="goal" />);
    fireEvent.click(screen.getByRole("button", { name: /Pay off debt/i }));
    expect(onPick).toHaveBeenCalledWith("debt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/onboarding/template-gallery.test.tsx`
Expected: FAIL — cannot find module `./template-gallery`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/components/dashboard/onboarding/template-gallery.tsx
"use client";
import { Check } from "lucide-react";
import { TEMPLATES, type TemplateId } from "@/lib/dashboard/templates";

export function TemplateGallery({
  onPick,
  selectedId = null,
  labelKey = "name",
}: {
  onPick: (id: TemplateId) => void;
  selectedId?: TemplateId | null;
  labelKey?: "goal" | "name";
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {TEMPLATES.map((t) => {
        const Icon = t.icon;
        const selected = selectedId === t.id;
        const primary = labelKey === "goal" ? t.goal : t.name;
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(t.id)}
            className={`flex min-h-[92px] w-full items-start gap-3 rounded-[0.95rem] border p-4 text-left transition-colors ${selected ? "border-accent bg-accent-soft/15 shadow-[0_0_0_1px_var(--accent)]" : "border-border bg-card/35 hover:border-accent/50"}`}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft/40 text-accent">
              <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold leading-4">{primary}</span>
              <span className="mt-1.5 block text-[11px] leading-4 text-muted">{t.description}</span>
            </span>
            {selected && (
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
                <Check className="size-3.5" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/onboarding/template-gallery.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/onboarding/template-gallery.tsx web/components/dashboard/onboarding/template-gallery.test.tsx
git commit -m "feat(dashboard): shared TemplateGallery card grid"
```

---

### Task 4: `OnboardingModal` component

**Files:**
- Create: `web/components/dashboard/onboarding/onboarding-modal.tsx`

**Interfaces:**
- Consumes: `Dialog`, `DialogContent`, `DialogTitle` from `@/components/ui/dialog`; `TemplateGallery` from `./template-gallery`; `type TemplateId` from `@/lib/dashboard/templates`.
- Produces: `function OnboardingModal(props: { open: boolean; onPick: (id: TemplateId) => void; onSkip: () => void })`
  - This component is presentation only. The parent owns applying the template, marking onboarded, and the post-apply banner. `onPick` and `onSkip` are both terminal (parent closes the modal).

- [ ] **Step 1: Write the implementation** (no separate unit test — covered by the page e2e in Task 7; render correctness of cards is already covered in Task 3)

```tsx
// web/components/dashboard/onboarding/onboarding-modal.tsx
"use client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TemplateGallery } from "./template-gallery";
import type { TemplateId } from "@/lib/dashboard/templates";

export function OnboardingModal({
  open,
  onPick,
  onSkip,
}: {
  open: boolean;
  onPick: (id: TemplateId) => void;
  onSkip: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onSkip(); }}>
      <DialogContent className="max-h-[88vh] w-[min(94vw,720px)] max-w-none overflow-y-auto">
        <DialogTitle>What's your focus?</DialogTitle>
        <p className="mt-1 text-[13px] text-muted">
          Pick a goal and I'll set up a dashboard for it. You can change everything later.
        </p>
        <div className="mt-4">
          <TemplateGallery onPick={onPick} labelKey="goal" />
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg border border-border px-3 py-2 text-[12px] font-semibold text-muted hover:border-accent/50 hover:text-fg"
          >
            Skip — I'll explore on my own
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/components/dashboard/onboarding/onboarding-modal.tsx
git commit -m "feat(dashboard): onboarding goal-picker modal"
```

---

### Task 5: Wire onboarding into the dashboard page (gate + modal + blurb banner)

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `shouldOnboard`, `markOnboarded` from `@/lib/dashboard/onboarding-gate`; `OnboardingModal` from `@/components/dashboard/onboarding/onboarding-modal`; `getTemplate`, `itemsFromTemplate`, `type TemplateId` from `@/lib/dashboard/templates`; existing `controller.applySetup`.
- Produces: first-run modal behavior + dismissible blurb banner on the page.

- [ ] **Step 1: Add state, gate effect, and handlers**

In `web/app/(app)/dashboard/page.tsx`, add imports at the top with the other imports:

```tsx
import { OnboardingModal } from "@/components/dashboard/onboarding/onboarding-modal";
import { shouldOnboard, markOnboarded } from "@/lib/dashboard/onboarding-gate";
import { getTemplate, itemsFromTemplate, type TemplateId } from "@/lib/dashboard/templates";
```

Inside `DashboardPage`, after the existing `const [tab, setTab] = useState<PaneTab>("layout");` line, add:

```tsx
  const [onboarding, setOnboarding] = useState(false);
  const [blurb, setBlurb] = useState<string | null>(null);

  useEffect(() => {
    if (shouldOnboard("dashboard")) setOnboarding(true);
  }, []);

  const pickTemplate = (id: TemplateId) => {
    const t = getTemplate(id);
    controller.applySetup(itemsFromTemplate(t), t.prefs ?? {});
    markOnboarded("dashboard");
    setOnboarding(false);
    setBlurb(t.blurb);
  };

  const skipOnboarding = () => {
    markOnboarded("dashboard");
    setOnboarding(false);
  };
```

- [ ] **Step 2: Render the modal and the blurb banner**

In the returned JSX, immediately after the opening `<div className="space-y-3">`, add the banner; and before the closing `</div>`, add the modal:

```tsx
    <div className="space-y-3">
      {blurb && (
        <div className="flex items-start gap-3 rounded-[0.95rem] border border-accent/40 bg-accent-soft/15 px-4 py-3">
          <p className="flex-1 text-[13px] text-fg">{blurb}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setBlurb(null)}
            className="text-[12px] font-semibold text-muted hover:text-fg"
          >
            Got it
          </button>
        </div>
      )}
      {/* ...existing DashboardControls + PrivacyProvider/DashboardGrid... */}
      <OnboardingModal open={onboarding} onPick={pickTemplate} onSkip={skipOnboarding} />
    </div>
```

(Keep the existing `DashboardControls` and `PrivacyProvider` blocks exactly as they are between the banner and the modal.)

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): first-run onboarding modal + confirmation banner on dashboard"
```

---

### Task 6: "Start from a template" section in the Layout tab

**Files:**
- Modify: `web/components/dashboard/grid/personalize/personalize-pane.tsx`

**Interfaces:**
- Consumes: `TemplateGallery` from `@/components/dashboard/onboarding/template-gallery`; `getTemplate`, `itemsFromTemplate`, `type TemplateId` from `@/lib/dashboard/templates`; existing `controller.applySetup`.
- Produces: a template picker inside `LayoutPanel` that applies a template directly (no first-run flag).

- [ ] **Step 1: Add imports**

At the top of `web/components/dashboard/grid/personalize/personalize-pane.tsx`, add to the imports:

```tsx
import { TemplateGallery } from "@/components/dashboard/onboarding/template-gallery";
import { getTemplate, itemsFromTemplate, type TemplateId } from "@/lib/dashboard/templates";
```

- [ ] **Step 2: Add the section to `LayoutPanel`**

In the `LayoutPanel` function, add an `applyTemplate` handler near the existing `applyDensityMode`:

```tsx
  const applyTemplate = (id: TemplateId) => {
    const t = getTemplate(id);
    controller.applySetup(itemsFromTemplate(t), t.prefs ?? {});
  };
```

Then, inside the returned JSX, insert a new section as the FIRST child of the outer `<div>` (above the existing `<div className="grid lg:grid-cols-[1.02fr_0.98fr]">`):

```tsx
      <div className="border-b border-border p-4">
        <p className="text-[15px] font-bold">Start from a template</p>
        <p className="mt-1.5 text-[12px] text-muted">Replace your widgets with a goal-focused set. This swaps the board layout.</p>
        <div className="mt-3">
          <TemplateGallery onPick={applyTemplate} labelKey="name" />
        </div>
      </div>
```

- [ ] **Step 3: Typecheck + run the pane test**

Run: `cd web && npx tsc --noEmit && npx vitest run components/dashboard/grid/personalize/personalize-pane.test.tsx`
Expected: no type errors; pane test PASS.

- [ ] **Step 4: Commit**

```bash
git add web/components/dashboard/grid/personalize/personalize-pane.tsx
git commit -m "feat(dashboard): 'Start from a template' section in Layout tab"
```

---

### Task 7: E2E — onboarding first-run flow

**Files:**
- Create: `web/e2e/dashboard-onboarding.spec.ts`

**Interfaces:**
- Consumes: the running web + api stack (`E2E_*` env, defaults match other specs). Test creds `dev@example.com` / `hunter2pass`.

- [ ] **Step 1: Write the e2e test**

```ts
// web/e2e/dashboard-onboarding.spec.ts
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function signup(request: APIRequestContext) {
  const res = await request.post(`${API}/auth/signup`, {
    data: { email: EMAIL, password: PASSWORD, display_name: "E2E", household_name: "E2E House" },
  });
  if (res.ok()) return (await res.json()) as { access_token: string; refresh_token: string };
  const login = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD, totp_code: null },
  });
  expect(login.ok(), `login failed: ${login.status()}`).toBeTruthy();
  return (await login.json()) as { access_token: string; refresh_token: string };
}

// Fresh first-run: clear BOTH the saved board and the onboarded flag every load.
async function authenticateFresh(page: Page, tokens: { access_token: string; refresh_token: string }) {
  await page.addInitScript(
    (t) => {
      window.localStorage.setItem("cbf.accessToken", t.access);
      window.localStorage.setItem("cbf.refreshToken", t.refresh);
      window.localStorage.removeItem("cf-board:dashboard");
      window.localStorage.removeItem("cf-onboarded:dashboard");
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

test.describe("dashboard onboarding", () => {
  test("first visit shows goal modal; picking a goal generates the board and persists", async ({ page, request }) => {
    await authenticateFresh(page, await signup(request));
    await page.goto("/dashboard");

    // Modal visible on first run.
    await expect(page.getByText("What's your focus?")).toBeVisible();

    // Pick "Pay off debt" → debt template applies, modal closes, blurb shows.
    await page.getByRole("button", { name: /Pay off debt/i }).click();
    await expect(page.getByText("What's your focus?")).toHaveCount(0);
    await expect(page.getByText(/focused this dashboard on your debt/i)).toBeVisible();

    // Re-loading the SAME page (flag now set) does not re-open the modal.
    await page.reload();
    await expect(page.getByText("What's your focus?")).toHaveCount(0);
  });

  test("skip keeps the default board and never re-opens", async ({ page, request }) => {
    await authenticateFresh(page, await signup(request));
    await page.goto("/dashboard");
    await expect(page.getByText("What's your focus?")).toBeVisible();
    await page.getByRole("button", { name: /Skip/i }).click();
    await expect(page.getByText("What's your focus?")).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the e2e (requires the dev stack up)**

Run: `cd web && npx playwright test e2e/dashboard-onboarding.spec.ts`
Expected: 2 passed. (If the stack is not running, start it per the repo's usual web+api dev procedure, then re-run.)

- [ ] **Step 3: Commit**

```bash
git add web/e2e/dashboard-onboarding.spec.ts
git commit -m "test(dashboard): e2e — onboarding first-run goal flow"
```

---

### Task 8: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole web app**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the full unit/component suite**

Run: `cd web && npx vitest run`
Expected: all green (prior suite count + the new `templates`, `onboarding-gate`, `template-gallery` tests).

- [ ] **Step 3: Run the affected e2e specs**

Run: `cd web && npx playwright test e2e/dashboard-onboarding.spec.ts e2e/dashboard-personalize.spec.ts e2e/dashboard-grid.spec.ts e2e/widget-rendering.spec.ts`
Expected: all pass (confirms the three shielded specs still pass with the gate in place).

- [ ] **Step 4: Commit (only if any incidental fixes were needed)**

```bash
git add -A
git commit -m "chore(dashboard): slice F verification fixes"
```

(If steps 1–3 were clean with nothing to change, skip this commit.)

---

## Self-Review

**Spec coverage:**
- 6 templates (data) → Task 1. ✓ goal→widget mapping table matches spec.
- Deterministic builder → Task 1 (`itemsFromTemplate`). ✓
- First-run gate (`cf-onboarded:dashboard`, pre-F-user shield) → Task 2. ✓
- Onboarding modal (goal picker + skip + blurb) → Tasks 4 + 5. ✓
- Shared `TemplateGallery` → Task 3, reused in Tasks 4 (modal) and 6 (pane). ✓
- Layout-tab "Start from a template" section → Task 6. ✓
- Tests: templates / gallery / gate / e2e → Tasks 1,2,3,7; full sweep Task 8. ✓
- Non-destructive, no `BOARD_VERSION` bump, no backend → respected (apply via `applySetup` only). ✓
- Edge case: existing e2e specs that wipe the board are shielded → Task 2 Step 5. ✓

**Placeholder scan:** none — every code step shows complete code; no TODO/TBD.

**Type consistency:** `TemplateId`, `DashboardTemplate`, `itemsFromTemplate`, `getTemplate` defined in Task 1 and consumed verbatim in Tasks 3–6. `TemplateGallery` signature (`onPick`, `selectedId`, `labelKey`) defined in Task 3, used identically in Tasks 4 and 6. `shouldOnboard`/`markOnboarded` defined in Task 2, used in Task 5. `applySetup(items, prefs)` matches the existing controller signature (verified in `use-dashboard.ts`).
