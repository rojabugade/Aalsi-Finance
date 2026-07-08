import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// next/dynamic loads the recharts impl asynchronously (showing its loading
// fallback first), so stub dynamic itself with a synchronous chart node.
vi.mock("next/dynamic", () => ({
  default: () => function MockChart() {
    return <div data-testid="chart" />;
  },
}));

import { PayoffProjection } from "./payoff-projection";
import type { LoanLike } from "../debt-math";

const loans: LoanLike[] = [
  { id: "a", name: "Card", outstanding_balance: 10000, principal: 10000, interest_rate: 18, min_or_emi_amount: 300, currency: "USD" },
];

describe("PayoffProjection", () => {
  it("renders the chart and the months-sooner callout", () => {
    render(<PayoffProjection loans={loans} extraMonthly={200} strategy="avalanche" monthsSooner={7} currency="USD" />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByText(/7 months sooner/i)).toBeInTheDocument();
  });

  it("labels the optimized line honestly by plan source", () => {
    const { rerender } = render(
      <PayoffProjection loans={loans} extraMonthly={200} strategy="avalanche" monthsSooner={7} currency="USD" source="deterministic" />,
    );
    expect(screen.getByText(/Optimized plan payoff/i)).toBeInTheDocument();
    expect(screen.queryByText(/AI optimized payoff/i)).toBeNull();

    rerender(
      <PayoffProjection loans={loans} extraMonthly={200} strategy="avalanche" monthsSooner={7} currency="USD" source="ai" />,
    );
    expect(screen.getByText(/AI optimized payoff/i)).toBeInTheDocument();
  });
});
