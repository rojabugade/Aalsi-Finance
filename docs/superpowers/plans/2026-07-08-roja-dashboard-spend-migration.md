# Roja Dashboard and Spend Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the useful dashboard and Spend page behavior from `/Users/kshtj/CourseWork/Study/Projects/Alsi/Aalsi-Finance` into this Next.js app without regressing the existing configurable dashboard, Spend drill stack, analyst context, auth flow, or API-backed data model.

**Source surfaces:** The source app is a Vite/React single-page UI with hash tabs. Its dashboard is the `home` page in `apps/web/src/main.tsx`; its Spend surface is `SpendPage`, plus `QuickAdd`, `MerchantCard`, `ItemIntelligence`, and `RecurringIntelligence`.

**Target surfaces:** In this app, dashboard is `/dashboard` (`web/app/(app)/dashboard/page.tsx`) and Spend is `/transactions` (`web/app/(app)/transactions/page.tsx`). Spend already has analytics-backed category and merchant views, period controls, a drill stack, filters, CSV export, transaction details, and Playwright coverage.

**Legacy access requirement:** The migration must include a visible control that lets the user return to the old dashboard and old Spend page. This is a product requirement, not an optional fallback. The migrated dashboard must expose a "Classic dashboard" action; the migrated Spend page must expose a "Classic spend" action. Those actions should open target-native legacy routes that preserve the old page experience closely enough for comparison and escape-hatch usage.

**Migration rule:** Do not copy source files wholesale. Translate source behaviors into existing target primitives: App Router routes, TanStack Query hooks, `@/lib/spend/derive`, dashboard widgets/contracts, shell tabs, Tailwind tokens, and existing UI components.

**Branch:** `codex/roja-migrate-dashboard-spend`

## Findings From Inspection

- Source dashboard ideas worth migrating: compact "Today" summary, health score, reminder carousel, safe-to-spend/income/debt mini stats, latest activity, and next best action.
- Source Spend ideas worth migrating: inline manual transaction add, explicit merchant intelligence, item/product intelligence, recurring/fixed expense framing, and tab-level navigation for Transactions/Merchants/Items/Recurring.
- The user explicitly wants a button back into the old dashboard and old Spend page after migration.
- Target dashboard already has equivalent widgets for safe-to-spend, cashflow, budgets, recent activity, recurring, analyst alerts, net worth, debt, cards, and merchant/category breakdown.
- Target Spend already covers category drill, merchant drill, time series, donut, filters, transaction details, CSV export, and e2e tests.
- Important data-contract difference: the source treats expenses as positive `amount`; the target stores outflows as negative and derives positive spend through `spendAmount()`. Any new Spend derivation must reuse target helpers or account totals will be wrong.

## Risk-First Sequence

1. Build the thinnest end-to-end Spend slice first: add manual quick-add to `/transactions?view=all`, create a transaction through the existing target API, refresh the ledger, and prove totals still use `spendAmount()`.
2. Add read-only Item and Recurring Spend views next because they validate whether target data has enough `line_items` and recurring-series support. If not, scope becomes graceful empty states, not backend work.
3. Migrate dashboard composition last by reusing widgets/templates. The target dashboard is already higher-value than the source page, so the risk is visual churn, not missing data plumbing.

## Implementation Scope Note

- Migrated source behaviors as target-native components: classic dashboard/spend escape routes, Spend quick-add, merchant/items/recurring tabs, and source-style dashboard/spend summaries.
- Reused existing target contracts: `/transactions`, `/categories`, `/recurring-series`, `useCreateTransaction()`, `useRecurringSeries()`, `spendAmount()`, `merchantRowsWithDeltas()`, existing shell tabs, DrillStack, and dashboard grid.
- Enhanced rather than copied: source hash tabs became App Router query tabs; source positive expense entry is converted to target negative outflow amounts; item and recurring intelligence are derived from target transactions and recurring series.
- Intentionally skipped: source `/api/overview`, source auth/localStorage model, source CSS/sidebar/hash routing, source OCR instructions, and debt payoff duplication in Spend.

## Global Constraints

