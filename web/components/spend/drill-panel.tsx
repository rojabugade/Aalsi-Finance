"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, X } from "lucide-react";
import { useIsDesktop } from "@/lib/shell/use-is-desktop";
import { cn } from "@/lib/utils";

/**
 * Slide-over panel hosting a category / merchant drill. Desktop: a right-edge
 * sheet; mobile: a bottom sheet. Built on radix Dialog, so panels opened from
 * inside a panel stack correctly (nested portals, focus + escape ordering) —
 * closing a child returns you to its parent, and closing the root returns you
 * to the tab you were on. No URL navigation, so no tab-bouncing / lost context.
 */
export function DrillPanel({
  open,
  onOpenChange,
  title,
  subtitle,
  backLabel = "Back",
  onBack,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  /** Label for the back control (e.g. "Spend", "Travel"). */
  backLabel?: string;
  /** Custom back handler (pops a level). When omitted, back closes the panel. */
  onBack?: () => void;
  children: React.ReactNode;
}) {
  const isDesktop = useIsDesktop();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed z-50 flex flex-col bg-bg text-fg shadow-card focus:outline-none",
            isDesktop
              ? "inset-y-0 right-0 w-[min(94vw,560px)] border-l border-border data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right"
              : "inset-x-0 bottom-0 max-h-[90vh] rounded-t-[22px] border-t border-border data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
          )}
        >
          <div className="border-b border-border bg-card px-5 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => (onBack ? onBack() : onOpenChange(false))}
                className="-ml-1.5 flex min-w-0 items-center gap-0.5 rounded-full py-1 pr-2 text-sm font-semibold text-accent transition-colors hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ChevronLeft className="size-4 flex-none" />
                <span className="truncate">{backLabel}</span>
              </button>
              <Dialog.Close
                aria-label="Close"
                className="grid size-8 flex-none place-items-center rounded-full bg-chip text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <div className="mt-1 min-w-0">
              <Dialog.Title className="truncate text-lg font-extrabold tracking-tight">
                {title}
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description className="truncate text-xs text-muted">
                  {subtitle}
                </Dialog.Description>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(20px,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
