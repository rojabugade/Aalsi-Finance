import { describe, it, expect } from "vitest";
import { maskMoney, shouldHoverReveal, shouldMaskNames } from "./privacy";

describe("privacy", () => {
  it("passes money through when off, masks otherwise", () => {
    expect(maskMoney("$1,234", "off")).toBe("$1,234");
    expect(maskMoney("$1,234", "privacy")).toBe("•••••");
    expect(maskMoney("$1,234", "screenshot")).toBe("•••••");
  });
  it("only allows hover-reveal at the lightest level", () => {
    expect(shouldHoverReveal("privacy")).toBe(true);
    expect(shouldHoverReveal("presentation")).toBe(false);
    expect(shouldHoverReveal("screenshot")).toBe(false);
  });
  it("masks names at every level above off", () => {
    expect(shouldMaskNames("off")).toBe(false);
    expect(shouldMaskNames("privacy")).toBe(true);
  });
});
