# Slice E — Personalization System — Design

**Date:** 2026-06-19
**Status:** Approved (design). Source vision: `mockup images/widgets.md` §4–6, §14, §18.
**Roadmap entry:** E — personalization depth (`2026-06-19-dashboard-widgets-roadmap.md`).
**Depends on:** Slice D (widget-system standard), Slice C (data widgets) — both shipped.
**Scope decision:** built as **one spec** covering all five personalization areas
(user opted not to decompose into sub-slices). The §5 sectioned pane is the
organizing backbone; each area is a well-bounded unit inside the single spec.

## Context

The dashboard already has personalization fragments, all crammed into one place:
`PersonalizeSheet` (`web/components/dashboard/grid/personalize-sheet.tsx`) is a single
non-modal glass panel that mixes **three** concerns — per-widget config, global grid
density (`compact/cozy/spacious`), and theme (palette/mode/accent). A single `editing:
boolean` in `app/(app)/dashboard/page.tsx` drives both "edit mode" (canvas draggable)
**and** the pane; while open the canvas is squeezed right by `pr-[360px]`.

`widgets.md` wants this deepened and restructured:

- **§4.1/4.2** — split **Layout Mode** (arrange only) from **Customize Mode** (settings),
  so users don't accidentally move widgets while changing settings.
- **§5** — the customize pane should be a **floating glass inspector** that does not
  permanently squeeze the canvas, organized into **tabbed sections**.
- **§6** — global **density modes**: Calm / Balanced / Power / Minimal.
- **§14** — **privacy modes**: Privacy / Presentation / Safe-Screenshot.
- **§18** — **theme presets** (5 named) plus appearance knobs (accent, radius,
  transparency, shadow/glow).

This slice delivers all of the above, and in doing so refactors the overgrown
`PersonalizeSheet` into focused per-section files.

## Goals

1. One **floating** personalization pane that never shrinks the widgets behind it.
2. A clear **Layout vs Customize** separation that prevents accidental widget moves.
3. Global **density modes** that set a baseline every widget can still override.
4. Five **named theme presets** + live **appearance knobs**.
5. Three escalating **privacy levels** applied across all widgets.
6. **Saved layouts**: name / switch / delete the current arrangement.

## Non-goals (explicitly out of scope)

- AI Analyst pane / tab — slice G. (A placeholder tab is *not* added; the pane has no
  AI section in E.)
- Seeded preset **boards/templates** (Daily View, Debt Payoff, Tax Prep) — slice F.
  E ships the saved-layout *mechanism*, not pre-baked boards.
- Any backend persistence. All personalization state is client-side `localStorage`,
  consistent with the existing layout-store v2.
- Per-widget customize *content* expansion (new config fields) beyond wiring existing
  config into the Widgets tab.

## Resolved decisions (from brainstorming)

| # | Decision |
|---|----------|
| D1 | **Mode model:** one entry point ("Personalize") opens a floating glass inspector. Drag/resize is **locked by default** and unlocked **only** while the **Layout** tab is active. Other tabs keep widgets pinned. No second top-level toggle. |
| D2 | **Floating pane:** drop `pr-[360px]`; the pane floats above the canvas (glass blur keeps widgets behind visible). The selected widget auto-scrolls clear of the pane if covered. Accepted tradeoff: the pane occludes the right column while open. |
| D3 | **Density mapping:** global mode sets a **baseline** content preset for all widgets + a matching grid density; per-widget `preset` still overrides. **Minimal** = Balanced baseline + hide non-essential widgets. |
| D4 | **Themes:** author all **5 named presets** as full token sets, kept **alongside** the existing 3 palettes; appearance knobs (accent/radius/glass/shadow) layer on top as user overrides. |
| D5 | **Privacy:** **one** control with escalating levels (Off / Privacy / Presentation / Safe-Screenshot), implemented via a global context + `<Private>` wrapper widgets consult. |
| D6 | **Saved layouts:** sibling `localStorage` store (not board state), user save/name/switch/delete; Reset = board default. |
| D7 | **Per-widget hover affordance:** while the pane is open, hovering a widget reveals a quick menu (extends the existing `⋯` `WidgetActions`) with quick toggles + "Customize" that focuses that widget in the Widgets tab. |

