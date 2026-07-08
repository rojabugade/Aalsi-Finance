import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const search = new URLSearchParams("loan=card");
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/api/analyst", () => ({ useDebtPlan: () => ({ data: null }) }));
vi.mock("@/components/debt/analyst/ai-coach", () => ({
  AiCoach: ({ threadId }: { threadId: string }) => <div data-testid="coach">{threadId}</div>,
}));
vi.mock("@/lib/api/loans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/loans")>("@/lib/api/loans");
  return {
    ...actual,
    useLoans: () => ({ data: [{ id: "card", name: "My Card", type: "credit_card", schedule_kind: "revolving", principal: 10000, outstanding_balance: 8000, currency: "USD", interest_rate: 18, min_or_emi_amount: 300, start_date: "2023-01-01" }], isLoading: false, isError: false }),
    useCreateLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useLoanSchedule: () => ({ data: [], isLoading: false }),
    useLoanPayments: () => ({ data: { items: [], total: 0 }, isLoading: false }),
    usePayoffCalc: () => ({ mutate: vi.fn(), isPending: false }),
    useCreatePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeletePayment: () => ({ mutate: vi.fn(), isPending: false }),
    usePatchLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import DebtPage from "./page";

describe("DebtPage routing", () => {
  it("renders the routed detail page when ?loan=<id> resolves", () => {
    render(<DebtPage />);
    expect(screen.getByRole("link", { name: /Debt/i })).toHaveAttribute("href", "/debt");
    expect(screen.getAllByText(/My Card/).length).toBeGreaterThan(0);
  });
});
