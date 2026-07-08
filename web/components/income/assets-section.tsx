"use client";
import { useHoldings } from "@/lib/api/widget-data";
import { useNetWorth } from "@/lib/api/analytics";
import { formatCurrency } from "@/lib/format";

export function AssetsSection() {
  const holdings = useHoldings();
  const nw = useNetWorth();
  const holdingsTotal = (holdings.data ?? []).reduce(
    (sum, h) => sum + Number(h.latest_valuation?.value ?? 0),
    0,
  );
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Assets</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-card-sm border border-border bg-card p-4">
          <p className="text-xs text-muted">Holdings</p>
          <p data-numeric className="mt-1 text-lg font-semibold">{formatCurrency(holdingsTotal)}</p>
        </div>
        <div className="rounded-card-sm border border-border bg-card p-4">
          <p className="text-xs text-muted">Net worth</p>
          <p data-numeric className="mt-1 text-lg font-semibold">
            {formatCurrency(Number(nw.data?.net_worth ?? 0), { currency: nw.data?.currency })}
          </p>
        </div>
      </div>
    </section>
  );
}
