"use client";
import { Repeat } from "lucide-react";
import { useRecurringSeries, type RecurringSeries } from "@/lib/api/widget-data";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract, type Insight } from "@/lib/dashboard/widget-contract";

const CADENCE_FACTOR: Record<string, number> = {
  weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, annual: 1 / 12, irregular: 0,
};

export function monthlyFromCadence(amount: number, cadence: string): number {
  return amount * (CADENCE_FACTOR[cadence] ?? 0);
}

export type RecurringVM = {
  items: { id: string; name: string; amount: number; cadence: string; monthly: number; nextDue: string | null; type: string; merchant: string | null; currency: string }[];
  totalMonthly: number;
  currency: string;
  nextUp: { name: string; nextDue: string } | null;
};

export function recurringVM(series: RecurringSeries[]): RecurringVM {
  const items = series.map((s) => {
    const amount = Number(s.amount ?? 0);
    return {
      id: s.id, name: s.name, amount, cadence: s.cadence,
      monthly: monthlyFromCadence(amount, s.cadence),
      nextDue: s.next_due_date ?? null, type: s.type, merchant: s.merchant_name ?? null,
      currency: s.currency,
    };
  }).sort((a, b) => (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999"));
  const withDue = items.filter((i) => i.nextDue);
  const currency = items[0]?.currency ?? "USD";
  return {
    items,
    totalMonthly: items.reduce((s, i) => s + i.monthly, 0),
    currency,
    nextUp: withDue[0] ? { name: withDue[0].name, nextDue: withDue[0].nextDue! } : null,
  };
}

export const recurringContract: WidgetContract<RecurringVM> = {
  useData() {
    const q = useRecurringSeries("active");
    return queryState(q, {
      select: recurringVM,
      isEmpty: (vm) => vm.items.length === 0,
    });
  },
  deriveInsights(vm) {
    const chips: Insight[] = [];
    if (vm.nextUp) chips.push({ label: `Next: ${vm.nextUp.name} ${vm.nextUp.nextDue}`, tone: "neutral", severity: 5 });
    if (vm.totalMonthly > 0) chips.push({ label: `${formatCurrency(vm.totalMonthly, { currency: vm.currency })}/mo`, tone: "neutral", severity: 3 });
    return chips;
  },
  Body({ data, density, config }) {
    if (density === 0)
      return <CompactStat icon={Repeat} label="Recurring" value={`${formatCurrency(data.totalMonthly, { compact: true, currency: data.currency })}/mo`}
        hint={data.nextUp ? `Next ${data.nextUp.name}` : undefined} />;
    const showBills = config.show?.bills ?? true;
    const showSubs = config.show?.subscriptions ?? true;
    const filtered = data.items.filter((i) =>
      (i.type === "bill" ? showBills : true) && (i.type === "subscription" ? showSubs : true));
    const fallbackLimit = density >= 3 ? filtered.length : Math.min(5, filtered.length);
    const limit = Math.max(1, Math.min(filtered.length, Math.round(Number(config.count ?? fallbackLimit))));
    const rows = filtered.slice(0, limit);
    const showAmounts = config.show?.amounts ?? true;
    return (
      <div className="flex h-full flex-col">
        <p className="text-2xl font-extrabold tabular-nums tracking-tight">{formatCurrency(data.totalMonthly, { currency: data.currency })}<span className="text-sm font-semibold text-muted">/mo</span></p>
        <div className="mt-2 flex-1 space-y-1 overflow-hidden">
          {rows.map((i) => (
            <div key={i.id} className="flex justify-between gap-2 text-[12.5px]">
              <span className="truncate text-muted">{i.name}{i.nextDue ? ` · ${i.nextDue}` : ""}</span>
              {showAmounts && <span className="shrink-0 tabular-nums">{formatCurrency(i.amount, { currency: i.currency })}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  },
  Focus({ data }) {
    const groups = ["subscription", "bill", "income", "transfer", "other"].map((type) => ({
      type, rows: data.items.filter((i) => i.type === type),
    })).filter((g) => g.rows.length > 0);
    return (
      <div className="space-y-3">
        <p className="text-3xl font-extrabold tabular-nums">{formatCurrency(data.totalMonthly, { currency: data.currency })}<span className="text-base font-semibold text-muted">/mo</span></p>
        {groups.map((g) => (
          <div key={g.type}>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">{g.type}</p>
            <div className="space-y-1">
              {g.rows.map((i) => (
                <div key={i.id} className="flex justify-between rounded-lg bg-chip px-3 py-1.5 text-[12.5px]">
                  <span className="truncate">{i.name}<span className="text-muted"> · {i.cadence}</span></span>
                  <span className="tabular-nums">{formatCurrency(i.amount, { currency: i.currency })}{i.nextDue ? ` · ${i.nextDue}` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  },
  emptyHint: "No recurring payments detected yet. Upload a statement and I'll start finding patterns.",
};
