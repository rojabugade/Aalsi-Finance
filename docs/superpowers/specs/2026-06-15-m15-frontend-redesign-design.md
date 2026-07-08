# M15 Frontend Redesign — Design Spec

**Date:** 2026-06-15
**Status:** Approved direction (mockup signed off), pending spec review → implementation plan
**Supersedes the visual layer of:** `2026-06-14-m15-frontend-rebuild-design.md` (W0–W3 already shipped the data/API/feature plumbing; this redesign replaces the *presentation* layer only).
**Reference mockup (source of truth for look & values):** `docs/mockups/dashboard-palettes.html`
**Audience:** written to be executed by Codex. **Every visual/UX decision is locked below — Codex makes none.** The implementation plan (next step) will carry copy-paste file contents; this spec is the binding contract.

## 0. Codex guardrails (read first)

- **Make no design decisions.** Colors, spacing, radii, glyphs, animation timings, breakpoints, chart library, and file paths are all specified here or in the plan. If something seems unspecified, STOP and ask — do not improvise UI.
- **Do not touch** backend, API contracts, `web/lib/api/*` request logic, the Dexie offline engine (`web/lib/offline/*`), auth, or feature/business logic. This is presentation-layer only.
- **Token values are verbatim** from §4. Do not round, rename, or "improve" them.
- **Icons are lucide-react only. Never emoji.** Use the exact glyph mapping in §7.1.
- **No new dependencies** beyond those listed in §11.1. If a task seems to need one, ask.
- **Reuse existing primitives** in `web/components/ui/*` (shadcn/radix) under the new skin; do not re-implement dialogs/dropdowns from scratch.
- Run **typecheck + build in the `web` Docker container**; run **Playwright on the host**. Test creds `dev@example.com` / `hunter2pass`.
- Money fields arrive as **strings** — wrap in `Number()` for math, render via `formatCurrency`. Analytics endpoints require `from`/`to` query params.

## 1. Problem

The shipped UI is the stock shadcn/ui "new-york" dashboard with an emerald/gold recolor — generic stat-tile grids, no hierarchy, no point of view, a tacked-on serwist PWA. The app also has **12 surfaces**, so the core challenge is **information architecture**: what is most-accessible vs. less-but-easily-accessible. The previous flat sidebar+sheet nav couldn't carry that load.

## 2. Direction

**Soft-premium-fintech, phone-first, performance-conscious** (Copilot Money / Monarch lane), with an **X.com-style three-tier navigation** and **iOS-26 liquid-glass chrome**. Data and API layers are unchanged.

Non-goals: no backend/API/Dexie/auth/feature-behavior changes. No new locales (English-only). No blur/3D on content surfaces (perf). No redesign of the openapi-fetch client.

## 3. Information architecture (locked)

| Tier | Mechanism | Contents | Accessibility |
|------|-----------|----------|---------------|
| 1 | **Glass bottom bar** (4 tabs) | Home · Spend · Insights · Activity | most accessible, daily |
| 2 | **Floating ＋ FAB** (bottom-right) | Capture (camera / upload / CSV) | the one core write action |
| 3 | **Per-surface top tabs** | context switch within a surface | depth without new screens |
| 4 | **Left drawer** (tap avatar / swipe-right) | the long tail | one swipe away |

**Bottom bar (exactly these 4, in order):** Home, Spend, Insights, Activity.
**FAB:** ＋ Capture, bottom-right, above the bottom bar.
**Top tabs by surface (exact labels, first = default):**
- Home → `Overview · Goals`
- Spend → `All · Expenses · Income`
- Insights → `Analytics · Budgets · Debt · Income`
- Cross-border → `Transfers · Limits`
- Guidance → `Ask · Plan`
- (other surfaces have no top tabs)

**Drawer order (exact):** profile/household header (avatar, name, "Household · {currency} · {n} members", "Net worth {amount}") → Guidance, Cross-border, Connections, Review queue, Settings → footer: Appearance (3 palette swatches + light/dark) and Sign out.

**Differentiators:** Guidance & Cross-border appear BOTH as Home `FeatureCard`s and in the drawer (locked: Option 1). A Guidance bottom-tab is explicitly deferred (future one-line promotion).

