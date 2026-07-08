# Slice E — Personalization System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the full dashboard personalization system — a floating tabbed Personalize pane (Layout-vs-Customize drag gating), global density modes, 5 named theme presets + appearance knobs, escalating privacy levels, and saved layouts.

**Architecture:** One floating glass inspector pane replaces the overgrown `PersonalizeSheet`, split into per-section files. Drag/resize is gated to the Layout tab only. Global personalization state extends `BoardPrefs` (non-destructive `localStorage` migration); saved layouts live in a sibling store. Themes extend the existing `data-theme="{palette}-{mode}"` CSS-var system; privacy is a React context widgets consult.

**Tech Stack:** Next.js (App Router) + React client components, TypeScript, Tailwind, CSS custom properties, Vitest (jsdom), Playwright. `localStorage` for persistence.

**Spec:** `docs/superpowers/specs/2026-06-19-slice-e-personalization-design.md`

## Global Constraints

- **No backend.** All personalization state is client-side `localStorage`. (spec: Non-goals)
- **Non-destructive migration.** `BOARD_VERSION` stays at **4**; do NOT bump it. New prefs land on defaults via the existing `{ ...DEFAULT_PREFS, ...saved }` fill; `densityMode` default is *derived* from saved `prefs.density`. (spec: Data model)
- **No AI tab.** The pane has Layout · Widgets · Theme · Density · Privacy · Advanced — six tabs, no AI section (slice G). (spec: Non-goals)
- **Per-widget preset still overrides** the global density baseline. (spec: D3)
- **Verification commands** (this repo's `next lint` is broken — do not use it): `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`. Run from `web/`.
- **Tests** follow the existing pure-fn Vitest pattern (mirror `lib/dashboard/density.test.ts` and `components/dashboard/widgets/net-worth-widget.test.tsx`).
- **Commit** after each task. End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- All paths below are relative to `web/`.

---

## Phase 1 — Mode shell + tabbed Personalize pane (BACKBONE — land first)

Reshapes the single `editing` boolean into a tab-driven floating pane and splits the overgrown `personalize-sheet.tsx` into focused section files. Phases 2–5 plug their UI into the sections created here.

### Task 1.1: Extend `BoardPrefs` with personalization state + derived migration

**Files:**
- Modify: `lib/dashboard/boards.ts` (BoardPrefs type, DEFAULT_PREFS)
- Modify: `lib/dashboard/layout-store.ts` (loadBoard prefs fill)
- Test: `lib/dashboard/layout-store.test.ts`

**Interfaces:**
- Produces: `BoardPrefs` gains `densityMode: DensityModeId`, `themePreset: string`, `accent: string | null`, `shadow: number`, `privacy: PrivacyLevel`. `deriveDensityMode(density): DensityModeId`.
- `DensityModeId` and `PrivacyLevel` are defined in later tasks (2.1, 4.1); for this task use the string-literal unions inline and re-export from those modules later. To avoid a forward dependency, define the literal unions here in `boards.ts` and have later tasks import them.

- [ ] **Step 1: Write the failing test** — append to `lib/dashboard/layout-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadBoard, saveBoard, STORAGE_PREFIX } from "./layout-store";
import { BOARD_VERSION } from "./boards";

describe("slice-E prefs migration", () => {
  beforeEach(() => localStorage.clear());

  it("fills new personalization prefs with defaults without wiping a v4 board", () => {
    const legacy = { version: BOARD_VERSION, items: [{ id: "a", type: "netWorth", x: 0, y: 0, w: 5, h: 2 }],
      prefs: { density: "compact", radius: 20, glass: 0, range: "3m" } };
    localStorage.setItem(STORAGE_PREFIX + "dashboard", JSON.stringify(legacy));
    const loaded = loadBoard("dashboard");
    expect(loaded.items).toHaveLength(1);            // not wiped
    expect(loaded.prefs.privacy).toBe("off");
    expect(loaded.prefs.accent).toBeNull();
    expect(loaded.prefs.shadow).toBe(0);
    // densityMode derived from saved grid density: compact -> power
    expect(loaded.prefs.densityMode).toBe("power");
  });

  it("derives densityMode from grid density (spacious->calm, cozy->balanced)", () => {
    for (const [density, mode] of [["spacious", "calm"], ["cozy", "balanced"]] as const) {
      localStorage.setItem(STORAGE_PREFIX + "dashboard", JSON.stringify({
        version: BOARD_VERSION, items: [], prefs: { density, radius: 20, glass: 0, range: "3m" } }));
      expect(loadBoard("dashboard").prefs.densityMode).toBe(mode);
    }
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run lib/dashboard/layout-store.test.ts` → FAIL (`privacy` undefined).

- [ ] **Step 3: Extend `boards.ts`.** Replace the `BoardPrefs` type and `DEFAULT_PREFS`:

```ts
export type DensityModeId = "calm" | "balanced" | "power" | "minimal";
export type PrivacyLevel = "off" | "privacy" | "presentation" | "screenshot";

export type BoardPrefs = {
  density: "compact" | "cozy" | "spacious";
  radius: number; // px
  glass: number; // 0–90 transparency %
  range: RangePreset;
  // slice E
  densityMode: DensityModeId;
  themePreset: string;       // ThemePresetId, validated in theme layer
  accent: string | null;     // null = preset default
  shadow: number;            // 0–100 shadow/glow intensity
  privacy: PrivacyLevel;
};

export const DEFAULT_PREFS: BoardPrefs = {
  density: "cozy", radius: 20, glass: 0, range: "3m",
  densityMode: "balanced", themePreset: "", accent: null, shadow: 0, privacy: "off",
};
```

- [ ] **Step 4: Add the derive helper + use it in `layout-store.ts`.** In `boards.ts`:

```ts
export function deriveDensityMode(density: BoardPrefs["density"]): DensityModeId {
  return density === "spacious" ? "calm" : density === "compact" ? "power" : "balanced";
}
```

In `layout-store.ts`, change the non-destructive return line of `loadBoard` (and the same line in `migrateV2Board`) to derive `densityMode` when absent:

```ts
import { BOARD_VERSION, DEFAULT_PREFS, deriveDensityMode, type BoardState, defaultBoardState } from "./boards";
// ...
const savedPrefs = parsed.prefs ?? {};
const prefs = { ...DEFAULT_PREFS, ...savedPrefs };
if (savedPrefs.densityMode === undefined && savedPrefs.density) {
  prefs.densityMode = deriveDensityMode(savedPrefs.density);
}
return { ...parsed, prefs };
```

- [ ] **Step 5: Run test, verify it passes** — `npx vitest run lib/dashboard/layout-store.test.ts` → PASS. Then `npx tsc --noEmit` → clean (other files still compile; `themePreset: ""` is a temporary default fixed in Task 3.1).

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/boards.ts lib/dashboard/layout-store.ts lib/dashboard/layout-store.test.ts
git commit -m "feat(dashboard): extend BoardPrefs with slice-E personalization state

Non-destructive migration; densityMode derived from saved grid density.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 1.2: Pane mode state + floating layout (drop the canvas squeeze)

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `components/dashboard/controls/dashboard-controls.tsx` (rename toggle label to "Personalize"; behavior unchanged)
- Test: none (wiring; covered by Phase-1 component test in Task 1.4 + e2e in Task 1.5)

**Interfaces:**
- Produces: `PersonalizePane` (Task 1.3) receives `tab: PaneTab`, `onTabChange`, `controller`. `PaneTab = "layout" | "widgets" | "theme" | "density" | "privacy" | "advanced"`.
- `DashboardGrid`'s `editing` prop now means "drag/resize unlocked" and is `open && tab === "layout"`.

- [ ] **Step 1: Update `page.tsx`.** Replace the body:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useDashboard } from "@/lib/dashboard/use-dashboard";
import { DashboardGrid } from "@/components/dashboard/grid/dashboard-grid";
import { PersonalizePane, type PaneTab } from "@/components/dashboard/grid/personalize/personalize-pane";
import { DashboardControls } from "@/components/dashboard/controls/dashboard-controls";

