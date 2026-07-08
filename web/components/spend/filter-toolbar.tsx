"use client";

import { Search } from "@/lib/icons";
import { Download } from "lucide-react";
import type { Category } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";

export type AmountBand = "any" | "lt25" | "25to100" | "100to500" | "gt500";
export type Direction = "all" | "out" | "in";

export type SpendFilters = {
  q: string;
  recurring: boolean;
  categoryId: string; // "" = all
  amount: AmountBand;
  direction: Direction;
};

export const EMPTY_FILTERS: SpendFilters = {
  q: "",
  recurring: false,
  categoryId: "",
  amount: "any",
  direction: "all",
};

// Thresholds are in the account's own currency; only the *label* is localised.
export const AMOUNT_BANDS: { value: AmountBand; min: number; max: number }[] = [
  { value: "any", min: 0, max: Infinity },
  { value: "lt25", min: 0, max: 25 },
  { value: "25to100", min: 25, max: 100 },
  { value: "100to500", min: 100, max: 500 },
  { value: "gt500", min: 500, max: Infinity },
];

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "all", label: "All" },
  { value: "out", label: "Spend" },
  { value: "in", label: "Income" },
];

/** Currency-aware label for an amount band (e.g. "$25 – $100", "Under €25"). */
export function bandLabel(value: AmountBand, currency: string): string {
  const c = (n: number) => formatCurrency(n, { currency, compact: true });
  switch (value) {
    case "any":
      return "Any amount";
    case "lt25":
      return `Under ${c(25)}`;
    case "25to100":
      return `${c(25)} – ${c(100)}`;
    case "100to500":
      return `${c(100)} – ${c(500)}`;
    case "gt500":
      return `Over ${c(500)}`;
  }
}

const selectClass =
  "h-9 rounded-chip border border-border bg-card px-3 text-sm font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * Sticky filter toolbar (spend-overview-v2). Search + Category + Amount +
 * Recurring + Export. `categories` is optional — pass the top-level category
 * list to enable the Category dropdown; omit it (e.g. Merchants tab) to hide it.
 */
export function FilterToolbar({
  filters,
  onChange,
  categories,
  currency = "USD",
  onExport,
}: {
  filters: SpendFilters;
  onChange: (next: SpendFilters) => void;
  categories?: Category[];
  currency?: string;
  onExport?: () => void;
}) {
  const parents = (categories ?? []).filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-card-sm border border-border bg-card/95 p-2 backdrop-blur"
      role="search"
      aria-label="Filter transactions"
    >
      <div className="relative min-w-[180px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          aria-label="Search transactions"
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Search merchant, note… (Amazon, Uber)"
          className="h-9 w-full rounded-chip border border-border bg-bg pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>

      {parents.length > 0 && (
        <select
          aria-label="Filter by category"
          value={filters.categoryId}
          onChange={(e) => onChange({ ...filters, categoryId: e.target.value })}
          className={selectClass}
        >
          <option value="">All categories</option>
          {parents.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}

      <select
        aria-label="Filter by direction"
        value={filters.direction}
        onChange={(e) => onChange({ ...filters, direction: e.target.value as Direction })}
        className={selectClass}
      >
        {DIRECTIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by amount"
        value={filters.amount}
        onChange={(e) => onChange({ ...filters, amount: e.target.value as AmountBand })}
        className={selectClass}
      >
        {AMOUNT_BANDS.map((b) => (
          <option key={b.value} value={b.value}>
            {bandLabel(b.value, currency)}
          </option>
        ))}
      </select>

      <button
        type="button"
        aria-pressed={filters.recurring}
        onClick={() => onChange({ ...filters, recurring: !filters.recurring })}
        className={`h-9 rounded-chip border px-3 text-sm font-semibold ${
          filters.recurring ? "border-accent bg-accent text-on-accent" : "border-border bg-card text-muted"
        }`}
      >
        Recurring
      </button>

      {onExport && (
        <button
          type="button"
          onClick={onExport}
          className="ml-auto flex h-9 items-center gap-1.5 rounded-chip border border-border bg-card px-3 text-sm font-semibold text-muted transition-colors hover:text-fg"
        >
          <Download className="size-4" /> Export
        </button>
      )}
    </div>
  );
}
