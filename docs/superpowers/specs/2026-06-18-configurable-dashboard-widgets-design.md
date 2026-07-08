# Configurable Dashboard Widgets — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan

## Goal

Make the customizable dashboard board genuinely *dynamic*: a curated, tighter set of
widgets where each widget is deeply configurable from the Personalize panel. Fix two
interaction defects (the edit panel occludes the board; the grid has no visible
lattice). Replace the hollow item-intelligence widget with a configurable Breakdown
widget that does merchant categorization by default.

This builds on the existing board engine (`web/lib/dashboard/*`, `web/components/dashboard/grid/*`)
shipped in commits d0de45e / 8a2920f / e9263cd. It does not change the grid geometry
engine (`grid.ts` collision/compaction); it extends the data model, registry, panel,
and canvas.

## Problems being solved

1. **Widgets are not dynamic.** Each widget only branches on size tier (sm/md/lg).
   There is no per-widget configuration of time range, metric, chart style, count, or
   which content elements are shown.
2. **"Quality over quantity."** Eight overlapping widgets, including a hollow
   item-intelligence widget. Curate to a tighter set of deeply-configurable widgets.
3. **Customize occludes the board.** `PersonalizeSheet` is a 340px opaque panel fixed
   to the right (`fixed right-0 z-50`). The canvas stays full-width underneath, so the
   right ~340px of widgets sit behind the panel — visible-occluded and unreachable. The
   board never reflows out of the way.
4. **"More grid."** In edit mode nothing draws the 4-col × N-row snap lattice, so
   dragging/resizing feels arbitrary.

## Decisions (locked with user)

- **Config depth = maximum**: range, metric/dimension, chart style, top-N, rename,
  per-widget accent, data filters, **and content-element toggles** (e.g. show dates on
  transactions, show/hide a chart).
- **Roster = curated tight set** with a configurable Breakdown widget that absorbs
  categories + merchant + item-type as a dimension toggle.
- **Settings live only in the Personalize panel.** No per-widget gear icon. In edit
  mode, clicking a widget on the canvas *selects* it; the panel swaps to that widget's
  controls.

## Architecture

### Data model — `web/lib/dashboard/grid.ts` + `boards.ts`

`GridItem` gains an optional `config` object. Geometry fields (`x/y/w/h`) are untouched.

```ts
export type WidgetConfig = {
  range?: "1m" | "3m" | "6m" | "1y" | "ytd";
  dimension?: "category" | "merchant"; // Breakdown only
  chart?: "donut" | "bars" | "list" | "area" | "none";
  count?: number;                       // top-N rows
  title?: string;                       // rename; falls back to def.title
  accent?: string | null;               // per-widget accent override
  show?: Record<string, boolean>;       // content toggles, widget-specific keys
  filter?: { category?: string };       // data filter (extensible)
};

export type GridItem = {
  id: string;
  type: WidgetType;
  x: number; y: number; w: number; h: number;
  config?: WidgetConfig;
};
```

`config` is persisted as part of `BoardState.items[]` by the existing layout-store —
no store changes beyond the version bump. **Bump `BOARD_VERSION` 1 → 2** so stale
saved layouts fall back to the new curated default board (the existing version-mismatch
path in `layout-store.ts` already handles this).

### Registry — `web/lib/dashboard/registry.tsx`

Each `WidgetDef` gains a declarative **`controls`** descriptor plus a **`defaults`**
config, so the Personalize panel can render the right knobs generically and each widget
can merge `config` over its defaults:

```ts
export type ControlKind = "range" | "dimension" | "chart" | "count" | "title" | "accent" | "filter";

export type WidgetControls = {
  fields: ControlKind[];                 // which generic controls apply
  charts?: WidgetConfig["chart"][];      // allowed chart styles for this widget
  dimensions?: WidgetConfig["dimension"][];
  countRange?: [min: number, max: number];
  toggles?: { key: string; label: string }[]; // populates `config.show`
};

export type WidgetDef = {
  title: string;
  icon: LucideIcon;
  defW: number; defH: number;
  variant?: "default" | "feature" | "ai";
  controls: WidgetControls;
  defaults: WidgetConfig;
  Component: ComponentType<WidgetProps>;
};
```

`WidgetProps` gains `config: WidgetConfig` (already-merged: `{ ...def.defaults, ...item.config }`).
A small helper `resolveConfig(item)` in the registry returns the merged config so the
canvas and the panel agree.

### Curated roster

`item-intel` is **removed**. `categories` is **superseded** by the new `breakdown`
widget. Final pool:

| type | title (default) | configurable knobs |
|------|-----------------|--------------------|
| `netWorth` | Net Worth | range; toggles: `chart`, `delta` |
| `safeToSpend` | Safe to Spend | range |
| `breakdown` ⭐ | Breakdown | dimension (category/merchant), range, chart (donut/bars/list), count; toggles: `legend`, `amounts` |
| `cashflow` | Cashflow | range, chart (bars/area); toggles: `in`, `out`, `net` |
| `budgets` | Budgets | count; toggles: `bars` |
| `recentActivity` | Recent Activity | count; toggles: `dates`, `category`, `amount` |
| `aiAlert` | Analyst Alert | toggles: `actions` |

All widgets additionally support `title` (rename) and `accent` (per-widget accent).

