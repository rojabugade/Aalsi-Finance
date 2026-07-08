# M15 Frontend Rebuild — W4 (Notifications · Connections · Settings) Implementation Plan

> **For the implementing agent (Codex):** This plan is **prescriptive**. Each task gives the
> **exact, complete file contents** to write. Create/replace each file with the code block
> **verbatim** — do not redesign, rename, restyle, or "improve" it. Do not add libraries or
> shadcn primitives. Do not edit files this plan does not mention. After each task, run the
> listed verification command and confirm the expected output. Steps use `- [ ]` for tracking.

**Goal:** Replace the `ComingSoon` placeholders for **Notifications**, **Connections**, and
**Settings** — the last three surfaces — with working pages.
- **Notifications:** in-app notification list (mark-read) + preferences (channels, quiet hours);
  web push is **informational/best-effort** (browser permission prompt only — no VAPID
  subscription endpoint exists backend-side).
- **Connections:** trigger the real ingestion flows — Plaid link-token, Gmail OAuth start / sync /
  disconnect, SMS forwarding-token rotate / disconnect. Bot linking is **on hold** (M12).
- **Settings:** household info + members, base-currency/locale/language, consents (view + revoke),
  data export (CSV/PDF download), and account deletion.

**Architecture (already in place — follow it, don't reinvent):**
- Each surface is a client page under `web/app/(app)/<surface>/page.tsx`.
- Data access is through **per-domain hook modules** in `web/lib/api/*`, each defining a local
  `unwrap()` helper and exporting TanStack Query `useQuery`/`useMutation` hooks built on the
  typed `api` client from `@/lib/api/client`.
- Types come from the generated schema: `import type { components } from "@shared/api-schema"`
  then `components["schemas"]["<Name>"]`.
- **204 No Content** endpoints (DELETE connection/account) must **not** go through `unwrap`
  (it throws on `data === undefined`). Use the `const { error } = await api.DELETE(...); if
  (error) throw error;` pattern — exactly as `lib/api/loans.ts` and `lib/api/transactions.ts`
  already do for deletes.
- **Inline English strings** (no i18n keys on feature surfaces).
- Money/decimal values arrive from the API as **strings**; render with `formatCurrency` from
  `@/lib/format` (accepts `string | number`); for math wrap in `Number(...)`.
- **Opaque `dict` backend fields** (notification `payload`, preferences `types`) generate as
  `Record<string, never>` in TypeScript and cannot be indexed. Render them with the existing
  `KeyValues` helper from `@/components/guidance/citations` (built in W3) — cast to
  `Record<string, unknown>`. Never assume inner keys.
- **No `switch` primitive exists** in `components/ui/`. Use styled native `<input type="checkbox">`
  for all toggles — exactly as W3's "Cross-border specialised" checkboxes did.
- Reuse existing tokens/patterns: `text-success`, `text-destructive`, `text-muted-foreground`,
  `bg-muted`, `data-numeric` on numeric cells, the styled native `<select>` class, `Badge`, and
  the Dialog-based forms exactly as W2/W3 used them.

**Tech Stack:** (inherited) Next 15 App Router, React 19, TanStack Query 5, openapi-fetch,
shadcn/ui. **No new dependencies and no new shadcn primitives.**

---

## Environment notes (read first)

- App runs in the `web` Docker container. Typecheck/build **inside the container**:
  `docker compose exec web npm run typecheck`, `docker compose exec web npm run build`.
- Backend live at `http://localhost:8000`; dev app at `http://localhost:3000`.
- Playwright runs **on the host**: `cd web && npx playwright test`.
- All `git` from repo root `/Users/kshtj/CourseWork/Study/Projects/CodeName-Missing`.
- Test creds: `dev@example.com` / `hunter2pass`.
- **Integration endpoints (Plaid/Gmail/SMS) raise `502 Bad Gateway` (`IntegrationUnavailable`)
  in dev** when the external provider isn't configured. This is expected — the Connections UI
  must surface these failures gracefully (a toast + inline message), never crash.

## Backend contract (already verified — do not change the backend)

**Notifications:**
- `GET /notifications` → `NotificationOut[]` `{ id, household_id, user_id?, type, channel,
  payload (dict|null), scheduled_for?, status }`.
- `POST /notifications/{notification_id}/read` → `NotificationOut`.
- `GET /notifications/preferences` → `NotificationPreferences { channels: { inapp, email, push,
  bot }, quiet_hours: { enabled, start "HH:MM", end "HH:MM", timezone }, types (dict) }`.
- `PATCH /notifications/preferences` body `NotificationPreferencesPatch { channels?, quiet_hours?,
  types? }` → `NotificationPreferences`. **There is no VAPID/push-subscription endpoint** — the
  "push" channel is a preference flag only.

**Connections (ingestion — all `require_role("owner","member")`):**
- `POST /plaid/link-token` → `PlaidLinkTokenOut { link_token, expiration? }` (completing the link
  needs the Plaid Link JS SDK, which we are **not** adding — surface the token issuance only).
- `POST /email/oauth/start` → `EmailOAuthStartOut { authorization_url, state }` (open the URL in a
  new tab).
- `POST /email/sync` → `EmailSyncOut { documents_created }`.
- `DELETE /email/connection` → 204.
- `POST /sms/token/rotate` → `SmsTokenOut { token, webhook_url, allowed_senders[] }`.
- `DELETE /sms/connection` → 204.
- (No GET status endpoints exist — Connections is **action-driven**, not a status list.)

**Settings / data controls / household:**
- `GET /settings` → `SettingsOut { base_currency, locale, language, notification_preferences_link }`.
- `PATCH /settings` body `SettingsPatch { base_currency?, locale?, language? }` → `SettingsOut`.
- `GET /consents` → `ConsentOut[] { channel, granted, granted_at?, revoked_at? }`.
- `POST /consents/{channel}/revoke` → `ConsentOut`.
- `GET /export?format=csv|pdf` → streamed file (csv = `.zip`, pdf = `.pdf`).
- `DELETE /account` body `AccountDeleteIn { confirmation }` → 204.
- `GET /household` → `HouseholdOut { id, name, base_currency }`.
- `GET /household/members` → `MemberOut[] { id, email, display_name?, role, mfa_enabled, is_active }`.

## Files created/modified in W4

```
web/
  lib/api/
    notifications.ts                       # CREATE
    connections.ts                         # CREATE
    settings.ts                            # CREATE (settings + consents + household + export download)
  app/(app)/
    notifications/page.tsx                 # REPLACE placeholder
    connections/page.tsx                   # REPLACE placeholder
    settings/page.tsx                      # REPLACE placeholder
  e2e/w4.spec.ts                           # CREATE (smoke)
  REBUILD_PROGRESS.md                      # MODIFY: mark W4 done
```

---

## Task 1: Notifications API hook module

**File:** Create `web/lib/api/notifications.ts` with **exactly** this content:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type Notification = components["schemas"]["NotificationOut"];
export type NotificationPreferences = components["schemas"]["NotificationPreferences"];
export type NotificationPreferencesPatch = components["schemas"]["NotificationPreferencesPatch"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => unwrap(api.GET("/notifications", {})),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST("/notifications/{notification_id}/read", {
          params: { path: { notification_id: id } },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notifications", "preferences"],
    queryFn: () => unwrap(api.GET("/notifications/preferences", {})),
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NotificationPreferencesPatch) =>
      unwrap(api.PATCH("/notifications/preferences", { body })),
    onSuccess: (data) => qc.setQueryData(["notifications", "preferences"], data),
  });
}
```

- [ ] Verify: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/lib/api/notifications.ts
git commit -m "feat(web): notifications API hooks"
```

