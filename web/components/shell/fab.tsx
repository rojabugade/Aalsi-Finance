"use client";

import Link from "next/link";
import { Camera } from "@/lib/icons";

export function Fab() {
  return (
    <Link
      href="/capture"
      aria-label="Capture"
      className="fixed right-[18px] bottom-[calc(96px+env(safe-area-inset-bottom))] z-[45] grid size-[54px] place-items-center rounded-fab bg-accent text-on-accent shadow-[0_14px_28px_-8px_var(--accent)] transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg lg:hidden"
    >
      <Camera className="size-6" />
    </Link>
  );
}
