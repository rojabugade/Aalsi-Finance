"use client";

import Link from "next/link";
import { Plus } from "@/lib/icons";

export function AddMenu() {
  return (
    <Link
      href="/capture"
      className="inline-flex items-center gap-1.5 rounded-chip bg-accent px-3.5 py-2 text-sm font-semibold text-on-accent transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Plus className="size-4" /> Add
    </Link>
  );
}
