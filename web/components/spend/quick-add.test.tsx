import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn(async (_body: unknown) => ({ id: "t1" }));

vi.mock("@/lib/api/transactions", () => ({
  useCreateTransaction: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { QuickAdd } from "./quick-add";

afterEach(() => mutateAsync.mockClear());

describe("QuickAdd", () => {
  it("submits user-entered expenses as negative draft outflows", async () => {
    render(<QuickAdd categories={[{ id: "food", name: "Food" } as never]} defaultCurrency="USD" />);

    fireEvent.change(screen.getByLabelText(/merchant/i), { target: { value: "Cafe" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "12.34" } });
    fireEvent.change(screen.getByLabelText(/^date\b/i), { target: { value: "2026-07-08" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "food" } });
    fireEvent.submit(screen.getByTestId("spend-quick-add"));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      merchant: "Cafe",
      amount: "-12.34",
      currency: "USD",
      txn_date: "2026-07-08",
      category_id: "food",
      source_channel: "manual",
      status: "draft",
    });
  });

  it("keeps input local and shows an error for non-positive amounts", () => {
    render(<QuickAdd categories={[]} defaultCurrency="USD" />);
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "0" } });
    fireEvent.submit(screen.getByTestId("spend-quick-add"));
    expect(screen.getByRole("alert")).toHaveTextContent(/positive expense/i);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
