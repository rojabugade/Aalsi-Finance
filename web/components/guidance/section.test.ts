import { describe, expect, it } from "vitest";

import { guidanceSection } from "./section";
import { hrefMatches } from "@/components/shell/top-tabs";

describe("guidanceSection", () => {
  it.each([
    ["", "overview"],
    ["?section=overview", "overview"],
    ["?section=cross-border", "cross-border"],
    ["?section=plan", "plan"],
    ["?section=unknown", "overview"],
    ["?tab=plan", "plan"],
  ] as const)("parses %s as %s", (query, expected) => {
    expect(guidanceSection(new URLSearchParams(query))).toBe(expected);
  });

  it("prefers a valid section over the legacy alias", () => {
    expect(guidanceSection(new URLSearchParams("section=cross-border&tab=plan"))).toBe(
      "cross-border",
    );
  });

  it("keeps the legacy My Plan URL aligned with shell tab selection", () => {
    expect(hrefMatches("/guidance?section=plan", "/guidance", "tab=plan")).toBe(true);
    expect(hrefMatches("/guidance", "/guidance", "tab=plan")).toBe(false);
  });
});
