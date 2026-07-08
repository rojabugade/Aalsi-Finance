"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useCategories, useCreateTransaction, useTransactions, type Category, type Transaction } from "@/lib/api/transactions";
import { useRecurringSeries } from "@/lib/api/widget-data";
import { formatCurrency } from "@/lib/format";
import {
  categoryRowsWithDeltas,
  merchantRowsWithDeltas,
  spendAmount,
  topProductsForMerchant,
  type MerchantRow,
} from "@/lib/spend/derive";
import { inRange, ymd } from "@/lib/spend/period";
import styles from "@/components/roja/roja.module.css";

type Tab = "transactions" | "merchants" | "items" | "recurring";

const TABS: { id: Tab; label: string }[] = [
  { id: "transactions", label: "Transactions" },
  { id: "merchants", label: "Merchants" },
  { id: "items", label: "Items" },
  { id: "recurring", label: "Recurring" },
];

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

export function RojaSpend() {
  const [tab, setTab] = useState<Tab>("transactions");
  const txns = useTransactions();
  const cats = useCategories();
  const allTxns = txns.data ?? [];
  const allCats = cats.data ?? [];
  const currency = allTxns[0]?.currency ?? "USD";
  const from = daysAgo(30);
  const to = ymd(new Date());
  const byId = useMemo(() => new Map(allCats.map((c) => [c.id, c])), [allCats]);
  const recent = useMemo(
    () => allTxns
      .filter((t) => inRange(t.txn_date, from, to))
      .sort((a, b) => b.txn_date.localeCompare(a.txn_date))
      .slice(0, 50),
    [allTxns, from, to],
  );
  const spend = recent.reduce((sum, t) => sum + spendAmount(t, byId), 0);

  return (
    <div className={styles.roja} data-testid="roja-spend">
      <div className={styles.topLine}>
        <div className={styles.tabs} role="tablist" aria-label="Spend tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <RojaQuickAdd categories={allCats} defaultCurrency={currency} />

      <section className={styles.pageStack}>
        <SectionIntro title="Expense and merchant intelligence" text="Track fixed costs, variable spending, merchants, item types, and recurring patterns from statements and receipts." />
        <div className={styles.dashboardGrid}>
          {tab === "transactions" && (
            <>
              <article className={`${styles.card} ${styles.budgetCard}`}>
                <CardHeader label="Categories" />
                <CategoryList txns={allTxns} cats={allCats} from={from} to={to} currency={currency} />
              </article>
              <article className={`${styles.card} ${styles.wideCard}`}>
                <CardHeader label="Transactions" />
                <div className={styles.muted}>Last 30 days · {formatCurrency(spend, { currency })}</div>
                <TransactionTable transactions={recent} />
              </article>
            </>
          )}
          {tab === "merchants" && (
            <article className={`${styles.card} ${styles.wideCard}`}>
              <CardHeader label="Merchant intelligence" />
              <MerchantCard txns={allTxns} cats={allCats} from={from} to={to} currency={currency} />
            </article>
          )}
          {tab === "items" && (
            <article className={`${styles.card} ${styles.wideCard}`}>
              <CardHeader label="Item and product-type intelligence" />
              <ItemIntelligence txns={allTxns} cats={allCats} from={from} to={to} currency={currency} />
            </article>
          )}
          {tab === "recurring" && (
            <article className={`${styles.card} ${styles.wideCard}`}>
              <CardHeader label="Recurring and fixed expenses" />
              <RecurringIntelligence txns={allTxns} cats={allCats} currency={currency} />
            </article>
          )}
        </div>
      </section>
    </div>
  );
}

