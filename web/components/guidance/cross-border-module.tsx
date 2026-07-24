"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useCreateTransfer,
  useTransfers,
  type Transfer,
} from "@/lib/api/guidance";
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

export function CrossBorderModule() {
  const transfers = useTransfers();

  return (
    <div className="space-y-6">
      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <div className="mb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold tracking-tight">Transfers</h2>
              <p className="text-sm text-muted">Cross-border money movements.</p>
            </div>
            <NewTransferDialog />
          </div>
        </div>
        <div className="space-y-2">
          {transfers.isLoading ? (
            <Skeleton className="h-20" />
          ) : transfers.isError ? (
            <QueryRetry label="transfers" onRetry={() => void transfers.refetch()} />
          ) : (transfers.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">No transfers logged yet.</p>
          ) : (
            (transfers.data ?? []).map((t) => <TransferRow key={t.id} transfer={t} />)
          )}
        </div>
      </div>
    </div>
  );
}

function QueryRetry({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      <span>We couldn&apos;t load {label}.</span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Retry {label}
      </Button>
    </div>
  );
}

function TransferRow({ transfer }: { transfer: Transfer }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
      <div>
        <span className="font-medium">
          {transfer.from_currency} → {transfer.to_currency}
        </span>
        <span className="ml-2 capitalize text-muted">{transfer.direction}</span>
      </div>
      <div data-numeric className="text-right">
        <span className="font-medium">
          {formatCurrency(transfer.amount, { currency: transfer.from_currency })}
        </span>
        {transfer.transfer_date && (
          <span className="ml-2 text-muted">{transfer.transfer_date}</span>
        )}
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
        direction: String(form.get("direction") ?? "out") === "in" ? "in" : "out",
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
            <select id="direction" name="direction" className={SELECT_CLASS} defaultValue="out">
              <option value="out">Outbound</option>
              <option value="in">Inbound</option>
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
              <Input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fx_rate">FX rate</Label>
              <Input id="fx_rate" name="fx_rate" type="number" min="0.0001" step="0.0001" />
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
