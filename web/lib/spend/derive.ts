import type { Category, Transaction } from "@/lib/api/transactions";
import { bucketKeyForDate, inRange, type Bucket, type Granularity } from "./period";

export type CatRow = {
  id: string;
  name: string;
  total: number;
  prev: number;
  deltaPct: number | null; // null when prev == 0 or no comparison window
};

// In this data money OUT is stored as a negative amount and income as positive;
// income/transfers also live under their own top-level category trees. So a
// transaction is "spend" when its amount is negative AND its top-level category
// isn't income/transfer. We surface spend as a positive magnitude everywhere.
const NON_SPEND_PARENTS = new Set(["income", "transfers"]);

/** Resolve a transaction to its top-level (parent) category id+name. */
function topCategory(t: Transaction, byId: Map<string, Category>) {
  const cat = t.category_id ? byId.get(t.category_id) : undefined;
  if (!cat) return { id: "__uncategorized__", name: "Uncategorized" };
  if (cat.parent_id && byId.has(cat.parent_id)) {
    const p = byId.get(cat.parent_id)!;
    return { id: p.id, name: p.name };
  }
  return { id: cat.id, name: cat.name };
}

/**
 * Spend contribution of a transaction: positive magnitude for outflows,
 * negative for refund inflows (they net their category down), 0 when it
 * isn't spend at all (transfer legs, plain inflows, income/transfer trees).
 */
export function spendAmount(t: Transaction, byId: Map<string, Category>): number {
  const a = Number(t.amount);
  const flags = (t.flags ?? {}) as Record<string, unknown>;
  if (flags.transfer) return 0; // loan/CC payment legs are money movement, not spend
  if (a >= 0) return flags.refund ? -a : 0; // refunds net against their category
  if (NON_SPEND_PARENTS.has(topCategory(t, byId).name.toLowerCase())) return 0;
  return -a;
}

/** Positive income magnitude for a transaction (inflow under an income tree). */
export function incomeAmount(t: Transaction, byId: Map<string, Category>): number {
  const a = Number(t.amount);
  if (a <= 0) return 0;
  return topCategory(t, byId).name.toLowerCase() === "income" ? a : 0;
}

/** Total spend (positive) within the inclusive [from,to] range. */
export function rangeSpend(txns: Transaction[], cats: Category[], from: string, to: string): number {
  const byId = new Map(cats.map((c) => [c.id, c]));
  return txns
    .filter((t) => inRange(t.txn_date, from, to))
    .reduce((a, t) => a + spendAmount(t, byId), 0);
}

/** Total income (positive) within the inclusive [from,to] range. */
export function rangeIncome(txns: Transaction[], cats: Category[], from: string, to: string): number {
  const byId = new Map(cats.map((c) => [c.id, c]));
  return txns
    .filter((t) => inRange(t.txn_date, from, to))
    .reduce((a, t) => a + incomeAmount(t, byId), 0);
}

/** Positive spend totals aligned to chart `buckets` (anchored at `from`). */
export function spendSeries(
  txns: Transaction[],
  cats: Category[],
  buckets: Bucket[],
  from: string,
  granularity: Granularity,
): { key: string; label: string; value: number }[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const totals = new Map<string, number>(buckets.map((b) => [b.key, 0]));
  for (const t of txns) {
    const key = bucketKeyForDate(t.txn_date, from, granularity);
    if (!totals.has(key)) continue;
    totals.set(key, (totals.get(key) ?? 0) + spendAmount(t, byId));
  }
  return buckets.map((b) => ({ key: b.key, label: b.label, value: totals.get(b.key) ?? 0 }));
}

/** Parent-category rows for [from,to] with deltas vs the prior window. */
export function categoryRowsWithDeltas(
  txns: Transaction[],
  cats: Category[],
  from: string,
  to: string,
  prevFrom: string | null,
  prevTo: string | null,
): CatRow[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const cur = new Map<string, { name: string; total: number }>();
  const prev = new Map<string, number>();

  for (const t of txns) {
    const spend = spendAmount(t, byId);
    if (spend === 0) continue;
    const { id, name } = topCategory(t, byId);
    if (inRange(t.txn_date, from, to)) {
      const e = cur.get(id) ?? { name, total: 0 };
      e.total += spend;
      cur.set(id, e);
    } else if (prevFrom && prevTo && inRange(t.txn_date, prevFrom, prevTo)) {
      prev.set(id, (prev.get(id) ?? 0) + spend);
    }
  }

  const hasPrev = prevFrom != null && prevTo != null;
  return [...cur.entries()]
    .map(([id, { name, total }]) => {
      const p = prev.get(id) ?? 0;
      return { id, name, total, prev: p, deltaPct: !hasPrev || p === 0 ? null : ((total - p) / p) * 100 };
    })
    .sort((a, b) => b.total - a.total);
}

/** Category with the largest absolute increase vs the prior window. */
export function topMover(rows: CatRow[]): CatRow | null {
  const movers = rows.filter((r) => r.total > r.prev);
  if (movers.length === 0) return null;
  return movers.reduce((a, b) => (b.total - b.prev > a.total - a.prev ? b : a));
}

/** Single largest expense in [from,to] (the "Largest purchase" tile). */
export function largestPurchase(
  txns: Transaction[],
  cats: Category[],
  from: string,
  to: string,
): Transaction | null {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const m = txns.filter((t) => inRange(t.txn_date, from, to) && spendAmount(t, byId) > 0);
  if (m.length === 0) return null;
  return m.reduce((a, b) => (spendAmount(b, byId) > spendAmount(a, byId) ? b : a));
}

