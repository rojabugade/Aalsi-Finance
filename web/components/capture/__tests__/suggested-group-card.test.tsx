import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestedGroupCard } from "@/components/capture/suggested-group-card";
import type { ReviewGroup } from "@/lib/api/review";

const group = {
  member_document_ids: ["a", "b"],
  suggested: {
    document_id: "a", type: "receipt", status: "needs_review",
    confidence: 0.5, summary: { merchant: "Walmart", total: "42.10" },
    data: { merchant: "Walmart", total: "42.10" }, reasons: [], batch_id: "b1",
  },
  members: [
    { document_id: "a", type: "receipt", status: "needs_review", summary: {}, data: { merchant: "Walmart" }, reasons: [], batch_id: "b1", confidence: 0.5 },
    { document_id: "b", type: "receipt", status: "needs_review", summary: {}, data: { total: "42.10" }, reasons: [], batch_id: "b1", confidence: 0.5 },
  ],
} as unknown as ReviewGroup;

describe("SuggestedGroupCard", () => {
  it("confirms the whole group with member ids", () => {
    const onConfirm = vi.fn();
    render(<SuggestedGroupCard group={group} pending={false} onConfirm={onConfirm} onSplitResolve={vi.fn()} />);
    expect(screen.getByText(/Walmart/)).toBeTruthy();
    expect(screen.getByText(/from 2 images/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith(["a", "b"]);
  });

  it("expands to individual cards on split", () => {
    render(<SuggestedGroupCard group={group} pending={false} onConfirm={vi.fn()} onSplitResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /split apart/i }));
    expect(screen.getAllByRole("button", { name: /confirm/i }).length).toBeGreaterThanOrEqual(2);
  });
});