---

## Task 2: Connections API hook module

**File:** Create `web/lib/api/connections.ts` with **exactly** this content:

```ts
import { useMutation } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type PlaidLinkToken = components["schemas"]["PlaidLinkTokenOut"];
export type EmailOAuthStart = components["schemas"]["EmailOAuthStartOut"];
export type EmailSync = components["schemas"]["EmailSyncOut"];
export type SmsToken = components["schemas"]["SmsTokenOut"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function usePlaidLinkToken() {
  return useMutation({ mutationFn: () => unwrap(api.POST("/plaid/link-token", {})) });
}

export function useEmailOAuthStart() {
  return useMutation({ mutationFn: () => unwrap(api.POST("/email/oauth/start", {})) });
}

export function useEmailSync() {
  return useMutation({ mutationFn: () => unwrap(api.POST("/email/sync", {})) });
}

export function useDisconnectEmail() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/email/connection", {});
      if (error) throw error;
    },
  });
}

export function useRotateSmsToken() {
  return useMutation({ mutationFn: () => unwrap(api.POST("/sms/token/rotate", {})) });
}

export function useDisconnectSms() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/sms/connection", {});
      if (error) throw error;
    },
  });
}
```

- [ ] Verify: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/lib/api/connections.ts
git commit -m "feat(web): connections (plaid/gmail/sms) API hooks"
```

---

## Task 3: Settings + consents + household API hook module

**File:** Create `web/lib/api/settings.ts` with **exactly** this content:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api, apiBaseUrl } from "./client";
import { authStore } from "./auth";

export type Settings = components["schemas"]["SettingsOut"];
export type SettingsPatch = components["schemas"]["SettingsPatch"];
export type Consent = components["schemas"]["ConsentOut"];
export type Household = components["schemas"]["HouseholdOut"];
export type Member = components["schemas"]["MemberOut"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap(api.GET("/settings", {})),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsPatch) => unwrap(api.PATCH("/settings", { body })),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function useConsents() {
  return useQuery({
    queryKey: ["consents"],
    queryFn: () => unwrap(api.GET("/consents", {})),
  });
}

export function useRevokeConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channel: string) =>
      unwrap(api.POST("/consents/{channel}/revoke", { params: { path: { channel } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consents"] }),
  });
}

export function useHousehold() {
  return useQuery({
    queryKey: ["household"],
    queryFn: () => unwrap(api.GET("/household", {})),
  });
}

export function useMembers() {
  return useQuery({
    queryKey: ["household", "members"],
    queryFn: () => unwrap(api.GET("/household/members", {})),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (confirmation: string) => {
      const { error } = await api.DELETE("/account", { body: { confirmation } });
      if (error) throw error;
    },
  });
}

/**
 * Streamed file export. openapi-fetch is awkward with binary downloads, so we
 * hand-build the fetch (mirrors the W1 multipart-upload approach) and attach the
 * bearer token directly. `csv` returns a zip, `pdf` returns a PDF summary.
 */
export async function downloadExport(format: "csv" | "pdf"): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/export?format=${format}`, {
    headers: authStore.access ? { Authorization: `Bearer ${authStore.access}` } : {},
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = format === "csv" ? "finance-export.zip" : "finance-summary.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] Verify: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/lib/api/settings.ts
git commit -m "feat(web): settings + consents + household + export API hooks"
```

---

## Task 4: Notifications surface

**File:** Replace `web/app/(app)/notifications/page.tsx` with **exactly** this content:

```tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  useMarkRead,
  useNotificationPreferences,
  useNotifications,
  useUpdateNotificationPreferences,
  type Notification,
} from "@/lib/api/notifications";
import { KeyValues } from "@/components/guidance/citations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const CHANNELS: [string, string][] = [
  ["inapp", "In-app"],
  ["email", "Email"],
  ["push", "Web push"],
  ["bot", "Bot"],
];

