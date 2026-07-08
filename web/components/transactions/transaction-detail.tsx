"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Scissors, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  type Category,
  type Transaction,
  useConfirmTransaction,
  useDeleteTransaction,
  usePatchTransaction,
  useSplitTransaction,
} from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const STATUSES = ["draft", "confirmed", "ignored"] as const;

export function TransactionDetail({
  txn,
  categories,
  open,
  onClose,
}: {
  txn: Transaction | null;
  categories: Category[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => !o && onClose()} title="Transaction">
      {txn && <TransactionDetailBody key={txn.id} txn={txn} categories={categories} onClose={onClose} />}
    </ResponsiveSheet>
  );
}

export function TransactionDetailBody({
  txn,
  categories,
  onClose,
}: {
  txn: Transaction;
  categories: Category[];
  onClose: () => void;
}) {
  const patch = usePatchTransaction();
  const confirm = useConfirmTransaction();
  const del = useDeleteTransaction();
  const split = useSplitTransaction();

  const [merchant, setMerchant] = useState(txn.merchant ?? "");
  const [amount, setAmount] = useState(String(txn.amount ?? ""));
  const [date, setDate] = useState(txn.txn_date ?? "");
  const [categoryId, setCategoryId] = useState(txn.category_id ?? "");
  const [status, setStatus] = useState(txn.status ?? "draft");
  const [notes, setNotes] = useState(txn.notes ?? "");
  const [splitting, setSplitting] = useState(false);

  const expenseCats = useMemo(
    () => categories.filter((c) => c.kind === "category"),
    [categories],
  );

  async function onSave() {
    try {
      await patch.mutateAsync({
        id: txn.id,
        patch: {
          merchant: merchant || null,
          amount: amount === "" ? undefined : Number(amount),
          txn_date: date || undefined,
          category_id: categoryId || null,
          status,
          notes: notes || null,
        },
      });
      toast.success("Transaction saved");
      onClose();
    } catch {
      toast.error("Couldn't save the transaction");
    }
  }

  async function onConfirm() {
    try {
      await confirm.mutateAsync(txn.id);
      toast.success("Transaction confirmed");
      onClose();
    } catch {
      toast.error("Couldn't confirm");
    }
  }

  async function onDelete() {
    if (!window.confirm("Delete this transaction? This can't be undone.")) return;
    try {
      await del.mutateAsync(txn.id);
      toast.success("Transaction deleted");
      onClose();
    } catch {
      toast.error("Couldn't delete");
    }
  }

  const busy =
    patch.isPending || confirm.isPending || del.isPending || split.isPending;

  return (
    <>
      <div className="mb-3">
        <Badge variant={status === "confirmed" ? "success" : "secondary"}>{status}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Merchant" className="sm:col-span-2">
          <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Category">
          <select
            value={categoryId ?? ""}
            onChange={(e) => setCategoryId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Uncategorized</option>
            {expenseCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm capitalize shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a note…"
          />
        </Field>
      </div>

      {(txn.line_items?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border">
          <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted">
            Line items
          </p>
          <ul className="divide-y">
            {(txn.line_items ?? []).map((li) => (
              <li
                key={li.id}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span className="truncate">{li.name}</span>
                <span data-numeric className="font-medium">
                  {formatCurrency(Number(li.amount), { currency: txn.currency })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {splitting ? (
        <SplitForm
          txn={txn}
          categories={expenseCats}
          pending={split.isPending}
          onCancel={() => setSplitting(false)}
          onSubmit={async (parts) => {
            try {
              await split.mutateAsync({ id: txn.id, parts });
              toast.success("Transaction split");
              onClose();
            } catch {
              toast.error("Couldn't split — parts must sum to the total");
            }
          }}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDelete} disabled={busy}>
            <Trash2 className="size-4" /> Delete
          </Button>
          {!splitting && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSplitting(true)}
              disabled={busy}
            >
              <Scissors className="size-4" /> Split
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {status !== "confirmed" && (
            <Button variant="outline" size="sm" onClick={onConfirm} disabled={busy}>
              Confirm
            </Button>
          )}
          <Button size="sm" onClick={onSave} disabled={busy}>
            {patch.isPending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs text-muted">{label}</Label>
      {children}
    </div>
  );
}

function SplitForm({
  txn,
  categories,
  pending,
  onCancel,
  onSubmit,
}: {
  txn: Transaction;
  categories: Category[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (parts: { amount: number; category_id?: string | null }[]) => void;
}) {
  const total = Number(txn.amount);
  const half = (Math.round((total / 2) * 100) / 100).toFixed(2);
  const [parts, setParts] = useState<{ amount: string; category_id: string }[]>([
    { amount: half, category_id: txn.category_id ?? "" },
    { amount: (total - Number(half)).toFixed(2), category_id: "" },
  ]);

  const sum = parts.reduce((a, p) => a + Number(p.amount || 0), 0);
  const balanced = Math.abs(sum - total) < 0.01;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-chip p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Split into parts</p>
        <Button variant="ghost" size="icon" className="size-7" onClick={onCancel}>
          <X className="size-4" />
        </Button>
      </div>
      {parts.map((p, i) => (
        <div key={i} className="flex gap-2">
          <Input
            type="number"
            step="0.01"
            value={p.amount}
            onChange={(e) =>
              setParts((ps) =>
                ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
              )
            }
            className="w-28"
          />
          <select
            value={p.category_id}
            onChange={(e) =>
              setParts((ps) =>
                ps.map((x, j) =>
                  j === i ? { ...x, category_id: e.target.value } : x,
                ),
              )
            }
            className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {parts.length > 2 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setParts((ps) => [...ps, { amount: "0.00", category_id: "" }])}
        >
          <Plus className="size-4" /> Add part
        </Button>
        <span
          className={
            balanced ? "text-xs text-success" : "text-xs text-destructive"
          }
        >
          {formatCurrency(sum, { currency: txn.currency })} / {formatCurrency(total, { currency: txn.currency })}
        </span>
      </div>
      <Button
        size="sm"
        className="w-full"
        disabled={!balanced || pending}
        onClick={() =>
          onSubmit(
            parts.map((p) => ({
              amount: Number(p.amount),
              category_id: p.category_id || null,
            })),
          )
        }
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Split transaction
      </Button>
    </div>
  );
}
