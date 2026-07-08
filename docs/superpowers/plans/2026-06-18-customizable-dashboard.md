# Customizable Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed Dashboard surface with a customizable, free-canvas widget board — drag/resize widgets anywhere, gravity-packed (no gaps), with size-responsive content, a Personalize panel, and per-user persistence — ported from the v9 mockup (`.superpowers/brainstorm/20871-1781716228/content/overview-os-v9.html`).

**Architecture:** A pure, unit-tested grid engine (`lib/dashboard/grid.ts`) owns all geometry (collision, gravity compaction, move, resize). A localStorage-backed layout store persists item placement per board. A widget registry maps widget types → size-responsive React components wired to the existing TanStack data hooks. A `DashboardGrid` client component renders widgets absolutely-positioned and drives pointer drag/resize against the engine; a `PersonalizeSheet` (radix Sheet) exposes theme, density, radius, transparency, the widget library (add), and visibility (hide). Everything reuses the app's existing CSS-var token system, so the board themes for free under emerald/indigo/ink × light/dark.

**Tech Stack:** Next.js (app router, client components), TypeScript, Tailwind (existing token config), TanStack Query (existing `lib/api/*` hooks), Radix Sheet/Dialog (already installed), Vitest (added in Task 0 for the engine), Playwright (existing, for E2E).

---

## Decisions & Assumptions (confirm or veto before executing)

1. **Themes = existing palettes, not the mockup's.** The mockup's Reserve/Dollar/Midnight are *not* ported. "Theme" in Personalize drives the app's existing `useTheme()` (emerald/indigo/ink × light/dark). The board consumes app tokens (`bg-card`, `text-muted`, `text-c3`, `shadow-card`, `var(--accent)`…), so theming is automatic. Adding the 3 mockup palettes later is a pure CSS-var addition, out of scope here.
2. **Scope = the Dashboard surface only.** The engine, store, registry and grid are written generically (keyed by a `boardId`) so extending to Accounts/Transactions/Budget/Investments/Debt and adding the Analyst right-rail is a clean follow-up (see "Follow-up" at the end). This plan ships one working, testable surface.
3. **Persistence = client-side localStorage**, keyed by `boardId`. Server sync is a future enhancement; the store interface is written so a server adapter can replace localStorage without touching callers.
4. **Density / radius / transparency** are board-scoped CSS variables set on the grid container (not global), persisted in the layout store.
5. **Grid model:** 4 columns, gravity compaction upward (no empty gaps), pointer-based drag + corner-resize, widget content re-renders across `sm | md | lg` tiers by `w×h`.

---

## File Structure

**Create:**
- `web/lib/dashboard/grid.ts` — pure engine: types + `collide`, `compact`, `packAround`, `moveTo`, `resizeTo`, `firstFreeRow`.
- `web/lib/dashboard/grid.test.ts` — Vitest unit tests for the engine.
- `web/lib/dashboard/boards.ts` — board definitions (id, column pool, default layout) for the dashboard board.
- `web/lib/dashboard/layout-store.ts` — localStorage load/save + defaults + versioning.
- `web/lib/dashboard/use-dashboard.ts` — React state hook (items, prefs, actions).
- `web/lib/dashboard/registry.tsx` — widget registry: `WidgetType`, `WIDGETS`, `tierOf`.
- `web/components/dashboard/widgets/widget-tier.tsx` — `useWidgetTier` + `CompactStat` helper.
- `web/components/dashboard/widgets/net-worth-widget.tsx`
- `web/components/dashboard/widgets/safe-to-spend-widget.tsx`
- `web/components/dashboard/widgets/cashflow-widget.tsx`
- `web/components/dashboard/widgets/categories-widget.tsx`
- `web/components/dashboard/widgets/item-intel-widget.tsx`
- `web/components/dashboard/widgets/budgets-widget.tsx`
- `web/components/dashboard/widgets/recent-activity-widget.tsx`
- `web/components/dashboard/widgets/ai-alert-widget.tsx`
- `web/components/dashboard/grid/widget-frame.tsx` — widget chrome (header, hide, resize handle, size tag).
- `web/components/dashboard/grid/dashboard-grid.tsx` — the canvas (drag/resize/pack, placeholder).
- `web/components/dashboard/grid/personalize-sheet.tsx` — Personalize panel.
- `web/vitest.config.ts` — Vitest config.
- `web/e2e/dashboard-grid.spec.ts` — Playwright E2E.

**Modify:**
- `web/package.json` — add `vitest` + `test:unit` script.
- `web/app/(app)/dashboard/page.tsx` — render `<DashboardGrid boardId="dashboard" />`.

---

## Task 0: Add Vitest for engine unit tests

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.ts`

- [ ] **Step 1: Install Vitest**

Run (from `web/`):
```bash
npm install -D vitest@^2
```
Expected: `vitest` appears under `devDependencies`.

- [ ] **Step 2: Add the unit-test script**

In `web/package.json`, add to `"scripts"`:
```json
"test:unit": "vitest run",
"test:unit:watch": "vitest"
```

- [ ] **Step 3: Create `web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["lib/**/*.test.ts"] },
});
```

- [ ] **Step 4: Verify the runner starts (no tests yet)**

Run: `npm run test:unit`
Expected: exits 0 with "No test files found" (or similar). Not an error.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts
git commit -m "chore(web): add vitest for dashboard engine unit tests"
```

---

## Task 1: Engine types + `collide`

**Files:**
- Create: `web/lib/dashboard/grid.ts`
- Test: `web/lib/dashboard/grid.test.ts`

- [ ] **Step 1: Write the failing test**

`web/lib/dashboard/grid.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { collide, type GridItem } from "./grid";

const item = (id: string, x: number, y: number, w = 1, h = 1): GridItem =>
  ({ id, type: "netWorth", x, y, w, h });

describe("collide", () => {
  it("returns false for the same item", () => {
    expect(collide(item("a", 0, 0, 2, 2), item("a", 0, 0, 2, 2))).toBe(false);
  });
  it("detects overlap", () => {
    expect(collide(item("a", 0, 0, 2, 2), item("b", 1, 1, 2, 2))).toBe(true);
  });
  it("treats edge-adjacent as non-overlapping", () => {
    expect(collide(item("a", 0, 0, 2, 1), item("b", 2, 0, 2, 1))).toBe(false);
    expect(collide(item("a", 0, 0, 1, 2), item("b", 0, 2, 1, 2))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `./grid` / `collide` not exported.

- [ ] **Step 3: Write minimal implementation**

`web/lib/dashboard/grid.ts`:
```ts
export const GRID_COLS = 4;

export type WidgetType = string;

