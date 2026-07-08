# Widget-System Standard (Slice D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Base Widget contract — standardized data states, a single effective-density model, rule-based insight chips, a Focus View modal, and a `⋯` actions menu — then retrofit all 7 existing widgets onto it.

**Architecture:** A new `WidgetContract<T>` (data hook + density-keyed Body + `deriveInsights` + `Focus`) replaces the bare `({w,h,config})` component as the registry's render unit. A shared `BaseWidget` shell calls the contract's `useData`, maps query state → standardized Loading/Empty/Error/Partial components, renders the Body at the **effective density** (`min(presetLevel, maxLevelForSize(w,h))`), and exposes chips + a Focus modal. `WidgetFrame` keeps grid chrome and hosts a `⋯` actions menu. The migration is additive — `contract?` lands beside the legacy `Component?` so widgets convert one at a time with the build green throughout; a final task removes the legacy path.

**Tech Stack:** Next.js (app router, `"use client"`), React, TypeScript, TanStack Query (existing `@/lib/api/*` hooks), Radix Dialog + DropdownMenu (existing `@/components/ui/*`), Vitest (unit), Playwright (e2e).

## Global Constraints

- **No backend work.** Pure frontend. No migrations, no new endpoints. (Backend for data widgets is slice C-be.)
- **Out of scope (stubbed, not built):** AI-generated chips / AI Focus explanation (slice G), Pin & Lock semantics (slice E), data-backed widgets (slice C). These render present-but-inert.
- **`next lint` is removed in this repo's Next version — do not run it.** Verification commands are exactly: `cd web && npx tsc --noEmit`, `cd web && npx vitest run <file>`, `cd web && npx playwright test e2e/dashboard-grid.spec.ts`.
- **Grid model:** `GRID_COLS = 10`; widget spans are integer `w`/`h` cells; existing range-resolution rule (per-widget `config.range` overrides global `prefs.range`) stays intact.
- **Preset default is `"standard"`** for every widget unless its `defaults` say otherwise.
- **localStorage board schema:** do NOT bump `BOARD_VERSION`. New `config.preset` is optional and back-fills via `resolveConfig` defaults, exactly like the slice-B range change.
- Follow existing file conventions: `"use client"` at top of component files, `@/` import alias, Tailwind utility classes with the project's CSS vars (`--accent`, `--muted`, `--c2`, `--c3`, `text-fg`, `bg-card`, etc.).

---

### Task 1: Density math module

**Files:**
- Create: `web/lib/dashboard/density.ts`
- Test: `web/lib/dashboard/density.test.ts`

**Interfaces:**
- Produces: `Preset` (`"compact"|"standard"|"detailed"|"analytical"`), `DensityLevel` (`0|1|2|3`), `PRESETS: readonly Preset[]`, `PRESET_LEVEL: Record<Preset, DensityLevel>`, `maxLevelForSize(w:number,h:number): DensityLevel`, `effectiveDensity(preset: Preset|undefined, w:number, h:number): DensityLevel`, `chipCap(level: DensityLevel): number`.

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/dashboard/density.test.ts
import { describe, expect, it } from "vitest";
import { effectiveDensity, maxLevelForSize, chipCap, PRESET_LEVEL } from "./density";

describe("maxLevelForSize", () => {
  it("smallest 1x1 caps at level 0", () => expect(maxLevelForSize(1, 1)).toBe(0));
  it("one-dimension growth allows level 1", () => {
    expect(maxLevelForSize(2, 1)).toBe(1);
    expect(maxLevelForSize(1, 2)).toBe(1);
  });
  it("2x2 allows level 2", () => expect(maxLevelForSize(2, 2)).toBe(2));
  it("wide+tall allows level 3", () => expect(maxLevelForSize(5, 2)).toBe(3));
});

describe("effectiveDensity", () => {
  it("clamps analytical preset down to what the size allows", () =>
    expect(effectiveDensity("analytical", 1, 1)).toBe(0));
  it("respects a compact preset on a large widget (no forced detail)", () =>
    expect(effectiveDensity("compact", 5, 3)).toBe(0));
  it("defaults missing preset to standard (level 1)", () =>
    expect(effectiveDensity(undefined, 5, 3)).toBe(1));
  it("returns the lower of intent and capacity", () =>
    expect(effectiveDensity("detailed", 2, 2)).toBe(2));
});

describe("chipCap", () => {
  it("ladders 1,2,3,3 by level", () => {
    expect(chipCap(0)).toBe(1);
    expect(chipCap(1)).toBe(2);
    expect(chipCap(2)).toBe(3);
    expect(chipCap(3)).toBe(3);
  });
});