**Header (every surface):** left avatar → opens drawer; center title; right bell → Activity.

### Surface map (all 12 — locked)

| Surface | Entry point | Top tabs | Key content |
|---------|-------------|----------|-------------|
| Dashboard | Bottom **Home** | Overview·Goals | immersive `HeroCard` (net cash flow) + 2 `FeatureCard`s + summary `RowList` (Income/Spending/Savings) + Top spending `CategoryRow`s |
| Transactions | Bottom **Spend** | All·Expenses·Income | search/filter; `RowList`; tap → `BottomSheet` drill-down w/ line items, edit/split/merge/confirm/delete |
| Analytics | Insights **Analytics** | (Insights tabs) | faceted breakdown (5 dims), contribution bars/table, range pills |
| Budgets | Insights **Budgets** | (Insights tabs) | create; per-budget spent/remaining progress, overspent flag |
| Debt | Insights **Debt** | (Insights tabs) | loan list/create/delete, amortization schedule, payoff calc, snowball/avalanche |
| Income | Insights **Income** | (Insights tabs) | sources list/create, take-home dialog, equity summary + grants/events |
| Capture | **FAB** | — | camera/file upload, CSV mapping wizard, Dexie offline queue states |
| Review | Drawer **Review queue** + Activity badge | — | confirm/discard low-confidence, raw extraction view |
| Guidance | Drawer + Home card | Ask·Plan | cited ask, planning wizard checklist/reminders |
| Cross-border | Drawer + Home card | Transfers·Limits | transfers list/create, remittance limits |
| Connections | Drawer **Connections** | — | Plaid/Gmail/SMS link flows (bot on hold) |
| Notifications | Bottom **Activity** | — | center + prefs (web-push wiring = follow-up task, §10) |
| Settings | Drawer **Settings** | — | account, security, consents, export, delete, appearance |

## 4. Theme system (verbatim tokens — do not alter)

Two independent axes, both persisted, no FOUC:
- **Palette:** `emerald | indigo | ink` · **Mode:** `light | dark` → 6 combinations.
- **Default: `indigo-light`** (changeable in Settings/drawer).

**Mechanics:**
- Define CSS custom properties on `<html>` keyed by `data-theme="{palette}-{mode}"` (e.g. `indigo-light`, `ink-dark`). One selector block per combo, values below.
- Persist `palette` and `mode` in a **cookie** (`cf-theme`), read in the root server component so SSR emits the correct `data-theme` — no flash. An inline `<head>` script also syncs from cookie before paint (belt-and-suspenders).
- Remove the existing 30-var "luxe" block and single-axis `next-themes` usage from `globals.css`. A small `ThemeProvider` (context + cookie writer) replaces it; `next-themes` may be dropped.
- `<meta name="theme-color">` + manifest `theme_color`/`background_color` track the active theme's `--app-bg`.

**Token contract (keys):** `--app-bg --fg --muted --accent --accent-soft --on-accent --c2 --soft2 --c3 --soft3 --card --border --card-shadow --chip --track --hero --hero-shadow --glass --glass-stroke --glass-hi`.

