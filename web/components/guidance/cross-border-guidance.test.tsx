import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  conversationProps: undefined as Record<string, unknown> | undefined,
  moduleProps: undefined as Record<string, unknown> | undefined,
  dialogProps: undefined as Record<string, unknown> | undefined,
  limits: { data: undefined as Record<string, unknown> | undefined, isLoading: false, isError: false },
}));

vi.mock("@/components/guidance/guidance-conversation", () => ({
  GuidanceConversation: (props: Record<string, unknown>) => {
    state.conversationProps = props;
    return (
      <div data-testid="cross-border-conversation">
        <button
          type="button"
          onClick={() => (props.onSave as (draft: Record<string, unknown>) => void)({
            question: "Review foreign account reporting",
            answer: "Review the current reporting guidance.",
            citations: [],
            domain: "cross_border",
            threadId: "cross-border",
          })}
        >
          Save answer
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/guidance/cross-border-module", () => ({
  CrossBorderModule: (props: Record<string, unknown>) => {
    state.moduleProps = props;
    return (
      <div data-testid="cross-border-tools">
        <button
          type="button"
          onClick={() => (props.onSaveWarning as (warning: Record<string, unknown>, citations: unknown[]) => void)(
            { message: "Transfer total is near a corpus-defined limit; verify the cited source before acting." },
            [{ title: "RBI limit", source_type: "Regulator", effective_date: "2026-01-01" }],
          )}
        >
          Save warning
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/guidance/plan-item-dialog", () => ({
  PlanItemDialog: (props: Record<string, unknown>) => {
    state.dialogProps = props;
    return props.open ? <div role="dialog">Save to My Plan</div> : null;
  },
}));

vi.mock("@/lib/api/guidance", () => ({ useLimits: () => state.limits }));

import { CrossBorderGuidance } from "./cross-border-guidance";

afterEach(() => {
  state.conversationProps = undefined;
  state.moduleProps = undefined;
  state.dialogProps = undefined;
  state.limits.data = undefined;
  state.limits.isLoading = false;
  state.limits.isError = false;
});

describe("CrossBorderGuidance", () => {
  it("uses the cross-border conversation thread and section-specific starter prompts", () => {
    render(<CrossBorderGuidance />);

    expect(state.conversationProps).toMatchObject({ domain: "cross_border", threadId: "cross-border" });
    expect(state.conversationProps?.prompts).toEqual(expect.arrayContaining([
      "How does residency affect my reporting?",
      "What remittance rules should I review?",
    ]));
  });

  it("places conversation before cross-border tools and has no specialised toggle", () => {
    render(<CrossBorderGuidance />);
    const layout = screen.getByTestId("cross-border-guidance-layout");

    expect(layout).toHaveClass("lg:grid-cols-2");
    expect(layout.querySelector("[data-testid='cross-border-conversation']")?.compareDocumentPosition(
      layout.querySelector("[data-testid='cross-border-tools']")!,
    )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByLabelText(/cross-border specialised/i)).not.toBeInTheDocument();
  });

  it("opens the same plan-item dialog for a saved answer and warning", () => {
    render(<CrossBorderGuidance />);

    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Save to My Plan");
    expect(state.dialogProps?.draft).toMatchObject({
      question: "Review foreign account reporting",
      domain: "cross_border",
      threadId: "cross-border",
    });

    fireEvent.click(screen.getByRole("button", { name: "Save warning" }));
    expect(state.dialogProps?.draft).toMatchObject({
      domain: "cross_border",
      threadId: "cross-border",
      citations: [{ title: "RBI limit" }],
    });
  });

  it("summarizes the highest corpus warning or the neutral limit state", () => {
    const { rerender } = render(<CrossBorderGuidance />);
    expect(screen.getByText("No current corpus-defined warning.")).toBeInTheDocument();

    state.limits.data = {
      totals: [],
      limits: [],
      warnings: [
        { message: "Near limit", ratio: "0.80" },
        { message: "Closer to limit", ratio: "0.95" },
      ],
      citations: [],
    };
    rerender(<CrossBorderGuidance />);

    expect(screen.getByText("Closer to limit")).toBeInTheDocument();
  });

  it("does not present a neutral summary when current limits cannot load", () => {
    state.limits.isError = true;
    render(<CrossBorderGuidance />);

    expect(screen.getByText("Current limits are unavailable. Retry below.")).toBeInTheDocument();
    expect(screen.queryByText("No current corpus-defined warning.")).not.toBeInTheDocument();
  });
});
