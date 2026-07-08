# M15 Frontend Rebuild — W0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the M15 frontend platform in place in `web/` — the spec stack wired end-to-end (shadcn/ui, TanStack Query, generated typed API client, next-intl, @serwist/next PWA, Playwright) plus the app shell, nav, and a working auth+MFA flow — so feature surfaces (W1–W4) can be built on top.

**Architecture:** Keep the existing Next 15 App Router project and Dockerfile. Replace the single-page monolith with route groups `(auth)` and `(app)`, a providers tree (QueryClient + NextIntl + theme), a typed client generated from the live FastAPI `/openapi.json`, and a serwist-generated service worker. Locale is a cookie-driven setting (no URL prefixes), matching M16 `settings.language`.

**Tech Stack:** Next.js 15.1, React 19, Tailwind 3.4, shadcn/ui, @tanstack/react-query 5, openapi-typescript + openapi-fetch, next-intl 3, @serwist/next 9, Recharts 2, Dexie 4, @playwright/test.

---

## Environment notes (read first)

- The app runs in the `web` Docker container (`docker compose ... up`), source volume-mounted at `/app`, with `node_modules` in an anonymous volume. After editing `package.json`, install **inside the container**: `docker compose exec web npm install`.
- The backend is live at `http://localhost:8000` (host) / `http://api:8000` (compose network). `/openapi.json` returns 200 with 83 paths.
- Run `tsc`/`build` checks **inside the container**: `docker compose exec web <cmd>`.
- Run **Playwright on the host** (host has Node 22; container is `node:slim` with no browsers). The app is reachable at `http://localhost:3000`.
- All `git` commands run from the repo root `/Users/kshtj/CourseWork/Study/Projects/CodeName-Missing` (already a git repo, branch `main`).
- The API generator script writes to `../shared/` (repo-level `shared/`), replacing the hand-written `shared/api-types.ts`.

---

## File structure (created/modified in W0)

```
web/
  package.json                      # MODIFY: deps + scripts
  next.config.mjs                   # MODIFY: compose withSerwist(withNextIntl(...))
  tailwind.config.ts                # MODIFY: shadcn tokens + tailwindcss-animate
  components.json                   # CREATE: shadcn config (via CLI)
  app/
    globals.css                     # MODIFY: shadcn CSS variables
    layout.tsx                      # MODIFY: html lang from locale, providers, SW register
    page.tsx                        # MODIFY: redirect to /dashboard
    providers.tsx                   # CREATE: QueryClient + NextIntl + theme providers
    sw.ts                           # CREATE: serwist service worker source
    (auth)/login/page.tsx           # CREATE: login + MFA form
    (app)/layout.tsx                # CREATE: auth guard + nav shell
    (app)/dashboard/page.tsx        # CREATE: placeholder landing (real build is W1)
  components/
    ui/                             # CREATE: shadcn primitives (via CLI)
    app-nav.tsx                     # CREATE: sidebar/bottom nav
    sw-register.tsx                 # CREATE: registers serwist SW (replaces ServiceWorkerRegister)
  lib/
    api/
      schema.ts                     # GENERATED: re-export of ../../shared/api-schema types
      client.ts                     # CREATE: openapi-fetch client + auth middleware
      auth.ts                       # CREATE: token store (ported from old lib/api.ts)
    i18n/
      request.ts                    # CREATE: next-intl getRequestConfig (cookie locale)
      locale.ts                     # CREATE: get/set NEXT_LOCALE cookie helpers
      messages/en.json              # CREATE: English catalog (shell strings)
      messages/hi.json              # CREATE: Hindi/Hinglish catalog (shell strings)
    utils.ts                        # CREATE: cn() helper (via shadcn init)
  e2e/
    smoke.spec.ts                   # CREATE: Playwright smoke (login page + SW)
  playwright.config.ts              # CREATE: Playwright config (host runner)
  REBUILD_PROGRESS.md               # CREATE: per-surface continuation tracker
shared/
  api-schema.ts                     # GENERATED: openapi-typescript output (replaces api-types.ts)
```

Files **removed** at the end of W0 (superseded): `web/public/sw.js` (hand-rolled), `web/components/ServiceWorkerRegister.tsx`. The monolith `web/components/FinancePwaApp.tsx` and `web/lib/api.ts` / `web/lib/offlineQueue.ts` are **kept as reference** until their surfaces are rebuilt in W1+ (do not delete in W0).

