import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ScenarioSimulator } from "./scenario-simulator";
import type { LoanLike } from "../debt-math";

const loans: LoanLike[] = [
  { id: "a", name: "Card", outstanding_balance: 10000, principal: 10000, interest_rate: 18, min_or_emi_amount: 300, currency: "USD" },
  { id: "b", name: "Student", outstanding_balance: 40000, principal: 40000, interest_rate: 5, min_or_emi_amount: 450, currency: "USD" },
];

// Wrap in a tiny stateful host so the controlled `extra` prop updates.
function Host({ onViewFull = vi.fn() }: { onViewFull?: () => void }) {
  const [extra, setExtra] = useState(0);
  return (
    <ScenarioSimulator
      loans={loans}
      strategy="avalanche"
      currency="USD"
      extra={extra}
      onExtraChange={setExtra}
      onViewFull={onViewFull}
    />
  );
}

describe("ScenarioSimulator", () => {
  it("updates savings when the slider moves", () => {
    render(<Host />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "300" } });
    expect(screen.getByLabelText("Extra monthly payment")).toHaveValue(300);
    expect(screen.getByTestId("sim-interest-saved").textContent).not.toMatch(/\$0\.00$/);
  });

  it("accepts a typed amount with no artificial cap", () => {
    render(<Host />);
    fireEvent.change(screen.getByLabelText("Extra monthly payment"), { target: { value: "8000" } });
    expect(screen.getByTestId("sim-allocation")).toHaveTextContent("$8,000");
  });

  it("shows every account in the distribution and tags the avalanche target", () => {
    render(<Host />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "300" } });
    const panel = screen.getByTestId("sim-allocation");
    expect(panel).toHaveTextContent("Card");
    expect(panel).toHaveTextContent("Student");
    expect(panel).toHaveTextContent("Highest APR");
    expect(screen.getAllByTestId("sim-alloc-row")).toHaveLength(2);
  });

  it("hides the distribution panel when no extra is set", () => {
    render(<Host />);
    expect(screen.queryByTestId("sim-allocation")).toBeNull();
  });

  it("fires onViewFull when the full-scenario button is clicked", () => {
    const onViewFull = vi.fn();
    render(<Host onViewFull={onViewFull} />);
    fireEvent.click(screen.getByRole("button", { name: /View full scenario/i }));
    expect(onViewFull).toHaveBeenCalled();
  });
});
