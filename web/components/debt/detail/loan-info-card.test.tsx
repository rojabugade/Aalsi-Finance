import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoanInfoCard } from "./loan-info-card";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "l1", name: "Car Loan", type: "auto", schedule_kind: "amortizing", compounding: "monthly",
  principal: 5000, currency: "USD", interest_rate: 9, min_or_emi_amount: 50, due_day: 21,
  start_date: "2025-06-21", end_date: "2026-06-21",
} as unknown as Loan;

describe("LoanInfoCard", () => {
  it("shows real loan-detail rows and the human type label", () => {
    render(<LoanInfoCard loan={loan} onEdit={vi.fn()} />);
    expect(screen.getByText(/Loan details/i)).toBeInTheDocument();
    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText("9%")).toBeInTheDocument();
  });
  it("fires onEdit when Edit details is clicked", () => {
    const onEdit = vi.fn();
    render(<LoanInfoCard loan={loan} onEdit={onEdit} />);
    screen.getByRole("button", { name: /Edit details/i }).click();
    expect(onEdit).toHaveBeenCalled();
  });
});
