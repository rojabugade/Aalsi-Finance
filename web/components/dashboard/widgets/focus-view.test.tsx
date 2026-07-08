import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FocusView } from "./focus-view";

describe("FocusView", () => {
  it("renders the title, the body, and the stubbed sections when open", () => {
    render(
      <FocusView open onOpenChange={() => {}} title="Net Worth">
        <div>focus body</div>
      </FocusView>,
    );
    expect(screen.getByText("Net Worth")).toBeTruthy();
    expect(screen.getByText("focus body")).toBeTruthy();
    expect(screen.getByText(/AI explanation/i)).toBeTruthy();
    expect(screen.getByText(/Suggested actions/i)).toBeTruthy();
  });
  it("renders nothing when closed", () => {
    render(
      <FocusView open={false} onOpenChange={() => {}} title="Net Worth">
        <div>focus body</div>
      </FocusView>,
    );
    expect(screen.queryByText("focus body")).toBeNull();
  });
});
