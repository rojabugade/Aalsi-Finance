import { describe, expect, it } from "vitest";
import type { PersistentAlert } from "@/lib/api/analyst";
import { aiAlertContract } from "./ai-alert-widget";

describe("aiAlertContract.deriveInsights", () => {
  const base = {
    acknowledge: () => {},
    runAction: () => {},
  };

  it("emits a danger chip for a severe monitor alert", () => {
    const alert: PersistentAlert = {
      id: "budget:dining",
      kind: "budget_overspend",
      severity: 9,
      tone: "danger",
      state: "active",
      title: "Dining is over",
      detail: "Over by USD 30.",
      suggested_action: null,
      supporting_refs: [],
    };
    expect(aiAlertContract.deriveInsights!({ ...base, alerts: [alert], top: alert }, {}).some((chip) => chip.tone === "danger")).toBe(true);
  });

  it("emits a positive chip when there are no active alerts", () => {
    expect(aiAlertContract.deriveInsights!({ ...base, alerts: [], top: null }, {}).some((chip) => chip.tone === "positive")).toBe(true);
  });
});
