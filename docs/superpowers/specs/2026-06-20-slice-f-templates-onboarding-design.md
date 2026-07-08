# Slice F — Preset Templates + Onboarding

**Date:** 2026-06-20
**Status:** Approved (design)
**Roadmap slice:** F — templates + onboarding (`docs/superpowers/specs/2026-06-19-dashboard-widgets-roadmap.md`)
**Source vision:** `mockup images/widgets.md` §12 (Preset Dashboard Templates + AI Setup Flow)
**Blocked by:** B (controls), C (data widgets) — both shipped. G (AI Analyst) deferred; goal→board is deterministic, not LLM.

## Goal

Stop dropping new users on a generic default board. Give them a one-screen "what's your focus?"
onboarding that generates a goal-fit dashboard, and let any user re-pick a template later from the
Personalize pane. Templates select **which** widgets are on the board (a different axis from slice E's
density "feel" presets and saved layouts).

## Scope

In scope:
- 6 preset templates (pure data), each mapped to one onboarding goal.
- A deterministic builder that turns a template into `GridItem[]`.
- A first-run gate that opens an onboarding modal on the first dashboard visit.
- An onboarding modal (goal picker + skip + post-apply confirmation message).
- A shared `TemplateGallery` reused by the modal and the Layout tab.
- Integration into the existing Personalize pane Layout tab ("Start from a template" section).

Out of scope (explicitly deferred):
- LLM-generated boards / natural-language goal parsing → slice G.
- New widget types or backend → none needed; templates only compose existing pooled widgets.
- `BOARD_VERSION` change → none; templates call the existing `applySetup`.

## Architecture

The board engine, widget registry, and `useDashboard` controller already exist. Slice F adds a thin
data + UI layer on top. No engine changes.

### Reuses (verified present)
- `useDashboard(boardId).applySetup(items, prefs)` — wholesale replace items + merge prefs. The single
  mutation entry point for both onboarding and manual template application.
- `BOARDS.dashboard.pool` — every template widget type must be a member (guard test).
- `arrangeItems(items, specs)` pattern in `personalize-pane.tsx` — the id-generation + placement
  approach to follow when building `GridItem[]` from a template spec.
- Radix Dialog — same modal pattern as slice D Focus View.

## Components

### 1. `lib/dashboard/templates.ts` (pure data + builder)

```ts
export type TemplateId =
  | "starter" | "minimal" | "debt" | "creditCard" | "spending" | "netWorth";

export type TemplateSpec = { type: WidgetType; x: number; y: number; w: number; h: number; config?: WidgetConfig };

export type DashboardTemplate = {
  id: TemplateId;
  goal: string;          // onboarding modal label, e.g. "Pay off debt"
  name: string;          // template name, e.g. "Debt Payoff"
  description: string;   // one-line card subtitle
  icon: LucideIcon;
  blurb: string;         // post-apply confirmation message
  items: TemplateSpec[];
  prefs?: Partial<BoardPrefs>;
};

export const TEMPLATES: DashboardTemplate[] = [ /* 6 entries */ ];

/** Deterministic: template -> placed GridItems with fresh ids. */
export function itemsFromTemplate(t: DashboardTemplate): GridItem[];
```

Template → goal → widget mapping (from `widgets.md` §12; vision widget names mapped to existing types):

| Goal (modal label)    | id           | Template name     | Widgets (existing types)                                          |
|-----------------------|--------------|-------------------|-------------------------------------------------------------------|
| Understand my money   | `starter`    | Starter           | cashflow, recentActivity, budgets, recurring, aiAlert             |
| Keep it minimal       | `minimal`    | Minimal Money     | netWorth, cashflow, recurring, aiAlert                            |
| Pay off debt          | `debt`       | Debt Payoff       | debt, cashflow, budgets, creditCard, aiAlert                      |
| Manage credit cards   | `creditCard` | Credit Card       | creditCard, recentActivity, recurring, breakdown(merchant), aiAlert |
| Track spending        | `spending`   | Spending Tracker  | budgets, breakdown(merchant), recentActivity, recurring, cashflow |
| Build net worth       | `netWorth`   | Net Worth         | netWorth, cashflow, holdings, debt, aiAlert                       |

