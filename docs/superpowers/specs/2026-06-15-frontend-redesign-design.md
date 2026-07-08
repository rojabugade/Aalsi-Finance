# Frontend Redesign — Spend-Centric IA + Desktop Shell

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan
**App:** CodeName-Finance (`web/`, Next.js App Router)

## Problem

User review of the current `web/` frontend found:

1. No desktop top navbar; desktop web app feels empty all over.
2. Home is mostly empty and not useful; charts are broken-ish.
3. Spend tab (`/transactions`) is thin — no category hierarchy, no subcategories, no merchant filters. Should be the most comprehensive surface.
4. Insights (`/analytics` + budgets/debt/income) is hard to understand.
5. Activity (`/notifications`) purpose is unclear.
6. Capture is in the wrong spot on desktop.
7. Reference apps: monarchmoney.com (categories, slice-and-dice reports, Sankey, zoom) and projectionlab.com (net worth, savings rate, Sankey cash flow, progressive complexity).
8. Desktop empty-feeling overall.
9. Merge Spend + Insights: spending insights must be reachable **from Spend itself**; bigger-picture analysis stays separate.

## Key facts (verified)

- Backend `Category` is hierarchical: `parent_id`, `kind` ∈ {category, subcategory, item_type}, `is_system`. ~81 system categories seeded (Food & Dining → Restaurants/Coffee Shops/Fast Food/Alcohol & Bars; Shopping → Clothing/Electronics/Home & Furniture/Hobbies; Health & Medical → Doctor/Pharmacy/Dental/Insurance; Transportation, Housing, Utilities, Groceries, Income, etc.).
- `/analytics/breakdown` already accepts dimensions: `category`, `subcategory`, `merchant`, `item_type`, `tag`, with a `filter` param and date range.
- `/analytics/timeseries` returns monthly spend/income/net.
- Merchants are seeded with aliases + default category (Amazon, Starbucks, Uber, Netflix, …).
- **Net worth has no real endpoint** — current shell shows a `$0` placeholder. This is the only new backend dependency; deferred (see Out of Scope).

Net: the comprehensive Spend tab and big-picture Insights are **almost entirely a frontend build** on existing endpoints.

## Decisions (locked with user)

| Area | Decision |
|------|----------|
| Spend ↔ Insights split | **A** — Spend = deep spending hub; Insights = big-picture/cross-cutting only. No overlap. |
| Insights scope | Big-picture hub: Net worth, cash-flow Sankey, Budgets, Debt, Income, Recurring. |
| Home | Command center (dense at-a-glance dashboard). |
| Desktop shell | Keep left rail **+ add top bar** (title · global search · period · +Add · profile). |
| Capture (desktop) | Top-bar **+Add** button → Receipt / CSV / Manual. Mobile keeps FAB. |
| Activity | Actionable feed (alerts, due bills/EMIs, review items), grouped by recency, each row deep-links. |
| Net worth | Deferred — labeled placeholder wired to a future endpoint; no faked numbers. |

## Information Architecture

Primary nav stays 4 tabs (bottom bar mobile / left rail desktop): **Home · Spend · Insights · Activity**.
Drawer unchanged: Guidance, Cross-border, Connections, Review, Settings.

`web/lib/shell/nav.ts` changes:
- Insights `match` drops `/transactions`-style spending routes; spending lives only under Spend.
- Spend (`/transactions`) gains internal view state (Categories / Merchants / Transactions) + drill routing.
- Top-bar definition added for desktop shell.

## Surfaces

### Spend (`/transactions`) — centerpiece
Approved wireframes: `.superpowers/brainstorm/.../spend-overview-v2.html` (L1) and `spend-drilldown-wireframe.html` (L2).

**L1 overview**
- Period selector (prev/next month, This month, vs last) + view toggle (Categories / Merchants / Transactions).
- **Sticky filter toolbar** (top): search (merchant/note) · Category · Account · Amount · Tags · Recurring · Export.
- **Insight strip**: Spent this month (+ MoM delta, daily avg, % income) · Top mover · Unusual spend · (uses breakdown + timeseries).
- **Spending-over-time** chart (monthly, zoomable).
- **Share-of-spend** donut.
- **By category** list: sorted by spend, MoM delta, magnitude bar, drills in.

**L2 drill (category → subcategory → merchant → transaction)**
- Breadcrumb back to Spend.
- Category header: total + MoM delta + **"What changed"** plain-language narrative.
- Category over-time chart.
- **Subcategories** list (drills further).
- **Top merchants** in category (visit counts).
- **Transactions** list. Active filters persist; clicking subcategory/merchant deepens the filter.

Same bento/section pattern recurses at each level. Data: `/analytics/breakdown` with the appropriate dimension + `filter`, `/analytics/timeseries`, `/transactions`.

### Insights (`/analytics`) — big-picture hub
Replace the raw breakdown table with clearly-labeled narrative sections (sub-tabs or stacked cards):
- **Net worth** (placeholder, deferred endpoint).
- **Cash flow** — Sankey (income → categories → savings) from timeseries + breakdown.
- **Budgets** — status vs actual (existing budgets data).
- **Debt** — payoff/loans (existing).
- **Income** — existing.
- **Recurring / subscriptions** — derived from merchant recurrence.
Each section opens with a one-line plain-language explanation of what it shows.

### Home (`/dashboard`) — command center
Bento dashboard, fix broken charts:
- Net worth tile (placeholder) · This-month cash flow · Budget status · Top movers / alerts · Recent activity · Quick actions (+Add, Ask your money).
- Reuse honest cash-flow data; no fabricated metrics.

### Activity (`/notifications`) — actionable feed
- Grouped feed: budget exceeded, unusual/large spend, bill/EMI due, items needing review or categorization.
- Grouped by recency; each row deep-links to the underlying transaction/budget/loan/review item.

### Desktop shell (`web/components/shell/`)
- Add a **top bar** in `app-shell.tsx` desktop branch: page title · global search · period selector · **+Add** menu (Receipt/CSV/Manual) · profile.
- Keep `DesktopRail`; remove the awkward mid-rail Capture entry (now in top bar).
- Widen content to multi-column bento so pages aren't sparse.
- Mobile shell unchanged (bottom bar + FAB for capture).

## Visual language
- Bento cards: 18px radius, soft layered shadow, hairline border, occasional tinted hero tile, varied tile sizes.
- Consistent insight strip + over-time chart + breakdown list pattern across Spend levels.
- Reuse existing `components/ui/*` (card, chart, row-list, segmented-pills, table) and theme tokens; extend rather than fork.

## Out of scope / deferred
- **Net worth endpoint** (accounts + balances model) — placeholder only this round.
- **Projections / scenarios** (ProjectionLab-style what-ifs) — future.
- Goals (already "coming soon").
- Backend changes beyond what existing endpoints already provide.

## Risks
- Net worth placeholder must read as intentionally-pending, not broken.
- Recurring/subscription detection has no dedicated endpoint — derive client-side from merchant cadence or defer the Recurring section if data is too thin.
- Sankey is a new chart type — verify the charting lib (or add one) before committing the Cash flow section.
