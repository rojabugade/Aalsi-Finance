"use client";

import { useState } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { cn } from "@/lib/utils";

export function InstallButton({ className }: { className?: string }) {
  const { canInstall, isIOS, isStandalone, promptInstall } = useInstallPrompt();
  const [iosOpen, setIosOpen] = useState(false);

  // Nothing to do when already installed, or when neither path is available.
  if (isStandalone) return null;
  if (!canInstall && !isIOS) return null;

  async function onClick() {
    if (canInstall) {
      const outcome = await promptInstall();
      if (outcome === "accepted") toast.success("Installing app…");
      return;
    }
    setIosOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex items-center gap-2 text-[13px] font-semibold text-accent transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          className,
        )}
      >
        <Download className="size-4" />
        Install app
      </button>

      <ResponsiveSheet open={iosOpen} onOpenChange={setIosOpen} title="Install on iPhone">
        <ol className="space-y-3 text-sm">
          <li className="flex items-center gap-3">
            <Share className="size-5 flex-none text-accent" />
            Tap the <b>Share</b> button in Safari&apos;s toolbar.
          </li>
          <li className="flex items-center gap-3">
            <SquarePlus className="size-5 flex-none text-accent" />
            Choose <b>Add to Home Screen</b>.
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-5 flex-none place-items-center rounded-chip bg-accent-soft text-[11px] font-bold text-accent">
              ✓
            </span>
            Tap <b>Add</b> — CodeName-Finance opens full-screen from your home screen.
          </li>
        </ol>
      </ResponsiveSheet>
    </>
  );
}