export default function NotificationsPage() {
  const notifications = useNotifications();
  const markRead = useMarkRead();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your alerts and how you want to receive them.
        </p>
      </div>

      <PreferencesCard />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Recent</h2>
        {notifications.isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">
              Couldn&apos;t load notifications.
            </CardContent>
          </Card>
        ) : notifications.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : (notifications.data ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              No notifications yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(notifications.data ?? []).map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onRead={async () => {
                  try {
                    await markRead.mutateAsync(n.id);
                  } catch {
                    toast.error("Couldn't mark as read");
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NotificationRow({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: () => void;
}) {
  const isRead = notification.status === "read";
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium capitalize">
              {notification.type.replace(/_/g, " ")}
            </span>
            <Badge variant="secondary" className="capitalize">
              {notification.channel}
            </Badge>
            {!isRead && <Badge>New</Badge>}
          </div>
          {notification.payload && (
            <KeyValues data={notification.payload as Record<string, unknown>} />
          )}
          {notification.scheduled_for && (
            <p className="text-xs text-muted-foreground">{notification.scheduled_for}</p>
          )}
        </div>
        {!isRead && (
          <Button variant="outline" size="sm" onClick={onRead}>
            Mark read
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function PreferencesCard() {
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  const [channels, setChannels] = useState<Record<string, boolean>>({});
  const [quiet, setQuiet] = useState({ enabled: false, start: "22:00", end: "07:00", timezone: "UTC" });

  useEffect(() => {
    if (prefs.data) {
      setChannels({ ...(prefs.data.channels as Record<string, boolean>) });
      setQuiet({ ...prefs.data.quiet_hours });
    }
  }, [prefs.data]);

  async function toggleChannel(key: string, value: boolean) {
    // Web push requires an explicit browser permission grant; it is best-effort
    // (no VAPID subscription endpoint exists yet — this only records the preference).
    if (key === "push" && value && typeof Notification !== "undefined") {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          toast.error("Push permission denied by the browser");
          return;
        }
      } catch {
        /* ignore — still record the preference */
      }
    }
    setChannels((c) => ({ ...c, [key]: value }));
  }

  async function save() {
    try {
      await update.mutateAsync({ channels, quiet_hours: quiet });
      toast.success("Preferences saved");
    } catch {
      toast.error("Couldn't save preferences");
    }
  }

  if (prefs.isLoading) return <Skeleton className="h-64" />;
  if (prefs.isError || !prefs.data) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">
          Couldn&apos;t load preferences.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Preferences</CardTitle>
        <CardDescription>Choose channels and quiet hours.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-semibold">Channels</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHANNELS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(channels[key])}
                  onChange={(e) => toggleChannel(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Web push is best-effort: it requests browser permission but delivery isn&apos;t wired
            up yet.
          </p>
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={quiet.enabled}
              onChange={(e) => setQuiet((q) => ({ ...q, enabled: e.target.checked }))}
            />
            Quiet hours
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="quiet-start">Start</Label>
              <Input
                id="quiet-start"
                type="time"
                value={quiet.start}
                onChange={(e) => setQuiet((q) => ({ ...q, start: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quiet-end">End</Label>
              <Input
                id="quiet-end"
                type="time"
                value={quiet.end}
                onChange={(e) => setQuiet((q) => ({ ...q, end: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quiet-tz">Timezone</Label>
              <Input
                id="quiet-tz"
                value={quiet.timezone}
                onChange={(e) => setQuiet((q) => ({ ...q, timezone: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save preferences"}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] Verify typecheck: `docker compose exec web npm run typecheck` → no errors.
- [ ] Verify render: `curl -s http://localhost:3000/notifications | grep -o "Notifications" | head -1` → `Notifications`.
- [ ] Commit:

```bash
git add "web/app/(app)/notifications/page.tsx"
git commit -m "feat(web): Notifications surface — list, mark-read, channel + quiet-hours prefs"
```

---

## Task 5: Connections surface

**File:** Replace `web/app/(app)/connections/page.tsx` with **exactly** this content:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useDisconnectEmail,
  useDisconnectSms,
  useEmailOAuthStart,
  useEmailSync,
  usePlaidLinkToken,
  useRotateSmsToken,
  type SmsToken,
} from "@/lib/api/connections";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ConnectionsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Link account sources so transactions flow in automatically.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PlaidCard />
        <EmailCard />
        <SmsCard />
        <BotCard />
      </div>
    </div>
  );
}

function ConnectionShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 text-sm">{children}</CardContent>
      <CardFooter className="flex flex-wrap gap-2">{footer}</CardFooter>
    </Card>
  );
}

function PlaidCard() {
  const linkToken = usePlaidLinkToken();

  async function connect() {
    try {
      const res = await linkToken.mutateAsync();
      toast.success("Link token issued");
      void res;
    } catch {
      toast.error("Plaid isn't configured in this environment");
    }
  }

  return (
    <ConnectionShell
      title="Bank (Plaid)"
      description="Securely import bank & card transactions."
      footer={
        <Button onClick={connect} disabled={linkToken.isPending}>
          {linkToken.isPending ? "Requesting…" : "Connect bank"}
        </Button>
      }
    >
      {linkToken.data ? (
        <p className="text-muted-foreground">
          Link token issued. Completing the connection needs the Plaid Link flow (coming in a
          later pass).
        </p>
      ) : (
        <p className="text-muted-foreground">
          Requests a Plaid link token. Full Plaid Link UI lands in a later pass.
        </p>
      )}
    </ConnectionShell>
  );
}

function EmailCard() {
  const start = useEmailOAuthStart();
  const sync = useEmailSync();
  const disconnect = useDisconnectEmail();

  async function connect() {
    try {
      const res = await start.mutateAsync();
      window.open(res.authorization_url, "_blank", "noopener,noreferrer");
      toast.success("Opening Google authorization…");
    } catch {
      toast.error("Gmail isn't configured in this environment");
    }
  }

  async function runSync() {
    try {
      const res = await sync.mutateAsync();
      toast.success(`Imported ${res.documents_created} document(s)`);
    } catch {
      toast.error("Couldn't sync Gmail");
    }
  }

  async function remove() {
    try {
      await disconnect.mutateAsync();
      toast.success("Gmail disconnected");
    } catch {
      toast.error("Couldn't disconnect Gmail");
    }
  }

  return (
    <ConnectionShell
      title="Email (Gmail)"
      description="Forward receipts & statements from your inbox."
      footer={
        <>
          <Button onClick={connect} disabled={start.isPending}>
            {start.isPending ? "Starting…" : "Connect Gmail"}
          </Button>
          <Button variant="outline" onClick={runSync} disabled={sync.isPending}>
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
          <Button variant="ghost" onClick={remove} disabled={disconnect.isPending}>
            Disconnect
          </Button>
        </>
      }
    >
      <p className="text-muted-foreground">
        Connect opens Google&apos;s consent screen in a new tab; Sync pulls recent receipts.
      </p>
    </ConnectionShell>
  );
}

function SmsCard() {
  const rotate = useRotateSmsToken();
  const disconnect = useDisconnectSms();
  const [creds, setCreds] = useState<SmsToken | null>(null);

  async function generate() {
    try {
      const res = await rotate.mutateAsync();
      setCreds(res);
      toast.success("Forwarding token generated");
    } catch {
      toast.error("Couldn't generate token");
    }
  }

  async function remove() {
    try {
      await disconnect.mutateAsync();
      setCreds(null);
      toast.success("SMS forwarding disconnected");
    } catch {
      toast.error("Couldn't disconnect");
    }
  }

  return (
    <ConnectionShell
      title="SMS"
      description="Forward bank SMS alerts to auto-log spends."
      footer={
        <>
          <Button onClick={generate} disabled={rotate.isPending}>
            {rotate.isPending ? "Generating…" : creds ? "Rotate token" : "Generate token"}
          </Button>
          {creds && (
            <Button variant="ghost" onClick={remove} disabled={disconnect.isPending}>
              Disconnect
            </Button>
          )}
        </>
      }
    >
      {creds ? (
        <div className="space-y-2">
          <div>
            <p className="text-xs text-muted-foreground">Webhook URL</p>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">
              {creds.webhook_url}
            </code>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Token</p>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{creds.token}</code>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">
          Generates a forwarding token + webhook URL for an SMS-forwarding app.
        </p>
      )}
    </ConnectionShell>
  );
}

function BotCard() {
  return (
    <ConnectionShell
      title="Chat bot"
      description="Log spends via a messaging bot."
      footer={
        <Button disabled>On hold</Button>
      }
    >
      <Badge variant="secondary">M12 — on hold</Badge>
      <p className="text-muted-foreground">Bot linking isn&apos;t available yet.</p>
    </ConnectionShell>
  );
}
```

- [ ] Verify typecheck: `docker compose exec web npm run typecheck` → no errors.
- [ ] Verify render: `curl -s http://localhost:3000/connections | grep -o "Connections" | head -1` → `Connections`.
- [ ] Commit:

```bash
git add "web/app/(app)/connections/page.tsx"
git commit -m "feat(web): Connections surface — Plaid/Gmail/SMS flows, bot on hold"
```

---

## Task 6: Settings surface

**File:** Replace `web/app/(app)/settings/page.tsx` with **exactly** this content:

```tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  downloadExport,
  useConsents,
  useDeleteAccount,
  useHousehold,
  useMembers,
  useRevokeConsent,
  useSettings,
  useUpdateSettings,
} from "@/lib/api/settings";
import { authStore } from "@/lib/api/auth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Household, preferences, consents, and your data.
        </p>
      </div>

      <HouseholdCard />
      <PreferencesCard />
      <ConsentsCard />
      <DataControlsCard />
    </div>
  );
}

function HouseholdCard() {
  const household = useHousehold();
  const members = useMembers();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Household</CardTitle>
        <CardDescription>Members sharing this workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {household.isLoading ? (
          <Skeleton className="h-6 w-40" />
        ) : household.data ? (
          <div>
            <p className="font-medium">{household.data.name}</p>
            <p className="text-sm text-muted-foreground">
              Base currency {household.data.base_currency}
            </p>
          </div>
        ) : null}

        {members.isLoading ? (
          <Skeleton className="h-20" />
        ) : (
          <ul className="space-y-2">
            {(members.data ?? []).map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-lg border p-3 text-sm"
              >
                <div>
                  <span className="font-medium">{m.display_name ?? m.email}</span>
                  <span className="ml-2 text-muted-foreground">{m.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  {m.mfa_enabled && <Badge variant="secondary">MFA</Badge>}
                  <Badge className="capitalize">{m.role}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PreferencesCard() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [form, setForm] = useState({ base_currency: "", locale: "", language: "" });

  useEffect(() => {
    if (settings.data) {
      setForm({
        base_currency: settings.data.base_currency,
        locale: settings.data.locale,
        language: settings.data.language,
      });
    }
  }, [settings.data]);

  async function save() {
    try {
      await update.mutateAsync(form);
      toast.success("Settings saved");
    } catch {
      toast.error("Couldn't save settings");
    }
  }

  if (settings.isLoading) return <Skeleton className="h-48" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Preferences</CardTitle>
        <CardDescription>Currency and locale for this household.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="base_currency">Base currency</Label>
            <Input
              id="base_currency"
              value={form.base_currency}
              maxLength={3}
              onChange={(e) => setForm((f) => ({ ...f, base_currency: e.target.value.toUpperCase() }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="locale">Locale</Label>
            <Input
              id="locale"
              value={form.locale}
              onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="language">Language</Label>
            <Input
              id="language"
              value={form.language}
              onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
            />
          </div>
        </div>
        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ConsentsCard() {
  const consents = useConsents();
  const revoke = useRevokeConsent();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Consents</CardTitle>
        <CardDescription>Channels you&apos;ve authorised for data ingestion.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {consents.isLoading ? (
          <Skeleton className="h-20" />
        ) : (consents.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No consents on record.</p>
        ) : (
          (consents.data ?? []).map((c) => (
            <div
              key={c.channel}
              className="flex items-center justify-between rounded-lg border p-3 text-sm"
            >
              <div>
                <span className="font-medium capitalize">{c.channel}</span>
                <span className="ml-2 text-muted-foreground">
                  {c.granted ? "Granted" : "Revoked"}
                </span>
              </div>
              {c.granted && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={async () => {
                    try {
                      await revoke.mutateAsync(c.channel);
                      toast.success("Consent revoked");
                    } catch {
                      toast.error("Couldn't revoke consent");
                    }
                  }}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function DataControlsCard() {
  const [busy, setBusy] = useState<"csv" | "pdf" | null>(null);

  async function exportData(format: "csv" | "pdf") {
    setBusy(format);
    try {
      await downloadExport(format);
    } catch {
      toast.error("Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-base">Your data</CardTitle>
        <CardDescription>Export everything, or delete your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exportData("csv")} disabled={busy !== null}>
            {busy === "csv" ? "Preparing…" : "Export CSV (zip)"}
          </Button>
          <Button variant="outline" onClick={() => exportData("pdf")} disabled={busy !== null}>
            {busy === "pdf" ? "Preparing…" : "Export PDF summary"}
          </Button>
        </div>
        <DeleteAccountDialog />
      </CardContent>
    </Card>
  );
}

function DeleteAccountDialog() {
  const router = useRouter();
  const del = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  async function onConfirm() {
    try {
      await del.mutateAsync(confirmation);
      authStore.clear();
      toast.success("Account deleted");
      router.replace("/login");
    } catch {
      toast.error("Couldn't delete account — check the confirmation text");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete account</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            This permanently removes your data. Type <strong>DELETE</strong> to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="confirmation">Confirmation</Label>
          <Input
            id="confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="DELETE"
          />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={del.isPending || confirmation.length === 0}
          >
            {del.isPending ? "Deleting…" : "Permanently delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> **Note on the delete confirmation string:** the backend validates `confirmation` server-side.
> The UI suggests typing `DELETE`, but the button only requires a non-empty value — the API is the
> source of truth for what string is accepted. Do not hard-code or validate the exact phrase client-side.

- [ ] Verify typecheck: `docker compose exec web npm run typecheck` → no errors.
- [ ] Verify render: `curl -s http://localhost:3000/settings | grep -o "Settings" | head -1` → `Settings`.
- [ ] Commit:

```bash
git add "web/app/(app)/settings/page.tsx"
git commit -m "feat(web): Settings surface — household, prefs, consents, export, delete"
```

---

## Task 7: Playwright smoke + close-out

**File:** Create `web/e2e/w4.spec.ts` with **exactly** this content:

```ts
import { test, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("notifications surface shows prefs + recent list", async ({ page }) => {
  await login(page);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: /^notifications$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /preferences/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /save preferences/i })).toBeVisible();
});

test("connections surface lists Plaid, Gmail, SMS, bot", async ({ page }) => {
  await login(page);
  await page.goto("/connections");
  await expect(page.getByRole("heading", { name: /^connections$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect bank/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect gmail/i })).toBeVisible();
});

test("settings surface shows household, prefs, and data controls", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: /^settings$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /your data/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /delete account/i })).toBeVisible();
});
```

- [ ] **Step 1: Full typecheck + build** (container):

Run: `docker compose exec web npm run typecheck && docker compose exec web npm run build`
Expected: clean typecheck; build succeeds.

- [ ] **Step 2: Run the smoke suite** (host; dev server up on :3000):

Run: `cd web && npx playwright test w4.spec.ts`
Expected: `3 passed`.

- [ ] **Step 3: Update `web/REBUILD_PROGRESS.md`** — flip the W4 wave line, the three surface rows,
  and add W4 notes.

In **Waves**, replace the W4 line with:
```
- [x] **W4** — Notifications (list + mark-read, channel/quiet-hours prefs); Connections (Plaid link-token, Gmail OAuth/sync/disconnect, SMS token rotate/disconnect; bot on hold); Settings (household + members, base-currency/locale/language, consents, CSV/PDF export, account delete).
```

In the **Surfaces** table, set these rows to `done`:
```
| Notifications | done | /notifications/*, prefs | list + mark-read, channel toggles, quiet hours (web push informational) |
| Connections | done | /plaid/*, /email/*, /sms/* | Plaid link-token, Gmail OAuth/sync/disconnect, SMS token rotate/disconnect (bot on hold) |
| Settings | done | /household, /settings, /consents, /export, /account | household+members, prefs, consents revoke, CSV/PDF export, account delete |
```

Add a **W4 notes** section after W3 notes:
```
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
```

- [ ] **Step 4: Commit**

```bash
git add web/e2e/w4.spec.ts web/REBUILD_PROGRESS.md
git commit -m "test(web): W4 smoke; mark Notifications/Connections/Settings done"
```

---

## W4 Done When

- `docker compose exec web npm run typecheck` is clean and `npm run build` succeeds.
- `npx playwright test w4.spec.ts` passes `3 passed`.
- `/notifications` lists notifications with working "Mark read", and the Preferences card saves
  channel toggles + quiet hours (the "Web push" toggle prompts for browser permission).
- `/connections` shows Plaid / Gmail / SMS / Bot cards: "Connect bank" issues a link token,
  "Connect Gmail" opens the OAuth URL (or toasts if unconfigured), "Sync now" reports a count,
  SMS "Generate token" shows a webhook URL + token, Bot is on-hold.
- `/settings` shows the household + members, saves base-currency/locale/language, lists consents
  with working "Revoke", exports CSV (zip) and PDF, and the "Delete account" dialog deletes +
  redirects to `/login`.
- `web/REBUILD_PROGRESS.md` marks W4 and all three surfaces done. **This completes the M15
  frontend rebuild — all surfaces are now live.**

## Guardrails for the implementing agent

- **Do not** add npm packages or run `shadcn add`. Every import above already resolves
  (`card` incl. `CardFooter`, `dialog` incl. `DialogDescription`, `button`, `input`, `label`,
  `badge`, `skeleton`, `sonner` are all present in `web/components/ui/`). The W3 `KeyValues`
  helper already exists in `web/components/guidance/citations.tsx`.
- **Do not** modify `lib/api/client.ts`, `lib/api/auth.ts`, the layout, or any W0–W3 surface.
- **Do not** introduce a `switch` primitive or i18n keys — use styled native checkboxes and
  inline English.
- **204 endpoints** (`DELETE /email/connection`, `DELETE /sms/connection`, `DELETE /account`)
  must use the `const { error } = await api.DELETE(...); if (error) throw error;` pattern — do
  **not** wrap them in `unwrap` (it throws on empty bodies).
- Integration calls **will** fail in dev — handle every connection mutation with try/catch + a
  toast; never let a 502 throw to the error boundary.
- Money/decimal fields from the API are **strings**; render via `formatCurrency`, wrap in
  `Number(...)` before arithmetic.
- Opaque `dict` fields must be cast to `Record<string, unknown>` and rendered with `KeyValues` —
  never index inner keys directly.
- If typecheck fails, fix the code you just wrote to match `shared/api-schema.ts` — do not edit
  the generated schema or the backend.
```
