"use client";
import { useCashflowSummary } from "@/lib/api/cashflow";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

export function CashflowHero() {
  const q = useCashflowSummary();
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError || !q.data)
    return (
      <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive">
        Couldn&apos;t load your cash flow.
      </div>
    );
  const { leftover_monthly, currency, breakdown } = q.data;
  const leftover = Number(leftover_monthly ?? 0);
  return (
    <section className="rounded-card border border-border bg-card p-6 shadow-card">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Left over each month</p>
      <p
        data-numeric
        className={`mt-1 text-4xl font-extrabold tabular-nums ${leftover < 0 ? "text-destructive" : "text-c3"}`}
      >
        {formatCurrency(leftover, { currency })}
      </p>
      <div className="mt-5 space-y-1.5">
        {(breakdown ?? []).map((line) => {
          const amt = Number(line.amount ?? 0);
          const isLeftover = line.kind === "leftover";
          return (
            <div
              key={line.label}
              className={`flex justify-between text-[13px] ${isLeftover ? "border-t border-border pt-2 font-semibold" : ""}`}
            >
              <span className="text-muted">{line.label}</span>
              <span className="tabular-nums">{formatCurrency(amt, { currency })}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
