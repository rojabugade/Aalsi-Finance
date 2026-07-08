import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { debtPlan } = vi.hoisted(() => ({
  debtPlan: {
    data: {
      source: "deterministic",
      strategy: "avalanche",
      extra_monthly: 600,
      affordable_extra: 1240,
      interest_saved: 500,
      months_sooner: 3,
      currency: "USD",
    },
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/analyst", () => ({ useDebtPlan: () => debtPlan }));
vi.mock("@/components/debt/analyst/ai-coach", () => ({
  AiCoach: ({
    threadId,
    onCollapse,
    onSeeImpact,
  }: {
    threadId: string;
    onCollapse?: () => void;
    onSeeImpact?: () => void;
  }) => (
    <div data-testid="coach">
      {threadId}
      {onCollapse && <button onClick={onCollapse}>Collapse AI Coach</button>}
      {onSeeImpact && <button onClick={onSeeImpact}>See impact</button>}
    </div>
  ),
}));
vi.mock("@/lib/api/loans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/loans")>("@/lib/api/loans");
  return {
    ...actual,
    useLoanSchedule: () => ({ data: [], isLoading: false }),
    useLoanPayments: () => ({ data: { items: [], total: 0 }, isLoading: false }),
    usePayoffCalc: () => ({ mutate: vi.fn(), isPending: false }),
    useCreatePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeletePayment: () => ({ mutate: vi.fn(), isPending: false }),
    usePatchLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import { LoanDetailPage } from "./loan-detail-page";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "card", name: "My Card", type: "credit_card", schedule_kind: "revolving",
  compounding: "monthly", principal: 10000, outstanding_balance: 8000, currency: "USD",
  interest_rate: 18, min_or_emi_amount: 300, due_day: 5, start_date: "2023-01-01",
} as unknown as Loan;

describe("LoanDetailPage", () => {
  it("renders breadcrumb, hero name, details card, and closed AI coach control", () => {
    render(<LoanDetailPage loan={loan} />);
    const crumb = screen.getByRole("link", { name: /Debt/i });
    expect(crumb).toHaveAttribute("href", "/debt");
    expect(screen.getAllByText(/My Card/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Loan details/i)).toBeInTheDocument();
    expect(screen.queryByTestId("coach")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open AI Coach/i })).toBeInTheDocument();
  });

  it("opens and collapses the AI coach rail", () => {
    render(<LoanDetailPage loan={loan} />);
    fireEvent.click(screen.getByRole("button", { name: /Open AI Coach/i }));
    expect(screen.getByTestId("coach")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Collapse AI Coach/i }));
    expect(screen.queryByTestId("coach")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open AI Coach/i }));
    expect(screen.getByTestId("coach")).toBeInTheDocument();
  });

  it("opens the full scenario with the recommended extra and affordability hint", () => {
    render(<LoanDetailPage loan={loan} />);
    fireEvent.click(screen.getByRole("button", { name: /View full scenario/i }));
    const dialog = screen.getByTestId("scenario-dialog");
    expect(within(dialog).getByLabelText("Extra monthly payment")).toHaveValue(600);
    expect(within(dialog).getByText(/afford about \$1,240\.00\/mo extra/i)).toBeInTheDocument();
  });

  it("uses the same plan-driven payoff projection as the debt page", () => {
    render(<LoanDetailPage loan={loan} />);
    expect(screen.getByRole("heading", { name: /Payoff Projection/i })).toBeInTheDocument();
    expect(screen.getByText(/Optimized plan payoff/i)).toBeInTheDocument();
    expect(screen.getByText(/3 months sooner/i)).toBeInTheDocument();
  });

  it("opens the edit sheet when Edit details is clicked", async () => {
    render(<LoanDetailPage loan={loan} />);
    expect(screen.queryByText(/Edit My Card/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Edit details/i }));
    // Radix mounts sheet content via Presence (async), so wait for it.
    expect(await screen.findByText(/Edit My Card/i)).toBeInTheDocument();
  });
});
