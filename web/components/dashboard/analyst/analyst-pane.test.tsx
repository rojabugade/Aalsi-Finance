import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closePane: vi.fn(),
  mode: "monitor",
}));

vi.mock("./use-analyst", () => ({
  useAnalyst: () => ({
    open: true,
    mode: mocks.mode,
    setMode: vi.fn(),
    closePane: mocks.closePane,
    runAction: vi.fn(),
    range: { from: "2026-01-01", to: "2026-03-31" },
    focus: null,
  }),
}));
vi.mock("./chat-thread", () => ({
  ChatThread: ({ threadId }: { threadId: string }) => <div data-testid="chat-thread">{threadId}</div>,
}));
vi.mock("@/lib/api/analyst", () => ({
  useMonitor: () => ({ isLoading: false, isError: false, data: { alerts: [] } }),
  useAcknowledgeAlert: () => ({ mutate: vi.fn() }),
}));
import { AnalystPane } from "./analyst-pane";

describe("AnalystPane", () => {
  it("renders four modes and closes on Escape", () => {
    render(<AnalystPane />);
    expect(screen.getByRole("dialog", { name: "AI Analyst" })).toHaveClass("bottom-24", "rounded-[28px]", "analyst-liquid-glass");
    for (const label of ["Monitor", "Explain", "Plan", "Action"]) expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.closePane).toHaveBeenCalled();
  });

  it("starts a fresh chat thread", () => {
    mocks.mode = "plan";
    render(<AnalystPane />);
    expect(screen.getByTestId("chat-thread").textContent).toBe("dashboard");
    fireEvent.click(screen.getByRole("button", { name: /start new chat/i }));
    expect(screen.getByTestId("chat-thread").textContent).toMatch(/^dashboard-/);
  });
});
