"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useBudgets, useCreateBudget, useUpdateBudget, useDeleteBudget, type Budget } from "@/lib/api/budgets";
import { useCategories } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SectionIntro } from "@/components/insights/section-intro";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Pencil, Trash2, MoreHorizontal } from "lucide-react";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const num = (v: unknown) => Number(v ?? 0);

export default function BudgetsPage() {
  const budgets = useBudgets();
  const categories = useCategories();

  const catName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories.data ?? []) m.set(c.id, c.name);
    return (id: string | null | undefined) => (id ? m.get(id) ?? "Category" : "All spending");
  }, [categories.data]);

  return (
    <div className="space-y-4">
      <SectionIntro title="Budgets" blurb="How your spending tracks against the limits you set, this period." />
      <div className="flex justify-end">
        <NewBudgetDialog />
      </div>

      {budgets.isError ? (
        <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
          Couldn&apos;t load budgets. Check your connection and try again.
        </div>
      ) : budgets.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (budgets.data ?? []).length === 0 ? (
        <div className="rounded-card-sm border border-border bg-card py-16 text-center text-sm text-muted shadow-card">
          No budgets yet. Create one to start tracking.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(budgets.data ?? []).map((b) => (
            <BudgetCard key={b.id} budget={b} label={catName(b.category_id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetCard({ budget, label }: { budget: Budget; label: string }) {
  const amount = num(budget.amount);
  const spent = num(budget.spent);
  const pct = Math.min(100, num(budget.progress_pct));
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-base font-bold capitalize tracking-tight">{label.toLowerCase()}</h3>
          <p className="text-xs capitalize text-muted">{budget.period}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <EditBudgetDialog budget={budget} open={editing} onOpenChange={setEditing} />
        <DeleteBudgetDialog budget={budget} open={confirmDelete} onOpenChange={setConfirmDelete} />
      </div>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between text-sm">
          <span data-numeric className="font-medium">
            {formatCurrency(spent, { currency: budget.currency })}
          </span>
          <span className="text-muted">
            of {formatCurrency(amount, { currency: budget.currency })}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-track">
          <div
            className={cn(
              "h-full rounded-full",
              budget.overspent ? "bg-destructive" : "bg-accent",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p
          className={cn(
            "text-xs",
            budget.overspent ? "text-destructive" : "text-muted",
          )}
        >
          {budget.overspent
            ? `Over by ${formatCurrency(Math.abs(num(budget.remaining)), { currency: budget.currency })}`
            : `${formatCurrency(num(budget.remaining), { currency: budget.currency })} left`}
        </p>
      </div>
    </div>
  );
}

function EditBudgetDialog({ budget, open, onOpenChange }: { budget: Budget; open: boolean; onOpenChange: (v: boolean) => void }) {
  const categories = useCategories();
  const update = useUpdateBudget();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const patch: Record<string, unknown> = {};
    const categoryId = String(form.get("category_id") ?? "");
    if (categoryId) patch.category_id = categoryId;
    patch.period = String(form.get("period") ?? budget.period);
    patch.amount = String(form.get("amount") ?? budget.amount);
    patch.currency = String(form.get("currency") ?? budget.currency);
    try {
      await update.mutateAsync({ id: budget.id, ...patch } as any);
      toast.success("Budget updated");
      onOpenChange(false);
    } catch {
      toast.error("Couldn't update budget");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit budget</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="edit-category_id">Category</Label>
            <select id="edit-category_id" name="category_id" className={SELECT_CLASS} defaultValue={budget.category_id ?? ""}>
              <option value="">All spending</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-period">Period</Label>
            <select id="edit-period" name="period" className={SELECT_CLASS} defaultValue={budget.period}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-amount">Amount</Label>
              <Input id="edit-amount" name="amount" type="number" min="0" step="0.01" defaultValue={budget.amount} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-currency">Currency</Label>
              <Input id="edit-currency" name="currency" defaultValue={budget.currency} maxLength={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteBudgetDialog({ budget, open, onOpenChange }: { budget: Budget; open: boolean; onOpenChange: (v: boolean) => void }) {
  const del = useDeleteBudget();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete budget?</DialogTitle>
          <DialogDescription>
            This will permanently remove this budget. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => del.mutate(budget.id, { onSuccess: () => { toast.success("Budget deleted"); onOpenChange(false); }, onError: () => toast.error("Couldn't delete budget") })}
            disabled={del.isPending}
          >
            {del.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewBudgetDialog() {
  const [open, setOpen] = useState(false);
  const categories = useCategories();
  const create = useCreateBudget();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const categoryId = String(form.get("category_id") ?? "");
    try {
      await create.mutateAsync({
        category_id: categoryId || null,
        period: String(form.get("period") ?? "monthly"),
        amount: String(form.get("amount") ?? "0"),
        currency: String(form.get("currency") ?? "USD"),
      });
      toast.success("Budget created");
      setOpen(false);
    } catch {
      toast.error("Couldn't create budget");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New budget</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New budget</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="category_id">Category</Label>
            <select id="category_id" name="category_id" className={SELECT_CLASS} defaultValue="">
              <option value="">All spending</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="period">Period</Label>
            <select id="period" name="period" className={SELECT_CLASS} defaultValue="monthly">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" defaultValue="USD" maxLength={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving..." : "Create budget"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
