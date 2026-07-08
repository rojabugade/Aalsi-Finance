"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useIsDesktop } from "@/lib/shell/use-is-desktop";
import { cn } from "@/lib/utils";

export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  children,
  aside,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const twoPane = isDesktop && aside != null;

  const header = (
    <div className={cn("flex items-center justify-between", twoPane ? "px-5 pb-3 pt-5" : "mb-3")}>
      <Dialog.Title className="text-base font-extrabold tracking-tight">{title}</Dialog.Title>
      <Dialog.Close
        aria-label="Close"
        className="grid size-8 place-items-center rounded-full bg-chip text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X className="size-4" />
      </Dialog.Close>
    </div>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-card text-fg shadow-card focus:outline-none",
            !isDesktop &&
              "inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[22px] p-5 pb-[max(20px,env(safe-area-inset-bottom))] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
            isDesktop &&
              "left-1/2 top-1/2 max-h-[88vh] -translate-x-1/2 -translate-y-1/2 rounded-card data-[state=open]:animate-in data-[state=open]:zoom-in-95",
            isDesktop && !twoPane && "w-[min(92vw,520px)] overflow-y-auto p-5",
            twoPane && "w-[min(94vw,880px)] overflow-hidden",
          )}
        >
          {twoPane ? (
            <div className="flex h-full max-h-[88vh] flex-col">
              {header}
              <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
                <div className="shrink-0 overflow-y-auto border-l border-border">{aside}</div>
              </div>
            </div>
          ) : (
            <>
              {header}
              {children}
              {!isDesktop && aside}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
