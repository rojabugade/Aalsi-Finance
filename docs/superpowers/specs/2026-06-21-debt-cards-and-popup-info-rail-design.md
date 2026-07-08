# Debt Cards Clarity + Popup Info Rail — Design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Branch:** `feat/debt-page-comprehensive`

## Problem

The rebuilt debt page (loan cards + detail popup) shipped, but user testing surfaced three issues:

1. **Cards look inconsistent** — cards in the same row render at different heights (the "Due soon" penalty chip pushes one taller), and the numbers aren't labeled.
2. **Wording is unclear** — "$400.40 of $400.40 principal" and bare "$500.00/mo" / "Due 2026-06-21" don't tell the user what each value *means*.
3. **No in-context help** — the user wants a small, collapsible info section on the right side of the popup that explains the terms and can also offer AI help.

## Goals

- Loan cards read clearly (every value has a label) and are visually consistent (equal height regardless of the penalty chip).
- The detail popup gains a collapsible right-side rail with a term glossary and an "ask the analyst" affordance.
- The upcoming-schedule section defaults to the next 3 installments, expanding to a paginated full list.

## Non-Goals

- No backend changes. All work is frontend; AI help reuses the existing `POST /analyst/ask` endpoint.
- No new AI endpoint, no loan-specific server context — the loan context is composed client-side into the free-text question.
- No change to other `ResponsiveSheet` consumers (the new `aside` is opt-in).

## Part 1 — Loan card (`web/app/(app)/debt/page.tsx`, `LoanCard`)

**Layout (top to bottom):**

```
[icon] Car Loan                 9% APR
       Personal
                                          ← spacer
REMAINING BALANCE
$400.40
0% paid · of $400.40
▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱
                                          ← mt-auto pushes footer down
MONTHLY          NEXT DUE
$500.00/mo       2026-06-21
⚠ Due soon                                ← reserved row (min-height)
```

**Requirements:**

- The card root (`<button>`) is `flex h-full flex-col` so grid stretch + `mt-auto` on the footer pin the footer to the bottom.
- Section labels use a small uppercase muted caption style (e.g. `text-[11px] uppercase tracking-wide text-muted`):
  - `REMAINING BALANCE` above the outstanding amount.
  - `MONTHLY` and `NEXT DUE` above their respective footer values.
- Sub-line under the balance reads `"{progress}% paid · of {principal}"` using existing `progress_pct` and `principal` (currency-formatted).
- The loan name renders with the `capitalize` utility class.
- The penalty chip lives in a **reserved footer row** with a fixed min-height so a card without `penalty_warning` reserves the same vertical space (cards in a row stay equal height). When absent, the row is empty but keeps its height.
- `MONTHLY` shows `"{min_or_emi_amount}/mo"` or `—` when null. `NEXT DUE` shows `next_due_date` or `—`.
- APR badge unchanged (top-right, `secondary` variant), shown only when `interest_rate != null`.

## Part 2 — Popup two-pane with collapsible rail

### `ResponsiveSheet` (`web/components/ui/responsive-sheet.tsx`)

Add an **optional** `aside?: React.ReactNode` prop. Behavior:

- **No `aside` (default):** unchanged — desktop 520px centered, mobile bottom drawer. (All current consumers.)
- **With `aside` on desktop:** content width becomes `w-[min(94vw,880px)]`; body is a `flex` row — left column `flex-1 overflow-y-auto` holds `children`, right column holds `aside` with a `border-l`. The header (title + close) spans the top.
- **With `aside` on mobile:** single column; `aside` renders **after** `children` inside the existing scroll area (stacked, no side-by-side).
- Desktop max-height + internal scroll already added (`max-h-[88vh] overflow-y-auto`); for the two-pane case each column scrolls independently within that cap.

Use the existing `useIsDesktop()` hook to branch.

### Loan detail (`web/components/debt/loan-detail.tsx`)

- `LoanDetail` passes an `<InfoRail loan={loan} />` as `aside` (only in the non-editing view; the edit view passes no aside).
- **Collapse:** `InfoRail` owns an `expanded` state.
  - Desktop collapsed: a thin (~44px) vertical strip with an ⓘ / chevron button to expand.
  - Desktop expanded: ~300px panel (the parent right column sizes to content; collapsed strip is narrow so the left content reclaims width).
  - Mobile: rendered as a `<details>` titled "Info & help" (native collapse); the `expanded` strip behavior is desktop-only.
- **Glossary** (static): short one-line definitions for Outstanding, Paid to date, Interest paid, Next due, Monthly, APR.
- **Ask the analyst:**
  - A small `<form>` with a text input (placeholder e.g. "Ask about this loan…") and a submit button, plus one or two suggested prompt chips (e.g. "How fast can I pay this off?").
  - On submit, call `useAnalystAsk()` with:
    - `mode: "explain"`
    - `question`: the user's text prefixed with a composed loan-context preamble (name, type, outstanding, principal, APR, monthly, next due) so the model has the numbers.
  - Render `data.answer` in a readable block. While pending, show a small loading state. On error, show "Couldn't reach the analyst."
  - If `data.available === false`, render a muted note: "AI help isn't configured yet." instead of an answer.
  - Suggestions returned by the API are dashboard-oriented (`create_widget`, etc.) and are **not** rendered here (out of scope).

## Part 3 — Upcoming schedule (`UpcomingSchedule` in `loan-detail.tsx`)

- Default (collapsed): show the **first 3** schedule rows, followed by a `Show all ({rows.length})` button.
- Expanded: show a paginated table, **12 rows per page**, with `Previous` / `Next` controls and an `{start}–{end} of {total}` indicator, plus a `Show less` control to return to the 3-row view.
- State: `expanded: boolean` and `page: number` (reset to 0 when collapsing). The schedule data is already fully loaded client-side via `useLoanSchedule`; pagination is pure client-side slicing.

## Components / boundaries

- `LoanCard` — presentational, props: `{ loan, onClick }`. No new deps.
- `ResponsiveSheet` — gains optional `aside`; default path byte-for-byte unchanged for existing callers.
- `InfoRail` (new, in `loan-detail.tsx` or a sibling file) — props `{ loan }`. Owns collapse + AI-ask state. Depends on `useAnalystAsk`.
- `UpcomingSchedule` — gains expand/paginate state; same props.

## Testing

- **Unit (vitest):**
  - A pure helper `loanContextPreamble(loan)` (composes the AI question preamble) — unit-tested for field inclusion and null handling. Keeping it pure makes the AI wiring testable without rendering.
  - Existing `loan-form` test stays green; full `npm run test:unit` must pass.
- **Static:** `npm run typecheck` clean.
- **Manual:** card heights equal with/without "Due soon"; popup rail collapses/expands on desktop and is a `<details>` on mobile; analyst ask renders an answer (or the not-configured note); upcoming schedule shows 3 then paginates.

## Risks

- Two-pane width on mid-size desktops: 880px cap + `94vw` guard keeps it on-screen; each column scrolls within `88vh`.
- `useAnalystAsk` lives under `components/dashboard/analyst/` conceptually but the hook is exported from `lib/api/analyst.ts` — importable from debt without coupling to dashboard UI.
