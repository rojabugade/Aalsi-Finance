import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoanHero, DueStatus } from "./loan-hero";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "l1", name: "Car Loan", type: "auto", currency: "USD",
  principal: 5000, outstanding_balance: 400.4, interest_rate: 9,
  min_or_emi_amount: 50, progress_pct: 8, next_due_date: null,
} as unknown as Loan;

describe("LoanHero", () => {
  it("shows the name, Active pill, and real stat strip", () => {
    render(<LoanHero loan={loan} onPay={vi.fn()} onViewStatements={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /Car Loan/ })).toBeInTheDocument();
    expect(screen.getByText(/Active/)).toBeInTheDocument();
    expect(screen.getByText("9%")).toBeInTheDocument();
    expect(screen.getByText(/\$400\.40/)).toBeInTheDocument();
  });
  it("fires onPay when Make a payment is clicked", async () => {
    const onPay = vi.fn();
    render(<LoanHero loan={loan} onPay={onPay} onViewStatements={vi.fn()} />);
    screen.getByRole("button", { name: /Make a payment/i }).click();
    expect(onPay).toHaveBeenCalled();
  });
});

describe("DueStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 23, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows 'All caught up' when nothing is due", () => {
    render(<DueStatus loan={loan} onViewSchedule={vi.fn()} />);
    expect(screen.getByText(/All caught up/i)).toBeInTheDocument();
  });
  it("shows a relative due label and absolute date when next_due_date is set", () => {
    render(<DueStatus loan={{ ...loan, next_due_date: "2026-07-21" } as Loan} onViewSchedule={vi.fn()} />);
    expect(screen.getByText(/Due in 28 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Jul 21, 2026/i)).toBeInTheDocument();
  });
});