export default function DashboardPage() {
  const controller = useDashboard("dashboard");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PaneTab>("layout");
  const editing = open && tab === "layout"; // drag/resize only in Layout tab

  useEffect(() => {
    document.documentElement.style.setProperty("--board-glass", String(controller.state.prefs.glass / 100));
  }, [controller.state.prefs.glass]);

  const setOpenMode = (next: boolean) => {
    setOpen(next);
    if (!next) controller.select(null);
  };

  return (
    <div className="space-y-3">
      {/* Pane FLOATS above the canvas (no pr-squeeze): widgets keep their size. */}
      <div className="space-y-3">
        <DashboardControls
          range={controller.state.prefs.range}
          onRangeChange={(range) => controller.setPrefs({ range })}
          editing={open}
          onToggleEditing={() => setOpenMode(!open)}
        />
        <DashboardGrid
          boardId="dashboard"
          editing={editing}
          controller={controller}
          onCustomizeWidget={(id) => { setOpen(true); setTab("widgets"); controller.select(id); }}
        />
      </div>
      <PersonalizePane open={open} tab={tab} onTabChange={setTab} onOpenChange={setOpenMode} controller={controller} />
    </div>
  );
}
```

- [ ] **Step 2: Update the controls label.** In `dashboard-controls.tsx`, change the Customize button's text from "Customize"/"Done" to "Personalize"/"Done" (find the `onToggleEditing` button). No behavior change.

- [ ] **Step 3: Verify build** — `npx tsc --noEmit`. Expected: errors ONLY about the not-yet-created `personalize-pane` module (resolved in Task 1.3). If other errors appear, fix them.

- [ ] **Step 4: Commit**

```bash
git add app/(app)/dashboard/page.tsx components/dashboard/controls/dashboard-controls.tsx
git commit -m "feat(dashboard): pane mode state + floating layout (no canvas squeeze)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 1.3: `PersonalizePane` shell + section scaffolding (migrate sheet logic)

**Files:**
- Create: `components/dashboard/grid/personalize/personalize-pane.tsx`
- Create: `components/dashboard/grid/personalize/sections/layout-section.tsx`
- Create: `components/dashboard/grid/personalize/sections/widgets-section.tsx`
- Create: `components/dashboard/grid/personalize/sections/theme-section.tsx`
- Create: `components/dashboard/grid/personalize/sections/density-section.tsx`
- Create: `components/dashboard/grid/personalize/sections/privacy-section.tsx`
- Create: `components/dashboard/grid/personalize/sections/advanced-section.tsx`
- Delete: `components/dashboard/grid/personalize-sheet.tsx` (after migrating its logic)
- Test: `components/dashboard/grid/personalize/personalize-pane.test.tsx`

**Interfaces:**
- Produces: `PersonalizePane({ open, tab, onTabChange, onOpenChange, controller })`, `type PaneTab`. Each section is `({ controller })` except `WidgetsSection` which also takes `{ selectedId }`.
- Consumes: `useDashboard` return (Task source), `useTheme`.

- [ ] **Step 1: Write the failing test:**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PersonalizePane } from "./personalize-pane";

const controller = { state: { items: [], prefs: { density: "cozy", densityMode: "balanced", privacy: "off",
  radius: 20, glass: 0, shadow: 0, accent: null, themePreset: "indigo-light", range: "3m" } },
  library: [], selectedId: null, select: vi.fn(), setPrefs: vi.fn(), updateConfig: vi.fn(),
  hideWidget: vi.fn(), addWidget: vi.fn(), reset: vi.fn() } as any;

