# M15 Redesign — R1 Foundation (Theme · AppShell · Primitives) Implementation Plan

> **For the implementing agent (Codex):** This plan is **prescriptive**. Each task gives the
> **exact, complete file contents** to write. Create/replace each file with the code block
> **verbatim** — do not redesign, rename, restyle, or "improve" it. Do not add libraries.
> Do not edit files this plan does not mention. After each task, run the listed verification
> command and confirm the expected output before moving on. Steps use `- [ ]` for tracking.
>
> **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the stock shadcn dashboard chrome with the redesign's platform layer — a
6-combination (3 palettes × light/dark) cookie-persisted no-flash theme system, the
liquid-glass three-tier `AppShell` (top glass bar, bottom bar, FAB, X-style drawer, per-surface
top tabs, responsive ≥lg left rail), and the locked component primitives — so R2 can re-skin all
12 surfaces on top of it.

**Architecture:** Tokens are CSS custom properties on `<html data-theme="{palette}-{mode}">`,
emitted server-side from a `cf-theme` cookie (no FOUC) and mutated client-side by a small
`ThemeProvider` context. Tailwind's semantic color keys are repointed to those vars; the existing
shadcn/radix primitives in `web/components/ui/*` are **bridged** (their `background/foreground/
primary/card/border/...` keys map onto the new tokens) so dialogs/dropdowns/inputs keep working
under the new skin without re-implementation. `next-themes` is removed. The shell composes the
same components two ways via a `useIsDesktop()` switch (slide drawer + bottom bar < lg; persistent
260px rail ≥ lg).

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind 3.4, lucide-react, Recharts 2
(lazy via `next/dynamic`), @radix-ui/react-dialog (under Sheet/Drawer), @playwright/test. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-15-m15-frontend-redesign-design.md` (§3 IA, §4 tokens,
§5 visual language, §6 motion, §7 inventory + icon map, §8 charts, §9 responsive). Mockup
source-of-truth: `docs/mockups/dashboard-palettes.html`.

> **Naming note:** the mockup uses palette class `green`; the spec renames it **`emerald`**.
> This plan uses **`emerald`** everywhere (`data-theme="emerald-light"` etc.). Token *values*
> are copied verbatim from the mockup/spec.

> **⚠️ One IA decision deferred to R2 (does not block R1):** the spec's surface map lists
> **Cross-border** as its own surface (tabs Transfers·Limits) while the shipped rebuild nests it
> inside Guidance. R1 wires the drawer "Cross-border" entry to **`/guidance`** (existing, works).
> R2 will either promote it to a `/cross-border` route or keep the guidance nesting — confirm
> before R2. R1 is unaffected.

---

## File map (R1)

**Create:**
- `web/lib/theme/themes.ts` — palette/mode types, validation, cookie name, `THEME_BG` map.
- `web/components/theme/theme-provider.tsx` — context + cookie writer + `<meta>` sync.
- `web/components/theme/theme-picker.tsx` — 3 swatches + light/dark toggle.
- `web/lib/shell/nav.ts` — bottom tabs, drawer items, top-tab config, route→surface resolver.
- `web/lib/shell/use-is-desktop.ts` — `lg` (1024px) media-query hook.
- `web/components/shell/glass-bar.tsx` — top header (avatar→drawer, title, bell→Activity).
- `web/components/shell/top-tabs.tsx` — per-surface underline tabs.
- `web/components/shell/bottom-bar.tsx` — 4-tab glass bottom bar.
- `web/components/shell/fab.tsx` — Capture FAB.
- `web/components/shell/drawer.tsx` — X-style slide drawer.
- `web/components/shell/desktop-rail.tsx` — ≥lg persistent 260px rail.
- `web/components/shell/app-shell.tsx` — composition + responsive switch.
- `web/components/ui/hero-card.tsx` — immersive gradient hero.
- `web/components/ui/sparkline.tsx` — inline SVG polyline/area.
- `web/components/ui/row-list.tsx` — `RowList` + `StatRow` + `CategoryRow`.
- `web/components/ui/feature-card.tsx` — 2-up gradient feature tiles.
- `web/components/ui/segmented-pills.tsx` — range/segment pills.
- `web/components/ui/area-chart.tsx` — lazy Recharts area chart.
- `web/components/ui/responsive-sheet.tsx` — BottomSheet (mobile) / Dialog (desktop).
- `web/lib/icons.ts` — category→lucide map (§7.1).
- `web/e2e/redesign.spec.ts` — theme persistence + drawer + shell smoke.

**Modify:**
- `web/app/globals.css` — replace luxe block with 6 theme blocks + bridge + glass/motion utils.
- `web/tailwind.config.ts` — repoint color keys to new vars; radii.
- `web/app/layout.tsx` — SSR cookie → `data-theme`, no-flash script, themed `<meta>`.
- `web/app/providers.tsx` — swap `next-themes` for `ThemeProvider`.
- `web/app/(app)/layout.tsx` — mount `AppShell`.
- `web/components/dashboard/cash-flow-chart.tsx` — fix `hsl(var(--…))` refs to new vars.
- `web/components/ui/sheet.tsx` — `bg-sidebar` → `bg-card`.
- `web/app/(auth)/login/page.tsx` — fix `hsl(var(--accent)/…)` gradient.
- `web/package.json` — remove `next-themes`.

**Delete:** `web/components/theme-toggle.tsx`, `web/components/topbar.tsx`,
`web/components/app-nav.tsx`, `web/components/user-menu.tsx` (superseded by drawer/shell).

---

## Conventions

- **Typecheck + build run in the `web` Docker container; Playwright runs on the host.** Test
  creds `dev@example.com` / `hunter2pass`.
- Container typecheck: `docker compose exec web npm run typecheck`
  Container build: `docker compose exec web npm run build`
  Host e2e: `cd web && npx playwright test e2e/redesign.spec.ts`
- If the `web` container is not running, start the stack first (`docker compose up -d web`).
- All icons are lucide-react (§7.1). Never emoji.
- Money is rendered via `formatCurrency` from `@/lib/format`; wrap raw string amounts in `Number()`.
- Commit after each task with the message shown.

---

## Task 1: Theme tokens + bridge in globals.css

**Files:**
- Modify: `web/app/globals.css` (full replace)

The 6 `[data-theme]` blocks carry the spec's verbatim token values. A `[data-theme$="-light"]`
/`[data-theme$="-dark"]` pair supplies `--destructive`/`--on-destructive` (not in the spec token
set; needed by shadcn primitives). `.glass` is the only blur surface. `.app-window`/`.app-drawer`
carry the §6 drawer motion; all motion is gated behind `prefers-reduced-motion`.

- [ ] **Step 1: Replace the file**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ============================================================
   M15 redesign theme system — 3 palettes × light/dark.
   data-theme="{emerald|indigo|ink}-{light|dark}" on <html>.
   Token values are verbatim from the spec (§4). Do not alter.
   ============================================================ */
@layer base {
  :root,
  [data-theme="indigo-light"] {
    --app-bg:#f1f1fa; --fg:#16132b; --muted:#716e8a; --accent:#6b5bf0; --accent-soft:#e7e3fd; --on-accent:#fff;
    --c2:#e0653f; --soft2:#fce4dc; --c3:#1aa37a; --soft3:#d8f3ea; --card:#fff; --border:#ebe9f7;
    --card-shadow:0 2px 12px -4px rgba(40,30,90,.12); --chip:#e7e4f7; --track:#ebe9f7;
    --hero:linear-gradient(135deg,#7c6bf2,#5b46d6 58%,#4733b8); --hero-shadow:0 16px 36px -12px rgba(91,70,214,.45);
    --glass:rgba(241,241,250,.7); --glass-stroke:rgba(255,255,255,.7); --glass-hi:rgba(255,255,255,.85);
  }
  [data-theme="indigo-dark"] {
    --app-bg:#0e0d16; --fg:#ece9fb; --muted:#8a86a6; --accent:#8b7bff; --accent-soft:#1f1b33; --on-accent:#0a0820;
    --c2:#f0794f; --soft2:#2a1a14; --c3:#3fc79a; --soft3:#10241d; --card:#181527; --border:#262338;
    --card-shadow:none; --chip:#1b1830; --track:#262338;
    --hero:linear-gradient(135deg,#7c6bf2,#5238c4 58%,#3a2796); --hero-shadow:0 16px 36px -16px rgba(0,0,0,.6);
    --glass:rgba(16,14,26,.62); --glass-stroke:rgba(255,255,255,.08); --glass-hi:rgba(255,255,255,.06);
  }
  [data-theme="emerald-light"] {
    --app-bg:#eef3f0; --fg:#0c1f1a; --muted:#6a7d77; --accent:#0f9d76; --accent-soft:#dcf3ea; --on-accent:#fff;
    --c2:#d98324; --soft2:#fbeede; --c3:#5b8def; --soft3:#e3edff; --card:#fff; --border:#e3ebe7;
    --card-shadow:0 2px 10px -4px rgba(15,40,32,.1); --chip:#e3ebe7; --track:#e3ebe7;
    --hero:linear-gradient(135deg,#0f9d76,#0b6e57 60%,#0a5546); --hero-shadow:0 16px 32px -12px rgba(11,110,87,.45);
    --glass:rgba(238,243,240,.7); --glass-stroke:rgba(255,255,255,.7); --glass-hi:rgba(255,255,255,.8);
  }
  [data-theme="emerald-dark"] {
    --app-bg:#0b1512; --fg:#e8f3ee; --muted:#7e9991; --accent:#19c08e; --accent-soft:#14241e; --on-accent:#04130d;
    --c2:#e0a44e; --soft2:#241c12; --c3:#6f9bff; --soft3:#16203a; --card:#111d18; --border:#1d2b26;
    --card-shadow:none; --chip:#16221d; --track:#1e2c27;
    --hero:linear-gradient(135deg,#0f9d76,#0a5e4a 60%,#073f33); --hero-shadow:0 16px 36px -16px rgba(0,0,0,.6);
    --glass:rgba(13,22,19,.6); --glass-stroke:rgba(255,255,255,.08); --glass-hi:rgba(255,255,255,.06);
  }
  [data-theme="ink-light"] {
    --app-bg:#f3f5f8; --fg:#0d0f14; --muted:#5d636f; --accent:#2f6bff; --accent-soft:#e4ecff; --on-accent:#fff;
    --c2:#e0653f; --soft2:#fce3da; --c3:#19b48a; --soft3:#d6f4ea; --card:#fff; --border:#e7eaef;
    --card-shadow:0 2px 10px -4px rgba(20,30,60,.1); --chip:#eaedf2; --track:#e7eaef;
    --hero:linear-gradient(135deg,#2b3a63,#1c294a 60%,#141d36); --hero-shadow:0 16px 32px -14px rgba(20,30,60,.4);
    --glass:rgba(243,245,248,.7); --glass-stroke:rgba(255,255,255,.7); --glass-hi:rgba(255,255,255,.85);
  }
  [data-theme="ink-dark"] {
    --app-bg:#0c0e12; --fg:#f1f4f8; --muted:#8a909c; --accent:#5b8cff; --accent-soft:#1a2336; --on-accent:#06122e;
    --c2:#f0794f; --soft2:#2a1812; --c3:#2fd0a0; --soft3:#0c2620; --card:#15181f; --border:#20242e;
    --card-shadow:none; --chip:#1a1e26; --track:#222732;
    --hero:linear-gradient(135deg,#2b3a63,#16203a 60%,#11192e); --hero-shadow:0 16px 40px -16px rgba(0,0,0,.7);
    --glass:rgba(12,14,18,.6); --glass-stroke:rgba(255,255,255,.08); --glass-hi:rgba(255,255,255,.06);
  }

  /* Bridge tokens for shadcn/radix primitives (not in the spec set). */
  [data-theme$="-light"] { --destructive:#dc4c3e; --on-destructive:#ffffff; }
  [data-theme$="-dark"]  { --destructive:#f0795f; --on-destructive:#1b0d09; }
}

@layer base {
  * {
    border-color: var(--border);
  }
  html {
    color-scheme: light;
  }
  html[data-theme$="-dark"] {
    color-scheme: dark;
  }
  body {
    background-color: var(--app-bg);
    color: var(--fg);
    -webkit-font-smoothing: antialiased;
    /* iOS standalone safe areas (used by bars/FAB in R3). */
    --safe-top: env(safe-area-inset-top, 0px);
    --safe-bottom: env(safe-area-inset-bottom, 0px);
  }
  h1, h2, h3, .tracking-tight-2 {
    letter-spacing: -0.02em;
  }
  .tabular-nums,
  [data-numeric] {
    font-variant-numeric: tabular-nums;
  }
}

/* Liquid glass — chrome only (top bar, bottom bar, drawer). Never on content. */
@layer components {
  .glass {
    background: var(--glass);
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    backdrop-filter: blur(22px) saturate(180%);
    border: 1px solid var(--glass-stroke);
    box-shadow: inset 0 1px 0 var(--glass-hi);
  }
}

/* ---- X-style drawer motion (§6). Transform/opacity/filter only. ---- */
.app-window {
  transform-origin: left center;
  transition:
    transform 0.42s cubic-bezier(0.32, 0.72, 0, 1),
    filter 0.42s,
    border-radius 0.42s;
  will-change: transform;
}
.app-window[data-open="true"] {
  transform: translateX(76%) scale(0.84);
  filter: blur(3px) brightness(0.62);
  border-radius: 30px;
  box-shadow: -24px 0 60px rgba(0, 0, 0, 0.45);
}
.app-drawer {
  transform: translateX(-14%);
  opacity: 0.4;
  transition:
    transform 0.42s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.42s;
}
.app-drawer[data-open="true"] {
  transform: none;
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.001ms !important;
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
  }
  .app-window,
  .app-drawer {
    transition: none !important;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/globals.css
git commit -m "feat(web): redesign theme tokens + glass/motion utils in globals.css"
```

