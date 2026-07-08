"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { Category, Transaction } from "@/lib/api/transactions";
import { categoryIcon } from "@/lib/icons";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tint = "accent" | "c2" | "c3";
const TINTS: Tint[] = ["accent", "c2", "c3"];
const TINT_CHIP: Record<Tint, string> = {
  accent: "bg-accent-soft text-accent",
  c2: "bg-soft2 text-c2",
  c3: "bg-soft3 text-c3",
};
const TINT_BAR: Record<Tint, string> = {
  accent: "bg-accent",
  c2: "bg-c2",
  c3: "bg-c3",
};

const UNCATEGORIZED = "__uncategorized__";

type SubNode = { id: string; name: string; total: number; txns: Transaction[] };
type ParentNode = {
  id: string;
  name: string;
  total: number;
  subs: SubNode[];
  direct: Transaction[];
};

function formatDate(d: string) {
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? d
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Roll household transactions up into a category → sub-category → transaction
 * tree (expenses only; amount >= 0). Parents are sorted by spend; a synthetic
 * "Uncategorized" bucket collects anything without a category.
 */
function buildTree(txns: Transaction[], cats: Category[]): { tree: ParentNode[]; total: number } {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const parents = new Map<string, ParentNode>();

  const ensure = (id: string, name: string): ParentNode => {
    let p = parents.get(id);
    if (!p) {
      p = { id, name, total: 0, subs: [], direct: [] };
      parents.set(id, p);
    }
    return p;
  };

  let total = 0;
  for (const t of txns) {
    const amount = Number(t.amount);
    if (!(amount >= 0)) continue; // expenses only
    total += amount;

    const cat = t.category_id ? byId.get(t.category_id) : undefined;
    if (!cat) {
      const p = ensure(UNCATEGORIZED, "Uncategorized");
      p.total += amount;
      p.direct.push(t);
      continue;
    }

    if (cat.parent_id && byId.has(cat.parent_id)) {
      const parent = byId.get(cat.parent_id)!;
      const p = ensure(parent.id, parent.name);
      p.total += amount;
      let sub = p.subs.find((s) => s.id === cat.id);
      if (!sub) {
        sub = { id: cat.id, name: cat.name, total: 0, txns: [] };
        p.subs.push(sub);
      }
      sub.total += amount;
      sub.txns.push(t);
    } else {
      const p = ensure(cat.id, cat.name);
      p.total += amount;
      p.direct.push(t);
    }
  }

  const tree = [...parents.values()].sort((a, b) => b.total - a.total);
  for (const p of tree) {
    p.subs.sort((a, b) => b.total - a.total);
    p.direct.sort((a, b) => b.txn_date.localeCompare(a.txn_date));
    for (const s of p.subs) s.txns.sort((a, b) => b.txn_date.localeCompare(a.txn_date));
  }
  return { tree, total };
}

function TxnRow({ t }: { t: Transaction }) {
  return (
    <div className="flex items-center gap-3 py-2 pl-[50px] pr-1">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          {t.merchant
            ? t.merchant.charAt(0).toUpperCase() + t.merchant.slice(1).toLowerCase()
            : "Unknown"}
        </span>
        <span className="text-[11px] text-muted">{formatDate(t.txn_date)}</span>
      </span>
      <span className="text-[13px] font-semibold tabular-nums">
        {formatCurrency(Number(t.amount), { currency: t.currency })}
      </span>
    </div>
  );
}

function ParentCard({
  node,
  pct,
  tint,
  currency,
}: {
  node: ParentNode;
  pct: number;
  tint: Tint;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const Icon = categoryIcon(node.name);
  const count = node.direct.length + node.subs.reduce((a, s) => a + s.txns.length, 0);

  return (
    <div className="rounded-card-sm border border-border bg-card px-3.5 shadow-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3.5 py-3 text-left focus-visible:outline-none"
      >
        <span className={cn("grid size-[38px] flex-none place-items-center rounded-chip", TINT_CHIP[tint])}>
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between">
            <span className="truncate text-sm font-semibold capitalize">{node.name.toLowerCase()}</span>
            <span className="ml-2 text-sm font-bold tabular-nums">
              {formatCurrency(node.total, { currency })}
            </span>
          </span>
          <span className="mt-1.5 block h-[5px] w-full overflow-hidden rounded-full bg-track">
            <span
              className={cn("block h-full rounded-full", TINT_BAR[tint])}
              style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
            />
          </span>
        </span>
        <ChevronDown
          className={cn("size-[18px] flex-none text-muted transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-border pb-2 pt-1">
          <p className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">
            {count} {count === 1 ? "transaction" : "transactions"}
          </p>
          {node.subs.map((sub) => {
            const subOpen = openSub === sub.id;
            const SubIcon = categoryIcon(sub.name);
            return (
              <div key={sub.id}>
                <button
                  type="button"
                  onClick={() => setOpenSub(subOpen ? null : sub.id)}
                  aria-expanded={subOpen}
                  className="flex w-full items-center gap-3 py-2 text-left focus-visible:outline-none"
                >
                  <span className="grid size-[30px] flex-none place-items-center rounded-chip bg-chip text-muted">
                    <SubIcon className="size-[15px]" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold capitalize">
                    {sub.name.toLowerCase()}
                  </span>
                  <span className="text-[13px] font-bold tabular-nums">
                    {formatCurrency(sub.total, { currency })}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 flex-none text-muted transition-transform",
                      subOpen && "rotate-180",
                    )}
                  />
                </button>
                {subOpen && (
                  <div className="border-l-2 border-border/60 pb-1 [&>*]:border-b [&>*]:border-border/60 [&>*:last-child]:border-b-0">
                    {sub.txns.map((t) => (
                      <TxnRow key={t.id} t={t} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {node.direct.length > 0 && (
            <div className="[&>*]:border-b [&>*]:border-border/60 [&>*:last-child]:border-b-0">
              {node.direct.map((t) => (
                <TxnRow key={t.id} t={t} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CategoryBreakdown({
  transactions,
  categories,
  currency = "USD",
}: {
  transactions: Transaction[];
  categories: Category[];
  currency?: string;
}) {
  const { tree, total } = useMemo(
    () => buildTree(transactions, categories),
    [transactions, categories],
  );
  const max = tree[0]?.total ?? 1;

  if (tree.length === 0) {
    return (
      <div className="rounded-card-sm border border-border bg-card p-8 text-center text-sm text-muted shadow-card">
        No spending to categorize yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Total spend</p>
        <p className="mt-0.5 text-2xl font-extrabold tracking-tight tabular-nums">
          {formatCurrency(total, { currency })}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          across {tree.length} {tree.length === 1 ? "category" : "categories"}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {tree.map((node, i) => (
          <ParentCard
            key={node.id}
            node={node}
            pct={(node.total / max) * 100}
            tint={TINTS[i % TINTS.length]}
            currency={currency}
          />
        ))}
      </div>
    </div>
  );
}
