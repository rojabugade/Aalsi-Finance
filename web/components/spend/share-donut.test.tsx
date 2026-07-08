import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShareDonut } from "./share-donut";

const rows = [
  { id: "c1", name: "Shopping", total: 300, prev: 0, deltaPct: null },
  { id: "c2", name: "Travel", total: 100, prev: 0, deltaPct: null },
] as any;

it("calls onSliceClick with the category id from a legend row", () => {
  const onSliceClick = vi.fn();
  render(<ShareDonut rows={rows} currency="USD" onSliceClick={onSliceClick} />);
  screen.getByRole("button", { name: /shopping/i }).click();
  expect(onSliceClick).toHaveBeenCalledWith("c1");
});
