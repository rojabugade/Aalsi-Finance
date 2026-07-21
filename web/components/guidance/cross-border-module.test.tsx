import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transfers: {
    data: [] as Array<Record<string, unknown>>,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  create: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock("@/lib/api/guidance", () => ({
  useTransfers: () => state.transfers,
  useCreateTransfer: () => state.create,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CrossBorderModule } from "./cross-border-module";

afterEach(() => {
  state.transfers.data = [];
  state.transfers.isLoading = false;
  state.transfers.isError = false;
  state.transfers.refetch.mockReset();
  state.create.mutateAsync.mockReset();
  state.create.isPending = false;
});

describe("CrossBorderModule", () => {
  it("offers a retry when transfers fail", () => {
    state.transfers.isError = true;
    render(<CrossBorderModule />);

    fireEvent.click(screen.getByRole("button", { name: "Retry transfers" }));

    expect(state.transfers.refetch).toHaveBeenCalledTimes(1);
  });

  it("submits the database direction values", async () => {
    state.create.mutateAsync.mockResolvedValueOnce({});
    render(<CrossBorderModule />);

    fireEvent.click(screen.getByRole("button", { name: "Log transfer" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10" } });
    fireEvent.submit(screen.getByLabelText("Amount").closest("form")!);

    await waitFor(() => {
      expect(state.create.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ direction: "out" }));
    });
  });
});
