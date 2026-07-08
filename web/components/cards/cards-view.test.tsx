import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardsView } from "./cards-view";
import type { Loan } from "@/lib/api/loans";

const card = {
  id: "1", name: "Plaid Credit Card", type: "credit_card", schedule_kind: "revolving",
  principal: "500.00", currency: "USD", interest_rate: "19.99",
  min_or_emi_amount: "20.00", due_day: 15, outstanding_balance: "500.00",
  credit_card_detail: {
    credit_limit: "2000.00", statement_balance: "480.00",
    available_credit: "1500.00", statement_day: 3, utilization: 0.25,
  },
} as unknown as Loan;

const autoLoan = {
  id: "2", name: "Auto Loan", type: "auto", schedule_kind: "amortizing",
  principal: "10000.00", currency: "USD",
} as unknown as Loan;

describe("CardsView", () => {
  it("shows only credit-card loans with key details", () => {
    render(<CardsView loans={[card, autoLoan]} />);
    expect(screen.getByText("Plaid Credit Card")).toBeInTheDocument();
    expect(screen.queryByText("Auto Loan")).not.toBeInTheDocument();
    expect(screen.getAllByText(/25%/).length).toBeGreaterThan(0); // utilization (tile + summary)
    expect(screen.getByText(/19.99%/)).toBeInTheDocument(); // APR
  });

  it("shows an empty state with a Connections link when no cards", () => {
    render(<CardsView loans={[autoLoan]} />);
    expect(screen.getByText(/no credit cards/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /connect/i })).toHaveAttribute("href", "/connections");
  });
});
