import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ask: { mutateAsync: vi.fn(), isPending: false },
  history: { data: undefined as unknown, isLoading: false },
  wizard: { mutateAsync: vi.fn(), isPending: false },
  create: { mutateAsync: vi.fn(), isPending: false },
  plan: { data: [] as Array<{ id: string; title: string; status: string }>, isLoading: false },
}));

vi.mock("@/lib/api/guidance", () => ({
  useGuidanceAsk: () => state.ask,
  useGuidanceThread: () => state.history,
  useWizard: () => state.wizard,
  useCreatePlanItem: () => state.create,
  usePlanItems: () => state.plan,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GuidanceOverview } from "./guidance-overview";

afterEach(() => {
  state.ask.mutateAsync.mockReset();
  state.wizard.mutateAsync.mockReset();
  state.create.mutateAsync.mockReset();
  state.plan.data = [];
});

describe("GuidanceOverview", () => {
  it.each([
    "Review my financial readiness",
    "Explore investing in India",
    "Check cross-border obligations",
  ])("submits the %s starter prompt to the overview conversation", async (prompt) => {
    state.ask.mutateAsync.mockResolvedValue({ answer: "Answer", citations: [], disclaimer: "Info" });
    render(<GuidanceOverview />);

    fireEvent.click(screen.getByRole("button", { name: prompt }));

    await waitFor(() => {
      expect(state.ask.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        question: prompt,
        domain: "general",
        thread_id: "overview",
      }));
    });
  });

  it("opens the inline plan builder from its starter action", () => {
    render(<GuidanceOverview />);

    fireEvent.click(screen.getByRole("button", { name: "Build my guidance plan" }));

    expect(screen.getByRole("heading", { name: "Build your guidance plan" })).toBeInTheDocument();
  });

  it("links its open-plan preview to the plan section", () => {
    state.plan.data = [{ id: "plan-1", title: "Review annual reporting", status: "open" }];
    render(<GuidanceOverview />);

    expect(screen.getByRole("link", { name: "Open plan" })).toHaveAttribute("href", "?section=plan");
  });
});