## Data model

All persisted client-side. `BoardPrefs` (`lib/dashboard/boards.ts`) already carries
`density`, `radius`, `glass`, `range`. Extend it:

```ts
export type BoardPrefs = {
  density: "compact" | "cozy" | "spacious"; // grid cell sizing (existing)
  range: RangePreset;                        // existing
  radius: number;                            // existing — appearance knob
  glass: number;                             // existing — appearance knob (transparency)
  // --- new in slice E ---
  densityMode: "calm" | "balanced" | "power" | "minimal"; // default "balanced"
  themePreset: ThemePresetId;   // default = current palette mapping
  accent: string | null;        // null = preset default
  shadow: number;               // 0..100 shadow/glow intensity
  privacy: "off" | "privacy" | "presentation" | "screenshot"; // default "off"
};
```

**Migration is non-destructive — `BOARD_VERSION` stays at 4 (no board wipe).** `loadBoard`
already fills missing prefs (`{ ...DEFAULT_PREFS, ...saved }`), so every new key lands on a
safe default without resetting saved layouts/customizations. The one semantic seam is the
old `prefs.density` (grid sizing) now also being driven by `densityMode`: to keep existing
boards feeling the same, `densityMode`'s default is **derived from the saved `prefs.density`**
(spacious→calm, cozy→balanced, compact→power) during the fill, rather than hardcoded. A
destructive version bump is deliberately avoided. (If a later, genuinely structural break is
discovered during implementation, bump then and call it out per the established gotcha.)

**Saved layouts** live in a separate store, *not* `BoardState`, to keep board state lean:

```ts
// lib/dashboard/layout-presets.ts  — localStorage key "cf-layouts:<boardId>"
type SavedLayout = { name: string; items: GridItem[]; savedAt: number };
type LayoutStore = { layouts: SavedLayout[]; active: string | null };
```

## Units

Each unit is one focused responsibility, its own file(s), independently testable.

### 1. Mode shell — `app/(app)/dashboard/page.tsx`

- Replace `editing: boolean` with `mode: "view" | "personalize"` plus `activeTab` state.
- Remove `pr-[360px]`; the pane floats (D2).
- Drag/resize enabled iff `mode === "personalize" && activeTab === "layout"` — passed to
  `DashboardGrid` as `editing`. All other tabs render the pane with widgets pinned.
- When the selected widget would be occluded by the pane, scroll it into the clear region.

### 2. `PersonalizePane` — refactor of `PersonalizeSheet`

- New `web/components/dashboard/grid/personalize/` directory:
  - `personalize-pane.tsx` — floating glass shell + tab strip + routing.
  - `sections/layout-section.tsx` — arrange tools: pin / lock / reset / saved layouts (unit 6).
  - `sections/widgets-section.tsx` — add/remove widgets + selected-widget config (moved from current sheet).
  - `sections/theme-section.tsx` — preset picker + light/dark + appearance knobs (unit 4).
  - `sections/density-section.tsx` — Calm/Balanced/Power/Minimal picker + grid density (unit 3).
  - `sections/privacy-section.tsx` — privacy level picker (unit 5).
  - `sections/advanced-section.tsx` — range default, reset-all, escape hatches.
- Tabs: **Layout · Widgets · Theme · Density · Privacy · Advanced** (no AI tab — non-goal).
- The old `personalize-sheet.tsx` is deleted once its logic is distributed.

### 3. Density modes — `lib/dashboard/density-modes.ts`

```ts
export const DENSITY_MODES = {
  calm:     { baselinePreset: "compact",  gridDensity: "spacious", essentialOnly: false },
  balanced: { baselinePreset: "standard", gridDensity: "cozy",     essentialOnly: false },
  power:    { baselinePreset: "analytical", gridDensity: "compact", essentialOnly: false },
  minimal:  { baselinePreset: "standard", gridDensity: "spacious", essentialOnly: true  },
} as const;
```

