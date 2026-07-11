import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  history: { data: undefined as unknown, isLoading: false },
  histories: null as Record<string, { data: unknown; isLoading: boolean }> | null,
}));

vi.mock("@/lib/api/guidance", () => ({
  useGuidanceAsk: () => ({
    mutateAsync: state.mutateAsync,
    isPending: state.isPending,
  }),
  useGuidanceThread: (threadId: string) => state.histories?.[threadId] ?? state.history,
}));

import { GuidanceConversation } from "./guidance-conversation";

const answer = {
  answer: "File the report by the applicable deadline.",
  citations: [
    {
      title: "IRS filing guidance",
      source_type: "Government guidance",
      effective_date: "2026-01-01",
      source_url: "https://www.irs.gov/",
    },
  ],
  disclaimer: "This is general information, not tax advice.",
  thread_id: "overview",
};

function renderConversation(onSave = vi.fn()) {
  return {
    onSave,
    ...render(
      <GuidanceConversation
        domain="general"
        threadId="overview"
        prompts={["What documents do I need?"]}
        defaultCountry="United States"
        defaultTopic="tax"
        onSave={onSave}
      />,
    ),
  };
}

afterEach(() => {
  state.mutateAsync.mockReset();
  state.isPending = false;
  state.history = { data: undefined, isLoading: false };
  state.histories = null;
});

