"use client";

import { useState } from "react";
import type { CatRow } from "@/lib/spend/derive";
import { categoryIcon } from "@/lib/icons";
import { formatCurrency } from "@/lib/format";

const COLLAPSED = 7;

export function CategoryList({
  rows,
  currency,
  onSelect,
}: {
  rows: CatRow[];
  currency: string;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const max = rows[0]?.total ?? 1;

  const canCollapse = rows.length > COLLAPSED + 1;
  const visible = expanded || !canCollapse ? rows : rows.slice(0, COLLAPSED);
  const rest = canCollapse && !expanded ? rows.slice(COLLAPSED) : [];
  const restTotal = rest.reduce((a, r) => a + r.total, 0);

  return (
    <div className="rounded-card-sm border border-border bg-card p-3 shadow-card" data-testid="spend-category-list">
      <div className="mb-1 flex items-center justify-between px-1">
        <b className="text-sm">By category</b>
        <span className="text-[11px] uppercase tracking-wide text-muted">sorted by spend</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No spending this period.</p>
      ) : (
        visible.map((r) => {
          const Icon = categoryIcon(r.name);
          const up = (r.deltaPct ?? 0) > 0;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-chip"
            >
              <span className="grid size-9 flex-none place-items-center rounded-xl bg-accent-soft text-accent">
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold capitalize">{r.name.toLowerCase()}</span>
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
          className="mt-1 flex w-full items-center justify-between rounded-xl px-2 py-2.5 text-sm font-semibold text-accent hover:bg-chip"
        >
          {expanded ? (
            <span>Show less</span>
          ) : (
            <span className="text-muted">
              + {rest.length} more categories
            </span>
          )}
          {!expanded && <span className="tabular-nums text-muted">{formatCurrency(restTotal, { currency })}</span>}
        </button>
      )}
    </div>
  );
}
