# Desktop Shell + Nav Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the desktop web app a top bar (page title · global search · +Add capture menu · profile) and remove the awkward mid-rail Capture entry, so the desktop shell stops feeling empty and capture has a proper home.

**Architecture:** Next.js App Router. The shell lives in `web/components/shell/app-shell.tsx`, which branches on `useIsDesktop()`. We add a `TopBar` rendered inside the existing desktop `<header>`, and an `AddMenu` dropdown (built on the existing `components/ui/dropdown-menu.tsx`) whose items deep-link to the existing `/capture` page with a `?mode=` hint. Mobile shell is untouched (keeps bottom bar + FAB). This is the first of five sequenced redesign plans; it unblocks the Spend/Insights/Home/Activity rebuilds.

**Tech Stack:** Next.js, React, TypeScript, Tailwind, lucide-react icons, Radix-based `dropdown-menu` UI primitive, Playwright e2e.

---

## File Structure

- **Create** `web/components/shell/top-bar.tsx` — desktop top bar: title, global search input, `<AddMenu/>`, profile avatar. One responsibility: the desktop header strip.
- **Create** `web/components/shell/add-menu.tsx` — the `+Add` dropdown (Receipt / CSV / Manual), each a link to `/capture?mode=...`.
- **Modify** `web/components/shell/app-shell.tsx` — render `<TopBar/>` in the desktop `<header>`; keep mobile branch unchanged.
- **Modify** `web/components/shell/desktop-rail.tsx:41` — remove the standalone `Capture` `RailLink` (now in the top bar).
- **Modify** `web/lib/shell/nav.ts` — add an exported `ADD_ACTIONS` list (single source of truth for the +Add menu).
- **Create** `web/e2e/redesign-shell.spec.ts` — e2e coverage for the new top bar and +Add menu on desktop.

**Pre-req for running e2e:** API on `:8000` and web dev server on `:3000`. Run web with `npm run dev` and the API via the project's compose/uvicorn. The default Playwright project is Desktop Chrome (1280px → desktop branch active).

---

### Task 1: `ADD_ACTIONS` config in nav.ts

**Files:**
- Modify: `web/lib/shell/nav.ts`

- [ ] **Step 1: Add the config export**

Append to `web/lib/shell/nav.ts` (icons `Camera`, `FileText`, `PenLine` come from `@/lib/icons`; add them to the existing import block at the top of the file):

```ts
export type AddAction = { key: string; label: string; sub: string; href: string; icon: LucideIcon };

/** Single source of truth for the desktop top-bar "+Add" menu and the mobile FAB. */
export const ADD_ACTIONS: AddAction[] = [
  { key: "receipt", label: "Scan receipt", sub: "Photo or PDF", href: "/capture?mode=receipt", icon: Camera },
  { key: "csv", label: "Import CSV", sub: "Bank or card export", href: "/capture?mode=csv", icon: FileText },
  { key: "manual", label: "Add manually", sub: "Type a transaction", href: "/capture?mode=manual", icon: PenLine },
];
```

Add `Camera, FileText, PenLine` to the existing `from "@/lib/icons"` import at the top of the file.

- [ ] **Step 2: Verify icons exist**

