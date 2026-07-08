import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DrillNavContext } from "./drill-nav";
import { MerchantDrillBody } from "./merchant-drill";

const period = { from: "2026-06-01", to: "2026-06-30", prevFrom: null, prevTo: null, buckets: [], granularity: "day", label: "Jun", compareLabel: "" } as any;
const cats = [{ id: "c1", name: "Shopping", parent_id: null }] as any;
const txns = [{ id: "t1", merchant: "Costco", amount: -50, txn_date: "2026-06-10", currency: "USD", category_id: "c1" }] as any;

it("pushes a transaction frame from a transaction row", () => {
  const push = vi.fn();
  render(
    <DrillNavContext.Provider value={{ push, pop: vi.fn(), depth: 1 }}>
      <MerchantDrillBody merchant="Costco" txns={txns} cats={cats} currency="USD" period={period} />
    </DrillNavContext.Provider>,
  );
  screen.getAllByRole("button").find((b) => /2026-06-10/.test(b.textContent ?? ""))!.click();
  expect(push).toHaveBeenCalledWith({ kind: "transaction", id: "t1" });
});
