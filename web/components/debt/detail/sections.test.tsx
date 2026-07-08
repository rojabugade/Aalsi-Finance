import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/loans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/loans")>("@/lib/api/loans");
  return {
    ...actual,
    useLoanSchedule: () => ({ data: [], isLoading: false }),
    useLoanPayments: () => ({ data: { items: [], total: 0 }, isLoading: false }),
    usePayoffCalc: () => ({ mutate: vi.fn(), isPending: false }),
    useCreatePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeletePayment: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

import { HeaderStats, Metric } from "./sections";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "card", name: "Card", type: "credit_card", currency: "USD",
  principal: 10000, outstanding_balance: 8000, total_paid: 2000, total_interest_paid: 500,
  next_due_date: "2024-06-01",
} as unknown as Loan;

describe("detail sections", () => {
  it("HeaderStats renders the key metrics", () => {
    render(<HeaderStats loan={loan} onEdit={() => {}} />);
    expect(screen.getByText(/Outstanding/i)).toBeInTheDocument();
    expect(screen.getByText(/8,000/)).toBeInTheDocument();
  });
  it("Metric renders label and value", () => {
    render(<Metric label="Months" value="42" />);
    expect(screen.getByText("Months")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