describe("PRESET_LEVEL", () => {
  it("maps the four presets to 0..3", () =>
    expect(PRESET_LEVEL).toEqual({ compact: 0, standard: 1, detailed: 2, analytical: 3 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/dashboard/density.test.ts`
Expected: FAIL — cannot find module `./density`.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/dashboard/density.ts

/** User-chosen display intent. Ordered from least to most information. */
export const PRESETS = ["compact", "standard", "detailed", "analytical"] as const;
export type Preset = (typeof PRESETS)[number];

/** Effective content density a widget renders against: 0=compact … 3=analytical. */
export type DensityLevel = 0 | 1 | 2 | 3;

export const PRESET_LEVEL: Record<Preset, DensityLevel> = {
  compact: 0,
  standard: 1,
  detailed: 2,
  analytical: 3,
};

/**
 * The richest density a widget's physical span can usefully show. Mirrors the
 * old `tierOf` thresholds but on the 0..3 ladder:
 *   1x1            -> 0 (one metric only)
 *   grows one axis -> 1
 *   2x2            -> 2
 *   wide AND tall  -> 3 (room for chart + detail)
 */
export function maxLevelForSize(w: number, h: number): DensityLevel {
  if (w >= 4 && h >= 2) return 3;
  if (w >= 2 && h >= 2) return 2;
  if (w >= 2 || h >= 2) return 1;
  return 0;
}

/** Effective density = the lower of user intent and what the size can show. */
export function effectiveDensity(preset: Preset | undefined, w: number, h: number): DensityLevel {
  const intent = PRESET_LEVEL[preset ?? "standard"];
  const cap = maxLevelForSize(w, h);
  return Math.min(intent, cap) as DensityLevel;
}

/** Max insight chips to show at a given density. Smallest still shows its top chip. */
export function chipCap(level: DensityLevel): number {
  return [1, 2, 3, 3][level];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/dashboard/density.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add web/lib/dashboard/density.ts web/lib/dashboard/density.test.ts
git commit -m "feat(dashboard): density math for widget-system standard (slice D)"
```

---

### Task 2: Widget contract types + query-state helper

**Files:**
- Create: `web/lib/dashboard/widget-contract.ts`
- Test: `web/lib/dashboard/widget-contract.test.ts`

**Interfaces:**
- Consumes: `WidgetConfig` from `./grid`, `DensityLevel` from `./density`.
- Produces:
  - `WidgetStatus = "loading"|"error"|"empty"|"partial"|"ready"`
  - `Insight = { label: string; tone?: "neutral"|"positive"|"warning"|"danger"; severity?: number }`
  - `WidgetState<T> = { status: WidgetStatus; data?: T; error?: unknown; partialReason?: string }`
  - `RenderCtx<T> = { data: T; config: WidgetConfig; density: DensityLevel; w: number; h: number }`
  - `WidgetContract<T> = { useData: (config: WidgetConfig) => WidgetState<T>; Body: (ctx: RenderCtx<T>) => ReactNode; deriveInsights?: (data: T, config: WidgetConfig) => Insight[]; Focus?: (ctx: RenderCtx<T>) => ReactNode; emptyHint?: string }`
  - `queryState<R, T>(q, opts): WidgetState<T>` — maps a TanStack-style result `{ isLoading; isError; error?; data }` to a `WidgetState<T>`.

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/dashboard/widget-contract.test.ts
import { describe, expect, it } from "vitest";
import { queryState } from "./widget-contract";

const base = { isLoading: false, isError: false, error: undefined, data: undefined as unknown };

describe("queryState", () => {
  it("reports loading while the query is loading", () => {
    const s = queryState({ ...base, isLoading: true }, { select: (r: number[]) => r, isEmpty: (t) => t.length === 0 });
    expect(s.status).toBe("loading");
  });
  it("reports error on query error", () => {
    const s = queryState({ ...base, isError: true, error: new Error("x") }, { select: (r: number[]) => r, isEmpty: (t) => t.length === 0 });
    expect(s.status).toBe("error");
    expect(s.error).toBeInstanceOf(Error);
  });
  it("treats absent data (still fetching) as loading", () => {
    const s = queryState(base, { select: (r: number[]) => r, isEmpty: (t) => t.length === 0 });
    expect(s.status).toBe("loading");
  });
  it("reports empty when the selected data is empty", () => {
    const s = queryState({ ...base, data: [] }, { select: (r: number[]) => r, isEmpty: (t) => t.length === 0 });
    expect(s.status).toBe("empty");
  });
  it("reports ready with selected data", () => {
    const s = queryState({ ...base, data: [1, 2] }, { select: (r: number[]) => r, isEmpty: (t) => t.length === 0 });
    expect(s.status).toBe("ready");
    expect(s.data).toEqual([1, 2]);
  });
  it("reports partial with a reason when partialReason returns a string", () => {
    const s = queryState(
      { ...base, data: [1] },
      { select: (r: number[]) => r, isEmpty: (t) => t.length === 0, partialReason: () => "Stale since 9:00" },
    );
    expect(s.status).toBe("partial");
    expect(s.partialReason).toBe("Stale since 9:00");
    expect(s.data).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/dashboard/widget-contract.test.ts`
Expected: FAIL — cannot find module `./widget-contract`.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/dashboard/widget-contract.ts
import type { ReactNode } from "react";
import type { WidgetConfig } from "./grid";
import type { DensityLevel } from "./density";

export type WidgetStatus = "loading" | "error" | "empty" | "partial" | "ready";

export type Insight = {
  label: string;
  tone?: "neutral" | "positive" | "warning" | "danger";
  /** Higher = more important; used to pick which chips survive the cap. */
  severity?: number;
};

export type WidgetState<T> = {
  status: WidgetStatus;
  data?: T;
  error?: unknown;
  partialReason?: string;
};

export type RenderCtx<T> = {
  data: T;
  config: WidgetConfig;
  density: DensityLevel;
  w: number;
  h: number;
};

export type WidgetContract<T> = {
  /** Owns the data fetch; must be a hook (calls TanStack hooks internally). */
  useData: (config: WidgetConfig) => WidgetState<T>;
  /** Renders the glanceable body against a single effective density level. */
  Body: (ctx: RenderCtx<T>) => ReactNode;
  /** Rule-based insight chips. Slice G later swaps the body of this function. */
  deriveInsights?: (data: T, config: WidgetConfig) => Insight[];
  /** Analytical content for the Focus modal (full chart + breakdown). */
  Focus?: (ctx: RenderCtx<T>) => ReactNode;
  /** Copy shown in the empty state. */
  emptyHint?: string;
};

type QueryLike<R> = { isLoading: boolean; isError: boolean; error?: unknown; data: R | undefined };

/**
 * Map a TanStack-style query result to a WidgetState. Centralizes the
 * loading/error/empty/partial/ready decision so every widget is consistent.
 */
export function queryState<R, T>(
  q: QueryLike<R>,
  opts: {
    select: (r: R) => T;
    isEmpty: (t: T) => boolean;
    /** Return a reason string to flag the data as partial, else undefined. */
    partialReason?: (t: T) => string | undefined;
  },
): WidgetState<T> {
  if (q.isLoading) return { status: "loading" };
  if (q.isError) return { status: "error", error: q.error };
  if (q.data === undefined || q.data === null) return { status: "loading" };
  const data = opts.select(q.data);
  if (opts.isEmpty(data)) return { status: "empty" };
  const reason = opts.partialReason?.(data);
  if (reason) return { status: "partial", data, partialReason: reason };
  return { status: "ready", data };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/dashboard/widget-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/dashboard/widget-contract.ts web/lib/dashboard/widget-contract.test.ts
git commit -m "feat(dashboard): widget contract types + queryState helper (slice D)"
```

---

### Task 3: Config + registry plumbing (additive)

**Files:**
- Modify: `web/lib/dashboard/grid.ts` (add `preset` to `WidgetConfig`)
- Modify: `web/lib/dashboard/registry.tsx` (add `preset` ControlKind; `contract?` + optional `Component?` on `WidgetDef`; default + validate `preset` in `resolveConfig`; add `preset:"standard"` to each `defaults` and `"preset"` to each `controls.fields`)
- Test: `web/lib/dashboard/registry.test.ts` (extend)

**Interfaces:**
- Consumes: `Preset`, `PRESETS` from `./density`; `WidgetContract` from `./widget-contract`.
- Produces: `WidgetConfig.preset?: Preset`; `WidgetDef.contract?: WidgetContract<unknown>`; `WidgetDef.Component?` (now optional); `resolveConfig` always returns a valid `preset`.

- [ ] **Step 1: Write the failing tests (extend registry.test.ts)**

Add these cases inside the existing `describe("resolveConfig", …)` block in `web/lib/dashboard/registry.test.ts`:

```ts
  it("defaults preset to standard when unset", () => {
    const config = resolveConfig({ type: "netWorth", config: {} }, "6m");
    expect(config.preset).toBe("standard");
  });

  it("keeps a valid explicit preset", () => {
    const config = resolveConfig({ type: "netWorth", config: { preset: "analytical" } });
    expect(config.preset).toBe("analytical");
  });

  it("restores an invalid preset to standard", () => {
    const config = resolveConfig({ type: "netWorth", config: { preset: "bogus" as never } });
    expect(config.preset).toBe("standard");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/dashboard/registry.test.ts`
Expected: FAIL — `config.preset` is `undefined`.

- [ ] **Step 3: Add `preset` to `WidgetConfig`**

In `web/lib/dashboard/grid.ts`, add the import and field:

```ts
import type { RangePreset } from "@/lib/dates";
import type { Preset } from "./density";

export const GRID_COLS = 10;

export type WidgetType = string;

export type WidgetConfig = {
  range?: RangePreset;
  preset?: Preset;
  dimension?: "category" | "merchant";
  chart?: "donut" | "bars" | "list" | "area" | "none";
  count?: number;
  title?: string;
  accent?: string | null;
  show?: Record<string, boolean>;
  filter?: { category?: string };
};
```

(Leave the rest of `grid.ts` unchanged.)

- [ ] **Step 4: Update `registry.tsx` — types, defaults, fields, validation**

In `web/lib/dashboard/registry.tsx`:

4a. Add imports near the top:

```ts
import { PRESETS } from "./density";
import type { WidgetContract } from "./widget-contract";
```

4b. Extend `ControlKind` to include `"preset"`:

```ts
export type ControlKind = "range" | "dimension" | "chart" | "count" | "title" | "accent" | "filter" | "preset";
```

4c. Change `WidgetDef` so `Component` is optional and `contract` is allowed:

```ts
export type WidgetDef = {
  title: string;
  icon: LucideIcon;
  defW: number;
  defH: number;
  variant?: "default" | "feature" | "ai";
  controls: WidgetControls;
  defaults: WidgetConfig;
  /** Legacy bare component. Removed once every widget exposes `contract`. */
  Component?: ComponentType<WidgetProps>;
  /** New Base Widget contract. Preferred by BaseWidget when present. */
  contract?: WidgetContract<unknown>;
};
```

4d. Add `"preset"` to every widget's `controls.fields` and `preset: "standard"` to every `defaults`. Update `SHARED_FIELDS`:

```ts
const SHARED_FIELDS: ControlKind[] = ["preset", "title", "accent"];
```

Then in each of the 7 `defaults` objects add `preset: "standard"`. Example for `netWorth` (apply the same `preset: "standard"` addition to safeToSpend, breakdown, cashflow, budgets, recentActivity, aiAlert):

```ts
    defaults: { preset: "standard", show: { chart: true, delta: true }, accent: null },
```

(Widgets whose `controls.fields` is exactly `SHARED_FIELDS` — i.e. `aiAlert` uses `fields: SHARED_FIELDS` — automatically gain `"preset"`. For widgets that spread `...SHARED_FIELDS`, `"preset"` comes along too. No per-widget `fields` edit is needed beyond updating `SHARED_FIELDS`.)

4e. In `resolveConfig`, after the existing `merged` construction and before the `return merged`, normalize the preset:

```ts
  merged.preset = PRESETS.includes(merged.preset as never) ? merged.preset : "standard";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/dashboard/registry.test.ts`
Expected: PASS (old + new cases).
Run: `cd web && npx tsc --noEmit`
Expected: PASS — `Component?` optional but every def still supplies it, so no break.

- [ ] **Step 6: Commit**

```bash
git add web/lib/dashboard/grid.ts web/lib/dashboard/registry.tsx web/lib/dashboard/registry.test.ts
git commit -m "feat(dashboard): preset config + additive contract field on WidgetDef (slice D)"
```

---

### Task 4: Standardized widget-state components

**Files:**
- Create: `web/components/dashboard/widgets/widget-states.tsx`
- Test: `web/components/dashboard/widgets/widget-states.test.tsx`

**Interfaces:**
- Produces: `WidgetLoading()`, `WidgetEmpty({ hint?: string })`, `WidgetError({ onRetry?: () => void })`, `WidgetPartial({ reason: string; children: ReactNode })`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/widget-states.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetEmpty, WidgetError, WidgetPartial } from "./widget-states";

describe("widget states", () => {
  it("empty shows the hint copy", () => {
    render(<WidgetEmpty hint="No transactions yet" />);
    expect(screen.getByText("No transactions yet")).toBeTruthy();
  });
  it("error shows a retry affordance when onRetry is given", () => {
    render(<WidgetError onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
  it("partial renders children plus the partial banner reason", () => {
    render(<WidgetPartial reason="Some accounts not synced"><div>body</div></WidgetPartial>);
    expect(screen.getByText("body")).toBeTruthy();
    expect(screen.getByText(/Some accounts not synced/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/widget-states.test.tsx`
Expected: FAIL — cannot find module `./widget-states`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/components/dashboard/widgets/widget-states.tsx
"use client";
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, WifiOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function WidgetLoading() {
  return <Skeleton className="h-full w-full rounded-lg" />;
}

export function WidgetEmpty({ hint }: { hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-muted">
      <Inbox className="size-5 opacity-70" />
      <p className="text-[11.5px] leading-snug">{hint ?? "Nothing to show yet."}</p>
    </div>
  );
}

export function WidgetError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-muted">
      <AlertTriangle className="size-5 text-destructive/80" />
      <p className="text-[11.5px] leading-snug">Couldn&apos;t load this widget.</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-0.5 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-fg hover:bg-chip"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function WidgetPartial({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
        <WifiOff className="size-3 shrink-0" />
        <span className="truncate">{reason}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/widgets/widget-states.test.tsx`
Expected: PASS.

> If this is the first React-DOM render test in the repo and it errors on `document`/`render`, confirm `web/vitest.config.ts` sets `environment: "jsdom"` and `@testing-library/react` is installed. If `render`/`screen` are unavailable, install dev deps: `cd web && npm i -D @testing-library/react @testing-library/jest-dom jsdom` and set `test.environment = "jsdom"` in `vitest.config.ts`. Re-run Step 4.

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/widgets/widget-states.tsx web/components/dashboard/widgets/widget-states.test.tsx web/vitest.config.ts
git commit -m "feat(dashboard): standardized widget state components (slice D)"
```

---

### Task 5: Insight chips component

**Files:**
- Create: `web/components/dashboard/widgets/insight-chips.tsx`
- Test: `web/components/dashboard/widgets/insight-chips.test.tsx`

**Interfaces:**
- Consumes: `Insight` from `@/lib/dashboard/widget-contract`.
- Produces: `InsightChips({ insights: Insight[]; cap: number })` — renders up to `cap` chips, highest `severity` first.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/insight-chips.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightChips } from "./insight-chips";

const chips = [
  { label: "low", severity: 1 },
  { label: "high", severity: 9 },
  { label: "mid", severity: 5 },
];

describe("InsightChips", () => {
  it("caps the number of chips shown", () => {
    render(<InsightChips insights={chips} cap={2} />);
    expect(screen.queryByText("low")).toBeNull();
    expect(screen.getByText("high")).toBeTruthy();
    expect(screen.getByText("mid")).toBeTruthy();
  });
  it("renders nothing when there are no insights", () => {
    const { container } = render(<InsightChips insights={[]} cap={3} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/insight-chips.test.tsx`
Expected: FAIL — cannot find module `./insight-chips`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/components/dashboard/widgets/insight-chips.tsx
"use client";
import type { Insight } from "@/lib/dashboard/widget-contract";

const TONE: Record<NonNullable<Insight["tone"]>, string> = {
  neutral: "bg-chip text-muted",
  positive: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  danger: "bg-destructive/12 text-destructive",
};

export function InsightChips({ insights, cap }: { insights: Insight[]; cap: number }) {
  if (insights.length === 0) return null;
  const shown = [...insights]
    .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))
    .slice(0, Math.max(0, cap));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((c, i) => (
        <span
          key={`${c.label}-${i}`}
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight ${TONE[c.tone ?? "neutral"]}`}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/widgets/insight-chips.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/widgets/insight-chips.tsx web/components/dashboard/widgets/insight-chips.test.tsx
git commit -m "feat(dashboard): insight chips component (slice D)"
```

---

### Task 6: Focus View modal shell

**Files:**
- Create: `web/components/dashboard/widgets/focus-view.tsx`
- Test: `web/components/dashboard/widgets/focus-view.test.tsx`

**Interfaces:**
- Consumes: `Dialog`, `DialogContent`, `DialogTitle` from `@/components/ui/dialog`.
- Produces: `FocusView({ open, onOpenChange, title, children })` — a large modal with the standardized analytical section shell. `children` fills the "Overview" section (real chart + breakdown supplied by the widget's `contract.Focus`); AI explanation / related alerts / suggested actions / export render as inert stub sections.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/focus-view.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FocusView } from "./focus-view";

describe("FocusView", () => {
  it("renders the title, the body, and the stubbed sections when open", () => {
    render(
      <FocusView open onOpenChange={() => {}} title="Net Worth">
        <div>focus body</div>
      </FocusView>,
    );
    expect(screen.getByText("Net Worth")).toBeTruthy();
    expect(screen.getByText("focus body")).toBeTruthy();
    expect(screen.getByText(/AI explanation/i)).toBeTruthy();
    expect(screen.getByText(/Suggested actions/i)).toBeTruthy();
  });
  it("renders nothing when closed", () => {
    render(
      <FocusView open={false} onOpenChange={() => {}} title="Net Worth">
        <div>focus body</div>
      </FocusView>,
    );
    expect(screen.queryByText("focus body")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/focus-view.test.tsx`
Expected: FAIL — cannot find module `./focus-view`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/components/dashboard/widgets/focus-view.tsx
"use client";
import type { ReactNode } from "react";
import { Sparkles, Bell, ListChecks, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

function StubSection({ icon: Icon, label }: { icon: typeof Sparkles; label: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="mb-1 flex items-center gap-1.5 text-muted">
        <Icon className="size-3.5" />
        <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-[12px] text-muted/80">Coming soon.</p>
    </section>
  );
}

export function FocusView({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[min(92vw,860px)] max-w-none overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <div className="grid gap-3">
          <section data-testid="focus-overview" className="rounded-xl border border-border bg-card p-3">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-muted">Overview</span>
            <div className="min-h-[220px]">{children}</div>
          </section>
          <div className="grid gap-3 sm:grid-cols-2">
            <StubSection icon={Sparkles} label="AI explanation" />
            <StubSection icon={Bell} label="Related alerts" />
            <StubSection icon={ListChecks} label="Suggested actions" />
            <StubSection icon={Share2} label="Export / share" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/widgets/focus-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/widgets/focus-view.tsx web/components/dashboard/widgets/focus-view.test.tsx
git commit -m "feat(dashboard): Focus View modal shell with stubbed sections (slice D)"
```

---

### Task 7: BaseWidget shell (contract pipeline + legacy fallback)

**Files:**
- Create: `web/components/dashboard/widgets/base-widget.tsx`
- Test: `web/components/dashboard/widgets/base-widget.test.tsx`

**Interfaces:**
- Consumes: `WidgetDef` from `@/lib/dashboard/registry`; `WidgetConfig` from `@/lib/dashboard/grid`; `effectiveDensity`, `chipCap` from `@/lib/dashboard/density`; `WidgetLoading/Empty/Error/Partial`; `InsightChips`; `FocusView`.
- Produces: `BaseWidget({ def, config, w, h, focusOpen, onFocusChange })` — renders the data pipeline. Owns no header chrome (that stays in `WidgetFrame`); owns the Focus modal (it holds the data).

**Pipeline:** call `def.contract?.useData(config)` (a hook — must be called unconditionally when a contract exists). When no contract, render the legacy `def.Component`. On contract: switch `state.status` → `WidgetLoading` / `WidgetError` / `WidgetEmpty` / (`WidgetPartial` wrap | plain) → render `Body` at `effectiveDensity` + chips; render `FocusView` with `contract.Focus` content.

> **Hooks rule:** a component cannot call a hook conditionally. Resolve this by splitting: `BaseWidget` decides contract-vs-legacy and delegates to a dedicated `<ContractWidget contract … />` child that *always* calls `contract.useData`. The legacy branch renders `<LegacyWidget def … />`. Each child calls hooks unconditionally.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/base-widget.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BaseWidget } from "./base-widget";
import type { WidgetDef } from "@/lib/dashboard/registry";
import { TrendingUp } from "lucide-react";

function defWith(state: { status: string; data?: unknown }): WidgetDef {
  return {
    title: "Test",
    icon: TrendingUp,
    defW: 2,
    defH: 2,
    controls: { fields: [] },
    defaults: {},
    contract: {
      useData: () => state as never,
      Body: ({ data }) => <div>body:{String(data)}</div>,
      deriveInsights: () => [{ label: "chip-a", severity: 5 }],
      emptyHint: "nothing here",
    },
  };
}

describe("BaseWidget (contract)", () => {
  it("shows the empty hint on empty status", () => {
    render(<BaseWidget def={defWith({ status: "empty" })} config={{}} w={2} h={2} focusOpen={false} onFocusChange={() => {}} />);
    expect(screen.getByText("nothing here")).toBeTruthy();
  });
  it("renders Body and an insight chip on ready status", () => {
    render(<BaseWidget def={defWith({ status: "ready", data: "X" })} config={{}} w={2} h={2} focusOpen={false} onFocusChange={() => {}} />);
    expect(screen.getByText("body:X")).toBeTruthy();
    expect(screen.getByText("chip-a")).toBeTruthy();
  });
  it("shows the error state on error status", () => {
    render(<BaseWidget def={defWith({ status: "error" })} config={{}} w={2} h={2} focusOpen={false} onFocusChange={() => {}} />);
    expect(screen.getByText(/Couldn.t load/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/base-widget.test.tsx`
Expected: FAIL — cannot find module `./base-widget`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/components/dashboard/widgets/base-widget.tsx
"use client";
import type { WidgetDef } from "@/lib/dashboard/registry";
import type { WidgetConfig } from "@/lib/dashboard/grid";
import type { WidgetContract, RenderCtx } from "@/lib/dashboard/widget-contract";
import { effectiveDensity, chipCap } from "@/lib/dashboard/density";
import { WidgetLoading, WidgetEmpty, WidgetError, WidgetPartial } from "./widget-states";
import { InsightChips } from "./insight-chips";
import { FocusView } from "./focus-view";
import type { WidgetProps } from "./widget-tier";

type BaseProps = {
  def: WidgetDef;
  config: WidgetConfig;
  w: number;
  h: number;
  focusOpen: boolean;
  onFocusChange: (v: boolean) => void;
};

export function BaseWidget(props: BaseProps) {
  const { def } = props;
  if (def.contract) return <ContractWidget {...props} contract={def.contract} />;
  if (def.Component) {
    const Legacy = def.Component as React.ComponentType<WidgetProps>;
    return <Legacy w={props.w} h={props.h} config={props.config} />;
  }
  return null;
}

function ContractWidget({
  def,
  config,
  w,
  h,
  focusOpen,
  onFocusChange,
  contract,
}: BaseProps & { contract: WidgetContract<unknown> }) {
  const state = contract.useData(config);
  const title = config.title || def.title;

  if (state.status === "loading") return <WidgetLoading />;
  if (state.status === "error") return <WidgetError />;
  if (state.status === "empty") return <WidgetEmpty hint={contract.emptyHint} />;

  const density = effectiveDensity(config.preset, w, h);
  const ctx: RenderCtx<unknown> = { data: state.data, config, density, w, h };
  const insights = contract.deriveInsights?.(state.data, config) ?? [];

  const content = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">{contract.Body(ctx)}</div>
      {insights.length > 0 && (
        <div className="mt-1.5 shrink-0">
          <InsightChips insights={insights} cap={chipCap(density)} />
        </div>
      )}
    </div>
  );

  return (
    <>
      {state.status === "partial" ? (
        <WidgetPartial reason={state.partialReason ?? "Partial data"}>{content}</WidgetPartial>
      ) : (
        content
      )}
      {contract.Focus && (
        <FocusView open={focusOpen} onOpenChange={onFocusChange} title={title}>
          {contract.Focus(ctx)}
        </FocusView>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/widgets/base-widget.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/widgets/base-widget.tsx web/components/dashboard/widgets/base-widget.test.tsx
git commit -m "feat(dashboard): BaseWidget shell with contract pipeline + legacy fallback (slice D)"
```

---

### Task 8: Actions menu + duplicate handler + wire into WidgetFrame

**Files:**
- Create: `web/components/dashboard/widgets/widget-actions.tsx`
- Modify: `web/lib/dashboard/use-dashboard.ts` (add `duplicateWidget`)
- Modify: `web/components/dashboard/grid/widget-frame.tsx` (render `BaseWidget` + host the `⋯` menu + Focus state)
- Modify: `web/components/dashboard/grid/dashboard-grid.tsx` (pass `onDuplicate` / `onCustomize`)
- Modify: `web/app/(app)/dashboard/page.tsx` (provide `onCustomizeWidget`)
- Test: `web/e2e/dashboard-grid.spec.ts` (add a Focus + Duplicate e2e)

**Interfaces:**
- Consumes: `DropdownMenu*` from `@/components/ui/dropdown-menu`.
- Produces: `WidgetActions({ onExpand, onCustomize, onDuplicate, onRemove })` (real items) + inert `Ask AI` / `Pin` / `Lock`. `useDashboard` gains `duplicateWidget(id: string)`.

- [ ] **Step 1: Add `duplicateWidget` to the controller**

In `web/lib/dashboard/use-dashboard.ts`, add after `addWidget`:

```ts
  const duplicateWidget = useCallback((id: string) => mutateItems((items) => {
    const src = items.find((it) => it.id === id);
    if (!src) return;
    items.push({
      ...src,
      id: `${src.type}-${Date.now()}`,
      x: 0,
      y: firstFreeRow(items),
      config: src.config ? { ...src.config } : undefined,
    });
    compact(items);
  }), [mutateItems]);
```

And add `duplicateWidget` to the returned object:

```ts
  return { state, library, selectedId, select, updateConfig, setPrefs, hideWidget, addWidget, duplicateWidget, reset, moveTo, resizeTo, packAround, compact, mutateItems };
```

- [ ] **Step 2: Create the actions menu**

```tsx
// web/components/dashboard/widgets/widget-actions.tsx
"use client";
import { MoreHorizontal, Maximize2, SlidersHorizontal, Copy, Trash2, Sparkles, Pin, Lock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function WidgetActions({
  onExpand,
  onCustomize,
  onDuplicate,
  onRemove,
}: {
  onExpand: () => void;
  onCustomize?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Widget actions"
        className="grid size-5 place-items-center rounded text-muted hover:bg-chip hover:text-fg"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onExpand}><Maximize2 className="mr-2 size-3.5" />Expand</DropdownMenuItem>
        {onCustomize && <DropdownMenuItem onClick={onCustomize}><SlidersHorizontal className="mr-2 size-3.5" />Customize</DropdownMenuItem>}
        {onDuplicate && <DropdownMenuItem onClick={onDuplicate}><Copy className="mr-2 size-3.5" />Duplicate</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled><Sparkles className="mr-2 size-3.5" />Ask AI</DropdownMenuItem>
        <DropdownMenuItem disabled><Pin className="mr-2 size-3.5" />Pin</DropdownMenuItem>
        <DropdownMenuItem disabled><Lock className="mr-2 size-3.5" />Lock</DropdownMenuItem>
        {onRemove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 size-3.5" />Remove</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Rewire `WidgetFrame` to render `BaseWidget` + host the menu and Focus state**

Replace the body of `web/components/dashboard/grid/widget-frame.tsx` with:

```tsx
"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { WIDGETS } from "@/lib/dashboard/registry";
import type { GridItem, WidgetConfig } from "@/lib/dashboard/grid";
import { BaseWidget } from "@/components/dashboard/widgets/base-widget";
import { WidgetActions } from "@/components/dashboard/widgets/widget-actions";

export function WidgetFrame({
  item,
  config,
  selected,
  editing,
  onHide,
  onResizePointerDown,
  onDuplicate,
  onCustomize,
}: {
  item: GridItem;
  config: WidgetConfig;
  selected: boolean;
  editing: boolean;
  onHide: () => void;
  onResizePointerDown: (e: React.PointerEvent) => void;
  onDuplicate?: () => void;
  onCustomize?: () => void;
}) {
  const [focusOpen, setFocusOpen] = useState(false);
  const def = WIDGETS[item.type];
  if (!def) return null;
  const Icon = def.icon;
  const title = config.title || def.title;
  const variant =
    selected
      ? "ring-2 ring-accent"
      : def.variant === "ai"
        ? "ring-1 ring-accent"
        : def.variant === "feature"
          ? "shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_0_0_1px_var(--accent)]"
          : "";
  return (
    <div className={`relative flex h-full w-full flex-col overflow-hidden rounded-card-sm border border-border bg-card shadow-card ${variant}`}>
      <div className={`flex items-center gap-2 px-3.5 pb-1.5 pt-3 ${editing ? "cursor-grab active:cursor-grabbing" : ""}`}>
        <Icon className="size-3.5 text-muted" />
        <span className="truncate text-[10.5px] font-bold uppercase tracking-wide text-muted">{title}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {editing && <span className="rounded border border-border bg-chip px-1.5 py-0.5 text-[9px] font-bold text-muted">{item.w}×{item.h}</span>}
          <WidgetActions
            onExpand={() => setFocusOpen(true)}
            onCustomize={onCustomize}
            onDuplicate={onDuplicate}
            onRemove={editing ? onHide : undefined}
          />
          {editing && (
            <button aria-label="Hide widget" onClick={onHide} className="grid size-5 place-items-center rounded text-muted hover:bg-chip hover:text-fg">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 px-3.5 pb-3">
        <BaseWidget def={def} config={config} w={item.w} h={item.h} focusOpen={focusOpen} onFocusChange={setFocusOpen} />
      </div>
      {editing && (
        <button aria-label="Resize widget" onPointerDown={onResizePointerDown} className="absolute bottom-0 right-0 size-5 cursor-nwse-resize">
          <span className="absolute bottom-1 right-1 size-2 rounded-br-[3px] border-b-2 border-r-2 border-accent" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pass handlers through `DashboardGrid`**

In `web/components/dashboard/grid/dashboard-grid.tsx`:

4a. Destructure `duplicateWidget` from the controller and accept an `onCustomizeWidget` prop. Change the component signature:

```tsx
export function DashboardGrid({
  boardId: _boardId,
  editing,
  controller,
  onCustomizeWidget,
}: {
  boardId: string;
  editing: boolean;
  controller: ReturnType<typeof useDashboard>;
  onCustomizeWidget?: (id: string) => void;
}) {
  const { state, hideWidget, mutateItems, selectedId, select, duplicateWidget } = controller;
```

4b. Pass the two new props to `<WidgetFrame>` (inside the `state.items.map`):

```tsx
            <WidgetFrame
              item={item}
              config={config}
              selected={selected}
              editing={editing}
              onHide={() => hideWidget(item.id)}
              onResizePointerDown={(e) => startResize(e, item)}
              onDuplicate={() => duplicateWidget(item.id)}
              onCustomize={onCustomizeWidget ? () => onCustomizeWidget(item.id) : undefined}
            />
```

- [ ] **Step 5: Provide `onCustomizeWidget` from the page**

In `web/app/(app)/dashboard/page.tsx`, pass a handler that enters edit mode and selects the widget (the sheet opens because `open={editing}`):

```tsx
        <DashboardGrid
          boardId="dashboard"
          editing={editing}
          controller={controller}
          onCustomizeWidget={(id) => { setEditing(true); controller.select(id); }}
        />
```

- [ ] **Step 6: Verify types + units still green**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.
Run: `cd web && npx vitest run lib/dashboard components/dashboard/widgets`
Expected: PASS.

- [ ] **Step 7: Add e2e for Expand (Focus) + Duplicate**

Append to `web/e2e/dashboard-grid.spec.ts` inside the `test.describe("customizable dashboard", …)` block:

```ts
  test("opens Focus View from the actions menu and closes on Escape", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    const netWorth = page.locator('[data-widget="netWorth"]');
    await expect(netWorth).toBeVisible();
    await netWorth.getByRole("button", { name: /widget actions/i }).click();
    await page.getByRole("menuitem", { name: /expand/i }).click();
    await expect(page.getByTestId("focus-overview")).toBeVisible();
    await expect(page.getByText(/AI explanation/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("focus-overview")).toHaveCount(0);
  });

  test("duplicates a widget via the actions menu", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    const before = await page.locator('[data-widget="netWorth"]').count();
    await page.locator('[data-widget="netWorth"]').first().getByRole("button", { name: /widget actions/i }).click();
    await page.getByRole("menuitem", { name: /duplicate/i }).click();
    await expect(page.locator('[data-widget="netWorth"]')).toHaveCount(before + 1);
  });
```

- [ ] **Step 8: Run e2e**

Run: `cd web && npx playwright test e2e/dashboard-grid.spec.ts`
Expected: PASS (existing + 2 new tests). Requires the API on `localhost:8000` and the dev server per `playwright.config.ts`.

> If the menu trigger overlaps drag handling, confirm the `onPointerDown={(e) => e.stopPropagation()}` on `DropdownMenuTrigger` (Task 8 Step 2) prevents the grid from starting a drag. The existing grid guard `(e.target as HTMLElement).closest("button")` already skips drag on button presses.

- [ ] **Step 9: Commit**

```bash
git add web/components/dashboard/widgets/widget-actions.tsx web/lib/dashboard/use-dashboard.ts web/components/dashboard/grid/widget-frame.tsx web/components/dashboard/grid/dashboard-grid.tsx "web/app/(app)/dashboard/page.tsx" web/e2e/dashboard-grid.spec.ts
git commit -m "feat(dashboard): widget actions menu + Focus + duplicate wiring (slice D)"
```

---

## Widget retrofit tasks (9–15)

Each task converts one widget from a bare `({w,h,config})` component to a `WidgetContract`, then points its registry entry at `contract` instead of `Component`. The pattern for every conversion:

1. Move the data hooks + status mapping into `useData(config)` (return a `WidgetState<T>` via `queryState`).
2. Replace the `tierOf` branch with a `Body(ctx)` that switches on `ctx.density` (0..3).
3. Add `deriveInsights(data, config)` returning ≥1 real chip.
4. Add `Focus(ctx)` rendering the full chart/breakdown the widget already computes.
5. In `registry.tsx`, remove that widget's `Component:` line and add `contract:`.
6. Keep `CompactStat` from `./widget-tier` for the level-0 render.

After each conversion run `cd web && npx tsc --noEmit` and the widget's render unaffected because `BaseWidget` now takes the contract path for it. The e2e suite must stay green.

---

### Task 9: Convert Net Worth widget

**Files:**
- Modify: `web/components/dashboard/widgets/net-worth-widget.tsx`
- Modify: `web/lib/dashboard/registry.tsx` (netWorth entry → `contract`)
- Test: `web/components/dashboard/widgets/net-worth-widget.test.tsx`

**Interfaces:**
- Produces: `netWorthContract: WidgetContract<NetWorthData>` where `NetWorthData = { value: string; delta: number | null; points: { label: string; value: number }[]; months: number }`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/net-worth-widget.test.tsx
import { describe, expect, it } from "vitest";
import { netWorthContract } from "./net-worth-widget";

describe("netWorthContract.deriveInsights", () => {
  it("emits a positive-tone chip when net worth rose", () => {
    const chips = netWorthContract.deriveInsights!(
      { value: "$10", delta: 12.3, points: [{ label: "Jan", value: 1 }], months: 6 },
      {},
    );
    expect(chips.some((c) => c.tone === "positive" && /12/.test(c.label))).toBe(true);
  });
  it("emits a warning-tone chip when net worth fell", () => {
    const chips = netWorthContract.deriveInsights!(
      { value: "$10", delta: -8, points: [], months: 6 },
      {},
    );
    expect(chips.some((c) => c.tone === "warning")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/net-worth-widget.test.tsx`
Expected: FAIL — `netWorthContract` is not exported.

- [ ] **Step 3: Rewrite the widget as a contract**

Replace `web/components/dashboard/widgets/net-worth-widget.tsx` with:

```tsx
"use client";
import { TrendingUp } from "lucide-react";
import { useNetWorth } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { AreaChart } from "@/components/ui/area-chart";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type NetWorthData = { value: string; delta: number | null; points: { label: string; value: number }[]; months: number };

export const netWorthContract: WidgetContract<NetWorthData> = {
  useData(config) {
    const nw = useNetWorth(presetRange(config.range ?? "6m"));
    return queryState(nw, {
      select: (d): NetWorthData => {
        const points = d.points.map((p) => ({ label: p.period, value: Number(p.net_worth) }));
        const last = Number(d.net_worth);
        const first = points[0]?.value ?? 0;
        return {
          value: formatCurrency(last, { currency: d.currency }),
          delta: first === 0 ? null : ((last - first) / Math.abs(first)) * 100,
          points,
          months: points.length,
        };
      },
      isEmpty: (t) => t.points.length === 0,
    });
  },
  deriveInsights(d) {
    if (d.delta === null) return [];
    const up = d.delta >= 0;
    return [{
      label: `${up ? "▲" : "▼"} ${Math.abs(d.delta).toFixed(1)}% / ${d.months}mo`,
      tone: up ? "positive" : "warning",
      severity: Math.min(9, Math.round(Math.abs(d.delta))),
    }];
  },
  Body({ data, config, density }) {
    const showDelta = config.show?.delta ?? true;
    if (density === 0) {
      return <CompactStat icon={TrendingUp} label="Net worth" value={data.value}
        hint={showDelta && data.delta !== null ? `${data.delta >= 0 ? "▲" : "▼"} ${Math.abs(data.delta).toFixed(1)}%` : undefined} />;
    }
    const showChart = (config.show?.chart ?? true) && density >= 2;
    return (
      <div className="flex h-full flex-col">
        <p className="text-3xl font-extrabold tabular-nums tracking-tight">{data.value}</p>
        {showDelta && data.delta !== null && (
          <p className={`text-sm font-semibold ${data.delta >= 0 ? "text-c3" : "text-destructive"}`}>
            {data.delta >= 0 ? "▲" : "▼"} {Math.abs(data.delta).toFixed(1)}% over {data.months} mo
          </p>
        )}
        {showChart && <div className="mt-2 flex-1"><AreaChart data={data.points} height={density >= 3 ? 140 : 90} /></div>}
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-3">
        <p className="text-4xl font-extrabold tabular-nums tracking-tight">{data.value}</p>
        <AreaChart data={data.points} height={220} />
        <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
          {data.points.map((p) => (
            <div key={p.label} className="flex justify-between rounded-lg bg-chip px-2 py-1">
              <span className="text-muted">{p.label}</span>
              <b className="tabular-nums">{formatCurrency(p.value)}</b>
            </div>
          ))}
        </div>
      </div>
    );
  },
  emptyHint: "No net-worth history yet.",
};
```

- [ ] **Step 4: Point the registry entry at the contract**

In `web/lib/dashboard/registry.tsx`: change the import and the `netWorth` entry. Replace `import { NetWorthWidget } …` with `import { netWorthContract } …`, then in the `netWorth` def replace `Component: NetWorthWidget,` with `contract: netWorthContract as WidgetContract<unknown>,`. Add `import type { WidgetContract } from "./widget-contract";` if not already present from Task 3.

- [ ] **Step 5: Run unit + type checks**

Run: `cd web && npx vitest run components/dashboard/widgets/net-worth-widget.test.tsx`
Expected: PASS.
Run: `cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/dashboard/widgets/net-worth-widget.tsx web/components/dashboard/widgets/net-worth-widget.test.tsx web/lib/dashboard/registry.tsx
git commit -m "feat(dashboard): convert Net Worth widget to contract (slice D)"
```

---

### Task 10: Convert Safe to Spend widget

**Files:**
- Modify: `web/components/dashboard/widgets/safe-to-spend-widget.tsx`
- Modify: `web/lib/dashboard/registry.tsx` (safeToSpend → `contract`)
- Test: `web/components/dashboard/widgets/safe-to-spend-widget.test.tsx`

**Interfaces:**
- Produces: `safeToSpendContract: WidgetContract<{ safe: number; value: string }>`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/safe-to-spend-widget.test.tsx
import { describe, expect, it } from "vitest";
import { safeToSpendContract } from "./safe-to-spend-widget";

describe("safeToSpendContract.deriveInsights", () => {
  it("warns when nothing is safe to spend", () => {
    const chips = safeToSpendContract.deriveInsights!({ safe: 0, value: "$0" }, {});
    expect(chips.some((c) => c.tone === "warning")).toBe(true);
  });
  it("is positive when there is headroom", () => {
    const chips = safeToSpendContract.deriveInsights!({ safe: 240, value: "$240" }, {});
    expect(chips.some((c) => c.tone === "positive")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/safe-to-spend-widget.test.tsx`
Expected: FAIL — `safeToSpendContract` not exported.

- [ ] **Step 3: Rewrite as contract**

Replace `web/components/dashboard/widgets/safe-to-spend-widget.tsx` with:

```tsx
"use client";
import { LifeBuoy } from "lucide-react";
import { useSummary } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type SafeData = { safe: number; value: string };

export const safeToSpendContract: WidgetContract<SafeData> = {
  useData(config) {
    const s = useSummary(presetRange(config.range ?? "1m"));
    return queryState(s, {
      // summary total is signed; negative total = net positive cash flow available.
      select: (d): SafeData => {
        const safe = Math.max(0, -Number(d.total ?? 0));
        return { safe, value: formatCurrency(safe) };
      },
      isEmpty: () => false,
    });
  },
  deriveInsights(d) {
    return d.safe <= 0
      ? [{ label: "Nothing left this month", tone: "warning", severity: 8 }]
      : [{ label: `Safe: ${d.value}`, tone: "positive", severity: 4 }];
  },
  Body({ data, density }) {
    if (density === 0) return <CompactStat icon={LifeBuoy} label="Safe to spend" value={data.value} />;
    return (
      <div className="flex h-full flex-col justify-center rounded-xl bg-accent-soft p-3">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Safe to spend</span>
        <p className="mt-1 text-2xl font-extrabold tabular-nums text-c3">{data.value}</p>
        <p className="mt-0.5 text-[11px] text-muted">Inside this month&apos;s income</p>
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-2">
        <p className="text-4xl font-extrabold tabular-nums text-c3">{data.value}</p>
        <p className="text-[13px] text-muted">Income remaining after this month&apos;s spend and commitments.</p>
      </div>
    );
  },
  emptyHint: "No spending data this period.",
};
```

- [ ] **Step 4: Point the registry entry at the contract**

In `registry.tsx`: replace `import { SafeToSpendWidget } …` with `import { safeToSpendContract } …`; in the `safeToSpend` def replace `Component: SafeToSpendWidget,` with `contract: safeToSpendContract as WidgetContract<unknown>,`.

- [ ] **Step 5: Run unit + type checks**

Run: `cd web && npx vitest run components/dashboard/widgets/safe-to-spend-widget.test.tsx && cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/dashboard/widgets/safe-to-spend-widget.tsx web/components/dashboard/widgets/safe-to-spend-widget.test.tsx web/lib/dashboard/registry.tsx
git commit -m "feat(dashboard): convert Safe to Spend widget to contract (slice D)"
```

---

### Task 11: Convert Cashflow widget

**Files:**
- Modify: `web/components/dashboard/widgets/cashflow-widget.tsx`
- Modify: `web/lib/dashboard/registry.tsx` (cashflow → `contract`)
- Test: `web/components/dashboard/widgets/cashflow-widget.test.tsx`

**Interfaces:**
- Produces: `cashflowContract: WidgetContract<CashflowData>` where `CashflowData = { points: { label: string; income: number; spend: number; net: number }[]; income: number; spend: number; net: number }`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/cashflow-widget.test.tsx
import { describe, expect, it } from "vitest";
import { cashflowContract } from "./cashflow-widget";

const data = { points: [{ label: "Jun", income: 100, spend: 80, net: 20 }], income: 100, spend: 80, net: 20 };

describe("cashflowContract.deriveInsights", () => {
  it("emits a positive net chip when net is positive", () => {
    const chips = cashflowContract.deriveInsights!(data, {});
    expect(chips.some((c) => c.tone === "positive")).toBe(true);
  });
  it("emits a warning chip when net is negative", () => {
    const chips = cashflowContract.deriveInsights!({ ...data, net: -50 }, {});
    expect(chips.some((c) => c.tone === "warning")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/cashflow-widget.test.tsx`
Expected: FAIL — `cashflowContract` not exported.

- [ ] **Step 3: Rewrite as contract**

Replace `web/components/dashboard/widgets/cashflow-widget.tsx` with:

```tsx
"use client";
import { useTimeseries } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { AreaChart } from "@/components/ui/area-chart";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type Pt = { label: string; income: number; spend: number; net: number };
type CashflowData = { points: Pt[]; income: number; spend: number; net: number };

export const cashflowContract: WidgetContract<CashflowData> = {
  useData(config) {
    const ts = useTimeseries(presetRange(config.range ?? "6m"));
    return queryState(ts, {
      select: (d): CashflowData => {
        const points: Pt[] = (d.points ?? []).map((p) => ({
          label: p.period, income: Number(p.income ?? 0), spend: Number(p.spend ?? 0), net: Number(p.net ?? 0),
        }));
        const income = points.reduce((a, p) => a + p.income, 0);
        const spend = points.reduce((a, p) => a + p.spend, 0);
        return { points, income, spend, net: income - spend };
      },
      isEmpty: (t) => t.points.length === 0,
    });
  },
  deriveInsights(d) {
    const up = d.net >= 0;
    return [{
      label: `Net ${formatCurrency(d.net, { signed: true })}`,
      tone: up ? "positive" : "warning",
      severity: up ? 4 : 7,
    }];
  },
  Body({ data, config, density, w, h }) {
    if (density === 0)
      return <CompactStat label="Net flow" value={formatCurrency(data.net, { signed: true })} hint={config.range ?? "6m"} />;
    const max = Math.max(1, ...data.points.map((p) => Math.max(p.income, p.spend)));
    const bars = w >= 2 ? data.points : data.points.slice(-6);
    const showIn = config.show?.in ?? true;
    const showOut = config.show?.out ?? true;
    const showNet = config.show?.net ?? true;
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-end gap-4">
          {showIn && <div><span className="text-[10px] uppercase text-muted">In</span><p className="text-sm font-bold text-c3">{formatCurrency(data.income)}</p></div>}
          {showOut && <div><span className="text-[10px] uppercase text-muted">Out</span><p className="text-sm font-bold text-c2">{formatCurrency(data.spend)}</p></div>}
          {showNet && <p className="ml-auto text-sm font-bold text-c3 tabular-nums">{formatCurrency(data.net, { signed: true })}</p>}
        </div>
        {config.chart === "area" ? (
          <div className="mt-2 flex-1"><AreaChart data={data.points.map((p) => ({ label: p.label, value: p.net }))} height={h >= 2 ? 140 : 90} /></div>
        ) : (
          <div className="mt-2 flex flex-1 items-end gap-1.5">
            {bars.map((p) => (
              <div key={p.label} className="flex-1 rounded-t bg-accent" style={{ height: `${Math.max(6, (p.spend / max) * 100)}%`, opacity: 0.85 }} />
            ))}
          </div>
        )}
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-3">
        <div className="flex gap-6">
          <div><span className="text-[10px] uppercase text-muted">In</span><p className="text-xl font-bold text-c3">{formatCurrency(data.income)}</p></div>
          <div><span className="text-[10px] uppercase text-muted">Out</span><p className="text-xl font-bold text-c2">{formatCurrency(data.spend)}</p></div>
          <div className="ml-auto"><span className="text-[10px] uppercase text-muted">Net</span><p className="text-xl font-bold tabular-nums">{formatCurrency(data.net, { signed: true })}</p></div>
        </div>
        <AreaChart data={data.points.map((p) => ({ label: p.label, value: p.net }))} height={220} />
        <div className="space-y-1">
          {data.points.map((p) => (
            <div key={p.label} className="flex justify-between rounded-lg bg-chip px-2 py-1 text-[12px]">
              <span className="text-muted">{p.label}</span>
              <span className="tabular-nums">{formatCurrency(p.income)} in · {formatCurrency(p.spend)} out</span>
            </div>
          ))}
        </div>
      </div>
    );
  },
  emptyHint: "No cashflow in this range.",
};
```

- [ ] **Step 4: Point the registry entry at the contract**

In `registry.tsx`: replace `import { CashflowWidget } …` with `import { cashflowContract } …`; in the `cashflow` def replace `Component: CashflowWidget,` with `contract: cashflowContract as WidgetContract<unknown>,`.

- [ ] **Step 5: Run unit + type checks**

Run: `cd web && npx vitest run components/dashboard/widgets/cashflow-widget.test.tsx && cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/dashboard/widgets/cashflow-widget.tsx web/components/dashboard/widgets/cashflow-widget.test.tsx web/lib/dashboard/registry.tsx
git commit -m "feat(dashboard): convert Cashflow widget to contract (slice D)"
```

---

### Task 12: Convert Breakdown widget

**Files:**
- Modify: `web/components/dashboard/widgets/breakdown-widget.tsx`
- Modify: `web/lib/dashboard/registry.tsx` (breakdown → `contract`)
- Test: `web/components/dashboard/widgets/breakdown-widget.test.tsx`

**Interfaces:**
- Produces: `breakdownContract: WidgetContract<BreakdownData>` where `BreakdownData = { rows: { label: string; value: number }[]; total: number; dimension: "merchant" | "category" }`.

**Note:** keep all existing private helpers in this file (`RING`, `OTHER_COLOR`, `donutStops`, `Legend`, `BarBreakdown`, `ListBreakdown`, `MiniBreakdown`, `withOtherRow`, `rowColor`, `displayValue`, `maxRowsFor`). Only the exported component shell changes — rename the data prep into `useData`, and route the existing render branches through `density`. `BreakdownWidget` also feeds `maxWidgetHeight` in `dashboard-grid.tsx`, which reads `resolveConfig(item).count` — that stays valid (config unchanged).

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/breakdown-widget.test.tsx
import { describe, expect, it } from "vitest";
import { breakdownContract } from "./breakdown-widget";

const data = { rows: [{ label: "Amazon", value: 320 }, { label: "Uber", value: 90 }], total: 410, dimension: "merchant" as const };

describe("breakdownContract.deriveInsights", () => {
  it("names the top entry in a chip", () => {
    const chips = breakdownContract.deriveInsights!(data, {});
    expect(chips.some((c) => /Amazon/.test(c.label))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/breakdown-widget.test.tsx`
Expected: FAIL — `breakdownContract` not exported.

- [ ] **Step 3: Rewrite the exported shell as a contract**

In `web/components/dashboard/widgets/breakdown-widget.tsx`, keep all the helper functions/components below the export. Replace the top imports + the exported `BreakdownWidget` function with:

```tsx
"use client";
import { PieChart, Store } from "lucide-react";
import { useBreakdown } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";
// (existing imports: LucideIcon type, Breakdown type, Skeleton no longer needed — remove Skeleton import)

type BreakdownData = { rows: { label: string; value: number }[]; total: number; dimension: "merchant" | "category" };

export const breakdownContract: WidgetContract<BreakdownData> = {
  useData(config) {
    const dimension = config.dimension === "category" ? "category" : "merchant";
    const b = useBreakdown(presetRange(config.range ?? "3m"), dimension, config.filter?.category);
    return queryState(b, {
      select: (d): BreakdownData => {
        const rows = rowsFromBreakdown(d, dimension);
        return { rows, total: rows.reduce((a, r) => a + r.value, 0), dimension };
      },
      isEmpty: (t) => t.rows.length === 0,
    });
  },
  deriveInsights(d) {
    const top = d.rows[0];
    if (!top) return [];
    const pct = d.total > 0 ? Math.round((top.value / d.total) * 100) : 0;
    return [{ label: `${top.label} ${pct}%`, tone: pct >= 40 ? "warning" : "neutral", severity: pct }];
  },
  Body({ data, config, density, w, h }) {
    const total = data.total || 1;
    const dimension = data.dimension;
    const Icon = dimension === "merchant" ? Store : PieChart;
    const label = dimension === "merchant" ? "Top merchant" : "Top category";
    const count = Math.max(1, Math.min(data.rows.length || 1, Math.round(Number(config.count ?? 5))));
    const top = data.rows.slice(0, count);
    const chart = config.chart === "bars" || config.chart === "list" ? config.chart : "donut";
    const showLegend = config.show?.legend ?? true;
    const showAmounts = config.show?.amounts ?? true;

    if (density === 0) return <MiniBreakdown icon={Icon} label={label} row={top[0]} total={total} showAmounts={showAmounts} />;

    const visible = top.slice(0, maxRowsFor(w, h, count));
    const canShowChart = chart === "donut" && density >= 2;
    if (chart === "list") return <ListBreakdown rows={visible} total={total} showAmounts={showAmounts} />;
    if (chart === "bars") {
      return density >= 2
        ? <BarBreakdown rows={visible} total={total} showAmounts={showAmounts} />
        : <ListBreakdown rows={visible} total={total} showAmounts={showAmounts} dense />;
    }
    if (!canShowChart) return <ListBreakdown rows={visible} total={total} showAmounts={showAmounts} dense />;

    const chartRows = withOtherRow(visible, total);
    return (
      <div className="flex h-full min-h-0 flex-col justify-start overflow-hidden pt-1">
        <div className="flex min-h-0 items-start gap-5">
          <div
            className={`${w >= 5 && h >= 2 ? "size-28" : w >= 4 && h >= 3 ? "size-28" : "size-20"} shrink-0 rounded-full`}
            style={{ background: `conic-gradient(${donutStops(chartRows, total)})`, mask: "radial-gradient(transparent 52%,#000 53%)", WebkitMask: "radial-gradient(transparent 52%,#000 53%)" }}
          />
          {showLegend && <Legend rows={chartRows} total={total} showAmounts={showAmounts} />}
        </div>
      </div>
    );
  },
  Focus({ data }) {
    const total = data.total || 1;
    const rows = withOtherRow(data.rows.slice(0, 8), total);
    return (
      <div className="flex flex-col gap-4 sm:flex-row">
        <div
          className="size-40 shrink-0 self-center rounded-full"
          style={{ background: `conic-gradient(${donutStops(rows, total)})`, mask: "radial-gradient(transparent 52%,#000 53%)", WebkitMask: "radial-gradient(transparent 52%,#000 53%)" }}
        />
        <div className="min-w-0 flex-1"><Legend rows={rows} total={total} showAmounts /></div>
      </div>
    );
  },
  emptyHint: "No spending to break down here.",
};
```

(Remove the now-unused `Skeleton`, `tierOf`, `CompactStat`, `WidgetProps`, and `useMemo` imports from this file. `formatCurrency` is still used by helpers.)

- [ ] **Step 4: Point the registry entry at the contract**

In `registry.tsx`: replace `import { BreakdownWidget } …` with `import { breakdownContract } …`; in the `breakdown` def replace `Component: BreakdownWidget,` with `contract: breakdownContract as WidgetContract<unknown>,`.

- [ ] **Step 5: Run unit + type checks**

Run: `cd web && npx vitest run components/dashboard/widgets/breakdown-widget.test.tsx && cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/dashboard/widgets/breakdown-widget.tsx web/components/dashboard/widgets/breakdown-widget.test.tsx web/lib/dashboard/registry.tsx
git commit -m "feat(dashboard): convert Breakdown widget to contract (slice D)"
```

---

### Task 13: Convert Budgets widget

**Files:**
- Modify: `web/components/dashboard/widgets/budgets-widget.tsx`
- Modify: `web/lib/dashboard/registry.tsx` (budgets → `contract`)
- Test: `web/components/dashboard/widgets/budgets-widget.test.tsx`

**Interfaces:**
- Produces: `budgetsContract: WidgetContract<BudgetsData>` where `BudgetsData = { rows: { id: string; name: string; limit: number; spent: number; pct: number; over: boolean }[]; onTrack: number }`.

> The budgets + category data join (`catName`) moves into `useData`. Because `useData` runs two queries (`useBudgets`, `useCategories`), treat it as loading until budgets resolve; categories enrich names but are not required for status.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/budgets-widget.test.tsx
import { describe, expect, it } from "vitest";
import { budgetsContract } from "./budgets-widget";

const rows = [
  { id: "1", name: "Dining", limit: 200, spent: 220, pct: 110, over: true },
  { id: "2", name: "Gas", limit: 100, spent: 40, pct: 40, over: false },
];

describe("budgetsContract.deriveInsights", () => {
  it("flags an over-budget category as danger", () => {
    const chips = budgetsContract.deriveInsights!({ rows, onTrack: 1 }, {});
    expect(chips.some((c) => c.tone === "danger" && /Dining/.test(c.label))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/budgets-widget.test.tsx`
Expected: FAIL — `budgetsContract` not exported.

- [ ] **Step 3: Rewrite as contract**

Replace `web/components/dashboard/widgets/budgets-widget.tsx` with:

```tsx
"use client";
import { useMemo } from "react";
import { useBudgets } from "@/lib/api/budgets";
import { useCategories } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type Row = { id: string; name: string; limit: number; spent: number; pct: number; over: boolean };
type BudgetsData = { rows: Row[]; onTrack: number };

export const budgetsContract: WidgetContract<BudgetsData> = {
  useData(config) {
    void config;
    const q = useBudgets();
    const cats = useCategories();
    const catName = useMemo(() => {
      const m = new Map<string, string>();
      for (const c of cats.data ?? []) m.set(c.id, c.name);
      return (id: string | null | undefined) => (id ? m.get(id) ?? "Category" : "All spending");
    }, [cats.data]);
    return queryState(q, {
      select: (data): BudgetsData => {
        const rows: Row[] = (data ?? []).map((bd) => {
          const limit = Number(bd.amount ?? 0);
          const spent = Number(bd.spent ?? 0);
          const pct = Number(bd.progress_pct ?? (limit > 0 ? (spent / limit) * 100 : 0));
          return { id: bd.id, name: catName(bd.category_id), limit, spent, pct, over: Boolean(bd.overspent) };
        });
        return { rows, onTrack: rows.filter((r) => !r.over).length };
      },
      isEmpty: (t) => t.rows.length === 0,
    });
  },
  deriveInsights(d) {
    const worst = d.rows.filter((r) => r.over).sort((a, b) => b.pct - a.pct)[0];
    if (worst) return [{ label: `${worst.name} over budget`, tone: "danger", severity: 9 }];
    const near = d.rows.filter((r) => r.pct >= 80).sort((a, b) => b.pct - a.pct)[0];
    if (near) return [{ label: `${near.name} near limit`, tone: "warning", severity: 6 }];
    return [{ label: `${d.onTrack}/${d.rows.length} on track`, tone: "positive", severity: 3 }];
  },
  Body({ data, config, density, h }) {
    if (density === 0) return <CompactStat label="Budgets" value={`${data.onTrack} / ${data.rows.length}`} hint="on track" />;
    const fallbackCount = h >= 3 ? data.rows.length : h >= 2 ? 4 : 2;
    const n = Math.max(1, Math.min(data.rows.length || 1, Math.round(Number(config.count ?? fallbackCount))));
    const showBars = config.show?.bars ?? true;
    return (
      <div className="flex h-full flex-col gap-2 overflow-hidden">
        {data.rows.slice(0, n).map((r) => (
          <div key={r.id}>
            <div className="flex justify-between text-[13px]">
              <span>{r.name}</span>
              <span className="tabular-nums"><span className={r.over ? "text-destructive" : ""}>{formatCurrency(r.spent)}</span><span className="text-muted"> / {formatCurrency(r.limit)}</span></span>
            </div>
            {showBars && (
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-track">
                <span className="block h-full rounded" style={{ width: `${Math.min(100, r.pct)}%`, background: r.over ? "var(--c2)" : "var(--accent)" }} />
              </div>
            )}
          </div>
        ))}
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-2">
        {data.rows.map((r) => (
          <div key={r.id}>
            <div className="flex justify-between text-[13px]">
              <span>{r.name}</span>
              <span className="tabular-nums"><span className={r.over ? "text-destructive" : ""}>{formatCurrency(r.spent)}</span><span className="text-muted"> / {formatCurrency(r.limit)}</span></span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-track">
              <span className="block h-full rounded" style={{ width: `${Math.min(100, r.pct)}%`, background: r.over ? "var(--c2)" : "var(--accent)" }} />
            </div>
          </div>
        ))}
      </div>
    );
  },
  emptyHint: "No budgets set up yet.",
};
```

- [ ] **Step 4: Point the registry entry at the contract**

In `registry.tsx`: replace `import { BudgetsWidget } …` with `import { budgetsContract } …`; in the `budgets` def replace `Component: BudgetsWidget,` with `contract: budgetsContract as WidgetContract<unknown>,`.

- [ ] **Step 5: Run unit + type checks**

Run: `cd web && npx vitest run components/dashboard/widgets/budgets-widget.test.tsx && cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/dashboard/widgets/budgets-widget.tsx web/components/dashboard/widgets/budgets-widget.test.tsx web/lib/dashboard/registry.tsx
git commit -m "feat(dashboard): convert Budgets widget to contract (slice D)"
```

---

### Task 14: Convert Recent Activity widget

**Files:**
- Modify: `web/components/dashboard/widgets/recent-activity-widget.tsx`
- Modify: `web/lib/dashboard/registry.tsx` (recentActivity → `contract`)
- Test: `web/components/dashboard/widgets/recent-activity-widget.test.tsx`

**Interfaces:**
- Produces: `recentActivityContract: WidgetContract<ActivityData>` where `ActivityData = { txns: { id: string; title: string; amount: number; date: string; category: string }[] }`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/recent-activity-widget.test.tsx
import { describe, expect, it } from "vitest";
import { recentActivityContract } from "./recent-activity-widget";

describe("recentActivityContract.deriveInsights", () => {
  it("reports the transaction count", () => {
    const chips = recentActivityContract.deriveInsights!(
      { txns: [
        { id: "1", title: "A", amount: -5, date: "Jun 1", category: "Food" },
        { id: "2", title: "B", amount: -8, date: "Jun 2", category: "Gas" },
      ] },
      {},
    );
    expect(chips.some((c) => /2/.test(c.label))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/recent-activity-widget.test.tsx`
Expected: FAIL — `recentActivityContract` not exported.

- [ ] **Step 3: Rewrite as contract**

Replace `web/components/dashboard/widgets/recent-activity-widget.tsx` with:

```tsx
"use client";
import { useMemo } from "react";
import { useTransactions, useCategories } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type Txn = { id: string; title: string; amount: number; date: string; category: string };
type ActivityData = { txns: Txn[] };

export const recentActivityContract: WidgetContract<ActivityData> = {
  useData(config) {
    void config;
    const q = useTransactions();
    const cats = useCategories();
    const catName = useMemo(() => {
      const m = new Map<string, string>();
      for (const c of cats.data ?? []) m.set(c.id, c.name);
      return (id: string | null | undefined) => (id ? m.get(id) ?? "" : "");
    }, [cats.data]);
    return queryState(q, {
      select: (data): ActivityData => ({
        txns: (data ?? []).map((t) => ({
          id: t.id,
          title: t.merchant ?? "Transaction",
          amount: Number(t.amount ?? 0),
          date: new Date(`${t.txn_date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          category: catName(t.category_id),
        })),
      }),
      isEmpty: (t) => t.txns.length === 0,
    });
  },
  deriveInsights(d) {
    return [{ label: `${d.txns.length} recent`, tone: "neutral", severity: 2 }];
  },
  Body({ data, config, density, h }) {
    if (density === 0) return <CompactStat label="Activity" value={String(data.txns.length)} hint="transactions" />;
    const fallbackCount = h >= 2 ? 5 : 3;
    const n = Math.max(1, Math.min(data.txns.length || 1, Math.round(Number(config.count ?? fallbackCount))));
    const showDates = config.show?.dates ?? false;
    const showCategory = config.show?.category ?? true;
    const showAmount = config.show?.amount ?? true;
    return (
      <div className="flex h-full flex-col gap-1 overflow-hidden">
        {data.txns.slice(0, n).map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-border py-1.5 last:border-0">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent text-[12px] font-bold">{t.title.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{t.title}</p>
              {(showCategory || showDates) && <p className="text-[10.5px] text-muted">{[showDates ? t.date : null, showCategory ? t.category : null].filter(Boolean).join(" / ")}</p>}
            </div>
            {showAmount && <span className={`text-[13px] font-bold tabular-nums ${t.amount >= 0 ? "text-c3" : ""}`}>{formatCurrency(t.amount, { signed: true })}</span>}
          </div>
        ))}
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="flex flex-col gap-1">
        {data.txns.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-border py-2 last:border-0">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent text-[13px] font-bold">{t.title.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">{t.title}</p>
              <p className="text-[11px] text-muted">{[t.date, t.category].filter(Boolean).join(" / ")}</p>
            </div>
            <span className={`text-[14px] font-bold tabular-nums ${t.amount >= 0 ? "text-c3" : ""}`}>{formatCurrency(t.amount, { signed: true })}</span>
          </div>
        ))}
      </div>
    );
  },
  emptyHint: "No transactions yet.",
};
```

- [ ] **Step 4: Point the registry entry at the contract**

In `registry.tsx`: replace `import { RecentActivityWidget } …` with `import { recentActivityContract } …`; in the `recentActivity` def replace `Component: RecentActivityWidget,` with `contract: recentActivityContract as WidgetContract<unknown>,`.

- [ ] **Step 5: Run unit + type checks**

Run: `cd web && npx vitest run components/dashboard/widgets/recent-activity-widget.test.tsx && cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/dashboard/widgets/recent-activity-widget.tsx web/components/dashboard/widgets/recent-activity-widget.test.tsx web/lib/dashboard/registry.tsx
git commit -m "feat(dashboard): convert Recent Activity widget to contract (slice D)"
```

---

### Task 15: Convert Analyst Alert widget

**Files:**
- Modify: `web/components/dashboard/widgets/ai-alert-widget.tsx`
- Modify: `web/lib/dashboard/registry.tsx` (aiAlert → `contract`)
- Test: `web/components/dashboard/widgets/ai-alert-widget.test.tsx`

**Interfaces:**
- Produces: `aiAlertContract: WidgetContract<AlertData>` where `AlertData = { worst: { name: string; over: number; pct: number } | null }`.

> This widget's empty case is meaningful (no over-budget categories → an "all on track" message), so `isEmpty` stays `false` and the Body handles the `worst === null` branch — do not let `BaseWidget` show the generic empty state here.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/widgets/ai-alert-widget.test.tsx
import { describe, expect, it } from "vitest";
import { aiAlertContract } from "./ai-alert-widget";

describe("aiAlertContract.deriveInsights", () => {
  it("emits a danger chip when a budget is over", () => {
    const chips = aiAlertContract.deriveInsights!({ worst: { name: "Dining", over: 30, pct: 115 } }, {});
    expect(chips.some((c) => c.tone === "danger")).toBe(true);
  });
  it("emits a positive chip when nothing is over", () => {
    const chips = aiAlertContract.deriveInsights!({ worst: null }, {});
    expect(chips.some((c) => c.tone === "positive")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/ai-alert-widget.test.tsx`
Expected: FAIL — `aiAlertContract` not exported.

- [ ] **Step 3: Rewrite as contract**

Replace `web/components/dashboard/widgets/ai-alert-widget.tsx` with:

```tsx
"use client";
import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { useBudgets } from "@/lib/api/budgets";
import { useCategories } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type AlertData = { worst: { name: string; over: number; pct: number } | null };

export const aiAlertContract: WidgetContract<AlertData> = {
  useData(config) {
    void config;
    const q = useBudgets();
    const cats = useCategories();
    const catName = useMemo(() => {
      const m = new Map<string, string>();
      for (const c of cats.data ?? []) m.set(c.id, c.name);
      return (id: string | null | undefined) => (id ? m.get(id) ?? "Category" : "All spending");
    }, [cats.data]);
    return queryState(q, {
      select: (data): AlertData => {
        const rows = (data ?? []).map((bd) => {
          const limit = Number(bd.amount ?? 0);
          const spent = Number(bd.spent ?? 0);
          return { name: catName(bd.category_id), over: spent - limit, pct: Number(bd.progress_pct ?? (limit > 0 ? (spent / limit) * 100 : 0)) };
        });
        return { worst: rows.filter((r) => r.over > 0).sort((a, b) => b.over - a.over)[0] ?? null };
      },
      isEmpty: () => false,
    });
  },
  deriveInsights(d) {
    return d.worst
      ? [{ label: `${d.worst.name} +${formatCurrency(d.worst.over)}`, tone: "danger", severity: 9 }]
      : [{ label: "All on track", tone: "positive", severity: 3 }];
  },
  Body({ data, config, density }) {
    const showActions = config.show?.actions ?? true;
    const small = density === 0;
    if (!data.worst) {
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
        <p className="mt-2 leading-relaxed">⚠ <b className="text-accent">{data.worst.name}</b> is over by <b className="text-accent">{formatCurrency(data.worst.over)}</b>{small ? "" : ` (${Math.round(data.worst.pct)}% of limit).`}</p>
        {!small && showActions && <div className="mt-auto flex gap-2 pt-2"><span className="rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-on-accent">Adjust budget</span><span className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted">Snooze</span></div>}
      </div>
    );
  },
  Focus({ data }) {
    return data.worst ? (
      <div className="space-y-2 text-[13px]">
        <p>⚠ <b className="text-accent">{data.worst.name}</b> is over budget by <b>{formatCurrency(data.worst.over)}</b> ({Math.round(data.worst.pct)}% of its limit).</p>
        <p className="text-muted">Open the budget to adjust the limit or review the transactions driving the overage.</p>
      </div>
    ) : (
      <p className="text-[13px]">All budgets are on track. ✦</p>
    );
  },
};
```

- [ ] **Step 4: Point the registry entry at the contract**

In `registry.tsx`: replace `import { AiAlertWidget } …` with `import { aiAlertContract } …`; in the `aiAlert` def replace `Component: AiAlertWidget,` with `contract: aiAlertContract as WidgetContract<unknown>,`.

- [ ] **Step 5: Run unit + type checks**

Run: `cd web && npx vitest run components/dashboard/widgets/ai-alert-widget.test.tsx && cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/dashboard/widgets/ai-alert-widget.tsx web/components/dashboard/widgets/ai-alert-widget.test.tsx web/lib/dashboard/registry.tsx
git commit -m "feat(dashboard): convert Analyst Alert widget to contract (slice D)"
```

---

### Task 16: Preset control in PersonalizeSheet

**Files:**
- Modify: `web/components/dashboard/grid/personalize-sheet.tsx`
- Test: `web/e2e/dashboard-grid.spec.ts` (add a preset → density e2e)

**Interfaces:**
- Consumes: `PRESETS` from `@/lib/dashboard/density`; existing `updateConfig`, `Seg`, `Section`.

- [ ] **Step 1: Add the preset segmented control**

In `web/components/dashboard/grid/personalize-sheet.tsx`:

1a. Add import:

```ts
import { PRESETS } from "@/lib/dashboard/density";
```

1b. Add a labels constant near the other label maps (after `CHART_LABELS`):

```ts
const PRESET_LABELS: Record<(typeof PRESETS)[number], string> = {
  compact: "Compact", standard: "Standard", detailed: "Detailed", analytical: "Analytical",
};
```

1c. Inside `WidgetConfigControls`, render the preset control first (right after the `Editing:` heading `<p>`), gated on the field being present:

```tsx
      {def.controls.fields.includes("preset") && (
        <Section label="Display preset">
          <Seg
            options={PRESETS.map((p) => [p, PRESET_LABELS[p]] as [string, string])}
            value={config.preset ?? "standard"}
            onChange={(v) => updateConfig(item.id, { preset: v as (typeof PRESETS)[number] })}
          />
        </Section>
      )}
```

- [ ] **Step 2: Verify types + units green**

Run: `cd web && npx tsc --noEmit && cd web && npx vitest run lib/dashboard`
Expected: PASS.

- [ ] **Step 3: Add e2e — switching preset changes rendered detail**

Append to `web/e2e/dashboard-grid.spec.ts` inside the describe block:

```ts
  test("changing a widget preset to Compact collapses it to the primary metric", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /customize/i }).click();
    // select Net Worth by clicking its frame (selection drives the config panel)
    await page.locator('[data-widget="netWorth"]').click();
    await expect(page.getByTestId("widget-config-controls")).toBeVisible();
    // the area chart svg is present at standard density on a large widget
    const nwChart = page.locator('[data-widget="netWorth"] svg');
    await expect(nwChart.first()).toBeVisible();
    // switch to Compact -> chart drops out (density 0, primary metric only)
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await expect(page.locator('[data-widget="netWorth"] svg')).toHaveCount(0);
  });
```

- [ ] **Step 4: Run e2e**

Run: `cd web && npx playwright test e2e/dashboard-grid.spec.ts`
Expected: PASS.

> If the Net Worth widget's default span already clamps below the chart threshold, the `svg` may be absent before switching. If so, first resize it larger in the test via its resize handle, or assert on a text element that only the standard+ body renders (e.g. the "% over … mo" delta line) instead of the `svg`. Adjust the selector, keep the before/after contrast.

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/grid/personalize-sheet.tsx web/e2e/dashboard-grid.spec.ts
git commit -m "feat(dashboard): preset display control in personalize sheet (slice D)"
```

---

### Task 17: Remove the legacy component path + final verification

**Files:**
- Modify: `web/lib/dashboard/registry.tsx` (make `contract` required, drop `Component?`)
- Modify: `web/components/dashboard/widgets/base-widget.tsx` (drop the legacy branch)
- Modify: `web/components/dashboard/widgets/widget-tier.tsx` (remove now-unused `tierOf`; keep `CompactStat`, `WidgetProps`)

**Interfaces:**
- Produces: `WidgetDef.contract: WidgetContract<unknown>` (required); `WidgetDef.Component` removed.

- [ ] **Step 1: Confirm every widget now uses `contract`**

Run: `grep -n "Component:" web/lib/dashboard/registry.tsx`
Expected: NO matches (all 7 converted in Tasks 9–15).

- [ ] **Step 2: Make `contract` required, remove `Component`**

In `web/lib/dashboard/registry.tsx`, update `WidgetDef`:

```ts
export type WidgetDef = {
  title: string;
  icon: LucideIcon;
  defW: number;
  defH: number;
  variant?: "default" | "feature" | "ai";
  controls: WidgetControls;
  defaults: WidgetConfig;
  contract: WidgetContract<unknown>;
};
```

Remove the now-unused `ComponentType` and `WidgetProps` imports if nothing else in the file uses them.

- [ ] **Step 3: Drop the legacy branch in BaseWidget**

In `web/components/dashboard/widgets/base-widget.tsx`, simplify `BaseWidget` (remove the `def.Component` fallback and the `WidgetProps` import):

```tsx
export function BaseWidget(props: BaseProps) {
  return <ContractWidget {...props} contract={props.def.contract} />;
}
```

- [ ] **Step 4: Remove the unused `tierOf` helper**

In `web/components/dashboard/widgets/widget-tier.tsx`, delete the `Tier` type and `tierOf` function (no longer referenced — density replaces them). Keep `WidgetProps` and `CompactStat`.

Run: `grep -rn "tierOf" web` — Expected: NO matches.

- [ ] **Step 5: Full verification sweep**

Run: `cd web && npx tsc --noEmit`
Expected: PASS — no dangling references.
Run: `cd web && npx vitest run`
Expected: PASS — full unit suite (density, contract, registry, states, chips, focus, base-widget, all 7 widget tests, plus existing grid/layout-store tests).
Run: `cd web && npx playwright test e2e/dashboard-grid.spec.ts`
Expected: PASS — full dashboard e2e incl. the new Focus, Duplicate, and preset tests.

- [ ] **Step 6: Commit**

```bash
git add web/lib/dashboard/registry.tsx web/components/dashboard/widgets/base-widget.tsx web/components/dashboard/widgets/widget-tier.tsx
git commit -m "refactor(dashboard): drop legacy widget component path; contract is the standard (slice D)"
```

---

## Self-Review

**Spec coverage** (design §1–7 → tasks):
- §1 Contract (types) → Task 2; registry wiring → Task 3; removal of legacy → Task 17. ✓
- §2 Density model (`effectiveDensity`, preset config, PersonalizeSheet control) → Tasks 1, 3, 16. ✓
- §3 BaseWidget shell (states + chips slot + focus + density render) → Task 7 (+ states Task 4, chips Task 5). ✓
- §4 Focus View (modal + real chart/breakdown + stub sections) → Task 6 + per-widget `Focus` in Tasks 9–15. ✓
- §5 Actions menu (`⋯`, real Expand/Customize/Duplicate/Remove, stub Ask-AI/Pin/Lock) → Task 8. ✓
- §6 Retrofit the 7 → Tasks 9–15. ✓ (all 4 states reachable: loading/error/empty via `queryState`; partial supported in shell, surfaced when a widget's `partialReason` fires — none of the 7 emit one yet, which is correct: partial is a sync-trust signal that lands with real sync data in slice C-be.)
- §7 Testing (tsc + vitest + playwright, no `next lint`) → every task + Task 17 sweep. ✓

**Insight-chip standard (§16) double-ship:** chips here are rule-based per-widget `deriveInsights`; slice G replaces those function bodies without touching `InsightChips`/`BaseWidget`. Seam preserved. ✓

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N"; every code step shows full code; the two "if it breaks" notes (jsdom setup in Task 4, e2e selector fallback in Task 16) are contingency guidance, not deferred work. ✓

**Type consistency:** `WidgetContract<T>` / `RenderCtx<T>` / `WidgetState<T>` / `queryState` signatures match across Tasks 2, 7, 9–15. `effectiveDensity(preset, w, h)` and `chipCap(level)` used consistently (Tasks 1, 7). Registry `contract: … as WidgetContract<unknown>` cast used uniformly until Task 17 makes it the declared type. `duplicateWidget(id)` defined (Task 8) and consumed (Task 8 grid wiring). ✓

**Scope:** single coherent contract + its 7 retrofits; no backend; AI/Pin/Lock/partial-data-source deferred to their owning slices. Right-sized for one plan. ✓
