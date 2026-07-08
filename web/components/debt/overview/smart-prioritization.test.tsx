import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SmartPrioritization } from "./smart-prioritization";
import type { DebtPlan } from "@/lib/api/analyst";

function renderCard(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const base = {
  strategy: "avalanche", extra_monthly: "200", headline: "Hit the card first",
  narrative: "", ordered: [
    { loan_id: "card", name: "Card", order: 1, extra_allocation: "200", rationale: "highest rate", impact: "Highest impact" },
  ],
  currency: "USD", interest_saved: "1234.50", months_sooner: 7,
  baseline_payoff_date: null, optimized_payoff_date: null, updated_at: "2026-06-21T00:00:00Z",
} as const;

describe("SmartPrioritization", () => {
  it("AI source shows AI heading and applies the plan's extra", () => {
    const onApply = vi.fn();
    renderCard(<SmartPrioritization plan={{ ...base, available: true, source: "ai" } as unknown as DebtPlan} currency="USD" onApply={onApply} />);
    expect(screen.getByText(/AI Smart Prioritization/i)).toBeInTheDocument();
    expect(screen.getByText(/Hit the card first/)).toBeInTheDocument();
    expect(screen.getByText(/Highest impact/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Apply plan/i }));
    expect(onApply).toHaveBeenCalledWith(200);
  });
  it("deterministic source drops AI framing and shows the off note", () => {
    renderCard(<SmartPrioritization plan={{ ...base, available: false, source: "deterministic" } as unknown as DebtPlan} currency="USD" onApply={vi.fn()} />);
    expect(screen.queryByText(/AI Smart Prioritization/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Smart Prioritization/i)).toBeInTheDocument();
    expect(screen.getByText(/AI coaching is off/i)).toBeInTheDocument();
  });
  it("exposes a manual recalculate control", () => {
    renderCard(<SmartPrioritization plan={{ ...base, available: true, source: "ai" } as unknown as DebtPlan} currency="USD" onApply={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Recalculate now/i })).toBeInTheDocument();
  });
});
