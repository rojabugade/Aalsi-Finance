# Spend drill push-navigation + context-aware analyst

Date: 2026-06-23
Branch: `feat/money-page-cashflow`
Status: design approved, ready for plan

## Problem

On `/transactions` (the Spend page) the category and merchant drills are each a
separate Radix Dialog slide-over that **overlays** the previous one. Drilling
two levels deep piles translucent sheets on top of each other. Two more gaps:

- **Sub-categories and in-drill transactions are not clickable** — you can see a
  subcategory or a transaction inside a drill but cannot open it.
- **The AI analyst is mounted only on the dashboard** and only knows the active
  date range. Open it while staring at "Home Depot" and it has no idea that is
  what you are looking at.

## Goals

1. Replace the stacked, overlapping drill sheets with a single panel that does
   iOS-style **push/pop navigation**: the current view slides left and dims, the
   next view slides in from the right; back pops one level.
2. Make sub-categories, top merchants, and transactions inside any drill
   **drillable**, pushing the appropriate next frame.
3. Give each transaction a clean, read-first **detail** frame (reusing the
   existing editor body) without a second overlapping sheet.
4. Mount the AI analyst on **every** page and make it **context-aware**: asking a
   question while viewing an entity scopes the answer to that entity.
5. Make the Spend **charts and insight cards interactive**: clicking a bar opens
   that bucket's transactions, a donut slice / legend row opens that category,
   and the "Top mover" / "Largest purchase" cards open that category /
   transaction — all pushing onto the same drill stack.

## Non-goals

- No per-level URL deep-linking beyond the existing root params (`?cat=`,
  `?merchant=`). Deeper frames live in component state.
- No redesign of the analyst pane's visual shell, tabs, or the Monitor feed.
- No change to the flat-ledger transaction editor behaviour (it keeps working).
- No new analyst capabilities beyond focus-scoping (no new action types, etc.).

## Current state (verified)

- `web/components/spend/drill-panel.tsx` — `DrillPanel`, a Radix Dialog
  slide-over (right sheet desktop / bottom sheet mobile) with back + close.
- `web/components/spend/category-drill.tsx` / `merchant-drill.tsx` — each renders
  drill content **and** owns its own nested `DrillPanel` + `useState` for the
  child drill. Subcategory rows and transaction rows are plain `div`s (not
  clickable). Top-merchant rows and "spending by category" rows are clickable.
- `web/app/(app)/transactions/page.tsx` — seeds the **root** drill from URL
  (`?cat=` / `?merchant=`) and renders two top-level `DrillPanel`s plus the flat
  `TransactionDetail`.
- `web/components/transactions/transaction-detail.tsx` — `TransactionDetail`
  wraps `ResponsiveSheet` around `DetailBody` (a full edit/split/confirm/delete
  form). Opened from the flat ledger via `setDetailId`.
- `web/components/dashboard/analyst/` — `AnalystProvider` (context),
  `AnalystBlob` (floating Sparkles FAB), `AnalystPane` (glass slide-in with
  Monitor/Explain/Plan/Action tabs), `ChatThread`. Mounted only in
  `app/(app)/dashboard/page.tsx`.
- `web/lib/api/analyst.ts` — `useAnalystAsk` posts `{mode, question, range_from,
  range_to}` to `/analyst/ask`. `ChatThread` builds that body.
- `backend/app/analyst/router.py` + `service.py` — `run_ask` builds a
  date-range-scoped `FinancialSnapshot` and calls the LLM; never raises (returns
  `available=false` on failure). `AnalystAskIn` = `{mode, question, range_from,
  range_to}`.
- Baseline: `tsc` clean, vitest 327/327.

## Design

### Part 1 — Drill navigation stack

Introduce a single navigation stack hosted by one outer `DrillPanel`.

**New `web/components/spend/drill-stack.tsx`**

- Frame model:
  ```ts
  type DrillFrame =
    | { kind: "category"; id: string }
    | { kind: "merchant"; name: string }
    | { kind: "transaction"; id: string }
    | { kind: "bucket"; from: string; to: string; label: string };
  ```
  The `bucket` frame is a transaction list for a date sub-range (a clicked
  chart bar).
- `DrillStack` owns `frames: DrillFrame[]` state and renders the outer
  `DrillPanel` (Radix Dialog) **once**. `open = frames.length > 0`.
- Renders the **top** frame's body. During a transition it briefly renders the
  outgoing frame too so the horizontal slide reads correctly:
  - push: incoming slides in from right (`translate-x-full → 0`), outgoing slides
    to `-translate-x-1/3` and dims.
  - pop: reverse.
  - Respect `prefers-reduced-motion` (no transform, instant swap).
