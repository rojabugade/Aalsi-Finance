import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BaseWidget } from "./base-widget";
import type { WidgetDef } from "@/lib/dashboard/registry";
import { TrendingUp } from "lucide-react";

function defWith(state: { status: string; data?: unknown }): WidgetDef {
  return {
    title: "Test",
    icon: TrendingUp,
    defW: 2,
    defH: 2,
    controls: { fields: [] },
    defaults: {},
    contract: {
      useData: () => state as never,
      Body: ({ data }) => <div>body:{String(data)}</div>,
      deriveInsights: () => [{ label: "chip-a", severity: 5 }],
      emptyHint: "nothing here",
    },
  };
}

describe("BaseWidget (contract)", () => {
  it("shows the empty hint on empty status", () => {
    render(<BaseWidget def={defWith({ status: "empty" })} config={{}} w={2} h={2} focusOpen={false} onFocusChange={() => {}} />);
    expect(screen.getByText("nothing here")).toBeTruthy();
  });
  it("renders Body and an insight chip on ready status", () => {
    render(<BaseWidget def={defWith({ status: "ready", data: "X" })} config={{}} w={2} h={2} focusOpen={false} onFocusChange={() => {}} />);
    expect(screen.getByText("body:X")).toBeTruthy();
    expect(screen.getByText("chip-a")).toBeTruthy();
  });
  it("shows the error state on error status", () => {
    render(<BaseWidget def={defWith({ status: "error" })} config={{}} w={2} h={2} focusOpen={false} onFocusChange={() => {}} />);
    expect(screen.getByText(/Couldn.t load/i)).toBeTruthy();
  });
  it("renders against the active density mode baseline when no per-widget preset", () => {
    // calm baseline = compact (level 0) → density 0 → no insight chips
    const { unmount } = render(<BaseWidget def={defWith({ status: "ready", data: "X" })} config={{}} mode="calm" w={2} h={2} focusOpen={false} onFocusChange={() => {}} />);
    expect(screen.getByText("body:X")).toBeTruthy();
    expect(screen.queryByText("chip-a")).toBeNull();
    unmount();
    // power baseline = analytical → richer body shows insight chips
    render(<BaseWidget def={defWith({ status: "ready", data: "X" })} config={{}} mode="power" w={2} h={2} focusOpen={false} onFocusChange={() => {}} />);
    expect(screen.getByText("chip-a")).toBeTruthy();
  });
});
