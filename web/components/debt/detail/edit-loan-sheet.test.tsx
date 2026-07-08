import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/loans", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/loans")>("@/lib/api/loans");
  return {
    ...actual,
    usePatchLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import { EditLoanSheet } from "./edit-loan-sheet";
import type { Loan } from "@/lib/api/loans";

const loan = { id: "l1", name: "Car Loan", type: "auto", schedule_kind: "amortizing", principal: 5000, currency: "USD" } as unknown as Loan;

describe("EditLoanSheet", () => {
  it("renders the edit form when open", () => {
    render(<EditLoanSheet loan={loan} open onOpenChange={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByText(/Edit loan/i)).toBeInTheDocument();
  });
  it("renders nothing visible when closed", () => {
    render(<EditLoanSheet loan={loan} open={false} onOpenChange={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.queryByText(/Edit loan/i)).not.toBeInTheDocument();
  });
});
