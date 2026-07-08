# Loan detail page redesign + "Neon Nights" theme — design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Branch:** `feat/debt-redesign-phase0`
**Builds on:** `2026-06-21-debt-experience-redesign-design.md` (routed loan detail at `/debt?loan=<id>`)

## Goal

Rebuild the routed loan **detail** page (`/debt?loan=<id>`) to the approved mockup: an
image hero with real stat strip + due status, a re-laid loan-details card, a payoff
comparison chart with an "optimize and save" panel, a scenario simulator + payment
history row, and the existing persistent AI Coach as a right rail. Add the mockup's
dark navy/violet look as a new **selectable, app-wide theme** ("Neon Nights").

Sidebar/global nav is out of scope — main content only.

## Non-negotiable: real data only

This redesign inherits the debt-experience principle: **never display a fabricated
figure or fact.** The mockup contains decorative elements with no backing field in
`LoanOut` — **lender name, loan number, asset subtitle ("2022 Tesla Model 3"),
"↓$50 since last month" delta, and the "refinance at 6.49% / save $418" card.** These
are **dropped**, not faked. Every value the page renders is real:

- **From `LoanOut`:** `name`, `type`, `schedule_kind`, `compounding`, `principal`,
  `currency`, `interest_rate`, `min_or_emi_amount`, `due_day`, `start_date`,
  `end_date`, `next_due_date`, `penalty_warning`, `outstanding_balance`,
  `total_paid`, `total_principal_paid`, `total_interest_paid`, `progress_pct`.
- **From endpoints:** payments (`useLoanPayments`), schedule (`useLoanSchedule`),
  payoff (`usePayoffCalc`), AI plan (`useDebtPlan` → `/analyst/debt-plan`).
- **Deterministic math:** `debt-math.amortize` / `savingsVsBaseline` for the comparison
  curves and savings. The LLM is never the source of a money figure.

The **hero image** is decorative (not a figure/fact), type-derived, and explicitly
requested by the user; it is allowed.

## Constraints & grounding

- **Tokens, never hex.** Reuse the established vocabulary (`bg-card`, `border-border`,
  `text-muted`, `bg-accent-soft`, `text-accent`, `rounded-card-sm`, `shadow-card`,
  `data-numeric`). The page must look correct in every theme, not just Neon Nights.
- **Routing unchanged:** `app/(app)/debt/page.tsx` already renders `<LoanDetailPage loan={selected} />` for `?loan=<id>`; only the component internals change.
- **Reuse, don't duplicate:** `components/debt/detail/sections.tsx`
  (`PaymentHistory`, `UpcomingSchedule`, `PayoffCalculator`, `EditSection`, `Metric`),
  `components/debt/overview/scenario-simulator.tsx` (`ScenarioSimulator`, accepts a
  loans array — pass `[loan]`), `components/debt/analyst/ai-coach.tsx` (`AiCoach`),
  `components/debt/debt-math.ts` (`amortize`, `savingsVsBaseline`, `num`),
  `components/ui/sheet.tsx`, the dynamic-chart pattern in `components/ui/area-chart.tsx`.
- Gate on `npm run typecheck` and `npm run test:unit`.

## Theme: "Neon Nights"

Registered like every other palette so it is app-wide and selectable.

- **`lib/theme/themes.ts`:** add `"midnight"` to `PALETTES`; extend `THEME_ID_PATTERN`;
  add `"midnight-dark"` to the bg-color map; add `midnight` to the accent map; add a
  `THEMES` row `{ palette: "midnight", name: "Neon Nights", modes: ["dark"], id: "midnight-dark" }`.
- **`app/globals.css`:** add a `[data-theme="midnight-dark"]` token block mapping the
  mockup palette onto the standard vars — navy-blue gradient `--app-bg`, violet
  `--accent` (~`#7c6cff`), deep-violet `--accent-soft`, slate `--muted`, `#121829`-ish
  `--card`, subtle `--border`, plus `--c2/--c3/--soft2/--soft3/--chip/--track`
  following the pattern of the other `-dark` blocks.
- **`lib/theme/themes.test.ts`:** add `"midnight"` to the palette-coverage assertion.

Internal palette key is `midnight`; user-facing name is **Neon Nights**.

## Components