export type GridItem = {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Axis-aligned overlap test. An item never collides with itself. */
export function collide(a: GridItem, b: GridItem): boolean {
  return (
    a.id !== b.id &&
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/dashboard/grid.ts web/lib/dashboard/grid.test.ts
git commit -m "feat(dashboard): grid item type + collision test"
```

---

## Task 2: `compact` (gravity, no gaps)

**Files:**
- Modify: `web/lib/dashboard/grid.ts`
- Modify: `web/lib/dashboard/grid.test.ts`

- [ ] **Step 1: Write the failing test** (append to `grid.test.ts`)

```ts
import { compact } from "./grid";

describe("compact", () => {
  it("pulls items up to remove vertical gaps", () => {
    const items: GridItem[] = [
      { id: "a", type: "x", x: 0, y: 0, w: 2, h: 1 },
      { id: "b", type: "x", x: 0, y: 5, w: 2, h: 1 }, // floating below a gap
    ];
    compact(items);
    expect(items.find((i) => i.id === "b")!.y).toBe(1);
  });
  it("stacks same-column items without overlap", () => {
    const items: GridItem[] = [
      { id: "a", type: "x", x: 0, y: 3, w: 1, h: 2 },
      { id: "b", type: "x", x: 0, y: 9, w: 1, h: 1 },
    ];
    compact(items);
    expect(items.find((i) => i.id === "a")!.y).toBe(0);
    expect(items.find((i) => i.id === "b")!.y).toBe(2);
  });
  it("leaves a full column packed from the top", () => {
    const items: GridItem[] = [
      { id: "a", type: "x", x: 0, y: 0, w: 1, h: 1 },
      { id: "b", type: "x", x: 1, y: 0, w: 1, h: 1 },
    ];
    compact(items);
    expect(items.map((i) => i.y)).toEqual([0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `compact` not exported.

- [ ] **Step 3: Implement** (append to `grid.ts`)

```ts
/**
 * Gravity compaction: mutate `items` so each floats up to the lowest free row,
 * removing vertical gaps. Order of resolution is top-to-bottom, left-to-right.
 */
export function compact(items: GridItem[]): void {
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: GridItem[] = [];
  for (const it of order) {
    let y = it.y;
    while (y > 0) {
      const test = { ...it, y: y - 1 };
      if (placed.some((p) => collide(test, p))) break;
      y -= 1;
    }
    it.y = y;
    placed.push(it);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (all compact tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/dashboard/grid.ts web/lib/dashboard/grid.test.ts
git commit -m "feat(dashboard): gravity compaction"
```

---

## Task 3: `packAround`, `moveTo`, `resizeTo`, `firstFreeRow`

**Files:**
- Modify: `web/lib/dashboard/grid.ts`
- Modify: `web/lib/dashboard/grid.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { packAround, moveTo, resizeTo, firstFreeRow } from "./grid";

describe("packAround", () => {
  it("keeps the moving item fixed and packs others around it", () => {
    const items: GridItem[] = [
      { id: "a", type: "x", x: 0, y: 0, w: 2, h: 1 },
      { id: "b", type: "x", x: 0, y: 1, w: 2, h: 1 },
    ];
    // move "a" onto b's spot; b should drop below the fixed a
    packAround(items, "a", 0, 1, 2, 1);
    expect(items.find((i) => i.id === "a")).toMatchObject({ x: 0, y: 1 });
    expect(items.find((i) => i.id === "b")!.y).toBeGreaterThanOrEqual(2);
  });
});

describe("moveTo / resizeTo", () => {
  it("moveTo clamps x within the grid and compacts", () => {
    const items: GridItem[] = [{ id: "a", type: "x", x: 0, y: 0, w: 2, h: 1 }];
    moveTo(items, "a", 5, 4, GRID_COLS);
    const a = items.find((i) => i.id === "a")!;
    expect(a.x).toBe(GRID_COLS - 2);
    expect(a.y).toBe(0); // compacted to top
  });
  it("resizeTo clamps to grid width and min 1", () => {
    const items: GridItem[] = [{ id: "a", type: "x", x: 2, y: 0, w: 1, h: 1 }];
    resizeTo(items, "a", 9, 0, GRID_COLS);
    const a = items.find((i) => i.id === "a")!;
    expect(a.w).toBe(GRID_COLS - 2); // can't exceed remaining columns
    expect(a.h).toBe(1);
  });
});

describe("firstFreeRow", () => {
  it("returns the row below the lowest item", () => {
    const items: GridItem[] = [{ id: "a", type: "x", x: 0, y: 0, w: 2, h: 2 }];
    expect(firstFreeRow(items)).toBe(2);
  });
  it("returns 0 for an empty board", () => {
    expect(firstFreeRow([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement** (append to `grid.ts`)

```ts
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Lay out `items` with one item pinned at (tx,ty,mw,mh); every other item is
 * gravity-packed at its own column around the pinned one. Mutates `items`.
 */
export function packAround(
  items: GridItem[],
  movingId: string,
  tx: number,
  ty: number,
  mw: number,
  mh: number,
): void {
  const moving = items.find((i) => i.id === movingId);
  if (!moving) return;
  moving.x = tx;
  moving.y = ty;
  moving.w = mw;
  moving.h = mh;
  const others = items
    .filter((i) => i.id !== movingId)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: GridItem[] = [moving];
  for (const o of others) {
    let y = 0;
    while (placed.some((p) => collide({ ...o, y }, p))) y += 1;
    o.y = y;
    placed.push(o);
  }
}

/** Move an item to a snapped cell, clamp into the grid, then compact. */
export function moveTo(
  items: GridItem[],
  id: string,
  x: number,
  y: number,
  cols = GRID_COLS,
): void {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  it.x = clamp(x, 0, cols - it.w);
  it.y = Math.max(0, y);
  compact(items);
}

/** Resize an item (snapped spans), clamp to grid, then compact. */
export function resizeTo(
  items: GridItem[],
  id: string,
  w: number,
  h: number,
  cols = GRID_COLS,
  maxH = 6,
): void {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  it.w = clamp(w, 1, cols - it.x);
  it.h = clamp(h, 1, maxH);
  compact(items);
}

/** The first row strictly below every placed item (where a new widget lands). */
export function firstFreeRow(items: GridItem[]): number {
  return items.reduce((max, it) => Math.max(max, it.y + it.h), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (all engine tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/dashboard/grid.ts web/lib/dashboard/grid.test.ts
git commit -m "feat(dashboard): packAround, moveTo, resizeTo, firstFreeRow"
```

---

## Task 4: Board definitions + layout store

**Files:**
- Create: `web/lib/dashboard/boards.ts`
- Create: `web/lib/dashboard/layout-store.ts`
- Test: `web/lib/dashboard/layout-store.test.ts`

- [ ] **Step 1: Create `boards.ts`** (no test — pure data)

```ts
import type { GridItem, WidgetType } from "./grid";

export type BoardPrefs = {
  density: "compact" | "cozy" | "spacious";
  radius: number; // px
  glass: number; // 0–90 transparency %
};

export type BoardState = {
  version: number;
  items: GridItem[];
  prefs: BoardPrefs;
};

export const DEFAULT_PREFS: BoardPrefs = { density: "cozy", radius: 20, glass: 0 };

type Def = [type: WidgetType, x: number, y: number, w: number, h: number];

export type BoardConfig = {
  id: string;
  /** Widget types available to add on this board. */
  pool: WidgetType[];
  /** Default placement. */
  def: Def[];
};

export const BOARDS: Record<string, BoardConfig> = {
  dashboard: {
    id: "dashboard",
    pool: [
      "netWorth",
      "safeToSpend",
      "aiAlert",
      "itemIntel",
      "categories",
      "budgets",
      "cashflow",
      "recentActivity",
    ],
    def: [
      ["netWorth", 0, 0, 2, 1],
      ["safeToSpend", 2, 0, 1, 1],
      ["aiAlert", 3, 0, 1, 1],
      ["itemIntel", 0, 1, 2, 2],
      ["categories", 2, 1, 1, 2],
      ["budgets", 3, 1, 1, 2],
      ["cashflow", 0, 3, 2, 1],
      ["recentActivity", 2, 3, 2, 1],
    ],
  },
};

let idSeq = 0;
export function defaultBoardState(boardId: string): BoardState {
  const cfg = BOARDS[boardId];
  return {
    version: BOARD_VERSION,
    prefs: { ...DEFAULT_PREFS },
    items: cfg.def.map(([type, x, y, w, h]) => ({
      id: `${type}-${Date.now()}-${idSeq++}`,
      type,
      x,
      y,
      w,
      h,
    })),
  };
}

export const BOARD_VERSION = 1;
```

- [ ] **Step 2: Write the failing test** for the store

`web/lib/dashboard/layout-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadBoard, saveBoard, STORAGE_PREFIX } from "./layout-store";

// minimal localStorage shim for the node test env
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});

describe("layout-store", () => {
  it("returns the default board when nothing is saved", () => {
    const b = loadBoard("dashboard");
    expect(b.items.length).toBeGreaterThan(0);
    expect(b.prefs.density).toBe("cozy");
  });
  it("round-trips a saved board", () => {
    const b = loadBoard("dashboard");
    b.prefs.radius = 12;
    saveBoard("dashboard", b);
    expect(localStorage.getItem(STORAGE_PREFIX + "dashboard")).toContain('"radius":12');
    expect(loadBoard("dashboard").prefs.radius).toBe(12);
  });
  it("falls back to default on a version mismatch", () => {
    localStorage.setItem(STORAGE_PREFIX + "dashboard", JSON.stringify({ version: 0, items: [], prefs: {} }));
    expect(loadBoard("dashboard").items.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `layout-store` not found.

- [ ] **Step 4: Implement `layout-store.ts`**

```ts
import { BOARD_VERSION, BoardState, defaultBoardState } from "./boards";

export const STORAGE_PREFIX = "cf-board:";

export function loadBoard(boardId: string): BoardState {
  if (typeof localStorage === "undefined") return defaultBoardState(boardId);
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + boardId);
    if (!raw) return defaultBoardState(boardId);
    const parsed = JSON.parse(raw) as BoardState;
    if (parsed.version !== BOARD_VERSION || !Array.isArray(parsed.items)) {
      return defaultBoardState(boardId);
    }
    return parsed;
  } catch {
    return defaultBoardState(boardId);
  }
}

export function saveBoard(boardId: string, state: BoardState): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_PREFIX + boardId, JSON.stringify(state));
}

export function resetBoard(boardId: string): BoardState {
  const fresh = defaultBoardState(boardId);
  saveBoard(boardId, fresh);
  return fresh;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/lib/dashboard/boards.ts web/lib/dashboard/layout-store.ts web/lib/dashboard/layout-store.test.ts
git commit -m "feat(dashboard): board defs + localStorage layout store"
```

---

## Task 5: Widget tier helper + registry skeleton

**Files:**
- Create: `web/components/dashboard/widgets/widget-tier.tsx`
- Create: `web/lib/dashboard/registry.tsx`

- [ ] **Step 1: Create the tier helper**

`web/components/dashboard/widgets/widget-tier.tsx`:
```tsx
import type { LucideIcon } from "lucide-react";

export type Tier = "sm" | "md" | "lg";

/** Map a widget's grid span to a content tier. */
export function tierOf(w: number, h: number): Tier {
  if (w >= 2 && h >= 2) return "lg";
  if (w >= 2 || h >= 2) return "md";
  return "sm";
}

export type WidgetProps = { w: number; h: number };

/** A small uniform stat shown when a widget is at its smallest (sm) tier. */
export function CompactStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="flex items-center gap-1.5 text-muted">
        {Icon ? <Icon className="size-3.5" /> : null}
        <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Create the registry skeleton**

`web/lib/dashboard/registry.tsx`:
```tsx
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  TrendingUp,
  LifeBuoy,
  Sparkles,
  Brain,
  PieChart,
  Wallet,
  BarChart3,
  ListChecks,
} from "lucide-react";
import type { WidgetProps } from "@/components/dashboard/widgets/widget-tier";
import { NetWorthWidget } from "@/components/dashboard/widgets/net-worth-widget";
import { SafeToSpendWidget } from "@/components/dashboard/widgets/safe-to-spend-widget";
import { AiAlertWidget } from "@/components/dashboard/widgets/ai-alert-widget";
import { ItemIntelWidget } from "@/components/dashboard/widgets/item-intel-widget";
import { CategoriesWidget } from "@/components/dashboard/widgets/categories-widget";
import { BudgetsWidget } from "@/components/dashboard/widgets/budgets-widget";
import { CashflowWidget } from "@/components/dashboard/widgets/cashflow-widget";
import { RecentActivityWidget } from "@/components/dashboard/widgets/recent-activity-widget";

export type WidgetDef = {
  title: string;
  icon: LucideIcon;
  defW: number;
  defH: number;
  /** visual emphasis: accent border like the mockup's "feature" / "ai" cards */
  variant?: "default" | "feature" | "ai";
  Component: ComponentType<WidgetProps>;
};

export const WIDGETS: Record<string, WidgetDef> = {
  netWorth: { title: "Net Worth", icon: TrendingUp, defW: 2, defH: 1, variant: "feature", Component: NetWorthWidget },
  safeToSpend: { title: "Safe to Spend", icon: LifeBuoy, defW: 1, defH: 1, variant: "feature", Component: SafeToSpendWidget },
  aiAlert: { title: "Analyst Alert", icon: Sparkles, defW: 1, defH: 1, variant: "ai", Component: AiAlertWidget },
  itemIntel: { title: "Item Intelligence", icon: Brain, defW: 2, defH: 2, variant: "feature", Component: ItemIntelWidget },
  categories: { title: "Categories", icon: PieChart, defW: 1, defH: 2, Component: CategoriesWidget },
  budgets: { title: "Budgets", icon: Wallet, defW: 1, defH: 2, Component: BudgetsWidget },
  cashflow: { title: "Cashflow", icon: BarChart3, defW: 2, defH: 1, Component: CashflowWidget },
  recentActivity: { title: "Recent Activity", icon: ListChecks, defW: 2, defH: 1, Component: RecentActivityWidget },
};
```

- [ ] **Step 3: Verify imports resolve after widgets exist**

This file references widgets created in Task 6. Defer typecheck until Task 6 Step 4. No commit yet — commit together with Task 6.

---

## Task 6: Widget components (data-wired, size-responsive)

**Files:**
- Create the 8 widget files listed under File Structure.

Each widget reads its existing hook and renders by `tierOf(w,h)`. Use only app tokens (`bg-card`, `text-muted`, `text-c3`, `text-destructive`, `shadow-card`).

- [ ] **Step 1: `net-worth-widget.tsx`**

```tsx
"use client";
import { TrendingUp } from "lucide-react";
import { useNetWorth } from "@/lib/api/analytics";
import { formatCurrency } from "@/lib/format";
import { AreaChart } from "@/components/ui/area-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { CompactStat, tierOf, type WidgetProps } from "./widget-tier";

export function NetWorthWidget({ w, h }: WidgetProps) {
  const nw = useNetWorth();
  if (nw.isLoading) return <Skeleton className="h-full w-full rounded-lg" />;
  if (nw.isError || !nw.data) return <p className="text-sm text-muted">Couldn&apos;t load net worth.</p>;
  const d = nw.data;
  const points = d.points.map((p) => ({ label: p.period, value: Number(p.net_worth) }));
  const last = Number(d.net_worth);
  const first = points[0]?.value ?? 0;
  const delta = first === 0 ? null : ((last - first) / Math.abs(first)) * 100;
  const value = formatCurrency(last, { currency: d.currency });
  const tier = tierOf(w, h);
  if (tier === "sm") {
    return <CompactStat icon={TrendingUp} label="Net worth" value={value}
      hint={delta !== null ? `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}%` : undefined} />;
  }
  return (
    <div className="flex h-full flex-col">
      <p className="text-3xl font-extrabold tabular-nums tracking-tight">{value}</p>
      {delta !== null && (
        <p className={`text-sm font-semibold ${delta >= 0 ? "text-c3" : "text-destructive"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% over {points.length} mo
        </p>
      )}
      <div className="mt-2 flex-1"><AreaChart data={points} height={tier === "lg" ? 140 : 90} /></div>
    </div>
  );
}
```

- [ ] **Step 2: `safe-to-spend-widget.tsx`**

```tsx
"use client";
import { useMemo } from "react";
import { LifeBuoy } from "lucide-react";
import { useSummary } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { CompactStat, tierOf, type WidgetProps } from "./widget-tier";

export function SafeToSpendWidget({ w, h }: WidgetProps) {
  const range = useMemo(() => presetRange("1m"), []);
  const s = useSummary(range);
  if (s.isLoading) return <Skeleton className="h-full w-full rounded-lg" />;
  // summary total is signed; negative total = net positive cash flow available.
  const total = Number((s.data as { total?: unknown } | undefined)?.total ?? 0);
  const safe = Math.max(0, -total);
  const value = formatCurrency(safe);
  if (tierOf(w, h) === "sm") return <CompactStat icon={LifeBuoy} label="Safe to spend" value={value} />;
  return (
    <div className="flex h-full flex-col justify-center rounded-xl bg-accent-soft p-3">
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Safe to spend</span>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-c3">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted">Inside this month&apos;s income</p>
    </div>
  );
}
```

- [ ] **Step 3: `cashflow-widget.tsx`**

```tsx
"use client";
import { useMemo } from "react";
import { useTimeseries } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { CompactStat, tierOf, type WidgetProps } from "./widget-tier";

export function CashflowWidget({ w, h }: WidgetProps) {
  const range = useMemo(() => presetRange("6m"), []);
  const ts = useTimeseries(range);
  const points = (ts.data?.points ?? []).map((p) => ({
    income: Number(p.income ?? 0),
    spend: Number(p.spend ?? 0),
  }));
  if (ts.isLoading) return <Skeleton className="h-full w-full rounded-lg" />;
  const income = points.reduce((a, p) => a + p.income, 0);
  const spend = points.reduce((a, p) => a + p.spend, 0);
  const net = income - spend;
  if (tierOf(w, h) === "sm")
    return <CompactStat label="Net flow" value={formatCurrency(net, { signed: true })} hint="last 6 mo" />;
  const max = Math.max(1, ...points.map((p) => Math.max(p.income, p.spend)));
  const bars = w >= 2 ? points : points.slice(-6);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end gap-4">
        <div><span className="text-[10px] uppercase text-muted">In</span><p className="text-sm font-bold text-c3">{formatCurrency(income)}</p></div>
        <div><span className="text-[10px] uppercase text-muted">Out</span><p className="text-sm font-bold text-c2">{formatCurrency(spend)}</p></div>
        <p className="ml-auto text-sm font-bold text-c3 tabular-nums">{formatCurrency(net, { signed: true })}</p>
      </div>
      <div className="mt-2 flex flex-1 items-end gap-1.5">
        {bars.map((p, i) => (
          <div key={i} className="flex-1 rounded-t bg-accent" style={{ height: `${Math.max(6, (p.spend / max) * 100)}%`, opacity: i % 2 ? 0.6 : 0.9 }} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `categories-widget.tsx`**

```tsx
"use client";
import { useMemo } from "react";
import { useBreakdown } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { CompactStat, tierOf, type WidgetProps } from "./widget-tier";

const RING = ["var(--accent)", "var(--c3)", "var(--c2)", "var(--track)"];

export function CategoriesWidget({ w, h }: WidgetProps) {
  const range = useMemo(() => presetRange("1m"), []);
  const b = useBreakdown(range, "category");
  if (b.isLoading) return <Skeleton className="h-full w-full rounded-lg" />;
  const rows = ((b.data?.rows ?? []) as Array<{ label: string; total: unknown }>)
    .map((r) => ({ label: r.label, value: Math.abs(Number(r.total ?? 0)) }))
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  if (tierOf(w, h) === "sm")
    return <CompactStat label="Top category" value={rows[0]?.label ?? "—"} hint={rows[0] ? formatCurrency(rows[0].value) : undefined} />;
  let acc = 0;
  const stops = rows.slice(0, 4).map((r, i) => {
    const from = (acc / total) * 100; acc += r.value; const to = (acc / total) * 100;
    return `${RING[i]} ${from}% ${to}%`;
  });
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3">
        <div className="size-20 shrink-0 rounded-full"
          style={{ background: `conic-gradient(${stops.join(",")})`, mask: "radial-gradient(transparent 52%,#000 53%)", WebkitMask: "radial-gradient(transparent 52%,#000 53%)" }} />
        <div className="flex-1 space-y-1">
          {rows.slice(0, 4).map((r, i) => (
            <div key={r.label} className="flex items-center gap-2 text-[11.5px] text-muted">
              <span className="size-2 rounded-sm" style={{ background: RING[i] }} />
              {r.label}<b className="ml-auto text-fg tabular-nums">{Math.round((r.value / total) * 100)}%</b>
            </div>
          ))}
        </div>
      </div>
      {h >= 2 && (
        <div className="mt-2 flex-1 space-y-1 overflow-hidden">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between text-[13px]">
              <span className="text-muted">{r.label}</span><span className="tabular-nums">{formatCurrency(r.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `item-intel-widget.tsx`** (wires to `useBreakdown(range, "item_type")` — the Item-Intelligence wedge)

```tsx
"use client";
import { useMemo } from "react";
import { Brain } from "lucide-react";
import { useBreakdown } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { CompactStat, tierOf, type WidgetProps } from "./widget-tier";

export function ItemIntelWidget({ w, h }: WidgetProps) {
  const range = useMemo(() => presetRange("1m"), []);
  const b = useBreakdown(range, "item_type");
  if (b.isLoading) return <Skeleton className="h-full w-full rounded-lg" />;
  const rows = ((b.data?.rows ?? []) as Array<{ label: string; total: unknown; count?: unknown }>)
    .map((r) => ({ label: r.label, value: Math.abs(Number(r.total ?? 0)), count: Number(r.count ?? 0) }))
    .sort((a, b) => b.value - a.value);
  if (tierOf(w, h) === "sm")
    return <CompactStat icon={Brain} label="Top item" value={rows[0]?.label ?? "—"} hint={rows[0] ? formatCurrency(rows[0].value) : undefined} />;
  const n = h >= 3 ? 6 : h >= 2 ? 4 : 2;
  return (
    <div className="flex h-full flex-col">
      <p className="text-[12px] text-muted">The actual <b className="text-fg">things you bought</b>, merged across stores.</p>
      <div className="mt-2 flex-1 space-y-1 overflow-hidden">
        {rows.slice(0, n).map((r) => (
          <div key={r.label} className="flex items-center gap-3 py-1">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{r.label.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{r.label}</p><p className="text-[10.5px] text-muted">{r.count} buys</p></div>
            <span className="text-[13px] font-bold tabular-nums">{formatCurrency(r.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `budgets-widget.tsx`**

```tsx
"use client";
import { useBudgets } from "@/lib/api/budgets";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { CompactStat, tierOf, type WidgetProps } from "./widget-tier";

export function BudgetsWidget({ w, h }: WidgetProps) {
  const q = useBudgets();
  if (q.isLoading) return <Skeleton className="h-full w-full rounded-lg" />;
  const rows = (q.data ?? []).map((bd) => {
    const limit = Number((bd as { amount?: unknown }).amount ?? 0);
    const spent = Number((bd as { spent?: unknown }).spent ?? 0);
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    return { name: (bd as { category?: string }).category ?? "Budget", limit, spent, pct, over: pct > 100 };
  });
  const onTrack = rows.filter((r) => !r.over).length;
  if (tierOf(w, h) === "sm")
    return <CompactStat label="Budgets" value={`${onTrack} / ${rows.length}`} hint="on track" />;
  const n = h >= 3 ? rows.length : h >= 2 ? 4 : 2;
  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      {rows.slice(0, n).map((r) => (
        <div key={r.name}>
          <div className="flex justify-between text-[13px]">
            <span>{r.name}</span>
            <span className="tabular-nums"><span className={r.over ? "text-destructive" : ""}>{formatCurrency(r.spent)}</span><span className="text-muted"> / {formatCurrency(r.limit)}</span></span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-track">
            <span className="block h-full rounded" style={{ width: `${Math.min(100, r.pct)}%`, background: r.over ? "var(--c2)" : "var(--accent)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: `recent-activity-widget.tsx`**

```tsx
"use client";
import { useTransactions } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { CompactStat, tierOf, type WidgetProps } from "./widget-tier";

export function RecentActivityWidget({ w, h }: WidgetProps) {
  const q = useTransactions();
  if (q.isLoading) return <Skeleton className="h-full w-full rounded-lg" />;
  const txns = ((q.data ?? []) as Array<{ id: string; merchant?: string; description?: string; category?: string; amount: unknown }>);
  if (tierOf(w, h) === "sm") return <CompactStat label="Activity" value={String(txns.length)} hint="transactions" />;
  const n = h >= 2 ? 5 : 3;
  return (
    <div className="flex h-full flex-col gap-1 overflow-hidden">
      {txns.slice(0, n).map((t) => {
        const amt = Number(t.amount ?? 0);
        return (
          <div key={t.id} className="flex items-center gap-3 border-b border-border py-1.5 last:border-0">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent text-[12px] font-bold">{(t.merchant ?? t.description ?? "?").slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{t.merchant ?? t.description ?? "Transaction"}</p><p className="text-[10.5px] text-muted">{t.category ?? ""}</p></div>
            <span className={`text-[13px] font-bold tabular-nums ${amt >= 0 ? "text-c3" : ""}`}>{formatCurrency(amt, { signed: true })}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 8: `ai-alert-widget.tsx`** (derives a nudge from budgets — real data, no mock)

```tsx
"use client";
import { Sparkles } from "lucide-react";
import { useBudgets } from "@/lib/api/budgets";
import { formatCurrency } from "@/lib/format";
import { tierOf, type WidgetProps } from "./widget-tier";

export function AiAlertWidget({ w, h }: WidgetProps) {
  const q = useBudgets();
  const rows = (q.data ?? []).map((bd) => {
    const limit = Number((bd as { amount?: unknown }).amount ?? 0);
    const spent = Number((bd as { spent?: unknown }).spent ?? 0);
    return { name: (bd as { category?: string }).category ?? "Budget", over: spent - limit, pct: limit > 0 ? (spent / limit) * 100 : 0 };
  });
  const worst = rows.filter((r) => r.over > 0).sort((a, b) => b.over - a.over)[0];
  const small = tierOf(w, h) === "sm";
  if (!worst) {
    return (
      <div className="flex h-full flex-col justify-center text-[12.5px]">
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold uppercase text-accent"><Sparkles className="size-3" />Analyst</span>
        <p className="mt-2 leading-relaxed">All budgets are on track. Nice work. ✦</p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold uppercase text-accent"><Sparkles className="size-3" />Analyst</span>
      <p className="mt-2 leading-relaxed">⚠ <b className="text-accent">{worst.name}</b> is over by <b className="text-accent">{formatCurrency(worst.over)}</b>{small ? "" : ` (${Math.round(worst.pct)}% of limit).`}</p>
      {!small && <div className="mt-auto flex gap-2 pt-2"><span className="rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-on-accent">Adjust budget</span><span className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted">Snooze</span></div>}
    </div>
  );
}
```

- [ ] **Step 9: Typecheck registry + widgets**

Run (from `web/`): `npm run typecheck`
Expected: PASS (no errors in `lib/dashboard/registry.tsx` or `components/dashboard/widgets/*`). If a hook field name differs (e.g. budget `amount`/`spent`, transaction `merchant`), adjust the cast to the real `@shared/api-schema` field — confirm via `grep -n "spent\|amount\|merchant" ../shared/api-schema.ts`.

- [ ] **Step 10: Commit**

```bash
git add web/lib/dashboard/registry.tsx web/components/dashboard/widgets
git commit -m "feat(dashboard): widget registry + 8 size-responsive data-wired widgets"
```

---

## Task 7: Widget frame (chrome)

**Files:**
- Create: `web/components/dashboard/grid/widget-frame.tsx`

- [ ] **Step 1: Implement the frame**

```tsx
"use client";
import { X } from "lucide-react";
import { WIDGETS } from "@/lib/dashboard/registry";
import type { GridItem } from "@/lib/dashboard/grid";

export function WidgetFrame({
  item,
  editing,
  onHide,
  onResizePointerDown,
  onHeaderPointerDown,
}: {
  item: GridItem;
  editing: boolean;
  onHide: () => void;
  onResizePointerDown: (e: React.PointerEvent) => void;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
}) {
  const def = WIDGETS[item.type];
  if (!def) return null;
  const Body = def.Component;
  const Icon = def.icon;
  const variant =
    def.variant === "ai"
      ? "ring-1 ring-accent"
      : def.variant === "feature"
        ? "shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_0_0_1px_var(--accent)]"
        : "";
  return (
    <div className={`flex h-full w-full flex-col overflow-hidden rounded-card-sm border border-border bg-card shadow-card ${variant}`}>
      <div
        className={`flex items-center gap-2 px-3.5 pb-1.5 pt-3 ${editing ? "cursor-grab active:cursor-grabbing" : ""}`}
        onPointerDown={editing ? onHeaderPointerDown : undefined}
      >
        <Icon className="size-3.5 text-muted" />
        <span className="truncate text-[10.5px] font-bold uppercase tracking-wide text-muted">{def.title}</span>
        {editing && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="rounded border border-border bg-chip px-1.5 py-0.5 text-[9px] font-bold text-muted">{item.w}×{item.h}</span>
            <button aria-label="Hide widget" onClick={onHide} className="grid size-5 place-items-center rounded text-muted hover:bg-chip hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 px-3.5 pb-3"><Body w={item.w} h={item.h} /></div>
      {editing && (
        <button
          aria-label="Resize widget"
          onPointerDown={onResizePointerDown}
          className="absolute bottom-0 right-0 size-5 cursor-nwse-resize"
        >
          <span className="absolute bottom-1 right-1 size-2 rounded-br-[3px] border-b-2 border-r-2 border-accent" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/components/dashboard/grid/widget-frame.tsx
git commit -m "feat(dashboard): widget frame chrome"
```

---

## Task 8: `useDashboard` hook

**Files:**
- Create: `web/lib/dashboard/use-dashboard.ts`

- [ ] **Step 1: Implement the hook**

```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  compact,
  firstFreeRow,
  moveTo,
  packAround,
  resizeTo,
  type GridItem,
} from "./grid";
import { BOARDS, type BoardPrefs, type BoardState } from "./boards";
import { loadBoard, saveBoard, resetBoard } from "./layout-store";
import { WIDGETS } from "./registry";

export function useDashboard(boardId: string) {
  const [state, setState] = useState<BoardState>(() => ({
    version: 1,
    items: [],
    prefs: { density: "cozy", radius: 20, glass: 0 },
  }));
  const hydrated = useRef(false);

  // hydrate from localStorage on mount (client only, avoids SSR mismatch)
  useEffect(() => {
    setState(loadBoard(boardId));
    hydrated.current = true;
  }, [boardId]);

  const persist = useCallback(
    (next: BoardState) => {
      setState(next);
      if (hydrated.current) saveBoard(boardId, next);
    },
    [boardId],
  );

  const mutateItems = useCallback(
    (fn: (items: GridItem[]) => void) => {
      setState((prev) => {
        const items = prev.items.map((i) => ({ ...i }));
        fn(items);
        const next = { ...prev, items };
        saveBoard(boardId, next);
        return next;
      });
    },
    [boardId],
  );

  const setPrefs = useCallback(
    (patch: Partial<BoardPrefs>) => persist({ ...state, prefs: { ...state.prefs, ...patch } }),
    [persist, state],
  );

  const hideWidget = useCallback((id: string) => mutateItems((items) => {
    const i = items.findIndex((it) => it.id === id);
    if (i >= 0) items.splice(i, 1);
    compact(items);
  }), [mutateItems]);

  const addWidget = useCallback((type: string) => mutateItems((items) => {
    const def = WIDGETS[type];
    items.push({ id: `${type}-${Date.now()}`, type, x: 0, y: firstFreeRow(items), w: def.defW, h: def.defH });
    compact(items);
  }), [mutateItems]);

  const reset = useCallback(() => persist(resetBoard(boardId)), [persist, boardId]);

  // library = board pool − placed types
  const placed = new Set(state.items.map((i) => i.type));
  const library = BOARDS[boardId].pool.filter((t) => !placed.has(t));

  return { state, library, setPrefs, hideWidget, addWidget, reset, moveTo, resizeTo, packAround, compact, mutateItems };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/lib/dashboard/use-dashboard.ts
git commit -m "feat(dashboard): useDashboard state hook"
```

---

## Task 9: `DashboardGrid` canvas (drag + resize + gravity preview)

**Files:**
- Create: `web/components/dashboard/grid/dashboard-grid.tsx`

- [ ] **Step 1: Implement the grid**

```tsx
"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { GRID_COLS, compact, moveTo, packAround, resizeTo, type GridItem } from "@/lib/dashboard/grid";
import { useDashboard } from "@/lib/dashboard/use-dashboard";
import { WidgetFrame } from "./widget-frame";

const GAP = 12;
const CELL_H: Record<string, number> = { compact: 88, cozy: 104, spacious: 124 };

export function DashboardGrid({
  boardId,
  editing,
  controller,
}: {
  boardId: string;
  editing: boolean;
  controller: ReturnType<typeof useDashboard>;
}) {
  const { state, hideWidget, mutateItems } = controller;
  const ref = useRef<HTMLDivElement>(null);
  const [colW, setColW] = useState(0);
  const cellH = CELL_H[state.prefs.density] ?? 104;
  const [ph, setPh] = useState<null | { x: number; y: number; w: number; h: number }>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const measure = () => { if (ref.current) setColW((ref.current.clientWidth - (GRID_COLS - 1) * GAP) / GRID_COLS); };
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const px = (it: { x: number; y: number; w: number; h: number }) => ({
    left: it.x * (colW + GAP),
    top: it.y * (cellH + GAP),
    width: it.w * colW + (it.w - 1) * GAP,
    height: it.h * cellH + (it.h - 1) * GAP,
  });

  const rows = Math.max(1, ...state.items.map((i) => i.y + i.h));
  const boardHeight = rows * cellH + (rows - 1) * GAP;

  const startDrag = useCallback((e: React.PointerEvent, item: GridItem) => {
    if (!editing || !ref.current) return;
    e.preventDefault();
    const br = ref.current.getBoundingClientRect();
    const grabX = e.clientX - (br.left + item.x * (colW + GAP));
    const grabY = e.clientY - (br.top + item.y * (cellH + GAP));
    setDragId(item.id);
    let tx = item.x, ty = item.y;
    const onMove = (ev: PointerEvent) => {
      const left = ev.clientX - br.left - grabX;
      const top = ev.clientY - br.top - grabY;
      tx = Math.max(0, Math.min(GRID_COLS - item.w, Math.round(left / (colW + GAP))));
      ty = Math.max(0, Math.round(top / (cellH + GAP)));
      mutateItems((items) => packAround(items, item.id, tx, ty, item.w, item.h));
      setPh({ x: tx, y: ty, w: item.w, h: item.h });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      mutateItems((items) => moveTo(items, item.id, tx, ty));
      setPh(null); setDragId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [editing, colW, cellH, mutateItems]);

  const startResize = useCallback((e: React.PointerEvent, item: GridItem) => {
    if (!editing) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = item.w, oh = item.h;
    setDragId(item.id);
    let w = ow, h = oh;
    const onMove = (ev: PointerEvent) => {
      w = Math.max(1, Math.min(GRID_COLS - item.x, ow + Math.round((ev.clientX - sx) / (colW + GAP))));
      h = Math.max(1, Math.min(6, oh + Math.round((ev.clientY - sy) / (cellH + GAP))));
      mutateItems((items) => packAround(items, item.id, item.x, item.y, w, h));
      setPh({ x: item.x, y: item.y, w, h });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      mutateItems((items) => resizeTo(items, item.id, w, h));
      setPh(null); setDragId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [editing, colW, cellH, mutateItems]);

  return (
    <div
      ref={ref}
      data-testid="dashboard-grid"
      className="relative w-full"
      style={{ height: boardHeight, ["--cardrad" as string]: `${state.prefs.radius}px` }}
    >
      {editing && ph && (
        <div className="pointer-events-none absolute rounded-card-sm border-2 border-dashed border-accent bg-accent-soft/40"
          style={{ ...px(ph), zIndex: 1 }} />
      )}
      {state.items.map((item) => {
        const p = px(item);
        const dragging = dragId === item.id;
        return (
          <div key={item.id} data-widget={item.type}
            className="absolute"
            style={{
              left: p.left, top: p.top, width: p.width, height: p.height,
              borderRadius: "var(--cardrad)",
              transition: dragging ? "none" : "left .2s cubic-bezier(.32,.72,0,1), top .2s cubic-bezier(.32,.72,0,1), width .2s, height .2s",
              zIndex: dragging ? 50 : 2,
            }}>
            <WidgetFrame
              item={item}
              editing={editing}
              onHide={() => hideWidget(item.id)}
              onHeaderPointerDown={(e) => startDrag(e, item)}
              onResizePointerDown={(e) => startResize(e, item)}
            />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/components/dashboard/grid/dashboard-grid.tsx
git commit -m "feat(dashboard): drag/resize gravity-packed grid canvas"
```

---

## Task 10: `PersonalizeSheet`

**Files:**
- Create: `web/components/dashboard/grid/personalize-sheet.tsx`

- [ ] **Step 1: Implement the panel** (reuses existing `Sheet` + `useTheme`)

```tsx
"use client";
import { Plus, X } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useTheme } from "@/components/theme/theme-provider";
import { PALETTES, PALETTE_SWATCH, type Palette } from "@/lib/theme/themes";
import { WIDGETS } from "@/lib/dashboard/registry";
import type { useDashboard } from "@/lib/dashboard/use-dashboard";

const DENSITIES = ["compact", "cozy", "spacious"] as const;

export function PersonalizeSheet({
  open,
  onOpenChange,
  controller,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  controller: ReturnType<typeof useDashboard>;
}) {
  const { state, library, setPrefs, hideWidget, addWidget, reset } = controller;
  const { palette, mode, setPalette, setMode } = useTheme();
  const { prefs } = state;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[340px] overflow-y-auto p-5">
        <div className="mb-3 flex items-center gap-2"><h2 className="text-base font-bold">Personalize</h2>
          <button onClick={() => onOpenChange(false)} className="ml-auto grid size-7 place-items-center rounded-lg text-muted hover:bg-chip"><X className="size-4" /></button>
        </div>

        <Section label="Theme">
          <div className="flex gap-2">
            {PALETTES.map((p: Palette) => (
              <button key={p} onClick={() => setPalette(p)}
                className={`flex flex-1 flex-col items-center gap-2 rounded-xl border-2 p-2.5 ${palette === p ? "border-accent" : "border-border"} bg-card`}>
                <span className="size-6 rounded-lg" style={{ background: PALETTE_SWATCH[p] }} />
                <span className="text-[10.5px] font-semibold capitalize">{p}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section label="Mode">
          <Seg options={[["light", "☀️ Light"], ["dark", "🌙 Dark"]]} value={mode} onChange={(v) => setMode(v as "light" | "dark")} />
        </Section>

        <Section label="Density">
          <Seg options={DENSITIES.map((d) => [d, d[0].toUpperCase() + d.slice(1)] as [string, string])}
            value={prefs.density} onChange={(v) => setPrefs({ density: v as typeof prefs.density })} />
        </Section>

        <Section label={`Card radius · ${prefs.radius}px`}>
          <input type="range" min={6} max={30} value={prefs.radius} onChange={(e) => setPrefs({ radius: +e.target.value })} className="w-full accent-[var(--accent)]" />
        </Section>

        <Section label={`Card transparency · ${prefs.glass ? prefs.glass + "%" : "Off"}`}>
          <input type="range" min={0} max={90} value={prefs.glass} onChange={(e) => setPrefs({ glass: +e.target.value })} className="w-full accent-[var(--accent)]" />
        </Section>

        <Section label="Add widget · library">
          {library.length === 0 ? (
            <p className="text-[12px] text-muted">Every widget is on the board.</p>
          ) : (
            <div className="space-y-2">
              {library.map((t) => {
                const def = WIDGETS[t]; const Icon = def.icon;
                return (
                  <div key={t} className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5">
                    <Icon className="size-4 text-accent" />
                    <span className="flex-1 text-[12.5px] font-semibold">{def.title}</span>
                    <button aria-label={`Add ${def.title}`} onClick={() => addWidget(t)} className="grid size-6 place-items-center rounded-lg bg-accent-soft text-accent hover:bg-accent hover:text-on-accent"><Plus className="size-3.5" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section label="On this page · toggle off to hide">
          {state.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
              <span className="text-[12.5px] font-semibold">{WIDGETS[it.type].title}</span>
              <button aria-label={`Hide ${WIDGETS[it.type].title}`} onClick={() => hideWidget(it.id)}
                className="h-5 w-9 rounded-full bg-accent transition-colors">
                <span className="block size-4 translate-x-4 rounded-full bg-white transition-transform" />
              </button>
            </div>
          ))}
        </Section>

        <button onClick={reset} className="mt-4 w-full rounded-xl border border-border py-2.5 text-[12px] text-muted hover:text-fg">↺ Reset layout</button>
      </SheetContent>
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <label className="mb-2 block text-[9.5px] font-bold uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}

function Seg({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 rounded-xl bg-chip p-1">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`flex-1 rounded-lg py-2 text-[12px] font-semibold ${value === v ? "bg-card text-fg shadow-card" : "text-muted"}`}>{label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** (confirm `Sheet`/`SheetContent` export names match `components/ui/sheet.tsx`)

Run: `npm run typecheck`
Expected: PASS. If `SheetContent` doesn't accept `side`, check the existing sheet API with `grep -n "side\|SheetContent" web/components/ui/sheet.tsx` and adapt.

- [ ] **Step 3: Commit**

```bash
git add web/components/dashboard/grid/personalize-sheet.tsx
git commit -m "feat(dashboard): personalize sheet (theme/density/radius/library/visibility)"
```

---

## Task 11: Wire into the Dashboard page

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Replace the page body**

Replace the entire contents of `web/app/(app)/dashboard/page.tsx` with:
```tsx
"use client";

import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { useDashboard } from "@/lib/dashboard/use-dashboard";
import { DashboardGrid } from "@/components/dashboard/grid/dashboard-grid";
import { PersonalizeSheet } from "@/components/dashboard/grid/personalize-sheet";

export default function DashboardPage() {
  const controller = useDashboard("dashboard");
  const [editing, setEditing] = useState(false);

  // apply transparency as a board-scoped CSS var on <body> while mounted
  useEffect(() => {
    document.documentElement.style.setProperty("--board-glass", String(controller.state.prefs.glass / 100));
  }, [controller.state.prefs.glass]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold tracking-tight">Dashboard</h1>
        <button
          onClick={() => setEditing((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-semibold ${editing ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-fg"}`}
        >
          <Settings2 className="size-4" /> {editing ? "Done" : "Customize"}
        </button>
      </div>

      <DashboardGrid boardId="dashboard" editing={editing} controller={controller} />

      <PersonalizeSheet open={editing} onOpenChange={setEditing} controller={controller} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run (from `web/`): `npm run typecheck && npm run build`
Expected: typecheck PASS; build PASS.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev`, open `/dashboard`. Verify: widgets render with real data; click **Customize** → grid shows handles + Personalize sheet; drag a widget (others reflow, no gaps); resize a widget (content tier changes); hide a widget (returns to library); re-add it; switch theme/density/radius; reload → layout persists.

- [ ] **Step 4: Commit**

```bash
git add web/app/(app)/dashboard/page.tsx
git commit -m "feat(dashboard): customizable widget board replaces fixed dashboard"
```

---

## Task 12: E2E coverage

**Files:**
- Create: `web/e2e/dashboard-grid.spec.ts`

- [ ] **Step 1: Write the E2E test**

```ts
import { test, expect } from "@playwright/test";

// Assumes the existing e2e auth/storage setup (see other specs) logs in.
test.describe("customizable dashboard", () => {
  test("enters edit mode and hides + re-adds a widget", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-grid")).toBeVisible();

    const netWorth = page.locator('[data-widget="netWorth"]');
    await expect(netWorth).toBeVisible();

    await page.getByRole("button", { name: /customize/i }).click();

    // hide Net Worth via its frame button
    await netWorth.getByRole("button", { name: /hide widget/i }).click();
    await expect(page.locator('[data-widget="netWorth"]')).toHaveCount(0);

    // re-add from the personalize library
    await page.getByRole("button", { name: /add net worth/i }).click();
    await expect(page.locator('[data-widget="netWorth"]')).toHaveCount(1);
  });

  test("layout persists across reload", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /customize/i }).click();
    await page.locator('[data-widget="cashflow"]').getByRole("button", { name: /hide widget/i }).click();
    await page.reload();
    await expect(page.locator('[data-widget="cashflow"]')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run E2E**

Run (from `web/`): `npm run e2e -- dashboard-grid`
Expected: PASS. If the auth bootstrap differs, mirror the login/storage-state pattern used in `web/e2e/redesign-shell.spec.ts`.

- [ ] **Step 3: Run the full unit + e2e gate**

Run: `npm run test:unit && npm run typecheck`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add web/e2e/dashboard-grid.spec.ts
git commit -m "test(dashboard): e2e for hide/re-add + persistence"
```

---

## Self-Review (completed against spec)

- **Spec coverage:** free canvas (Task 9 drag) ✓; no gaps / gravity (Tasks 2–3 `compact`/`packAround`, Task 9 commit-on-drop) ✓; size-responsive content (Task 5 `tierOf` + Task 6 widgets) ✓; doesn't break on edit (engine always recompacts; full re-render via state) ✓; hidden widget returns (computed `library` in Task 8) ✓; persistence (Task 4 store + Task 8 save-on-mutate) ✓; themes (Task 10 reuses `useTheme`) ✓; multiple pages → **explicitly deferred** (see Follow-up). Analyst rail → **deferred**.
- **Placeholder scan:** every code step is complete; no TBD/TODO; the two "mock"-looking widgets (`aiAlert`, `itemIntel`) are wired to real endpoints (`useBudgets`, `useBreakdown("item_type")`).
- **Type consistency:** `GridItem`, `BoardState`, `BoardPrefs`, `WidgetProps`, `useDashboard` return shape are referenced identically across tasks; engine fns (`collide/compact/packAround/moveTo/resizeTo/firstFreeRow`) keep the same signatures everywhere.

**Known field-name risk:** budget (`amount`/`spent`), transaction (`merchant`/`description`/`amount`), and breakdown (`rows`/`label`/`total`/`count`) field names are best-guessed from hook types — Task 6 Step 9 and Task 10 Step 2 include the exact `grep` to confirm against `shared/api-schema.ts` and adapt the casts. This is the one place execution must verify against the live schema.

---

## Follow-up (separate plan, out of scope here)

1. **Generalize to all surfaces** — add `accounts/transactions/budget/investments/debt` entries to `BOARDS` with their pools + default layouts and widgets; the engine/grid/store already key on `boardId`, so each route renders `<DashboardGrid boardId="…">`.
2. **Analyst right-rail** — port the mockup's collapsible Analyst/insights rail as desktop chrome in `AppShell` (it currently has no right rail).
3. **Server-persisted layouts** — add a `/me/dashboard-layout` endpoint and swap the `layout-store` localStorage adapter for a server adapter (interface already isolated).
4. **Optional: port the 3 mockup palettes** (Reserve/Dollar/Midnight) as additional `data-theme` blocks in `globals.css` + extend `PALETTES`.
