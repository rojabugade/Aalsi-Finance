import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CashflowHero } from "./cashflow-hero";

vi.mock("@/lib/api/cashflow", () => ({
  useCashflowSummary: () => ({
    data: {
      currency: "USD",
      leftover_monthly: "1240.00",
      breakdown: [
        { label: "Income", amount: "5700.00", kind: "income" },
        { label: "Left over", amount: "1240.00", kind: "leftover" },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}));

describe("CashflowHero", () => {
  it("renders the leftover and breakdown lines", () => {
    render(<CashflowHero />);
    expect(screen.getAllByText(/Left over/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Income")).toBeInTheDocument();
    expect(screen.getByText("$5,700.00")).toBeInTheDocument();
  });
});
