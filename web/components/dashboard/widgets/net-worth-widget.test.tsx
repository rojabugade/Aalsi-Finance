import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { netWorthContract } from "./net-worth-widget";
import { PrivacyProvider } from "@/components/dashboard/privacy-provider";

describe("netWorthContract.deriveInsights", () => {
  it("emits a positive-tone chip when net worth rose", () => {
    const chips = netWorthContract.deriveInsights!(
      { value: "$10", delta: 12.3, points: [{ label: "Jan", value: 1 }], months: 6, currency: "USD" },
      {},
    );
    expect(chips.some((c) => c.tone === "positive" && /12/.test(c.label))).toBe(true);
  });
  it("emits a warning-tone chip when net worth fell", () => {
    const chips = netWorthContract.deriveInsights!(
      { value: "$10", delta: -8, points: [], months: 6, currency: "USD" },
      {},
    );
    expect(chips.some((c) => c.tone === "warning")).toBe(true);
  });
});

describe("netWorthContract.Body privacy masking", () => {
  const data = { value: "$156,371.74", compactValue: "$156K", delta: 8, points: [{ label: "Jan", value: 1 }], months: 6, currency: "USD" };
  const ctx = { data, config: {}, density: 1, w: 5, h: 2 } as any;

  it("masks the monetary value under the privacy level", () => {
    render(<PrivacyProvider level="privacy">{netWorthContract.Body(ctx)}</PrivacyProvider>);
    expect(screen.getByText("•••••")).toBeTruthy();
  });

  it("shows the raw value when privacy is off", () => {
    render(<PrivacyProvider level="off">{netWorthContract.Body(ctx)}</PrivacyProvider>);
    expect(screen.getByText("$156,371.74")).toBeTruthy();
  });
});
