# M15 Redesign — R3 PWA Polish + Tests Implementation Plan

> **For the implementing agent (Codex):** This plan is **prescriptive**. Each task gives the
> **exact, complete file contents** or surgical edits. Apply verbatim. Do not touch backend, API
> request logic, the Dexie engine (`web/lib/offline/*` internals), or auth. After each task run the
> listed verification and confirm before moving on. Steps use `- [ ]` for tracking.
>
> **REQUIRES R1 + R2 MERGED.** Consumes the shell (`AppShell`, `Drawer`), `ThemeProvider`/
> `ThemePicker`, the tokens, and `useIsDesktop`.
>
> **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans.

**Goal:** Turn the starter serwist PWA into the real thing (§10) — branded install prompt with iOS
A2HS fallback, standalone/safe-area polish, an offline banner over the existing Dexie capture
queue, app-like route transitions — and close out the redesign test matrix (§12): theme persists
across all 6 combos with no flash, drawer focus/reduced-motion, and a11y.

**Architecture:** A small `lib/pwa/*` layer captures `beforeinstallprompt` and detects
iOS/standalone; an `InstallButton` surfaces in the Drawer footer + Settings Appearance panel and
opens an A2HS instructions sheet on iOS. An `OfflineBanner` (driven by `online`/`offline` events,
not Dexie internals) mounts in `AppShell`. A route `template.tsx` adds a reduced-motion-gated fade.
The static `manifest.webmanifest` is rebranded and its colors aligned to the default theme; the
**dynamic** `theme-color` meta is already handled by `ThemeProvider` (R1). **Web-push (VAPID)
subscription is a documented, blocked follow-up** (Task 6) — no push endpoint exists in the API
schema yet; the Activity prefs UI already ships best-effort browser permission.

**Tech Stack:** unchanged. No new deps (`@serwist/next` already wired in `next.config.mjs`).

**Spec:** `docs/superpowers/specs/2026-06-15-m15-frontend-redesign-design.md` §10 (PWA), §12
(testing), §13 (acceptance). **Branding:** app name is **CodeName-Finance**; cross-border is just a
module; English-only.

> **Note on testing PWA in dev:** `next.config.mjs` disables the service worker in development and
> `SwRegister` only registers in production. So SW *caching* behavior needs a production build
> (`npm run build && npm run start`). The Playwright tests in Task 7 assert **UI presence**
> (install entry, offline banner, A2HS sheet) and theme/drawer/a11y — all of which work in dev —
> plus one build-served SW smoke.

---

## File map (R3)

**Create:**
- `web/lib/pwa/use-install-prompt.ts` — capture `beforeinstallprompt`, iOS/standalone detection.
- `web/components/pwa/install-button.tsx` — install entry + iOS A2HS instructions sheet.
- `web/components/pwa/offline-banner.tsx` — connectivity banner.
- `web/app/(app)/template.tsx` — route fade transition (reduced-motion gated).
- `web/e2e/redesign-pwa.spec.ts` — install/offline/SW UI smokes.
- `web/e2e/redesign-a11y.spec.ts` — theme combos, drawer focus, reduced motion, focus-visible.

**Modify:**
- `web/public/manifest.webmanifest` — rebrand + themed colors + fix shortcut URLs.
- `web/components/shell/drawer.tsx` — mount `InstallButton` in the footer.
- `web/app/(app)/settings/page.tsx` — add `InstallButton` to the Appearance panel.
- `web/components/shell/app-shell.tsx` — mount `OfflineBanner` (both phone + desktop branches).

---

## Task 1: Rebrand + theme the manifest

**Files:**
- Modify: `web/public/manifest.webmanifest` (full replace)

