"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";
import {
  allocationBreakdown,
  monthsToDuration,
  monthsToLabel,
  num,
  payoffTimeline,
  savingsVsBaseline,
  suggestedExtraMax,
  type LoanLike,
  type PayoffMethod,
} from "../debt-math";

const METHODS: { value: PayoffMethod; label: string; blurb: string }[] = [
  { value: "avalanche", label: "Avalanche", blurb: "Highest APR first — least interest" },
  { value: "snowball", label: "Snowball", blurb: "Smallest balance first — quick wins" },
  { value: "even", label: "Split evenly", blurb: "Spread across all accounts — costs more, feels balanced" },
];

/**
 * Full, interactive payoff scenario. Lets the user pick a method (including an
 * even split), dial the extra payment, and see the resulting monthly plan and
 * payoff timeline across EVERY account.
 */
export function ScenarioDialog({
  open,
  onOpenChange,
  loans,
  currency,
  initialExtra,
  initialStrategy,
  affordableExtra,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loans: LoanLike[];
  currency: string;
  initialExtra: number;
  initialStrategy: PayoffMethod;
  /** Monthly surplus the household can realistically direct at debt. Caps the slider. */
  affordableExtra?: number;
}) {
  const [method, setMethod] = useState<PayoffMethod>(initialStrategy);
  const [extra, setExtra] = useState(initialExtra);

  // Re-seed from the trigger every time the dialog opens.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setMethod(initialStrategy);
      setExtra(initialExtra);
    }
    wasOpen.current = open;
  }, [open, initialExtra, initialStrategy]);

  const savings = useMemo(() => savingsVsBaseline(loans, extra, method), [loans, extra, method]);
  const rows = useMemo(() => allocationBreakdown(loans, extra, method), [loans, extra, method]);
  const timeline = useMemo(() => payoffTimeline(loans, extra, method), [loans, extra, method]);
  const byId = useMemo(() => new Map(loans.map((l) => [l.id, l] as const)), [loans]);
  const totalMonthly = rows.reduce((a, r) => a + r.total, 0);
  const activeMethod = METHODS.find((m) => m.value === method)!;

  // Slider tops out at what the household can actually afford (when known);
  // the number input below still lets the user type past it.
  const sliderMax = useMemo(() => {
    const typedFloor = Math.ceil(extra / 250) * 250;
    if (affordableExtra != null && affordableExtra > 0) {
      return Math.max(Math.ceil(affordableExtra / 250) * 250, typedFloor);
    }
    return Math.max(suggestedExtraMax(loans), typedFloor);
  }, [loans, extra, affordableExtra]);
  const sliderStep = Math.max(25, Math.round(sliderMax / 80 / 25) * 25);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="scenario-dialog">
        <DialogHeader>
          <DialogTitle>Payoff scenario</DialogTitle>
          <DialogDescription className="text-xs text-muted">
            See how every account is paid down when you add extra each month.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-semibold">
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                className={
                  "rounded-md px-3 py-1.5 transition-colors " +
                  (method === m.value ? "bg-accent text-[var(--on-accent)]" : "text-muted hover:text-fg")
                }
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{activeMethod.blurb}</p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Extra per month</p>
            <div className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1">
              <span className="text-sm text-muted">{currency === "USD" ? "$" : ""}</span>
              <input
                type="number"
                min={0}
                step={25}
                value={extra}
                onChange={(e) => setExtra(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                className="w-24 bg-transparent text-right text-sm font-semibold tabular-nums outline-none"
                aria-label="Extra monthly payment"
              />
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={sliderMax}
            step={sliderStep}
            value={Math.min(extra, sliderMax)}
            onChange={(e) => setExtra(Number(e.target.value))}
            className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-chip accent-[var(--accent)]"
            aria-label="Extra monthly payment slider"
          />
          {affordableExtra != null && affordableExtra > 0 && (
            <p className="mt-1.5 text-[12px] text-muted">
              You can afford about {formatCurrency(affordableExtra, { currency })}/mo extra based on your leftover.
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-chip p-3">
            <p className="text-[11px] text-muted">Interest saved</p>
            <p data-numeric className="mt-0.5 text-lg font-extrabold tracking-tight">{formatCurrency(savings.interestSaved, { currency })}</p>
          </div>
          <div className="rounded-lg bg-chip p-3">
            <p className="text-[11px] text-muted">Debt free in</p>
            <p data-numeric className="mt-0.5 text-lg font-extrabold tracking-tight">{monthsToDuration(savings.optimizedPayoffMonths)}</p>
            <p className="text-[10px] text-[var(--c3)]">{savings.monthsSooner} mo sooner</p>
          </div>
          <div className="rounded-lg bg-chip p-3">
            <p className="text-[11px] text-muted">Total monthly</p>
            <p data-numeric className="mt-0.5 text-lg font-extrabold tracking-tight">{formatCurrency(totalMonthly, { currency })}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-chip/60 text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Account</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
                <th className="px-3 py-2 text-right font-semibold">APR</th>
                <th className="px-3 py-2 text-right font-semibold">Minimum</th>
                <th className="px-3 py-2 text-right font-semibold">+ Extra</th>
                <th className="px-3 py-2 text-right font-semibold">Monthly</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => {
                const loan = byId.get(r.id);
                const balance = num(loan?.outstanding_balance ?? loan?.principal);
                const apr = num(loan?.interest_rate);
                return (
                  <tr key={r.id} data-testid="scenario-row" className={r.isTarget ? "bg-accent-soft/25" : undefined}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium capitalize">{r.name}</span>
                        {method !== "even" && i === 0 && (
                          <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                            {method === "avalanche" ? "Highest APR" : "Smallest"}
                          </span>
                        )}
                      </span>
                      {r.clears && <span className="text-[10px] font-medium text-[var(--c3)]">Clears this month</span>}
                    </td>
                    <td data-numeric className="px-3 py-2 text-right">{formatCurrency(balance, { currency, compact: true })}</td>
                    <td data-numeric className="px-3 py-2 text-right">{apr ? `${apr}%` : "—"}</td>
                    <td data-numeric className="px-3 py-2 text-right">{formatCurrency(r.minimum, { currency })}</td>
                    <td data-numeric className={"px-3 py-2 text-right font-semibold " + (r.extra > 0 ? "text-accent" : "text-muted")}>
                      {r.extra > 0 ? `+${formatCurrency(r.extra, { currency })}` : "—"}
                    </td>
                    <td data-numeric className="px-3 py-2 text-right font-semibold">{formatCurrency(r.total, { currency })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div data-testid="scenario-timeline">
          <p className="text-xs font-semibold text-muted">Payoff timeline</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {method === "even"
              ? "Every account is funded from month one and clears in this order:"
              : "The extra hits one account at a time; as each clears, it rolls to the next:"}
          </p>
          <ol className="mt-2.5 space-y-2">
            {timeline.map((t, i) => (
              <li key={t.id} data-testid="timeline-row" className="flex items-center gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium capitalize">{t.name}</p>
                  <p className="text-[10px] text-muted">
                    {t.extraStartMonth > 0
                      ? method === "even"
                        ? "Funded from month 1"
                        : `Extra starts ${monthsToLabel(t.extraStartMonth - 1)}`
                      : "Minimum only"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-semibold">{t.clearMonth > 0 ? monthsToLabel(t.clearMonth) : "—"}</p>
                  <p className="text-[10px] text-muted">{t.clearMonth > 0 ? `in ${monthsToDuration(t.clearMonth)}` : "not in range"}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}
