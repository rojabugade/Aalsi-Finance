# iOS Companion App — Design

**Date:** 2026-07-11
**Branch:** `feat-kshitij-ios-app` (based on `feat-kshitij-migrate-codename-missing`; `main` untouched)
**Toolchain:** Xcode 27.0 beta 2 (27A5209h), iOS 27 SDK, Swift 6, SwiftUI

## Goal

Native iOS companion for CodeName-Missing (Aalsi Finance). Talks to the existing
FastAPI backend over its JSON REST API. Apple-native look built on Liquid Glass:
glass tab bar, `glassEffect` surfaces, `GlassEffectContainer`, glass button styles,
scroll-edge effects, Swift Charts. Three fully working pages; the rest are polished
placeholders.

## Scope

**Fully working:**
1. **Home** — safe-to-spend hero (`GET /cashflow/summary`), net worth card
   (`GET /analytics/net-worth`), budget progress (`GET /budgets`), recent activity
   (`GET /transactions`, first N).
2. **Activity** — full transaction list grouped by date with search, status
   filter, detail sheet, and one-tap **confirm** for drafts
   (`POST /transactions/{id}/confirm`). Category names resolved via
   `GET /categories`.
3. **Insights** — Swift Charts: category share donut
   (`GET /analytics/breakdown?dimension=category`), monthly spend/income bars
   (`GET /analytics/timeseries`), top merchants (`breakdown?dimension=merchant`).

**Also working (infrastructure, not counted):** Login/Signup screen against
`/auth/login` and `/auth/signup`; Settings tab with server URL override, account
info, and logout.

**Placeholder:** Guidance tab (glass "coming soon" card describing the analyst).

## Architecture

```
ios/AalsiFinance/
  project.pbxproj  (file-system-synchronized groups — no per-file registration)
  AalsiFinance/
    App/          AalsiFinanceApp, RootView, AppSession (@Observable, @MainActor)
    Networking/   APIClient (actor), APIError, Keychain, ServerConfig
    Models/       Codable structs mirroring pydantic schemas
    Features/
      Auth/       LoginView
      Home/       HomeView + view model
      Activity/   ActivityView, TransactionDetailView + view model
      Insights/   InsightsView + view model
      Guidance/   GuidanceView (placeholder)
      Settings/   SettingsView
    Components/   glass cards, money text, status badges, empty states
```

- **Auth flow:** `POST /auth/login` returns `access_token` in body; refresh token
  arrives as a cookie *and* is accepted in the body of `/auth/refresh` (non-browser
  fallback; CSRF check skipped when no cookie — verified in
  `backend/app/auth/cookies.py:59`). The app disables URLSession cookie storage,
  captures the refresh token from `Set-Cookie`, stores it in the **Keychain**, and
  sends it in the refresh body. Access token lives in memory only. On 401 the
  APIClient refreshes once and retries.
- **Money decoding:** pydantic v2 serializes `Decimal` as JSON **string** (verified
  against the live OpenAPI schema). Swift models use a `Money` type decoding from
  string or number into `Decimal`.
- **Server URL:** defaults to `http://localhost:8000` (simulator hits the local
  docker backend); editable in Settings. ATS allows local networking only.
- **Concurrency:** Swift 6 language mode. `APIClient` is an actor; view models are
  `@MainActor @Observable`.

## Liquid Glass usage

- System glass tab bar (TabView) with tab-bar minimize on scroll.
- `.glassEffect(.regular.tint(...).interactive())` on the safe-to-spend hero and
  quick stats; `GlassEffectContainer` where glass elements cluster.
- `.buttonStyle(.glassProminent)` for primary actions (login, confirm draft).
- `scrollEdgeEffectStyle(.soft)` on content scroll views; standard navigation
  large titles; SF Symbols throughout; system semantic colors so dark mode is free.
- Content (lists, charts) stays on standard backgrounds — glass is reserved for
  the control/hero layer, per HIG.

## Error handling

- `APIError` distinguishes transport, decode, and HTTP status failures; FastAPI
  `detail` surfaced in alerts.
- Every screen has loading / error-with-retry / empty states.
- Session expiry (refresh fails) logs out cleanly to the login screen.

## Testing / verification

- `xcodebuild build` against the iPhone 17 Pro simulator must succeed.
- End-to-end against the live local backend with a `ios-demo@aalsi.local` account
  seeded via the API (signup + a few transactions), verifying login, all three
  working pages, and draft confirm.

## Out of scope

Plaid linking, document OCR/capture, push notifications, guidance chat, widgets,
household management, MFA enrollment (login with TOTP code field is supported).
