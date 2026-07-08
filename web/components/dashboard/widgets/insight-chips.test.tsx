import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightChips } from "./insight-chips";

const chips = [
  { label: "low", severity: 1 },
  { label: "high", severity: 9 },
  { label: "mid", severity: 5 },
];

describe("InsightChips", () => {
  it("caps the number of chips shown", () => {
    render(<InsightChips insights={chips} cap={2} />);
    expect(screen.queryByText("low")).toBeNull();
    expect(screen.getByText("high")).toBeTruthy();
    expect(screen.getByText("mid")).toBeTruthy();
  });
  it("renders nothing when there are no insights", () => {
    const { container } = render(<InsightChips insights={[]} cap={3} />);
    expect(container.firstChild).toBeNull();
  });
});
