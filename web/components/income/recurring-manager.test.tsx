import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecurringManager } from "./recurring-manager";

vi.mock("@/lib/api/widget-data", () => ({
  useRecurringSeries: () => ({
    data: [
      {
        id: "1",
        name: "Netflix",
        amount: "15.99",
        cadence: "monthly",
        type: "subscription",
        next_due_date: "2026-07-01",
      },
    ],
    isLoading: false,
    isError: false,
  }),
  useCreateRecurringSeries: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRecurringSeries: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("RecurringManager", () => {
  it("lists existing recurring series and shows an add control", () => {
    render(<RecurringManager />);
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add recurring/i })).toBeInTheDocument();
  });
});
