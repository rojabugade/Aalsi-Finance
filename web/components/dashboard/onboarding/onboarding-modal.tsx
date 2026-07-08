"use client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TemplateGallery } from "./template-gallery";
import type { TemplateId } from "@/lib/dashboard/templates";

export function OnboardingModal({
  open,
  onPick,
  onSkip,
}: {
  open: boolean;
  onPick: (id: TemplateId) => void;
  onSkip: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onSkip(); }}>
      <DialogContent className="max-h-[88vh] w-[min(94vw,720px)] max-w-none overflow-y-auto">
        <DialogTitle>What's your focus?</DialogTitle>
        <p className="mt-1 text-[13px] text-muted">
          Pick a goal and I'll set up a dashboard for it. You can change everything later.
        </p>
        <div className="mt-4">
          <TemplateGallery onPick={onPick} labelKey="goal" />
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg border border-border px-3 py-2 text-[12px] font-semibold text-muted hover:border-accent/50 hover:text-fg"
          >
            Skip — I'll explore on my own
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
