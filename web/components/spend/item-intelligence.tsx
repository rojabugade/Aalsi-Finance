"use client";

import { useMemo, useState } from "react";
import { Search } from "@/lib/icons";
import { formatCurrency } from "@/lib/format";
import type { Category, Transaction } from "@/lib/api/transactions";
import { spendAmount } from "@/lib/spend/derive";
import { inRange } from "@/lib/spend/period";

type ItemRow = {
  name: string;
  total: number;
  qty: number;
  merchants: Map<string, number>;
  categories: Map<string, number>;
};

export function ItemIntelligence({
  txns,
  cats,
  from,
  to,
  currency,
}: {
  txns: Transaction[];
  cats: Category[];
  from: string;
  to: string;
  currency: string;
}) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const rows = useMemo(() => {
    const m = new Map<string, ItemRow>();
    for (const t of txns) {
      if (!inRange(t.txn_date, from, to) || spendAmount(t, byId) <= 0) continue;
      for (const li of t.line_items ?? []) {
        const name = li.name?.trim() || "Item";
        const key = name.toLowerCase();
        const row = m.get(key) ?? { name, total: 0, qty: 0, merchants: new Map(), categories: new Map() };
        const amount = Math.abs(Number(li.amount));
        const qty = Number(li.quantity ?? 1);
        const merchant = t.merchant?.trim() || "Unknown";
        const cat = li.item_type_category_id ? byId.get(li.item_type_category_id)?.name : undefined;
        row.total += amount;
        row.qty += Number.isFinite(qty) ? qty : 1;
        row.merchants.set(merchant, (row.merchants.get(merchant) ?? 0) + amount);
        if (cat) row.categories.set(cat, (row.categories.get(cat) ?? 0) + amount);
        m.set(key, row);
      }
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [txns, byId, from, to]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(needle) ||
      [...r.merchants.keys()].some((m) => m.toLowerCase().includes(needle)) ||
      [...r.categories.keys()].some((c) => c.toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  const max = filtered[0]?.total ?? 1;

  return (
    <div className="space-y-3" data-testid="spend-item-intelligence">
      <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div>
            <b className="text-sm">Item intelligence</b>
            <p className="text-xs text-muted">{rows.length} itemized products in this period</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              type="search"
              aria-label="Search items"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find item, merchant, category..."
              className="h-9 w-full rounded-chip border border-border bg-bg pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card-sm border border-border bg-card p-8 text-center text-sm text-muted shadow-card">
          No itemized receipts in this period. Capture or import receipts to unlock product-level spend.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-card-sm border border-border bg-card p-8 text-center text-sm text-muted shadow-card">
          No items match your search.
        </div>
      ) : (
        <div className="rounded-card-sm border border-border bg-card p-3 shadow-card">
          {filtered.map((r) => {
            const topMerchant = [...r.merchants.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
            const topCategory = [...r.categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Uncategorized";
            return (
              <div key={r.name} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                <span className="grid size-9 flex-none place-items-center rounded-xl bg-accent-soft text-xs font-bold uppercase text-accent">
                  {r.name.slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{r.name}</span>
                    <span className="flex-none text-[11px] text-muted">
                      {Math.round(r.qty * 100) / 100} qty · {topMerchant}
                    </span>
                  </span>
                  <span className="mt-1 block h-[5px] overflow-hidden rounded-full bg-track">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }} />
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted">{topCategory}</span>
                </span>
                <span className="text-sm font-extrabold tabular-nums">{formatCurrency(r.total, { currency })}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
