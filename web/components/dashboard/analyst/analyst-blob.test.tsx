import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const toggle = vi.fn();
vi.mock("./use-analyst", () => ({ useAnalyst: () => ({ toggle, open: false, dismissed: new Set(), range: { from: "2026-01-01", to: "2026-03-31" } }) }));
vi.mock("@/lib/api/analyst", () => ({ useMonitor: () => ({ data: { alerts: [{ id: "a1", severity: 9 }] } }) }));
import { AnalystBlob } from "./analyst-blob";

describe("AnalystBlob", () => {
  it("shows the alert count and toggles", () => {
    render(<AnalystBlob />);
    expect(screen.getByText("1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ai analyst/i }));
    expect(toggle).toHaveBeenCalled();
  });
});
