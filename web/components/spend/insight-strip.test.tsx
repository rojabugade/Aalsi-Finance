import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightStrip } from "./insight-strip";

const mover = { id: "c1", name: "Groceries", total: 300, prev: 130, deltaPct: 129 } as any;
const unusual = { id: "t9", merchant: "United Airlines", amount: -500, currency: "USD" } as any;

it("fires onMover and onLargest with the right ids", () => {
  const onMover = vi.fn(); const onLargest = vi.fn();
  render(
    <InsightStrip spent={3006} prevSpent={4000} mover={mover} unusual={unusual}
      dailyAvg={130} incomePct={22} currency="USD" onMover={onMover} onLargest={onLargest} />,
  );
  screen.getByRole("button", { name: /Top mover/i }).click();
  screen.getByRole("button", { name: /Largest purchase/i }).click();
  expect(onMover).toHaveBeenCalledWith("c1");
  expect(onLargest).toHaveBeenCalledWith("t9");
});
