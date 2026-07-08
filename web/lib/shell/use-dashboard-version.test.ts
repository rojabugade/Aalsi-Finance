import { describe, expect, it } from "vitest";
import { appVersion, versionedHref } from "./use-dashboard-version";

describe("app version preference", () => {
  it("derives the active version from dashboard and spend routes", () => {
    expect(appVersion("/dashboard")).toBe("new");
    expect(appVersion("/transactions")).toBe("new");
    expect(appVersion("/dashboard/classic")).toBe("classic");
    expect(appVersion("/transactions/classic")).toBe("classic");
    expect(appVersion("/analytics")).toBeNull();
  });

  it("maps a saved version to both versioned surfaces", () => {
    expect(versionedHref("/dashboard", "classic")).toBe("/dashboard/classic");
    expect(versionedHref("/transactions", "classic")).toBe("/transactions/classic");
    expect(versionedHref("/dashboard", "new")).toBe("/dashboard");
    expect(versionedHref("/transactions", "new")).toBe("/transactions");
  });
});
