import type { LucideIcon } from "lucide-react";
import {
  TrendingUp,
  LifeBuoy,
  Sparkles,
  PieChart,
  Wallet,
  BarChart3,
  ListChecks,
  CreditCard,
  Landmark,
  Repeat,
  LineChart,
} from "lucide-react";
import type { GridItem, WidgetConfig } from "./grid";
import { PRESETS } from "./density";
import type { WidgetContract } from "./widget-contract";
import { netWorthContract } from "@/components/dashboard/widgets/net-worth-widget";
import { safeToSpendContract } from "@/components/dashboard/widgets/safe-to-spend-widget";
import { aiAlertContract } from "@/components/dashboard/widgets/ai-alert-widget";
import { breakdownContract } from "@/components/dashboard/widgets/breakdown-widget";
import { budgetsContract } from "@/components/dashboard/widgets/budgets-widget";
import { cashflowContract } from "@/components/dashboard/widgets/cashflow-widget";
import { recentActivityContract } from "@/components/dashboard/widgets/recent-activity-widget";
import { creditCardContract } from "@/components/dashboard/widgets/credit-card-widget";
import { debtContract } from "@/components/dashboard/widgets/debt-widget";
import { recurringContract } from "@/components/dashboard/widgets/recurring-widget";
import { holdingsContract } from "@/components/dashboard/widgets/holdings-widget";

export type ControlKind = "range" | "dimension" | "chart" | "count" | "title" | "accent" | "filter" | "preset";

export type WidgetControls = {
  fields: ControlKind[];
  charts?: NonNullable<WidgetConfig["chart"]>[];
  dimensions?: NonNullable<WidgetConfig["dimension"]>[];
  countRange?: [min: number, max: number];
  toggles?: { key: string; label: string }[];
};

export type WidgetDef = {
  title: string;
  icon: LucideIcon;
  defW: number;
  defH: number;
  /** visual emphasis: accent border like the mockup's "feature" / "ai" cards */
  variant?: "default" | "feature" | "ai";
  /** kept visible in Minimal density mode (slice E §6) */
  essential?: boolean;
  controls: WidgetControls;
  defaults: WidgetConfig;
  contract: WidgetContract<unknown>;
};

const SHARED_FIELDS: ControlKind[] = ["preset", "title", "accent"];

