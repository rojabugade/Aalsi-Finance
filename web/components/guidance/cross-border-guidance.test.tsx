import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  conversationProps: undefined as Record<string, unknown> | undefined,
  moduleProps: undefined as Record<string, unknown> | undefined,
  dialogProps: undefined as Record<string, unknown> | undefined,
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
    return <div data-testid="cross-border-tools" />;
  },
}));

vi.mock("@/components/guidance/plan-item-dialog", () => ({
  PlanItemDialog: (props: Record<string, unknown>) => {
    state.dialogProps = props;
    return props.open ? <div role="dialog">Save to My Plan</div> : null;
  },
}));

import { CrossBorderGuidance } from "./cross-border-guidance";

afterEach(() => {
  state.conversationProps = undefined;
  state.moduleProps = undefined;
  state.dialogProps = undefined;
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

  it("opens a plan-item dialog for a saved answer", () => {
    render(<CrossBorderGuidance />);

    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Save to My Plan");
    expect(state.dialogProps?.draft).toMatchObject({
      question: "Review foreign account reporting",
      domain: "cross_border",
      threadId: "cross-border",
    });

    expect(screen.getByText("International Money")).toBeInTheDocument();
    expect(screen.getByText("Transfers, reporting, and sourced information.")).toBeInTheDocument();
  });
});
