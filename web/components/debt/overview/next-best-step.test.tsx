import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NextBestStep } from "./next-best-step";
import type { DebtPlan } from "@/lib/api/analyst";

const plan = {
  source: "ai", strategy: "avalanche", ordered: [
    { loan_id: "card", name: "Card", order: 1, extra_allocation: "200", rationale: "highest rate", impact: "Highest impact" },
  ],
} as unknown as DebtPlan;

describe("NextBestStep", () => {
  it("dismisses and no longer offers a dead payment button", () => {
    const onDismiss = vi.fn();
    render(<NextBestStep plan={plan} onDismiss={onDismiss} />);
    expect(screen.queryByRole("button", { name: /Set up payment/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
