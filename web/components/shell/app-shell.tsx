"use client";

import { useRef, useState } from "react";
import { useIsDesktop } from "@/lib/shell/use-is-desktop";
import { isSecondarySurface, routeSwitch, surfaceTabs, surfaceTitle } from "@/lib/shell/nav";
import { usePathname, useRouter } from "next/navigation";
import { GlassBar } from "@/components/shell/glass-bar";
import { BottomBar } from "@/components/shell/bottom-bar";
import { Fab } from "@/components/shell/fab";
import { Drawer } from "@/components/shell/drawer";
import { DesktopRail } from "@/components/shell/desktop-rail";
import { TopBar } from "@/components/shell/top-bar";
import { TopTabs } from "@/components/shell/top-tabs";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { useHousehold, useMembers } from "@/lib/api/settings";
import { formatCurrency } from "@/lib/format";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const touchX = useRef<number | null>(null);

  const householdQ = useHousehold();
  const membersQ = useMembers();

  const householdName = householdQ.data?.name ?? "Household";
  const currency = (householdQ.data as { base_currency?: string } | undefined)?.base_currency ?? "USD";
  const memberCount = membersQ.data?.length ?? 0;
  const isSharedHousehold = householdQ.data?.sharing_enabled ?? false;
  const soloName = membersQ.data?.[0]?.display_name?.trim() || householdName.replace(/'s household$/i, "");
  const name = isSharedHousehold ? householdName : soloName;
  const household = {
    name,
    initial: name.slice(0, 1).toUpperCase(),
    meta: isSharedHousehold ? `Household · ${currency}${memberCount > 1 ? ` · ${memberCount} members` : ""}` : currency,
    // Net worth is not a dedicated endpoint; show a placeholder R2 may wire to analytics.
    netWorth: formatCurrency(0, { currency }),
  };

  const title = surfaceTitle(pathname);
  const tabs = surfaceTabs(pathname);
  const switchTab = routeSwitch(pathname);
  const secondary = isSecondarySurface(pathname);

  function onTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current === null || isDesktop) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (dx > 60 && touchX.current < 40) setOpen(true);
    else if (dx < -60 && open) setOpen(false);
    touchX.current = null;
  }

  if (isDesktop) {
    return (
      <div className="flex min-h-dvh w-full">
        <OfflineBanner />
        <DesktopRail household={household} />
        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-md">
            <div className="w-full px-8 pt-6 2xl:px-10">
              <div className="pb-1">
                <TopBar title={title} secondary={secondary} avatarInitial={household.initial} switchTab={switchTab} />
              </div>
              <TopTabs tabs={tabs} compact />
              {tabs.length === 0 && <div className="h-3" />}
            </div>
          </header>
          <div className="w-full px-8 py-6 2xl:px-10">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-dvh overflow-hidden bg-bg"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <OfflineBanner />
      <Drawer open={open} onClose={() => setOpen(false)} household={household} />

      <div className="app-window absolute inset-0 z-10 min-h-dvh overflow-hidden bg-bg" data-open={open}>
        <GlassBar
          title={title}
          tabs={tabs}
          avatarInitial={household.initial}
          switchTab={switchTab}
          secondary={secondary}
          onBack={() => router.back()}
          onOpenDrawer={() => setOpen(true)}
        />
        <div
          className="app-scroll absolute inset-0 overflow-y-auto overscroll-contain px-4 pb-28"
          style={{ paddingTop: tabs.length ? 104 : 76 }}
        >
          {children}
        </div>
        {open && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 z-50 bg-black/20"
          />
        )}
        <Fab />
        <BottomBar />
      </div>
    </div>
  );
}
