import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssetsSection } from "./assets-section";

vi.mock("@/lib/api/widget-data", () => ({
  useHoldings: () => ({
    data: [{ id: "1", name: "VTI", latest_valuation: { value: "48000" } }],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/lib/api/analytics", () => ({
  useNetWorth: () => ({
    data: { net_worth: "61000", currency: "USD" },
    isLoading: false,
    isError: false,
  }),
}));

describe("AssetsSection", () => {
  it("renders holdings total and net worth", () => {
    render(<AssetsSection />);
    expect(screen.getByText(/Assets/i)).toBeInTheDocument();
    expect(screen.getByText(/48,000/)).toBeInTheDocument();
    expect(screen.getByText(/61,000/)).toBeInTheDocument();
  });
});