export const WIDGETS: Record<string, WidgetDef> = {
  netWorth: {
    title: "Net Worth",
    icon: TrendingUp,
    defW: 5,
    defH: 2,
    variant: "feature",
    essential: true,
    controls: { fields: ["range", ...SHARED_FIELDS], toggles: [{ key: "chart", label: "Chart" }, { key: "delta", label: "Delta" }] },
    defaults: { preset: "standard", show: { chart: true, delta: true }, accent: null },
    contract: netWorthContract as WidgetContract<unknown>,
  },
  safeToSpend: {
    title: "Safe to Spend",
    icon: LifeBuoy,
    defW: 5,
    defH: 2,
    variant: "feature",
    controls: { fields: ["range", ...SHARED_FIELDS] },
    defaults: { preset: "standard", accent: null },
    contract: safeToSpendContract as WidgetContract<unknown>,
  },
  breakdown: {
    title: "Breakdown",
    icon: PieChart,
    defW: 5,
    defH: 2,
    variant: "feature",
    controls: {
      fields: ["dimension", "range", "chart", "count", ...SHARED_FIELDS],
      charts: ["donut", "bars", "list"],
      dimensions: ["merchant", "category"],
      countRange: [3, 12],
      toggles: [{ key: "legend", label: "Legend" }, { key: "amounts", label: "Amounts" }],
    },
    defaults: { preset: "standard", dimension: "merchant", chart: "donut", count: 8, show: { legend: true, amounts: true }, accent: null },
    contract: breakdownContract as WidgetContract<unknown>,
  },
  cashflow: {
    title: "Cashflow",
    icon: BarChart3,
    defW: 5,
    defH: 2,
    essential: true,
    controls: {
      fields: ["range", "chart", ...SHARED_FIELDS],
      charts: ["bars", "area"],
      toggles: [{ key: "in", label: "In" }, { key: "out", label: "Out" }, { key: "net", label: "Net" }],
    },
    defaults: { preset: "standard", chart: "bars", show: { in: true, out: true, net: true }, accent: null },
    contract: cashflowContract as WidgetContract<unknown>,
  },
  budgets: {
    title: "Budgets",
    icon: Wallet,
    defW: 5,
    defH: 2,
    controls: { fields: ["count", ...SHARED_FIELDS], countRange: [1, 8], toggles: [{ key: "bars", label: "Progress bars" }, { key: "amounts", label: "Amounts" }] },
    defaults: { preset: "standard", count: 4, show: { bars: true, amounts: true }, accent: null },
    contract: budgetsContract as WidgetContract<unknown>,
  },
  recentActivity: {
    title: "Recent Activity",
    icon: ListChecks,
    defW: 5,
    defH: 2,
    essential: true,
    controls: {
      fields: ["count", ...SHARED_FIELDS],
      countRange: [1, 8],
      toggles: [{ key: "dates", label: "Dates" }, { key: "category", label: "Category" }, { key: "amount", label: "Amount" }],
    },
    defaults: { preset: "standard", count: 3, show: { dates: false, category: true, amount: true }, accent: null },
    contract: recentActivityContract as WidgetContract<unknown>,
  },
  aiAlert: {
    title: "Analyst Alert",
    icon: Sparkles,
    defW: 2,
    defH: 2,
    variant: "ai",
    essential: true,
    controls: { fields: SHARED_FIELDS, toggles: [{ key: "actions", label: "Actions" }] },
    defaults: { preset: "standard", show: { actions: true }, accent: null },
    contract: aiAlertContract as WidgetContract<unknown>,
  },
  creditCard: {
    title: "Credit Cards",
    icon: CreditCard,
    defW: 5,
    defH: 2,
    controls: { fields: ["count", ...SHARED_FIELDS], countRange: [1, 6], toggles: [{ key: "utilization", label: "Utilization" }, { key: "due", label: "Due dates" }, { key: "amounts", label: "Amounts" }] },
    defaults: { preset: "standard", count: 3, show: { utilization: true, due: true, amounts: true }, accent: null },
    contract: creditCardContract as WidgetContract<unknown>,
  },
  debt: {
    title: "Debt",
    icon: Landmark,
    defW: 5,
    defH: 2,
    controls: { fields: ["count", ...SHARED_FIELDS], countRange: [1, 6], toggles: [{ key: "rate", label: "APR" }, { key: "monthly", label: "Monthly" }, { key: "includeCC", label: "Include cards" }] },
    defaults: { preset: "standard", count: 3, show: { rate: true, monthly: true, includeCC: false }, accent: null },
    contract: debtContract as WidgetContract<unknown>,
  },
  recurring: {
    title: "Recurring",
    icon: Repeat,
    defW: 5,
    defH: 2,
    essential: true,
    controls: { fields: ["count", ...SHARED_FIELDS], countRange: [1, 8], toggles: [{ key: "bills", label: "Bills" }, { key: "subscriptions", label: "Subscriptions" }, { key: "amounts", label: "Amounts" }] },
    defaults: { preset: "standard", count: 5, show: { bills: true, subscriptions: true, amounts: true }, accent: null },
    contract: recurringContract as WidgetContract<unknown>,
  },
  holdings: {
    title: "Holdings",
    icon: LineChart,
    defW: 5,
    defH: 2,
    controls: { fields: ["count", ...SHARED_FIELDS], countRange: [1, 8], toggles: [{ key: "gain", label: "Gain/loss" }, { key: "symbol", label: "Symbol" }] },
    defaults: { preset: "standard", count: 3, show: { gain: true, symbol: true }, accent: null },
    contract: holdingsContract as WidgetContract<unknown>,
  },
};

export function resolveConfig(
  item: Pick<GridItem, "type" | "config">,
  globalRange?: WidgetConfig["range"],
): WidgetConfig {
  const def = WIDGETS[item.type];
  if (!def) return item.config ?? {};
  const merged: WidgetConfig = {
    ...def.defaults,
    ...item.config,
    show: { ...(def.defaults.show ?? {}), ...(item.config?.show ?? {}) },
    filter: { ...(def.defaults.filter ?? {}), ...(item.config?.filter ?? {}) },
  };

  // Range resolution: explicit per-widget range wins, else follow the global board range.
  if (def.controls.fields.includes("range")) {
    merged.range = item.config?.range ?? globalRange;
  }

  if (def.controls.charts?.length && (!merged.chart || !def.controls.charts.includes(merged.chart))) {
    merged.chart = def.defaults.chart;
  }
  if (def.controls.dimensions?.length && (!merged.dimension || !def.controls.dimensions.includes(merged.dimension))) {
    merged.dimension = def.defaults.dimension;
  }
  if (def.controls.countRange) {
    const [min, max] = def.controls.countRange;
    const count = Number(merged.count ?? def.defaults.count ?? min);
    merged.count = Math.max(min, Math.min(max, Number.isFinite(count) ? Math.round(count) : min));
  }

  merged.preset = PRESETS.includes(merged.preset as never) ? merged.preset : "standard";

  return merged;
}