describe("PersonalizePane", () => {
  it("renders six tabs and switches active section", () => {
    const onTabChange = vi.fn();
    render(<PersonalizePane open tab="layout" onTabChange={onTabChange} onOpenChange={vi.fn()} controller={controller} />);
    for (const t of ["Layout", "Widgets", "Theme", "Density", "Privacy", "Advanced"]) {
      expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("tab", { name: "Density" }));
    expect(onTabChange).toHaveBeenCalledWith("density");
  });

  it("renders nothing when closed", () => {
    const { container } = render(<PersonalizePane open={false} tab="layout" onTabChange={vi.fn()} onOpenChange={vi.fn()} controller={controller} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run components/dashboard/grid/personalize/personalize-pane.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Create stub section files.** Each section is a placeholder filled by later phases. Example `density-section.tsx` (the others follow the same skeleton with their own heading: Layout, Widgets, Theme, Privacy, Advanced):

```tsx
"use client";
import type { useDashboard } from "@/lib/dashboard/use-dashboard";

export function DensitySection({ controller: _controller }: { controller: ReturnType<typeof useDashboard> }) {
  return <p className="text-[12px] text-muted">Density mode controls (Phase 2).</p>;
}
```

For `widgets-section.tsx`, **move the per-widget config + add/remove UI out of the existing `personalize-sheet.tsx`** verbatim (the selected-widget config block, the library add list, hide buttons). Signature: `WidgetsSection({ controller, selectedId })`. For `theme-section.tsx`, move the palette/mode/accent block (Phase 3 expands it). For `advanced-section.tsx`, move the range default + reset.

- [ ] **Step 4: Create `personalize-pane.tsx`.** Floating glass inspector, tab strip, section routing:

```tsx
"use client";
import { useEffect } from "react";
import { X } from "lucide-react";
import type { useDashboard } from "@/lib/dashboard/use-dashboard";
import { LayoutSection } from "./sections/layout-section";
import { WidgetsSection } from "./sections/widgets-section";
import { ThemeSection } from "./sections/theme-section";
import { DensitySection } from "./sections/density-section";
import { PrivacySection } from "./sections/privacy-section";
import { AdvancedSection } from "./sections/advanced-section";

export type PaneTab = "layout" | "widgets" | "theme" | "density" | "privacy" | "advanced";
const TABS: [PaneTab, string][] = [["layout","Layout"],["widgets","Widgets"],["theme","Theme"],["density","Density"],["privacy","Privacy"],["advanced","Advanced"]];

export function PersonalizePane({ open, tab, onTabChange, onOpenChange, controller }: {
  open: boolean; tab: PaneTab; onTabChange: (t: PaneTab) => void;
  onOpenChange: (v: boolean) => void; controller: ReturnType<typeof useDashboard>;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <aside className="fixed right-4 top-20 bottom-4 z-40 flex w-[340px] flex-col rounded-card border border-border bg-card/80 shadow-card backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Personalize</span>
        <button aria-label="Close" onClick={() => onOpenChange(false)} className="text-muted hover:text-fg"><X className="size-4" /></button>
      </div>
      <div role="tablist" className="flex flex-wrap gap-1 px-3 pt-2">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTabChange(id)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tab === id ? "bg-accent text-on-accent" : "bg-chip text-muted hover:text-fg"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === "layout" && <LayoutSection controller={controller} />}
        {tab === "widgets" && <WidgetsSection controller={controller} selectedId={controller.selectedId} />}
        {tab === "theme" && <ThemeSection controller={controller} />}
        {tab === "density" && <DensitySection controller={controller} />}
        {tab === "privacy" && <PrivacySection controller={controller} />}
        {tab === "advanced" && <AdvancedSection controller={controller} />}
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Delete the old sheet + fix imports.** Remove `components/dashboard/grid/personalize-sheet.tsx`. Grep for `PersonalizeSheet` and ensure no remaining importers (`page.tsx` already switched in Task 1.2).

- [ ] **Step 6: Run tests + typecheck** — `npx vitest run components/dashboard/grid/personalize/personalize-pane.test.tsx` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/grid/personalize app/(app)/dashboard
git rm components/dashboard/grid/personalize-sheet.tsx
git commit -m "refactor(dashboard): split PersonalizeSheet into tabbed PersonalizePane

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 1.4: Selected-widget auto-scroll clear of the pane

**Files:**
- Modify: `components/dashboard/grid/dashboard-grid.tsx` (scroll selected widget into the non-occluded region on select)
- Test: covered by e2e (Task 1.5)

- [ ] **Step 1:** In `dashboard-grid.tsx`, add an effect: when `selectedId` changes and the pane is open, `scrollIntoView({ block: "nearest", inline: "start" })` on the selected widget's frame so the 340px-right pane doesn't cover it. Use a `data-widget-id` attribute on the frame (add if absent) and `ref.current?.querySelector(...)`.

```tsx
useEffect(() => {
  if (!selectedId) return;
  ref.current?.querySelector<HTMLElement>(`[data-widget-id="${selectedId}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "start", behavior: "smooth" });
}, [selectedId]);
```

- [ ] **Step 2:** Add `data-widget-id={item.id}` to the widget wrapper div in the render map (search for where `WidgetFrame` is rendered).

- [ ] **Step 3:** `npx tsc --noEmit` → clean. Manual smoke: not required here (e2e covers it).

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/grid/dashboard-grid.tsx
git commit -m "feat(dashboard): scroll selected widget clear of the personalize pane

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 1.5: Phase-1 e2e — Layout-vs-Customize drag gating

**Files:**
- Create: `e2e/dashboard-personalize.spec.ts`

**Interfaces:**
- Consumes: existing `e2e/dashboard-grid.spec.ts` selectors (`data-testid="dashboard-grid-lattice"`, widget frames). Reuse its setup/login helper.

- [ ] **Step 1: Write the e2e** (mirror the structure of `e2e/dashboard-grid.spec.ts`):

```ts
import { test, expect } from "@playwright/test";
// reuse the login/navigation helper pattern from dashboard-grid.spec.ts

test("Layout tab unlocks drag; other tabs lock it", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Personalize" }).click();
  // Layout tab is default → lattice (edit affordance) visible
  await page.getByRole("tab", { name: "Layout" }).click();
  await expect(page.getByTestId("dashboard-grid-lattice")).toBeVisible();
  // Switch to Theme → lattice gone (widgets locked)
  await page.getByRole("tab", { name: "Theme" }).click();
  await expect(page.getByTestId("dashboard-grid-lattice")).toHaveCount(0);
});
```

- [ ] **Step 2: Run** — `npx playwright test e2e/dashboard-personalize.spec.ts`. Expected: PASS. (If the lattice only renders while `editing`, this asserts the gating directly.)

- [ ] **Step 3: Commit**

```bash
git add e2e/dashboard-personalize.spec.ts
git commit -m "test(dashboard): e2e — Layout tab gates drag, other tabs lock

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — Density modes (Calm/Balanced/Power/Minimal)

### Task 2.1: `density-modes.ts` mapping + `effectiveDensity` baseline

**Files:**
- Create: `lib/dashboard/density-modes.ts`
- Modify: `lib/dashboard/density.ts` (add baseline-aware fallback)
- Test: `lib/dashboard/density-modes.test.ts`

**Interfaces:**
- Produces: `DENSITY_MODES: Record<DensityModeId, { baselinePreset: Preset; gridDensity: BoardPrefs["density"]; essentialOnly: boolean }>`, `baselineFor(mode): Preset`, and `effectiveDensityFor(configPreset, mode, w, h): DensityLevel`.
- Consumes: `Preset`, `DensityLevel`, `effectiveDensity` from `density.ts`; `DensityModeId` from `boards.ts`.

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import { DENSITY_MODES, baselineFor, effectiveDensityFor } from "./density-modes";

describe("density-modes", () => {
  it("maps each mode to a baseline preset + grid density", () => {
    expect(DENSITY_MODES.calm.baselinePreset).toBe("compact");
    expect(DENSITY_MODES.power.baselinePreset).toBe("analytical");
    expect(DENSITY_MODES.minimal.essentialOnly).toBe(true);
    expect(DENSITY_MODES.balanced.gridDensity).toBe("cozy");
  });
  it("uses the mode baseline when the widget has no preset override", () => {
    // power baseline = analytical (level 3), large widget can show it
    expect(effectiveDensityFor(undefined, "power", 5, 2)).toBe(3);
    // per-widget preset overrides the baseline
    expect(effectiveDensityFor("compact", "power", 5, 2)).toBe(0);
    // size still caps: analytical baseline on a 1x1 → 0
    expect(effectiveDensityFor(undefined, "power", 1, 1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run lib/dashboard/density-modes.test.ts` → FAIL.

- [ ] **Step 3: Implement `density-modes.ts`:**

```ts
import type { Preset, DensityLevel } from "./density";
import { effectiveDensity } from "./density";
import type { DensityModeId, BoardPrefs } from "./boards";

export const DENSITY_MODES: Record<DensityModeId, { baselinePreset: Preset; gridDensity: BoardPrefs["density"]; essentialOnly: boolean }> = {
  calm:     { baselinePreset: "compact",    gridDensity: "spacious", essentialOnly: false },
  balanced: { baselinePreset: "standard",   gridDensity: "cozy",     essentialOnly: false },
  power:    { baselinePreset: "analytical", gridDensity: "compact",  essentialOnly: false },
  minimal:  { baselinePreset: "standard",   gridDensity: "spacious", essentialOnly: true  },
};

export function baselineFor(mode: DensityModeId): Preset { return DENSITY_MODES[mode].baselinePreset; }

export function effectiveDensityFor(configPreset: Preset | undefined, mode: DensityModeId, w: number, h: number): DensityLevel {
  return effectiveDensity(configPreset ?? baselineFor(mode), w, h);
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run lib/dashboard/density-modes.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/density-modes.ts lib/dashboard/density-modes.test.ts
git commit -m "feat(dashboard): density-modes mapping + baseline-aware effective density

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 2.2: Wire density mode into rendering

**Files:**
- Modify: `components/dashboard/widgets/base-widget.tsx` (use `effectiveDensityFor` with `prefs.densityMode`)
- Test: `components/dashboard/widgets/base-widget.test.tsx` (extend)

**Interfaces:**
- Consumes: `effectiveDensityFor` (Task 2.1). `base-widget.tsx` must receive the active `densityMode` — thread it from the grid (`controller.state.prefs.densityMode`) through `WidgetFrame` → `BaseWidget` as a `mode` prop, OR read it where `BaseWidget` already gets `config`. Inspect `base-widget.tsx`'s `effectiveDensity(config.preset, w, h)` call site and replace with `effectiveDensityFor(config.preset, mode, w, h)`.

- [ ] **Step 1: Extend the test** in `base-widget.test.tsx` — render a contract widget with `densityMode="calm"` and no per-widget preset; assert it renders the compact (level-0) body; then with `densityMode="power"` assert the richer body. (Use the existing test's render helper; pass the mode through whatever prop chain Step 2 establishes.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3:** Thread `mode: DensityModeId` from `dashboard-grid.tsx` (`state.prefs.densityMode`) → `WidgetFrame` → `BaseWidget`. In `base-widget.tsx` replace the `effectiveDensity(config.preset, w, h)` call with `effectiveDensityFor(config.preset, mode, w, h)`. Default `mode` to `"balanced"` if a caller omits it (keeps existing tests green).

- [ ] **Step 4: Run, verify pass** — `npx vitest run components/dashboard/widgets/base-widget.test.tsx` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/widgets/base-widget.tsx components/dashboard/grid components/dashboard/widgets/base-widget.test.tsx
git commit -m "feat(dashboard): render widgets against the active density mode baseline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 2.3: Minimal mode — `essential` flag + render filter

**Files:**
- Modify: `lib/dashboard/registry.tsx` (add `essential?: boolean` to `WidgetDef`; mark essentials)
- Modify: `components/dashboard/grid/dashboard-grid.tsx` (filter non-essential when `densityMode === "minimal"` and not editing)
- Test: `lib/dashboard/registry.test.ts` (assert essentials set)

**Interfaces:**
- Produces: `WidgetDef.essential?: boolean`. Essentials: `netWorth`, `cashflow`, `recurring`, `aiAlert`, `recentActivity`.

- [ ] **Step 1: Write the failing test** in `registry.test.ts`:

```ts
import { WIDGETS } from "./registry";
it("marks the slice-E minimal-mode essentials", () => {
  const essential = Object.entries(WIDGETS).filter(([, d]) => d.essential).map(([k]) => k).sort();
  expect(essential).toEqual(["aiAlert", "cashflow", "netWorth", "recentActivity", "recurring"]);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3:** Add `essential?: boolean` to the `WidgetDef` type and set `essential: true` on the five entries (`netWorth`, `cashflow`, `recurring`, `aiAlert`, `recentActivity`).

- [ ] **Step 4:** In `dashboard-grid.tsx`, when `state.prefs.densityMode === "minimal" && !editing`, filter the rendered items to those whose `WIDGETS[item.type].essential` (do not mutate `state.items` — filter at render only, so it's reversible). When editing, show all (so users can still arrange).

- [ ] **Step 5: Run tests + typecheck** — `npx vitest run lib/dashboard/registry.test.ts` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/registry.tsx components/dashboard/grid/dashboard-grid.tsx lib/dashboard/registry.test.ts
git commit -m "feat(dashboard): minimal density mode hides non-essential widgets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 2.4: `DensitySection` UI

**Files:**
- Modify: `components/dashboard/grid/personalize/sections/density-section.tsx`
- Test: extend `personalize-pane.test.tsx`

- [ ] **Step 1: Write failing test** — render pane on the Density tab; click "Power"; assert `controller.setPrefs` called with `{ densityMode: "power", density: "compact" }`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `DensitySection`: four mode buttons (Calm/Balanced/Power/Minimal) reading `controller.state.prefs.densityMode`; on click call `controller.setPrefs({ densityMode: id, density: DENSITY_MODES[id].gridDensity })`. Show each mode's one-line description from §6.

- [ ] **Step 4: Run, verify pass; typecheck.**

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/grid/personalize/sections/density-section.tsx components/dashboard/grid/personalize/personalize-pane.test.tsx
git commit -m "feat(dashboard): density mode picker in personalize pane

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — Theme presets + appearance knobs

### Task 3.1: Author 5 named theme presets (tokens + metadata)

**Files:**
- Modify: `lib/theme/themes.ts` (extend Palette union, THEME_RE, THEME_BG, PALETTE_SWATCH, add `THEME_PRESETS` metadata with supported modes)
- Modify: `app/globals.css` (add `data-theme` token blocks for the new presets)
- Modify: `lib/dashboard/boards.ts` (`DEFAULT_PREFS.themePreset` → `"indigo-light"`)
- Test: `lib/theme/themes.test.ts` (create)

**Interfaces:**
- Produces: `THEME_PRESETS: { id: ThemeId; name: string; palette: Palette; modes: Mode[] }[]`, `presetSupportsMode(palette, mode): boolean`. New palettes: `dollar` (light), `glass` (dark), `editorial` (light), `neon` (dark), `softmin` (light+dark).
- The existing `{palette}-{mode}` ThemeId mechanism is reused; mode-locked presets only author their supported block(s).

- [ ] **Step 1: Write the failing test** `lib/theme/themes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { THEME_PRESETS, presetSupportsMode, isThemeId, THEME_BG } from "./themes";

describe("theme presets", () => {
  it("includes the 5 named presets plus the 3 originals", () => {
    const ids = THEME_PRESETS.map((p) => p.palette);
    for (const p of ["dollar","glass","editorial","neon","softmin","emerald","indigo","ink"]) expect(ids).toContain(p);
  });
  it("locks mode for single-mode presets", () => {
    expect(presetSupportsMode("glass", "light")).toBe(false); // Liquid Glass = dark only
    expect(presetSupportsMode("glass", "dark")).toBe(true);
    expect(presetSupportsMode("softmin", "light")).toBe(true);
    expect(presetSupportsMode("softmin", "dark")).toBe(true);
  });
  it("every authored preset id is a valid theme id with a bg color", () => {
    for (const p of THEME_PRESETS) for (const m of p.modes) {
      const id = `${p.palette}-${m}`;
      expect(isThemeId(id)).toBe(true);
      expect(THEME_BG[id as keyof typeof THEME_BG]).toMatch(/^#/);
    }
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Extend `themes.ts`.** Add the 5 palettes to `PALETTES`, update `THEME_RE` to include them, add `THEME_BG` entries for each supported `{palette}-{mode}`, add `PALETTE_SWATCH`, and add:

```ts
export const THEME_PRESETS: { id: ThemeId; name: string; palette: Palette; modes: Mode[] }[] = [
  { palette: "dollar",    name: "Dollar Bill",   modes: ["light"],          id: "dollar-light" },
  { palette: "glass",     name: "Liquid Glass",  modes: ["dark"],           id: "glass-dark" },
  { palette: "editorial", name: "Editorial",     modes: ["light"],          id: "editorial-light" },
  { palette: "neon",      name: "Neon Ledger",   modes: ["dark"],           id: "neon-dark" },
  { palette: "softmin",   name: "Soft Minimal",  modes: ["light","dark"],   id: "softmin-light" },
  { palette: "indigo",    name: "Indigo",        modes: ["light","dark"],   id: "indigo-light" },
  { palette: "emerald",   name: "Emerald",       modes: ["light","dark"],   id: "emerald-light" },
  { palette: "ink",       name: "Ink",           modes: ["light","dark"],   id: "ink-light" },
];
export function presetSupportsMode(palette: Palette, mode: Mode): boolean {
  return THEME_PRESETS.find((p) => p.palette === palette)?.modes.includes(mode) ?? false;
}
```

- [ ] **Step 4: Add `data-theme` blocks to `globals.css`** for each authored preset (full token set: `--app-bg --fg --muted --accent --accent-soft --on-accent --c2 --soft2 --c3 --soft3 --card --border --card-shadow --chip --track`). Use the §18 vibe per preset: Dollar Bill = soft green/off-white paper; Liquid Glass = translucent dark + highlights; Editorial = high-contrast typographic light; Neon Ledger = high-contrast techy dark; Soft Minimal = muted low-noise (light + dark). Match the exact var list used by the existing blocks (lines 12–50).

- [ ] **Step 5: Set `DEFAULT_PREFS.themePreset = "indigo-light"`** in `boards.ts`.

- [ ] **Step 6: Run tests + typecheck** — `npx vitest run lib/theme/themes.test.ts` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add lib/theme/themes.ts app/globals.css lib/dashboard/boards.ts lib/theme/themes.test.ts
git commit -m "feat(theme): author 5 named theme presets alongside the 3 palettes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3.2: Appearance knobs as live CSS vars (accent, radius, glass, shadow)

**Files:**
- Modify: `app/(app)/dashboard/page.tsx` (apply `--board-radius`, `--board-shadow`, `--accent` override from prefs)
- Modify: `app/globals.css` (consume `--board-radius`/`--board-shadow` where card radius/shadow are set, if not already)
- Test: `lib/theme/appearance.test.ts` (create) for a pure resolver

**Interfaces:**
- Produces: `appearanceVars(prefs): Record<string,string>` in `lib/theme/appearance.ts` — maps prefs → CSS var object. Consumed by `page.tsx`.

- [ ] **Step 1: Write failing test** `lib/theme/appearance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { appearanceVars } from "./appearance";

it("maps prefs to css vars; null accent omits the override", () => {
  const v = appearanceVars({ radius: 16, glass: 30, shadow: 50, accent: null } as any);
  expect(v["--board-radius"]).toBe("16px");
  expect(v["--board-glass"]).toBe("0.3");
  expect(v["--board-shadow"]).toBe("0.5");
  expect(v["--accent"]).toBeUndefined();
});
it("includes accent override when set", () => {
  expect(appearanceVars({ radius: 0, glass: 0, shadow: 0, accent: "#ff0000" } as any)["--accent"]).toBe("#ff0000");
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `lib/theme/appearance.ts`:**

```ts
import type { BoardPrefs } from "@/lib/dashboard/boards";
export function appearanceVars(prefs: Pick<BoardPrefs, "radius" | "glass" | "shadow" | "accent">): Record<string, string> {
  const vars: Record<string, string> = {
    "--board-radius": `${prefs.radius}px`,
    "--board-glass": String(prefs.glass / 100),
    "--board-shadow": String(prefs.shadow / 100),
  };
  if (prefs.accent) vars["--accent"] = prefs.accent;
  return vars;
}
```

- [ ] **Step 4:** In `page.tsx`, replace the single `--board-glass` effect with one that applies all of `appearanceVars(controller.state.prefs)` (set each property; for `--accent`, set or `removeProperty` when null). Ensure `globals.css` card rules use `var(--board-radius, …)` and shadow uses `var(--board-shadow, …)` (add fallbacks; do not break existing look when knobs are at defaults).

- [ ] **Step 5: Run tests + typecheck** — PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/dashboard/page.tsx app/globals.css lib/theme/appearance.ts lib/theme/appearance.test.ts
git commit -m "feat(theme): live appearance knobs (accent/radius/glass/shadow) as css vars

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3.3: `ThemeSection` UI

**Files:**
- Modify: `components/dashboard/grid/personalize/sections/theme-section.tsx`
- Test: extend `personalize-pane.test.tsx`

- [ ] **Step 1: Write failing test** — on the Theme tab, clicking the "Dollar Bill" preset swatch calls `setPrefs({ themePreset: "dollar-light" })` and `useTheme().setPalette`/theme apply; clicking light/dark toggles mode only when supported (assert disabled for "Liquid Glass").

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `ThemeSection`: preset swatch grid from `THEME_PRESETS`; light/dark segmented control disabled per `presetSupportsMode`; accent picker (writes `setPrefs({ accent })`); three sliders for radius / glass / shadow (write `setPrefs`). Selecting a preset calls the theme provider `apply` for the `{palette}-{mode}` and `setPrefs({ themePreset })`. Move the existing palette/accent block here (from the migrated stub) and expand it.

- [ ] **Step 4: Run, verify pass; typecheck.**

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/grid/personalize/sections/theme-section.tsx components/dashboard/grid/personalize/personalize-pane.test.tsx
git commit -m "feat(theme): theme preset + appearance controls in personalize pane

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 4 — Privacy modes

### Task 4.1: `maskMoney` + `PrivacyProvider` context

**Files:**
- Create: `lib/dashboard/privacy.ts` (pure helpers)
- Create: `components/dashboard/privacy-provider.tsx` (context + `<Private>`)
- Test: `lib/dashboard/privacy.test.ts`

**Interfaces:**
- Produces: `maskMoney(value: string, level: PrivacyLevel): string`, `shouldBlurMoney(level)`, `shouldHoverReveal(level)`, `shouldMaskNames(level)`. `PrivacyProvider`, `usePrivacy(): { level }`, `<Private kind="money"|"name"|"text">`.
- Consumes: `PrivacyLevel` from `boards.ts`.

- [ ] **Step 1: Write failing test** `lib/dashboard/privacy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { maskMoney, shouldHoverReveal, shouldMaskNames } from "./privacy";

describe("privacy", () => {
  it("passes money through when off, masks otherwise", () => {
    expect(maskMoney("$1,234", "off")).toBe("$1,234");
    expect(maskMoney("$1,234", "privacy")).toBe("•••••");
    expect(maskMoney("$1,234", "screenshot")).toBe("•••••");
  });
  it("only allows hover-reveal at the lightest level", () => {
    expect(shouldHoverReveal("privacy")).toBe(true);
    expect(shouldHoverReveal("presentation")).toBe(false);
    expect(shouldHoverReveal("screenshot")).toBe(false);
  });
  it("masks names at every level above off", () => {
    expect(shouldMaskNames("off")).toBe(false);
    expect(shouldMaskNames("privacy")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `lib/dashboard/privacy.ts`:**

```ts
import type { PrivacyLevel } from "./boards";
export const shouldBlurMoney = (l: PrivacyLevel) => l !== "off";
export const shouldHoverReveal = (l: PrivacyLevel) => l === "privacy";
export const shouldMaskNames = (l: PrivacyLevel) => l !== "off";
export const hideBalances = (l: PrivacyLevel) => l === "presentation" || l === "screenshot";
export function maskMoney(value: string, level: PrivacyLevel): string {
  return shouldBlurMoney(level) ? "•••••" : value;
}
```

- [ ] **Step 4: Implement `privacy-provider.tsx`** — context holding `level`; `<Private kind>` that, per `kind` + level, renders masked text (money → `maskMoney`, name/text → `"•••"`), and at `privacy` level wraps with a CSS-blur span that clears on hover (`group` + `group-hover:blur-0`). Provider is mounted in `page.tsx` (Task 4.2) around the grid with `level={prefs.privacy}`.

- [ ] **Step 5: Run tests + typecheck** — PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/privacy.ts components/dashboard/privacy-provider.tsx lib/dashboard/privacy.test.ts
git commit -m "feat(dashboard): privacy helpers + provider/<Private> wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 4.2: Mount provider + adopt `<Private>` in widgets

**Files:**
- Modify: `app/(app)/dashboard/page.tsx` (wrap grid in `PrivacyProvider`)
- Modify: the 11 widget files (wrap monetary stat values + names/descriptions)
- Modify: `components/dashboard/grid/personalize/sections/privacy-section.tsx` (level picker)
- Test: `components/dashboard/widgets/net-worth-widget.test.tsx` (one representative privacy assertion)

**Interfaces:**
- Consumes: `usePrivacy`, `<Private>` (Task 4.1).

- [ ] **Step 1:** Wrap the grid in `page.tsx`: `<PrivacyProvider level={controller.state.prefs.privacy}><DashboardGrid …/></PrivacyProvider>`.

- [ ] **Step 2:** Implement `PrivacySection`: four buttons Off / Privacy / Presentation / Safe-Screenshot → `setPrefs({ privacy })`, with the §14 description per level.

- [ ] **Step 3: Write one representative widget test** in `net-worth-widget.test.tsx`: render the net-worth Body inside a `PrivacyProvider level="privacy"`; assert the displayed value contains the mask glyph, not the raw currency. Run → fail.

- [ ] **Step 4: Adopt `<Private>`** across widgets. Pattern (apply to each monetary value + each account/card/merchant name + txn description):

```tsx
// before:  <p>{data.value}</p>
// after:   <p><Private kind="money">{data.value}</Private></p>
```

Exact files to update (money values and, where present, names/descriptions):
`net-worth-widget.tsx`, `safe-to-spend-widget.tsx`, `cashflow-widget.tsx`, `breakdown-widget.tsx`, `budgets-widget.tsx`, `recent-activity-widget.tsx` (descriptions → `kind="text"`), `ai-alert-widget.tsx`, `credit-card-widget.tsx` (card names → `kind="name"`), `debt-widget.tsx`, `recurring-widget.tsx` (merchant names → `kind="name"`), `holdings-widget.tsx`. Also the `CompactStat` value in `widget-tier.tsx` and `StatBlock` value in `block-renderer.tsx` — wrap their money value once there so every contract widget inherits masking (preferred DRY point; if done there, individual widgets only need `kind="name"`/`"text"` wraps for non-money fields).

- [ ] **Step 5: Run** the representative test → PASS; full suite `npx vitest run` → green; `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/dashboard/page.tsx components/dashboard/widgets components/dashboard/grid/personalize/sections/privacy-section.tsx
git commit -m "feat(dashboard): adopt privacy masking across widgets + level picker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 4.3: Safe-Screenshot strips the pane + e2e

**Files:**
- Modify: `components/dashboard/grid/personalize/personalize-pane.tsx` (hide value-bearing chrome at `screenshot` level — N/A for the pane itself; ensure no tooltips leak)
- Create/extend: `e2e/dashboard-personalize.spec.ts`

- [ ] **Step 1:** Add e2e: open Personalize → Privacy → click "Privacy"; assert a known money value is masked (`•••••`) on the canvas. Then "Off" restores it.

- [ ] **Step 2: Run** — `npx playwright test e2e/dashboard-personalize.spec.ts` → PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/dashboard-personalize.spec.ts components/dashboard/grid/personalize/personalize-pane.tsx
git commit -m "test(dashboard): e2e — privacy masking applied/cleared

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 5 — Saved layouts

### Task 5.1: `layout-presets.ts` store (save/switch/delete/reset)

**Files:**
- Create: `lib/dashboard/layout-presets.ts`
- Test: `lib/dashboard/layout-presets.test.ts`

**Interfaces:**
- Produces: `loadLayouts(boardId): LayoutStore`, `saveLayout(boardId, name, items): LayoutStore`, `switchLayout(boardId, name): GridItem[] | null`, `deleteLayout(boardId, name): LayoutStore`. `LayoutStore = { layouts: SavedLayout[]; active: string | null }`, `SavedLayout = { name: string; items: GridItem[]; savedAt: number }`. Key: `cf-layouts:<boardId>`.
- Consumes: `GridItem` from `grid.ts`.

- [ ] **Step 1: Write failing test** `lib/dashboard/layout-presets.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadLayouts, saveLayout, switchLayout, deleteLayout } from "./layout-presets";

const items = [{ id: "a", type: "netWorth", x: 0, y: 0, w: 5, h: 2 }];

describe("layout-presets", () => {
  beforeEach(() => localStorage.clear());
  it("saves, lists, switches and deletes named layouts", () => {
    saveLayout("dashboard", "Daily", items as any);
    expect(loadLayouts("dashboard").layouts.map((l) => l.name)).toEqual(["Daily"]);
    expect(switchLayout("dashboard", "Daily")).toHaveLength(1);
    expect(loadLayouts("dashboard").active).toBe("Daily");
    expect(switchLayout("dashboard", "Nope")).toBeNull();
    deleteLayout("dashboard", "Daily");
    expect(loadLayouts("dashboard").layouts).toHaveLength(0);
  });
  it("overwrites a layout saved under an existing name", () => {
    saveLayout("dashboard", "X", items as any);
    saveLayout("dashboard", "X", [...items, { id: "b", type: "debt", x: 5, y: 0, w: 5, h: 2 }] as any);
    expect(loadLayouts("dashboard").layouts).toHaveLength(1);
    expect(switchLayout("dashboard", "X")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `layout-presets.ts`** — JSON in `localStorage` under `cf-layouts:<boardId>`; `saveLayout` upserts by name (deep-copies items), sets `active`; `switchLayout` returns a deep copy of the named items or `null`; `deleteLayout` removes + clears `active` if it matched. Guard `typeof localStorage === "undefined"`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/layout-presets.ts lib/dashboard/layout-presets.test.ts
git commit -m "feat(dashboard): saved-layouts localStorage store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 5.2: `LayoutSection` UI (save/switch/delete/reset)

**Files:**
- Modify: `components/dashboard/grid/personalize/sections/layout-section.tsx`
- Modify: `lib/dashboard/use-dashboard.ts` (add `applyItems(items)` to replace `state.items` wholesale)
- Test: extend `personalize-pane.test.tsx`

**Interfaces:**
- Produces: `useDashboard().applyItems(items: GridItem[])` — replaces items, persists.

- [ ] **Step 1:** Add `applyItems` to `use-dashboard.ts`: `const applyItems = useCallback((items: GridItem[]) => persist({ ...state, items }), [persist, state]);` and return it.

- [ ] **Step 2: Write failing test** — on Layout tab, "Save current as" with a name calls `saveLayout`; clicking a saved layout calls `applyItems` with its items; "Reset Layout" calls `controller.reset`. (Mock the `layout-presets` module.)

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement `LayoutSection`:** name input + "Save current"; list of saved layouts (switch on click via `applyItems(switchLayout(...))`, delete button each); "Reset Layout" → `controller.reset()`. Also surface the existing arrange affordances note (pin/lock are widget-level via `⋯`; drag/resize active because this tab unlocks editing).

- [ ] **Step 5: Run tests + full suite + typecheck** — `npx vitest run` green; `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/grid/personalize/sections/layout-section.tsx lib/dashboard/use-dashboard.ts components/dashboard/grid/personalize/personalize-pane.test.tsx
git commit -m "feat(dashboard): saved-layouts UI (save/switch/delete/reset)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 5.3: Final integration pass + full verification

**Files:** none (verification + any fixups)

- [ ] **Step 1:** Run the full suite: `npx vitest run` → all green; `npx tsc --noEmit` → clean; `npx playwright test e2e/dashboard-grid.spec.ts e2e/dashboard-personalize.spec.ts` → green.
- [ ] **Step 2:** Manual smoke (`npm run dev`): open Personalize, exercise each tab — Layout drag + save/switch, Widgets add/remove, Theme preset swap + knobs, Density modes (incl. Minimal hiding widgets), Privacy levels. Confirm the pane floats (widgets don't shrink) and the selected widget scrolls clear.
- [ ] **Step 3:** Fix any regressions found; re-run the suite.
- [ ] **Step 4: Commit** any fixups with a clear message.

---

## Self-Review (completed against spec)

**Spec coverage:**
- §4.1/4.2 Layout vs Customize split → Tasks 1.2 (gating) + 1.3 (tabs). ✓
- §5 floating tabbed pane → Tasks 1.2 (float) + 1.3 (tabs) + 1.4 (auto-scroll). ✓
- §6 density modes (Calm/Balanced/Power/Minimal) → Phase 2 (2.1–2.4), Minimal essentials in 2.3. ✓
- §14 privacy (3 levels) → Phase 4 (4.1–4.3). ✓
- §18 themes (5 presets + appearance knobs) → Phase 3 (3.1–3.3). ✓
- Saved layouts → Phase 5 (5.1–5.2). ✓
- Non-destructive migration (no version bump) → Task 1.1. ✓
- Per-widget preset override preserved → Task 2.1/2.2 (`config.preset ?? baseline`). ✓
- Per-widget hover affordance (D7) → existing `⋯` `WidgetActions` reused; "Customize" routes to Widgets tab (Task 1.2 `onCustomizeWidget`). ✓

**Placeholder scan:** none — every code step carries real code or an exact pattern + file list.

**Type consistency:** `DensityModeId`/`PrivacyLevel` defined in `boards.ts` (1.1), imported by `density-modes.ts` (2.1) and `privacy.ts` (4.1); `PaneTab` defined in `personalize-pane.tsx` (1.3), imported by `page.tsx` (1.2); `appearanceVars`/`maskMoney`/`saveLayout`/`switchLayout`/`applyItems` signatures consistent across producer/consumer tasks.
