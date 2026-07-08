"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Bell } from "@/lib/icons";
import type { Tab } from "@/lib/shell/nav";
import { TopTabs } from "@/components/shell/top-tabs";
import { cn } from "@/lib/utils";

export function GlassBar({
  title,
  tabs,
  onOpenDrawer,
  onBack,
  avatarInitial,
  switchTab,
  secondary = false,
  showAvatar = true,
}: {
  title: string;
  tabs: Tab[];
  onOpenDrawer: () => void;
  onBack?: () => void;
  avatarInitial: string;
  switchTab?: Tab | null;
  /** Secondary surfaces (drawer/FAB sections) show a back arrow, not the menu. */
  secondary?: boolean;
  showAvatar?: boolean;
}) {
  return (
    <header className="glass absolute inset-x-0 top-0 z-40 lg:hidden">
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
        {secondary ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="-ml-1.5 grid size-[34px] place-items-center rounded-full text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronLeft className="size-[22px]" />
          </button>
        ) : showAvatar ? (
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Open menu"
            className="grid size-[34px] place-items-center rounded-full bg-accent-soft text-[13px] font-bold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {avatarInitial}
          </button>
        ) : (
          <span className="size-[34px]" />
        )}
        <h1 className="text-[17px] font-extrabold tracking-tight">{title}</h1>
        {switchTab ? (
          <Link
            href={switchTab.href}
            className="grid h-[34px] min-w-[64px] place-items-center rounded-full bg-chip px-3 text-[12px] font-bold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {switchTab.label}
          </Link>
        ) : (
          <Link
            href="/notifications"
            aria-label="Activity"
            className={cn(
              "grid size-[34px] place-items-center rounded-full bg-chip text-fg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            )}
          >
            <Bell className="size-[18px]" />
          </Link>
        )}
      </div>
      <TopTabs tabs={tabs} />
    </header>
  );
}