Rebrand to CodeName-Finance, align `background_color`/`theme_color` to the default theme's
`--app-bg` (`indigo-light` = `#f1f1fa`), and fix the shortcut URLs (the old `/?surface=capture`
deep-links don't route in the new shell — point them at the real routes).

- [ ] **Step 1: Replace the file**

```json
{
  "name": "CodeName-Finance",
  "short_name": "Finance",
  "description": "Document-driven, AI-assisted personal finance.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "display_override": ["window-controls-overlay", "standalone", "browser"],
  "orientation": "portrait",
  "background_color": "#f1f1fa",
  "theme_color": "#f1f1fa",
  "categories": ["finance", "productivity"],
  "shortcuts": [
    {
      "name": "Capture receipt",
      "short_name": "Capture",
      "url": "/capture",
      "icons": [{ "src": "/icons/icon.svg", "sizes": "any", "type": "image/svg+xml" }]
    },
    {
      "name": "Review queue",
      "short_name": "Review",
      "url": "/review",
      "icons": [{ "src": "/icons/icon.svg", "sizes": "any", "type": "image/svg+xml" }]
    }
  ],
  "icons": [
    {
      "src": "/icons/icon.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any"
    },
    {
      "src": "/icons/maskable.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "maskable"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add web/public/manifest.webmanifest
git commit -m "feat(web): rebrand manifest to CodeName-Finance + theme colors + fix shortcuts"
```

---

## Task 2: Install-prompt hook

**Files:**
- Create: `web/lib/pwa/use-install-prompt.ts`

Captures `beforeinstallprompt` (Chromium), exposes `promptInstall()`, and detects iOS Safari +
standalone so the UI can show the A2HS fallback only where needed.

- [ ] **Step 1: Create the file**

```ts
"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function detectIsIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsIOS(detectIsIOS());
    setIsStandalone(detectStandalone());

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!deferred) return "unavailable";
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome;
  }

  return {
    /** Chromium native prompt is available. */
    canInstall: deferred !== null,
    /** Already running as an installed app. */
    isStandalone,
    /** iOS Safari — needs manual Add-to-Home-Screen. */
    isIOS,
    installed,
    promptInstall,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/lib/pwa/use-install-prompt.ts
git commit -m "feat(web): useInstallPrompt — beforeinstallprompt + iOS/standalone detection"
```

---

## Task 3: InstallButton + iOS A2HS sheet

**Files:**
- Create: `web/components/pwa/install-button.tsx`

A branded "Install app" entry. On Chromium it fires the native prompt; on iOS it opens a
`ResponsiveSheet` with Add-to-Home-Screen steps; when already standalone it renders nothing.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useState } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { cn } from "@/lib/utils";

export function InstallButton({ className }: { className?: string }) {
  const { canInstall, isIOS, isStandalone, promptInstall } = useInstallPrompt();
  const [iosOpen, setIosOpen] = useState(false);

  // Nothing to do when already installed, or when neither path is available.
  if (isStandalone) return null;
  if (!canInstall && !isIOS) return null;

  async function onClick() {
    if (canInstall) {
      const outcome = await promptInstall();
      if (outcome === "accepted") toast.success("Installing app…");
      return;
    }
    setIosOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex items-center gap-2 text-[13px] font-semibold text-accent transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          className,
        )}
      >
        <Download className="size-4" />
        Install app
      </button>

      <ResponsiveSheet open={iosOpen} onOpenChange={setIosOpen} title="Install on iPhone">
        <ol className="space-y-3 text-sm">
          <li className="flex items-center gap-3">
            <Share className="size-5 flex-none text-accent" />
            Tap the <b>Share</b> button in Safari&apos;s toolbar.
          </li>
          <li className="flex items-center gap-3">
            <SquarePlus className="size-5 flex-none text-accent" />
            Choose <b>Add to Home Screen</b>.
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-5 flex-none place-items-center rounded-chip bg-accent-soft text-[11px] font-bold text-accent">
              ✓
            </span>
            Tap <b>Add</b> — CodeName-Finance opens full-screen from your home screen.
          </li>
        </ol>
      </ResponsiveSheet>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/pwa/install-button.tsx
