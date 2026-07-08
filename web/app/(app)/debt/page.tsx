"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useCreateLoan, useLoans } from "@/lib/api/loans";
import { LoanDetailPage } from "@/components/debt/detail/loan-detail-page";
import { LoanForm } from "@/components/debt/loan-form";
import { DebtOverview } from "@/components/debt/overview/debt-overview";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export default function DebtPage() {
  const loans = useLoans();
  const params = useSearchParams();
  const loanId = params.get("loan");
  const selected = useMemo(
    () => (loanId ? (loans.data ?? []).find((l) => l.id === loanId) ?? null : null),
    [loanId, loans.data],
  );

  return (
    <div>
      {loans.isError ? (
        <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
          Couldn&apos;t load loans. Check your connection and try again.
        </div>
      ) : loans.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : selected ? (
        <LoanDetailPage loan={selected} />
      ) : (
        <DebtOverview loans={loans.data ?? []} addLoanAction={<NewLoanDialog />} />
      )}
    </div>
  );
}

function NewLoanDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateLoan();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add loan</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add loan</DialogTitle>
        </DialogHeader>
        <LoanForm
          pending={create.isPending}
          submitLabel="Add loan"
          onSubmit={async (payload) => {
            try {
              await create.mutateAsync(payload);
              toast.success("Loan added");
              setOpen(false);
            } catch {
              toast.error("Couldn't add loan");
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
