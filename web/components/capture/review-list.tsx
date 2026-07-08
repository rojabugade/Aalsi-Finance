"use client";

import { ListChecks } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { ConfirmCard } from "@/components/capture/confirm-card";
import { SuggestedGroupCard } from "@/components/capture/suggested-group-card";
import { useResolveGroup, useResolveReview, useReviewQueue, type ResolveAction, type ReviewGroup, type ReviewItem } from "@/lib/api/review";

type Data = Record<string, unknown>;

export function ReviewList({ poll }: { poll: boolean }) {
  const queue = useReviewQueue({ poll });
  const resolve = useResolveReview();
  const resolveGroup = useResolveGroup();
  const groups: ReviewGroup[] = queue.data?.groups ?? [];
  const items: ReviewItem[] = queue.data?.items ?? [];
  const empty = groups.length === 0 && items.length === 0;

  async function act(documentId: string, action: ResolveAction, data?: Data) {
    try {
      await resolve.mutateAsync({ documentId, action, data });
      toast.success(action === "confirm" ? "Confirmed" : "Rejected");
    } catch {
      toast.error("Couldn't update that item");
    }
  }

  async function confirmGroup(memberIds: string[]) {
    try {
      await resolveGroup.mutateAsync({ memberDocumentIds: memberIds, action: "confirm" });
      toast.success("Merged receipt confirmed");
    } catch {
      toast.error("Couldn't merge those images");
    }
  }

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Confirm to add</h2>
          <p className="text-sm text-muted">Detected items stay visible until you confirm or reject them.</p>
        </div>
        <Badge variant={empty ? "outline" : "warning"}>
          <ListChecks className="size-3.5" />
          {groups.length + items.length}
        </Badge>
      </div>
      {empty ? (
        <div className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted">
          Nothing waiting to confirm.
        </div>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => (
            <SuggestedGroupCard
              key={group.member_document_ids.join("-")}
              group={group}
              pending={resolveGroup.isPending || resolve.isPending}
              onConfirm={confirmGroup}
              onSplitResolve={act}
            />
          ))}
          {items.map((item) => (
            <ConfirmCard
              key={item.document_id}
              item={item}
              pending={resolve.isPending}
              onResolve={(action, data) => act(item.document_id, action, data)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