- Provides navigation via React context:
  ```ts
  type DrillNav = {
    push: (frame: DrillFrame) => void;
    pop: () => void;
    depth: number;
  };
  ```
  `usePush()` / `useDrillNav()` consumed by frame bodies.
- Header wiring (reusing `DrillPanel`'s existing header):
  - **back** button: `depth > 1` pops one level (label = parent frame's title);
    `depth === 1` closes the panel (clears frames + clears root URL params).
  - **✕**: always clears the whole stack.
- Title/subtitle/backLabel for the visible frame are derived from the frame +
  shared `period`.

**Root seeding & URL.** The page keeps the root frame in the URL. `DrillStack`
takes an optional `rootFrame` derived from `?cat=` / `?merchant=`; when present
and the stack is empty, it seeds `frames = [rootFrame]`. Closing the last frame
clears those params (existing `closeDrill` logic moves into the stack's
`onOpenChange`). Pushes/pops beyond root do **not** touch the URL.

**Frame bodies become pure content.** Refactor:

- `category-drill.tsx` → export `CategoryDrillBody` that renders the existing
  content but:
  - **deletes** its own nested `DrillPanel` + `merchant` `useState`.
  - subcategory rows become buttons → `push({ kind: "category", id })`.
  - top-merchant rows → `push({ kind: "merchant", name })`.
  - transaction rows become buttons → `push({ kind: "transaction", id })`.
- `merchant-drill.tsx` → export `MerchantDrillBody`:
  - **deletes** its own nested `DrillPanel` + `catId` `useState`.
  - category rows → `push({ kind: "category", id })` (only real categories, as
    today).
  - transaction rows → `push({ kind: "transaction", id })`.
- A `transaction` frame renders the extracted detail body (Part 2).

`DrillStack` maps `frame.kind` → body component, passing shared
`{ txns, cats, currency, period }`.

### Part 2 — Drillable rows + transaction detail frame

- Extract `DetailBody` from `transaction-detail.tsx` into a reusable export (it
  already exists as an internal function — make it exported, e.g.
  `TransactionDetailBody`). `TransactionDetail` keeps wrapping it in
  `ResponsiveSheet` for the flat ledger; the drill stack renders it directly as a
  frame body (no inner sheet → no double overlay).
- The transaction frame’s `onClose` maps to `pop()` (after a successful
  save/confirm/delete the user returns to the parent drill).
- Layout stays read-first: status badge + fields visible, edit/confirm/split/
  delete controls grouped at the bottom (unchanged from today).

### Part 3 — Analyst everywhere + context-aware

**Mount globally.** Move the analyst mount (`AnalystProvider` + `AnalystBlob` +
`AnalystPane`, and the `onAction` handler) out of `dashboard/page.tsx` into the
app shell layout `web/app/(app)/layout.tsx` so the FAB appears on every
authenticated page. The dashboard-specific action handling stays usable; actions
that only make sense on the dashboard degrade gracefully off-dashboard (e.g.
`focus_widget` routes to `/dashboard`).

**Analyst focus store.** New `web/components/dashboard/analyst/focus.ts` (or
co-located) exposing a small context:
```ts
type AnalystFocus = {
  range: DateRange;
  focus?: { kind: "merchant" | "category"; label: string; id?: string };
};
```
- A `setFocus`/`clearFocus` API. Default `range` = global last-90-days; pages may
  override. The Spend page sets `range` from `useSpendPeriod`; the active drill
  frame sets `focus` to its entity (and clears on pop to root).
- `AnalystBlob` / `AnalystPane` read `range` from this store instead of a prop
  (dashboard sets it from its own date range — behaviour unchanged there).

**Ask scoping (frontend).** `ChatThread` and `useAnalystAsk` include the focus
when present:
```ts
ask.mutateAsync({
  mode, question, range_from, range_to,
  focus_kind, focus_label, focus_id,
});
```
Add an **"Ask about <label>"** button in the drill header that opens the pane in
`explain` mode with the focus pre-set.

**Ask scoping (backend).** Additive, non-breaking:
- `AnalystAskIn` gains optional `focus_kind: Literal["merchant","category"] |
  None`, `focus_label: str | None`, `focus_id: str | None`.
- In `run_ask`, when focus is present:
  1. Append a focus line to the user message
     (`"The user is currently viewing the {kind} '{label}'. Answer about it
     specifically."`).
  2. Attach a focused entity summary to the snapshot — the entity's spend this
     period, prev period, delta, and top sub-breakdown — computed from the same
     scoped queries the Spend derivations use. Keep it small.
- Failure stays non-fatal (`available=false`), as today. Greetings short-circuit
  unchanged.

The generated `@shared/api-schema` types are regenerated from the OpenAPI so the
new optional fields appear on `AnalystAskIn`.

### Part 4 — Interactive charts & insight cards

All chart/card clicks call `push(...)` from the `DrillNav` context, so they reuse
the same stack. Components stay presentational by taking optional click
callbacks; the Spend page wires them to `push`.

- **Spending-over-time bars** (`SpendBarsImpl`): add an `onBarClick(bar)` prop.
  To drill a bar we need its date range, so extend `SpendBar` to carry the
  bucket key: `{ label: string; value: number; key: string }` (populated by
  `spendSeries`). A new `bucketRange(key, granularity)` helper in `period.ts`
  maps a key → `{ from, to, label }`. Clicking a bar pushes
  `{ kind: "bucket", from, to, label }`. Recharts `<Bar onClick>` provides the
  datum. A hover tooltip already exists.
- **Share-of-spend donut + legend** (`ShareDonut` / `ShareDonutImpl`): add
  `onSliceClick(row)`. Slices/legend rows carry the `CatRow.id`; clicking a real
  category pushes `{ kind: "category", id }`. The rolled-up "Other" slice is not
  clickable.
- **Insight strip** (`InsightStrip`): add optional `onMover` and `onLargest`
  callbacks. "Top mover" → `push({ kind: "category", id: mover.id })`; "Largest
  purchase" → `push({ kind: "transaction", id: unusual.id })`. The hero "Spent
  this period" tile stays non-interactive. Cards with no target render as plain
  tiles (no button affordance).

The `bucket` frame body reuses a shared transaction-list rendering (the same row
list the existing drills already use), filtered to `[from, to]`, each row
pushing a transaction frame.

## Components & boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `DrillStack` | Owns frame stack, outer Dialog, slide animation, back/close, root↔URL | `DrillPanel`, frame bodies, `DrillNav` context |
| `DrillNav` context | `push`/`pop`/`depth` | — |
| `CategoryDrillBody` | Category content; rows call `push` | `DrillNav`, derive |
| `MerchantDrillBody` | Merchant content; rows call `push` | `DrillNav`, derive |
| `TransactionDetailBody` | Transaction read/edit; `onClose`→`pop` | transactions API |
| Analyst focus store | Page/drill-supplied `range` + `focus` | — |
| `run_ask` (backend) | Date + optional focus → snapshot → LLM | scoped_query, LLM |
| `bucketRange` (`period.ts`) | bucket key + granularity → `{from,to,label}` | — |
| Chart/card click props | Presentational components emit drill targets | `DrillNav` (via page) |

## Data flow

1. User clicks a category on the Spend page → URL `?cat=` set → `DrillStack`
   seeds `[category]` → panel opens.
2. Click a subcategory → `push(category)` → slide; click a merchant →
   `push(merchant)`; click a transaction → `push(transaction)`.
3. Back pops a level; ✕ closes; closing the last level clears `?cat=`/`?merchant=`.
4. "Ask about <label>" sets focus + opens the analyst pane → `ask` posts focus →
   backend scopes the snapshot → grounded answer.

## Error handling

- Drill: a frame whose entity no longer exists (deleted txn / category) renders a
  small "no longer available" body with a back action — never a crash.
- Analyst: unchanged fail-safe (`available=false`, never 5xx); missing/invalid
  focus is ignored server-side and falls back to the range-only snapshot.

## Testing

- `drill-stack` reducer/nav: push/pop/depth, back-at-root closes, root seeding
  from params, reduced-motion path (vitest + RTL).
- Refactored bodies: subcategory/merchant/transaction rows call `push` with the
  right frame (RTL click assertions).
- `TransactionDetailBody` renders standalone (no sheet) and `onClose` pops.
- Backend `run_ask`: focus present → focus line + entity summary in messages;
  focus absent → identical to today; invalid focus ignored; never raises
  (extend `backend/tests/test_m19_analyst.py`).
- `bucketRange`: day/week/month keys → correct inclusive ranges (unit).
- Chart/card clicks: bar click pushes a `bucket` frame with the right range;
  donut slice/legend click pushes the category; "Top mover"/"Largest purchase"
  push category/transaction; "Other" slice and hero tile are not clickable (RTL).
- Keep `tsc` clean and the full vitest suite green (327 baseline + new tests).

## Rollout / risk

- Frontend-only Parts 1–2; Part 3 adds two additive backend fields + a global
  mount. No migrations. No breaking API changes (new fields optional).
- The nested-`DrillPanel` deletions are the main refactor surface; covered by the
  body row-click tests.
