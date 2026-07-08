import { describe, expect, it, vi } from "vitest";
import { makeActionHandler } from "./action-handlers";

function dependencies() {
  return { controller: { addWidget: vi.fn() }, openPersonalize: vi.fn(), focusWidget: vi.fn(), snooze: vi.fn(), dismiss: vi.fn() };
}

describe("makeActionHandler", () => {
  it("maps create and focus actions", () => {
    const deps = dependencies();
    const run = makeActionHandler(deps);
    run({ type: "create_widget", label: "Create", params: { widget: "breakdown" } });
    run({ type: "focus_widget", label: "Focus", params: { widget: "cashflow" } });
    expect(deps.controller.addWidget).toHaveBeenCalledWith("breakdown");
    expect(deps.focusWidget).toHaveBeenCalledWith("cashflow");
  });
});