Notes on vision→type mapping: "Upcoming Bills" → `recurring`; "Top Alert"/"Analyst Alerts" → `aiAlert`;
"Investments" → `holdings`; "Merchant Spending" → `breakdown` with `config.dimension: "merchant"`.
Each template lays widgets out on the 10-col grid (`GRID_COLS`) at the default `5×2` size, packed top-down.

### 2. First-run gate

A localStorage flag, independent of the board store: `cf-onboarded:dashboard`.
- On the dashboard page mount: if `localStorage["cf-onboarded:dashboard"]` is absent → open the
  onboarding modal.
- The flag is set (value `"1"`) when the user **applies a template** or **skips**. Once set, the modal
  never auto-opens again.
- A tiny module wraps read/set so it is testable and SSR-safe (`typeof localStorage` guard), mirroring
  `layout-presets.ts`.

### 3. Onboarding modal — `components/dashboard/onboarding/onboarding-modal.tsx`

- Radix Dialog. Heading "What's your focus?" + short subtext.
- Body renders the shared `<TemplateGallery onPick={...} />` (goal-labeled cards).
- A **Skip** action (sets the flag, keeps the current default board, closes).
- On pick: `controller.applySetup(itemsFromTemplate(t), t.prefs ?? {})`, set the flag, close the modal,
  and surface `t.blurb` as a dismissible inline banner on the dashboard (a lightweight local state on the
  page, not a global toast system).

### 4. `TemplateGallery` — `components/dashboard/onboarding/template-gallery.tsx`

- Pure presentational: maps `TEMPLATES` to cards (icon, name/goal, description), `onPick(id)` callback,
  optional `selectedId` highlight. No store access — the caller owns application.
- Card styling follows the existing Layout-tab preset cards in `personalize-pane.tsx` (same border /
  accent-soft / Check affordances) for visual consistency.

### 5. Personalize pane — Layout tab integration

- Add a "Start from a template" section to the Layout panel (above the existing density "feel" presets),
  hosting `<TemplateGallery onPick={applyTemplate} />`.
- `applyTemplate(id)` here calls `controller.applySetup(itemsFromTemplate(t), t.prefs ?? {})` directly
  (board already exists; no first-run flag involved).

## Data flow

```
First visit:  page mount -> flag absent -> open modal
              pick goal  -> applySetup(itemsFromTemplate(t), t.prefs) -> set flag -> banner(blurb)
              skip       -> set flag -> default board kept

Later (pane): Layout tab -> TemplateGallery -> pick -> applySetup(...) (no flag)
```

## Error / edge handling

- SSR / no-localStorage: gate helper and `layout-presets`-style guards return safe defaults; modal never
  opens during SSR (page is `"use client"`, gate runs in an effect).
- Returning user with a saved board but no flag (pre-F users): the flag is absent, so the modal would
  open. Mitigation: on mount, if a saved board already exists (`cf-board:dashboard` present), treat as
  onboarded — set the flag without opening the modal. This protects existing customizations.
- Applying a template replaces all items (documented, matches saved-layout switch behavior). The user can
  still undo via Reset or by re-picking.

## Testing

- `templates.test.ts` (Vitest, pure-fn): every template's widget types ∈ `BOARDS.dashboard.pool`;
  `itemsFromTemplate` produces non-overlapping placements within `GRID_COLS`, fresh unique ids; all 6
  onboarding goals covered exactly once.
- `template-gallery.test.tsx`: renders 6 cards; `onPick` fires the right id.
- Gate unit test: absent flag → should-open true; present flag → false; saved board present → false +
  flag set.
- E2E (`e2e/`): clear storage → load dashboard → modal visible → pick "Pay off debt" → debt widget
  present, modal closed, blurb shown → reload → no modal.
- Full suite green (`tsc --noEmit` + `vitest run` + relevant Playwright spec). `next lint` is unavailable
  in this repo — do not use it.

## Files

New:
- `web/lib/dashboard/templates.ts` (+ `.test.ts`)
- `web/lib/dashboard/onboarding-gate.ts` (+ `.test.ts`)
- `web/components/dashboard/onboarding/template-gallery.tsx` (+ `.test.tsx`)
- `web/components/dashboard/onboarding/onboarding-modal.tsx`
- `web/e2e/dashboard-onboarding.spec.ts`

Modified:
- `web/app/(app)/dashboard/page.tsx` — mount gate + modal + blurb banner.
- `web/components/dashboard/grid/personalize/personalize-pane.tsx` — "Start from a template" section in
  the Layout panel.
