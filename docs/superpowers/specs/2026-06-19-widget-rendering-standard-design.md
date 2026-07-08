# Widget Rendering Standard & SDK — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design); rollout deferred to a separate implementation plan.
**Scope:** Define the contract that governs how every dashboard widget renders responsively, and the authoring SDK over it. This spec defines the standard only — it does **not** refactor the 11 existing widgets (that is a follow-up plan) and does **not** build the AI-generation path (slice J).

---

## 1. Problem

Every widget hand-rolls its own responsive logic, and the axes that should be independent are collapsed into a single `density` number. Concretely, observed in the codebase and reproduced live:

- `density = min(presetLevel, maxLevelForSize(w,h))` (`lib/dashboard/density.ts`). The default preset `standard` = level 1.
- The breakdown widget gates its donut **and** bars behind `density >= 2`. Therefore at the default preset, **no size** makes the donut/bars render — the Chart selector is dead unless the user also raises the preset. Verified by screenshot: identical 5×3 cell, `chart=donut`, renders a **list** at preset `standard` and a **donut** at preset `detailed`.
- Row counts are hardcoded (`Math.min(3, len)`, `Math.min(5, len)`) and only expand at `density >= 3`. They ignore available height, so tall widgets show a few rows with a dead band of empty space, and **resizing does not visibly change content**.
- There is no height-fill contract: low tiers leave empty vertical space.

This is a class of bug, not a single defect: 11 widgets each reimplement density branching, row caps, overflow, and fill. The fix is a shared rendering contract plus a thin authoring SDK.

## 2. Goals / Non-goals

**Goals**
- One arbitration rule for size vs preset vs explicit form, in a single shared function.
- Height-filling layout and height-derived row counts — content visibly responds to size.
- A small, typed, **serializable** Block vocabulary that covers all current widgets.
- A `defineWidget()` authoring surface so a new widget is *declared*, not hand-built.
- Blocks shaped as pure data so a future AI path (slice J) can emit and validate them without touching layout.

**Non-goals (explicitly out of scope for this spec)**
- Refactoring the existing 11 widgets — separate implementation plan.
- Building the AI emit / JSON-schema / validation / preview sandbox — slice J.
- Multi-currency, new data sources, or new widget *types*.
- Changing the grid engine, persistence, or controls UI.

## 3. The three axes

The standard separates one number into three independent inputs:

| Axis | Source | Role | Must NOT |
|------|--------|------|----------|
| **Capacity** | size `(w,h)` → `0..3` | Hard ceiling: what the cell can physically show | — |
| **Preset** | `compact / standard / detailed / analytical` → `0..3` | **Detail dial**: row budget, secondary stats, chart height | gate which *form* renders |
| **Form** | explicit `config.chart` (`donut / bars / list`) and `dimension` | Which representation the user picked | render when capacity forbids it |

**Capacity** keeps the existing thresholds (renamed conceptually from "max level"):

```
capacity(w,h): 1x1 -> 0 ; one axis >= 2 -> 1 ; 2x2 -> 2 ; w>=4 && h>=2 -> 3
```

## 4. Tier resolution (single source of truth)

A new pure function replaces scattered `density` branching:

```
resolveTier({ preset, w, h, form, supportedForms }) -> {
  kind: "stat" | "list" | "chart",
  form: "bars" | "donut" | "area" | null,   // the chart sub-type; null unless kind === "chart"
  rows: number,        // how many list rows to render (already capped to fit)
  extras: boolean,     // show secondary stats / legend / labels
  chartPx: number,     // chart height target when kind === "chart"
}
```

`kind` and `form` relate as: a plain list is `kind: "list"` (so `chart=list` resolves to `kind: "list"`); `kind: "chart"` always carries a non-null `form` of `bars | donut | area`.

```
```

**Rules (in order):**