git commit -m "feat(web): InstallButton with native prompt + iOS A2HS instructions sheet"
```

---

## Task 4: OfflineBanner

**Files:**
- Create: `web/components/pwa/offline-banner.tsx`

A slim banner shown when the browser goes offline (the capture queue keeps working — §10). Driven
by `online`/`offline` window events; does not reach into Dexie internals. SSR-safe (assumes online
until mounted).

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-c2 px-4 py-1.5 text-center text-xs font-semibold text-white"
      style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
    >
      <CloudOff className="size-3.5" />
      Offline — captures will sync when you reconnect
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/pwa/offline-banner.tsx
git commit -m "feat(web): OfflineBanner driven by connectivity events"
```

---

## Task 5: Mount install + offline UI in the shell

**Files:**
- Modify: `web/components/shell/app-shell.tsx`
- Modify: `web/components/shell/drawer.tsx`
- Modify: `web/app/(app)/settings/page.tsx`

- [ ] **Step 1: `app-shell.tsx`** — import and render `OfflineBanner` in both branches. Add the
  import near the other shell imports:

```tsx
import { OfflineBanner } from "@/components/pwa/offline-banner";
```

In the **desktop** branch, change:

```tsx
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[1100px]">
        <DesktopRail household={household} />
```

to:

```tsx
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[1100px]">
        <OfflineBanner />
        <DesktopRail household={household} />
```

In the **phone** branch, change the opening of the returned container:

```tsx
    <div
      className="relative min-h-dvh overflow-hidden bg-bg"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <Drawer open={open} onClose={() => setOpen(false)} household={household} />
```

to:

```tsx
    <div
      className="relative min-h-dvh overflow-hidden bg-bg"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <OfflineBanner />
      <Drawer open={open} onClose={() => setOpen(false)} household={household} />
```

- [ ] **Step 2: `drawer.tsx`** — surface `InstallButton` in the footer next to Sign out. Add the
  import:

```tsx
import { InstallButton } from "@/components/pwa/install-button";
```

Replace the footer block:

```tsx
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
```

with:

```tsx
      <div className="mt-3 space-y-3 border-t border-border px-5 pt-3">
        <div className="flex items-center justify-between">
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
        <InstallButton />
      </div>
```

- [ ] **Step 3: `settings/page.tsx`** — add `InstallButton` to the Appearance panel (created in R2
  Task 12). Add the import:

```tsx
import { InstallButton } from "@/components/pwa/install-button";
```

Replace the Appearance panel body:

```tsx
      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <h2 className="text-base font-bold tracking-tight">Appearance</h2>
        <p className="text-sm text-muted">Palette and light/dark mode.</p>
        <div className="mt-4">
          <ThemePicker />
        </div>
      </div>
```

with:

```tsx
      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <h2 className="text-base font-bold tracking-tight">Appearance</h2>
        <p className="text-sm text-muted">Palette and light/dark mode.</p>
        <div className="mt-4 flex items-center justify-between gap-4">
          <ThemePicker />
          <InstallButton />
        </div>
      </div>
```

- [ ] **Step 4: Typecheck + commit**

```bash
docker compose exec web npm run typecheck
git add web/components/shell/app-shell.tsx web/components/shell/drawer.tsx "web/app/(app)/settings/page.tsx"
git commit -m "feat(web): mount OfflineBanner + InstallButton in shell, drawer, settings"
```

---

## Task 6: Route transition (reduced-motion gated)

**Files:**
- Create: `web/app/(app)/template.tsx`

A `template.tsx` re-mounts on navigation, enabling an app-like fade/slide (§10). The animation is
defined with `tailwindcss-animate` utilities and is automatically disabled by the global
`prefers-reduced-motion` rule from R1 (Task 1 globals.css).

- [ ] **Step 1: Create the file**

```tsx
"use client";

export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "web/app/(app)/template.tsx"
git commit -m "feat(web): app-like route fade transition (reduced-motion gated)"
```

> **Pull-to-refresh** (§10 "optional") is intentionally **not** implemented — it conflicts with the
> bottom-sheet/drawer touch handling and is marked optional in the spec. Revisit only if requested.

