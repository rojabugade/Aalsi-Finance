"use client";

import { toast } from "sonner";

import { useResolveGroup, useResolveReview, useReviewQueue, type ReviewGroup, type ReviewItem } from "@/lib/api/review";
import { Skeleton } from "@/components/ui/skeleton";
import { ListChecks } from "@/lib/icons";
import { ConfirmCard } from "@/components/capture/confirm-card";
import { SuggestedGroupCard } from "@/components/capture/suggested-group-card";

export default function ReviewPage() {
  const queue = useReviewQueue();
  const resolve = useResolveReview();
  const resolveGroup = useResolveGroup();
  const groups: ReviewGroup[] = queue.data?.groups ?? [];
  const items: ReviewItem[] = queue.data?.items ?? [];

  async function onResolve(
    documentId: string,
    action: "confirm" | "reject",
    data?: Record<string, unknown>,
  ) {
    try {
      await resolve.mutateAsync({ documentId, action, data });
      toast.success(action === "confirm" ? "Confirmed and posted" : "Discarded extraction");
    } catch {
      toast.error("Couldn't resolve this item");
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
    <div className="space-y-4">
      {queue.isError ? (
        <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
          Couldn&apos;t load the review queue. Try again.
        </div>
      ) : queue.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : groups.length === 0 && items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <SuggestedGroupCard
              key={group.member_document_ids.join("-")}
              group={group}
              pending={resolveGroup.isPending || resolve.isPending}
              onConfirm={confirmGroup}
              onSplitResolve={onResolve}
            />
          ))}
          {items.map((item) => (
            <ConfirmCard
              key={item.document_id}
              item={item}
              pending={resolve.isPending}
              onResolve={(action, data) => onResolve(item.document_id, action, data)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card-sm border border-border bg-card py-16 text-center shadow-card">
        <span className="flex size-12 items-center justify-center rounded-full bg-soft3 text-c3">
          <ListChecks className="size-6" />
        </span>
        <div>
          <p className="font-medium">Nothing to review</p>
          <p className="mt-1 text-sm text-muted">
            Captured documents that need a second look will appear here.
          </p>
        </div>
    </div>
  );
}