function RojaQuickAdd({ categories, defaultCurrency }: { categories: Category[]; defaultCurrency: string }) {
  const create = useCreateTransaction();
  const [form, setForm] = useState({
    amount: "",
    merchant: "",
    categoryId: "",
    currency: defaultCurrency || "USD",
  });

  async function submitTransaction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    try {
      await create.mutateAsync({
        amount: (-Math.abs(amount)).toFixed(2),
        merchant: form.merchant.trim() || null,
        category_id: form.categoryId || null,
        currency: form.currency || "USD",
        txn_date: ymd(new Date()),
        source_channel: "manual",
        status: "draft",
        is_shared: false,
      });
      toast.success("Transaction added");
      setForm((prev) => ({ ...prev, amount: "", merchant: "" }));
    } catch {
      toast.error("Could not save transaction");
    }
  }

  return (
    <form className={styles.quickAdd} onSubmit={submitTransaction} data-testid="roja-quick-add">
      <button className={styles.primaryButton} type="submit">{create.isPending ? "Saving" : "Log"}</button>
      <input required type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="Amount" />
      <input required value={form.merchant} onChange={(event) => setForm({ ...form, merchant: event.target.value })} placeholder="Merchant" />
      <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
        <option value="">Category</option>
        {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
      </select>
      <select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>
        <option>USD</option>
        <option>INR</option>
      </select>
    </form>
  );
}

