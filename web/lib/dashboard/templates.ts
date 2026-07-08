import {
  Compass, Minimize2, TrendingDown, CreditCard as CreditCardIcon,
  ShoppingBag, LineChart, type LucideIcon,
} from "lucide-react";
import type { GridItem, WidgetConfig, WidgetType } from "./grid";
import type { BoardPrefs } from "./boards";

export type TemplateId = "starter" | "minimal" | "debt" | "creditCard" | "spending" | "netWorth";

export type TemplateSpec = {
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: WidgetConfig;
};

export type DashboardTemplate = {
  id: TemplateId;
  goal: string;        // onboarding modal label
  name: string;        // template name
  description: string; // card subtitle
  icon: LucideIcon;
  blurb: string;       // post-apply confirmation message
  items: TemplateSpec[];
  prefs?: Partial<BoardPrefs>;
};

// Each template is a full, goal-designed board on the 10-col grid: a wide hero
// up top, supporting widgets sized and configured for the goal (ranges, presets,
// breakdown dimensions). Not a flat list of default-size tiles.
export const TEMPLATES: DashboardTemplate[] = [
  {
    id: "starter",
    goal: "Understand my money",
    name: "Starter",
    description: "A well-rounded view: net worth, spending, budgets, and bills.",
    icon: Compass,
    blurb: "I set up a balanced overview — net worth, safe-to-spend, cashflow, budgets, merchant spend, and recent activity. Customize anything.",
    items: [
      { type: "netWorth", x: 0, y: 0, w: 5, h: 2, config: { range: "6m", preset: "detailed" } },
      { type: "safeToSpend", x: 5, y: 0, w: 3, h: 2, config: { range: "1m", preset: "standard" } },
      { type: "aiAlert", x: 8, y: 0, w: 2, h: 2 },
      { type: "cashflow", x: 0, y: 2, w: 4, h: 2, config: { range: "3m", preset: "standard" } },
      { type: "budgets", x: 4, y: 2, w: 3, h: 2, config: { preset: "detailed" } },
      { type: "breakdown", x: 7, y: 2, w: 3, h: 2, config: { dimension: "merchant", title: "Merchant Spending" } },
      { type: "recentActivity", x: 0, y: 4, w: 6, h: 2, config: { preset: "detailed" } },
      { type: "recurring", x: 6, y: 4, w: 4, h: 2 },
    ],
  },
  {
    id: "minimal",
    goal: "Keep it minimal",
    name: "Minimal Money",
    description: "Four big, calm cards — net worth, safe-to-spend, cashflow, bills.",
    icon: Minimize2,
    blurb: "I kept it lean and spacious: net worth, safe-to-spend, cashflow, and upcoming bills.",
    items: [
      { type: "netWorth", x: 0, y: 0, w: 6, h: 2, config: { range: "6m", preset: "detailed" } },
      { type: "safeToSpend", x: 6, y: 0, w: 4, h: 2, config: { range: "1m", preset: "standard" } },
      { type: "cashflow", x: 0, y: 2, w: 6, h: 2, config: { range: "6m", preset: "standard" } },
      { type: "recurring", x: 6, y: 2, w: 4, h: 2 },
    ],
    prefs: { densityMode: "calm", density: "spacious" },
  },
  {
    id: "debt",
    goal: "Pay off debt",
    name: "Debt Payoff",
    description: "Lead with debt and cards, then the cashflow and budget room to pay them down.",
    icon: TrendingDown,
    blurb: "I led with your debt and credit cards, then surfaced the cashflow, budget room, and safe-to-spend that fund payoff.",
    items: [
      { type: "debt", x: 0, y: 0, w: 6, h: 2, config: { preset: "detailed" } },
      { type: "creditCard", x: 6, y: 0, w: 4, h: 2, config: { preset: "standard" } },
      { type: "cashflow", x: 0, y: 2, w: 4, h: 2, config: { range: "6m", preset: "analytical" } },
      { type: "budgets", x: 4, y: 2, w: 3, h: 2, config: { preset: "detailed" } },
      { type: "safeToSpend", x: 7, y: 2, w: 3, h: 2, config: { range: "1m", preset: "standard" } },
      { type: "recentActivity", x: 0, y: 4, w: 6, h: 2 },
      { type: "aiAlert", x: 6, y: 4, w: 4, h: 2 },
    ],
  },
  {
    id: "creditCard",
    goal: "Manage credit cards",
    name: "Credit Card",
    description: "Card balances up front, with recurring charges, merchant spend, and activity.",
    icon: CreditCardIcon,
    blurb: "I built this around your cards: balances, recurring charges, recent activity, merchant spend, plus cashflow and budgets.",
    items: [
      { type: "creditCard", x: 0, y: 0, w: 5, h: 2, config: { preset: "detailed" } },
      { type: "recurring", x: 5, y: 0, w: 5, h: 2 },
      { type: "recentActivity", x: 0, y: 2, w: 5, h: 2, config: { preset: "detailed" } },
      { type: "breakdown", x: 5, y: 2, w: 5, h: 2, config: { dimension: "merchant", title: "Merchant Spending", preset: "analytical" } },
      { type: "cashflow", x: 0, y: 4, w: 4, h: 2, config: { range: "3m", preset: "standard" } },
      { type: "budgets", x: 4, y: 4, w: 3, h: 2 },
      { type: "aiAlert", x: 7, y: 4, w: 3, h: 2 },
    ],
  },
  {
    id: "spending",
    goal: "Track spending",
    name: "Spending Tracker",
    description: "Merchant and category breakdowns, budgets, activity, and recurring charges.",
    icon: ShoppingBag,
    blurb: "I focused on where your money goes: merchant and category breakdowns, budgets, cashflow, recent activity, and recurring charges.",
    items: [
      { type: "breakdown", x: 0, y: 0, w: 5, h: 2, config: { dimension: "merchant", title: "Merchant Spending", preset: "analytical" } },
      { type: "budgets", x: 5, y: 0, w: 5, h: 2, config: { preset: "detailed" } },
      { type: "cashflow", x: 0, y: 2, w: 4, h: 2, config: { range: "3m", preset: "analytical" } },
      { type: "breakdown", x: 4, y: 2, w: 3, h: 2, config: { dimension: "category", title: "Category Spending" } },
      { type: "safeToSpend", x: 7, y: 2, w: 3, h: 2, config: { range: "1m", preset: "standard" } },
      { type: "recentActivity", x: 0, y: 4, w: 5, h: 2, config: { preset: "detailed" } },
      { type: "recurring", x: 5, y: 4, w: 3, h: 2 },
      { type: "aiAlert", x: 8, y: 4, w: 2, h: 2 },
    ],
  },
  {
    id: "netWorth",
    goal: "Build net worth",
    name: "Net Worth",
    description: "Wealth over time — net worth hero, investments, debt, and cashflow.",
    icon: LineChart,
    blurb: "I set this up to grow wealth: a net-worth hero with investments, debt, cashflow, budgets, and bills.",
    items: [
      { type: "netWorth", x: 0, y: 0, w: 6, h: 2, config: { range: "6m", preset: "detailed" } },
      { type: "holdings", x: 6, y: 0, w: 4, h: 2, config: { preset: "detailed" } },
      { type: "cashflow", x: 0, y: 2, w: 4, h: 2, config: { range: "6m", preset: "analytical" } },
      { type: "debt", x: 4, y: 2, w: 3, h: 2 },
      { type: "aiAlert", x: 7, y: 2, w: 3, h: 2 },
      { type: "budgets", x: 0, y: 4, w: 5, h: 2 },
      { type: "recurring", x: 5, y: 4, w: 5, h: 2 },
    ],
  },
];

let idSeq = 0;
export function itemsFromTemplate(t: DashboardTemplate): GridItem[] {
  return t.items.map((spec) => ({
    id: `${spec.type}-${Date.now()}-${idSeq++}`,
    type: spec.type,
    x: spec.x,
    y: spec.y,
    w: spec.w,
    h: spec.h,
    ...(spec.config ? { config: { ...spec.config } } : {}),
  }));
}

export function getTemplate(id: TemplateId): DashboardTemplate {
  const found = TEMPLATES.find((t) => t.id === id);
  if (!found) throw new Error(`Unknown template: ${id}`);
  return found;
}
