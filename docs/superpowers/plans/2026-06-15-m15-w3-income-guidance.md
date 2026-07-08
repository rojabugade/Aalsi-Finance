# M15 Frontend Rebuild — W3 (Income/Equity · Guidance + Cross-Border) Implementation Plan

> **For the implementing agent (Codex):** This plan is **prescriptive**. Each task gives the
> **exact, complete file contents** to write. Create/replace each file with the code block
> **verbatim** — do not redesign, rename, restyle, or "improve" it. Do not add libraries or
> shadcn primitives. Do not edit files this plan does not mention. After each task, run the
> listed verification command and confirm the expected output. Steps use `- [ ]` for tracking.

**Goal:** Replace the `ComingSoon` placeholders for **Income** and **Guidance** with working
surfaces. Income covers income sources, take-home estimates, and equity (grants/events/summary).
Guidance covers cited Q&A, the cross-border wizard, and the **cross-border module** (transfers +
remittance limits) — per the spec, cross-border is *one module inside Guidance*, not a top-level
surface.

**Architecture (already in place — follow it, don't reinvent):**
- Each surface is a client page under `web/app/(app)/<surface>/page.tsx`.
- Data access is through **per-domain hook modules** in `web/lib/api/*`, each defining a local
  `unwrap()` helper and exporting TanStack Query `useQuery`/`useMutation` hooks built on the
  typed `api` client from `@/lib/api/client`.
- Types come from the generated schema: `import type { components } from "@shared/api-schema"`
  then `components["schemas"]["<Name>"]`.
- **Inline English strings** (no i18n keys on feature surfaces).
- Money/decimal values arrive from the API as **strings**; render with `formatCurrency` from
  `@/lib/format` (accepts `string | number`); for math wrap in `Number(...)`.
- **`dict` backend fields generate as `Record<string, never>` / `Record<string, never>[]` in
  TypeScript** (e.g. take-home `estimates`, wizard `checklist`/`reminders`, limits
  `totals`/`limits`/`warnings`). You **cannot** index their properties without a TS error.
  Render them defensively: cast to `Record<string, unknown>` and show `Object.entries(...)`
  key/value pairs (helper `KeyValues` is provided below). Never assume specific inner keys.
- Reuse existing tokens/patterns: `text-success`, `text-destructive`, `text-muted-foreground`,
  `bg-muted`, `data-numeric` on numeric cells, the styled native `<select>` class, and the
  Dialog-based create forms exactly as W2 used them.

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

## Backend contract (already verified — do not change the backend)

**Income (all money fields are strings on output; inputs accept string):**
- `GET /income-sources` → `IncomeSourceOut[]`; `POST /income-sources` body `IncomeSourceIn
  { employer?, country?, currency, frequency, gross?, net?, withholding? }`;
  `PATCH /income-sources/{source_id}` body `IncomeSourcePatch`.
- `POST /paystubs` body `PaystubIn` (not built in this wave's UI — skip).
- `GET /income/take-home?source_id=<uuid>` → `TakeHomeOut { source_id, country?, currency,
  gross_period, gross_annual, estimates (dict), disclaimer, ... }`.
- `GET /equity/grants` → `EquityGrantOut[]`; `POST /equity/grants` body `EquityGrantIn
  { income_source_id, type, ticker?, country?, grant_date?, shares?, strike_price?, vesting_schedule? }`.
- `GET /equity/events` → `EquityEventOut[]`; `POST /equity/events` body `EquityEventIn
  { equity_grant_id, type, event_date?, shares?, fmv?, proceeds?, est_tax? }`.
- `GET /equity/summary` → `EquitySummaryOut { vested_value, unvested_shares, grants[], disclaimer }`.

**Guidance:**
- `POST /guidance/ask` and `POST /cross-border/ask` — same body `GuidanceAskIn
  { question, country?, topic? }` → `GuidanceAskOut { answer, citations: Citation[], disclaimer }`.
- `POST /guidance/wizard` and `POST /cross-border/wizard` — same body `GuidanceWizardIn
  { countries[], residency?, annual_transfer_amount?, transfer_currency?, account_types[] }`
  → `GuidanceWizardOut { checklist (dict[]), reminders (dict[]), citations[], disclaimer }`.
- `GET /cross-border/transfers` → `CrossBorderTransferOut[]`; `POST /cross-border/transfers`
  body `CrossBorderTransferIn { direction, from_currency, to_currency, amount, fx_rate?, purpose?,
  channel?, transfer_date?, ... }`.
- `GET /cross-border/limits` → `LimitsOut { totals (dict[]), limits (dict[]), warnings (dict[]),
  citations[] }`.
- `Citation = { title?, source_url?, source_type?, effective_date? }`.

## Files created/modified in W3

```
web/
  lib/api/
    income.ts                          # CREATE
    guidance.ts                        # CREATE
  app/(app)/
    income/page.tsx                    # REPLACE placeholder
    guidance/page.tsx                  # REPLACE placeholder
  components/
    income/equity-section.tsx          # CREATE
    guidance/citations.tsx             # CREATE (shared Citations + KeyValues helpers)
    guidance/cross-border-module.tsx   # CREATE (transfers + limits)
  e2e/w3.spec.ts                       # CREATE (smoke)
  REBUILD_PROGRESS.md                  # MODIFY: mark W3 done
```

---

## Task 1: Income API hook module

**File:** Create `web/lib/api/income.ts` with **exactly** this content:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type IncomeSource = components["schemas"]["IncomeSourceOut"];
export type IncomeSourceIn = components["schemas"]["IncomeSourceIn"];
export type TakeHome = components["schemas"]["TakeHomeOut"];
export type EquityGrant = components["schemas"]["EquityGrantOut"];
export type EquityGrantIn = components["schemas"]["EquityGrantIn"];
export type EquityEvent = components["schemas"]["EquityEventOut"];
export type EquityEventIn = components["schemas"]["EquityEventIn"];
export type EquitySummary = components["schemas"]["EquitySummaryOut"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useIncomeSources() {
  return useQuery({
    queryKey: ["income-sources"],
    queryFn: () => unwrap(api.GET("/income-sources", {})),
  });
}

export function useCreateIncomeSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IncomeSourceIn) => unwrap(api.POST("/income-sources", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["income-sources"] }),
  });
}

