import { describe, it, expect } from "vitest";
import { appearanceVars } from "./appearance";

describe("appearanceVars", () => {
  it("maps prefs to css vars; null accent omits the override", () => {
    const v = appearanceVars({ radius: 16, glass: 30, shadow: 50, accent: null } as any);
    expect(v["--board-radius"]).toBe("16px");
    expect(v["--board-glass"]).toBe("0.3");
    expect(v["--board-shadow"]).toBe("0.5");
    expect(v["--accent"]).toBeUndefined();
  });
  it("includes accent override when set", () => {
    expect(appearanceVars({ radius: 0, glass: 0, shadow: 0, accent: "#ff0000" } as any)["--accent"]).toBe("#ff0000");
  });
});
