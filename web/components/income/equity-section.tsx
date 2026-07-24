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
          <p className="text-sm text-muted">Grants, vesting, and events.</p>
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
          <div className="rounded-card-sm border border-border bg-card p-5 shadow-card">
              <p className="text-sm text-muted">Vested value</p>
              <p data-numeric className="mt-1 text-2xl font-semibold tracking-tight">
                {formatCurrency(summary.data.vested_value)}
              </p>
          </div>
          <div className="rounded-card-sm border border-border bg-card p-5 shadow-card">
              <p className="text-sm text-muted">Unvested shares</p>
              <p data-numeric className="mt-1 text-2xl font-semibold tracking-tight">
                {Number(summary.data.unvested_shares).toLocaleString()}
              </p>
          </div>
        </div>
      ) : null}

      {summary.data?.disclaimer && (
        <p className="text-xs text-muted">{summary.data.disclaimer}</p>
      )}

      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <div className="mb-3">
          <h2 className="text-base font-bold tracking-tight">Grants</h2>
          <p className="text-sm text-muted">All equity grants in your workspace.</p>
        </div>
        <div className="space-y-2">
          {grants.isLoading ? (
            <Skeleton className="h-20" />
          ) : (grants.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">No grants yet.</p>
          ) : (
            (grants.data ?? []).map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
              >
                <div>
                  <span className="font-medium uppercase">{g.type}</span>
                  {g.ticker && <span className="ml-2 text-muted">{g.ticker}</span>}
                </div>
                <div data-numeric className="text-muted">
                  {g.shares ? `${Number(g.shares).toLocaleString()} sh` : "—"}
                  {g.grant_date ? ` · ${g.grant_date}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <div className="mb-3">
          <h2 className="text-base font-bold tracking-tight">Events</h2>
          <p className="text-sm text-muted">Vesting, exercise, and sale events.</p>
        </div>
        <div className="space-y-2">
          {events.isLoading ? (
            <Skeleton className="h-20" />
          ) : (events.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">No events yet.</p>
          ) : (
            (events.data ?? []).map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
              >
                <span className="font-medium capitalize">{e.type}</span>
                <div data-numeric className="text-muted">
                  {e.shares ? `${Number(e.shares).toLocaleString()} sh` : ""}
                  {e.proceeds ? ` · ${formatCurrency(e.proceeds)}` : ""}
                  {e.event_date ? ` · ${e.event_date}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
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
