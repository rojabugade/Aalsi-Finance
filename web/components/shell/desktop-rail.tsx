"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ADD_NAV, BOTTOM_TABS, DRAWER_ITEMS, activeBottomKey } from "@/lib/shell/nav";
import { useAppVersion, versionedHref } from "@/lib/shell/use-dashboard-version";
import { ThemePicker } from "@/components/theme/theme-picker";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { cn } from "@/lib/utils";

export function DesktopRail({
  household,
}: {
  household: { name: string; meta: string; netWorth: string; initial: string };
}) {
  const pathname = usePathname();
  const activeKey = activeBottomKey(pathname);
  const appVersion = useAppVersion(pathname);
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) =>
    pathname === href.split("?")[0] || pathname.startsWith(`${href.split("?")[0]}/`);

  return (
    <aside className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-card px-3 py-5 transition-[width] duration-200 lg:flex ${collapsed ? "w-[72px]" : "w-[260px]"}`}>
      <div className={collapsed ? "pb-4" : "px-3 pb-4"}>
        <div className={`flex items-center ${collapsed ? "flex-col gap-3" : "justify-between gap-3"}`}>
          {collapsed ? <BrandMark className="size-11 rounded-2xl" /> : <BrandWordmark />}
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((value) => !value)}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-chip hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
        {!collapsed && (
          <>
            <div className="mt-2.5 text-base font-extrabold tracking-tight">{household.name}</div>
            <div className="text-xs text-muted">{household.meta}</div>
            <div className="mt-2 text-xs text-muted">
              Net worth
              <b className="block text-lg font-extrabold tracking-tight text-fg tabular-nums">
                {household.netWorth}
              </b>
            </div>
          </>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto" aria-label="Primary">
        <RailLink href={ADD_NAV.href} label={ADD_NAV.label} Icon={ADD_NAV.icon} active={isActive(ADD_NAV.href)} collapsed={collapsed} />
        <div className="my-2 border-t border-border" />
        {BOTTOM_TABS.map(({ key, label, href, icon: Icon }) => (
          <RailLink
            key={key}
            href={
              key === "home"
                ? versionedHref("/dashboard", appVersion)
                : key === "spend"
                  ? versionedHref("/transactions", appVersion)
                  : href
            }
            label={label}
            Icon={Icon}
            active={key === activeKey}
            collapsed={collapsed}
          />
        ))}
        <div className="my-2 border-t border-border" />
        {DRAWER_ITEMS.map(({ key, label, href, icon: Icon }) => (
          <RailLink key={key} href={href} label={label} Icon={Icon} active={isActive(href)} collapsed={collapsed} />
        ))}
      </nav>

      {!collapsed && <div className="border-t border-border px-2 pt-3"><ThemePicker /></div>}
    </aside>
  );
}

function RailLink({
  href,
  label,
  Icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-chip px-3 py-2 text-sm font-semibold transition-colors",
        collapsed && "justify-center px-0",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-chip hover:text-fg",
      )}
    >
      <Icon className="size-[18px]" />
      {!collapsed && label}
    </Link>
  );
}
