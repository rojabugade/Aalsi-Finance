import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmCard } from "./confirm-card";

const item = {
  document_id: "doc-1", type: "receipt", status: "needs_review",
  confidence: 0.95, summary: { merchant: "Trader Joe's", total: "42.10" },
  data: { merchant: "Trader Joe's", total: "42.10", currency: "USD", date: "2026-06-01", line_items: [] },
  reasons: [],
};

describe("ConfirmCard", () => {
  it("confirms with edited total", () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmCard item={item as never} onResolve={onResolve} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /fix/i }));
    fireEvent.change(screen.getByLabelText(/total/i), { target: { value: "43.00" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onResolve).toHaveBeenCalledWith("confirm", expect.objectContaining({ total: "43.00" }));
  });

  it("rejects", () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmCard item={item as never} onResolve={onResolve} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onResolve).toHaveBeenCalledWith("reject");
  });
});
