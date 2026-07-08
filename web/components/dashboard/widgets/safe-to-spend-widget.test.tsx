import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/lib/api/cashflow", () => ({
  useCashflowSummary: () => ({
    status: "success",
    data: { leftover_monthly: "1240.00", currency: "USD" },
    isLoading: false,
    isError: false,
    isSuccess: true,
  }),
}));

import { safeToSpendContract } from "./safe-to-spend-widget";

describe("safeToSpendContract.deriveInsights", () => {
  it("warns when nothing is safe to spend", () => {
    const chips = safeToSpendContract.deriveInsights!({ safe: 0, value: "$0", currency: "USD" }, {});
    expect(chips.some((chip) => chip.tone === "warning")).toBe(true);
  });

  it("is positive when there is headroom", () => {
    const chips = safeToSpendContract.deriveInsights!({ safe: 240, value: "$240", currency: "USD" }, {});
    expect(chips.some((chip) => chip.tone === "positive")).toBe(true);
  });
});

describe("safeToSpendContract.useData", () => {
  it("derives the safe amount from cashflow leftover", () => {
    const { result } = renderHook(() => safeToSpendContract.useData({}));
    expect(result.current.status).toBe("ready");
    expect(result.current.data?.safe).toBe(1240);
    expect(result.current.data?.value).toContain("1,240");
  });
});
