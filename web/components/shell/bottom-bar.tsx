"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BOTTOM_TABS, activeBottomKey } from "@/lib/shell/nav";
import { useAppVersion, versionedHref } from "@/lib/shell/use-dashboard-version";
import { cn } from "@/lib/utils";

export function BottomBar() {
  const pathname = usePathname();
  const active = activeBottomKey(pathname);
  const appVersion = useAppVersion(pathname);
  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-[14px] bottom-[max(14px,env(safe-area-inset-bottom))] z-40 flex h-16 items-center justify-around rounded-bar px-1.5 lg:hidden"
    >
      {BOTTOM_TABS.map(({ key, label, href, icon: Icon }) => {
        const on = key === active;
        const resolvedHref =
          key === "home"
            ? versionedHref("/dashboard", appVersion)
            : key === "spend"
              ? versionedHref("/transactions", appVersion)
              : href;
        return (
          <Link
            key={key}
            href={resolvedHref}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-[3px] text-[10px] font-semibold transition-colors",
              on ? "text-accent" : "text-muted",
            )}
          >
            <Icon className="size-[23px]" strokeWidth={on ? 2.4 : 2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
