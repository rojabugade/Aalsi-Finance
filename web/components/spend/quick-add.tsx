"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useCreateTransaction, type Category } from "@/lib/api/transactions";
import { COMMON_CURRENCIES } from "@/lib/constants/currencies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function QuickAdd({ categories, defaultCurrency = "USD" }: { categories: Category[]; defaultCurrency?: string }) {
  const formId = useId();
  const create = useCreateTransaction();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const f = new FormData(form);
    const amount = Number(String(f.get("amount") ?? "").replace(/,/g, ""));
    const merchant = String(f.get("merchant") ?? "").trim();
    const categoryId = String(f.get("category_id") ?? "");
    const currency = String(f.get("currency") ?? defaultCurrency).trim().toUpperCase() || defaultCurrency;
    const date = String(f.get("txn_date") ?? "");

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a positive expense amount.");
      return;
    }
    if (!date) {
      setError("Choose a transaction date.");
      return;
    }

    try {
      await create.mutateAsync({
        merchant: merchant || null,
        amount: (-Math.abs(amount)).toFixed(2),
        currency,
        txn_date: date,
        category_id: categoryId || null,
        source_channel: "manual",
        status: "draft",
      });
      form.reset();
      const dateField = form.elements.namedItem("txn_date") as HTMLInputElement | null;
      if (dateField) dateField.value = today();
      toast.success("Transaction added");
    } catch {
      setError("Couldn't save that transaction. Check the fields and try again.");
      toast.error("Couldn't add transaction");
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      data-testid="spend-quick-add"
      className="rounded-card-sm border border-border bg-card p-3 shadow-card"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <b className="text-sm">Quick add</b>
          <p className="text-xs text-muted">Manual expenses are saved as draft outflows.</p>
        </div>
        <Button type="submit" size="sm" disabled={create.isPending}>
          <Plus className="size-4" />
          {create.isPending ? "Saving..." : "Add"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.7fr_0.8fr_1fr]">
        <div className="space-y-1">
          <Label htmlFor={`${formId}-merchant`}>Merchant</Label>
          <Input id={`${formId}-merchant`} name="merchant" placeholder="Merchant" autoComplete="organization" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${formId}-amount`} required>Amount</Label>
          <Input id={`${formId}-amount`} name="amount" type="number" inputMode="decimal" step="0.01" min="0.01" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${formId}-currency`}>Currency</Label>
          <NativeSelect id={`${formId}-currency`} name="currency" defaultValue={defaultCurrency}>
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${formId}-date`} required>Date</Label>
          <Input id={`${formId}-date`} name="txn_date" type="date" defaultValue={today()} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${formId}-category`}>Category</Label>
          <NativeSelect id={`${formId}-category`} name="category_id" defaultValue="">
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
    </form>
  );
}
