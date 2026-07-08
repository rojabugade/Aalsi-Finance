import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransactionDetailBody } from "./transaction-detail";

const txn = { id: "t1", merchant: "Costco", amount: -42, txn_date: "2026-06-10", currency: "USD", status: "confirmed", category_id: null, line_items: [] } as any;

it("renders the editor body without a dialog", () => {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <TransactionDetailBody txn={txn} categories={[]} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(screen.getByDisplayValue("Costco")).toBeInTheDocument();
});
