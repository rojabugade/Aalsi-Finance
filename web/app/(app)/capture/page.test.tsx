import { describe, expect, it } from "vitest";

import { classifyFile } from "./classify";

describe("classifyFile", () => {
  it("routes spreadsheets to the wizard", () => {
    expect(classifyFile(new File([""], "stmt.csv", { type: "text/csv" }))).toBe("spreadsheet");
    expect(classifyFile(new File([""], "stmt.xlsx"))).toBe("spreadsheet");
  });
  it("routes images and pdfs to document upload", () => {
    expect(classifyFile(new File([""], "r.jpg", { type: "image/jpeg" }))).toBe("doc");
    expect(classifyFile(new File([""], "r.pdf", { type: "application/pdf" }))).toBe("doc");
  });
});
