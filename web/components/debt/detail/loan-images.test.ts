import { describe, expect, it } from "vitest";
import { loanImage, loanTypeLabel } from "./loan-images";

describe("loanImage", () => {
  it("returns the pexels auto image for auto loans", () => {
    expect(loanImage({ type: "auto" })).toContain("images.pexels.com/photos/35592262");
  });
  it("falls back to the 'other' image for unknown types", () => {
    expect(loanImage({ type: "spaceship" })).toBe(loanImage({ type: "other" }));
  });
});

describe("loanTypeLabel", () => {
  it("humanises known types", () => {
    expect(loanTypeLabel("credit_card")).toBe("Credit card");
    expect(loanTypeLabel("auto")).toBe("Auto");
  });
  it("passes unknown types through", () => {
    expect(loanTypeLabel("weird")).toBe("weird");
  });
});