---

## Task 7: Web-push (VAPID) — DEFERRED follow-up (do not implement yet)

**Status: BLOCKED.** Spec §10 lists web-push subscription wiring as a defined follow-up "(backend
endpoints exist)". **As of this plan the generated API schema (`shared/api-schema.ts`) exposes no
push-subscription or VAPID endpoint** (`/notifications` has only list, `/{id}/read`, and
`/preferences`). The Activity surface already ships channel prefs + best-effort
`Notification.requestPermission()` (existing code), so nothing is blocked for users.

- [ ] **Step 1: Confirm precondition before doing any work.** Run:

```bash
grep -rin "push\|vapid\|subscription\|webpush" shared/api-schema.ts
```

If this returns **no results**, STOP — the backend push endpoint must be added + the schema
regenerated (`cd web && npm run gen:api`) first. Do not invent an endpoint path. Leave this task
unchecked and proceed to Task 8.

- [ ] **Step 2 (only once an endpoint exists):** implement the subscription flow in a new
  `web/lib/pwa/use-push.ts` — request permission, `await navigator.serviceWorker.ready`, call
  `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` using a
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` env var, and POST the subscription to the confirmed endpoint via
  the typed `api` client. Wire a "Enable push" control into the Notifications prefs panel next to
  the existing `push` channel checkbox. (Detailed steps to be written when the endpoint lands.)

---

## Task 8: A11y + theme + drawer test sweep

**Files:**
- Create: `web/e2e/redesign-a11y.spec.ts`

Covers the remaining §12/§13 items: all 6 `data-theme` combos render with non-transparent surfaces,
theme persists with no flash, drawer focus moves in/returns and Escape closes, reduced-motion path
is instant, and key controls are keyboard-focusable (`:focus-visible`).

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

const COMBOS = [
  { theme: "emerald-light", bg: "#eef3f0" },
  { theme: "emerald-dark", bg: "#0b1512" },
  { theme: "indigo-light", bg: "#f1f1fa" },
  { theme: "indigo-dark", bg: "#0e0d16" },
  { theme: "ink-light", bg: "#f3f5f8" },
  { theme: "ink-dark", bg: "#0c0e12" },
];

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

test.describe("theme + a11y", () => {
  test("every theme combo paints its --app-bg", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    for (const { theme, bg } of COMBOS) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(body).toBe(hexToRgb(bg));
    }
  });

  test("theme persists with no flash across reload", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /open menu/i }).click();
    await page.getByRole("button", { name: /^ink$/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "ink-light");
    await page.reload();
    // SSR cookie read => the very first painted attribute is already ink-light (no flash).
    await expect(page.locator("html")).toHaveAttribute("data-theme", "ink-light");
  });

  test("drawer: focus enters, Escape closes", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /open menu/i }).click();
    const drawer = page.getByRole("complementary", { name: /more/i });
    await expect(drawer).toBeVisible();
    // first focusable inside the drawer receives focus
    await expect(drawer.getByRole("link").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".app-window")).toHaveAttribute("data-open", "false");
  });

  test("reduced motion: drawer toggles instantly", async ({ browser, request }) => {
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

- [ ] **Step 2: Run on host**

```bash
cd web && npx playwright test e2e/redesign-a11y.spec.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/redesign-a11y.spec.ts
git commit -m "test(web): theme combos, no-flash persist, drawer focus + reduced motion"
```

---

## Task 9: PWA UI smokes + production SW build

**Files:**
- Create: `web/e2e/redesign-pwa.spec.ts`

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

test.describe("pwa", () => {
  test("manifest is served and branded", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.name).toBe("CodeName-Finance");
    expect(json.theme_color).toBe("#f1f1fa");
  });

  test("offline banner appears when context goes offline", async ({ browser, request }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("status")).toContainText(/offline/i);
    await context.setOffline(false);
    await context.close();
  });

  test("install entry surfaces a path on iOS UA", async ({ browser, request }) => {
    // Force an iOS user agent so the A2HS branch renders without a native prompt.
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();
    await authenticate(page, await signup(request));
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: /install app/i })).toBeVisible();
    await page.getByRole("button", { name: /install app/i }).click();
    await expect(page.getByText(/add to home screen/i)).toBeVisible();
    await context.close();
  });
});
```

