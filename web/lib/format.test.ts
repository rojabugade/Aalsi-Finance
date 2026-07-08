import { describe, expect, it } from "vitest";
import { formatDateShort, formatRelativeDueDate, toFinite } from "./format";

describe("toFinite", () => {
  it("passes finite numbers through", () => {
    expect(toFinite(12.5)).toBe(12.5);
    expect(toFinite("3")).toBe(3);
  });
  it("coerces non-finite values to 0", () => {
    expect(toFinite(NaN)).toBe(0);
    expect(toFinite(undefined)).toBe(0);
    expect(toFinite(null)).toBe(0);
    expect(toFinite(Infinity)).toBe(0);
  });
});

describe("date formatting", () => {
  const now = new Date(2026, 5, 23, 12);

  it("formats relative due dates", () => {
    expect(formatRelativeDueDate("2026-06-23", now)).toBe("Due today");
    expect(formatRelativeDueDate("2026-06-24", now)).toBe("Due tomorrow");
    expect(formatRelativeDueDate("2026-06-28", now)).toBe("Due in 5 days");
    expect(formatRelativeDueDate("2026-06-22", now)).toBe("1 day overdue");
    expect(formatRelativeDueDate("2026-06-20", now)).toBe("3 days overdue");
  });

  it("formats absolute dates without UTC day shifts", () => {
    expect(formatDateShort("2026-07-21")).toBe("Jul 21, 2026");
  });
});
