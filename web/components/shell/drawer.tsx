"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut } from "lucide-react";
import { authApi } from "@/lib/api/auth";
import { ADD_NAV, DRAWER_ITEMS, type DrawerItem } from "@/lib/shell/nav";
import { BrandWordmark } from "@/components/brand";
import { ThemePicker } from "@/components/theme/theme-picker";
import { InstallButton } from "@/components/pwa/install-button";
import { cn } from "@/lib/utils";

const TINT: Record<DrawerItem["tint"], string> = {
  accent: "bg-accent-soft text-accent",
  c2: "bg-soft2 text-c2",
  c3: "bg-soft3 text-c3",
  muted: "bg-chip text-muted",
};

export function Drawer({
  open,
  onClose,
  workspace,
}: {
  open: boolean;
  onClose: () => void;
  workspace: { name: string; meta: string; netWorth: string; initial: string };
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const [keyboardOpened, setKeyboardOpened] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    const onPointer = () => setKeyboardOpened(false);
    const onKey = () => setKeyboardOpened(true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  useEffect(() => {
    if (open && keyboardOpened) panelRef.current?.querySelector<HTMLElement>("a,button")?.focus();
  }, [keyboardOpened, open]);

  async function logout() {
    await authApi.logout();
    router.replace("/login");
  }

  return (
    <aside
      ref={panelRef}
      className="app-drawer absolute inset-y-0 left-0 z-[60] flex w-[82%] max-w-[340px] flex-col bg-bg pb-5 pt-[max(54px,env(safe-area-inset-top))] shadow-2xl"
      data-open={open}
      aria-hidden={!open}
      aria-label="More"
      inert={!open}
    >
      {/* header */}
      <div className="px-[22px] pb-4">
        <BrandWordmark className="text-[2rem]" />
        <div className="mt-3 text-[18px] font-extrabold tracking-tight">{workspace.name}</div>
        <div className="mt-0.5 text-xs text-muted">{workspace.meta}</div>
        <div className="mt-3.5 text-[12.5px] text-muted">
          Net worth
          <b className="mt-px block text-[23px] font-extrabold tracking-tight text-fg tabular-nums">
            {workspace.netWorth}
          </b>
        </div>
      </div>

      {/* items */}
      <nav className="flex-1 overflow-y-auto px-2.5" aria-label="More">
        <Link
          href={ADD_NAV.href}
          onClick={onClose}
          className="flex items-center gap-3.5 rounded-[14px] px-3 py-3 text-fg transition-colors hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="grid size-9 flex-none place-items-center rounded-chip bg-accent text-on-accent">
            <ADD_NAV.icon className="size-[18px]" />
          </span>
          <span className="flex-1">
            <span className="block text-[14.5px] font-semibold">{ADD_NAV.label}</span>
            <span className="block text-[11px] font-medium text-muted">Receipts, statements, manual entry</span>
          </span>
          <ChevronRight className="size-[18px] flex-none text-muted" />
        </Link>
        <div className="my-1 border-t border-border" />
        {DRAWER_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onClose}
              className="flex items-center gap-3.5 rounded-[14px] px-3 py-3 text-fg transition-colors hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className={cn("grid size-9 flex-none place-items-center rounded-chip", TINT[item.tint])}>
                <Icon className="size-[18px]" />
              </span>
              <span className="flex-1">
                <span className="block text-[14.5px] font-semibold">{item.label}</span>
                <span className="block text-[11px] font-medium text-muted">{item.sub}</span>
              </span>
              <ChevronRight className="size-[18px] flex-none text-muted" />
            </Link>
          );
        })}
      </nav>

      {/* footer: appearance + sign out */}
      <div className="mt-3 space-y-3 border-t border-border px-5 pt-3">
        <div className="flex items-center justify-between">
          <ThemePicker />
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
        <InstallButton />
      </div>
    </aside>
  );
}