**`emerald-light`**
```
--app-bg:#eef3f0; --fg:#0c1f1a; --muted:#6a7d77; --accent:#0f9d76; --accent-soft:#dcf3ea; --on-accent:#fff;
--c2:#d98324; --soft2:#fbeede; --c3:#5b8def; --soft3:#e3edff; --card:#fff; --border:#e3ebe7;
--card-shadow:0 2px 10px -4px rgba(15,40,32,.1); --chip:#e3ebe7; --track:#e3ebe7;
--hero:linear-gradient(135deg,#0f9d76,#0b6e57 60%,#0a5546); --hero-shadow:0 16px 32px -12px rgba(11,110,87,.45);
--glass:rgba(238,243,240,.7); --glass-stroke:rgba(255,255,255,.7); --glass-hi:rgba(255,255,255,.8);
```
**`emerald-dark`**
```
--app-bg:#0b1512; --fg:#e8f3ee; --muted:#7e9991; --accent:#19c08e; --accent-soft:#14241e; --on-accent:#04130d;
--c2:#e0a44e; --soft2:#241c12; --c3:#6f9bff; --soft3:#16203a; --card:#111d18; --border:#1d2b26;
--card-shadow:none; --chip:#16221d; --track:#1e2c27;
--hero:linear-gradient(135deg,#0f9d76,#0a5e4a 60%,#073f33); --hero-shadow:0 16px 36px -16px rgba(0,0,0,.6);
--glass:rgba(13,22,19,.6); --glass-stroke:rgba(255,255,255,.08); --glass-hi:rgba(255,255,255,.06);
```
**`indigo-light`** (default)
```
--app-bg:#f1f1fa; --fg:#16132b; --muted:#716e8a; --accent:#6b5bf0; --accent-soft:#e7e3fd; --on-accent:#fff;
--c2:#e0653f; --soft2:#fce4dc; --c3:#1aa37a; --soft3:#d8f3ea; --card:#fff; --border:#ebe9f7;
--card-shadow:0 2px 12px -4px rgba(40,30,90,.12); --chip:#e7e4f7; --track:#ebe9f7;
--hero:linear-gradient(135deg,#7c6bf2,#5b46d6 58%,#4733b8); --hero-shadow:0 16px 36px -12px rgba(91,70,214,.45);
--glass:rgba(241,241,250,.7); --glass-stroke:rgba(255,255,255,.7); --glass-hi:rgba(255,255,255,.85);
```
**`indigo-dark`**
```
--app-bg:#0e0d16; --fg:#ece9fb; --muted:#8a86a6; --accent:#8b7bff; --accent-soft:#1f1b33; --on-accent:#0a0820;
--c2:#f0794f; --soft2:#2a1a14; --c3:#3fc79a; --soft3:#10241d; --card:#181527; --border:#262338;
--card-shadow:none; --chip:#1b1830; --track:#262338;
--hero:linear-gradient(135deg,#7c6bf2,#5238c4 58%,#3a2796); --hero-shadow:0 16px 36px -16px rgba(0,0,0,.6);
--glass:rgba(16,14,26,.62); --glass-stroke:rgba(255,255,255,.08); --glass-hi:rgba(255,255,255,.06);
```
**`ink-light`**
```
--app-bg:#f3f5f8; --fg:#0d0f14; --muted:#5d636f; --accent:#2f6bff; --accent-soft:#e4ecff; --on-accent:#fff;
--c2:#e0653f; --soft2:#fce3da; --c3:#19b48a; --soft3:#d6f4ea; --card:#fff; --border:#e7eaef;
--card-shadow:0 2px 10px -4px rgba(20,30,60,.1); --chip:#eaedf2; --track:#e7eaef;
--hero:linear-gradient(135deg,#2b3a63,#1c294a 60%,#141d36); --hero-shadow:0 16px 32px -14px rgba(20,30,60,.4);
--glass:rgba(243,245,248,.7); --glass-stroke:rgba(255,255,255,.7); --glass-hi:rgba(255,255,255,.85);
```
**`ink-dark`**
```
--app-bg:#0c0e12; --fg:#f1f4f8; --muted:#8a909c; --accent:#5b8cff; --accent-soft:#1a2336; --on-accent:#06122e;
--c2:#f0794f; --soft2:#2a1812; --c3:#2fd0a0; --soft3:#0c2620; --card:#15181f; --border:#20242e;
--card-shadow:none; --chip:#1a1e26; --track:#222732;
--hero:linear-gradient(135deg,#2b3a63,#16203a 60%,#11192e); --hero-shadow:0 16px 40px -16px rgba(0,0,0,.7);
--glass:rgba(12,14,18,.6); --glass-stroke:rgba(255,255,255,.08); --glass-hi:rgba(255,255,255,.06);
```
**Tailwind wiring:** extend `tailwind.config.ts` `theme.colors` to map semantic names to `var(--…)` (e.g. `bg:'var(--app-bg)'`, `fg:'var(--fg)'`, `accent:'var(--accent)'`, …) so utilities like `bg-card text-fg border-border` resolve per theme. Category accents available as `c2/soft2/c3/soft3`.

