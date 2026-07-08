# Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Activity (`/notifications`) a clear, actionable feed — alerts grouped by recency, each row stating what happened and deep-linking to the thing it's about — instead of an opaque list of raw notification rows over a big preferences form.

**Architecture:** Keeps the existing notifications data (`useNotifications`, `useMarkRead`) but renders rows through a presenter that maps each notification `type` to a human title, an icon, and a deep-link target. Rows are grouped into Today / This week / Earlier. The preferences form moves below the feed (and is collapsed by default) so the feed leads. No backend change — we interpret the `type`/`payload` already returned. Depends on Plan 1.

**Tech Stack:** Next.js, React, TypeScript, TanStack Query, Tailwind, Playwright e2e.

**Testing note:** No unit runner — the presenter mapping is validated via Playwright e2e against seeded notifications; if the demo household has none, the test asserts the empty-state and the grouping shell.

---

## File Structure

- **Create** `web/lib/activity/present.ts` — pure: map a `Notification` to `{ title, icon, href, group }`.
- **Create** `web/components/activity/activity-feed.tsx` — grouped, actionable feed.
- **Modify** `web/app/(app)/notifications/page.tsx` — feed first, collapsible preferences below.
- **Create** `web/e2e/activity.spec.ts`.

---

### Task 1: Notification presenter

**Files:**
- Create: `web/lib/activity/present.ts`

- [ ] **Step 1: Inspect the notification types in use**

Run: `grep -rn "type" web/lib/api/notifications.ts; grep -rniE "budget|spend|payment|due|review|anomaly|large" ../backend/app/notifications/ 2>/dev/null | head`
Expected: surfaces the `NotificationOut.type` string values the backend emits (e.g. `budget_exceeded`, `payment_due`, `large_transaction`, `review_needed`). Use the real values you find for the `MAP` keys below; keep the `default` branch for anything unmapped.

- [ ] **Step 2: Write the presenter**

```ts
import type { Notification } from "@/lib/api/notifications";
import { AlertTriangle, Bell, CalendarClock, ListChecks, TrendingUp } from "@/lib/icons";
import type { LucideIcon } from "lucide-react";

export type ActivityGroup = "Today" | "This week" | "Earlier";

export type PresentedActivity = {
  id: string;
  title: string;
  detail: string;
  icon: LucideIcon;
  href: string;
  group: ActivityGroup;
  unread: boolean;
};

const MAP: Record<string, { title: string; icon: LucideIcon; href: string }> = {
  budget_exceeded: { title: "Budget exceeded", icon: AlertTriangle, href: "/budgets" },
  large_transaction: { title: "Large transaction", icon: TrendingUp, href: "/transactions?view=all" },
  payment_due: { title: "Payment due", icon: CalendarClock, href: "/debt" },
  review_needed: { title: "Needs review", icon: ListChecks, href: "/review" },
};

function groupFor(dateStr: string | null | undefined): ActivityGroup {
  if (!dateStr) return "Earlier";
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return "Earlier";
  const days = (Date.now() - d) / 86_400_000;
  if (days < 1) return "Today";
  if (days < 7) return "This week";
  return "Earlier";
}

export function present(n: Notification): PresentedActivity {
  const m = MAP[n.type] ?? { title: n.type.replace(/_/g, " "), icon: Bell, href: "/notifications" };
  const payload = (n.payload ?? {}) as Record<string, unknown>;
  const detail = typeof payload.message === "string" ? payload.message : Object.values(payload).slice(0, 2).join(" · ");
  return {
    id: n.id,
    title: m.title,
    detail,
    icon: m.icon,
    href: m.href,
    group: groupFor(n.scheduled_for ?? null),
    unread: n.status !== "read",
  };
}

export const GROUP_ORDER: ActivityGroup[] = ["Today", "This week", "Earlier"];
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors. Add any missing icon names (`AlertTriangle`, `CalendarClock`) to `web/lib/icons.ts` lucide re-export.

- [ ] **Step 4: Commit**

```bash
git add web/lib/activity/present.ts web/lib/icons.ts
git commit -m "feat(activity): add notification presenter"
```

---

### Task 2: Activity feed component

**Files:**
- Create: `web/components/activity/activity-feed.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useNotifications, useMarkRead } from "@/lib/api/notifications";
import { present, GROUP_ORDER, type PresentedActivity } from "@/lib/activity/present";
import { Skeleton } from "@/components/ui/skeleton";

