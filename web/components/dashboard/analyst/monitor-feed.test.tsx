import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PersistentAlert } from "@/lib/api/analyst";
import { AlertList } from "./monitor-feed";

const alerts: PersistentAlert[] = [
  { id: "a1", kind: "budget_overspend", severity: 9, tone: "danger", state: "active",
    title: "Dining over", detail: "Over by $40",
    suggested_action: { type: "set_budget", label: "Adjust", params: {} },
    supporting_refs: [{ source_type: "transaction", source_id: "t1" }] },
  { id: "a2", kind: "insight", severity: 5, tone: "info", state: "acknowledged",
    title: "Subscriptions high", detail: "12% of spend", supporting_refs: [] },
];

describe("AlertList", () => {
  it("acknowledges active alerts and mutes acknowledged ones with sources", () => {
    const onAction = vi.fn();
    const onAcknowledge = vi.fn();
    render(<AlertList alerts={alerts} onAction={onAction} onAcknowledge={onAcknowledge} />);
    // active alert has an Acknowledge button + a Sources line
    screen.getByRole("button", { name: /Acknowledge/i }).click();
    expect(onAcknowledge).toHaveBeenCalledWith("a1");
    expect(screen.getByText(/Sources/i)).toBeInTheDocument();
    // acknowledged alert is still visible but offers no acknowledge button
    expect(screen.getByText("Subscriptions high")).toBeInTheDocument();
  });
});