## 5. Visual language (locked values)

- **Font:** Inter (already wired). Headings tracking `-0.02em`; all figures `font-variant-numeric: tabular-nums`.
- **Radii:** cards `20–24px` (rounded-[20px]/[24px]); chips/icons `11–12px`; bars/sheets `22px`; FAB `18px`; pill/full `999px`.
- **Hero:** `background: var(--hero)`, `box-shadow: var(--hero-shadow)`, white text; bleeds under the glass top bar; big number `32px/800`, delta pill on `rgba(255,255,255,.2)`, inline SVG area chart `height:80px`.
- **List-row** = primary content + nav primitive: circular tinted icon chip (38px, `bg var(--accent-soft)`/`--soft2`/`--soft3`, icon in matching `--accent`/`--c2`/`--c3`) + label + sub + value/bar + chevron.
- **Liquid glass — chrome only** (top bar, bottom bar, drawer): `background: var(--glass)`, `backdrop-filter: blur(22px) saturate(180%)` (+ `-webkit-`), `border: 1px solid var(--glass-stroke)`, `box-shadow: inset 0 1px 0 var(--glass-hi)`. **Never** apply to content/scroll areas.
- **Bottom bar:** floating, `left/right:14px; bottom:14px; height:64px; border-radius:22px`. **FAB:** `right:18px; bottom:96px; 54×54; radius:18px; bg var(--accent); color var(--on-accent)`.
- **Light = soft shadows (`--card-shadow`); dark = hairline borders (`--border`, shadow none).**

## 6. Motion (locked)

- **Drawer (X-style):** main `.window` → `transform: translateX(76%) scale(.84); filter: blur(3px) brightness(.62); border-radius:30px` with `box-shadow:-24px 0 60px rgba(0,0,0,.45)`. Drawer behind: rest `translateX(-14%) opacity(.4)` → open `translateX(0) opacity(1)`. Easing `cubic-bezier(.32,.72,0,1)`, **420ms**. Open by avatar tap or swipe-right; close by tapping the dimmed window or swipe-left.
- Spring micro-interactions, count-up on hero/KPI figures, skeleton→content fade, sheet slide-up, top-tab underline slide (34px×3px `var(--accent)`), route fade/slide.
- **All motion gated behind `prefers-reduced-motion: reduce`** (instant state, no transform/opacity transitions). Transform/opacity/filter only.

## 7. Component inventory + icon map

New primitives in `web/components/shell/*` and `web/components/ui/*` (shadcn/radix stays underneath for a11y):
`AppShell`, `GlassBar`, `Drawer`, `TopTabs`, `BottomBar`, `Fab`, `HeroCard`, `RowList`/`StatRow`, `CategoryRow`, `FeatureCard`, `Sparkline` (inline SVG), `AreaChart` (lazy Recharts, §8), `SegmentedPills`, responsive `Sheet` (mobile `BottomSheet` / desktop `Dialog`), `ThemePicker`.

### 7.1 Icon map (lucide-react — exact, no emoji)

**Nav/surfaces:** Home `Home` · Spend `ArrowLeftRight` · Insights `BarChart3` · Activity `Bell` · Capture `Camera` · Guidance `Sparkles` · Cross-border `Globe` · Connections `Cable` · Review `ListChecks` · Settings `Settings` · Sign out `LogOut` · search `Search` · chevron `ChevronRight` · back `ChevronLeft`.
**Insights tabs:** Analytics `LineChart` · Budgets `PieChart` · Debt `Landmark` · Income `Wallet`.
**Summary rows:** Income `TrendingUp` · Spending `TrendingDown` · Savings `PiggyBank`.
**Categories (by name, fallback `Tag`):** Housing `Home` · Rent/Mortgage `Landmark` · Groceries `ShoppingCart` · Dining/Restaurants `Utensils` · Utilities `Zap` · Transport/Fuel `Car` · Health `HeartPulse` · Shopping `ShoppingBag` · Travel `Plane` · Entertainment `Clapperboard` · Education `GraduationCap` · Salary/Income `Banknote` · Transfers `ArrowLeftRight` · Fees `Receipt` · Subscriptions `RefreshCw`.

