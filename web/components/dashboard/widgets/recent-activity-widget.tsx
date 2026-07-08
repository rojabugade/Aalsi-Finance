"use client";
import { useMemo } from "react";
import { useTransactions, useCategories } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type Transaction = { id: string; title: string; amount: number; date: string; category: string; currency: string };
type ActivityData = { txns: Transaction[] };

function TransactionRow({ transaction, showDates = true, showCategory = true, showAmount = true, large = false }: { transaction: Transaction; showDates?: boolean; showCategory?: boolean; showAmount?: boolean; large?: boolean }) {
  return (
    <div className={`flex items-center gap-3 border-b border-border ${large ? "py-2" : "py-1.5"} last:border-0`}>
      <div className={`grid shrink-0 place-items-center rounded-lg bg-accent-soft font-bold text-accent ${large ? "size-9 text-[13px]" : "size-8 text-[12px]"}`}>{transaction.title.slice(0, 1).toUpperCase()}</div>
      <div className="min-w-0 flex-1"><p className={`truncate font-semibold ${large ? "text-[14px]" : "text-[13px]"}`}>{transaction.title}</p>{(showDates || showCategory) && <p className={large ? "text-[11px] text-muted" : "text-[10.5px] text-muted"}>{[showDates ? transaction.date : null, showCategory ? transaction.category : null].filter(Boolean).join(" / ")}</p>}</div>
      {showAmount && <span className={`font-bold tabular-nums ${large ? "text-[14px]" : "text-[13px]"} ${transaction.amount >= 0 ? "text-c3" : ""}`}>{formatCurrency(transaction.amount, { signed: true, currency: transaction.currency })}</span>}
    </div>
  );
}

export const recentActivityContract: WidgetContract<ActivityData> = {
  useData(config) {
    void config;
    const transactions = useTransactions();
    const categories = useCategories();
    const categoryName = useMemo(() => {
      const names = new Map((categories.data ?? []).map((category) => [category.id, category.name]));
      return (id: string | null | undefined) => id ? names.get(id) ?? "" : "";
    }, [categories.data]);
    return queryState(transactions, {
      select: (data): ActivityData => ({ txns: (data ?? []).map((transaction) => ({ id: transaction.id, title: transaction.merchant ?? "Transaction", amount: Number(transaction.amount ?? 0), date: new Date(`${transaction.txn_date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }), category: categoryName(transaction.category_id), currency: transaction.currency })) }),
      isEmpty: (data) => data.txns.length === 0,
    });
  },
  deriveInsights(data) {
    return [{ label: `${data.txns.length} recent`, tone: "neutral", severity: 2 }];
  },
  Body({ data, config, density, h }) {
    if (density === 0) return <CompactStat label="Activity" value={String(data.txns.length)} hint="transactions" />;
    const count = Math.max(1, Math.min(data.txns.length, Math.round(Number(config.count ?? (h >= 2 ? 5 : 3)))));
    return <div className="flex h-full flex-col gap-1 overflow-hidden">{data.txns.slice(0, count).map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} showDates={config.show?.dates ?? false} showCategory={config.show?.category ?? true} showAmount={config.show?.amount ?? true} />)}</div>;
  },
  Focus({ data }) {
    return <div className="flex flex-col gap-1">{data.txns.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} large />)}</div>;
  },
  emptyHint: "No transactions yet.",
};
