"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Link2, LogOut, Settings } from "lucide-react";
import { authApi } from "@/lib/api/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function AccountMenu({
  initial,
  label = "Open account menu",
  side = "bottom",
  align = "end",
  className,
}: {
  initial: string;
  label?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const router = useRouter();

  async function logout() {
    await authApi.logout();
    router.replace("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title="Account menu"
          className={cn(
            "grid shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent transition-colors hover:bg-accent hover:text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
            className,
          )}
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="min-w-40">
        <DropdownMenuItem asChild>
          <Link href="/notifications">
            <Bell />
            Notifications
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/connections">
            <Link2 />
            Connections
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout} className="text-destructive focus:text-destructive">
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