/** Take-home estimate for one source. Enabled only when a source id is set. */
export function useTakeHome(sourceId: string | null) {
  return useQuery({
    queryKey: ["income", "take-home", sourceId],
    enabled: Boolean(sourceId),
    queryFn: () =>
      unwrap(
        api.GET("/income/take-home", {
          params: { query: { source_id: sourceId as string } },
        }),
      ),
  });
}

export function useEquitySummary() {
  return useQuery({
    queryKey: ["equity", "summary"],
    queryFn: () => unwrap(api.GET("/equity/summary", {})),
  });
}

export function useEquityGrants() {
  return useQuery({
    queryKey: ["equity", "grants"],
    queryFn: () => unwrap(api.GET("/equity/grants", {})),
  });
}

export function useCreateEquityGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EquityGrantIn) => unwrap(api.POST("/equity/grants", { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equity", "grants"] });
      qc.invalidateQueries({ queryKey: ["equity", "summary"] });
    },
  });
}

export function useEquityEvents() {
  return useQuery({
    queryKey: ["equity", "events"],
    queryFn: () => unwrap(api.GET("/equity/events", {})),
  });
}

export function useCreateEquityEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EquityEventIn) => unwrap(api.POST("/equity/events", { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equity", "events"] });
      qc.invalidateQueries({ queryKey: ["equity", "summary"] });
    },
  });
}
```

- [ ] Verify: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/lib/api/income.ts
git commit -m "feat(web): income + equity API hooks"
```

---

## Task 2: Guidance API hook module

