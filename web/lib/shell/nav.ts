import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Cable,
  Globe,
  Home,
  Landmark,
  LineChart,
  ListChecks,
  PieChart,
  Plus,
  Settings,
  Sparkles,
  Wallet,
} from "@/lib/icons";
import type { LucideIcon } from "lucide-react";

/** Single universal Add entry — one ingest surface, no type picker. */
export const ADD_NAV = { key: "add", label: "Add", href: "/capture", icon: Plus } as const;

export type Tab = { label: string; href: string };

export type BottomTab = {
  key: "home" | "spend" | "insights" | "activity";
  label: string;
  href: string;
  icon: LucideIcon;
  /** route prefixes that light this tab */
  match: string[];
};

export type DrawerItem = {
  key: string;
  label: string;
  sub: string;
  href: string;
  icon: LucideIcon;
  tint: "accent" | "c2" | "c3" | "muted";
};

export const BOTTOM_TABS: BottomTab[] = [
  { key: "home", label: "Home", href: "/dashboard", icon: Home, match: ["/dashboard"] },
  { key: "spend", label: "Spend", href: "/transactions", icon: ArrowLeftRight, match: ["/transactions"] },
  {
    key: "insights",
    label: "Insights",
    href: "/analytics",
    icon: BarChart3,
    match: ["/analytics", "/budgets", "/debt", "/cards", "/income"],
  },
  { key: "activity", label: "Activity", href: "/notifications", icon: Bell, match: ["/notifications"] },
];

// Drawer order is locked (§3): Guidance, International Money, Connections, Review, Settings.
export const DRAWER_ITEMS: DrawerItem[] = [
  { key: "guidance", label: "Guidance", sub: "Sourced answers & saved plans", href: "/guidance", icon: Sparkles, tint: "accent" },
  { key: "cross-border", label: "International Money", sub: "Transfers · reporting", href: "/guidance?section=cross-border", icon: Globe, tint: "c3" },
  { key: "connections", label: "Connections", sub: "Plaid · Email · SMS", href: "/connections", icon: Cable, tint: "c2" },
  { key: "review", label: "Review queue", sub: "Items need you", href: "/review", icon: ListChecks, tint: "muted" },
  { key: "settings", label: "Settings", sub: "Account · security · export", href: "/settings", icon: Settings, tint: "muted" },
];

const INSIGHTS_TABS: Tab[] = [
  { label: "Overview", href: "/analytics" },
  { label: "Budgets", href: "/budgets" },
  { label: "Debt", href: "/debt" },
  { label: "Cards", href: "/cards" },
  { label: "Money", href: "/income" },
];

const CLASSIC_SPEND_TABS: Tab[] = [
  { label: "Categories", href: "/transactions/classic" },
  { label: "Transactions", href: "/transactions/classic?view=all" },
];

/** Per-surface top tabs (§3). Insights = real routes; others = query-param tabs (R2 honors). */
const TOP_TABS: Record<string, Tab[]> = {
  "/dashboard": [],
  "/transactions": [],
  "/analytics": INSIGHTS_TABS,
  "/budgets": INSIGHTS_TABS,
  "/debt": INSIGHTS_TABS,
  "/cards": INSIGHTS_TABS,
  "/income": INSIGHTS_TABS,
  "/guidance": [
    { label: "Overview", href: "/guidance" },
    { label: "International Money", href: "/guidance?section=cross-border" },
    { label: "My Plan", href: "/guidance?section=plan" },
  ],
};

/** Header title per route prefix. */
const TITLES: Array<[string, string]> = [
  ["/dashboard", "Home"],
  ["/transactions", "Spend"],
  ["/analytics", "Insights"],
  ["/budgets", "Insights"],
  ["/debt", "Insights"],
  ["/cards", "Insights"],
  ["/income", "Insights"],
  ["/notifications", "Activity"],
  ["/capture", "Capture"],
  ["/review", "Review queue"],
  ["/guidance", "Guidance"],
  ["/connections", "Connections"],
  ["/settings", "Settings"],
];

function matchPrefix(pathname: string): string | undefined {
  return TITLES.map(([p]) => p).find(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function surfaceTitle(pathname: string): string {
  const prefix = matchPrefix(pathname);
  return TITLES.find(([p]) => p === prefix)?.[1] ?? "Home";
}

export function surfaceTabs(pathname: string): Tab[] {
  if (pathname === "/transactions/classic") return CLASSIC_SPEND_TABS;
  const prefix = matchPrefix(pathname);
  return prefix ? (TOP_TABS[prefix] ?? []) : [];
}

export function routeSwitch(pathname: string): Tab | null {
  if (pathname === "/dashboard") return { label: "New", href: "/dashboard/classic" };
  if (pathname === "/dashboard/classic") return { label: "Classic", href: "/dashboard" };
  if (pathname === "/transactions") return { label: "New", href: "/transactions/classic" };
  if (pathname === "/transactions/classic") return { label: "Classic", href: "/transactions" };
  return null;
}

export function activeBottomKey(pathname: string): BottomTab["key"] | null {
  const tab = BOTTOM_TABS.find((t) =>
    t.match.some((m) => pathname === m || pathname.startsWith(`${m}/`)),
  );
  return tab?.key ?? null;
}

/**
 * "Secondary" surfaces are sections reached from the drawer / FAB rather than
 * the bottom nav (capture, review, guidance, connections, settings). They are
 * presented as pushed screens — back arrow instead of the menu avatar — so it's
 * always clear you've stepped outside the four primary tabs (X-app behavior).
 */
const SECONDARY_PREFIXES = ["/capture", "/review", "/guidance", "/connections", "/settings"];

export function isSecondarySurface(pathname: string): boolean {
  return SECONDARY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
