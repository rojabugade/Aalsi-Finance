# M15 Frontend Rebuild — Design

**Date:** 2026-06-14
**Status:** Approved (design)
**Spec authority:** `FinanceApp_Build_Spec_v2.md` § M15

## Problem

The current frontend (`web/`) is a single 518-line monolith (`components/FinancePwaApp.tsx`)
that reaches all 11 feature surfaces but ships on bare `next` + `react` only. It is missing the
entire M15 stack: no Recharts, TanStack Query, shadcn/ui, Dexie, next-intl, or modern PWA
service worker, and uses a hand-written API client instead of a generated typed one. It is a
working demo shell (~40% of spec), not the product.

## Goal

Rebuild the frontend in place on the spec stack, as a routed component-based App Router app,
covering all 11 surfaces with a polished shadcn/ui design system, real charts, offline capture,
i18n (English + Hindi/Hinglish), and a generated typed API client — delivered in waves with a
committed progress tracker so the multi-session effort can be resumed cleanly.

## Decisions (locked)

- **Migration:** rebuild in place inside `web/`. Keep the Dockerfile, Next 15 App Router,
  Tailwind, and existing config. Replace the monolith incrementally; use its working API calls
  and offline logic as reference, then delete it once superseded.
- **API client:** generate from the live FastAPI `/openapi.json` using `openapi-typescript`
  (types) + `openapi-fetch` (typed fetch wrapper). A regen script writes output under `shared/`.
  Replace the hand-written `shared/api-types.ts`.
- **PWA:** `@serwist/next` (modern, App-Router-compatible). `next-pwa` is stale and rejected.
- **Design fidelity:** polished shadcn/ui theme + Recharts. "Layman UX": each screen leads with
  one clear takeaway; drill-downs are opt-in.
- **Scope:** all 11 surfaces are the target, built across waves W0–W4. Each wave becomes its own
  implementation plan.

## Stack

| Concern | Choice |
|---------|--------|
| Framework | Next.js 15 App Router (existing) |
| Styling | Tailwind (existing) + shadcn/ui (Radix, class-variance-authority, tailwind-merge, lucide-react) |
| Server state | TanStack Query (single QueryClient provider) |
| API client | openapi-typescript + openapi-fetch, generated from `/openapi.json` |
| Charts | Recharts |
| Offline | Dexie (capture queue + background sync) |
| PWA / SW | @serwist/next (offline shell, queued-capture sync, VAPID web-push registration) |
| i18n | next-intl (`en` + `hi`) |
| Auth | TOTP/MFA (existing endpoints). WebAuthn/passkey = informational only (backend deferred) |
| E2E tests | Playwright against the live Docker stack |

## Route structure

```
app/
  (auth)/
    login/                 # email+password, MFA challenge
  (app)/
    layout.tsx             # nav shell + providers
    dashboard/             # spend/income/net, top categories, trends, time filters
    capture/               # camera + file upload (offline via Dexie), CSV mapping wizard
    review/                # confirm/edit low-confidence extractions; link receipts to charges
    transactions/          # list/search/filter, edit/split/merge, tags, line-item drill-down
    analytics/             # faceted breakdowns (merchant/category/item/tag), contribution charts
    budgets/
    debt/                  # loans, schedules, payoff (snowball/avalanche)
    income/                # sources, paystubs, take-home, equity (grants/vests/ESPP/options)
    guidance/              # ask (cited, govt vs community), wizard, remittance tracker
    notifications/         # center + preferences
    connections/           # Plaid, Gmail, SMS token+guide, bot linking
    settings/              # private-workspace preferences, base currency, language, data controls (export/delete)
  providers.tsx            # QueryClientProvider + NextIntlClientProvider + theme
lib/
  api/                     # generated client + typed query hooks
  offline/                 # Dexie schema + sync engine
  i18n/                    # next-intl config + message catalogs
components/
  ui/                      # shadcn primitives
  <feature>/               # per-surface components
```

## Component boundaries

- **API layer (`lib/api`)** — one generated client; per-surface typed query/mutation hooks
  (e.g. `useTransactions`, `useCreateTransaction`). Consumers never call fetch directly.
- **Offline engine (`lib/offline`)** — Dexie tables for queued captures; a sync function that
  drains the queue when online and dedupes against server results. Single source of truth for
  offline state; surfaces subscribe via a hook.
- **Surface components** — each route owns its screen; reads server state via API hooks, never
  cross-imports another surface's internals. Shared primitives live in `components/ui`.
- **PWA (`@serwist/next`)** — service worker handles offline shell + background sync trigger +
  push display. Registration in a client component in the app shell.

Each unit answers: what it does, how it is used, what it depends on. Surfaces are independently
testable against the generated client.

## Build order (waves)

Each wave is a separate implementation plan. A wave is "done" when its surfaces build, typecheck,
pass Playwright smoke, and `REBUILD_PROGRESS.md` is updated.

- **W0 — Foundation:** install deps; shadcn init + theme; providers (Query + intl + theme);
  generated API client + regen script; app shell + nav; i18n scaffold (`en` complete, `hi` stub);
  PWA via serwist (offline shell, manifest already present); auth + MFA flow.
- **W1 — Core money loop:** Dashboard; Capture (offline Dexie + sync); Review queue;
  Transactions + line-item drill-down.
- **W2:** Analytics; Budgets; Debt.
- **W3:** Income/equity; Guidance (ask/wizard/transfers/limits).
- **W4:** Notifications + web push (VAPID); Connections (Plaid/Gmail/SMS/bot); Settings
  (export/consents/delete); complete the `hi` catalog across all surfaces.

## Endpoint mapping (per surface → backend)

- Dashboard/Analytics → M7 `analytics/*` (summary, breakdown, timeseries, recommendations)
- Capture → M4 documents (upload), M5 OCR enqueue
- Review → M5/M6 review-queue resolve
- Transactions → M6 `transactions/*`, line items
- Budgets → M7 budgets
- Debt → M8 `loans/*`, payoff strategy
- Income → M9 `income-sources`, `paystubs`, `equity/*`, `income/take-home`
- Guidance → M10 `guidance/ask`, `guidance/wizard`, `cross-border/*`
- Notifications → M13 `notifications/*`, preferences; web push VAPID
- Connections → M11 `plaid/*`, `email/*`, `sms/*`; bot (on hold — `/bot/link` unmounted)
- Settings → M2 private workspace/MFA, M16 `settings`, `export`, `consents`, `account`

## Continuation doc

`web/REBUILD_PROGRESS.md` — a committed checklist: per surface, its status (todo/in-progress/done),
endpoints consumed, and a one-line "done when". Updated as each wave lands. Mirrored to project
memory so a fresh session resumes from the tracker, not from re-discovery.

## Testing

- Gates per wave: `tsc --noEmit`, `next build`, Playwright E2E smoke per surface against the live
  Docker stack (api at `postgres:5432`).
- Acceptance (mirrors M15 "done when"): app installs to a phone home screen and desktop; captures
  a receipt offline and syncs without loss/duplication; every backend feature has a usable surface;
  works in English and Hindi/Hinglish.

## Known constraints / non-goals

- **WebAuthn/passkey:** backend endpoints not mounted (M2 deferral). Passkey UI is informational
  only; MFA stays TOTP. Revisit when backend lands.
- **Bot linking:** `/bot/link` not mounted (M12 on hold). Connections shows bot as on-hold.
- **No native apps** (PWA covers it, per spec).
- Charts read base-currency aggregates (M14).
