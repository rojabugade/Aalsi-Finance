import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/dashboard/analyst/use-analyst", () => ({
  useAnalyst: () => ({ setFocus: vi.fn(), clearFocus: vi.fn(), openPane: vi.fn() }),
}));

import { DrillStack } from "./drill-stack";

beforeAll(() => {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
  })) as any;
});

const period = { from: "2026-06-01", to: "2026-06-30", prevFrom: null, prevTo: null, buckets: [], granularity: "day", label: "Jun", compareLabel: "" } as any;
const cats = [{ id: "c1", name: "Shopping", parent_id: null }] as any;
const txns = [{ id: "t1", merchant: "Costco", amount: -50, txn_date: "2026-06-10", currency: "USD", category_id: "c1", status: "confirmed", line_items: [] }] as any;

function renderStack(onClose = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <DrillStack rootFrame={{ kind: "category", id: "c1" }} rootBackLabel="Categories"
        onClose={onClose} txns={txns} cats={cats} currency="USD" period={period} />
    </QueryClientProvider>,
  );
  return onClose;
}

it("opens at the root frame title", () => {
  renderStack();
  expect(screen.getByText("Shopping")).toBeInTheDocument();
});

it("closes via the back control at depth 1", () => {
  const onClose = renderStack();
  fireEvent.click(screen.getByRole("button", { name: /Categories/ }));
  expect(onClose).toHaveBeenCalled();
});

it("pushes a transaction frame, then back returns to the parent", () => {
  renderStack();
  const txnRow = screen.getAllByRole("button").find((b) => /2026-06-10/.test(b.textContent ?? ""))!;
  fireEvent.click(txnRow);
  expect(screen.getByDisplayValue("Costco")).toBeInTheDocument(); // detail editor visible
  fireEvent.click(screen.getByRole("button", { name: /Shopping/ })); // back label = parent title
  expect(screen.getByText("Shopping")).toBeInTheDocument();
});
