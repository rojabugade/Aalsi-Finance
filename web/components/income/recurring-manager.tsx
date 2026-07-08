"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  useRecurringSeries,
  useCreateRecurringSeries,
  useDeleteRecurringSeries,
  type RecurringSeriesIn,
} from "@/lib/api/widget-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RowList } from "@/components/ui/row-list";
import { Repeat, Trash2 } from "@/lib/icons";
import { formatCurrency } from "@/lib/format";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function RecurringManager() {
  const series = useRecurringSeries("active");
  const del = useDeleteRecurringSeries();
  const rows = series.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recurring</h3>
        <AddRecurringDialog />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-card-sm border border-border bg-card p-4 text-sm text-muted">
          No recurring items yet. They appear automatically from your transactions, or add one.
        </p>
      ) : (
        <RowList>
          {rows.map((r) => (
            <div key={r.id} className="flex w-full items-center gap-3.5 py-3 text-left">
              <span className="grid size-[38px] flex-none place-items-center rounded-chip bg-accent-soft text-accent">
                <Repeat className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                <span className="mt-px block text-[11.5px] text-muted">
                  {r.cadence}
                  {r.type ? ` · ${r.type}` : ""}
                </span>
              </span>
              {r.amount != null && (
                <span className="text-sm font-bold tabular-nums">{formatCurrency(Number(r.amount))}</span>
              )}
              <button
                type="button"
                aria-label={`Delete ${r.name}`}
                className="flex-none text-muted transition-colors hover:text-destructive"
                onClick={async () => {
                  try {
                    await del.mutateAsync(r.id);
                    toast.success("Removed");
                  } catch {
                    toast.error("Couldn't remove");
                  }
                }}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </RowList>
      )}
    </section>
  );
}

function AddRecurringDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateRecurringSeries();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: RecurringSeriesIn = {
      name: String(form.get("name") ?? "").trim(),
      amount: String(form.get("amount") ?? "0"),
      currency: "USD",
      cadence: String(form.get("cadence") ?? "monthly") as RecurringSeriesIn["cadence"],
      type: String(form.get("type") ?? "bill") as RecurringSeriesIn["type"],
      status: "active",
      next_due_date: String(form.get("next_due_date") ?? "") || null,
    };
    try {
      await create.mutateAsync(body);
      toast.success("Recurring added");
      setOpen(false);
    } catch {
      toast.error("Couldn't add recurring");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Add recurring</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add recurring</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="next_due_date">Next due</Label>
              <Input id="next_due_date" name="next_due_date" type="date" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cadence">Cadence</Label>
              <select id="cadence" name="cadence" className={SELECT_CLASS} defaultValue="monthly">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="type">Type</Label>
              <select id="type" name="type" className={SELECT_CLASS} defaultValue="bill">
                <option value="bill">Bill</option>
                <option value="subscription">Subscription</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Add recurring"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
