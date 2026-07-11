"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreatePlanItem,
  type GuidanceDomain,
  type GuidancePlanItemCreate,
} from "@/lib/api/guidance";
import type { PlanDraft } from "@/components/guidance/guidance-conversation";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function citationRefs(draft: PlanDraft): GuidancePlanItemCreate["source_refs"] {
  return draft.citations.map((citation) => ({
    title: citation.title,
    source_url: citation.source_url,
    source_type: citation.source_type,
    effective_date: citation.effective_date,
  })) as unknown as GuidancePlanItemCreate["source_refs"];
}

export function PlanItemDialog({
  draft,
  open,
  onOpenChange,
}: {
  draft: PlanDraft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreatePlanItem();
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [domain, setDomain] = useState<GuidanceDomain>("general");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const wasOpen = useRef(false);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && draft && !wasOpen.current) {
      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setTitle(draft.question);
      setRationale(draft.answer);
      setDomain(draft.domain);
      setDueDate("");
      setError(null);
    }
    if (!open && wasOpen.current) {
      window.setTimeout(() => restoreFocus.current?.focus(), 0);
    }
    wasOpen.current = open;
  }, [draft, open]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !title.trim()) return;
    setError(null);
    try {
      await create.mutateAsync({
        title: title.trim(),
        rationale: rationale.trim() || null,
        domain,
        due_date: dueDate || null,
        source_refs: citationRefs(draft),
        origin_thread_key: draft.threadId,
      });
      toast.success("Added to My Plan");
      onOpenChange(false);
    } catch {
      setError("Couldn't add this item to your plan. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save to My Plan</DialogTitle>
          <DialogDescription>
            Keep this as a personal checklist item. You can update it later in My Plan.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="space-y-1">
            <Label htmlFor="plan-item-title" required>Title</Label>
            <Input id="plan-item-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="plan-item-rationale">Why this matters</Label>
            <Textarea
              id="plan-item-rationale"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              rows={5}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="plan-item-domain">Area</Label>
              <select
                id="plan-item-domain"
                value={domain}
                onChange={(event) => setDomain(event.target.value as GuidanceDomain)}
                className={SELECT_CLASS}
              >
                <option value="general">General</option>
                <option value="investment">Investment</option>
                <option value="cross_border">Cross-border</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="plan-item-due-date">Due date</Label>
              <Input id="plan-item-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !title.trim()}>
              {create.isPending ? "Saving…" : "Add to My Plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
