import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn(async (_args: { mode: string; question: string; range_from?: string; range_to?: string }) => ({
  answer: "Pay the card first.",
  available: true,
}));
vi.mock("@/lib/api/analyst", () => ({
  useAnalystAsk: () => ({ mutateAsync, isPending: false }),
  useThreadHistory: () => ({ data: { messages: [] } }),
}));

import { ChatThread } from "./chat-thread";
import { resetThread } from "./thread-store";

const range = { from: "2026-01-01", to: "2026-03-31" };
afterEach(() => {
  resetThread("t1");
  mutateAsync.mockClear();
});

describe("ChatThread persistence", () => {
  it("keeps messages in the store across unmount/remount", async () => {
    const { unmount } = render(<ChatThread mode="explain" range={range} threadId="t1" />);
    fireEvent.change(screen.getByPlaceholderText(/Ask the analyst/i), { target: { value: "What should I do?" } });
    fireEvent.submit(screen.getByTestId("analyst-composer"));
    await waitFor(() => expect(screen.getByText(/Pay the card first/)).toBeInTheDocument());
    unmount();
    render(<ChatThread mode="explain" range={range} threadId="t1" />);
    expect(screen.getByText(/Pay the card first/)).toBeInTheDocument();
    expect(screen.getByText(/What should I do\?/)).toBeInTheDocument();
  });

  it("prepends the preamble to the API question but shows the raw text", async () => {
    render(<ChatThread mode="explain" range={range} threadId="t1" preamble="Loan: Card (credit_card)" />);
    fireEvent.change(screen.getByPlaceholderText(/Ask the analyst/i), { target: { value: "How fast?" } });
    fireEvent.submit(screen.getByTestId("analyst-composer"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0].question).toBe("Loan: Card (credit_card). How fast?");
    expect(screen.getByText("How fast?")).toBeInTheDocument();
  });
});
