# M15 Frontend Rebuild — Progress Tracker

Spec: `docs/superpowers/specs/2026-06-14-m15-frontend-rebuild-design.md`
Plans: `docs/superpowers/plans/`

Product name: **CodeName-Finance** (placeholder). Cross-border is **one module**
under the Guidance surface (`/cross-border/*`), not a top-level concern.
**English only** — Hindi is not shipping; i18n machinery kept for future locales.

## Waves

- [x] **W0 Foundation** — stack wired, app shell, auth+MFA, PWA, i18n (en), typed client, Playwright.
- [x] **W1 Core money loop** — Dashboard, Capture (Dexie offline + sync), Review, Transactions + line items.
- [x] **W2** — Analytics (faceted breakdown + contribution), Budgets (create + track), Debt (loans, schedule, payoff calc + snowball/avalanche).
- [x] **W3** — Income/equity (sources, take-home, grants/events/summary); Guidance (cited ask, planning wizard, cross-border module: transfers + remittance limits).
- [x] **W4** — Notifications (list + mark-read, channel/quiet-hours prefs); Connections (Plaid link-token, Gmail OAuth/sync/disconnect, SMS token rotate/disconnect; bot on hold); Settings (private workspace preferences, base-currency/locale/language, consents, CSV/PDF export, account delete).

## Surfaces

| Surface | Status | Endpoints | Done when |
|---------|--------|-----------|-----------|
| Auth/Login | done | /auth/login, /auth/refresh, /auth/signup | login + MFA works, guard redirects |
| Dashboard | done | analytics/* | spend/income/net + cash-flow chart + top merchants + time filters |
| Capture | done | POST /documents, /documents/csv-mappings | Dexie offline queue + sync, camera/file upload, CSV mapping wizard |
| Review | done | /review-queue, /review-queue/{id}/resolve | confirm/discard low-confidence, raw extraction view |
| Transactions | done | /transactions/*, /categories | list/search/filter, drill-down + line items, edit/split/merge/confirm/delete |
| Analytics | done | analytics/breakdown | faceted breakdowns by 5 dimensions + contribution bars/table + range filter |
| Budgets | done | GET/POST /budgets, /categories | create budgets; per-budget spent/remaining progress, overspent flag |
| Debt | done | /loans/*, /loans/{id}/schedule, payoff-calc, payoff-strategy | loan list/create/delete, amortization schedule, payoff calculator, snowball/avalanche plan |
| Income | done | /income-sources, /income/take-home, /equity/* | sources list/create, take-home estimate dialog, equity summary + grants/events |
| Guidance | done | /guidance/ask+wizard, /cross-border/* | cited ask, wizard checklist/reminders, cross-border transfers + limits (cross-border = module here) |
| Notifications | done | /notifications/*, prefs | list + mark-read, channel toggles, quiet hours (web push informational) |
| Connections | done | /plaid/*, /email/*, /sms/* | Plaid link-token, Gmail OAuth/sync/disconnect, SMS token rotate/disconnect (bot on hold) |
| Settings | done | /workspace, /settings, /consents, /export, /account | private-workspace preferences, consents revoke, CSV/PDF export, account delete |

## W1 notes
- **Nav-shell 404 fix:** unbuilt surfaces (W2–W4) now ship `ComingSoon` placeholder
  pages inside the `(app)` group. Previously they were dead links → Next's root 404,
  which renders *outside* the layout and dropped the sidebar until a full reload.
- **Offline:** new Dexie engine in `lib/offline/` (db + sync + `useCaptureQueue` via
  `liveQuery`). Uploads go through a hand-built multipart fetch (openapi-fetch is
  awkward with `File`). Items are marked `syncing` then deleted on success → no dup.
- **Transactions filtering** is client-side; `GET /transactions` returns the full
  private-workspace set (no server query params).
- Legacy API helpers (`lib/api.ts`, `lib/offlineQueue.ts`) remain while rebuilt
  screens are validated.

## W2 notes
- Analytics breakdown is server-aggregated; the page sorts/limits client-side and computes
  contribution % from the returned row totals. `useBreakdown` now takes an optional `filter`.
- Budgets and loans expose no PATCH UI yet beyond create/delete (loans) — edit is a future pass.
- Payoff calc/strategy are POST endpoints driven as mutations on button click (no caching).

## W3 notes
- `dict` backend fields (take-home `estimates`, wizard `checklist`/`reminders`, limits rows)
  generate as `Record<string, never>` in TS; rendered generically via `KeyValues`/`DictList`
  in `components/guidance/citations.tsx` (cast to `Record<string, unknown>`), so the UI doesn't
  hard-code inner keys the backend may change.
- Ask/wizard hit the cross-border-specialised endpoints when the "Cross-border" toggle is on.
- Paystub ingestion UI (`POST /paystubs`) deferred — paystubs flow through Capture/OCR instead.
- Equity `vesting_schedule`/`est_tax` and transfer base-amount fields are accepted by the API
  but not surfaced in the create forms yet (future pass).

## W4 notes
- **No web-push backend:** there is no VAPID/subscription endpoint. The "push" channel toggle
  requests browser `Notification.requestPermission()` (best-effort) and records the preference,
  but no push is actually delivered yet.
- **Connections is action-driven** — no GET status endpoints exist. The page triggers the real
  ingestion flows and reports their result; in dev these often return `502`
  (`IntegrationUnavailable`) when the provider isn't configured, which the UI surfaces as a toast.
- **Plaid Link** is not completed in-app (would need the Plaid Link JS SDK, a new dependency).
  We only request/issue the link token.
- **Bot linking** stays on hold (M12) — informational card only.
- **Exports** download via a hand-built `fetch` (`downloadExport` in `lib/api/settings.ts`) because
  openapi-fetch is awkward with binary streams; CSV → `.zip`, PDF → `.pdf`.
- **Account delete** confirmation is validated server-side; the UI suggests `DELETE` but doesn't
  hard-code the exact phrase. On success it clears tokens and redirects to `/login`.
- Notification `payload` and preference `types` are opaque `dict`s — rendered via the W3
  `KeyValues` helper; inner keys are never indexed.

## Known blockers
- WebAuthn/passkey: backend endpoints unmounted (M2 deferral) — UI informational only.
- Bot linking: `/bot/link` unmounted (M12 on hold).

## Working test creds
- `dev@example.com` / `hunter2pass` (created via `/auth/signup`; `.local` domains are
  rejected by the backend's EmailStr validation, use a real-looking domain).
- No fixed DB seed user exists — users are created on demand via `/auth/signup`.

## W0 environment notes
- `@shared/*` alias resolves to repo-root `shared/`, which is bind-mounted into the
  web container at `/shared` (see docker-compose `web.volumes`). After `package.json`
  changes, `docker compose exec web npm install --legacy-peer-deps`.
- `shared/api-schema.ts` is generated (`npm run gen:api`) and gitignored per repo policy.
- shadcn is pinned to the classic 2.x line (Tailwind v3 + radix, "new-york"); do NOT
  run `shadcn@latest` (it switched to Tailwind v4 + base-ui).
- Run typecheck/build in the container; run Playwright on the host.
