import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetEmpty, WidgetError, WidgetPartial } from "./widget-states";

describe("widget states", () => {
  it("empty shows the hint copy", () => {
    render(<WidgetEmpty hint="No transactions yet" />);
    expect(screen.getByText("No transactions yet")).toBeTruthy();
  });
  it("error shows a retry affordance when onRetry is given", () => {
    render(<WidgetError onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
  it("partial renders children plus the partial banner reason", () => {
    render(<WidgetPartial reason="Some accounts not synced"><div>body</div></WidgetPartial>);
    expect(screen.getByText("body")).toBeTruthy();
    expect(screen.getByText(/Some accounts not synced/)).toBeTruthy();
  });
});
