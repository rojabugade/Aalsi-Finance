# iOS App UX Redesign — Design Spec

Date: 2026-07-12
Status: Approved direction (brainstorm 2026-07-11 → 2026-07-12)
Supersedes the UX portions of `2026-07-11-ios-app-design.md`; networking/auth/toolchain sections of that spec remain valid.

## Problem

The v1 iOS app (`ios/AalsiFinance`) is functionally correct but reads as "elements slapped on a canvas": every tab is a single vertical `ScrollView` of uniform cards, the Home tab is a pile with no hierarchy, and navigation mirrors neither the web app's depth nor how the user actually checks money on a phone. Goal: near-parity companion with a deliberate visual language, minimal vertical scrolling, and AI as the app's centerpiece.

## Design references

- Rocket Money: preview cards with strong hierarchy, upcoming-bills awareness, settings behind avatar.
- Money Manager: dense ledger, day-grouped transactions, month navigation.
- User-provided dashboard mockups (2026-07-12): dark theme, indigo/purple accent, AI forecast hero, sparkline stat tiles, day-relative upcoming rows, center-FAB-style nav emphasis.

## Information architecture

### Bottom nav (5 slots, AI centered)

| Slot | Tab | Content |
|------|-----|---------|
| 1 | Home | Dashboard (below) |
| 2 | Spending | Transactions, categories, merchants, recurring |
| 3 | **AI** — raised circular sparkle button, visually distinct | Brief, plan, cross-border, chat |
| 4 | Budgets | Budget rings + per-category detail, create/edit |
| 5 | Money | Net worth, debt, cards, income, investments |

Removed from nav: Settings (→ avatar sheet), Insights (content distributed: net-worth trends → Money, spend-vs-income → Spending, recommendations → AI + Home), Guidance (→ AI tab), global "+" (→ page-specific top-bar actions).

### Persistent chrome (every tab)

- **Top-left avatar** → profile & settings sheet (account, server config, appearance, sign out — current SettingsView content).
- **Top-right bell** with unread badge → notifications list (backend `notifications/monitor`, `alerts/{id}/acknowledge`).
- **Page-specific "+"** in top bar where relevant (Spending: quick-add transaction; Money: add loan/card/holding/income source).
- **Pill sub-nav** under each page title. First pill = the 99% view; the rest are niche. Implemented as one reusable component (horizontal scrollable pill row driving a paged content switch).

## Screens

### Home

Order, top to bottom (target: ≈1 viewport before Upcoming, everything drills in):

1. **Header**: "Good morning, Kshitij ✨" + subtitle, search, bell, avatar-left.
2. **AI forecast hero**: status line ("You're on track", teal), "You'll end July with ₹18,700 left" (large, indigo), delta vs plan ("₹8,200 ahead of your plan"), month-to-date balance curve with dashed projection to month-end + endpoint dot labeled with date. "See why ›" chip → breakdown sheet (income − recurring − EMIs − card minimums − discretionary, i.e. current SafeToSpendCard content relocated).
3. **AI summary strip**: `✦ AI summary | N insights | N actions ›` → opens AI tab's For-you page.
4. **Financial health** (3 tiles, horizontal): Cash flow (bar sparkline), Net worth (line sparkline, % delta), Debt left (progress bar, % paid → Money/Debt).
5. **Upcoming** (list card, max 3 rows + View all): merged feed of card minimum dues, loan EMIs, recurring subscriptions. Urgent row (due today) gets tinted icon + warning subtitle ("Today · avoid ₹750 late fee"). Rows deep-link to the owning entity. No pay actions.
6. **AI insights rail** (horizontal cards, max 3 + View all): from analyst `/recommendations`.

### Spending

Pills: **Activity** | Categories | Merchants | Recurring (mirrors web `new-spend.tsx` tabs; items/receipt drill deferred).

- Month bar: ‹ July ›, "Spent ₹42,300 · 128 txns", filter icon (type/category/account filters).
- Activity: day-grouped transaction list ("Today", "Yesterday", dates), category icon, name, category · time, signed colored amount. Row → existing TransactionDetailView.
- Categories: ranked list w/ share bars + period delta; drill → per-category transactions.
- Merchants: ranked list w/ delta; drill → per-merchant transactions + recurring flag.
- Recurring: recurring-series list, next-charge dates, monthly total.
- "+" quick-add sheet: amount, direction, category, merchant, date (posts to `/transactions`).

### AI (in-page title "Advisor")

Pills: **For you** | Plan | Cross-border | Chat.