export function ActivityFeed() {
  const q = useNotifications();
  const markRead = useMarkRead();

  const groups = useMemo(() => {
    const items = (q.data ?? []).map(present);
    return GROUP_ORDER.map((g) => ({ group: g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length > 0);
  }, [q.data]);

  if (q.isError) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-destructive shadow-card">Couldn&apos;t load activity.</div>;
  }
  if (q.isLoading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  }
  if (groups.length === 0) {
    return <div className="rounded-2xl border border-border bg-card py-16 text-center text-sm text-muted shadow-card" data-testid="activity-empty">You&apos;re all caught up.</div>;
  }

  return (
    <div className="space-y-5" data-testid="activity-feed">
      {groups.map(({ group, items }) => (
        <section key={group} className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">{group}</h3>
          <div className="rounded-2xl border border-border bg-card p-1 shadow-card">
            {items.map((it) => (
              <Row key={it.id} it={it} onView={() => markRead.mutate(it.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Row({ it, onView }: { it: PresentedActivity; onView: () => void }) {
  const Icon = it.icon;
  return (
    <Link href={it.href} onClick={onView} className="flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-chip">
      <span className="grid size-9 flex-none place-items-center rounded-xl bg-accent-soft text-accent"><Icon className="size-[18px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold">{it.title}</span>
          {it.unread && <span className="size-1.5 rounded-full bg-accent" aria-label="unread" />}
        </span>
        {it.detail && <span className="block truncate text-xs text-muted">{it.detail}</span>}
      </span>
      <span className="text-muted">›</span>
    </Link>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/components/activity/activity-feed.tsx
git commit -m "feat(activity): add grouped actionable feed"
```

---

### Task 3: Rebuild the Activity page

**Files:**
- Modify: `web/app/(app)/notifications/page.tsx`

- [ ] **Step 1: Write the failing e2e test**

`web/e2e/activity.spec.ts` (copy signup/authenticate helpers from `web/e2e/spend.spec.ts`):

```ts
// …helpers copied…
test.describe("activity feed", () => {
  test("shows the feed (or a caught-up empty state) and collapsible prefs", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/notifications");
    const feed = page.getByTestId("activity-feed");
    const empty = page.getByTestId("activity-empty");
    await expect(feed.or(empty)).toBeVisible();
    await expect(page.getByRole("button", { name: /preferences/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd web && npx playwright test e2e/activity.spec.ts`
Expected: FAIL — feed/empty testids and the collapsible Preferences button don't exist.

- [ ] **Step 3: Rebuild the page**

Modify `web/app/(app)/notifications/page.tsx`: render `<ActivityFeed/>` first; move the existing `PreferencesCard` into a `<details>` (collapsed by default) with a `<summary>` styled as a button labeled "Preferences". Keep `PreferencesCard` itself unchanged.

```tsx
"use client";

import { ActivityFeed } from "@/components/activity/activity-feed";
// keep the existing PreferencesCard component in this file (unchanged)

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <ActivityFeed />
      <details className="rounded-2xl border border-border bg-card shadow-card">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold" role="button">
          Preferences
        </summary>
        <div className="px-1 pb-1">
          <PreferencesCard />
        </div>
      </details>
    </div>
  );
}
```

Remove the old top-level feed rendering (the `notifications.data` map + `NotificationRow`) — `ActivityFeed` replaces it. `NotificationRow` can be deleted if unused; `PreferencesCard` stays.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd web && npx playwright test e2e/activity.spec.ts`
Expected: PASS. The `role="button"` on `<summary>` makes `getByRole("button", { name: /preferences/i })` resolve.

- [ ] **Step 5: Typecheck + lint + regression**

Run: `cd web && npm run typecheck && npm run lint && npx playwright test e2e/redesign-surfaces.spec.ts`
Expected: green. If `redesign-surfaces.spec.ts` asserted old notifications markup, update it to the feed.

- [ ] **Step 6: Commit**

```bash
git add "web/app/(app)/notifications/page.tsx" web/e2e/activity.spec.ts
git commit -m "feat(activity): feed-first page with collapsible preferences"
```

---

## Self-Review

**Spec coverage (Activity):**
- Actionable feed: budget exceeded, large/unusual spend, bill/EMI due, review-needed → Task 1 `MAP`. ✓ (keys must match real backend `type` values — Task 1 Step 1 verifies.)
- Grouped by recency → Task 1 `groupFor` + Task 2 grouping. ✓
- Each row deep-links to the underlying thing → Task 1 `href` + Task 2 `Row`. ✓
- Preferences preserved but demoted → Task 3 collapsible `<details>`. ✓

**Placeholder scan:** No TBD/TODO. The `MAP` keys are explicitly tied to verification in Task 1 Step 1 with a concrete `default` fallback — not a guess left dangling.

**Type consistency:** `PresentedActivity` / `ActivityGroup` / `GROUP_ORDER` defined in Task 1, consumed in Task 2. `present(n)` signature consistent. Reuses existing `useNotifications`/`useMarkRead` unchanged.

**No cross-plan dependency** beyond Plan 1 (shell) — Activity is independent of Spend/Insights/Home and can land in any order after Plan 1.
