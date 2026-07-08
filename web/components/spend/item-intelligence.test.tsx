import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Category, Transaction } from "@/lib/api/transactions";
import { ItemIntelligence } from "./item-intelligence";

const cats = [
  { id: "food", name: "Food", parent_id: null },
  { id: "grocery", name: "Grocery", parent_id: "food" },
] as unknown as Category[];

function txn(over: Partial<Transaction>): Transaction {
  return {
    id: "t1",
    merchant: "Market",
    amount: "-20",
    currency: "USD",
    status: "confirmed",
    category_id: "grocery",
    txn_date: "2026-07-05",
    line_items: [],
    ...over,
  } as unknown as Transaction;
}

describe("ItemIntelligence", () => {
  it("aggregates period-scoped line items from spend transactions", () => {
    render(
      <ItemIntelligence
        cats={cats}
        currency="USD"
        from="2026-07-01"
        to="2026-07-31"
        txns={[
          txn({ line_items: [{ name: "Milk", amount: "4.50", quantity: "2" }] as never }),
          txn({ id: "t2", merchant: "Other Market", line_items: [{ name: "Milk", amount: "5.50", quantity: "1" }] as never }),
          txn({ id: "t3", amount: "99", line_items: [{ name: "Ignored inflow", amount: "99" }] as never }),
        ]}
      />,
    );

    expect(screen.getByText("Milk")).toBeInTheDocument();
    expect(screen.getByText(/\$10\.00/)).toBeInTheDocument();
    expect(screen.getByText(/3 qty/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ignored inflow/i)).not.toBeInTheDocument();
  });

  it("renders a capture-oriented empty state when there are no line items", () => {
    render(<ItemIntelligence cats={cats} currency="USD" from="2026-07-01" to="2026-07-31" txns={[txn({})]} />);
    expect(screen.getByText(/Capture or import receipts/i)).toBeInTheDocument();
  });
});
