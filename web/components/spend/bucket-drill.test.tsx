import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DrillNavContext } from "./drill-nav";
import { BucketDrillBody } from "./bucket-drill";

const txns = [
  { id: "t1", merchant: "Costco", amount: -50, txn_date: "2026-06-11", currency: "USD" },
  { id: "t2", merchant: "Rent", amount: -900, txn_date: "2026-06-20", currency: "USD" },
] as any;

it("lists only in-range txns and pushes a transaction frame on click", () => {
  const push = vi.fn();
  render(
    <DrillNavContext.Provider value={{ push, pop: vi.fn(), depth: 2 }}>
      <BucketDrillBody from="2026-06-11" to="2026-06-11" txns={txns} currency="USD" />
    </DrillNavContext.Provider>,
  );
  expect(screen.queryByText(/Rent/)).toBeNull();
  screen.getByRole("button", { name: /Costco/ }).click();
  expect(push).toHaveBeenCalledWith({ kind: "transaction", id: "t1" });
});