**File:** Create `web/lib/api/guidance.ts` with **exactly** this content:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type AskIn = components["schemas"]["GuidanceAskIn"];
export type AskOut = components["schemas"]["GuidanceAskOut"];
export type WizardIn = components["schemas"]["GuidanceWizardIn"];
export type WizardOut = components["schemas"]["GuidanceWizardOut"];
export type Transfer = components["schemas"]["CrossBorderTransferOut"];
export type TransferIn = components["schemas"]["CrossBorderTransferIn"];
export type Limits = components["schemas"]["LimitsOut"];
export type Citation = components["schemas"]["Citation"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

/** Ask guidance. `crossBorder` routes to the cross-border-specialised endpoint. */
export function useAsk() {
  return useMutation({
    mutationFn: ({ crossBorder, body }: { crossBorder: boolean; body: AskIn }) =>
      unwrap(api.POST(crossBorder ? "/cross-border/ask" : "/guidance/ask", { body })),
  });
}

export function useWizard() {
  return useMutation({
    mutationFn: ({ crossBorder, body }: { crossBorder: boolean; body: WizardIn }) =>
      unwrap(api.POST(crossBorder ? "/cross-border/wizard" : "/guidance/wizard", { body })),
  });
}

export function useTransfers() {
  return useQuery({
    queryKey: ["cross-border", "transfers"],
    queryFn: () => unwrap(api.GET("/cross-border/transfers", {})),
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransferIn) => unwrap(api.POST("/cross-border/transfers", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cross-border", "transfers"] }),
  });
}

export function useLimits() {
  return useQuery({
    queryKey: ["cross-border", "limits"],
    queryFn: () => unwrap(api.GET("/cross-border/limits", {})),
  });
}
```

- [ ] Verify: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/lib/api/guidance.ts
git commit -m "feat(web): guidance + cross-border API hooks"
```

---

## Task 3: Shared Citations + KeyValues helpers

**File:** Create `web/components/guidance/citations.tsx` with **exactly** this content:

```tsx
import type { Citation } from "@/lib/api/guidance";

/** Renders any opaque backend dict as key/value rows. Never assumes inner keys. */
export function KeyValues({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== "");
  if (entries.length === 0) return null;
  return (
    <dl className="grid gap-1 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="capitalize text-muted-foreground">{k.replace(/_/g, " ")}</dt>
          <dd data-numeric className="text-right font-medium">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Renders a list of opaque dicts (e.g. wizard checklist items) as small bordered blocks. */
export function DictList({ items }: { items: Record<string, unknown>[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing here.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="rounded-lg border p-3">
          <KeyValues data={item} />
        </li>
      ))}
    </ul>
  );
}

export function Citations({ citations }: { citations: Citation[] }) {
  if (!citations || citations.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground">Sources</p>
      <ul className="space-y-1 text-sm">
        {citations.map((c, i) => (
          <li key={i}>
            {c.source_url ? (
              <a
                href={c.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {c.title ?? c.source_url}
              </a>
            ) : (
              <span>{c.title ?? "Untitled source"}</span>
            )}
            {c.effective_date && (
              <span className="text-muted-foreground"> · {c.effective_date}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] Verify: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/components/guidance/citations.tsx
git commit -m "feat(web): shared Citations + opaque-dict render helpers"
```

---

## Task 4: Equity section component

**File:** Create `web/components/income/equity-section.tsx` with **exactly** this content:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useCreateEquityEvent,
  useCreateEquityGrant,
  useEquityEvents,
  useEquityGrants,
  useEquitySummary,
  type IncomeSource,
} from "@/lib/api/income";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function EquitySection({ sources }: { sources: IncomeSource[] }) {
  const summary = useEquitySummary();
  const grants = useEquityGrants();
  const events = useEquityEvents();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Equity</h2>
          <p className="text-sm text-muted-foreground">Grants, vesting, and events.</p>
        </div>
        <div className="flex gap-2">
          <NewGrantDialog sources={sources} />
          <NewEventDialog grants={grants.data ?? []} />
        </div>
      </div>

      {summary.isLoading ? (
        <Skeleton className="h-28" />
      ) : summary.data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Vested value</p>
              <p data-numeric className="mt-1 text-2xl font-semibold tracking-tight">
                {formatCurrency(summary.data.vested_value)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Unvested shares</p>
              <p data-numeric className="mt-1 text-2xl font-semibold tracking-tight">
                {Number(summary.data.unvested_shares).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {summary.data?.disclaimer && (
        <p className="text-xs text-muted-foreground">{summary.data.disclaimer}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grants</CardTitle>
          <CardDescription>All equity grants in your household.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {grants.isLoading ? (
            <Skeleton className="h-20" />
          ) : (grants.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No grants yet.</p>
          ) : (
            (grants.data ?? []).map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-lg border p-3 text-sm"
              >
                <div>
                  <span className="font-medium uppercase">{g.type}</span>
                  {g.ticker && <span className="ml-2 text-muted-foreground">{g.ticker}</span>}
                </div>
                <div data-numeric className="text-muted-foreground">
                  {g.shares ? `${Number(g.shares).toLocaleString()} sh` : "—"}
                  {g.grant_date ? ` · ${g.grant_date}` : ""}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
          <CardDescription>Vesting, exercise, and sale events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.isLoading ? (
            <Skeleton className="h-20" />
          ) : (events.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            (events.data ?? []).map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between rounded-lg border p-3 text-sm"
              >
                <span className="font-medium capitalize">{e.type}</span>
                <div data-numeric className="text-muted-foreground">
                  {e.shares ? `${Number(e.shares).toLocaleString()} sh` : ""}
                  {e.proceeds ? ` · ${formatCurrency(e.proceeds)}` : ""}
                  {e.event_date ? ` · ${e.event_date}` : ""}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function NewGrantDialog({ sources }: { sources: IncomeSource[] }) {
  const [open, setOpen] = useState(false);
  const create = useCreateEquityGrant();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const str = (k: string) => {
      const v = String(form.get(k) ?? "").trim();
      return v || null;
    };
    try {
      await create.mutateAsync({
        income_source_id: String(form.get("income_source_id") ?? ""),
        type: String(form.get("type") ?? "rsu"),
        ticker: str("ticker"),
        country: str("country"),
        grant_date: str("grant_date"),
        shares: str("shares"),
        strike_price: str("strike_price"),
      });
      toast.success("Grant added");
      setOpen(false);
    } catch {
      toast.error("Couldn't add grant");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={sources.length === 0}>
          Add grant
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add equity grant</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="income_source_id">Income source</Label>
            <select id="income_source_id" name="income_source_id" className={SELECT_CLASS} required>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.employer ?? "Source"}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="type">Type</Label>
              <select id="type" name="type" className={SELECT_CLASS} defaultValue="rsu">
                <option value="rsu">RSU</option>
                <option value="iso">ISO</option>
                <option value="nso">NSO</option>
                <option value="espp">ESPP</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ticker">Ticker</Label>
              <Input id="ticker" name="ticker" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="shares">Shares</Label>
              <Input id="shares" name="shares" type="number" min="0" step="0.0001" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="strike_price">Strike price</Label>
              <Input id="strike_price" name="strike_price" type="number" min="0" step="0.01" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="grant_date">Grant date</Label>
              <Input id="grant_date" name="grant_date" type="date" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="country">Country</Label>
              <Input id="country" name="country" maxLength={2} placeholder="US" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Add grant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewEventDialog({
  grants,
}: {
  grants: { id: string; type: string; ticker?: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const create = useCreateEquityEvent();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const str = (k: string) => {
      const v = String(form.get(k) ?? "").trim();
      return v || null;
    };
    try {
      await create.mutateAsync({
        equity_grant_id: String(form.get("equity_grant_id") ?? ""),
        type: String(form.get("type") ?? "vest"),
        event_date: str("event_date"),
        shares: str("shares"),
        fmv: str("fmv"),
        proceeds: str("proceeds"),
      });
      toast.success("Event added");
      setOpen(false);
    } catch {
      toast.error("Couldn't add event");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={grants.length === 0}>
          Add event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add equity event</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="equity_grant_id">Grant</Label>
            <select id="equity_grant_id" name="equity_grant_id" className={SELECT_CLASS} required>
              {grants.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.type.toUpperCase()}
                  {g.ticker ? ` · ${g.ticker}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="type">Type</Label>
              <select id="type" name="type" className={SELECT_CLASS} defaultValue="vest">
                <option value="vest">Vest</option>
                <option value="exercise">Exercise</option>
                <option value="sale">Sale</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="event_date">Date</Label>
              <Input id="event_date" name="event_date" type="date" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="shares">Shares</Label>
              <Input id="shares" name="shares" type="number" min="0" step="0.0001" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fmv">FMV</Label>
              <Input id="fmv" name="fmv" type="number" min="0" step="0.01" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="proceeds">Proceeds</Label>
              <Input id="proceeds" name="proceeds" type="number" min="0" step="0.01" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Add event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] Verify: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/components/income/equity-section.tsx
git commit -m "feat(web): equity section — summary, grants, events"
```

---

## Task 5: Income surface

**File:** Replace `web/app/(app)/income/page.tsx` with **exactly** this content:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useCreateIncomeSource,
  useIncomeSources,
  useTakeHome,
  type IncomeSource,
} from "@/lib/api/income";
import { EquitySection } from "@/components/income/equity-section";
import { KeyValues } from "@/components/guidance/citations";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function IncomePage() {
  const sources = useIncomeSources();
  const [takeHomeId, setTakeHomeId] = useState<string | null>(null);
  const takeHome = useTakeHome(takeHomeId);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Income</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Income sources, take-home estimates, and equity.
            </p>
          </div>
          <NewSourceDialog />
        </div>

        {sources.isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">
              Couldn&apos;t load income sources.
            </CardContent>
          </Card>
        ) : sources.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : (sources.data ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              No income sources yet. Add one to estimate take-home pay.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(sources.data ?? []).map((s) => (
              <SourceCard key={s.id} source={s} onTakeHome={() => setTakeHomeId(s.id)} />
            ))}
          </div>
        )}
      </section>

      <EquitySection sources={sources.data ?? []} />

      <Dialog open={Boolean(takeHomeId)} onOpenChange={(v) => !v && setTakeHomeId(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Take-home estimate</DialogTitle>
          </DialogHeader>
          {takeHome.isLoading ? (
            <Skeleton className="h-40" />
          ) : takeHome.isError ? (
            <p className="text-sm text-destructive">Couldn&apos;t estimate take-home.</p>
          ) : takeHome.data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Gross / period</p>
                  <p data-numeric className="mt-1 font-semibold">
                    {formatCurrency(takeHome.data.gross_period, {
                      currency: takeHome.data.currency,
                    })}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Gross / year</p>
                  <p data-numeric className="mt-1 font-semibold">
                    {formatCurrency(takeHome.data.gross_annual, {
                      currency: takeHome.data.currency,
                    })}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold">Estimates</p>
                <KeyValues data={takeHome.data.estimates as Record<string, unknown>} />
              </div>
              <p className="text-xs text-muted-foreground">{takeHome.data.disclaimer}</p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SourceCard({
  source,
  onTakeHome,
}: {
  source: IncomeSource;
  onTakeHome: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{source.employer ?? "Income source"}</CardTitle>
        <CardDescription className="capitalize">
          {source.frequency}
          {source.country ? ` · ${source.country}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm">
          {source.gross != null && (
            <p data-numeric className="font-semibold">
              {formatCurrency(source.gross, { currency: source.currency })}{" "}
              <span className="font-normal text-muted-foreground">gross</span>
            </p>
          )}
          {source.net != null && (
            <p data-numeric className="text-muted-foreground">
              {formatCurrency(source.net, { currency: source.currency })} net
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onTakeHome}>
          Take-home estimate
        </Button>
      </CardContent>
    </Card>
  );
}

function NewSourceDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateIncomeSource();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const str = (k: string) => {
      const v = String(form.get(k) ?? "").trim();
      return v || null;
    };
    try {
      await create.mutateAsync({
        employer: str("employer"),
        country: str("country"),
        currency: String(form.get("currency") ?? "USD"),
        frequency: String(form.get("frequency") ?? "monthly"),
        gross: str("gross"),
        net: str("net"),
      });
      toast.success("Income source added");
      setOpen(false);
    } catch {
      toast.error("Couldn't add income source");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add source</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add income source</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="employer">Employer</Label>
            <Input id="employer" name="employer" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="frequency">Frequency</Label>
              <select id="frequency" name="frequency" className={SELECT_CLASS} defaultValue="monthly">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="semimonthly">Semimonthly</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="country">Country</Label>
              <Input id="country" name="country" maxLength={2} placeholder="US" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="gross">Gross</Label>
              <Input id="gross" name="gross" type="number" min="0" step="0.01" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="net">Net</Label>
              <Input id="net" name="net" type="number" min="0" step="0.01" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" defaultValue="USD" maxLength={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Add source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] Verify typecheck: `docker compose exec web npm run typecheck` → no errors.
- [ ] Verify render: `curl -s http://localhost:3000/income | grep -o "Income" | head -1` → `Income`.
- [ ] Commit:

```bash
git add "web/app/(app)/income/page.tsx"
git commit -m "feat(web): Income surface — sources, take-home, equity"
```

---

## Task 6: Cross-border module component

**File:** Create `web/components/guidance/cross-border-module.tsx` with **exactly** this content:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useCreateTransfer,
  useLimits,
  useTransfers,
  type Transfer,
} from "@/lib/api/guidance";
import { Citations, DictList, KeyValues } from "@/components/guidance/citations";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function CrossBorderModule() {
  const transfers = useTransfers();
  const limits = useLimits();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Transfers</CardTitle>
              <CardDescription>Cross-border money movements.</CardDescription>
            </div>
            <NewTransferDialog />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {transfers.isLoading ? (
            <Skeleton className="h-20" />
          ) : (transfers.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No transfers logged yet.</p>
          ) : (
            (transfers.data ?? []).map((t) => <TransferRow key={t.id} transfer={t} />)
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Remittance limits</CardTitle>
          <CardDescription>Annual totals against regulatory limits.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {limits.isLoading ? (
            <Skeleton className="h-24" />
          ) : limits.data ? (
            <>
              <LimitsBlock title="Totals" rows={limits.data.totals as Record<string, unknown>[]} />
              <LimitsBlock title="Limits" rows={limits.data.limits as Record<string, unknown>[]} />
              {(limits.data.warnings as Record<string, unknown>[]).length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-destructive">Warnings</p>
                  <DictList items={limits.data.warnings as Record<string, unknown>[]} />
                </div>
              )}
              <Citations citations={limits.data.citations} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No limit data available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TransferRow({ transfer }: { transfer: Transfer }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
      <div>
        <span className="font-medium">
          {transfer.from_currency} → {transfer.to_currency}
        </span>
        <span className="ml-2 capitalize text-muted-foreground">{transfer.direction}</span>
      </div>
      <div data-numeric className="text-right">
        <span className="font-medium">
          {formatCurrency(transfer.amount, { currency: transfer.from_currency })}
        </span>
        {transfer.transfer_date && (
          <span className="ml-2 text-muted-foreground">{transfer.transfer_date}</span>
        )}
      </div>
    </div>
  );
}

function LimitsBlock({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{title}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border p-3">
            <KeyValues data={r} />
          </div>
        ))}
      </div>
    </div>
  );
}

function NewTransferDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateTransfer();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const str = (k: string) => {
      const v = String(form.get(k) ?? "").trim();
      return v || null;
    };
    try {
      await create.mutateAsync({
        direction: String(form.get("direction") ?? "outbound"),
        from_currency: String(form.get("from_currency") ?? "USD"),
        to_currency: String(form.get("to_currency") ?? "INR"),
        amount: String(form.get("amount") ?? "0"),
        fx_rate: str("fx_rate"),
        purpose: str("purpose"),
        channel: str("channel"),
        transfer_date: str("transfer_date"),
      });
      toast.success("Transfer logged");
      setOpen(false);
    } catch {
      toast.error("Couldn't log transfer");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Log transfer</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log cross-border transfer</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="direction">Direction</Label>
            <select id="direction" name="direction" className={SELECT_CLASS} defaultValue="outbound">
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="from_currency">From currency</Label>
              <Input id="from_currency" name="from_currency" defaultValue="USD" maxLength={3} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to_currency">To currency</Label>
              <Input id="to_currency" name="to_currency" defaultValue="INR" maxLength={3} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fx_rate">FX rate</Label>
              <Input id="fx_rate" name="fx_rate" type="number" min="0" step="0.0001" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="purpose">Purpose</Label>
              <Input id="purpose" name="purpose" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="transfer_date">Date</Label>
              <Input id="transfer_date" name="transfer_date" type="date" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Log transfer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] Verify: `docker compose exec web npm run typecheck` → no errors.
- [ ] Commit:

```bash
git add web/components/guidance/cross-border-module.tsx
git commit -m "feat(web): cross-border module — transfers + remittance limits"
```

---

## Task 7: Guidance surface

**File:** Replace `web/app/(app)/guidance/page.tsx` with **exactly** this content:

```tsx
"use client";

import { useState } from "react";

import { useAsk, useWizard } from "@/lib/api/guidance";
import { Citations, DictList } from "@/components/guidance/citations";
import { CrossBorderModule } from "@/components/guidance/cross-border-module";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";

type Tab = "ask" | "wizard" | "cross-border";

export default function GuidancePage() {
  const [tab, setTab] = useState<Tab>("ask");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Guidance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cited answers, a planning wizard, and cross-border tools.
        </p>
      </div>

      <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5">
        {(
          [
            ["ask", "Ask"],
            ["wizard", "Wizard"],
            ["cross-border", "Cross-border"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "ask" && <AskPanel />}
      {tab === "wizard" && <WizardPanel />}
      {tab === "cross-border" && <CrossBorderModule />}
    </div>
  );
}

function AskPanel() {
  const ask = useAsk();
  const [crossBorder, setCrossBorder] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const country = String(form.get("country") ?? "").trim();
    const topic = String(form.get("topic") ?? "").trim();
    ask.mutate({
      crossBorder,
      body: {
        question: String(form.get("question") ?? ""),
        country: country || null,
        topic: topic || null,
      },
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Ask a question</CardTitle>
          <CardDescription>Answers are grounded in cited source documents.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="question">Question</Label>
              <Textarea id="question" name="question" rows={3} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="country">Country (optional)</Label>
                <Input id="country" name="country" maxLength={2} placeholder="US" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="topic">Topic (optional)</Label>
                <Input id="topic" name="topic" placeholder="taxes" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={crossBorder}
                onChange={(e) => setCrossBorder(e.target.checked)}
              />
              Cross-border specialised
            </label>
            <Button type="submit" disabled={ask.isPending}>
              {ask.isPending ? "Thinking…" : "Ask"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {ask.isPending && <Skeleton className="h-40" />}
      {ask.isError && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Couldn&apos;t get an answer. Try again.
          </CardContent>
        </Card>
      )}
      {ask.data && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{ask.data.answer}</p>
            <Citations citations={ask.data.citations} />
            <p className="text-xs text-muted-foreground">{ask.data.disclaimer}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WizardPanel() {
  const wizard = useWizard();
  const [crossBorder, setCrossBorder] = useState(true);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const list = (k: string) =>
      String(form.get(k) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const amount = String(form.get("annual_transfer_amount") ?? "").trim();
    const currency = String(form.get("transfer_currency") ?? "").trim();
    const residency = String(form.get("residency") ?? "").trim();
    wizard.mutate({
      crossBorder,
      body: {
        countries: list("countries").length ? list("countries") : ["US", "IN"],
        residency: residency || null,
        annual_transfer_amount: amount || null,
        transfer_currency: currency || null,
        account_types: list("account_types"),
      },
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Planning wizard</CardTitle>
          <CardDescription>Generates a checklist and reminders for your situation.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="countries">Countries (comma-separated)</Label>
                <Input id="countries" name="countries" defaultValue="US, IN" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="residency">Residency</Label>
                <Input id="residency" name="residency" placeholder="US resident" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="annual_transfer_amount">Annual transfer amount</Label>
                <Input
                  id="annual_transfer_amount"
                  name="annual_transfer_amount"
                  type="number"
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="transfer_currency">Transfer currency</Label>
                <Input id="transfer_currency" name="transfer_currency" maxLength={3} placeholder="USD" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="account_types">Account types (comma-separated)</Label>
              <Input id="account_types" name="account_types" placeholder="checking, brokerage" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={crossBorder}
                onChange={(e) => setCrossBorder(e.target.checked)}
              />
              Cross-border specialised
            </label>
            <Button type="submit" disabled={wizard.isPending}>
              {wizard.isPending ? "Building…" : "Build plan"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {wizard.isPending && <Skeleton className="h-48" />}
      {wizard.isError && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Couldn&apos;t build a plan. Try again.
          </CardContent>
        </Card>
      )}
      {wizard.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <DictList items={wizard.data.checklist as Record<string, unknown>[]} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reminders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DictList items={wizard.data.reminders as Record<string, unknown>[]} />
              <Citations citations={wizard.data.citations} />
              <p className="text-xs text-muted-foreground">{wizard.data.disclaimer}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
```

- [ ] Verify typecheck: `docker compose exec web npm run typecheck` → no errors.
- [ ] Verify render: `curl -s http://localhost:3000/guidance | grep -o "Guidance" | head -1` → `Guidance`.
- [ ] Commit:

```bash
git add "web/app/(app)/guidance/page.tsx"
git commit -m "feat(web): Guidance surface — ask, wizard, cross-border module"
```

---

## Task 8: Playwright smoke + close-out

**File:** Create `web/e2e/w3.spec.ts` with **exactly** this content:

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

test("income surface renders sources + equity", async ({ page }) => {
  await login(page);
  await page.goto("/income");
  await expect(page.getByRole("heading", { name: /^income$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /add source/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^equity$/i })).toBeVisible();
});

test("guidance surface switches between ask, wizard, cross-border", async ({ page }) => {
  await login(page);
  await page.goto("/guidance");
  await expect(page.getByRole("heading", { name: /^guidance$/i })).toBeVisible();
  await page.getByRole("button", { name: /^wizard$/i }).click();
  await expect(page.getByRole("button", { name: /build plan/i })).toBeVisible();
  await page.getByRole("button", { name: /^cross-border$/i }).click();
  await expect(page.getByRole("heading", { name: /transfers/i })).toBeVisible();
});
```

- [ ] **Step 1: Full typecheck + build** (container):

Run: `docker compose exec web npm run typecheck && docker compose exec web npm run build`
Expected: clean typecheck; build succeeds.

- [ ] **Step 2: Run the smoke suite** (host; dev server up on :3000):

Run: `cd web && npx playwright test w3.spec.ts`
Expected: `2 passed`.

- [ ] **Step 3: Update `web/REBUILD_PROGRESS.md`** — change the W3 line and the two surface rows.

In **Waves**, replace the W3 line with:
```
- [x] **W3** — Income/equity (sources, take-home, grants/events/summary); Guidance (cited ask, planning wizard, cross-border module: transfers + remittance limits).
```

In the **Surfaces** table, set these rows to `done`:
```
| Income | done | /income-sources, /income/take-home, /equity/* | sources list/create, take-home estimate dialog, equity summary + grants/events |
| Guidance | done | /guidance/ask+wizard, /cross-border/* | cited ask, wizard checklist/reminders, cross-border transfers + limits (cross-border = module here) |
```

Add a **W3 notes** section after W2 notes:
```
## W3 notes
- `dict` backend fields (take-home `estimates`, wizard `checklist`/`reminders`, limits rows)
  generate as `Record<string, never>` in TS; rendered generically via `KeyValues`/`DictList`
  in `components/guidance/citations.tsx` (cast to `Record<string, unknown>`), so the UI doesn't
  hard-code inner keys the backend may change.
- Ask/wizard hit the cross-border-specialised endpoints when the "Cross-border" toggle is on.
- Paystub ingestion UI (`POST /paystubs`) deferred — paystubs flow through Capture/OCR instead.
- Equity `vesting_schedule`/`est_tax` and transfer base-amount fields are accepted by the API
  but not surfaced in the create forms yet (future pass).
```

- [ ] **Step 4: Commit**

```bash
git add web/e2e/w3.spec.ts web/REBUILD_PROGRESS.md
git commit -m "test(web): W3 smoke; mark Income/Guidance done"
```

---

## W3 Done When

- `docker compose exec web npm run typecheck` is clean and `npm run build` succeeds.
- `npx playwright test w3.spec.ts` passes `2 passed`.
- `/income` lists income sources, "Add source" creates one, "Take-home estimate" opens a dialog
  with gross figures + estimates + disclaimer; the Equity section shows summary, grants, events,
  with working "Add grant"/"Add event".
- `/guidance` has Ask / Wizard / Cross-border tabs: Ask returns a cited answer; Wizard returns a
  checklist + reminders + citations; Cross-border shows transfers (with "Log transfer") and the
  remittance-limits view.
- `web/REBUILD_PROGRESS.md` marks W3 and the two surfaces done.

## Guardrails for the implementing agent

- **Do not** add npm packages or run `shadcn add`. Every import above already resolves
  (`textarea`, `dialog`, `card`, `button`, `input`, `label`, `skeleton`, `badge`, `table`,
  `sonner` are all present in `web/components/ui/`).
- **Do not** modify `lib/api/client.ts`, `lib/api/auth.ts`, the layout, or any W0/W1/W2 surface.
- **Do not** introduce i18n keys on these surfaces — inline English.
- Money/decimal fields from the API are **strings**; render via `formatCurrency`, and wrap in
  `Number(...)` before arithmetic or `.toLocaleString()`.
- Opaque `dict` fields must be cast to `Record<string, unknown>` and rendered with `KeyValues`/
  `DictList` — never index inner keys directly (TS will reject it and the shape isn't guaranteed).
- If typecheck fails, fix the code you just wrote to match `shared/api-schema.ts` — do not edit
  the generated schema or the backend.
```
