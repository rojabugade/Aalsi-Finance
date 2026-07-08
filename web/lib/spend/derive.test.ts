import { describe, expect, it } from "vitest";
import type { Category, Transaction } from "@/lib/api/transactions";
import {
  categoryRowsWithDeltas,
  largestPurchase,
  merchantRowsWithDeltas,
  rangeSpend,
  spendSeries,
} from "./derive";
import { enumerateBuckets } from "./period";

const cats: Category[] = [
  { id: "food", name: "Food", parent_id: null },
  { id: "groceries", name: "Groceries", parent_id: "food" },
  { id: "income", name: "Income", parent_id: null },
] as unknown as Category[];

function txn(p: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    merchant: "Store",
    amount: "-10",
    currency: "USD",
    status: "confirmed",
    category_id: "groceries",
    txn_date: "2026-06-10",
    line_items: [],
    notes: null,
    ...p,
  } as unknown as Transaction;
}

describe("rangeSpend", () => {
  it("sums spend inside the inclusive range and ignores income/inflows", () => {
    const txns = [
      txn({ amount: "-10", txn_date: "2026-06-01" }),
      txn({ amount: "-15", txn_date: "2026-06-30" }),
      txn({ amount: "-99", txn_date: "2026-07-01" }), // out of range
      txn({ amount: "500", txn_date: "2026-06-15", category_id: "income" }), // income
    ];
    expect(rangeSpend(txns, cats, "2026-06-01", "2026-06-30")).toBe(25);
  });
});

describe("spendAmount flags", () => {
  it("ignores transfer legs entirely", () => {
    const txns = [txn({ amount: "-250", flags: { transfer: true } as never })];
    expect(rangeSpend(txns, cats, "2026-06-01", "2026-06-30")).toBe(0);
  });

  it("nets refunds against spend", () => {
    const txns = [txn({ amount: "-89.99" }), txn({ amount: "89.99", flags: { refund: true } as never })];
    expect(rangeSpend(txns, cats, "2026-06-01", "2026-06-30")).toBeCloseTo(0);
  });

  it("still ignores plain inflows", () => {
    expect(rangeSpend([txn({ amount: "500" })], cats, "2026-06-01", "2026-06-30")).toBe(0);
  });
});

describe("merchantRowsWithDeltas — case-insensitive merge (bug fix)", () => {
  it("collapses different casings of the same merchant into one summed row", () => {
    const txns = [
      txn({ merchant: "Amazon", amount: "-10" }),
      txn({ merchant: "amazon", amount: "-20" }),
      txn({ merchant: "AMAZON", amount: "-30" }),
    ];
    const rows = merchantRowsWithDeltas(txns, cats, "2026-06-01", "2026-06-30", null, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(60);
    expect(rows[0].count).toBe(3);
    // display name preserves a real casing, not lowercased
    expect(rows[0].name).toBe("Amazon");
  });
});

describe("categoryRowsWithDeltas", () => {
  it("rolls children into the parent and computes MoM delta", () => {
    const txns = [
      txn({ amount: "-40", txn_date: "2026-06-05", category_id: "groceries" }),
      txn({ amount: "-20", txn_date: "2026-05-05", category_id: "groceries" }),
    ];
    const rows = categoryRowsWithDeltas(txns, cats, "2026-06-01", "2026-06-30", "2026-05-01", "2026-05-31");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("food");
    expect(rows[0].total).toBe(40);
    expect(rows[0].prev).toBe(20);
    expect(rows[0].deltaPct).toBe(100);
  });

  it("yields a null delta when there is no comparison window", () => {
    const txns = [txn({ amount: "-40", txn_date: "2026-06-05" })];
    const rows = categoryRowsWithDeltas(txns, cats, "2026-06-01", "2026-06-30", null, null);
    expect(rows[0].deltaPct).toBeNull();
  });
});

describe("spendSeries", () => {
  it("aligns spend totals to the supplied buckets", () => {
    const buckets = enumerateBuckets("2026-06-01", "2026-06-03", "day");
    const txns = [
      txn({ amount: "-10", txn_date: "2026-06-01" }),
      txn({ amount: "-5", txn_date: "2026-06-01" }),
      txn({ amount: "-7", txn_date: "2026-06-03" }),
    ];
    const series = spendSeries(txns, cats, buckets, "2026-06-01", "day");
    expect(series.map((s) => s.value)).toEqual([15, 0, 7]);
  });
});

describe("largestPurchase", () => {
  it("returns the single biggest expense in range", () => {
    const txns = [
      txn({ amount: "-10", txn_date: "2026-06-01" }),
      txn({ amount: "-80", txn_date: "2026-06-02", merchant: "Big" }),
    ];
    expect(largestPurchase(txns, cats, "2026-06-01", "2026-06-30")?.merchant).toBe("Big");
  });
});
