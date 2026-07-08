"use client";
import type { ReactNode } from "react";
import { Sparkles, Bell, ListChecks, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

function StubSection({ icon: Icon, label }: { icon: typeof Sparkles; label: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="mb-1 flex items-center gap-1.5 text-muted">
        <Icon className="size-3.5" />
        <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-[12px] text-muted/80">Coming soon.</p>
    </section>
  );
}

export function FocusView({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[min(92vw,860px)] max-w-none overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <div className="grid gap-3">
          <section data-testid="focus-overview" className="rounded-xl border border-border bg-card p-3">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-muted">Overview</span>
            <div className="min-h-[220px]">{children}</div>
          </section>
          <div className="grid gap-3 sm:grid-cols-2">
            <StubSection icon={Sparkles} label="AI explanation" />
            <StubSection icon={Bell} label="Related alerts" />
            <StubSection icon={ListChecks} label="Suggested actions" />
            <StubSection icon={Share2} label="Export / share" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
