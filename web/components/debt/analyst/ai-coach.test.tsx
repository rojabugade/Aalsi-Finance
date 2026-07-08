import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/dashboard/analyst/chat-thread", () => ({
  ChatThread: ({ threadId }: { threadId: string }) => <div data-testid="thread">{threadId}</div>,
}));

import { AiCoach } from "./ai-coach";
import type { DebtPlan } from "@/lib/api/analyst";

const range = { from: "2026-01-01", to: "2026-03-31" };

describe("AiCoach", () => {
  it("shows BETA, the AI recommendation, and the persistent thread", () => {
    const plan = { source: "ai", strategy: "avalanche", headline: "Hit the card", narrative: "Because 18% APR." } as unknown as DebtPlan;
    render(<AiCoach threadId="loan:card" range={range} plan={plan} />);
    expect(screen.getByText(/AI Coach/i)).toBeInTheDocument();
    expect(screen.getByText(/BETA/)).toBeInTheDocument();
    expect(screen.getByText(/Because 18% APR/)).toBeInTheDocument();
    expect(screen.getByTestId("thread").textContent).toBe("loan:card");
  });
  it("drops the AI narrative for a deterministic plan", () => {
    const plan = { source: "deterministic", strategy: "snowball", headline: "Pay smallest first", narrative: "" } as unknown as DebtPlan;
    render(<AiCoach threadId="debt" range={range} plan={plan} />);
    expect(screen.getByText(/Pay smallest first/)).toBeInTheDocument();
    expect(screen.queryByText(/mistakes/i)).toBeInTheDocument(); // footnote still present
  });
});