- [ ] **Step 2: Run on host (dev server is fine for these UI assertions)**

```bash
cd web && npx playwright test e2e/redesign-pwa.spec.ts
```

Expected: all pass.

- [ ] **Step 3: Production SW smoke (manual, build-served).** The service worker only registers in
  a production build. Verify once:

```bash
docker compose exec web npm run build
docker compose exec web npm run start &
# then, against the started server, confirm the SW file is served and registers:
curl -sf http://localhost:3000/sw.js | head -c 80
```

Expected: `/sw.js` returns the serwist bundle (non-empty). Stop the started server afterward.

- [ ] **Step 4: Commit**

```bash
git add web/e2e/redesign-pwa.spec.ts
git commit -m "test(web): PWA manifest/offline/install UI smokes"
```

---

## Task 10: Final gate — typecheck, build, full e2e

**Files:** none (verification only)

- [ ] **Step 1: Container typecheck + build**

```bash
docker compose exec web npm run typecheck
docker compose exec web npm run build
```

Expected: both pass.

- [ ] **Step 2: Full Playwright suite on host**

```bash
cd web && npx playwright test
```

Expected: green — `redesign.spec.ts` (R1), `redesign-surfaces.spec.ts` (R2),
`redesign-a11y.spec.ts`, `redesign-pwa.spec.ts` (R3), and the updated `w2/w3/w4.spec.ts`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(web): resolve final R3 typecheck/build/e2e issues"
```

(Skip if there were none.)

---

## Self-review (against the spec)

- **§10 install prompt** — `beforeinstallprompt` captured; branded "Install app" in drawer +
  Settings; iOS A2HS instructions sheet (Tasks 2, 3, 5). ✓
- **§10 standalone polish** — `display: standalone` + safe-area insets already on bars/FAB (R1) and
  banner (Task 4); themed status bar via dynamic `theme-color` (R1) + manifest colors (Task 1);
  maskable icon present. ✓
- **§10 offline** — connectivity banner over the existing Dexie queue; capture queued/syncing/
  failed/retry states already shipped in the Capture surface (R2 Task 3); Dexie internals untouched
  (Task 4). ✓
- **§10 route transitions** — `template.tsx` fade, reduced-motion gated (Task 6). Pull-to-refresh
  intentionally skipped (spec-optional). ✓
- **§10 web-push** — documented as a blocked follow-up; no endpoint fabricated; precondition grep
  gates implementation (Task 7). Activity prefs UI unaffected. ✓
- **§12 testing** — theme persistence + no-flash + all 6 combos; drawer focus + Escape; reduced
  motion; manifest/offline/install UI; production SW smoke; typecheck + build in container,
  Playwright on host (Tasks 8, 9, 10). ✓
- **§13 acceptance** — combined across R1–R3: 12 surfaces under the shell with 3-tier nav (R2 +
  R3 surface smoke); 6 palette/mode combos persisted no-FOUC (R1 + Task 8); glass on 3 chrome
  elements only (R1); drawer motion + reduced-motion (R1 + Task 8); no emoji / §7.1 icons (R1/R2);
  no backend/API/Dexie/auth changes (all three plans); typecheck/build/Playwright green (Task 10). ✓
- **Open item:** Net-worth value in the drawer/rail header is still a placeholder from R1 Task 12 —
  wire to an analytics-derived figure if/when desired (not a spec acceptance criterion).

---

## Execution handoff

Plan saved. Execute via superpowers:subagent-driven-development (fresh subagent per task, review
between) or superpowers:executing-plans (inline with checkpoints). This completes the M15 redesign
plan set: **R1 (foundation) → R2 (surfaces) → R3 (PWA + tests).**
