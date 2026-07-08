import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnalystProvider, useAnalyst } from "./use-analyst";

function Probe() {
  const analyst = useAnalyst();
  return <><span data-testid="open">{String(analyst.open)}</span><span data-testid="mode">{analyst.mode}</span><button onClick={analyst.toggle}>toggle</button><button onClick={() => analyst.setMode("plan")}>plan</button></>;
}

describe("AnalystProvider", () => {
  it("tracks open state and mode", () => {
    render(<AnalystProvider onAction={vi.fn()}><Probe /></AnalystProvider>);
    fireEvent.click(screen.getByText("toggle"));
    fireEvent.click(screen.getByText("plan"));
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    expect(screen.getByTestId("mode")).toHaveTextContent("plan");
  });

  it("exposes range + focus and lets pages set them", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AnalystProvider defaultRange={{ from: "2026-01-01", to: "2026-03-31" }} onAction={() => {}}>
        {children}
      </AnalystProvider>
    );
    const { result } = renderHook(() => useAnalyst(), { wrapper });
    expect(result.current.range.from).toBe("2026-01-01");
    act(() => result.current.setFocus({ kind: "merchant", label: "Home Depot" }));
    expect(result.current.focus?.label).toBe("Home Depot");
    act(() => result.current.clearFocus());
    expect(result.current.focus).toBeNull();
  });

  it("exposes route and filters for page context", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AnalystProvider onAction={() => {}}>
        {children}
      </AnalystProvider>
    );
    const { result } = renderHook(() => useAnalyst(), { wrapper });
    act(() => result.current.setRoute("/transactions"));
    act(() => result.current.setFilters({ category: "Dining" }));
    expect(result.current.route).toBe("/transactions");
    expect(result.current.filters).toEqual({ category: "Dining" });
    act(() => result.current.setFilters(null));
    expect(result.current.filters).toBeNull();
  });
});
