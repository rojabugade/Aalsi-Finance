"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCreateTransaction, useCategories } from "@/lib/api/transactions";
import { usePaymentMethods } from "@/lib/api/widget-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { COMMON_CURRENCIES } from "@/lib/constants/currencies";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function ManualTransactionEntry() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = useCategories();
  const methods = usePaymentMethods();
  const create = useCreateTransaction();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const categoryId = String(f.get("category_id") ?? "");
    const methodId = String(f.get("payment_method_id") ?? "");
    try {
      await create.mutateAsync({
        merchant: String(f.get("merchant") ?? "") || null,
        amount: String(f.get("amount") ?? "0"),
        currency: String(f.get("currency") ?? "USD") || "USD",
        txn_date: String(f.get("txn_date") ?? ""),
        category_id: categoryId || null,
        payment_method_id: methodId || null,
        notes: String(f.get("notes") ?? "") || null,
        source_channel: "manual",
        status: "draft",
      });
      toast.success("Transaction added");
      setOpen(false);
    } catch {
      setError("Couldn't save that transaction. Check the amount and date, then try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Enter manually</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add transaction manually</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} data-testid="manual-tx-form" className="space-y-4">
          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="merchant">Merchant</Label>
            <Input id="merchant" name="merchant" placeholder="Where did you spend?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="amount" required>Amount</Label>
              <Input id="amount" name="amount" type="number" inputMode="decimal" step="0.01" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="currency">Currency</Label>
              <NativeSelect id="currency" name="currency" defaultValue="USD">
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="txn_date" required>Date</Label>
            <Input id="txn_date" name="txn_date" type="date" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="category_id">Category</Label>
            <NativeSelect id="category_id" name="category_id" defaultValue="">
              <option value="">No category</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="payment_method_id">Payment method</Label>
            <NativeSelect id="payment_method_id" name="payment_method_id" defaultValue="">
              <option value="">Unspecified</option>
              {(methods.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="Optional" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving..." : "Add transaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
