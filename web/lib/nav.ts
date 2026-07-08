import {
  ArrowLeftRight,
  Banknote,
  Bell,
  ChartPie,
  ClipboardCheck,
  Compass,
  LayoutDashboard,
  Plug,
  ScanLine,
  Settings,
  Wallet,
  Landmark,
  type LucideIcon,
} from "lucide-react";

export type Surface = {
  /** matches the i18n `nav` key and the route segment */
  key: string;
  icon: LucideIcon;
};

// Order = sidebar order. Cross-border is intentionally NOT a top-level surface;
// it lives inside Guidance.
export const SURFACES: Surface[] = [
  { key: "dashboard", icon: LayoutDashboard },
  { key: "capture", icon: ScanLine },
  { key: "review", icon: ClipboardCheck },
  { key: "transactions", icon: ArrowLeftRight },
  { key: "analytics", icon: ChartPie },
  { key: "budgets", icon: Wallet },
  { key: "debt", icon: Landmark },
  { key: "income", icon: Banknote },
  { key: "guidance", icon: Compass },
  { key: "notifications", icon: Bell },
  { key: "connections", icon: Plug },
  { key: "settings", icon: Settings },
];