---

## Task 1: Add dependencies and scripts

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Edit `web/package.json`** to the following (replaces the `dependencies`, `devDependencies`, and `scripts` blocks; keep `name`/`version`/`private`):

```json
{
  "name": "cross-border-finance-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "gen:api": "openapi-typescript http://localhost:8000/openapi.json -o ../shared/api-schema.ts",
    "e2e": "playwright test"
  },
  "dependencies": {
    "next": "15.1.3",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "@tanstack/react-query": "^5.62.0",
    "openapi-fetch": "^0.13.0",
    "next-intl": "^3.26.0",
    "recharts": "^2.15.0",
    "dexie": "^4.0.10",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "tailwindcss-animate": "^1.0.7",
    "lucide-react": "^0.469.0",
    "@radix-ui/react-slot": "^1.1.1",
    "@serwist/next": "^9.0.11"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "@types/react": "19.0.2",
    "@types/react-dom": "19.0.2",
    "autoprefixer": "10.4.20",
    "postcss": "8.4.49",
    "tailwindcss": "3.4.17",
    "typescript": "5.7.2",
    "openapi-typescript": "^7.5.0",
    "serwist": "^9.0.11",
    "@playwright/test": "^1.49.1"
  }
}
```

- [ ] **Step 2: Install inside the container**

Run: `docker compose exec web npm install --legacy-peer-deps`
Expected: completes; `added N packages`. (`--legacy-peer-deps` avoids React 19 peer conflicts from shadcn/radix deps.)

- [ ] **Step 3: Verify the app still boots**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/`
Expected: `200`

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "build(web): add M15 frontend stack dependencies"
```

---

## Task 2: Generate the typed API client

**Files:**
- Create (generated): `shared/api-schema.ts`
- Create: `web/lib/api/auth.ts`
- Create: `web/lib/api/client.ts`
- Delete: `shared/api-types.ts`

- [ ] **Step 1: Generate types from the live OpenAPI doc** (run on host — has Node + reaches `:8000`)

Run: `cd web && npx openapi-typescript http://localhost:8000/openapi.json -o ../shared/api-schema.ts && cd ..`
Expected: writes `shared/api-schema.ts` containing `export interface paths { ... }`.

- [ ] **Step 2: Verify it generated real paths**

Run: `grep -c '"/' shared/api-schema.ts`
Expected: a number ≥ 80 (one entry per OpenAPI path).

- [ ] **Step 3: Create `web/lib/api/auth.ts`** (token store, ported from the old `lib/api.ts`):

```ts
const ACCESS_KEY = "cbf.accessToken";
const REFRESH_KEY = "cbf.refreshToken";

const isBrowser = () => typeof window !== "undefined";

function read(key: string): string | null {
  return isBrowser() ? window.localStorage.getItem(key) : null;
}
function write(key: string, value: string | null) {
  if (!isBrowser()) return;
  if (value) window.localStorage.setItem(key, value);
  else window.localStorage.removeItem(key);
}

export type TokenPair = { access_token: string; refresh_token: string; token_type?: string };

export const authStore = {
  get access() {
    return read(ACCESS_KEY);
  },
  get refresh() {
    return read(REFRESH_KEY);
  },
  isAuthenticated() {
    return Boolean(read(ACCESS_KEY));
  },
  set(tokens: TokenPair) {
    write(ACCESS_KEY, tokens.access_token);
    write(REFRESH_KEY, tokens.refresh_token);
  },
  clear() {
    write(ACCESS_KEY, null);
    write(REFRESH_KEY, null);
  },
};
```

- [ ] **Step 4: Create `web/lib/api/client.ts`** (openapi-fetch client + auth middleware + 401 refresh):

```ts
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "@shared/api-schema";
import { authStore, type TokenPair } from "./auth";

const BROWSER_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SERVER_URL = process.env.API_INTERNAL_URL ?? BROWSER_URL;
export const apiBaseUrl = typeof window === "undefined" ? SERVER_URL : BROWSER_URL;

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refresh_token = authStore.refresh;
  if (!refresh_token) return false;
  const res = await fetch(`${apiBaseUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token }),
  });
  if (!res.ok) {
    authStore.clear();
    return false;
  }
  authStore.set((await res.json()) as TokenPair);
  return true;
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = authStore.access;
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
  async onResponse({ request, response }) {
    if (response.status !== 401 || request.url.includes("/auth/")) return response;
    refreshing ??= refreshTokens().finally(() => {
      refreshing = null;
    });
    const ok = await refreshing;
    if (!ok) return response;
    const retry = new Request(request.url, request);
    retry.headers.set("Authorization", `Bearer ${authStore.access}`);
    return fetch(retry);
  },
};

