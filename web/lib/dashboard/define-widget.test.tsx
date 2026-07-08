import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { defineWidget } from "./define-widget";
import type { Block } from "./blocks";
import type { RenderCtx, WidgetContract } from "./widget-contract";

function makeCtx(overrides: Partial<RenderCtx<unknown>> = {}): RenderCtx<unknown> {
  return { data: {}, config: { preset: "standard" }, density: 1, w: 5, h: 2, ...overrides };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Wrapper({ contract, ctx }: { contract: WidgetContract<any>; ctx: RenderCtx<any> }) {
  return <>{contract.Body(ctx)}</>;
}

describe("defineWidget — routing", () => {
  it("routes to view.stat when compact preset", () => {
    const statMock = vi.fn((): Block[] => [{ kind: "stat", label: "L", value: "V" }]);
    const contract = defineWidget({ data: () => ({ status: "ready", data: {} }), view: { stat: statMock, list: () => [] } });
    render(<Wrapper contract={contract} ctx={makeCtx({ config: { preset: "compact" } })} />);
    expect(statMock).toHaveBeenCalledTimes(1);
  });

  it("routes to view.list when no supportedForms", () => {
    const listMock = vi.fn((): Block[] => [{ kind: "list", rows: [{ kind: "row", label: "A" }] }]);
    const contract = defineWidget({ data: () => ({ status: "ready", data: {} }), view: { stat: () => [], list: listMock } });
    render(<Wrapper contract={contract} ctx={makeCtx({ w: 5, h: 2 })} />);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("routes to view.chart when donut supported and capacity allows", () => {
    const chartMock = vi.fn((): Block[] => [{ kind: "donut", slices: [{ label: "X", value: "$1", pct: 100 }] }]);
    const contract = defineWidget({
      data: () => ({ status: "ready", data: {} }),
      supportedForms: ["donut", "list"],
      view: { stat: () => [], list: () => [], chart: chartMock },
    });
    render(<Wrapper contract={contract} ctx={makeCtx({ w: 5, h: 2, config: { preset: "standard", chart: "donut" } })} />);
    expect(chartMock).toHaveBeenCalledTimes(1);
  });

  it("passes tier to list view", () => {
    let capturedTier: unknown;
    const contract = defineWidget({
      data: () => ({ status: "ready", data: {} }),
      view: {
        stat: () => [],
        list: (_, tier) => { capturedTier = tier; return []; },
      },
    });
    render(<Wrapper contract={contract} ctx={makeCtx({ w: 5, h: 2 })} />);
    expect(capturedTier).toBeDefined();
    expect((capturedTier as { kind: string }).kind).toBe("list");
  });

  it("passes tier.form to chart view", () => {
    let capturedForm: unknown;
    const contract = defineWidget({
      data: () => ({ status: "ready", data: {} }),
      supportedForms: ["donut"],
      view: {
        stat: () => [],
        list: () => [],
        chart: (_, tier) => { capturedForm = tier.form; return []; },
      },
    });
    render(<Wrapper contract={contract} ctx={makeCtx({ w: 5, h: 2, config: { preset: "standard", chart: "donut" } })} />);
    expect(capturedForm).toBe("donut");
  });

  it("exposes insights as deriveInsights on the returned contract", () => {
    const contract = defineWidget({
      data: () => ({ status: "ready", data: "hello" }),
      insights: (vm) => [{ label: String(vm), tone: "positive" }],
      view: { stat: () => [], list: () => [] },
    });
    const chips = contract.deriveInsights?.("hello", {}) ?? [];
    expect(chips[0].label).toBe("hello");
  });
});
