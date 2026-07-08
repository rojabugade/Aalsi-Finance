"use client";

import type { CatRow } from "@/lib/spend/derive";
import type { Transaction } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";

function StatTile({
  label,
  value,
  foot,
  footClass,
  onClick,
}: {
  label: string;
  value: string;
  foot?: string;
  footClass?: string;
  onClick?: () => void;
}) {
  const cls = "flex h-full flex-col justify-center rounded-card-sm border border-border bg-card p-4 shadow-card";
  const inner = (
    <>
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1.5 truncate text-[17px] font-extrabold capitalize leading-tight tabular-nums">{value}</p>
      <p className={`mt-0.5 min-h-4 text-xs font-semibold ${footClass ?? "text-muted"}`}>{foot ?? " "}</p>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} text-left transition-colors hover:bg-chip`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/**
 * Bento row 1 from spend-overview-v2: a 2-wide hero spend tile + two stat tiles
 * (2fr / 1fr / 1fr). All tiles stretch to equal height (`items-stretch` grid +
 * `h-full`) so the row stays flush regardless of how much text each holds. The
 * Top mover and Largest purchase tiles are clickable when handlers are given,
 * drilling into that category / transaction.
 */
export function InsightStrip({
  spent,
  prevSpent,
  mover,
  unusual,
  dailyAvg,
  incomePct,
  currency,
  onMover,
  onLargest,
}: {
  spent: number;
  prevSpent: number;
  mover: CatRow | null;
  unusual: Transaction | null;
  dailyAvg: number;
  incomePct?: number | null;
  currency: string;
  onMover?: (categoryId: string) => void;
  onLargest?: (txnId: string) => void;
}) {
  const delta = prevSpent === 0 ? null : ((spent - prevSpent) / prevSpent) * 100;
  const down = (delta ?? 0) <= 0;
  return (
    <div
      className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="spend-insight-strip"
    >
      {/* hero insight tile — spans two columns */}
      <div className="flex h-full flex-col justify-center rounded-card-sm border border-border bg-gradient-to-br from-accent-soft/70 to-card p-5 shadow-card sm:col-span-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Spent this period</p>
        <p className="mt-1 text-[30px] font-extrabold leading-none tabular-nums">
          {formatCurrency(spent, { currency })}
        </p>
        <p className="mt-2 text-xs font-semibold">
          {delta !== null && (
            <span className={down ? "text-c3" : "text-destructive"}>
              {down ? "▼" : "▲"} {Math.abs(delta).toFixed(0)}% vs prev
            </span>
          )}
          {delta !== null && <span className="text-muted"> · </span>}
          <span className="text-muted">{formatCurrency(dailyAvg, { currency })}/day</span>
          {incomePct != null && incomePct > 0 && (
            <span className="text-muted"> · {incomePct.toFixed(0)}% of income</span>
          )}
        </p>
      </div>

      <StatTile
        label="Top mover"
        value={mover ? mover.name.toLowerCase() : "—"}
        foot={mover && mover.deltaPct !== null ? `▲ ${mover.deltaPct.toFixed(0)}% · ${formatCurrency(mover.total - mover.prev, { currency, signed: true })}` : undefined}
        footClass="text-destructive"
        onClick={mover && onMover ? () => onMover(mover.id) : undefined}
      />
      <StatTile
        label="Largest purchase"
        value={unusual?.merchant ?? "—"}
        foot={unusual ? formatCurrency(Math.abs(Number(unusual.amount)), { currency }) : undefined}
        onClick={unusual && onLargest ? () => onLargest(unusual.id) : undefined}
      />
    </div>
  );
}
