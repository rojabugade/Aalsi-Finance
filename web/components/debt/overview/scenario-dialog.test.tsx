import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenarioDialog } from "./scenario-dialog";
import type { LoanLike } from "../debt-math";

const loans: LoanLike[] = [
  { id: "a", name: "Card", outstanding_balance: 8000, principal: 8000, interest_rate: 14, min_or_emi_amount: 250, currency: "USD" },
  { id: "b", name: "Student", outstanding_balance: 40000, principal: 40000, interest_rate: 5, min_or_emi_amount: 450, currency: "USD" },
];

function open() {
  render(
    <ScenarioDialog
      open
      onOpenChange={vi.fn()}
      loans={loans}
      currency="USD"
      initialExtra={600}
      initialStrategy="avalanche"
    />,
  );
}

describe("ScenarioDialog", () => {
  it("lists every account and a payoff timeline", () => {
    open();
    expect(screen.getAllByTestId("scenario-row")).toHaveLength(2);
    expect(screen.getByTestId("scenario-timeline")).toBeInTheDocument();
    expect(screen.getAllByTestId("timeline-row")).toHaveLength(2);
  });

  it("concentrates the extra on the avalanche target by default", () => {
    open();
    const rows = screen.getAllByTestId("scenario-row");
    expect(rows[0]).toHaveTextContent("Highest APR");
    expect(rows[0]).toHaveTextContent("+$600");
  });

  it("spreads the extra across accounts in Split evenly mode", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Split evenly/i }));
    const rows = screen.getAllByTestId("scenario-row");
    // Both accounts now receive a slice of the extra (no "Highest APR" tag).
    expect(screen.queryByText(/Highest APR/i)).toBeNull();
    expect(rows[0]).toHaveTextContent("+$");
    expect(rows[1]).toHaveTextContent("+$");
  });

  it("lets the user type an amount past any cap", () => {
    open();
    fireEvent.change(screen.getByLabelText("Extra monthly payment"), { target: { value: "9000" } });
    expect(screen.getByLabelText("Extra monthly payment")).toHaveValue(9000);
  });

  it("caps the slider at the affordable extra and shows an affordability hint", () => {
    render(
      <ScenarioDialog
        open
        onOpenChange={vi.fn()}
        loans={loans}
        currency="USD"
        initialExtra={600}
        initialStrategy="avalanche"
        affordableExtra={1240}
      />,
    );
    // ceil(1240 / 250) * 250 = 1250
    expect(screen.getByLabelText("Extra monthly payment slider")).toHaveAttribute("max", "1250");
    expect(screen.getByText(/afford/i)).toBeInTheDocument();
  });
});
