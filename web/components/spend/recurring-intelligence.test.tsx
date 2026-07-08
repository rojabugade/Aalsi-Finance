import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Category, Transaction } from "@/lib/api/transactions";

const recurringData = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/lib/api/widget-data", () => ({
  useRecurringSeries: () => ({ data: recurringData.rows, isLoading: false }),
}));

import { RecurringIntelligence } from "./recurring-intelligence";

const cats = [{ id: "food", name: "Food", parent_id: null }] as unknown as Category[];

function txn(over: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36),
    merchant: "Gym",
    amount: "-50",
    currency: "USD",
    status: "confirmed",
    category_id: "food",
    txn_date: "2026-07-05",
    line_items: [],
    ...over,
  } as unknown as Transaction;
}

describe("RecurringIntelligence", () => {
  it("prefers canonical recurring series", () => {
    recurringData.rows = [{
      id: "r1",
      name: "Netflix",
      amount: "15",
      currency: "USD",
      cadence: "monthly",
      type: "subscription",
      status: "active",
      next_due_date: "2026-07-20",
      merchant_name: "Netflix",
    }];

    render(<RecurringIntelligence txns={[]} cats={cats} currency="USD" onMerchant={vi.fn()} />);

    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText(/Canonical recurring series/i)).toBeInTheDocument();
  });

  it("falls back to recurring merchant cadence when canonical rows are empty", () => {
    recurringData.rows = [];

    render(
      <RecurringIntelligence
        cats={cats}
        currency="USD"
        onMerchant={vi.fn()}
        txns={[
          txn({ txn_date: "2026-05-01" }),
          txn({ txn_date: "2026-06-01" }),
          txn({ txn_date: "2026-07-01" }),
        ]}
      />,
    );

    expect(screen.getByText("gym")).toBeInTheDocument();
    expect(screen.getByText(/Detected from merchant cadence/i)).toBeInTheDocument();
  });
});
