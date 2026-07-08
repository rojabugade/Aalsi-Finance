import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockResult: Record<string, unknown> = { answer: "Dining rose 38%.", suggestions: [], available: true };
const mutateAsync = vi.fn(async () => mockResult);
vi.mock("@/lib/api/analyst", () => ({
  useAnalystAsk: () => ({ mutateAsync, isPending: false }),
  useThreadHistory: () => ({ data: { messages: [{ role: "analyst", text: "Earlier answer." }] } }),
}));
import { ChatThread } from "./chat-thread";
import { resetThread } from "./thread-store";

afterEach(() => {
  resetThread("dashboard");
  mockResult = { answer: "Dining rose 38%.", suggestions: [], available: true };
});

describe("ChatThread", () => {
  it("submits and renders an answer", async () => {
    render(<ChatThread mode="explain" range={{ from: "2026-01-01", to: "2026-03-31" }} threadId="dashboard" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: "why?" } });
    fireEvent.submit(screen.getByTestId("analyst-composer"));
    await waitFor(() => expect(screen.getByText("Dining rose 38%.")).toBeInTheDocument());
    expect(mutateAsync).toHaveBeenCalledWith({ mode: "explain", question: "why?", range_from: "2026-01-01", range_to: "2026-03-31", thread_id: "dashboard" });
  });

  it("hydrates from server thread history when the local store is empty", async () => {
    render(<ChatThread mode="explain" range={{ from: "2026-06-01", to: "2026-06-30" }} threadId="dashboard" />);
    await waitFor(() => expect(screen.getByText("Earlier answer.")).toBeInTheDocument());
  });

  it("includes focus + page fields when provided", async () => {
    render(
      <ChatThread mode="explain" range={{ from: "2026-06-01", to: "2026-06-30" }} threadId="dashboard"
        page="Spend" focus={{ kind: "merchant", label: "Home Depot" }} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: "why up?" } });
    fireEvent.submit(screen.getByTestId("analyst-composer"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      focus_kind: "merchant", focus_label: "Home Depot", page: "Spend",
    }));
  });

  it("sends structured page_context when provided", async () => {
    render(
      <ChatThread
        mode="explain"
        range={{ from: "2026-06-01", to: "2026-06-30" }}
        threadId="dashboard"
        pageContext={{
          route: "/transactions",
          entity: "Dining",
          visibleRange: "2026-06-01..2026-06-30",
          filters: { category: "Dining" },
        }}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: "why up?" } });
    fireEvent.submit(screen.getByTestId("analyst-composer"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      page_context: {
        route: "/transactions",
        entity: "Dining",
        visible_range: "2026-06-01..2026-06-30",
        filters: { category: "Dining" },
      },
    }));
  });

  it("renders a Sources line when the answer has citations", async () => {
    mockResult = {
      answer: "You spent $9.99 at Cafe.",
      suggestions: [],
      available: true,
      citations: [{ source_type: "transaction", source_id: "t1" }],
    };
    render(<ChatThread mode="explain" range={{ from: "2026-06-01", to: "2026-06-30" }} threadId="dashboard" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: "what did I spend?" } });
    fireEvent.submit(screen.getByTestId("analyst-composer"));
    await waitFor(() => expect(screen.getByText(/Sources/i)).toBeInTheDocument());
  });
});
