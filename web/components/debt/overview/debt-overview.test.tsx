import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/analyst", () => ({
  useDebtPlan: () => ({
    data: {
      available: true, source: "ai", strategy: "avalanche", extra_monthly: "200",
      headline: "Hit the card first", narrative: "", currency: "USD",
      interest_saved: "1000", months_sooner: 5, ordered: [
        { loan_id: "card", name: "Card", order: 1, extra_allocation: "200", rationale: "rate", impact: "Highest impact" },
      ],
      baseline_payoff_date: null, optimized_payoff_date: null, updated_at: "2026-06-21T00:00:00Z",
    },
    isLoading: false,
  }),
  useRecalcDebtPlan: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./payoff-projection-impl", () => ({ PayoffProjectionImpl: () => <div data-testid="chart" /> }));
vi.mock("@/components/debt/analyst/ai-coach", () => ({
  AiCoach: ({ threadId, onCollapse }: { threadId: string; onCollapse: () => void }) => <><div data-testid="coach">{threadId}</div><button onClick={onCollapse}>Collapse AI Coach</button></>,
}));

import { DebtOverview } from "./debt-overview";
import type { Loan } from "@/lib/api/loans";

const loans = [
  { id: "card", name: "Card", type: "student", outstanding_balance: 10000, principal: 10000, interest_rate: 18, min_or_emi_amount: 300, next_due_date: "2024-06-01", progress_pct: 0, currency: "USD", penalty_warning: null },
] as unknown as Loan[];

describe("DebtOverview", () => {
  it("renders the surfaces from real loans + plan", () => {
    render(<DebtOverview loans={loans} />);
    expect(screen.getByText(/AI Smart Prioritization/i)).toBeInTheDocument();
    expect(screen.getByText(/Your debts/i)).toBeInTheDocument();
    expect(screen.getByText(/What if you paid more/i)).toBeInTheDocument();
    expect(screen.queryByTestId("coach")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open AI Coach/i })).toBeInTheDocument();
  });
  it("zero loans shows the empty hero and hides AI cards", () => {
    render(<DebtOverview loans={[]} />);
    expect(screen.getByText(/No debts yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Smart Prioritization/i)).not.toBeInTheDocument();
  });
  it("opens and collapses the coach", () => {
    render(<DebtOverview loans={loans} />);
    fireEvent.click(screen.getByRole("button", { name: /Open AI Coach/i }));
    expect(screen.getByTestId("coach").textContent).toBe("debt");
    fireEvent.click(screen.getByRole("button", { name: /Collapse AI Coach/i }));
    expect(screen.queryByTestId("coach")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open AI Coach/i })).toBeInTheDocument();
  });
});
