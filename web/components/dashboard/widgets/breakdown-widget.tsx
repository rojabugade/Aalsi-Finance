"use client";
import { useBreakdown } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import type { Breakdown } from "@/lib/api/analytics";
import { formatCurrency } from "@/lib/format";
import { defineWidget } from "@/lib/dashboard/define-widget";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";
import type { Block, RowBlock } from "@/lib/dashboard/blocks";
import type { Tier } from "@/lib/dashboard/tier";

const RING = [
  "var(--accent)", "var(--c3)", "var(--c2)",
  "color-mix(in srgb, var(--accent) 48%, var(--c3))",
  "var(--muted)",
  "color-mix(in srgb, var(--c2) 70%, var(--accent))",
  "color-mix(in srgb, var(--c3) 65%, var(--c2))",
  "color-mix(in srgb, var(--accent) 60%, var(--fg))",
];
const OTHER_COLOR = "color-mix(in srgb, var(--muted) 55%, var(--card))";

export type BreakdownVM = {
  top: { label: string; value: number } | undefined;
  topPct: number;
  rows: { label: string; value: number }[];
  total: number;
  dimension: "merchant" | "category";
  showAmounts: boolean;
};

function rowsFromData(data: Breakdown | undefined, dimension: "merchant" | "category") {
  return (data?.rows ?? [])
    .map((r) => ({
      label: String(r.dimensions?.[dimension] ?? (dimension === "merchant" ? "Unknown merchant" : "Uncategorized")),
      value: Math.abs(Number(r.total ?? 0)),
    }))
    .sort((a, b) => b.value - a.value);
}

function toRowBlock(r: { label: string; value: number }, vm: BreakdownVM, i: number): RowBlock {
  return {
    kind: "row",
    label: r.label,
    value: vm.showAmounts ? formatCurrency(r.value) : `${Math.round((r.value / vm.total) * 100)}%`,
    bar: { pct: (r.value / vm.total) * 100, color: RING[i % RING.length] },
  };
}

function toBarRow(r: { label: string; value: number }, vm: BreakdownVM, i: number) {
  return {
    label: r.label,
    value: vm.showAmounts ? formatCurrency(r.value) : `${Math.round((r.value / vm.total) * 100)}%`,
    pct: (r.value / vm.total) * 100,
    color: RING[i % RING.length],
  };
}

function withOtherSlices(rows: { label: string; value: number }[], vm: BreakdownVM) {
  const shown = rows.reduce((sum, r) => sum + r.value, 0);
  const other = vm.total - shown;
  const all = other > 0.005 ? [...rows, { label: "Other", value: other, color: OTHER_COLOR }] : rows;
  return all.map((r, i) => ({
    label: (r as { label: string }).label,
    value: vm.showAmounts
      ? formatCurrency((r as { value: number }).value)
      : `${Math.round(((r as { value: number }).value / vm.total) * 100)}%`,
    pct: ((r as { value: number }).value / vm.total) * 100,
    color: (r as { color?: string }).color ?? RING[i % RING.length],
  }));
}

export const breakdownViews = {
  stat: (vm: BreakdownVM): Block[] => [
    {
      kind: "stat",
      label: vm.dimension === "merchant" ? "Top merchant" : "Top category",
      value: vm.top?.label ?? "—",
      hint: `${vm.topPct}% of spend`,
    },
  ],
  list: (vm: BreakdownVM, t: Tier): Block[] => [
    { kind: "list", rows: vm.rows.slice(0, t.rows).map((r, i) => toRowBlock(r, vm, i)) },
  ],
  chart: (vm: BreakdownVM, t: Tier): Block[] =>
    t.form === "bars"
      ? [{ kind: "bars", rows: vm.rows.slice(0, t.rows).map((r, i) => toBarRow(r, vm, i)) }]
      : [
          {
            kind: "donut",
            // Cap legend slices to the rows that fit (minus one for "Other"), so
            // the top entry is never clipped. Ring stays whole — withOtherSlices
            // folds the remainder into "Other", keeping the conic gradient at 100%.
            slices: withOtherSlices(vm.rows.slice(0, Math.max(2, Math.min(8, t.rows - 1))), vm),
            legend: t.extras,
          },
        ],
};

export const breakdownFocus = (vm: BreakdownVM): Block[] => [
  { kind: "donut", slices: withOtherSlices(vm.rows.slice(0, 8), vm), legend: true },
];

export const breakdownContract = defineWidget<BreakdownVM>({
  data: (config) => {
    const dimension = config.dimension === "category" ? "category" : "merchant";
    const breakdown = useBreakdown(presetRange(config.range ?? "3m"), dimension, config.filter?.category);
    return queryState(breakdown, {
      select: (data): BreakdownVM => {
        const rows = rowsFromData(data, dimension);
        const total = rows.reduce((sum, r) => sum + r.value, 0);
        const top = rows[0];
        const topPct = total > 0 && top ? Math.round((top.value / total) * 100) : 0;
        return { top, topPct, rows, total: total || 1, dimension, showAmounts: config.show?.amounts ?? true };
      },
      isEmpty: (vm) => vm.rows.length === 0,
    });
  },
  insights: (vm) => {
    if (!vm.top) return [];
    return [{ label: `${vm.top.label} ${vm.topPct}%`, tone: vm.topPct >= 40 ? "warning" : "neutral", severity: vm.topPct }];
  },
  supportedForms: ["donut", "bars", "list"],
  emptyHint: "No spending to break down here.",
  view: breakdownViews,
  focus: breakdownFocus,
}) as unknown as WidgetContract<BreakdownVM>;