describe("GuidanceConversation", () => {
  it("hydrates the local conversation from server history", async () => {
    state.history = {
      data: {
        messages: [
          { role: "user", text: "Do I need to report this account?" },
          {
            role: "analyst",
            text: "It may be reportable.",
            citations: answer.citations,
            disclaimer: answer.disclaimer,
          },
        ],
      },
      isLoading: false,
    };

    renderConversation();

    expect(await screen.findByText("Do I need to report this account?")).toBeInTheDocument();
    expect(screen.getByText("It may be reportable.")).toBeInTheDocument();
    expect(screen.getByText("[1] IRS filing guidance")).toBeInTheDocument();
  });

  it("keeps a completed local turn when delayed history arrives", async () => {
    state.mutateAsync.mockResolvedValue(answer);
    const { rerender } = renderConversation();

    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Local question" } });
    fireEvent.submit(screen.getByTestId("guidance-composer"));
    expect(await screen.findByText(answer.answer)).toBeInTheDocument();

    state.history = {
      data: {
        messages: [
          { role: "user", text: "Earlier server question" },
          { role: "analyst", text: "Earlier server answer" },
        ],
      },
      isLoading: false,
    };
    rerender(
      <GuidanceConversation
        domain="general"
        threadId="overview"
        prompts={["What documents do I need?"]}
        defaultCountry="United States"
        defaultTopic="tax"
        onSave={vi.fn()}
      />,
    );

    expect(await screen.findByText("Earlier server answer")).toBeInTheDocument();
    expect(screen.getByText("Local question")).toBeInTheDocument();
    expect(screen.getByText(answer.answer)).toBeInTheDocument();
  });

  it("deduplicates a local turn already present in delayed history", async () => {
    state.mutateAsync.mockResolvedValue(answer);
    const { rerender } = renderConversation();

    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Local question" } });
    fireEvent.submit(screen.getByTestId("guidance-composer"));
    expect(await screen.findByText(answer.answer)).toBeInTheDocument();

    state.history = {
      data: {
        messages: [
          { role: "user", text: "Local question" },
          {
            role: "analyst",
            text: answer.answer,
            citations: answer.citations,
            disclaimer: answer.disclaimer,
          },
        ],
      },
      isLoading: false,
    };
    rerender(
      <GuidanceConversation
        domain="general"
        threadId="overview"
        prompts={["What documents do I need?"]}
        defaultCountry="United States"
        defaultTopic="tax"
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Local question")).toHaveLength(1);
      expect(screen.getAllByText(answer.answer)).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Save to My Plan" })).toHaveLength(1);
    });
  });

  it("keeps a current answer when delayed history has different citations", async () => {
    state.mutateAsync.mockResolvedValue(answer);
    const { rerender } = renderConversation();

    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Local question" } });
    fireEvent.submit(screen.getByTestId("guidance-composer"));
    expect(await screen.findByText(answer.answer)).toBeInTheDocument();

    state.history = {
      data: {
        messages: [
          { role: "user", text: "Local question" },
          {
            role: "analyst",
            text: answer.answer,
            citations: [
              {
                title: "Archived filing guidance",
                source_type: "Government guidance",
                effective_date: "2025-01-01",
                source_url: "https://www.irs.gov/archived-guidance",
              },
            ],
            disclaimer: answer.disclaimer,
          },
        ],
      },
      isLoading: false,
    };
    rerender(
      <GuidanceConversation
        domain="general"
        threadId="overview"
        prompts={["What documents do I need?"]}
        defaultCountry="United States"
        defaultTopic="tax"
        onSave={vi.fn()}
      />,
    );

    expect(await screen.findByText("[1] Archived filing guidance")).toBeInTheDocument();
    expect(screen.getByText("[1] IRS filing guidance")).toBeInTheDocument();
  });

  it("resets messages and hydrates the history for a changed thread", async () => {
    state.histories = {
      overview: {
        data: { messages: [{ role: "user", text: "Overview question" }] },
        isLoading: false,
      },
      "cross-border": {
        data: { messages: [{ role: "user", text: "Cross-border question" }] },
        isLoading: false,
      },
    };
    const { rerender } = renderConversation();

    expect(await screen.findByText("Overview question")).toBeInTheDocument();

    rerender(
      <GuidanceConversation
        domain="cross_border"
        threadId="cross-border"
        prompts={["How do I send money abroad?"]}
        onSave={vi.fn()}
      />,
    );

    expect(await screen.findByText("Cross-border question")).toBeInTheDocument();
    expect(screen.queryByText("Overview question")).not.toBeInTheDocument();
  });

  it("submits a starter prompt", async () => {
    state.mutateAsync.mockResolvedValue(answer);
    renderConversation();

    fireEvent.click(screen.getByRole("button", { name: "What documents do I need?" }));

    await waitFor(() =>
      expect(state.mutateAsync).toHaveBeenCalledWith({
        question: "What documents do I need?",
        domain: "general",
        thread_id: "overview",
        country: "United States",
        topic: "tax",
      }),
    );
  });

  it("submits free text with domain, thread, country, and topic", async () => {
    state.mutateAsync.mockResolvedValue(answer);
    renderConversation();

    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "What is the filing deadline?" },
    });
    fireEvent.submit(screen.getByTestId("guidance-composer"));

    await waitFor(() =>
      expect(state.mutateAsync).toHaveBeenCalledWith({
        question: "What is the filing deadline?",
        domain: "general",
        thread_id: "overview",
        country: "United States",
        topic: "tax",
      }),
    );
  });

  it("shows non-blocking progress while a request is pending", () => {
    state.isPending = true;
    renderConversation();

    expect(screen.getByText("Searching the guidance corpus…")).toBeInTheDocument();
  });

  it("preserves a failed draft and retries it", async () => {
    state.mutateAsync.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(answer);
    renderConversation();

    fireEvent.change(screen.getByLabelText("Question"), {
      target: { value: "Can I claim this credit?" },
    });
    fireEvent.submit(screen.getByTestId("guidance-composer"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your question is still here");
    expect(screen.getByLabelText("Question")).toHaveValue("Can I claim this credit?");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledTimes(2));
    expect(state.mutateAsync.mock.calls[1][0]).toMatchObject({ question: "Can I claim this credit?" });
  });

  it("displays citations and disclaimer in a polite answer region", async () => {
    state.mutateAsync.mockResolvedValue(answer);
    renderConversation();

    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Need guidance" } });
    fireEvent.submit(screen.getByTestId("guidance-composer"));

    expect(await screen.findByText(answer.answer)).toBeInTheDocument();
    expect(screen.getByText("[1] IRS filing guidance")).toBeInTheDocument();
    expect(screen.getByText(answer.disclaimer)).toBeInTheDocument();
    expect(screen.getByTestId("guidance-answers")).toHaveAttribute("aria-live", "polite");
  });

  it("sends a complete PlanDraft only when Save to My Plan is chosen", async () => {
    const { onSave } = renderConversation();
    state.mutateAsync.mockResolvedValue(answer);

    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Need guidance" } });
    fireEvent.submit(screen.getByTestId("guidance-composer"));
    fireEvent.click(await screen.findByRole("button", { name: "Save to My Plan" }));

    expect(onSave).toHaveBeenCalledWith({
      question: "Need guidance",
      answer: answer.answer,
      citations: answer.citations,
      domain: "general",
      threadId: "overview",
    });
  });
});
