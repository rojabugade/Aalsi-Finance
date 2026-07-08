"use client";

import { TrendingDown, TrendingUp } from "@/lib/icons";
import { useNetWorth } from "@/lib/api/analytics";
import { formatCurrency } from "@/lib/format";
import { AreaChart } from "@/components/ui/area-chart";
import { Skeleton } from "@/components/ui/skeleton";

function Header() {
  return (
    <div className="flex items-center gap-2 text-muted">
      <TrendingUp className="size-4" />
      <span className="text-[11px] font-bold uppercase tracking-wide">Net worth</span>
    </div>
  );
}

export function NetWorthCard() {
  const nw = useNetWorth();

  if (nw.isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card" data-testid="net-worth-card">
        <Header />
        <Skeleton className="mt-2 h-28" />
      </div>
    );
  }

  if (nw.isError || !nw.data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card" data-testid="net-worth-card">
        <Header />
        <p className="mt-2 text-sm text-muted">Couldn&apos;t load net worth right now.</p>
      </div>
    );
  }

  const d = nw.data;
  const points = d.points.map((p) => ({ label: p.period, value: Number(p.net_worth) }));
  const first = points[0]?.value ?? 0;
  const last = Number(d.net_worth);
  const delta = first === 0 ? null : ((last - first) / Math.abs(first)) * 100;
  const up = (delta ?? 0) >= 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card" data-testid="net-worth-card">
      <Header />
      <p className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">
        {formatCurrency(last, { currency: d.currency })}
      </p>
      {delta !== null && (
        <p className={`flex items-center gap-1 text-sm font-semibold ${up ? "text-c3" : "text-destructive"}`}>
          {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
          <span className="tabular-nums">{Math.abs(delta).toFixed(1)}%</span> over {points.length} mo
        </p>
      )}
      <div className="mt-3">
        <AreaChart data={points} height={90} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted">
        <span>
          Assets
          <b className="block text-sm font-bold tabular-nums text-fg">
            {formatCurrency(Number(d.assets), { currency: d.currency })}
          </b>
        </span>
        <span>
          Liabilities
          <b className="block text-sm font-bold tabular-nums text-fg">
            {formatCurrency(Number(d.liabilities), { currency: d.currency })}
          </b>
        </span>
      </div>
    </div>
  );
}