## 8. Charts & performance (locked)

- **Sparklines (rows, hero mini):** hand-rolled inline SVG `polyline`/`path`, stroke `currentColor`/theme var. **No library.**
- **One chart per surface (cash-flow area, breakdown bars):** **keep Recharts** (already a dep), imported via `next/dynamic(() => …, { ssr:false })` so it is code-split and never blocks first paint. Themed via CSS vars. Do not add a new chart lib.
- Glass confined to 3 fixed chrome elements. No blur on scrolling content. Transform/opacity/filter-only animation. Target: 60fps drawer slide on mid-range mobile; first paint not regressed vs current.

## 9. Responsive / desktop (locked)

Breakpoint `lg = 1024px`.
- **< lg (phone/tablet):** drawer slides (X-style); bottom bar + FAB visible; top tabs sticky under header.
- **≥ lg:** drawer content becomes a **persistent 260px left rail** (no slide, no scrim); bottom bar hidden; FAB hidden (Capture reachable from rail + header); top tabs remain; main content `max-width:720px`, centered, with normal page scroll. Same components, different composition via a `useIsDesktop()`/CSS-driven switch.

## 10. PWA (real — replaces starter)

- Custom **install prompt**: capture `beforeinstallprompt`, surface a branded "Install app" entry in the drawer/Settings; iOS fallback = A2HS instructions sheet.
- **Standalone polish:** `display: standalone`, safe-area insets (`env(safe-area-inset-*)` on bars/FAB), themed status bar per active theme, maskable icons + splash (regenerate from brand).
- **Offline:** clear queued/syncing/failed states + retry + offline banner on the existing Dexie capture queue.
- App-like **route transitions**; optional pull-to-refresh on list surfaces.
- **Web-push (VAPID) subscription wiring is a defined follow-up task** in the plan (backend endpoints exist); the Activity surface ships center + prefs UI regardless and is not blocked by push.

## 11. Scope & sequencing

Full rebuild in one pass, executed surface-by-surface behind the new `AppShell`:
1. Theme system + tokens + Tailwind mapping + no-flash SSR cookie.
2. `AppShell`: glass bars, FAB, `TopTabs`, X-`Drawer`, responsive rail.
3. Primitives (§7).
4. Re-skin in order: Home → Spend → Insights(Analytics/Budgets/Debt/Income) → Capture/Review → Activity → drawer surfaces (Guidance, Cross-border, Connections, Settings).
5. PWA polish (§10).
6. Tests (§12).

### 11.1 Dependencies (allowed set — no others without asking)

Already present and reused: `next 16`, `react 19`, `tailwindcss 3.4`, `tailwindcss-animate`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `recharts`, `@tanstack/react-query`, `dexie`, `next-intl`, `@radix-ui/*`, `serwist/@serwist/next`, `sonner`. **May remove:** `next-themes` (replaced by `ThemeProvider`). **No new runtime deps** are required for this redesign.

## 12. Testing (locked)

- Per-surface Playwright smoke (renders + key data visible) — extend `web/e2e/*.spec.ts`.
- **Theme test:** switch persists across reload, no flash, all 6 `data-theme` combos render; `theme-color` meta updates.
- **Drawer test:** opens/closes via avatar + window tap; focus trap; reduced-motion path renders instantly.
- A11y: tab order, `:focus-visible`, contrast in all 6 themes, `prefers-reduced-motion`.
- Typecheck + build in `web` container; Playwright on host.

## 13. Acceptance criteria

- All 12 surfaces render under `AppShell` with the 3-tier nav; no surface drops the shell (no root-404 regression).
- 3 palettes × light/dark all selectable from drawer + Settings, persisted, no FOUC.
- Liquid glass on exactly the 3 chrome elements; nowhere else.
- Drawer matches §6 motion; reduced-motion respected.
- No emoji anywhere; all icons from §7.1.
- No backend/API/Dexie/auth changes; data still loads (uses live demo data).
- Typecheck, build, and Playwright (host) green.
