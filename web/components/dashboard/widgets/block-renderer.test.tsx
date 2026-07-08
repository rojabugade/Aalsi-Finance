import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockRenderer } from "./block-renderer";
import type { Block } from "@/lib/dashboard/blocks";
import type { Tier } from "@/lib/dashboard/tier";

const listTier: Tier = { kind: "list", form: null, rows: 5, extras: false, chartPx: 0 };

describe("BlockRenderer — stat block", () => {
  it("renders label and value", () => {
    render(<BlockRenderer blocks={[{ kind: "stat", label: "Net Worth", value: "$12,000" }]} />);
    expect(screen.getByText("Net Worth")).toBeTruthy();
    expect(screen.getByText("$12,000")).toBeTruthy();
  });
  it("outer wrapper has h-full flex-col", () => {
    const { container } = render(<BlockRenderer blocks={[{ kind: "stat", label: "L", value: "V" }]} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("h-full");
    expect(wrapper.className).toContain("flex-col");
  });
  it("applies data-block-kind=stat", () => {
    const { container } = render(<BlockRenderer blocks={[{ kind: "stat", label: "L", value: "V" }]} />);
    expect(container.querySelector('[data-block-kind="stat"]')).toBeTruthy();
  });
  it("renders optional hint", () => {
    render(<BlockRenderer blocks={[{ kind: "stat", label: "L", value: "V", hint: "hint text" }]} />);
    expect(screen.getByText("hint text")).toBeTruthy();
  });
});

describe("BlockRenderer — list block", () => {
  it("renders row labels", () => {
    const block: Block = { kind: "list", rows: [{ kind: "row", label: "Amazon", value: "$200" }, { kind: "row", label: "Uber", value: "$30" }] };
    render(<BlockRenderer blocks={[block]} tier={listTier} />);
    expect(screen.getByText("Amazon")).toBeTruthy();
    expect(screen.getByText("Uber")).toBeTruthy();
  });
  it("applies data-block-kind=list", () => {
    const block: Block = { kind: "list", rows: [{ kind: "row", label: "A", value: "B" }] };
    const { container } = render(<BlockRenderer blocks={[block]} tier={listTier} />);
    expect(container.querySelector('[data-block-kind="list"]')).toBeTruthy();
  });
  it("caps rows to tier.rows", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ kind: "row" as const, label: `Row ${i}`, value: "$1" }));
    render(<BlockRenderer blocks={[{ kind: "list", rows }]} tier={{ ...listTier, rows: 3 }} />);
    expect(screen.queryByText("Row 3")).toBeNull();
    expect(screen.getByText("Row 0")).toBeTruthy();
    expect(screen.getByText("Row 2")).toBeTruthy();
  });
  it("list block has flex-1 min-h-0", () => {
    const block: Block = { kind: "list", rows: [{ kind: "row", label: "A", value: "B" }] };
    const { container } = render(<BlockRenderer blocks={[block]} tier={listTier} />);
    const listEl = container.querySelector('[data-block-kind="list"]') as HTMLElement;
    expect(listEl.className).toContain("flex-1");
    expect(listEl.className).toContain("min-h-0");
  });
});

describe("BlockRenderer — bars block", () => {
  it("renders each bar label and value", () => {
    const block: Block = { kind: "bars", rows: [{ label: "Food", value: "$400", pct: 40, color: "var(--accent)" }, { label: "Travel", value: "$200", pct: 20 }] };
    render(<BlockRenderer blocks={[block]} />);
    expect(screen.getByText("Food")).toBeTruthy();
    expect(screen.getByText("Travel")).toBeTruthy();
  });
  it("applies data-block-kind=bars", () => {
    const block: Block = { kind: "bars", rows: [{ label: "X", value: "$1", pct: 10 }] };
    const { container } = render(<BlockRenderer blocks={[block]} />);
    expect(container.querySelector('[data-block-kind="bars"]')).toBeTruthy();
  });
});

describe("BlockRenderer — donut block", () => {
  it("renders slice labels when legend=true", () => {
    const block: Block = { kind: "donut", slices: [{ label: "Amazon", value: "$320", pct: 78 }, { label: "Other", value: "$90", pct: 22 }], legend: true };
    render(<BlockRenderer blocks={[block]} />);
    expect(screen.getByText("Amazon")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
  });
  it("applies data-block-kind=donut", () => {
    const block: Block = { kind: "donut", slices: [{ label: "X", value: "$1", pct: 100 }] };
    const { container } = render(<BlockRenderer blocks={[block]} />);
    expect(container.querySelector('[data-block-kind="donut"]')).toBeTruthy();
  });
});

describe("BlockRenderer — area block", () => {
  it("renders an SVG for area points", () => {
    const block: Block = { kind: "area", points: [10, 20, 15, 30, 25] };
    const { container } = render(<BlockRenderer blocks={[block]} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
  it("applies data-block-kind=area", () => {
    const block: Block = { kind: "area", points: [1, 2, 3] };
    const { container } = render(<BlockRenderer blocks={[block]} />);
    expect(container.querySelector('[data-block-kind="area"]')).toBeTruthy();
  });
});

describe("BlockRenderer — section block", () => {
  it("renders the section label and nested blocks", () => {
    const block: Block = { kind: "section", label: "Top spend", blocks: [{ kind: "stat", label: "L", value: "V" }] };
    render(<BlockRenderer blocks={[block]} />);
    expect(screen.getByText("Top spend")).toBeTruthy();
    expect(screen.getByText("V")).toBeTruthy();
  });
});