function MerchantCard({
  txns,
  cats,
  from,
  to,
  currency,
}: {
  txns: Transaction[];
  cats: Category[];
  from: string;
  to: string;
  currency: string;
}) {
  const [query, setQuery] = useState("");
  const merchants = useMemo(() => merchantRowsWithDeltas(txns, cats, from, to, null, null), [txns, cats, from, to]);
  const filteredMerchants = merchants.filter((merchant) =>
    merchant.name.toLowerCase().includes(query.trim().toLowerCase()) ||
    (merchant.topCategory ?? "").toLowerCase().includes(query.trim().toLowerCase()),
  );
  const activeMerchant = filteredMerchants[0]?.name || merchants[0]?.name || "Merchant";
  const merchantTransactions = txns.filter((transaction) =>
    (transaction.merchant ?? "Unknown").toLowerCase() === activeMerchant.toLowerCase() &&
    inRange(transaction.txn_date, from, to),
  );
  const merchantRow = merchants.find((merchant) => merchant.name === activeMerchant);
  const averageSpend = merchantRow?.count ? (merchantRow.total / merchantRow.count) : 0;
  const categoryRows = categoryRowsForMerchant(merchantTransactions, cats);
  const itemRows = topProductsForMerchant(txns, activeMerchant, from, to);

  return (
    <div className={styles.merchantLayout}>
      <div>
        <h2>Merchants</h2>
        <div className={styles.merchantSearch}>
          <input aria-label="Search merchants" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find merchant..." type="search" />
        </div>
        <div className={styles.merchantList}>
          {filteredMerchants.map((merchant) => (
            <button className={activeMerchant === merchant.name ? styles.activeMerchant : ""} type="button" key={merchant.name}>
              <span><b>{merchant.name}</b><small>{merchant.topCategory ?? "Uncategorized"} - {merchant.count}x</small></span>
              <strong>{formatCurrency(merchant.total, { currency })}</strong>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className={styles.merchantSummaryHero}>
          <span>{activeMerchant.slice(0, 2)}</span>
          <div><h2>{activeMerchant}</h2><p>{merchantTransactions.length} purchase{merchantTransactions.length === 1 ? "" : "s"} - average {formatCurrency(averageSpend, { currency })}</p></div>
          <strong>{formatCurrency(merchantRow?.total ?? 0, { currency })}</strong>
        </div>
        <div className={styles.merchantDetailGrid}>
          <section><h3>Spending by category</h3><SimpleRows rows={categoryRows.length > 0 ? categoryRows : [["No categories", "No spending found"]]} /></section>
          <section><h3>Top products</h3><SimpleRows rows={itemRows.length > 0 ? itemRows.map((item) => [item.name, `${formatCurrency(item.total, { currency })}${item.qty > 1 ? ` - ${item.qty}x` : ""}`]) : [["No item lines", "Upload receipt text or image OCR to split products"]]} /></section>
        </div>
        <h3>Transactions</h3>
        <TransactionTable transactions={merchantTransactions} />
      </div>
    </div>
  );
}

function ItemIntelligence({ txns, cats, from, to, currency }: { txns: Transaction[]; cats: Category[]; from: string; to: string; currency: string }) {
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const items = useMemo(() => {
    const rows = new Map<string, { total: number; merchant: string }>();
    for (const txn of txns) {
      if (!inRange(txn.txn_date, from, to) || spendAmount(txn, byId) <= 0) continue;
      for (const item of txn.line_items ?? []) {
        const name = item.name?.trim() || "Item";
        const row = rows.get(name) ?? { total: 0, merchant: txn.merchant ?? "Unknown" };
        row.total += Math.abs(Number(item.amount));
        rows.set(name, row);
      }
    }
    return [...rows.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [txns, byId, from, to]);

  return (
    <>
      <h2>What you bought</h2>
      <p>Item-level views use receipt lines, merchant metadata, or manual transaction detail when available.</p>
      <SimpleRows rows={items.length > 0 ? items.map(([item, row]) => [item, `${formatCurrency(row.total, { currency })} at ${row.merchant}`]) : [["No items yet", "Upload receipts to detect product types"]]} />
    </>
  );
}

function RecurringIntelligence({ txns, cats, currency }: { txns: Transaction[]; cats: Category[]; currency: string }) {
  const series = useRecurringSeries("active");
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const heuristicRows = useMemo(() => {
    const months = new Map<string, Set<string>>();
    const totals = new Map<string, number>();
    for (const txn of txns) {
      const merchant = txn.merchant?.trim();
      if (!merchant || spendAmount(txn, byId) <= 0) continue;
      const key = merchant.toLowerCase();
      if (!months.has(key)) months.set(key, new Set());
      months.get(key)!.add(txn.txn_date.slice(0, 7));
      totals.set(key, (totals.get(key) ?? 0) + spendAmount(txn, byId));
    }
    return [...months.entries()]
      .filter(([, seen]) => seen.size >= 3)
      .map(([merchant, seen]) => [merchant, `${formatCurrency((totals.get(merchant) ?? 0) / Math.max(1, seen.size), { currency })} monthly pattern`]);
  }, [txns, byId, currency]);
  const rows = (series.data ?? []).length > 0
    ? (series.data ?? []).map((row) => [row.name, `${formatCurrency(Number(row.amount ?? 0), { currency: row.currency })} ${row.cadence}${row.next_due_date ? ` - due ${row.next_due_date}` : ""}`])
    : heuristicRows;

  return (
    <>
      <h2>Fixed expenses and recurring obligations</h2>
      <p>Recurring detection separates predictable commitments from flexible spending.</p>
      <SimpleRows rows={rows.length > 0 ? rows : [["No recurring payments detected", "Upload statements to find subscriptions and bills"]]} />
    </>
  );
}

function CategoryList({ txns, cats, from, to, currency }: { txns: Transaction[]; cats: Category[]; from: string; to: string; currency: string }) {
  const rows = categoryRowsWithDeltas(txns, cats, from, to, null, null);
  return <SimpleRows rows={rows.length > 0 ? rows.map((row) => [row.name, formatCurrency(row.total, { currency })]) : [["No categories", "No spending this period"]]} />;
}

function TransactionTable({ transactions }: { transactions: Transaction[] }) {
  return (
    <div className={styles.tableList}>
      {transactions.length === 0 ? <p className={styles.empty}>No transactions in this period.</p> : transactions.map((transaction) => (
        <div className={styles.tableRow} key={transaction.id}>
          <span>{transaction.txn_date}</span>
          <b>{transaction.merchant ?? "Unknown"}</b>
          <span>{transaction.status}</span>
          <strong>{formatCurrency(Math.abs(Number(transaction.amount)), { currency: transaction.currency })}</strong>
        </div>
      ))}
    </div>
  );
}

function CardHeader({ label }: { label: string }) {
  return (
    <div className={styles.cardHeader}>
      <span>{label}</span>
      <button type="button" aria-label={`${label} options`}>...</button>
    </div>
  );
}

function SimpleRows({ rows }: { rows: string[][] }) {
  return (
    <div className={styles.simpleRows}>
      {rows.map(([label, value]) => (
        <div className={styles.simpleRow} key={`${label}-${value}`}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function SectionIntro({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.sectionIntro}>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function categoryRowsForMerchant(txns: Transaction[], cats: Category[]) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const rows = new Map<string, number>();
  for (const txn of txns) {
    const cat = txn.category_id ? byId.get(txn.category_id) : null;
    const name = cat?.name ?? "Uncategorized";
    rows.set(name, (rows.get(name) ?? 0) + Math.abs(Number(txn.amount)));
  }
  return [...rows.entries()].sort((a, b) => b[1] - a[1]).map(([name, total]) => [name, formatCurrency(total, { currency: txns[0]?.currency ?? "USD" })]);
}
