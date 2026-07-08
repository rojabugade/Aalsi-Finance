import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewRing } from "./overview-ring";
import type { LoanLike } from "../debt-math";

const loans: LoanLike[] = [
  { id: "a", name: "Card", outstanding_balance: 10000, principal: 10000, interest_rate: 18, min_or_emi_amount: 300, currency: "USD" },
  { id: "b", name: "Auto", outstanding_balance: 4000, principal: 12000, interest_rate: 6, min_or_emi_amount: 250, currency: "USD" },
];

describe("OverviewRing", () => {
  it("renders total, monthly, weighted APR, and on-track chip", () => {
    render(<OverviewRing loans={loans} currency="USD" onTrack />);
    expect(screen.getByText(/14,000/)).toBeInTheDocument(); // total outstanding
    expect(screen.getByText(/550/)).toBeInTheDocument(); // total monthly
    expect(screen.getByText(/14\.6%/)).toBeInTheDocument(); // weighted avg APR
    expect(screen.getByText(/On track/i)).toBeInTheDocument();
  });
});
