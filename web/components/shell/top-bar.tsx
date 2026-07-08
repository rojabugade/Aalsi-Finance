"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search } from "@/lib/icons";
import { AddMenu } from "@/components/shell/add-menu";
import { AccountMenu } from "@/components/shell/account-menu";
import type { Tab } from "@/lib/shell/nav";

export function TopBar({
  title,
  secondary,
  avatarInitial,
  switchTab,
}: {
  title: string;
  secondary: boolean;
  avatarInitial: string;
  switchTab?: Tab | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/transactions?view=all&q=${encodeURIComponent(term)}` : "/transactions?view=all");
  }

  return (
    <div className="flex items-center gap-4">
      {secondary && (
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="-ml-2 grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-chip hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}
      <h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>

      <form onSubmit={onSubmit} role="search" aria-label="Global search" className="relative ml-auto w-72 max-w-[40%]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search transactions, merchants…"
          aria-label="Search"
          className="h-9 w-full rounded-chip border border-border bg-card pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </form>

      <AddMenu />

      {switchTab && (
        <Link
          href={switchTab.href}
          className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-semibold shadow-sm transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
        >
          {switchTab.label}
        </Link>
      )}

      <AccountMenu initial={avatarInitial} className="size-9 text-sm" />
    </div>
  );
}