- No source API migration. Do not add the source `/api/overview` pattern.
- No dashboard grid rewrite.
- No replacement of the app shell, auth, or navigation model with source hash routing.
- No backend work unless a target API contract is missing after verification; prefer existing `/transactions`, `/categories`, `/recurring-series`, cashflow, widget, and analyst APIs.
- Preserve existing `/transactions` deep links: `?cat=`, `?merchant=`, and `?view=all`.
- Preserve old-page access through explicit legacy routes and buttons. Do not rely on browser history as the only way back.
- Keep new views accessible from shell top tabs and keyboard-navigable.
- Verify with focused unit tests plus Playwright where page behavior changes.

---

### Task 1: Source-to-target contract audit

**Files:**
- Read only: `web/app/(app)/dashboard/page.tsx`
- Read only: `web/app/(app)/transactions/page.tsx`
- Read only: `web/lib/spend/derive.ts`
- Read only: `web/lib/api/transactions.ts`
- Read only: `web/lib/api/widget-data.ts`
- Read only: `/Users/kshtj/CourseWork/Study/Projects/Alsi/Aalsi-Finance/apps/web/src/main.tsx`
- Read only: `/Users/kshtj/CourseWork/Study/Projects/Alsi/Aalsi-Finance/packages/shared/src/index.ts`

- [x] Confirm which source behaviors map to existing target features and mark them "reuse", "enhance", or "skip".
- [x] Confirm `TransactionCreate` required fields from generated schema before implementing quick add.
- [x] Confirm whether target transactions expose `line_items` consistently enough for item intelligence.
- [x] Confirm whether recurring data should come from `useRecurringSeries()` or heuristic recurring merchants.
- [x] Decide the exact legacy route names. Recommended: `/dashboard/classic` and `/transactions/classic`.
- [x] Decide whether classic pages are source-faithful React ports or target-native approximations using existing target data hooks. Recommended: target-native approximations to avoid source API/auth/CSS migration.
- [x] Record final scope in this plan before code edits.

**Acceptance:** A short implementation note exists in the PR summary explaining what is migrated, what is intentionally not copied, and why.

---

### Task 2: Legacy page escape hatch

**Files:**
- Create: `web/app/(app)/dashboard/classic/page.tsx`
- Create: `web/app/(app)/transactions/classic/page.tsx`
- Create: `web/components/dashboard/classic-dashboard.tsx`
- Create: `web/components/spend/classic-spend.tsx`
- Maybe create: `web/components/dashboard/classic-dashboard.test.tsx`
- Maybe create: `web/components/spend/classic-spend.test.tsx`
- Modify: `web/app/(app)/dashboard/page.tsx`
- Modify: `web/app/(app)/transactions/page.tsx`
- Modify: `web/e2e/spend.spec.ts`
- Modify: `web/e2e/dashboard-grid.spec.ts`

- [x] Add a visible "Classic dashboard" action on `/dashboard`.
- [x] Add a visible "Classic spend" action on `/transactions`.
- [x] Add a visible "Back to new dashboard" action on `/dashboard/classic`.
- [x] Add a visible "Back to new spend" action on `/transactions/classic`.
- [x] Implement classic pages as target-native ports of the source experience: use target hooks and types, but preserve the source page structure users care about.
- [x] Classic dashboard should include the source-style hero/health score, reminders, mini stats, latest activity, and next-best-action card.
- [x] Classic spend should include source-style transactions, merchants, items, and recurring sections.
- [x] Do not import source CSS wholesale. Use this app's tokens and components so classic routes remain maintainable.
- [x] Do not create a separate source API bridge or `/api/overview` clone.

**Verification:**
- [ ] `cd web && npm run typecheck`
- [ ] `cd web && npx vitest run components/dashboard/classic-dashboard.test.tsx components/spend/classic-spend.test.tsx` if component tests are added
- [ ] `cd web && npx playwright test e2e/spend.spec.ts e2e/dashboard-grid.spec.ts`

**Acceptance:** From the new dashboard and new Spend page, the user can click one button to enter the old-style page; from each old-style page, the user can click one button back to the new page.

---

### Task 3: Spend quick-add walking skeleton

**Files:**
- Modify: `web/app/(app)/transactions/page.tsx`
- Create: `web/components/spend/quick-add.tsx`
- Create: `web/components/spend/quick-add.test.tsx`
- Maybe modify: `web/e2e/spend.spec.ts`

