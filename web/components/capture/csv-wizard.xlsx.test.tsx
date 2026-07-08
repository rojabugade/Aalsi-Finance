import { describe, expect, it } from "vitest";
import { isSpreadsheetFile } from "./csv-wizard";

describe("isSpreadsheetFile", () => {
  it("accepts csv and xlsx", () => {
    expect(isSpreadsheetFile(new File([""], "a.csv"))).toBe(true);
    expect(isSpreadsheetFile(new File([""], "a.xlsx"))).toBe(true);
    expect(isSpreadsheetFile(new File([""], "a.png"))).toBe(false);
  });
});
