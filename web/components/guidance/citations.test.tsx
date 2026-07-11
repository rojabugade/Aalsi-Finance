import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Citations } from "./citations";

describe("Citations", () => {
  it("renders numbered sources with explicit type and effective date", () => {
    render(
      <Citations
        citations={[
          {
            title: "IRS foreign account reporting",
            source_url: "https://www.irs.gov/businesses/comparison-of-form-8938-and-fbar-requirements",
            source_type: "Government guidance",
            effective_date: "2026-01-01",
          },
          {
            title: "Treaty summary",
            source_type: "Treaty",
            effective_date: "2025-12-31",
          },
        ]}
      />,
    );

    expect(screen.getByText("[1] IRS foreign account reporting")).toBeInTheDocument();
    expect(screen.getByText("[2] Treaty summary")).toBeInTheDocument();
    expect(screen.getByText("Government guidance")).toBeInTheDocument();
    expect(screen.getByText("Treaty")).toBeInTheDocument();
    expect(screen.getByText("Effective 2026-01-01")).toBeInTheDocument();
    expect(screen.getByText("Effective 2025-12-31")).toBeInTheDocument();
  });

  it("labels missing dates and protects external links", () => {
    render(
      <Citations
        citations={[
          {
            title: "Central bank notice",
            source_url: "https://example.com/notice",
            source_type: "Regulator",
          },
        ]}
      />,
    );

    expect(screen.getByText("Date unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "[1] Central bank notice" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: "[1] Central bank notice" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("renders nothing for an empty source list", () => {
    const { container } = render(<Citations citations={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
