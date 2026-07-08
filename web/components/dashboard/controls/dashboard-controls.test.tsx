import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/shell/add-menu", () => ({ AddMenu: () => null }));
vi.mock("@/components/date-range-picker", () => ({ DateRangePicker: () => null }));
vi.mock("./ask-ai-bar", () => ({ AskAiBar: () => null }));
import { DashboardControls } from "./dashboard-controls";

describe("DashboardControls", () => {
  it("does not render the retired analyst toggle", () => {
    render(<DashboardControls range="3m" onRangeChange={vi.fn()} editing={false} onToggleEditing={vi.fn()} />);
    expect(screen.queryByTestId("analyst-toggle")).not.toBeInTheDocument();
  });
});