- [x] Build a compact manual transaction form for the Spend flat ledger (`/transactions?view=all`) using existing UI controls and `useCreateTransaction()`.
- [x] Fields: amount, merchant, category, currency, date. Use target category ids, not source category strings.
- [x] Convert the user-entered positive expense amount to the target outflow convention before submit.
- [x] Show pending, success, and error states with existing toast or inline state patterns.
- [x] Invalidate/refetch transactions through the existing mutation hook.
- [x] Keep the form dense and operational; do not import source CSS or source layout classes.

**Verification:**
- [ ] `cd web && npm run typecheck`
- [ ] `cd web && npx vitest run components/spend/quick-add.test.tsx`
- [ ] `cd web && npx playwright test e2e/spend.spec.ts --grep "flat ledger"`

**Acceptance:** A user can add a transaction from Spend, see it in the ledger, and existing spend totals remain correctly signed.

---

### Task 4: Spend navigation parity

**Files:**
- Modify: `web/lib/shell/nav.ts`
- Modify: `web/app/(app)/transactions/page.tsx`
- Modify: `web/e2e/spend.spec.ts`

- [x] Expand Spend top tabs from `Categories` / `Transactions` to `Categories` / `Merchants` / `Transactions` / `Items` / `Recurring`.
- [x] Keep `Categories` as `/transactions`.
- [x] Keep `Transactions` as `/transactions?view=all`.
- [x] Add `Merchants` as `/transactions?view=merchants`, but render a stable page instead of redirecting away.
- [x] Add `Items` as `/transactions?view=items`.
- [x] Add `Recurring` as `/transactions?view=recurring`.
- [x] Preserve existing deep links for `?cat=` and `?merchant=`.

**Verification:**
- [ ] `cd web && npm run typecheck`
- [ ] `cd web && npx playwright test e2e/spend.spec.ts`

**Acceptance:** Spend tabs expose the same conceptual areas as the source Spend page while retaining target URL conventions.

---

### Task 5: Merchant intelligence view

**Files:**
- Modify: `web/app/(app)/transactions/page.tsx`
- Modify or reuse: `web/components/spend/merchant-list.tsx`
- Modify or reuse: `web/components/spend/merchant-drill.tsx`
- Maybe modify: `web/lib/spend/derive.ts`
- Add/modify tests near existing merchant tests.

- [x] Turn `?view=merchants` into a first-class merchant intelligence page using existing `merchantRowsWithDeltas()`.
- [x] Add search over merchant name and dominant category, matching the source `MerchantCard` behavior.
- [x] Show selected merchant detail through the existing `DrillStack`, not a separate hash route.
- [x] Surface source-equivalent details where data exists: purchases count, average spend, category split, top products, and transactions.
- [x] Reuse `topProductsForMerchant()` for line-item/product data.

**Verification:**
- [ ] `cd web && npm run typecheck`
- [ ] `cd web && npx vitest run components/spend/merchant-drill.test.tsx components/spend/merchant-list.test.tsx`
- [ ] `cd web && npx playwright test e2e/spend.spec.ts --grep "merchant"`

**Acceptance:** The merchant tab can be searched, opened, and inspected without losing period/filter context.

---

### Task 6: Item intelligence view

**Files:**
- Create: `web/components/spend/item-intelligence.tsx`
- Create: `web/components/spend/item-intelligence.test.tsx`
- Modify: `web/app/(app)/transactions/page.tsx`
- Maybe modify: `web/lib/spend/derive.ts`

- [x] Add derivation helpers for period-scoped line-item totals if existing helpers are not enough.
- [x] Render top item/product-type rows by amount, quantity, merchant, and category when `line_items` exist.
- [x] Provide a useful empty state when target data has no line items: point users to Capture/receipt import, not source OCR instructions.
- [x] Ensure item totals respect the active Spend period and target outflow/refund rules.

**Verification:**
- [ ] `cd web && npm run typecheck`
- [ ] `cd web && npx vitest run components/spend/item-intelligence.test.tsx`
- [ ] `cd web && npx playwright test e2e/spend.spec.ts --grep "items"`

**Acceptance:** `/transactions?view=items` gives source-style product intelligence when data exists and a correct empty state when it does not.

---

### Task 7: Recurring and fixed expense view

**Files:**
- Create: `web/components/spend/recurring-intelligence.tsx`
- Create: `web/components/spend/recurring-intelligence.test.tsx`
- Modify: `web/app/(app)/transactions/page.tsx`
- Maybe modify: `web/lib/spend/derive.ts`

