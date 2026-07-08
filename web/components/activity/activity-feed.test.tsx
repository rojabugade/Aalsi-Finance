import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityFeed } from "./activity-feed";

const notifications = [
  {
    id: "n1",
    type: "loan_due",
    status: "queued",
    scheduled_for: new Date().toISOString(),
    payload: { due_date: "2026-07-10", installment_no: 4 },
  },
  {
    id: "n2",
    type: "document_review",
    status: "queued",
    scheduled_for: new Date().toISOString(),
    payload: {},
  },
];

vi.mock("@/lib/api/notifications", () => ({
  useNotifications: () => ({ data: notifications, isLoading: false, isError: false }),
  useMarkRead: () => ({ mutate: vi.fn() }),
}));

describe("ActivityFeed", () => {
  it("pins payment-due items in the upcoming strip, not the history feed", () => {
    render(<ActivityFeed />);
    const upcoming = screen.getByTestId("upcoming-payments");
    expect(upcoming).toHaveTextContent("Payment due");
    const history = screen.getByTestId("activity-feed");
    expect(history).not.toHaveTextContent("Payment due");
    expect(history).toHaveTextContent("Receipt needs review");
  });
});
