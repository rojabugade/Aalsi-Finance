import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn(async (_body: unknown) => ({ id: "t1" }));
vi.mock("@/lib/api/transactions", () => ({
  useCreateTransaction: () => ({ mutateAsync, isPending: false }),
  useCategories: () => ({ data: [{ id: "c1", name: "Dining" }] }),
}));
vi.mock("@/lib/api/widget-data", () => ({
  usePaymentMethods: () => ({ data: [{ id: "p1", name: "Visa" }] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ManualTransactionEntry } from "./manual-transaction-entry";

afterEach(() => mutateAsync.mockClear());

describe("ManualTransactionEntry", () => {
  it("submits a draft transaction with amount, currency and date", async () => {
    render(<ManualTransactionEntry />);
    fireEvent.click(screen.getByRole("button", { name: /enter manually/i }));
    fireEvent.change(screen.getByLabelText(/merchant/i), { target: { value: "Cafe" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "4.50" } });
    fireEvent.change(screen.getByLabelText(/^date\b/i), { target: { value: "2026-06-22" } });
    fireEvent.submit(screen.getByTestId("manual-tx-form"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const body = mutateAsync.mock.calls[0][0];
    expect(body).toMatchObject({
      merchant: "Cafe", amount: "4.50", txn_date: "2026-06-22",
      currency: "USD", source_channel: "manual", status: "draft",
    });
  });
});