### `detail/loan-images.ts`
`LOAN_IMAGES: Record<LoanType, string>` mapping each `type` to a stock image URL
(`auto` = the supplied pexels URL `https://images.pexels.com/photos/35592262/pexels-photo-35592262.jpeg`;
sensible stock for `home`/`education`/`personal`/`credit_card`/`other`). Export
`loanImage(loan): string` with a safe fallback. **This is the seam** where future
AI/asset-picked URLs (or a per-loan `image_url` field) slot in.

### `detail/loan-hero.tsx`
Full-width card, background image (`loanImage(loan)`) under a left-to-right dark
gradient for legibility.
- **Left overlay:** type-label badge (`Personal`, `Auto`, …); **Active** status pill
  when `outstanding_balance > 0`; big `loan.name`; buttons **Make a payment**
  (`onPay`) and **View statements** (`onViewStatements`).
- **Stat strip** (inset panel over image): Outstanding, APR (`interest_rate%`),
  Monthly (`min_or_emi_amount`), Payoff progress (`progress_pct` + thin bar). Each
  hidden/`—` if its field is null.
- **Due status** (sibling card, top-right of the hero row): derived — caught-up vs
  `Payment due {next_due_date}`; shows `penalty_warning` if present; "View schedule"
  fires `onViewSchedule`.

### `detail/loan-info-card.tsx` (restyle existing)
Same real rows, re-laid into the mockup's multi-column grid. Header "Edit details"
button fires `onEdit` (opens the slide-over).

### `detail/payoff-comparison.tsx` (+ `payoff-comparison-impl.tsx`)
Dynamic-loaded recharts (mirrors `area-chart.tsx`). Two lines over the loan's life:
**Current** (dashed, baseline min/EMI) and **Optimized** (solid `var(--accent)`,
baseline + `extra`), both from `amortize`. `extra` defaults to the real
`useDebtPlan().data.extra_monthly` (clamped sane), falling back to a small default if
the plan is unavailable. Side "Optimize and save" panel: **interest saved** and
**months earlier**, computed deterministically (difference of the two `amortize`
runs). Real numbers only; no "Apply to plan" mutation in this phase (informational).

### `detail/edit-loan-sheet.tsx`
Right-side `ui/sheet.tsx` (~half-width) wrapping the existing `EditSection`
(`LoanForm` + delete). Opened by the hero/details "Edit" controls. On save → close;
on delete → `router.push("/debt")`. Replaces today's full-page inline edit.

### `detail/loan-detail-page.tsx` (rewrite composition)
```
breadcrumb: ‹ Debt / {loan.name}
grid lg:grid-cols-[1fr_340px]
  main column (space-y):
    hero row:  <LoanHero> (2fr) | <DueStatus> (1fr)
    <LoanInfoCard onEdit=…>
    <PayoffComparison loan>
    row grid-cols-2:  <ScenarioSimulator loans={[loan]} …> | <PaymentHistory loan>
    <UpcomingSchedule loan>            # ref target for "View schedule"
  right rail (sticky):
    <AiCoach threadId={`loan:${loan.id}`} … />   # unchanged, chat-only
<EditLoanSheet open={editing} loan onClose />
```
"Make a payment" / "View statements" open or scroll to `PaymentHistory`; "View
schedule" scrolls to `UpcomingSchedule` (via refs).

## Testing

- `loan-detail-page.test.tsx`: renders breadcrumb, hero name + Active pill, stat strip
  values, AI coach rail; "Edit details" opens the sheet; delete routes to `/debt`.
- `loan-hero.test.tsx`: stat strip shows real fields, omits null ones; due-status
  caught-up vs due-date branch.
- `payoff-comparison.test.tsx`: savings/months derived from `amortize` (not the model);
  graceful when `useDebtPlan` is unavailable.
- `loan-images.test.ts`: `auto` → pexels URL; unknown type → fallback.
- `themes.test.ts`: `midnight` present in palette coverage.
- Reused sections keep their existing tests; mock loan hooks as in `sections.test.tsx`.

## Out of scope / future

- No backend fields added (lender, loan#, asset label, image_url) — flagged as a
  likely future enhancement; `loan-images.ts` is the seam for AI/asset-picked images.
- No "refinance rate" card (no rate data; would be fabricated).
- No "Apply to plan" write action from the comparison panel this phase.