---

## Task 2: Repoint Tailwind color keys to the new vars

**Files:**
- Modify: `web/tailwind.config.ts` (full replace)

Semantic keys map to the new tokens. The shadcn keys (`background/foreground/primary/secondary/
popover/input/ring/destructive/muted/accent/card/border`) are bridged so existing primitives keep
working. `darkMode: ["class"]` is dropped (mode is encoded in `data-theme`, not a `.dark` class).

- [ ] **Step 1: Replace the file**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        // Spec §5 radii.
        card: "24px",
        "card-sm": "20px",
        chip: "12px",
        bar: "22px",
        fab: "18px",
        // shadcn fallbacks (radix primitives).
        lg: "16px",
        md: "12px",
        sm: "10px",
      },
      colors: {
        // ---- new design tokens (spec §4) ----
        bg: "var(--app-bg)",
        fg: "var(--fg)",
        chip: "var(--chip)",
        track: "var(--track)",
        "on-accent": "var(--on-accent)",
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--on-accent)",
          soft: "var(--accent-soft)",
        },
        c2: { DEFAULT: "var(--c2)", soft: "var(--soft2)" },
        c3: { DEFAULT: "var(--c3)", soft: "var(--soft3)" },
        soft2: "var(--soft2)",
        soft3: "var(--soft3)",
        card: { DEFAULT: "var(--card)", foreground: "var(--fg)" },
        border: "var(--border)",
        // ---- shadcn/radix bridge (map onto the same tokens) ----
        background: "var(--app-bg)",
        foreground: "var(--fg)",
        primary: { DEFAULT: "var(--accent)", foreground: "var(--on-accent)" },
        secondary: { DEFAULT: "var(--chip)", foreground: "var(--fg)" },
        popover: { DEFAULT: "var(--card)", foreground: "var(--fg)" },
        muted: { DEFAULT: "var(--chip)", foreground: "var(--muted)" },
        input: "var(--border)",
        ring: "var(--accent)",
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--on-destructive)",
        },
        success: { DEFAULT: "var(--c3)", foreground: "var(--on-accent)" },
      },
      boxShadow: {
        card: "var(--card-shadow)",
        hero: "var(--hero-shadow)",
      },
      backgroundImage: {
        hero: "var(--hero)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

- [ ] **Step 2: Commit**

```bash
git add web/tailwind.config.ts
git commit -m "feat(web): repoint Tailwind color keys to redesign tokens + bridge shadcn"
```

---

## Task 3: Theme helper module

**Files:**
- Create: `web/lib/theme/themes.ts`

Single source of truth for palette/mode unions, the `cf-theme` cookie name, validation, and the
per-theme `--app-bg` hex (needed for `<meta name="theme-color">` server- and client-side, since
CSS vars can't be read during SSR).

- [ ] **Step 1: Create the file**

```ts
export const PALETTES = ["emerald", "indigo", "ink"] as const;
export const MODES = ["light", "dark"] as const;

export type Palette = (typeof PALETTES)[number];
export type Mode = (typeof MODES)[number];
export type ThemeId = `${Palette}-${Mode}`;

export const DEFAULT_PALETTE: Palette = "indigo";
export const DEFAULT_MODE: Mode = "light";
export const DEFAULT_THEME: ThemeId = `${DEFAULT_PALETTE}-${DEFAULT_MODE}`;

export const THEME_COOKIE = "cf-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const THEME_RE = /^(emerald|indigo|ink)-(light|dark)$/;

export function isThemeId(value: string | undefined | null): value is ThemeId {
  return typeof value === "string" && THEME_RE.test(value);
}

export function parseTheme(value: string | undefined | null): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}

export function splitTheme(theme: ThemeId): { palette: Palette; mode: Mode } {
  const [palette, mode] = theme.split("-") as [Palette, Mode];
  return { palette, mode };
}

export function joinTheme(palette: Palette, mode: Mode): ThemeId {
  return `${palette}-${mode}`;
}

/** `--app-bg` per theme — drives <meta name="theme-color"> + manifest. */
export const THEME_BG: Record<ThemeId, string> = {
  "indigo-light": "#f1f1fa",
  "indigo-dark": "#0e0d16",
  "emerald-light": "#eef3f0",
  "emerald-dark": "#0b1512",
  "ink-light": "#f3f5f8",
  "ink-dark": "#0c0e12",
};

/** Swatch dot color per palette (drawer + ThemePicker). */
export const PALETTE_SWATCH: Record<Palette, string> = {
  emerald: "#0f9d76",
  indigo: "#6b5bf0",
  ink: "#2f6bff",
};
```

- [ ] **Step 2: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add web/lib/theme/themes.ts
git commit -m "feat(web): theme helper module (palette/mode unions, cookie, bg map)"
```

Expected: typecheck passes (note: existing files still import `next-themes` — that stays valid
until Task 14; this task introduces no breakage).

---

## Task 4: ThemeProvider (context + cookie writer + meta sync)

**Files:**
- Create: `web/components/theme/theme-provider.tsx`

Initial state is read from `document.documentElement.dataset.theme` (already set by SSR in Task 6),
so the context never disagrees with the painted DOM. Mutations write the cookie, flip
`data-theme`, and update the `theme-color` meta tag.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME,
  joinTheme,
  parseTheme,
  splitTheme,
  THEME_BG,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  type Mode,
  type Palette,
  type ThemeId,
} from "@/lib/theme/themes";

type ThemeContextValue = {
  palette: Palette;
  mode: Mode;
  theme: ThemeId;
  setPalette: (p: Palette) => void;
  setMode: (m: Mode) => void;
  toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeId {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return parseTheme(document.documentElement.getAttribute("data-theme"));
}

function persist(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_BG[theme]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(readInitialTheme);
  const { palette, mode } = splitTheme(theme);

  const apply = useCallback((next: ThemeId) => {
    setTheme(next);
    persist(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      palette,
      mode,
      theme,
      setPalette: (p) => apply(joinTheme(p, mode)),
      setMode: (m) => apply(joinTheme(palette, m)),
      toggleMode: () => apply(joinTheme(palette, mode === "dark" ? "light" : "dark")),
    }),
    [apply, palette, mode, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

- [ ] **Step 2: Commit** (typecheck deferred to Task 6 where the provider is wired)

```bash
git add web/components/theme/theme-provider.tsx
git commit -m "feat(web): ThemeProvider context with cookie + meta-color sync"
```

---

## Task 5: ThemePicker (swatches + light/dark)

**Files:**
- Create: `web/components/theme/theme-picker.tsx`

Used in the drawer footer (§3) and Settings (R2). Three palette swatches + a mode toggle.
lucide `Sun`/`Moon`, never emoji.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { Check, Moon, Sun } from "lucide-react";
import { PALETTES, PALETTE_SWATCH } from "@/lib/theme/themes";
import { useTheme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";

export function ThemePicker({ className }: { className?: string }) {
  const { palette, mode, setPalette, toggleMode } = useTheme();
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex gap-2" role="group" aria-label="Color palette">
        {PALETTES.map((p) => {
          const active = p === palette;
          return (
            <button
              key={p}
              type="button"
              aria-label={p}
              aria-pressed={active}
              onClick={() => setPalette(p)}
              className={cn(
                "grid size-5 place-items-center rounded-[7px] ring-offset-2 ring-offset-bg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                active && "ring-2 ring-fg/30",
              )}
              style={{ background: PALETTE_SWATCH[p] }}
            >
              {active && <Check className="size-3 text-white" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={toggleMode}
        aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="grid size-8 place-items-center rounded-chip bg-chip text-fg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {mode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/theme/theme-picker.tsx
git commit -m "feat(web): ThemePicker (palette swatches + mode toggle)"
```

---

## Task 6: SSR no-flash wiring (layout + providers)

**Files:**
- Modify: `web/app/layout.tsx` (full replace)
- Modify: `web/app/providers.tsx` (full replace)

Root layout reads `cf-theme` server-side and emits `data-theme` on `<html>` (no FOUC); a tiny
inline head script re-syncs from the cookie before paint as belt-and-suspenders. `themeColor` is
set to the active theme's `--app-bg`. Providers swap `next-themes` for `ThemeProvider`.

- [ ] **Step 1: Replace `web/app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import "./globals.css";
import { cn } from "@/lib/utils";
import { getLocale } from "@/lib/i18n/locale";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
import { SwRegister } from "@/components/sw-register";
import { parseTheme, THEME_BG, THEME_COOKIE } from "@/lib/theme/themes";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "CodeName-Finance",
  description: "Document-driven, AI-assisted personal finance.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Finance" },
};

export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: THEME_BG[theme],
  };
}

// Belt-and-suspenders: re-assert data-theme from the cookie before paint.
const NO_FLASH = `(function(){try{var m=document.cookie.match(/(?:^|; )cf-theme=([^;]+)/);var t=m?decodeURIComponent(m[1]):'indigo-light';if(!/^(emerald|indigo|ink)-(light|dark)$/.test(t))t='indigo-light';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','indigo-light');}})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang={locale} data-theme={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body
        className={cn(
          inter.variable,
          "min-h-dvh bg-bg font-sans text-fg antialiased",
        )}
      >
        <SwRegister />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Replace `web/app/providers.tsx`**

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "@/components/theme/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 3: Commit** (full typecheck/build comes after Task 14 cleanup; `next-themes` is still
  imported by `theme-toggle.tsx` until then, which is fine.)

```bash
git add web/app/layout.tsx web/app/providers.tsx
git commit -m "feat(web): SSR cookie -> data-theme (no FOUC) + ThemeProvider wiring"
```

---

## Task 7: Shell nav config + icons + desktop hook

**Files:**
- Create: `web/lib/shell/nav.ts`
- Create: `web/lib/icons.ts`
- Create: `web/lib/shell/use-is-desktop.ts`

`nav.ts` encodes the locked IA (§3): 4 bottom tabs, the drawer order, the per-surface top tabs,
and a `resolveSurface(pathname)` that the shell uses for the header title + active bottom tab +
top-tab set. Top tabs use hrefs (Insights = real routes; Home/Spend/Guidance use query-param tabs
that R2's pages will honor — non-breaking now).

- [ ] **Step 1: Create `web/lib/icons.ts`**

```ts
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Bell,
  Cable,
  Car,
  Camera,
  Clapperboard,
  GraduationCap,
  Globe,
  HeartPulse,
  Home,
  Landmark,
  LineChart,
  ListChecks,
  LogOut,
  PieChart,
  PiggyBank,
  Plane,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingDown,
  TrendingUp,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

export {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Cable,
  Camera,
  Globe,
  Home,
  Landmark,
  ListChecks,
  LogOut,
  LineChart,
  PieChart,
  Search,
  Settings,
  Sparkles,
  Wallet,
};

/** Summary rows (Dashboard §7.1). */
export const SUMMARY_ICONS = {
  income: TrendingUp,
  spending: TrendingDown,
  savings: PiggyBank,
} as const;

/** Category name -> icon (§7.1). Case-insensitive substring match; fallback Tag. */
const CATEGORY_ICONS: Array<[RegExp, LucideIcon]> = [
  [/rent|mortgage/i, Landmark],
  [/hous/i, Home],
  [/grocer/i, ShoppingCart],
  [/dining|restaurant/i, Utensils],
  [/utilit/i, Zap],
  [/transport|fuel/i, Car],
  [/health/i, HeartPulse],
  [/shopping/i, ShoppingBag],
  [/travel/i, Plane],
  [/entertain/i, Clapperboard],
  [/education/i, GraduationCap],
  [/salary|income/i, Banknote],
  [/transfer/i, ArrowLeftRight],
  [/fee/i, Receipt],
  [/subscription/i, RefreshCw],
];

export function categoryIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Tag;
  for (const [re, icon] of CATEGORY_ICONS) if (re.test(name)) return icon;
  return Tag;
}
```

- [ ] **Step 2: Create `web/lib/shell/nav.ts`**

```ts
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Cable,
  Globe,
  Home,
  Landmark,
  LineChart,
  ListChecks,
  PieChart,
  Settings,
  Sparkles,
  Wallet,
} from "@/lib/icons";
import type { LucideIcon } from "lucide-react";

export type Tab = { label: string; href: string };

export type BottomTab = {
  key: "home" | "spend" | "insights" | "activity";
  label: string;
  href: string;
  icon: LucideIcon;
  /** route prefixes that light this tab */
  match: string[];
};

export type DrawerItem = {
  key: string;
  label: string;
  sub: string;
  href: string;
  icon: LucideIcon;
  tint: "accent" | "c2" | "c3" | "muted";
};

export const BOTTOM_TABS: BottomTab[] = [
  { key: "home", label: "Home", href: "/dashboard", icon: Home, match: ["/dashboard"] },
  { key: "spend", label: "Spend", href: "/transactions", icon: ArrowLeftRight, match: ["/transactions"] },
  {
    key: "insights",
    label: "Insights",
    href: "/analytics",
    icon: BarChart3,
    match: ["/analytics", "/budgets", "/debt", "/income"],
  },
  { key: "activity", label: "Activity", href: "/notifications", icon: Bell, match: ["/notifications"] },
];

// Drawer order is locked (§3): Guidance, Cross-border, Connections, Review, Settings.
// NOTE: Cross-border href is /guidance pending the R2 IA decision (see plan header).
export const DRAWER_ITEMS: DrawerItem[] = [
  { key: "guidance", label: "Guidance", sub: "Ask & plan with AI", href: "/guidance", icon: Sparkles, tint: "accent" },
  { key: "cross-border", label: "Cross-border", sub: "Transfers & limits", href: "/guidance", icon: Globe, tint: "c3" },
  { key: "connections", label: "Connections", sub: "Plaid · Gmail · SMS", href: "/connections", icon: Cable, tint: "c2" },
  { key: "review", label: "Review queue", sub: "Items need you", href: "/review", icon: ListChecks, tint: "muted" },
  { key: "settings", label: "Settings", sub: "Account · security · export", href: "/settings", icon: Settings, tint: "muted" },
];

const INSIGHTS_TABS: Tab[] = [
  { label: "Analytics", href: "/analytics" },
  { label: "Budgets", href: "/budgets" },
  { label: "Debt", href: "/debt" },
  { label: "Income", href: "/income" },
];

/** Per-surface top tabs (§3). Insights = real routes; others = query-param tabs (R2 honors). */
const TOP_TABS: Record<string, Tab[]> = {
  "/dashboard": [
    { label: "Overview", href: "/dashboard" },
    { label: "Goals", href: "/dashboard?tab=goals" },
  ],
  "/transactions": [
    { label: "All", href: "/transactions" },
    { label: "Expenses", href: "/transactions?type=expense" },
    { label: "Income", href: "/transactions?type=income" },
  ],
  "/analytics": INSIGHTS_TABS,
  "/budgets": INSIGHTS_TABS,
  "/debt": INSIGHTS_TABS,
  "/income": INSIGHTS_TABS,
  "/guidance": [
    { label: "Ask", href: "/guidance" },
    { label: "Plan", href: "/guidance?tab=plan" },
  ],
};

/** Header title per route prefix. */
const TITLES: Array<[string, string]> = [
  ["/dashboard", "Home"],
  ["/transactions", "Spend"],
  ["/analytics", "Insights"],
  ["/budgets", "Insights"],
  ["/debt", "Insights"],
  ["/income", "Insights"],
  ["/notifications", "Activity"],
  ["/capture", "Capture"],
  ["/review", "Review queue"],
  ["/guidance", "Guidance"],
  ["/connections", "Connections"],
  ["/settings", "Settings"],
];

function matchPrefix(pathname: string): string | undefined {
  return TITLES.map(([p]) => p).find(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function surfaceTitle(pathname: string): string {
  const prefix = matchPrefix(pathname);
  return TITLES.find(([p]) => p === prefix)?.[1] ?? "Home";
}

export function surfaceTabs(pathname: string): Tab[] {
  const prefix = matchPrefix(pathname);
  return prefix ? (TOP_TABS[prefix] ?? []) : [];
}

export function activeBottomKey(pathname: string): BottomTab["key"] | null {
  const tab = BOTTOM_TABS.find((t) =>
    t.match.some((m) => pathname === m || pathname.startsWith(`${m}/`)),
  );
  return tab?.key ?? null;
}
```

- [ ] **Step 3: Create `web/lib/shell/use-is-desktop.ts`**

```ts
"use client";

import { useEffect, useState } from "react";

/** True at >= lg (1024px, spec §9). SSR-safe: false until mounted. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}
```

- [ ] **Step 4: Commit**

```bash
git add web/lib/shell/nav.ts web/lib/icons.ts web/lib/shell/use-is-desktop.ts
git commit -m "feat(web): shell nav config, icon map, desktop media hook"
```

---

## Task 8: GlassBar (top header) + TopTabs

**Files:**
- Create: `web/components/shell/glass-bar.tsx`
- Create: `web/components/shell/top-tabs.tsx`

GlassBar is the fixed top chrome: avatar (opens drawer), centered title, bell (→ Activity). It
sits over the scrolling feed and bleeds the hero under it. TopTabs renders the §5 underline
(34px×3px `--accent`) and slides via a transform on the active item.

- [ ] **Step 1: Create `web/components/shell/top-tabs.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Tab } from "@/lib/shell/nav";
import { cn } from "@/lib/utils";

function hrefMatches(href: string, pathname: string, search: string): boolean {
  const [path, query] = href.split("?");
  if (path !== pathname) return false;
  if (!query) return search === "" || !new URLSearchParams(href.split("?")[1] ?? "").toString();
  // active when every param in href is present in the URL
  const want = new URLSearchParams(query);
  const have = new URLSearchParams(search);
  for (const [k, v] of want) if (have.get(k) !== v) return false;
  return true;
}

export function TopTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  if (tabs.length === 0) return null;

  // default-active: first tab whose path matches but has no query, when none match exactly
  const exact = tabs.findIndex((t) => hrefMatches(t.href, pathname, search));
  const activeIndex = exact >= 0 ? exact : tabs.findIndex((t) => t.href.split("?")[0] === pathname);

  return (
    <div className="flex px-2" role="tablist" aria-label="Section tabs">
      {tabs.map((tab, i) => {
        const active = i === activeIndex;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "relative flex-1 py-3 text-center text-[13.5px] font-semibold transition-colors",
              active ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {tab.label}
            <span
              className={cn(
                "absolute bottom-0 left-1/2 h-[3px] w-[34px] -translate-x-1/2 rounded-full bg-accent transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
            />
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `web/components/shell/glass-bar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { Bell } from "@/lib/icons";
import type { Tab } from "@/lib/shell/nav";
import { TopTabs } from "@/components/shell/top-tabs";
import { cn } from "@/lib/utils";

export function GlassBar({
  title,
  tabs,
  onOpenDrawer,
  avatarInitial,
  showAvatar = true,
}: {
  title: string;
  tabs: Tab[];
  onOpenDrawer: () => void;
  avatarInitial: string;
  showAvatar?: boolean;
}) {
  return (
    <header className="glass absolute inset-x-0 top-0 z-40 lg:hidden">
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
        {showAvatar ? (
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Open menu"
            className="grid size-[34px] place-items-center rounded-full bg-accent-soft text-[13px] font-bold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {avatarInitial}
          </button>
        ) : (
          <span className="size-[34px]" />
        )}
        <h1 className="text-[17px] font-extrabold tracking-tight">{title}</h1>
        <Link
          href="/notifications"
          aria-label="Activity"
          className={cn(
            "grid size-[34px] place-items-center rounded-full bg-chip text-fg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          )}
        >
          <Bell className="size-[18px]" />
        </Link>
      </div>
      <TopTabs tabs={tabs} />
    </header>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/components/shell/glass-bar.tsx web/components/shell/top-tabs.tsx
git commit -m "feat(web): GlassBar top chrome + TopTabs underline nav"
```

---

## Task 9: BottomBar + FAB

**Files:**
- Create: `web/components/shell/bottom-bar.tsx`
- Create: `web/components/shell/fab.tsx`

Floating glass bottom bar (4 tabs, §5 geometry) and the Capture FAB. Both honor safe-area insets.

- [ ] **Step 1: Create `web/components/shell/bottom-bar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BOTTOM_TABS, activeBottomKey } from "@/lib/shell/nav";
import { cn } from "@/lib/utils";

export function BottomBar() {
  const pathname = usePathname();
  const active = activeBottomKey(pathname);
  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-[14px] bottom-[max(14px,env(safe-area-inset-bottom))] z-40 flex h-16 items-center justify-around rounded-bar px-1.5 lg:hidden"
    >
      {BOTTOM_TABS.map(({ key, label, href, icon: Icon }) => {
        const on = key === active;
        return (
          <Link
            key={key}
            href={href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-[3px] text-[10px] font-semibold transition-colors",
              on ? "text-accent" : "text-muted",
            )}
          >
            <Icon className="size-[23px]" strokeWidth={on ? 2.4 : 2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Create `web/components/shell/fab.tsx`**

```tsx
"use client";

import Link from "next/link";
import { Camera } from "@/lib/icons";

export function Fab() {
  return (
    <Link
      href="/capture"
      aria-label="Capture"
      className="fixed right-[18px] bottom-[calc(96px+env(safe-area-inset-bottom))] z-[45] grid size-[54px] place-items-center rounded-fab bg-accent text-on-accent shadow-[0_14px_28px_-8px_var(--accent)] transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg lg:hidden"
    >
      <Camera className="size-6" />
    </Link>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/components/shell/bottom-bar.tsx web/components/shell/fab.tsx
git commit -m "feat(web): glass BottomBar + Capture FAB"
```

---

## Task 10: X-style Drawer

**Files:**
- Create: `web/components/shell/drawer.tsx`

The drawer sits behind the main window. Opening animates the window (`data-open`) per §6; the
drawer reveals from `translateX(-14%) opacity .4`. Closes on backdrop tap, Escape, swipe-left
(window), or item navigation. Focus moves into the drawer on open and returns to the avatar on
close; reduced-motion is handled by the CSS in Task 1 (instant). The window-transform is applied
by `AppShell` (Task 12) to the element wrapping the page; this component renders the drawer panel
+ the tap-catcher.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut } from "lucide-react";
import { api } from "@/lib/api/client";
import { authStore } from "@/lib/api/auth";
import { DRAWER_ITEMS, type DrawerItem } from "@/lib/shell/nav";
import { ThemePicker } from "@/components/theme/theme-picker";
import { cn } from "@/lib/utils";

const TINT: Record<DrawerItem["tint"], string> = {
  accent: "bg-accent-soft text-accent",
  c2: "bg-soft2 text-c2",
  c3: "bg-soft3 text-c3",
  muted: "bg-chip text-muted",
};

export function Drawer({
  open,
  onClose,
  household,
}: {
  open: boolean;
  onClose: () => void;
  household: { name: string; meta: string; netWorth: string; initial: string };
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function logout() {
    const refresh_token = authStore.refresh;
    try {
      if (refresh_token) await api.POST("/auth/logout", { body: { refresh_token } });
    } catch {
      /* best-effort */
    }
    authStore.clear();
    router.replace("/login");
  }

  return (
    <aside
      ref={panelRef}
      className="app-drawer absolute inset-y-0 left-0 z-[5] flex w-[79%] max-w-[320px] flex-col bg-bg pb-5 pt-[max(54px,env(safe-area-inset-top))]"
      data-open={open}
      aria-hidden={!open}
      {...(!open ? { inert: "" as unknown as boolean } : {})}
    >
      {/* header */}
      <div className="px-[22px] pb-4">
        <div className="grid size-[52px] place-items-center rounded-full bg-accent-soft text-[18px] font-bold text-accent">
          {household.initial}
        </div>
        <div className="mt-3 text-[18px] font-extrabold tracking-tight">{household.name}</div>
        <div className="mt-0.5 text-xs text-muted">{household.meta}</div>
        <div className="mt-3.5 text-[12.5px] text-muted">
          Net worth
          <b className="mt-px block text-[23px] font-extrabold tracking-tight text-fg tabular-nums">
            {household.netWorth}
          </b>
        </div>
      </div>

      {/* items */}
      <nav className="flex-1 overflow-y-auto px-2.5" aria-label="More">
        {DRAWER_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onClose}
              className="flex items-center gap-3.5 rounded-[14px] px-3 py-3 text-fg transition-colors hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className={cn("grid size-9 flex-none place-items-center rounded-chip", TINT[item.tint])}>
                <Icon className="size-[18px]" />
              </span>
              <span className="flex-1">
                <span className="block text-[14.5px] font-semibold">{item.label}</span>
                <span className="block text-[11px] font-medium text-muted">{item.sub}</span>
              </span>
              <ChevronRight className="size-[18px] flex-none text-muted" />
            </Link>
          );
        })}
      </nav>

      {/* footer: appearance + sign out */}
      <div className="mt-3 flex items-center justify-between border-t border-border px-5 pt-3">
        <ThemePicker />
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/shell/drawer.tsx
git commit -m "feat(web): X-style slide Drawer (profile, long-tail nav, appearance)"
```

---

## Task 11: Desktop rail (≥ lg)

**Files:**
- Create: `web/components/shell/desktop-rail.tsx`

At ≥lg the drawer content becomes a persistent 260px left rail (no slide/scrim), bottom bar + FAB
hidden, Capture reachable from the rail (§9). Combines the bottom-tab destinations and the drawer
items into one vertical nav.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera } from "@/lib/icons";
import { BOTTOM_TABS, DRAWER_ITEMS, activeBottomKey } from "@/lib/shell/nav";
import { ThemePicker } from "@/components/theme/theme-picker";
import { cn } from "@/lib/utils";

export function DesktopRail({
  household,
}: {
  household: { name: string; meta: string; netWorth: string; initial: string };
}) {
  const pathname = usePathname();
  const activeKey = activeBottomKey(pathname);

  const isActive = (href: string) =>
    pathname === href.split("?")[0] || pathname.startsWith(`${href.split("?")[0]}/`);

  return (
    <aside className="sticky top-0 hidden h-dvh w-[260px] shrink-0 flex-col border-r border-border bg-card px-3 py-5 lg:flex">
      <div className="px-3 pb-4">
        <div className="grid size-11 place-items-center rounded-full bg-accent-soft text-base font-bold text-accent">
          {household.initial}
        </div>
        <div className="mt-2.5 text-base font-extrabold tracking-tight">{household.name}</div>
        <div className="text-xs text-muted">{household.meta}</div>
        <div className="mt-2 text-xs text-muted">
          Net worth
          <b className="block text-lg font-extrabold tracking-tight text-fg tabular-nums">
            {household.netWorth}
          </b>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto" aria-label="Primary">
        {BOTTOM_TABS.map(({ key, label, href, icon: Icon }) => (
          <RailLink key={key} href={href} label={label} Icon={Icon} active={key === activeKey} />
        ))}
        <RailLink href="/capture" label="Capture" Icon={Camera} active={isActive("/capture")} />
        <div className="my-2 border-t border-border" />
        {DRAWER_ITEMS.map(({ key, label, href, icon: Icon }) => (
          <RailLink key={key} href={href} label={label} Icon={Icon} active={isActive(href)} />
        ))}
      </nav>

      <div className="border-t border-border px-2 pt-3">
        <ThemePicker />
      </div>
    </aside>
  );
}

function RailLink({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-chip px-3 py-2 text-sm font-semibold transition-colors",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-chip hover:text-fg",
      )}
    >
      <Icon className="size-[18px]" />
      {label}
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/shell/desktop-rail.tsx
git commit -m "feat(web): persistent desktop left rail (>= lg)"
```

---

## Task 12: AppShell composition

**Files:**
- Create: `web/components/shell/app-shell.tsx`

Composes the chrome. On phone/tablet: GlassBar + scrolling feed wrapped in `.app-window` (which
slides when the drawer opens) + BottomBar + FAB + Drawer behind. On ≥lg: DesktopRail + centered
`max-w-[720px]` content with normal page scroll, no slide/scrim. Swipe-right opens, swipe-left
closes (touch handlers). Household header data is sourced from existing settings hooks (no API
change); falls back gracefully while loading.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useRef, useState } from "react";
import { useIsDesktop } from "@/lib/shell/use-is-desktop";
import { surfaceTabs, surfaceTitle } from "@/lib/shell/nav";
import { usePathname } from "next/navigation";
import { GlassBar } from "@/components/shell/glass-bar";
import { BottomBar } from "@/components/shell/bottom-bar";
import { Fab } from "@/components/shell/fab";
import { Drawer } from "@/components/shell/drawer";
import { DesktopRail } from "@/components/shell/desktop-rail";
import { useHousehold, useMembers } from "@/lib/api/settings";
import { formatCurrency } from "@/lib/format";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const touchX = useRef<number | null>(null);

  const householdQ = useHousehold();
  const membersQ = useMembers();

  const name = householdQ.data?.name ?? "Household";
  const currency = (householdQ.data as { base_currency?: string } | undefined)?.base_currency ?? "USD";
  const memberCount = membersQ.data?.length ?? 0;
  const household = {
    name,
    initial: name.slice(0, 1).toUpperCase(),
    meta: `Household · ${currency}${memberCount ? ` · ${memberCount} members` : ""}`,
    // Net worth is not a dedicated endpoint; show a placeholder R2 may wire to analytics.
    netWorth: formatCurrency(0, { currency }),
  };

  const title = surfaceTitle(pathname);
  const tabs = surfaceTabs(pathname);

  function onTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current === null || isDesktop) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (dx > 60 && touchX.current < 40) setOpen(true);
    else if (dx < -60 && open) setOpen(false);
    touchX.current = null;
  }

  if (isDesktop) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[1100px]">
        <DesktopRail household={household} />
        <main className="min-w-0 flex-1 px-6 py-8">
          <div className="mx-auto w-full max-w-[720px]">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-dvh overflow-hidden bg-bg"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <Drawer open={open} onClose={() => setOpen(false)} household={household} />

      <div className="app-window relative min-h-dvh bg-bg" data-open={open}>
        <GlassBar
          title={title}
          tabs={tabs}
          avatarInitial={household.initial}
          onOpenDrawer={() => setOpen(true)}
        />
        <div
          className="min-h-dvh overflow-y-auto px-4 pb-28"
          style={{ paddingTop: tabs.length ? 104 : 76 }}
        >
          {children}
        </div>
        {open && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 z-50"
          />
        )}
        <Fab />
        <BottomBar />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/shell/app-shell.tsx
git commit -m "feat(web): AppShell composition with responsive phone/desktop switch"
```

---

## Task 13: Mount AppShell in the app layout

**Files:**
- Modify: `web/app/(app)/layout.tsx` (full replace)

Replaces the old sidebar/topbar layout with `AppShell`. Auth gate is unchanged.

- [ ] **Step 1: Replace the file**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { authStore } from "@/lib/api/auth";
import { AppShell } from "@/components/shell/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!authStore.isAuthenticated()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return <AppShell>{children}</AppShell>;
}
```

- [ ] **Step 2: Commit**

```bash
git add "web/app/(app)/layout.tsx"
git commit -m "feat(web): mount AppShell in (app) layout"
```

---

## Task 14: Cleanup — remove next-themes & dead chrome, fix raw hsl refs

**Files:**
- Delete: `web/components/theme-toggle.tsx`, `web/components/topbar.tsx`,
  `web/components/app-nav.tsx`, `web/components/user-menu.tsx`
- Modify: `web/components/dashboard/cash-flow-chart.tsx`
- Modify: `web/components/ui/sheet.tsx`
- Modify: `web/app/(auth)/login/page.tsx`
- Modify: `web/package.json`

The old chrome is superseded by the shell. `next-themes` is removed. Raw `hsl(var(--…))` strings
become invalid once the HSL block is gone, so chart/sheet/login refs are repointed to the new
tokens.

- [ ] **Step 1: Delete the dead chrome**

```bash
git rm web/components/theme-toggle.tsx web/components/topbar.tsx web/components/app-nav.tsx web/components/user-menu.tsx
```

- [ ] **Step 2: Confirm nothing else imports them or `next-themes`**

Run: `grep -rn "next-themes\|theme-toggle\|components/topbar\|app-nav\|user-menu" web/app web/components`
Expected: **no output**. (If any appears, it is a leftover import to delete.)

- [ ] **Step 3: Fix `web/components/dashboard/cash-flow-chart.tsx`** — replace the five
  `hsl(var(--…))` references. Apply these exact edits:

- `stroke="hsl(var(--border))"` → `stroke="var(--border)"`
- both `fill: "hsl(var(--muted-foreground))"` → `fill: "var(--muted)"`
- `cursor={{ fill: "hsl(var(--muted) / 0.5)" }}` → `cursor={{ fill: "var(--chip)" }}`
- `background: "hsl(var(--popover))"` → `background: "var(--card)"`
- `border: "1px solid hsl(var(--border))"` → `border: "1px solid var(--border)"`
- `color: "hsl(var(--popover-foreground))"` → `color: "var(--fg)"`
- `<Bar dataKey="income" fill="hsl(var(--primary))" ...` → `fill="var(--accent)"`
- `<Bar dataKey="spend" fill="hsl(var(--accent))" ...` → `fill="var(--c2)"`

- [ ] **Step 4: Fix `web/components/ui/sheet.tsx`** — change the `SheetContent` base class
  `bg-sidebar` to `bg-card`:

In the `cn(` for `SheetPrimitive.Content`, replace `"... gap-4 bg-sidebar p-4 shadow-xl ..."`
with `"... gap-4 bg-card p-4 shadow-xl ..."`.

- [ ] **Step 5: Fix `web/app/(auth)/login/page.tsx`** — the background gradient uses
  `hsl(var(--accent) / …)`. Open the file and replace the `backgroundImage` string

```
"radial-gradient(40rem 30rem at 110% -10%, hsl(var(--accent) / 0.35), transparent 60%), radial-gradient(36rem 30rem at -10% 120%, hsl(var(--accent) / 0.18), transparent 55%)"
```

with

```
"radial-gradient(40rem 30rem at 110% -10%, var(--accent-soft), transparent 60%), radial-gradient(36rem 30rem at -10% 120%, var(--accent-soft), transparent 55%)"
```

- [ ] **Step 6: Remove `next-themes` from `web/package.json`** — delete the line
  `"next-themes": "^0.4.6",` from `dependencies`, then run install in the container:

```bash
docker compose exec web npm install
```

- [ ] **Step 7: Commit**

```bash
git add web/components/dashboard/cash-flow-chart.tsx web/components/ui/sheet.tsx "web/app/(auth)/login/page.tsx" web/package.json web/package-lock.json
git commit -m "chore(web): drop next-themes + dead chrome, repoint raw hsl token refs"
```

---

## Task 15: Hero + Sparkline primitives

**Files:**
- Create: `web/components/ui/sparkline.tsx`
- Create: `web/components/ui/hero-card.tsx`

Sparkline is hand-rolled inline SVG (no library, §8). HeroCard is the immersive gradient surface
(§5): `bg-hero`, `shadow-hero`, white text, 32px/800 figure, delta pill on `rgba(255,255,255,.2)`,
80px area sparkline.

- [ ] **Step 1: Create `web/components/ui/sparkline.tsx`**

```tsx
type Props = {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  className?: string;
};

/** Hand-rolled inline SVG sparkline — no chart library (spec §8). */
export function Sparkline({
  data,
  width = 320,
  height = 80,
  stroke = "currentColor",
  fill = "none",
  strokeWidth = 2.6,
  className,
}: Props) {
  if (data.length < 2) {
    return <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = strokeWidth;
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      {fill !== "none" && <path d={area} fill={fill} stroke="none" />}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
```

- [ ] **Step 2: Create `web/components/ui/hero-card.tsx`**

```tsx
import { TrendingDown, TrendingUp } from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";

export function HeroCard({
  label,
  value,
  delta,
  deltaLabel,
  series,
  className,
}: {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  series?: number[];
  className?: string;
}) {
  const showDelta = typeof delta === "number" && Number.isFinite(delta) && delta !== 0;
  const up = (delta ?? 0) > 0;
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-card bg-hero p-[18px_18px_14px] text-white shadow-hero",
        className,
      )}
    >
      <p className="text-xs font-semibold opacity-85">{label}</p>
      <p className="mt-0.5 text-[32px] font-extrabold tracking-[-0.03em] tabular-nums">{value}</p>
      {showDelta && (
        <span className="mt-[7px] inline-flex items-center gap-1.5 rounded-full bg-white/20 px-[9px] py-1 text-xs font-semibold">
          {up ? <TrendingUp className="size-[13px]" /> : <TrendingDown className="size-[13px]" />}
          {deltaLabel}
        </span>
      )}
      {series && series.length > 1 && (
        <Sparkline
          data={series}
          height={80}
          className="mt-2.5 block h-20 w-full text-white"
          stroke="rgba(255,255,255,.95)"
          fill="rgba(255,255,255,.18)"
        />
      )}
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/components/ui/sparkline.tsx web/components/ui/hero-card.tsx
git commit -m "feat(web): HeroCard + inline SVG Sparkline primitives"
```

---

## Task 16: RowList / StatRow / CategoryRow

**Files:**
- Create: `web/components/ui/row-list.tsx`

The list-row is the primary content + nav primitive (§5): tinted 38px icon chip + label + sub +
value (or progress bar) + optional chevron. `RowList` is the card container; `StatRow` is a
value row; `CategoryRow` is a progress-bar row.

- [ ] **Step 1: Create the file**

```tsx
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tint = "accent" | "c2" | "c3";

const TINT: Record<Tint, string> = {
  accent: "bg-accent-soft text-accent",
  c2: "bg-soft2 text-c2",
  c3: "bg-soft3 text-c3",
};

export function RowList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card-sm border border-border bg-card px-3.5 py-1.5 shadow-card",
        "[&>*]:border-b [&>*]:border-border [&>*:last-child]:border-b-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function IconChip({ icon: Icon, tint }: { icon: LucideIcon; tint: Tint }) {
  return (
    <span className={cn("grid size-[38px] flex-none place-items-center rounded-chip", TINT[tint])}>
      <Icon className="size-[18px]" />
    </span>
  );
}

export function StatRow({
  icon,
  tint = "accent",
  label,
  sub,
  value,
  href,
  onClick,
  showChevron = true,
}: {
  icon: LucideIcon;
  tint?: Tint;
  label: string;
  sub?: string;
  value?: string;
  href?: string;
  onClick?: () => void;
  showChevron?: boolean;
}) {
  const interactive = Boolean(href || onClick);
  const Comp: React.ElementType = href ? "a" : interactive ? "button" : "div";
  return (
    <Comp
      {...(href ? { href } : {})}
      {...(onClick ? { onClick, type: "button" } : {})}
      className={cn(
        "flex w-full items-center gap-3.5 py-3 text-left",
        interactive &&
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      )}
    >
      <IconChip icon={icon} tint={tint} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        {sub && <span className="mt-px block text-[11.5px] text-muted">{sub}</span>}
      </span>
      {value && <span className="text-sm font-bold tabular-nums">{value}</span>}
      {interactive && showChevron && <ChevronRight className="size-[18px] flex-none text-muted" />}
    </Comp>
  );
}

export function CategoryRow({
  icon,
  tint = "accent",
  label,
  value,
  pct,
}: {
  icon: LucideIcon;
  tint?: Tint;
  label: string;
  value: string;
  /** 0–100 */
  pct: number;
}) {
  return (
    <div className="flex items-center gap-3.5 py-3">
      <IconChip icon={icon} tint={tint} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="mt-1.5 block h-[5px] w-full overflow-hidden rounded-full bg-track">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </span>
      </span>
      <span className="text-sm font-bold tabular-nums">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/ui/row-list.tsx
git commit -m "feat(web): RowList / StatRow / CategoryRow primitives"
```

---

## Task 17: FeatureCard + SegmentedPills

**Files:**
- Create: `web/components/ui/feature-card.tsx`
- Create: `web/components/ui/segmented-pills.tsx`

FeatureCard is the 2-up gradient tile (§ Dashboard map): "ai" variant uses `bg-hero`, "xb" uses a
fixed blue gradient (mockup). SegmentedPills is the range/segment control (analytics range pills,
§ Analytics).

- [ ] **Step 1: Create `web/components/ui/feature-card.tsx`**

```tsx
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function FeatureCard({
  icon: Icon,
  title,
  href,
  variant,
}: {
  icon: LucideIcon;
  title: string;
  href: string;
  variant: "ai" | "xb";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-[92px] flex-col justify-between overflow-hidden rounded-[18px] p-3.5 text-white",
        "transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        variant === "ai"
          ? "bg-hero"
          : "bg-[linear-gradient(135deg,#1f6feb,#0b3b8c)]",
      )}
    >
      <span className="grid size-[30px] place-items-center rounded-[9px] bg-white/20">
        <Icon className="size-[18px]" />
      </span>
      <span className="text-[13.5px] font-bold leading-tight">{title}</span>
    </Link>
  );
}
```

- [ ] **Step 2: Create `web/components/ui/segmented-pills.tsx`**

```tsx
"use client";

import { cn } from "@/lib/utils";

export function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: ReadonlyArray<{ label: string; value: T }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-full bg-chip p-0.5", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              active ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/components/ui/feature-card.tsx web/components/ui/segmented-pills.tsx
git commit -m "feat(web): FeatureCard + SegmentedPills primitives"
```

---

## Task 18: AreaChart (lazy Recharts) + responsive Sheet

**Files:**
- Create: `web/components/ui/area-chart.tsx`
- Create: `web/components/ui/responsive-sheet.tsx`

AreaChart is the one-chart-per-surface area chart, imported via `next/dynamic({ ssr:false })` so
Recharts is code-split (§8) and themed via CSS vars. ResponsiveSheet renders a bottom sheet on
mobile and a centered dialog on desktop (§7), reusing radix dialog.

- [ ] **Step 1: Create `web/components/ui/area-chart.tsx`**

```tsx
"use client";

import dynamic from "next/dynamic";

export type AreaPoint = { label: string; value: number };

const Impl = dynamic(() => import("./area-chart-impl").then((m) => m.AreaChartImpl), {
  ssr: false,
  loading: () => <div className="h-[220px] w-full animate-pulse rounded-card-sm bg-chip" />,
});

export function AreaChart(props: { data: AreaPoint[]; height?: number }) {
  return <Impl {...props} />;
}
```

- [ ] **Step 2: Create `web/components/ui/area-chart-impl.tsx`**

```tsx
"use client";

import {
  Area,
  AreaChart as RcAreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";
import type { AreaPoint } from "./area-chart";

export function AreaChartImpl({ data, height = 220 }: { data: AreaPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcAreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="cf-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
        />
        <YAxis
          width={48}
          tickFormatter={(v) => formatCurrency(v, { compact: true })}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
        />
        <Tooltip
          cursor={{ fill: "var(--chip)" }}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            color: "var(--fg)",
            fontSize: 12,
          }}
          formatter={(value: number) => [formatCurrency(value), "Net"]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--accent)"
          strokeWidth={2.6}
          fill="url(#cf-area)"
        />
      </RcAreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Create `web/components/ui/responsive-sheet.tsx`**

```tsx
"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useIsDesktop } from "@/lib/shell/use-is-desktop";
import { cn } from "@/lib/utils";

export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  const isDesktop = useIsDesktop();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-card text-fg shadow-card focus:outline-none",
            isDesktop
              ? "left-1/2 top-1/2 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-card p-5 data-[state=open]:animate-in data-[state=open]:zoom-in-95"
              : "inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[22px] p-5 pb-[max(20px,env(safe-area-inset-bottom))] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-base font-extrabold tracking-tight">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 place-items-center rounded-full bg-chip text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add web/components/ui/area-chart.tsx web/components/ui/area-chart-impl.tsx web/components/ui/responsive-sheet.tsx
git commit -m "feat(web): lazy Recharts AreaChart + responsive Sheet primitives"
```

---

## Task 19: Typecheck + build (container)

**Files:** none (verification only)

- [ ] **Step 1: Typecheck in the container**

Run: `docker compose exec web npm run typecheck`
Expected: PASS, no errors. Common failure: a leftover import of a deleted file — fix per the
grep in Task 14 Step 2.

- [ ] **Step 2: Build in the container**

Run: `docker compose exec web npm run build`
Expected: build completes; the route table lists all `(app)` routes; no "Module not found".

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(web): resolve typecheck/build issues after R1 shell migration"
```

(If there were no fixes, skip this commit.)

---

## Task 20: R1 Playwright smoke (host)

**Files:**
- Create: `web/e2e/redesign.spec.ts`

Covers §12 R1-relevant tests: theme persists across reload with no flash + `theme-color` meta
updates; all 6 `data-theme` combos render; drawer opens via avatar and closes via the dimmed
window; reduced-motion path renders instantly. Auth helper mirrors the existing specs.

- [ ] **Step 1: Create the file**

```ts
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function signup(request: APIRequestContext) {
  const res = await request.post(`${API}/auth/signup`, {
    data: { email: EMAIL, password: PASSWORD, display_name: "E2E", household_name: "E2E House" },
  });
  if (res.ok()) return (await res.json()) as { access_token: string; refresh_token: string };
  const login = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD, totp_code: null },
  });
  expect(login.ok(), `login failed: ${login.status()}`).toBeTruthy();
  return (await login.json()) as { access_token: string; refresh_token: string };
}

async function authenticate(page: Page, tokens: { access_token: string; refresh_token: string }) {
  await page.addInitScript(
    (t) => {
      window.localStorage.setItem("cbf.accessToken", t.access);
      window.localStorage.setItem("cbf.refreshToken", t.refresh);
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

test.describe("redesign shell", () => {
  test("dashboard renders under the shell with bottom nav", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation", { name: /primary/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^home$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^insights$/i })).toBeVisible();
  });

  test("theme switch persists across reload and updates theme-color", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", /-(light|dark)$/);

    // open drawer, switch to emerald + dark
    await page.getByRole("button", { name: /open menu/i }).click();
    await page.getByRole("button", { name: /^emerald$/i }).click();
    await page.getByRole("button", { name: /switch to dark mode/i }).click();

    await expect(html).toHaveAttribute("data-theme", "emerald-dark");
    const meta = page.locator('meta[name="theme-color"]');
    await expect(meta).toHaveAttribute("content", "#0b1512");

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "emerald-dark");
  });

  test("all six theme combos apply", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    const combos = [
      "emerald-light",
      "emerald-dark",
      "indigo-light",
      "indigo-dark",
      "ink-light",
      "ink-dark",
    ];
    for (const theme of combos) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
      const bg = await page.evaluate(() =>
        getComputedStyle(document.body).backgroundColor,
      );
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  test("drawer opens via avatar and closes via dimmed window", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");

    const windowEl = page.locator(".app-window");
    await expect(windowEl).toHaveAttribute("data-open", "false");

    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(windowEl).toHaveAttribute("data-open", "true");
    await expect(page.getByRole("complementary", { name: /more/i })).toBeVisible();

    await page.getByRole("button", { name: /close menu/i }).click();
    await expect(windowEl).toHaveAttribute("data-open", "false");
  });

  test("reduced-motion: drawer still toggles state instantly", async ({ browser, request }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(page.locator(".app-window")).toHaveAttribute("data-open", "true");
    await context.close();
  });
});
```

- [ ] **Step 2: Run on the host**

Run: `cd web && npx playwright test e2e/redesign.spec.ts`
Expected: 5 passed. (Backend + web dev/preview server must be reachable per `playwright.config`.)

- [ ] **Step 3: Commit**

```bash
git add web/e2e/redesign.spec.ts
git commit -m "test(web): R1 shell + theme + drawer Playwright smoke"
```

---

## Self-review (against the spec)

- **§4 theme tokens** — all 6 combos verbatim (Task 1); cookie SSR no-flash (Task 6); Tailwind
  mapping (Task 2); `next-themes` dropped (Task 14); `theme-color` tracks `--app-bg` (Tasks 3, 6,
  4). ✓
- **§5 visual language** — radii (Task 2); hero 32px/800 + delta pill + 80px SVG (Task 15);
  list-row 38px tinted chip + chevron (Task 16); glass-on-chrome-only + light-shadow/dark-border
  via tokens (Tasks 1, 8, 9, 10). ✓
- **§6 motion** — window `translateX(76%) scale(.84)` blur/dim + drawer reveal, 420ms
  `cubic-bezier(.32,.72,0,1)`, transform/opacity/filter only, reduced-motion instant (Task 1 CSS +
  Tasks 10, 12). ✓
- **§7 inventory + icon map** — AppShell, GlassBar, Drawer, TopTabs, BottomBar, Fab, HeroCard,
  RowList/StatRow, CategoryRow, FeatureCard, Sparkline, AreaChart, SegmentedPills, ResponsiveSheet,
  ThemePicker all created; icons from §7.1 in `lib/icons.ts` (Tasks 7–18). ✓
- **§8 charts/perf** — Sparkline hand-rolled SVG; AreaChart lazy Recharts `ssr:false`; glass on 3
  chrome elements only (Tasks 15, 18). ✓
- **§9 responsive** — `useIsDesktop()` at lg=1024; rail at ≥lg, no bottom bar/FAB, `max-w-[720px]`
  centered (Tasks 7, 11, 12). ✓
- **§12 testing (R1 scope)** — theme persistence/no-flash/6-combos, drawer open/close, reduced
  motion; typecheck + build in container, Playwright on host (Tasks 19, 20). ✓
- **Deferred to R2/R3 (out of R1 scope):** per-surface re-skin and surface smokes (R2); PWA
  install prompt / safe-area polish / web-push wiring / offline states (R3); Net-worth drawer value
  (placeholder in Task 12 — R2 wires to analytics); the Cross-border IA decision (plan header).

---

## Execution handoff

Plan saved. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in this session with checkpoints.

After R1 lands and is reviewed, R2 (surface re-skins) and R3 (PWA + tests) plans follow.