**Merchant categorization** is delivered by the Breakdown widget: the default board
seeds a `breakdown` instance with `config.dimension = "merchant"` and
`config.title = "Merchant Categorization"`. The dimension toggle lets the same widget
show category spend instead. Data comes from the existing
`useBreakdown(range, dimension)` hook (already supports `"merchant"` and `"category"`).
`item_type` is intentionally dropped (the item-intelligence wedge is hollow / unbuilt).

### Selection-aware Personalize panel — `personalize-sheet.tsx`

- `useDashboard` gains `selectedId: string | null`, `select(id | null)`, and
  `updateConfig(id, patch: Partial<WidgetConfig>)` (merges, persists via existing
  `mutateItems`-style write).
- Editing + a widget selected → panel header shows **"Editing: «title»"** with a
  controls block rendered from that widget's `controls` descriptor, above the existing
  global sections (Theme, Mode, Density, Radius, Transparency, Add widget, Visibility,
  Reset).
- Nothing selected → the global sections only (current behavior).
- Controls renderer maps each `ControlKind` to a small input:
  range → segmented; dimension → segmented; chart → segmented; count → stepper/slider
  bounded by `countRange`; title → text input; accent → swatch row (+ "default");
  filter → category select. Toggles render as a labeled switch list writing into
  `config.show`.

### Canvas — `dashboard-grid.tsx`

- **Select on click:** in edit mode, a pointer-down on a widget body (not the resize
  handle) calls `select(item.id)` in addition to starting a drag; the selected widget
  gets an accent ring. Clicking empty canvas clears selection.
- **Lattice overlay (#4):** when `editing`, render one `pointer-events-none` absolutely
  positioned layer behind the widgets drawing column dividers and row dividers at the
  exact snap pitch (`colW + GAP`, `cellH + GAP`), styled as subtle dashed
  `border-border` lines. Sized to the computed board height/cols already known to the
  component.
- **Per-widget accent:** the widget wrapper sets `--accent` to `config.accent` when set,
  so existing `var(--accent)` usages inside the widget recolor for free.

### Page — `page.tsx`

While `editing`, add right padding to the canvas wrapper (`pr-[352px]`, = 340px panel +
gap) so the board reflows fully to the left of the panel. The grid's existing
`ResizeObserver` recomputes `colW`, so every widget becomes reachable (#3). Clicking
"Done" removes the padding and clears `selectedId`.

### Widgets

Every widget signature changes from `({ w, h })` to `({ w, h, config })` and reads its
merged config:

- **NetWorthWidget** — `range` drives the hook window; `show.chart` gates the area
  chart; `show.delta` gates the delta line.
- **SafeToSpendWidget** — `range` drives the window.
- **BreakdownWidget** (new, replaces categories + item-intel) — reads
  `useBreakdown(presetRange(range), dimension)`; renders donut / bars / list per
  `chart`; `count` caps rows; `show.legend` / `show.amounts` gate elements. sm tier =
  CompactStat (top row). Title/icon adapt to dimension.
- **CashflowWidget** — `range` window; `chart` = bars|area; `show.in/out/net` gate the
  three figures.
- **BudgetsWidget** — `count` caps rows; `show.bars` gates progress bars.
- **RecentActivityWidget** — `count` caps rows; `show.dates` shows the txn date;
  `show.category` gates the category line; `show.amount` gates the amount.
- **AiAlertWidget** — `show.actions` gates the Adjust/Snooze buttons.

`item-intel-widget.tsx` and `categories-widget.tsx` are both deleted; a new
`breakdown-widget.tsx` is created as the single public surface (`breakdown` type) that
covers both category and merchant breakdowns via its dimension toggle.

## Data flow

1. `useDashboard(boardId)` loads `BoardState` (items now carry `config`) and exposes
   `selectedId`, `select`, `updateConfig` alongside existing actions.
2. Canvas renders each item; pointer-down selects (edit mode) and/or drags.
3. Panel reads `selectedId` → resolves the item + its `WidgetDef.controls` → renders
   inputs → `updateConfig` writes back → state persists to localStorage.
4. Each widget reads `resolveConfig(item)` and renders accordingly; data hooks are
   driven by `config.range` / `config.dimension`.

## Error handling

- Unknown widget `type` → frame returns null (existing behavior).
- Missing/partial `config` → `resolveConfig` fills from `def.defaults`; widgets never
  read raw `item.config` directly.
- Version mismatch / corrupt localStorage → existing fallback to default board.
- A `dimension`/`chart`/`count` value outside the descriptor's allowed set → panel only
  offers valid options; widgets clamp `count` to `countRange` and treat an unknown
  `chart` as the widget's default chart.

## Testing

- **Unit (Vitest):** extend `layout-store.test.ts` to round-trip an item with `config`;
  add a `resolveConfig` test (defaults merge, partial override, clamp). `grid.ts`
  geometry tests unchanged.
- **E2E (Playwright):** update `dashboard-grid.spec.ts` — enter edit mode, confirm the
  board reflows (no widget overlaps the panel), select a widget, change its range /
  dimension / a content toggle, confirm the widget re-renders and the choice persists
  across reload. Confirm the lattice overlay appears only in edit mode. Confirm the
  default board shows "Merchant Categorization" and no item-intelligence widget.

## Out of scope

- Server-side persistence (still localStorage).
- Extending config to other boards (Accounts/Transactions/etc.).
- New chart primitives beyond what the widgets already use.
- Reviving item-type / item-intelligence analytics.
```

