import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/analyst", () => ({ useDebtPlan: () => ({ data: { extra_monthly: "50", strategy: "avalanche" } }) }));
// next/dynamic loads the recharts impl asynchronously (showing its loading
// fallback first), so stub dynamic itself with a synchronous chart node.
vi.mock("next/dynamic", () => ({
  default: () => function MockChart() {
    return <div data-testid="chart" />;
  },
}));

import { PayoffComparison } from "./payoff-comparison";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "l1", name: "Car Loan", type: "auto", currency: "USD",
  principal: 5000, outstanding_balance: 4000, interest_rate: 9, min_or_emi_amount: 200,
} as unknown as Loan;

describe("PayoffComparison", () => {
  it("renders the chart and a deterministic interest-saved figure > 0", () => {
    render(<PayoffComparison loan={loan} />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByText(/Optimize and save/i)).toBeInTheDocument();
    const saved = screen.getByTestId("cmp-interest-saved").textContent ?? "";
    expect(saved).toMatch(/\$/);
    expect(saved).not.toMatch(/\$0\.00$/);
  });
  it("still renders with no plan (extra falls back)", () => {
    render(<PayoffComparison loan={{ ...loan } as Loan} />);
    expect(screen.getByTestId("cmp-months-sooner")).toBeInTheDocument();
  });
});