1. If `preset === compact` **or** `capacity(w,h) === 0` → `{ kind: "stat" }`. This is the *only* case where intent forces minimal.
2. Otherwise determine the form: the explicit `form` if the user chose one and the widget supports it, else the widget's richest **default form the capacity allows**. A form renders when `capacity >= formThreshold` where `stat:0, list:1, bars:1, donut:2, area:2`. If the chosen form's threshold exceeds capacity (e.g. Donut at 1 cell tall), **fall back to the nearest fitting form** (list) — never blank, never silently ignore the pick.
3. `rows` and `extras` and `chartPx` are then tuned by **preset** within that form — preset never downgrades the form.

**Consequence:** an explicit Donut/Bars choice renders whenever the size allows, at any preset. The §1 bug is fixed by construction.

## 5. Vertical fill + row-capacity math

Two rules every widget obeys, eliminating dead bands and hardcoded `Math.min(3, len)`:

- **Fill.** `Body` is `flex h-full flex-col`. The primary metric is pinned top (`shrink-0`); the representation lives in a `flex-1 min-h-0` region that fills — charts stretch to `chartPx`/remaining space, lists render toward the bottom. No fixed-height tiers.
- **Rows from real height.** Shared pure helper:

  ```
  rowCapacity(w, h, cellH = 104, gap = 12, opts) =
    floor((bodyPx - primaryBlockPx) / ROW_PX)
    where bodyPx = h*cellH + (h-1)*gap - HEADER_CHROME_PX
  ```

  Constants are centralized (`HEADER_CHROME_PX ≈ 44`, `ROW_PX ≈ 22`, `primaryBlockPx ≈ 44`) and unit-tested. `resolveTier` returns `rows = min(config.count, rowCapacity(w,h), data.length)`. Worked sizes at cozy density: 5×2 → ~6 rows, 5×3 → ~11 rows. Resizing now changes content.

  *(Constants are derived from the cell model in `dashboard-grid.tsx`: `GAP=12`, `CELL_H.cozy=104`. The helper takes `cellH` so it tracks the compact/cozy/spacious setting.)*

## 6. Control semantics (documented precedence)

- **Representation:** `preset=compact → stat`; else explicit `form` (size-permitting) → default-by-capacity.
- **Row count:** `min(count, rowCapacity, len)`; preset sets a softer target within that.
- **Toggles (`show.*`):** field visibility *inside* a row/representation; never change the tier.
- **Range / dimension:** unchanged from today (data inputs, not layout).

## 7. The Block vocabulary (typed, serializable)

The renderer owns layout; authors return **Blocks** — pure data, no functions, JSON-serializable (the AI-readiness constraint). The vocabulary covers all 11 current widgets:

```ts
type Tone = "neutral" | "positive" | "warning" | "danger";

type Block =
  | { kind: "stat"; label: string; value: string; hint?: string; delta?: string; tone?: Tone }
  | { kind: "row"; label: string; value?: string; meta?: string; tone?: Tone;
      bar?: { pct: number; color?: string } }
  | { kind: "list"; rows: Extract<Block, { kind: "row" }>[] }      // renderer caps to tier.rows
  | { kind: "bars"; rows: { label: string; value: string; pct: number; color?: string }[] }
  | { kind: "donut"; slices: { label: string; value: string; pct: number; color?: string }[]; legend?: boolean }
  | { kind: "area"; points: number[] }
  | { kind: "section"; label: string; blocks: Block[] };           // grouping (Focus view)
```

Notes:
- A `list`'s rows are themselves `row` Blocks — so the whole tree is data. The renderer slices `rows` to `tier.rows` and renders the height-fill.
- `color` accepts CSS custom-property tokens (e.g. `var(--accent)`), keeping theming centralized.
- This is intentionally small. New block kinds are added deliberately, because each is a thing the AI path will be allowed to emit.

## 8. The SDK: `defineWidget()`

A widget is a declaration. The author writes the data binding and a per-tier view that returns Blocks — never `flex`, `overflow`, or density branches.

