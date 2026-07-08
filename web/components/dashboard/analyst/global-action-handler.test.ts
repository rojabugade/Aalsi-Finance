import { describe, expect, it, vi } from "vitest";
import { makeGlobalActionHandler } from "./global-action-handler";

it("routes dashboard-only actions to /dashboard", () => {
  const push = vi.fn();
  const handler = makeGlobalActionHandler({ router: { push } as any });
  handler({ type: "open_personalize", label: "x", params: {} } as any);
  expect(push).toHaveBeenCalledWith("/dashboard");
});

it("ignores alert dismissals (handled by the monitor feed)", () => {
  const push = vi.fn();
  const handler = makeGlobalActionHandler({ router: { push } as any });
  handler({ type: "dismiss_alert", label: "x", params: { id: "a1" } } as any);
  expect(push).not.toHaveBeenCalled();
});
