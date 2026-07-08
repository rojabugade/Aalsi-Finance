"use client";

import { useLoans } from "@/lib/api/loans";
import { CardsView } from "@/components/cards/cards-view";
import { Skeleton } from "@/components/ui/skeleton";

export default function CardsPage() {
  const loans = useLoans();

  if (loans.isError) {
    return (
      <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
        Couldn&apos;t load cards. Check your connection and try again.
      </div>
    );
  }
  if (loans.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
      </div>
    );
  }
  return <CardsView loans={loans.data ?? []} />;
}