- `effectiveDensity` fallback changes from hardcoded `"standard"` to the mode baseline:
  callers pass `config.preset ?? DENSITY_MODES[mode].baselinePreset`. Per-widget preset
  still wins when set.
- Setting a density mode also sets `prefs.density` (grid sizing) to the mode's `gridDensity`.
- **Minimal**: registry `WidgetDef` gains `essential?: boolean`. Essentials = net worth,
  cashflow, recurring (upcoming bills), AI alert (top alert), recent activity (§6). In
  Minimal mode, non-essential widgets are hidden via a render-time filter (reversible — the
  items are not removed from the board, just not rendered).

### 4. Themes — `lib/theme/themes.ts` + `theme-section.tsx`

- Add 5 named presets as full token sets (CSS-var/class driven, matching the existing
  palette mechanism): **Dollar Bill Light**, **Liquid Glass Dark**, **Editorial Light**,
  **Neon Ledger**, **Soft Minimal**. Existing `emerald/indigo/ink` palettes are retained.
- Theme model becomes `ThemePresetId` (the 5 named + the 3 existing). Light/dark applies
  where the preset supports both; presets with a fixed mode (e.g. Liquid Glass Dark) lock it.
- Appearance knobs are live CSS vars on `<html>`: `--board-radius` (radius, existing),
  `--board-glass` (glass, existing), `--board-shadow` (new), `--accent` override (new).
  `accent: null` → preset default.
- `ThemeSection`: preset grid (swatches) → light/dark toggle → four knob sliders/pickers.

### 5. Privacy — `web/components/dashboard/privacy-provider.tsx`

- `PrivacyProvider` exposes `level` + helpers. `<Private kind="money|name|text">…</Private>`
  and `maskMoney(value, level)` are what widgets/format call.
- Level behavior:
  - `off` — passthrough.
  - `privacy` — blur money (CSS blur, **hover-to-reveal**), mask account/card names + txn descriptions.
  - `presentation` — privacy + hide exact balances/identifiers, keep charts; **no** hover-reveal.
  - `screenshot` — presentation + strip the pane itself and any remaining identifiers; no hover-reveal.
- Applied at the display layer; underlying data untouched. Widgets adopt `<Private>` around
  monetary stat values and name/description fields incrementally (the seven + four data widgets).

### 6. Saved layouts — `lib/dashboard/layout-presets.ts` + `layout-section.tsx`

- Pure reducer store over `localStorage`: `saveLayout(name)`, `switchLayout(name)`,
  `deleteLayout(name)`, `resetLayout()` (→ board default).
- `switchLayout` replaces `state.items` with the saved snapshot (configs preserved).
- `LayoutSection` UI: current saved layouts list, "Save current as…", switch, delete, reset.

## Cross-cutting

- **Migration:** non-destructive (no `BOARD_VERSION` bump); new prefs filled with defaults,
  `densityMode` derived from saved `prefs.density`. Guard test in `boards.test.ts` continues
  to assert every `WIDGETS` key is in the pool.
- **Privacy + Safe-Screenshot** must also suppress the personalize pane and any tooltips
  that leak values.
- **Density mode + per-widget preset**: the Widgets tab shows the effective baseline and
  marks a widget "overridden" when its `config.preset` differs from the mode baseline, with
  a "reset to mode" affordance.

## Testing

- **Vitest (pure fn):** `density-modes` mapping + `effectiveDensity` fallback; theme token /
  appearance-var resolution; `maskMoney` per level; `layout-presets` reducers (save/switch/
  delete/reset).
- **Component:** `PersonalizePane` tab routing + drag-gating (Layout unlocks, others lock);
  `<Private>` rendering per level; Minimal-mode essential filter.
- **Playwright e2e (`e2e/dashboard-grid.spec.ts` sibling):** enter Personalize → Layout tab
  drags a widget; switching to Theme locks drag; privacy blur visibly applied; theme preset
  swap changes tokens; save layout → switch → arrangement restored.
- Repo verification commands (lint is broken in this repo): `tsc --noEmit`, `vitest run`,
  `playwright test`.

## Open questions

None blocking. Seeded preset boards, AI tab, and backend sync are deferred by design
(non-goals above).
