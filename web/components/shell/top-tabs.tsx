"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Tab } from "@/lib/shell/nav";
import { cn } from "@/lib/utils";
import { guidanceSection } from "@/components/guidance/section";

export function hrefMatches(href: string, pathname: string, search: string): boolean {
  const [path, query] = href.split("?");
  if (path !== pathname) return false;
  if (path === "/guidance") {
    return (
      guidanceSection(new URLSearchParams(query ?? "")) ===
      guidanceSection(new URLSearchParams(search))
    );
  }
  // A query-less tab (e.g. "Categories") is the base view — active only when no
  // sibling's distinguishing param is set. Matching any search made it win always.
  if (!query) return search === "";
  // active when every param in href is present in the URL
  const want = new URLSearchParams(query);
  const have = new URLSearchParams(search);
  for (const [k, v] of want) if (have.get(k) !== v) return false;
  return true;
}

export function TopTabs({ tabs, compact = false }: { tabs: Tab[]; compact?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  if (tabs.length === 0) return null;

  // default-active: first tab whose path matches but has no query, when none match exactly
  const exact = tabs.findIndex((t) => hrefMatches(t.href, pathname, search));
  const activeIndex = exact >= 0 ? exact : tabs.findIndex((t) => t.href.split("?")[0] === pathname);

  return (
    <div
      className={cn("flex", compact ? "gap-2" : "px-2")}
      role="tablist"
      aria-label="Section tabs"
    >
      {tabs.map((tab, i) => {
        const active = i === activeIndex;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "relative py-3 text-center text-[13.5px] font-semibold transition-colors",
              compact ? "flex-none px-1" : "flex-1",
              active ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {tab.label}
            <span
              className={cn(
                "absolute bottom-0 left-1/2 h-[3px] w-[34px] -translate-x-1/2 rounded-full bg-accent transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
            />
          </Link>
        );
      })}
    </div>
  );
}