export const api = createClient<paths>({ baseUrl: apiBaseUrl });
api.use(authMiddleware);
```

- [ ] **Step 5: Add the `@shared/*` path alias** — edit `web/tsconfig.json` `compilerOptions.paths` to:

```json
"paths": { "@/*": ["./*"], "@shared/*": ["../shared/*"] }
```

- [ ] **Step 6: Delete the hand-written types**

Run: `git rm shared/api-types.ts`
Expected: file staged for deletion. (No imports reference it in the new code; the old monolith uses inline `Obj` types, not this file.)

- [ ] **Step 7: Typecheck**

Run: `docker compose exec web npm run typecheck`
Expected: no errors referencing `lib/api/*` or `@shared/api-schema`.

- [ ] **Step 8: Commit**

```bash
git add shared/api-schema.ts web/lib/api/auth.ts web/lib/api/client.ts web/tsconfig.json
git rm shared/api-types.ts
git commit -m "feat(web): generated typed API client with auth + refresh middleware"
```

---

## Task 3: Initialize shadcn/ui and theme

**Files:**
- Create: `web/components.json`, `web/lib/utils.ts`, `web/components/ui/*`
- Modify: `web/tailwind.config.ts`, `web/app/globals.css`

- [ ] **Step 1: Run the shadcn init** (host)

Run: `cd web && npx shadcn@latest init -d --force && cd ..`
Expected: creates `components.json`, `lib/utils.ts` (with `cn()`), rewrites `app/globals.css` with CSS variables, updates `tailwind.config.ts`. `-d` accepts defaults (New York style, neutral base color, CSS variables). If it prompts about peer deps, re-run with `--force`.

- [ ] **Step 2: Confirm `cn()` exists**

Run: `grep -n "export function cn" web/lib/utils.ts`
Expected: one match.

- [ ] **Step 3: Add the base primitives W0 needs**

Run: `cd web && npx shadcn@latest add button card input label sonner --force && cd ..`
Expected: creates `components/ui/button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `sonner.tsx`.

- [ ] **Step 4: Ensure `tailwindcss-animate` is in the Tailwind plugins** — verify `web/tailwind.config.ts` `plugins` array includes `require("tailwindcss-animate")` (shadcn init adds it). If missing, add it.

- [ ] **Step 5: Typecheck + build**

Run: `docker compose exec web npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/components.json web/lib/utils.ts web/components/ui web/tailwind.config.ts web/app/globals.css
git commit -m "feat(web): init shadcn/ui design system and base primitives"
```

---

## Task 4: Internationalization (next-intl, cookie locale)

**Files:**
- Create: `web/lib/i18n/request.ts`, `web/lib/i18n/locale.ts`, `web/lib/i18n/messages/en.json`, `web/lib/i18n/messages/hi.json`
- Modify: `web/next.config.mjs`

- [ ] **Step 1: Create `web/lib/i18n/locale.ts`**:

```ts
import { cookies } from "next/headers";

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE;
}
```

- [ ] **Step 2: Create `web/lib/i18n/request.ts`**:

```ts
import { getRequestConfig } from "next-intl/server";
import { getLocale } from "./locale";

export default getRequestConfig(async () => {
  const locale = await getLocale();
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 3: Create `web/lib/i18n/messages/en.json`** (shell strings; surfaces add their own keys in later waves):

```json
{
  "app": { "name": "Cross-Border Finance" },
  "nav": {
    "dashboard": "Dashboard",
    "capture": "Capture",
    "review": "Review",
    "transactions": "Transactions",
    "analytics": "Analytics",
    "budgets": "Budgets",
    "debt": "Debt",
    "income": "Income",
    "guidance": "Guidance",
    "notifications": "Notifications",
    "connections": "Connections",
    "settings": "Settings",
    "logout": "Log out"
  },
  "auth": {
    "loginTitle": "Sign in",
    "email": "Email",
    "password": "Password",
    "totp": "Authenticator code",
    "totpHint": "Enter your 6-digit code if MFA is enabled.",
    "submit": "Sign in",
    "error": "Sign in failed. Check your credentials."
  }
}
```

- [ ] **Step 4: Create `web/lib/i18n/messages/hi.json`** (Hindi/Hinglish; same keys):

```json
{
  "app": { "name": "क्रॉस-बॉर्डर फाइनेंस" },
  "nav": {
    "dashboard": "डैशबोर्ड",
    "capture": "कैप्चर",
    "review": "रिव्यू",
    "transactions": "ट्रांज़ैक्शन",
    "analytics": "एनालिटिक्स",
    "budgets": "बजट",
    "debt": "कर्ज़",
    "income": "इनकम",
    "guidance": "गाइडेंस",
    "notifications": "नोटिफिकेशन",
    "connections": "कनेक्शन",
    "settings": "सेटिंग्स",
    "logout": "लॉग आउट"
  },
  "auth": {
    "loginTitle": "साइन इन करें",
    "email": "ईमेल",
    "password": "पासवर्ड",
    "totp": "ऑथेंटिकेटर कोड",
    "totpHint": "अगर MFA चालू है तो अपना 6-अंकों का कोड डालें।",
    "submit": "साइन इन",
    "error": "साइन इन फेल हुआ। अपनी डिटेल्स चेक करें।"
  }
}
```

- [ ] **Step 5: Wire the next-intl plugin** — this is composed with serwist in Task 8. For now edit `web/next.config.mjs`:

```js
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
```

- [ ] **Step 6: Restart dev server to load the plugin, then verify boot**

Run: `docker compose restart web && sleep 6 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/`
Expected: `200`

- [ ] **Step 7: Commit**

```bash
git add web/lib/i18n web/next.config.mjs
git commit -m "feat(web): next-intl i18n with cookie locale (en + hi)"
```

---

## Task 5: Providers tree

**Files:**
- Create: `web/app/providers.tsx`
- Modify: `web/app/layout.tsx`

- [ ] **Step 1: Create `web/app/providers.tsx`**:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 2: Rewrite `web/app/layout.tsx`** to provide locale messages + providers + toaster (drop the old `ServiceWorkerRegister`; SW register is added in Task 8):

```tsx
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import "./globals.css";
import { getLocale } from "@/lib/i18n/locale";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Cross-Border Finance",
  description: "Document-driven, AI-assisted cross-border personal finance.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Finance" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `docker compose exec web npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/providers.tsx web/app/layout.tsx
git commit -m "feat(web): TanStack Query + intl + toaster providers tree"
```

---

## Task 6: App shell, nav, and routing

**Files:**
- Create: `web/components/app-nav.tsx`, `web/app/(app)/layout.tsx`, `web/app/(app)/dashboard/page.tsx`
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Create `web/components/app-nav.tsx`** (nav links for all 11 surfaces; localized labels):

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const SURFACES = [
  "dashboard", "capture", "review", "transactions", "analytics",
  "budgets", "debt", "income", "guidance", "notifications",
  "connections", "settings",
] as const;

export function AppNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">
      {SURFACES.map((s) => {
        const href = `/${s}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={s}
            href={href}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {t(s)}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Create `web/app/(app)/layout.tsx`** (client auth guard + shell):

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authStore } from "@/lib/api/auth";
import { AppNav } from "@/components/app-nav";

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

  return (
    <div className="mx-auto flex max-w-6xl flex-col md:flex-row">
      <aside className="border-b md:w-56 md:border-b-0 md:border-r">
        <AppNav />
      </aside>
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Create `web/app/(app)/dashboard/page.tsx`** (placeholder; real Dashboard is W1):

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dashboard</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Foundation ready. Spend/income/net widgets land in W1.
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Rewrite `web/app/page.tsx`** to redirect into the app shell:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

- [ ] **Step 5: Verify routing manually**

Run: `docker compose restart web && sleep 6 && curl -s -o /dev/null -w "root:%{http_code}\n" http://localhost:3000/ && curl -s -o /dev/null -w "login:%{http_code}\n" http://localhost:3000/login`
Expected: `root:200` (it renders the redirect/guard), `login:200` is checked after Task 7 — for now `login:404` is acceptable.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)" web/app/page.tsx web/components/app-nav.tsx
git commit -m "feat(web): app shell, surface nav, and auth-guarded route group"
```

---

## Task 7: Auth + MFA login flow

**Files:**
- Create: `web/app/(auth)/login/page.tsx`

- [ ] **Step 1: Create `web/app/(auth)/login/page.tsx`** (uses the typed client + token store):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api/client";
import { authStore, type TokenPair } from "@/lib/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const totp = String(form.get("totp") ?? "").trim();
    const { data, error: apiError } = await api.POST("/auth/login", {
      body: {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        totp_code: totp || null,
      },
    });
    setBusy(false);
    if (apiError || !data) {
      setError(t("error"));
      return;
    }
    authStore.set(data as TokenPair);
    router.replace("/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("loginTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">{t("password")}</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="totp">{t("totp")}</Label>
              <Input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" />
              <p className="text-xs text-muted-foreground">{t("totpHint")}</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {t("submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify the login route renders**

Run: `docker compose restart web && sleep 6 && curl -s http://localhost:3000/login | grep -o "Sign in" | head -1`
Expected: `Sign in` (English default locale).

- [ ] **Step 3: Verify a real login works end-to-end** (uses the seeded user; adjust creds if the seed differs — check `backend` seeds):

Run:
```bash
curl -s -X POST http://localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"password123","totp_code":null}' \
  -o /dev/null -w "%{http_code}\n"
```
Expected: `200` (confirms the contract the login form posts to). If creds differ, find them via `grep -rni "password" backend/app/*/seed*.py backend/migrations 2>/dev/null` and note the working pair in `REBUILD_PROGRESS.md`.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(auth)"
git commit -m "feat(web): login + MFA form on typed client"
```

