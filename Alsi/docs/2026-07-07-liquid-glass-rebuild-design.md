# Alsi — Liquid Glass Rebuild (design spec)

**Date:** 2026-07-07
**Status:** design approved, pending spec review
**Scope:** Ground-up rebuild of the Alsi iOS app on Apple's native Liquid Glass (iOS 27+), keeping the concept (native SwiftUI client for the CodeName-Missing finance backend) and rebuilding the architecture and design system properly.

---

## 1. Goals & non-goals

**Goals**
- Replace the hand-rolled "fake glass" (`Material` + overlays) with Apple's **native Liquid Glass** APIs.
- Delete custom chrome (`LiquidTabBar`, `AppHeader`) and let the system render glass tab bar / nav bar automatically, per Apple guidance.
- Fix the structural rot permanently: kill the half-migrated files and the `.pbxproj` that references deleted paths, using a file-system-synchronized project so file references never rot again.
- Re-architect into clear feature modules with modern state (`@Observable`), split the 583-line models file, secure the token in Keychain, and parallelize the snapshot fetch.
- Apply the **CAESAR** palette (black / burgundy / white) as a bold, luxe visual identity that showcases the glass material.
- Ship **Dashboard** and **Spend** as real, polished surfaces; **Insights** and **Plan** as honest "coming soon" placeholders.

**Non-goals**
- No back-compat below iOS 27 (no `if #available` fallback paths).
- No new backend endpoints; consume the existing API as-is.
- Not building Insights/Plan features in this cut.
- No offline cache / Dexie-equivalent persistence in this cut (snapshot is fetched live).

---

## 2. Platform & constraints

- **Minimum deployment target: iOS 27.0.** Native Liquid Glass APIs used directly, no fallback.
- **Language/UI:** Swift + SwiftUI, using the Observation framework (`@Observable`).
- **Testing:** Swift Testing (`import Testing`, `@Test`).
- **Backend contract (unchanged):**
  - Auth: `POST /auth/login` `{email, password}` → `{access_token}` (JWT bearer).
  - Snapshot endpoints: `GET /cashflow/summary?months=6`, `GET /transactions`, `GET /review-queue`, `GET /recurring-series?status=active`, `GET /budgets`, `GET /analytics/net-worth`.
  - Auth header: `Authorization: Bearer <token>`. `401` → sign out.
  - Base URL configurable, default `http://localhost:8000`.

---

## 3. Design system — native Liquid Glass

