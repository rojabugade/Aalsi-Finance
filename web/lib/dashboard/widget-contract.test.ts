import { describe, expect, it } from "vitest";
import { queryState } from "./widget-contract";

const base = { isLoading: false, isError: false, error: undefined, data: undefined as number[] | undefined };

describe("queryState", () => {
  it("reports loading while the query is loading", () => {
    const s = queryState({ ...base, isLoading: true }, { select: (r: number[]) => r, isEmpty: (t) => t.length === 0 });
    expect(s.status).toBe("loading");
  });
  it("reports error on query error", () => {
    const s = queryState({ ...base, isError: true, error: new Error("x") }, { select: (r: number[]) => r, isEmpty: (t) => t.length === 0 });
    expect(s.status).toBe("error");
    expect(s.error).toBeInstanceOf(Error);
  });
  it("treats absent data (still fetching) as loading", () => {
    const s = queryState(base, { select: (r: number[]) => r, isEmpty: (t) => t.length === 0 });
    expect(s.status).toBe("loading");
  });
  it("reports empty when the selected data is empty", () => {
    const s = queryState({ ...base, data: [] }, { select: (r: number[]) => r, isEmpty: (t) => t.length === 0 });
    expect(s.status).toBe("empty");
  });
  it("reports ready with selected data", () => {
    const s = queryState({ ...base, data: [1, 2] }, { select: (r: number[]) => r, isEmpty: (t) => t.length === 0 });
    expect(s.status).toBe("ready");
    expect(s.data).toEqual([1, 2]);
  });
  it("reports partial with a reason when partialReason returns a string", () => {
    const s = queryState(
      { ...base, data: [1] },
      { select: (r: number[]) => r, isEmpty: (t) => t.length === 0, partialReason: () => "Stale since 9:00" },
    );
    expect(s.status).toBe("partial");
    expect(s.partialReason).toBe("Stale since 9:00");
    expect(s.data).toEqual([1]);
  });
});