---

## Task 8: PWA via @serwist/next

**Files:**
- Create: `web/app/sw.ts`, `web/components/sw-register.tsx`
- Modify: `web/next.config.mjs`, `web/app/layout.tsx`
- Delete: `web/public/sw.js`, `web/components/ServiceWorkerRegister.tsx`

- [ ] **Step 1: Remove the hand-rolled SW + registrar**

Run: `git rm web/public/sw.js web/components/ServiceWorkerRegister.tsx`
Expected: both staged for deletion. (`lib/offlineQueue.ts` is kept as reference for W1's Dexie work.)

- [ ] **Step 2: Create `web/app/sw.ts`** (serwist service worker source):

```ts
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
```

- [ ] **Step 3: Compose serwist with next-intl in `web/next.config.mjs`**:

```js
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default withSerwist(withNextIntl(nextConfig));
```

(Note: `disable` in development is intentional — serwist generates the SW on `next build`. Dev verification of the SW happens via the production build in Step 6.)

- [ ] **Step 4: Create `web/components/sw-register.tsx`** (registers the generated SW in the browser):

```tsx
"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch((err) =>
      console.warn("SW registration failed", err),
    );
  }, []);
  return null;
}
```

- [ ] **Step 5: Mount `<SwRegister />`** in `web/app/layout.tsx` — add the import and render it just inside `<body>`, before `NextIntlClientProvider`:

```tsx
import { SwRegister } from "@/components/sw-register";
// ...inside <body>:
<SwRegister />
```

- [ ] **Step 6: Verify a production build generates the SW**

Run: `docker compose exec web npm run build`
Expected: build succeeds; afterwards `docker compose exec web sh -c "test -f public/sw.js && echo SW_OK"` prints `SW_OK`.

- [ ] **Step 7: Restore dev mode**

Run: `docker compose restart web && sleep 6 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login`
Expected: `200`

- [ ] **Step 8: Commit**

```bash
git add web/app/sw.ts web/components/sw-register.tsx web/next.config.mjs web/app/layout.tsx
git rm web/public/sw.js web/components/ServiceWorkerRegister.tsx
git commit -m "feat(web): serwist PWA service worker (replaces hand-rolled sw.js)"
```

---

## Task 9: Playwright smoke test

**Files:**
- Create: `web/playwright.config.ts`, `web/e2e/smoke.spec.ts`

- [ ] **Step 1: Create `web/playwright.config.ts`** (host runner, targets the running dev server):

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

- [ ] **Step 2: Create `web/e2e/smoke.spec.ts`**:

```ts
import { test, expect } from "@playwright/test";

test("unauthenticated root redirects to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("login form has email, password, and MFA fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(page.getByLabel(/authenticator code/i)).toBeVisible();
});
```

- [ ] **Step 3: Install the Playwright browser on the host**

Run: `cd web && npx playwright install chromium && cd ..`
Expected: downloads Chromium (first run only).

- [ ] **Step 4: Run the smoke test** (dev server must be up on :3000)

Run: `cd web && npx playwright test && cd ..`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/playwright.config.ts web/e2e/smoke.spec.ts
git commit -m "test(web): Playwright smoke for redirect + login form"
```

---

## Task 10: Continuation tracker and W0 close-out

**Files:**
- Create: `web/REBUILD_PROGRESS.md`

- [ ] **Step 1: Create `web/REBUILD_PROGRESS.md`**:

```markdown
# M15 Frontend Rebuild — Progress Tracker

Spec: `docs/superpowers/specs/2026-06-14-m15-frontend-rebuild-design.md`
Plans: `docs/superpowers/plans/`

## Waves

- [x] **W0 Foundation** — stack wired, app shell, auth+MFA, PWA, i18n, typed client, Playwright.
- [ ] **W1 Core money loop** — Dashboard, Capture (Dexie offline), Review, Transactions + line items.
- [ ] **W2** — Analytics, Budgets, Debt.
- [ ] **W3** — Income/equity, Guidance (ask/wizard/transfers).
- [ ] **W4** — Notifications + web push, Connections (Plaid/Gmail/SMS/bot), Settings (export/consents/delete), finish `hi` catalog.

## Surfaces

| Surface | Status | Endpoints | Done when |
|---------|--------|-----------|-----------|
| Auth/Login | done | /auth/login, /auth/refresh | login + MFA works, guard redirects |
| Dashboard | placeholder | analytics/* | spend/income/net + charts + time filters |
| Capture | todo | /documents, OCR enqueue | offline capture queues + syncs |
| Review | todo | M5/M6 review-queue | confirm/edit low-confidence |
| Transactions | todo | /transactions/*, line items | list/filter/edit/split, drill-down |
| Analytics | todo | analytics/* | faceted breakdowns + contribution charts |
| Budgets | todo | M7 budgets | create/track budgets |
| Debt | todo | /loans/*, payoff | schedules + snowball/avalanche |
| Income | todo | /income-sources, /equity/*, /income/take-home | take-home + equity surfaces |
| Guidance | todo | /guidance/ask, /guidance/wizard, /cross-border/* | cited answers + wizard + tracker |
| Notifications | todo | /notifications/*, VAPID | center + prefs + web push |
| Connections | todo | /plaid/*, /email/*, /sms/* | link flows (bot on hold) |
| Settings | todo | household, /settings, /export, /consents, /account | settings + data controls |

## Known blockers
- WebAuthn/passkey: backend endpoints unmounted (M2 deferral) — UI informational only.
- Bot linking: `/bot/link` unmounted (M12 on hold).

## Working test creds
- (fill in the seeded email/password pair confirmed in Task 7, Step 3)
```

- [ ] **Step 2: Final W0 verification — typecheck, build, smoke**

Run:
```bash
docker compose exec web npm run typecheck && \
docker compose exec web npm run build && \
( cd web && npx playwright test )
```
Expected: typecheck clean, build succeeds (`public/sw.js` generated), `2 passed`.

- [ ] **Step 3: Restore dev mode**

Run: `docker compose restart web && sleep 6 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login`
Expected: `200`

- [ ] **Step 4: Commit**

```bash
git add web/REBUILD_PROGRESS.md
git commit -m "docs(web): W0 foundation complete; add rebuild progress tracker"
```

---

## W0 Done When

- `docker compose exec web npm run typecheck` is clean.
- `docker compose exec web npm run build` succeeds and generates `web/public/sw.js`.
- `npx playwright test` (host) passes the smoke suite.
- Visiting `http://localhost:3000/` while unauthenticated redirects to `/login`; a valid login lands on `/dashboard` inside the nav shell.
- Switching the `NEXT_LOCALE` cookie to `hi` renders Hindi nav labels (manual check; full `hi` coverage completes in W4).
- `shared/api-schema.ts` is generated from `/openapi.json`; the hand-written `shared/api-types.ts` is gone.
- The old `web/public/sw.js` and `ServiceWorkerRegister.tsx` are removed; `FinancePwaApp.tsx`, `lib/api.ts`, `lib/offlineQueue.ts` remain as reference for W1+.
```