```ts
defineWidget<VM>({
  data: () => WidgetState<VM>,          // useX() + queryState (unchanged from today)
  insights?: (vm: VM) => Insight[],     // unchanged
  supportedForms?: Form[],              // e.g. ["donut","bars","list"]; omit for stat/list widgets
  view: {
    stat:  (vm: VM) => Block[];                 // tier.kind === "stat"
    list:  (vm: VM, tier: Tier) => Block[];     // tier.kind === "list"
    chart?: (vm: VM, tier: Tier) => Block[];    // tier.kind === "chart"; reads tier.form
  };
  focus?: (vm: VM) => Block[];          // the Focus modal; full detail, grouped via "section"
})
```

Runtime: `BaseWidget` calls `data()`, handles loading/empty/error/partial (unchanged), then `resolveTier(...)`, then `view[tier.kind](vm, tier)`, then the **scaffold** lays the Blocks out and fills height. `deriveInsights` and the Focus view are unchanged in spirit but now also return Blocks.

**Authoring a new widget** = a data hook + `select` → VM + a `view` map returning Blocks. Minutes, and impossible to produce broken responsiveness because layout isn't the author's job.

**AI-readiness (designed, not built):** because Blocks are pure data and the data sources/forms are a registered set, slice J can have an LLM emit a widget as JSON (a `view` of Blocks bound to a registered data source) and validate it against the Block schema. Layout safety is structural — the AI never emits layout. This spec only guarantees the seam; the emit/validate/sandbox path is slice J.

## 9. Worked example — breakdown widget under the standard

```ts
defineWidget<BreakdownVM>({
  data: () => queryState(useBreakdown(...), { select: breakdownVM, isEmpty }),
  insights: (vm) => [{ label: `${vm.top.label} ${vm.topPct}%`, tone: vm.topPct >= 40 ? "warning" : "neutral", severity: vm.topPct }],
  supportedForms: ["donut", "bars", "list"],
  view: {
    stat:  (vm) => [{ kind: "stat", label: "Top merchant", value: vm.top.label, hint: `${vm.topPct}% of spend` }],
    list:  (vm, t) => [{ kind: "list", rows: vm.rows.slice(0, t.rows).map(toRow) }],
    chart: (vm, t) =>
      t.form === "bars" ? [{ kind: "bars", rows: vm.rows.slice(0, t.rows).map(toBar) }]
      : [{ kind: "donut", slices: withOther(vm.rows, vm.total), legend: t.extras }],
  },
  focus: (vm) => [{ kind: "donut", slices: withOther(vm.rows.slice(0,8), vm.total), legend: true }],
});
```

At preset `standard`, `chart=donut`, 5×3: `resolveTier` → `{ kind: "chart", form: "donut", extras: true }` → the donut renders. The §1 bug cannot recur.

## 10. Testing strategy

Mirrors the existing pure-function test culture (`net-worth-widget.test.tsx`):

- `resolveTier` — table-driven tests across `{preset × capacity × form}` asserting `kind/form/rows`, including the fallback (Donut at h=1 → list) and the compact-forces-stat rule.
- `rowCapacity` — assert row counts at representative sizes/densities; assert monotonic growth with `h`.
- Block builders per widget — pure `vm -> Block[]` snapshot/shape tests (no rendering, no hook mocking).
- A scaffold render test (jsdom) per block kind for height-fill, plus one e2e screenshot check that the breakdown donut renders at default preset across sizes.

## 11. Rollout (deferred to the implementation plan)

Sequence the follow-up plan as: (1) build `resolveTier` + `rowCapacity` + Block types + scaffold with tests; (2) migrate widgets one per task to `defineWidget`, deleting bespoke density math; (3) delete `effectiveDensity`'s widget-facing use once all are migrated. Each widget migration is mechanical and independently testable. Per-widget mapping (current tier logic → standard tiers) is produced during planning.

## 12. Open items

- Exact `HEADER_CHROME_PX` / `ROW_PX` constants to be confirmed by measuring rendered widgets during implementation (spec gives working estimates).
- Whether `area`/`Sparkline` needs a width input or can rely on container width (lean: container width).
- Focus-view block grouping conventions (`section`) finalized when the first chart widget migrates.