- [x] Prefer `useRecurringSeries()` for canonical recurring data if the endpoint returns usable rows.
- [x] Fall back to the existing recurring-merchant heuristic only for display hints.
- [x] Render recurring/fixed obligations with cadence, amount, merchant/name, status, and next occurrence when available.
- [x] Link related rows to merchant drill or transaction detail where possible.
- [x] Keep debt payoff and loan details on `/debt`; do not duplicate the debt page.

**Verification:**
- [ ] `cd web && npm run typecheck`
- [ ] `cd web && npx vitest run components/spend/recurring-intelligence.test.tsx`
- [ ] `cd web && npx playwright test e2e/spend.spec.ts --grep "recurring"`

**Acceptance:** `/transactions?view=recurring` explains recurring spend/fixed expenses without inventing data or mixing in unrelated debt workflows.

---

### Task 8: Dashboard source ideas, target-native implementation

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`
- Maybe create: `web/components/dashboard/today-strip.tsx`
- Maybe create: `web/components/dashboard/today-strip.test.tsx`
- Maybe modify: `web/lib/dashboard/templates.ts`
- Maybe modify: `web/e2e/dashboard-grid.spec.ts`

- [x] Do not replace the configurable dashboard grid.
- [ ] Add source-inspired "Today" summary only if it can be backed by existing target hooks without new backend work.
- [ ] If implemented, keep it compact above the grid: money health score, safe-to-spend, income, debt, latest activity, and next best action.
- [ ] Reuse existing widget data hooks and analyst alert data where possible.
- [ ] Add or update a dashboard template that reflects the source dashboard's calm composition: safe-to-spend, cashflow, budgets, merchant/category breakdown, latest activity, recurring, and analyst alert.
- [x] Avoid importing the source display font, broad green theme, sidebar, or hash navigation.

**Verification:**
- [ ] `cd web && npm run typecheck`
- [ ] `cd web && npx vitest run components/dashboard/today-strip.test.tsx` if a new component is added
- [ ] `cd web && npx playwright test e2e/dashboard-grid.spec.ts`

**Acceptance:** `/dashboard` keeps personalization and grid behavior intact while gaining only the source ideas that improve the target page.

---

### Task 9: Visual pass and responsive QA

**Files:**
- Modify only files touched in prior tasks.

- [ ] Check desktop and mobile layouts for Spend tabs, quick add, item intelligence, recurring intelligence, and dashboard summary/template changes.
- [ ] Ensure no nested cards are introduced.
- [ ] Ensure text in tab labels and compact panels does not overflow on mobile.
- [ ] Keep operational density; this is a finance app, not a landing page.
- [ ] Verify color additions do not turn the app into a one-hue green clone of the source app.

**Verification:**
- [ ] Run Playwright against mobile and desktop projects if configured.
- [ ] Capture screenshots only if a visual issue needs debugging.

**Acceptance:** The migrated surfaces feel native to this app and remain usable on mobile.

---

### Task 10: Final verification

**Commands:**
- [ ] `cd web && npm run typecheck`
- [ ] `cd web && npm run test:unit -- --runInBand` if supported; otherwise run the touched Vitest files directly
- [ ] `cd web && npx playwright test e2e/spend.spec.ts e2e/dashboard-grid.spec.ts`

**Manual smoke:**
- [ ] `/dashboard`
- [ ] `/transactions`
- [ ] `/transactions?view=merchants`
- [ ] `/transactions?view=all`
- [ ] `/transactions?view=items`
- [ ] `/transactions?view=recurring`
- [ ] `/dashboard/classic`
- [ ] `/transactions/classic`
- [ ] Category drill, merchant drill, transaction detail, quick add submit, and CSV export.
- [ ] Classic dashboard button and classic Spend button, plus both back-to-new buttons.

## Re-plan Triggers

- Quick add cannot satisfy `TransactionCreate` without additional required backend fields.
- Target seeded data does not contain line items, making Item Intelligence mostly empty.
- `useRecurringSeries()` returns no usable data and heuristic recurring merchants are too weak for a page-level view.
- Dashboard summary requires several independent API calls and causes loading/error state complexity that outweighs the value.
- Existing Spend e2e tests fail due to URL/tab changes.

If any trigger fires, stop and re-scope before implementing later tasks.
