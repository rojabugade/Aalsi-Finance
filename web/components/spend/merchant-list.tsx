"use client";

import { useMemo, useState } from "react";
import { Search } from "@/lib/icons";
import { formatCurrency } from "@/lib/format";
import type { MerchantRow } from "@/lib/spend/derive";

export type { MerchantRow } from "@/lib/spend/derive";

const COLLAPSED = 12;

/**
 * Ranked merchant list for the Merchants tab. Mirrors the category list (icon,
 * bar, delta, total) but adds a search box and a top-N collapse so a long tail
 * of merchants (100+) stays navigable. Rows deep-link to the merchant drill,
 * not the raw ledger. Names are canonical (resolved server-side from
 * merchant_id), so no raw "AMZN MKTP US*9486" descriptors leak in.
 */
export function MerchantList({
  rows,
  currency,
  onSelect,
}: {
  rows: MerchantRow[];
  currency: string;
  onSelect: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(false);
  const max = rows[0]?.total ?? 1;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(needle) || (r.topCategory ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const canCollapse = !q && filtered.length > COLLAPSED + 1;
  const visible = expanded || !canCollapse ? filtered : filtered.slice(0, COLLAPSED);

  return (
    <div className="rounded-card-sm border border-border bg-card p-3 shadow-card" data-testid="spend-merchant-list">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <b className="text-sm">All merchants</b>
        <div className="relative w-44">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Search merchants"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find merchant…"
            className="h-8 w-full rounded-chip border border-border bg-bg pl-8 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted">
          {q ? "No merchants match your search." : "No merchant spending this period."}
        </p>
      ) : (
        visible.map((r) => {
          const up = (r.deltaPct ?? 0) > 0;
          return (
            <button
              key={r.name}
              type="button"
              onClick={() => onSelect(r.name)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-chip"
            >
              <span className="grid size-9 flex-none place-items-center rounded-xl bg-accent-soft text-xs font-bold uppercase text-accent">
                {r.name.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{r.name}</span>
                  <span className="flex-none text-[11px] capitalize text-muted">
                    {r.topCategory?.toLowerCase()} · {r.count}×
                  </span>
                </span>
                <span className="mt-1 block h-[5px] overflow-hidden rounded-full bg-track">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }} />
                </span>
              </span>
              {r.deltaPct !== null && (
                <span className={`text-xs font-bold ${up ? "text-destructive" : "text-c3"}`}>
                  {up ? "▲" : "▼"}
                  {Math.abs(r.deltaPct).toFixed(0)}%
                </span>
              )}
              <span className="text-sm font-extrabold tabular-nums">{formatCurrency(r.total, { currency })}</span>
              <span className="text-muted">›</span>
            </button>
          );
        })
      )}

      {canCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 w-full rounded-xl px-2 py-2.5 text-sm font-semibold text-accent hover:bg-chip"
        >
          {expanded ? "Show less" : `Show all ${filtered.length} merchants`}
        </button>
      )}
    </div>
  );
}
