import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DebtList } from "./debt-list";
import type { Loan } from "@/lib/api/loans";

const loans = [
  { id: "card", name: "Card", type: "credit_card", outstanding_balance: 10000, principal: 10000, interest_rate: 18, min_or_emi_amount: 300, next_due_date: "2024-06-01", progress_pct: 0, currency: "USD" },
] as unknown as Loan[];

describe("DebtList", () => {
  it("renders a row and routes to the loan on click", () => {
    render(<DebtList loans={loans} />);
    fireEvent.click(screen.getByRole("button", { name: /Card/ }));
    expect(push).toHaveBeenCalledWith("/debt?loan=card");
  });
});