Run: `grep -E "Camera|FileText|PenLine" web/lib/icons.ts`
Expected: each name appears (they are re-exported from lucide-react). If any is missing, add it to `web/lib/icons.ts`, e.g. `export { Camera, FileText, PenLine } from "lucide-react";` (merge into the existing export).

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/lib/shell/nav.ts web/lib/icons.ts
git commit -m "feat(shell): add ADD_ACTIONS config for capture menu"
```

---

### Task 2: `AddMenu` dropdown component

**Files:**
- Create: `web/components/shell/add-menu.tsx`

- [ ] **Step 1: Inspect the dropdown primitive's exports**

Run: `grep -E "export (function|const)" web/components/ui/dropdown-menu.tsx`
Expected: a set including `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`. Use the exact names found. (If the primitive differs, adapt the imports in Step 2 to the real export names.)

- [ ] **Step 2: Write the component**

Create `web/components/shell/add-menu.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Plus } from "@/lib/icons";
import { ADD_ACTIONS } from "@/lib/shell/nav";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export function AddMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-chip bg-accent px-3.5 py-2 text-sm font-semibold text-on-accent transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="size-4" /> Add
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {ADD_ACTIONS.map((a) => (
          <DropdownMenuItem key={a.key} asChild>
            <Link href={a.href} className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-chip bg-accent-soft text-accent">
                <a.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{a.label}</span>
                <span className="block text-xs text-muted">{a.sub}</span>
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Verify `Plus` icon export**

Run: `grep -E "\bPlus\b" web/lib/icons.ts`
Expected: present. If missing, add `Plus` to the lucide re-export in `web/lib/icons.ts`.

- [ ] **Step 4: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors. If `DropdownMenuTrigger`/`DropdownMenuItem` reject `asChild`, the primitive is not Radix-backed — in that case wrap the `<Link>` in a plain `DropdownMenuItem` and drop `asChild`.

- [ ] **Step 5: Commit**

```bash
git add web/components/shell/add-menu.tsx web/lib/icons.ts
git commit -m "feat(shell): add +Add capture dropdown menu"
```

---

### Task 3: `TopBar` component

**Files:**
- Create: `web/components/shell/top-bar.tsx`

- [ ] **Step 1: Write the component**

Create `web/components/shell/top-bar.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search } from "@/lib/icons";
import { AddMenu } from "@/components/shell/add-menu";

export function TopBar({
  title,
  secondary,
  avatarInitial,
}: {
  title: string;
  secondary: boolean;
  avatarInitial: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/transactions?view=all&q=${encodeURIComponent(term)}` : "/transactions?view=all");
  }

  return (
    <div className="flex items-center gap-4">
      {secondary && (
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="-ml-2 grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-chip hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}
      <h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>

      <form onSubmit={onSubmit} role="search" className="relative ml-auto w-72 max-w-[40%]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search transactions, merchants…"
          aria-label="Search"
          className="h-9 w-full rounded-chip border border-border bg-card pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </form>

      <AddMenu />

      <div
        aria-hidden
        className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent"
      >
        {avatarInitial}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify `Search` icon export**

Run: `grep -E "\bSearch\b" web/lib/icons.ts`
Expected: present. If missing, add `Search` to the lucide re-export.

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/components/shell/top-bar.tsx web/lib/icons.ts
git commit -m "feat(shell): add desktop TopBar (title, search, +Add, profile)"
```

---

### Task 4: Wire TopBar into the desktop shell + drop rail Capture

**Files:**
- Modify: `web/components/shell/app-shell.tsx` (desktop `<header>`, lines ~60-76)
- Modify: `web/components/shell/desktop-rail.tsx:41`

- [ ] **Step 1: Write the failing e2e test**

Create `web/e2e/redesign-shell.spec.ts`:

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

test.describe("desktop top bar", () => {
  test("dashboard shows top-bar search and +Add", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await expect(page.getByRole("search")).toBeVisible();
    await expect(page.getByRole("button", { name: /^add$/i })).toBeVisible();
  });

  test("+Add menu opens capture actions", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByRole("menuitem", { name: /scan receipt/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /import csv/i })).toBeVisible();
  });

  test("search navigates to the spend ledger", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("searchbox", { name: /search/i }).fill("amazon");
    await page.getByRole("searchbox", { name: /search/i }).press("Enter");
    await expect(page).toHaveURL(/\/transactions\?view=all&q=amazon/);
  });

  test("rail no longer has a standalone Capture link", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    const rail = page.getByRole("navigation", { name: /primary/i });
    await expect(rail.getByRole("link", { name: /^capture$/i })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd web && npx playwright test e2e/redesign-shell.spec.ts`
Expected: FAIL — no `search` role / `Add` button yet, and the rail still has a Capture link.

- [ ] **Step 3: Render TopBar in the desktop header**

In `web/components/shell/app-shell.tsx`, add the import near the other shell imports:

```tsx
import { TopBar } from "@/components/shell/top-bar";
```

Replace the desktop `<header>` inner block (the `<div className="flex items-center gap-3 pb-1">…</div>` containing the back button + `<h1>`) with:

```tsx
<div className="pb-1">
  <TopBar title={title} secondary={secondary} avatarInitial={household.initial} />
</div>
```

Leave `<TopTabs tabs={tabs} compact />` and the `{tabs.length === 0 && <div className="h-3" />}` line below it as-is. Remove the now-unused `ChevronLeft` import from `app-shell.tsx` only if it is no longer referenced (the mobile branch may still use `router.back()` via `GlassBar`, not `ChevronLeft` — verify with `grep ChevronLeft web/components/shell/app-shell.tsx` and delete the import if there are no remaining uses).

- [ ] **Step 4: Remove the standalone Capture link from the rail**

In `web/components/shell/desktop-rail.tsx`, delete line 41:

```tsx
<RailLink href="/capture" label="Capture" Icon={Camera} active={isActive("/capture")} />
```

Then remove the now-unused `Camera` import and, if `isActive` is no longer referenced anywhere in the file, remove its definition too (verify with `grep -n "isActive" web/components/shell/desktop-rail.tsx` — `BOTTOM_TABS` and `DRAWER_ITEMS` links use `activeKey`/`isActive(href)`; keep `isActive` if drawer items still call it).

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd web && npx playwright test e2e/redesign-shell.spec.ts`
Expected: PASS (all 4 tests). If the `menuitem` role assertion fails, confirm the dropdown primitive renders `role="menuitem"`; if it uses a different role, update the test selector to match the rendered role.

- [ ] **Step 6: Typecheck + lint**

Run: `cd web && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/components/shell/app-shell.tsx web/components/shell/desktop-rail.tsx web/e2e/redesign-shell.spec.ts
git commit -m "feat(shell): render desktop TopBar, move Capture into +Add menu"
```

---

### Task 5: Regression — existing surfaces still render

**Files:**
- (no source changes; run the existing suite)

- [ ] **Step 1: Run the redesign surfaces suite**

Run: `cd web && npx playwright test e2e/redesign-surfaces.spec.ts`
Expected: PASS. The shell change keeps `surfaceTitle` and the bottom nav intact, so all 12 surface render tests should still pass.

- [ ] **Step 2: If any surface test fails**

Investigate with `--trace on`; the most likely cause is the header markup change. The `<h1>` title must still render the same text (now inside `TopBar`). Confirm `getByText(/net cash flow/i)` etc. still resolve. Fix `TopBar`/`app-shell.tsx` until green; do not weaken the existing assertions.

- [ ] **Step 3: Commit (only if a fix was needed)**

```bash
git add -A
git commit -m "fix(shell): keep surface titles rendering after TopBar move"
```

---

## Self-Review

**Spec coverage (this plan's slice):**
- Desktop top bar (title · search · +Add · profile) → Tasks 3, 4. ✓
- Capture moved to top-bar +Add on desktop → Tasks 1, 2, 4. ✓
- Remove awkward mid-rail Capture → Task 4 Step 4. ✓
- Mobile shell unchanged (FAB stays) → no mobile branch edits; verified by leaving `BottomBar`/`Fab` untouched. ✓
- "Widen content to multi-column bento" → deferred to per-surface plans (2–5), where the bento actually lives. Noted, not a gap.
- Insights/Spend nav split, Spend internal views → Plan 2. Net worth → deferred per spec.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code; fallback instructions (asChild, icon-missing, role mismatch) are concrete conditionals, not placeholders.

**Type consistency:** `ADD_ACTIONS: AddAction[]` defined in Task 1 and consumed in Task 2. `TopBar` props (`title`, `secondary`, `avatarInitial`) defined in Task 3 and passed identically in Task 4. `AddMenu` takes no props in both definition and use. Consistent.

**Known external dependency:** e2e requires API `:8000` + web `:3000` running; the project's `.venv` is x86_64/broken, so run the API via the api container or a working interpreter (see project memory on verifying tests). Playwright itself runs from `web/`.