The governing principle (from Apple's *Adopting Liquid Glass*): **the system provides glass for free on standard components; custom glass is reserved for a few hero surfaces.** Over-applying glass or wrapping system components in custom materials is an explicit anti-pattern.

### What the system drives (no custom code)
- **Tab bar:** native `TabView { Tab(...) }` → floating Liquid Glass tab bar automatically. The old `LiquidTabBar` is deleted.
- **Navigation bar:** each tab is a `NavigationStack` with `.navigationTitle` + `.toolbar`; glass applied automatically. The old `AppHeader` is deleted.
- **Buttons:** `.buttonStyle(.glass)` and `.buttonStyle(.glassProminent)` instead of hand-rolled glass buttons.
- **Sheets (sign-in):** presented via `.sheet`; system provides the glass background — we add none.
- **Scroll legibility:** `.scrollEdgeEffectStyle(.automatic, for: .top)` so content lenses cleanly under bars.

### What we build as custom glass (reserved, ~1–2 per screen)
- Applied with `.glassEffect(.regular.tint(<wine>).interactive(), in: <shape>)`.
- Grouped inside a `GlassEffectContainer` for morphing + render performance.
- Fluid transitions via `glassEffectID(_:in:)` + a `@Namespace`.
- Concentric corners via `ConcentricRectangle` so nested rounding stays visually correct.
- Targets: the Dashboard **hero summary card** (net worth + cashflow) and a **floating filter/action pill** on Spend. Everything else uses plain surfaces over the backdrop.

### CAESAR palette (tokens)
Defined once in `DesignSystem/Theme.swift`. Derived tints/shades come only from the three anchors.

| Token | Value | Use |
|---|---|---|
| `ink` | `#000000` | app base |
| `inkRaised` | `#0B0708` | raised panels behind glass |
| `wineDeep` | `#47000F` | depth / shadow |
| `wine` | `#6D001A` | **brand anchor** |
| `wineLit` | `#A11235` | interactive, glass tint, active |
| `wineGlow` | `#D21F49` | glow, focus edge, negative figures |
| `bone` | `#FFFFFF` | primary text, hero figures, positive figures |
| `boneDim` | white @ 66% | secondary text |
| `boneFaint` | white @ 40% | tertiary / hints |

- **Backdrop** (`DesignSystem/Background.swift`): black base with burgundy radial blooms (top-lit oxblood) + subtle diagonal line texture. This is the colorful content the glass lenses. Replaces the teal/blue gradient.
- **Finance semantics:** gains = `bone`, losses = `wineGlow`, reinforced with ▲/▼. No green. (Revisit only if legibility demands it.)
- Dark-first; the app is effectively always dark (ink base). Respect Reduce Transparency / Reduce Motion via system behavior.

---

## 4. Architecture & module structure

```
Alsi/
  App/
    AlsiApp.swift          @main; injects FinanceStore into environment
    RootView.swift         TabView with Tab(home/spend/insights/plan); backdrop
  DesignSystem/
    Theme.swift            CAESAR tokens, tints, spacing/typography scale
    Background.swift       burgundy-bloom backdrop
    GlassSurfaces.swift    the few custom-glass wrappers (hero card, floating pill)
  Core/
    Networking/
      APIClient.swift      generic request<Body,Response>, URL building, error mapping
      FinanceService.swift endpoint methods + fetchSnapshot() via async let (parallel)
      APIError.swift       FinanceAPIError
    Auth/
      KeychainStore.swift  read/write/delete token in the Keychain
      AuthStore.swift      (folded into FinanceStore if thin) session state
    Models/
      Cashflow.swift  Transaction.swift  Budget.swift
      RecurringSeries.swift  NetWorth.swift  ReviewQueue.swift
      FinanceSnapshot.swift  (aggregate + .empty)
  Features/
    Dashboard/  DashboardView.swift + components (HeroSummaryCard, RecurringRow, ...)
    Spend/      SpendView.swift + components (TransactionRow, FilterPill, ...)
    Insights/   ComingSoonView.swift
    Plan/       ComingSoonView.swift
    Auth/       SignInSheet.swift
    Shared/     reusable cards/rows/state views (LoadingCard, ErrorCard, EmptyCard)
  docs/         this spec
```

### State
- Single `@Observable final class FinanceStore` owns: `phase` (`idle/loading/loaded/failed(String)/signedOut`), `snapshot`, `authError`, base URL, and token access (via `KeychainStore`).
- Injected with `.environment(...)`; screens read it with `@Environment(FinanceStore.self)`.
- Methods: `refreshIfNeeded()`, `refresh()`, `signIn(email:password:baseURL:)`, `signOut()`. Semantics match the current store; `401` clears the token and moves to `.signedOut`.

### Networking
- `APIClient` keeps the current generic request design (path joining, query, bearer header, status mapping) — it's sound. Cleanups: inject `URLSession` for testability; typed decode errors.
- `FinanceService.fetchSnapshot` runs the six GETs concurrently with `async let` and awaits all — same shape, faster, and one failure fails the snapshot (current behavior).

### Security upgrade
- JWT stored in **Keychain** (`kSecClassGenericPassword`), not `UserDefaults`. Base URL may stay in `UserDefaults` (non-secret).

---

## 5. Screens (first cut)

- **Dashboard** — `NavigationStack`, title "Home". Custom-glass **hero card** (net worth headline + cashflow in/out for the period) in a `GlassEffectContainer`; below it, recurring-series summary rows, budget progress, and a recent-transactions preview on plain raised surfaces. `.scrollEdgeEffectStyle` on top.
- **Spend** — `NavigationStack`, title "Spend". Transaction list grouped by category/date; a floating custom-glass **filter pill**; review-queue affordance surfacing items needing attention. Rows use bone/wine semantics for amounts.
- **Insights / Plan** — `ComingSoonView`: system glass, honest empty state, no fake data.
- **Sign in** — `.sheet` with email/password + base-URL field; `.buttonStyle(.glassProminent)` submit; system glass background. On success, store persists token to Keychain and refreshes.

### Per-screen states
Every data screen renders four states from `phase`: **loading** (skeleton/placeholder card), **empty** (no data yet), **error** (message + retry button), **content**. Signed-out surfaces prompt sign-in.

---

## 6. Project file (permanent `.pbxproj` fix)

- Regenerate the Xcode project using a **file-system-synchronized root group** (`PBXFileSystemSynchronizedRootGroup`, Xcode 16+): the project points at the `Alsi/` source folder and auto-includes every Swift file. No hand-maintained per-file references → the project cannot rot when files are added/moved/deleted.
- Deployment target set to iOS 27.0; a single app target + a unit-test target.
- Remove the nested `.git` inside `Alsi/` (not tracked; user request). Keep `.gitignore` (DerivedData etc.).

---

## 7. Testing & verification

- **Swift Testing** unit tests:
  - Model decoding for each domain model against representative JSON.
  - `APIClient` URL construction (base+path join, query, trailing slashes) and status→error mapping via a mock `URLProtocol`.
  - `fetchSnapshot` parallel fetch composes correctly and propagates a single failure.
- **Build verification:** `xcodebuild -scheme Alsi -destination 'generic/platform=iOS Simulator' build` must succeed before completion. (Confirm the CLI toolchain can build in this environment early; if it cannot, fall back to compile-checking sources and flag it.)

---

## 8. Reset / migration steps (high level)

1. Snapshot-preserve any code worth reusing (API client shape, model field mappings, glass token intent) — reference, not copy-paste.
2. Delete: nested `.git`, `.DerivedData`, old flat files, stale `App/Core/DesignSystem/Features` half-migration, broken `.pbxproj`.
3. Regenerate project (synchronized group, iOS 27, test target).
4. Build the module tree per §4.
5. Implement design system (Theme, Background, GlassSurfaces).
6. Implement Core (models, networking, keychain, store).
7. Implement screens (Dashboard, Spend, placeholders, sign-in).
8. Tests + `xcodebuild` verification.

---

## 9. Open questions / defaults taken

- **Gain/loss color:** defaulted to bone/wine, no green. Revisit if legibility suffers.
- **Git:** Alsi's own repo removed; spec lives in `Alsi/docs/`. Not committing into the parent backend repo unless asked.
- **AuthStore vs FinanceStore:** collapse into one `FinanceStore` unless auth logic grows enough to warrant separation.