// ---- Merchants --------------------------------------------------------------

export type MerchantRow = {
  name: string;
  total: number;
  prev: number;
  deltaPct: number | null;
  count: number;
  topCategory: string | null;
};

/** Canonical merchant key — case-insensitive so "Amazon"/"amazon" don't split. */
const merchantKey = (name: string | null | undefined) => (name?.trim() || "Unknown").toLowerCase();

/** Ranked merchant spend for [from,to] with deltas vs the prior window, visit
 *  counts, and each merchant's dominant category. Merchants are grouped
 *  case-insensitively (display name keeps the most common casing). Derived
 *  client-side from the full ledger so it stays in lock-step with the period
 *  selector and the category numbers. */
export function merchantRowsWithDeltas(
  txns: Transaction[],
  cats: Category[],
  from: string,
  to: string,
  prevFrom: string | null,
  prevTo: string | null,
): MerchantRow[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const cur = new Map<
    string,
    { total: number; count: number; cats: Map<string, number>; names: Map<string, number> }
  >();
  const prev = new Map<string, number>();

  for (const t of txns) {
    const spend = spendAmount(t, byId);
    if (spend === 0) continue;
    const key = merchantKey(t.merchant);
    const display = t.merchant?.trim() || "Unknown";
    if (inRange(t.txn_date, from, to)) {
      const e = cur.get(key) ?? { total: 0, count: 0, cats: new Map(), names: new Map() };
      e.total += spend;
      e.count += 1;
      e.names.set(display, (e.names.get(display) ?? 0) + 1);
      const cn = topCategory(t, byId).name;
      e.cats.set(cn, (e.cats.get(cn) ?? 0) + spend);
      cur.set(key, e);
    } else if (prevFrom && prevTo && inRange(t.txn_date, prevFrom, prevTo)) {
      prev.set(key, (prev.get(key) ?? 0) + spend);
    }
  }

  const hasPrev = prevFrom != null && prevTo != null;
  return [...cur.entries()]
    .map(([key, { total, count, cats: cmap, names }]) => {
      const p = prev.get(key) ?? 0;
      const topCat = [...cmap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
      return { name, total, prev: p, count, topCategory: topCat, deltaPct: !hasPrev || p === 0 ? null : ((total - p) / p) * 100 };
    })
    .sort((a, b) => b.total - a.total);
}

/** Per-merchant positive spend totals aligned to chart `buckets`. */
export function merchantSeries(
  txns: Transaction[],
  cats: Category[],
  merchant: string,
  buckets: Bucket[],
  from: string,
  granularity: Granularity,
): { key: string; label: string; value: number }[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const totals = new Map<string, number>(buckets.map((b) => [b.key, 0]));
  const needle = merchantKey(merchant);
  for (const t of txns) {
    if (merchantKey(t.merchant) !== needle) continue;
    const key = bucketKeyForDate(t.txn_date, from, granularity);
    if (!totals.has(key)) continue;
    totals.set(key, (totals.get(key) ?? 0) + spendAmount(t, byId));
  }
  return buckets.map((b) => ({ key: b.key, label: b.label, value: totals.get(b.key) ?? 0 }));
}

/** Top line-item "products" for a merchant in [from,to] (falls back to empty). */
export function topProductsForMerchant(
  txns: Transaction[],
  merchant: string,
  from: string,
  to: string,
): { name: string; total: number; qty: number }[] {
  const needle = merchantKey(merchant);
  const m = new Map<string, { total: number; qty: number }>();
  for (const t of txns) {
    if (merchantKey(t.merchant) !== needle) continue;
    if (!inRange(t.txn_date, from, to)) continue;
    for (const li of t.line_items ?? []) {
      const key = li.name?.trim() || "Item";
      const e = m.get(key) ?? { total: 0, qty: 0 };
      e.total += Math.abs(Number(li.amount));
      e.qty += Number(li.quantity ?? 1);
      m.set(key, e);
    }
  }
  return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total).slice(0, 6);
}

/**
 * Collapse a sorted row list to the top `n`, rolling the remainder into a single
 * "Other" bucket so a long tail of small categories never overwhelms the view.
 */
export function withOther<T extends { id?: string; name: string; total: number }>(
  rows: T[],
  n: number,
): (T | { id: string; name: string; total: number; isOther: true; count: number })[] {
  if (rows.length <= n + 1) return rows;
  const head = rows.slice(0, n);
  const tail = rows.slice(n);
  const total = tail.reduce((a, r) => a + r.total, 0);
  return [...head, { id: "__other__", name: "Other", total, isOther: true as const, count: tail.length }];
}

/** Plain-language summary for a category drill header. */
export function whatChanged(row: CatRow, subRows: CatRow[]): string {
  if (row.prev === 0) return `New spending this period: ${Math.round(row.total)}.`;
  const diff = row.total - row.prev;
  const dir = diff >= 0 ? "up" : "down";
  const driver = subRows.find(
    (s) => Math.abs(s.total - s.prev) === Math.max(...subRows.map((x) => Math.abs(x.total - x.prev))),
  );
  const driverStr = driver
    ? ` ${driver.name} drove it (${diff >= 0 ? "+" : ""}${Math.round(driver.total - driver.prev)}).`
    : "";
  return `${row.name} is ${dir} ${Math.abs(Math.round(row.deltaPct ?? 0))}% vs the prior period.${driverStr}`;
}
