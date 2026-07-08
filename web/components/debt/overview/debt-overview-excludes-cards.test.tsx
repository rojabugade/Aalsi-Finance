import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/analyst", () => ({ useDebtPlan: () => ({ data: null, isLoading: false }) }));
vi.mock("./payoff-projection-impl", () => ({ PayoffProjectionImpl: () => <div data-testid="chart" /> }));
vi.mock("@/components/debt/analyst/ai-coach", () => ({
  AiCoach: ({ threadId, onCollapse }: { threadId: string; onCollapse: () => void }) => (
    <><div data-testid="coach">{threadId}</div><button onClick={onCollapse}>Collapse AI Coach</button></>
  ),
}));

import { DebtOverview } from "./debt-overview";
import type { Loan } from "@/lib/api/loans";

const card = { id: "c", name: "Visa Card", type: "credit_card", schedule_kind: "revolving", principal: "500", currency: "USD" } as unknown as Loan;
const auto = { id: "a", name: "Car Loan", type: "auto", schedule_kind: "amortizing", principal: "9000", currency: "USD" } as unknown as Loan;

describe("DebtOverview", () => {
  it("does not render credit-card loans", () => {
    render(<DebtOverview loans={[card, auto]} />);
    expect(screen.getByText("Car Loan")).toBeInTheDocument();
    expect(screen.queryByText("Visa Card")).not.toBeInTheDocument();
  });
});
