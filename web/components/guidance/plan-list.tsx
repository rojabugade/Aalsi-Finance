"use client";

import { useEffect, useMemo, useState } from "react";

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
  usePlanItems,
  useUpdatePlanItem,
  type GuidancePlanItem,
  type GuidancePlanStatus,
} from "@/lib/api/guidance";

const FILTERS: Array<{ status: GuidancePlanStatus; label: string }> = [
  { status: "open", label: "Open" },
  { status: "completed", label: "Completed" },
  { status: "dismissed", label: "Dismissed" },
];

type SourceRef = { title?: unknown; source_url?: unknown };

function domainLabel(domain: GuidancePlanItem["domain"]) {
  return domain === "cross_border" ? "Cross-border" : domain === "investment" ? "Investment" : "General";
}

function sourceRefs(value: unknown): SourceRef[] {
  return Array.isArray(value)
    ? value.filter((source): source is SourceRef => Boolean(source) && typeof source === "object")
    : [];
}

function statusLabel(status: GuidancePlanStatus) {
  return status === "open" ? "open" : status === "completed" ? "completed" : "dismissed";
}

function PlanRow({
  item,
  onEdit,
  onUpdate,
  updating,
}: {
  item: GuidancePlanItem;
  onEdit: (item: GuidancePlanItem) => void;
  onUpdate: (item: GuidancePlanItem, status: GuidancePlanStatus) => void;
  updating: boolean;
}) {
  const sources = sourceRefs(item.source_refs);

  return (
    <article className="space-y-3 rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-fg">{item.title}</h3>
          <p className="mt-1 text-sm text-muted">{item.rationale ?? "No rationale provided."}</p>
        </div>
        <span className="rounded-full bg-chip px-2 py-1 text-xs font-medium text-fg">{statusLabel(item.status)}</span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span>{domainLabel(item.domain)}</span>
        <span>{item.due_date ? `Due: ${item.due_date}` : "No due date"}</span>
        <span>{sources.length} {sources.length === 1 ? "source" : "sources"}</span>
      </div>

      {sources.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {sources.map((source, index) => {
            const title = typeof source.title === "string" && source.title.trim() ? source.title : `Source ${index + 1}`;
            return typeof source.source_url === "string" && source.source_url ? (
              <li key={`${source.source_url}-${index}`}>
                <a className="text-accent hover:underline" href={source.source_url} target="_blank" rel="noreferrer">
                  {title}
                </a>
              </li>
            ) : <li key={`${title}-${index}`}>{title}</li>;
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onEdit(item)} disabled={updating}>
          Edit {item.title}
        </Button>
        {item.status === "open" ? (
          <>
            <Button type="button" size="sm" variant="secondary" onClick={() => onUpdate(item, "completed")} disabled={updating}>
              Mark {item.title} complete
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onUpdate(item, "dismissed")} disabled={updating}>
              Dismiss {item.title}
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => onUpdate(item, "open")} disabled={updating}>
            Reopen {item.title}
          </Button>
        )}
      </div>
    </article>
  );
}

export function PlanList() {
  const plan = usePlanItems();
  const update = useUpdatePlanItem();
  const [filter, setFilter] = useState<GuidancePlanStatus>("open");
  const [editing, setEditing] = useState<GuidancePlanItem | null>(null);
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const visibleItems = useMemo(
    () => (plan.data ?? []).filter((item) => item.status === filter),
    [filter, plan.data],
  );

  useEffect(() => {
    if (!editing) return;
    setTitle(editing.title);
    setRationale(editing.rationale ?? "");
    setDueDate(editing.due_date ?? "");
  }, [editing]);

  async function updateStatus(item: GuidancePlanItem, status: GuidancePlanStatus) {
    setError(null);
    try {
      await update.mutateAsync({ id: item.id, body: { status } });
    } catch {
      setError("Couldn't update this item. Please try again.");
    }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !title.trim()) return;
    setError(null);
    try {
      await update.mutateAsync({
        id: editing.id,
        body: {
          title: title.trim(),
          rationale: rationale.trim() || null,
          due_date: dueDate || null,
        },
      });
      setEditing(null);
    } catch {
      setError("Couldn't update this item. Please try again.");
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="guidance-plan-title">
      <div>
        <h2 id="guidance-plan-title" className="text-lg font-bold tracking-tight text-fg">My Plan</h2>
        <p className="mt-1 text-sm text-muted">Review, complete, or dismiss the guidance items you saved.</p>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Plan status">
        {FILTERS.map(({ status, label }) => (
          <Button
            key={status}
            type="button"
            size="sm"
            variant={filter === status ? "secondary" : "outline"}
            aria-pressed={filter === status}
            onClick={() => setFilter(status)}
          >
            {label}
          </Button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {plan.isLoading ? (
        <p className="text-sm text-muted">Loading your plan…</p>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-card-sm border border-dashed border-border p-5 text-sm text-muted">
          <p>No {statusLabel(filter)} items yet.</p>
          <p className="mt-2">Start in <a className="font-medium text-accent hover:underline" href="?section=overview">Overview</a>: <a className="font-medium text-accent hover:underline" href="?section=overview">Ask a question</a> or <a className="font-medium text-accent hover:underline" href="?section=overview">Build my plan</a>.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((item) => (
            <PlanRow key={item.id} item={item} onEdit={setEditing} onUpdate={updateStatus} updating={update.isPending} />
          ))}
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit plan item</DialogTitle>
            <DialogDescription>Update the details that make this item useful to you.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveEdit}>
            <div className="space-y-1">
              <Label htmlFor="edit-plan-item-title" required>Title</Label>
              <Input id="edit-plan-item-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-plan-item-rationale">Why this matters</Label>
              <Textarea id="edit-plan-item-rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} rows={4} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-plan-item-due-date">Due date</Label>
              <Input id="edit-plan-item-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={update.isPending || !title.trim()}>{update.isPending ? "Saving…" : "Save changes"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