- For you: "Today's brief" card (LLM one-paragraph summary: pace vs plan + the one action that matters today), insights list (recommendations + alerts).
- Plan: guidance plan items (`/guidance/plan-items`) as check/progress/pending steps; patch to complete.
- Cross-border: checklist, limits, transfers (read + wizard entry).
- Chat: analyst thread (`/ask`, thread messages). Persistent "Ask anything about your money…" input also docked on the For-you page.

### Budgets

- Overview: ring per budget (progress %, over-budget state), monthly totals.
- Detail: spent vs cap, txn list for the category, edit/delete.
- Create/edit sheet: category, amount, period (`/budgets` CRUD).

### Money

Pills: **Overview** | Debt | Cards | Income.

- Overview: net worth hero (value, % delta, trend line, assets/debts split — `analytics/net-worth`), debt payoff summary (progress bar + per-loan rows), cards row (per-card balance + utilization, due warnings), income & investments summary (take-home, SIPs, holdings value).
- Debt: loans list → loan detail (schedule, payments, payoff calc; `loans/*`). Payoff strategy entry (`/loans/payoff-strategy`, `/debt-plan`).
- Cards: payment methods/credit cards (`/credit-cards`, `/payment-methods`) → statement/due detail.
- Income: income sources, take-home breakdown, equity summary, holdings w/ valuations.

## Visual language

- **Dark-first**: near-black canvas (`#0E0E12`-equivalent via system backgrounds), elevated card surface, indigo/purple accent family (existing `.indigo` tint), teal for positive, coral/pink for negative/urgent, amber for warnings. Light mode derives from the same semantic roles; system-driven.
- Liquid Glass reserved for hero surfaces and the center AI tab button; flat elevated cards elsewhere. Avoid one-note card stacks: hero → tile grid → list card → horizontal rail per screen.
- Type scale: large rounded numerics for money (existing `MoneyText`), caption-heavy density elsewhere. Monospaced digits everywhere money changes.
- Charts: Swift Charts; sparklines are axis-less; forecast curve = solid history + dashed projection + endpoint dot.
- Components to build once and reuse: `PillNav`, `StatTile`, `SparklineChart`, `ProgressRing`, `UpcomingRow`, `InsightCard`, `SectionHeaderLink` ("View all ›"), `HeroCard`.

## Data mapping and gaps

Existing endpoints cover nearly everything: transactions/categories/tags/rules, budgets, cashflow summary, analytics (summary/breakdown/timeseries/net-worth), loans + schedules + payoff, credit cards, payment methods, recurring series, holdings + valuations, income sources + take-home, equity, guidance plan/ask/wizard, cross-border, analyst ask/thread/recommendations/memory, notifications monitor/acknowledge.

Client-side derivations (v1, no backend change):

1. **Forecast hero**: month-to-date daily leftover curve from `/transactions` + `cashflow/summary`; projection = leftover_monthly prorated by remaining days; "vs plan" delta = projected leftover vs budgets/guidance baseline. Curve smoothing client-side.
2. **Upcoming feed**: merge `recurring-series` next-charge dates + loan `schedule` next EMIs + card due dates; sort by date, window 14 days.
3. **Late-fee warning**: static copy from card metadata if present; otherwise omit (no invented numbers).

Backend nice-to-haves (later, optional): `GET /home/summary` aggregate to collapse Home's ~6 calls; `GET /cashflow/forecast` server-side projection; insights generation cadence. Not blockers.

Contract quirks (carry-over): Decimal-as-string, naive datetimes, monthly/quarterly/yearly timeseries only, refresh-token cookie lift.

## Error/loading/empty states

- Per-section skeletons shaped like final layout (hero, tile row, list) — no full-screen spinners.
- Section-level failure = inline retry card; rest of screen still renders.
- Empty states are invitations w/ deep links (e.g. no upcoming → "Link recurring bills in Money").
- Pull-to-refresh on every tab root; `Loadable` pattern retained.

## Build phases

1. **Phase 1 — Shell + Home + Money**: new tab bar w/ center AI button (placeholder page), persistent chrome (avatar sheet, bell, pill nav component), full Home, Money overview + debt + cards.
2. **Phase 2 — Spending + Budgets**: 4-pill Spending with drills + quick-add; Budgets rings + CRUD.
3. **Phase 3 — AI tab**: For-you brief, plan, cross-border, chat; Home hero "See why" + summary strip wiring to it.

Each phase independently shippable; existing screens stay functional until replaced.

## Testing

- Snapshot/preview coverage per new component (light/dark).
- ViewModel unit tests for derivations: forecast projection math, upcoming-feed merge/sort/windowing, utilization math.
- Simulator smoke via demo account (`ios.demo@example.com`) + `AALSI_INITIAL_TAB` hooks (extend enum to new tabs).
