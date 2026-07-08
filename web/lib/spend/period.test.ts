import { describe, expect, it } from "vitest";
import {
  addDays,
  asCalendarMonth,
  bucketKeyForDate,
  bucketRange,
  enumerateBuckets,
  granularityFor,
  inRange,
  resolvePeriod,
} from "./period";

// Fixed "now": Tue 23 Jun 2026 (local).
const NOW = new Date(2026, 5, 23);

describe("addDays", () => {
  it("steps across month boundaries", () => {
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("inRange", () => {
  it("is inclusive on both ends and tolerates ISO timestamps", () => {
    expect(inRange("2026-06-01", "2026-06-01", "2026-06-30")).toBe(true);
    expect(inRange("2026-06-30T12:00:00Z", "2026-06-01", "2026-06-30")).toBe(true);
    expect(inRange("2026-05-31", "2026-06-01", "2026-06-30")).toBe(false);
    expect(inRange("2026-07-01", "2026-06-01", "2026-06-30")).toBe(false);
  });
});

describe("granularityFor", () => {
  it("picks day / week / month from span length", () => {
    expect(granularityFor("2026-06-01", "2026-06-23")).toBe("day"); // 23d (<=31)
    expect(granularityFor("2026-04-01", "2026-06-23")).toBe("week"); // ~84d (<=92)
    expect(granularityFor("2026-01-01", "2026-06-23")).toBe("month"); // ~174d
  });
});

describe("resolvePeriod", () => {
  it("month preset = first-of-month .. today, compares to full previous calendar month", () => {
    const p = resolvePeriod("month", undefined, undefined, NOW);
    expect(p.from).toBe("2026-06-01");
    expect(p.to).toBe("2026-06-23");
    expect(p.prevFrom).toBe("2026-05-01");
    expect(p.prevTo).toBe("2026-05-31");
    expect(p.label).toBe("June 2026");
    expect(p.compareLabel).toBe("vs prev month");
    expect(p.granularity).toBe("day");
  });

  it("30d preset = trailing 30 days with the prior 30 as comparison", () => {
    const p = resolvePeriod("30d", undefined, undefined, NOW);
    expect(p.to).toBe("2026-06-23");
    expect(p.from).toBe("2026-05-25"); // 30 days inclusive
    expect(p.prevTo).toBe("2026-05-24");
    expect(p.prevFrom).toBe("2026-04-25");
    expect(p.label).toBe("Last 30 days");
  });

  it("90d preset spans a week granularity", () => {
    const p = resolvePeriod("90d", undefined, undefined, NOW);
    expect(p.from).toBe("2026-03-26");
    expect(p.granularity).toBe("week");
  });

  it("ytd preset starts Jan 1 of the current year", () => {
    const p = resolvePeriod("ytd", undefined, undefined, NOW);
    expect(p.from).toBe("2026-01-01");
    expect(p.to).toBe("2026-06-23");
  });

  it("all preset has no comparison window", () => {
    const p = resolvePeriod("all", undefined, undefined, NOW);
    expect(p.prevFrom).toBeNull();
    expect(p.compareLabel).toBeNull();
    expect(p.to).toBe("2026-06-23");
  });

  it("custom preset uses the supplied bounds and an equal-length comparison", () => {
    const p = resolvePeriod("custom", "2026-04-01", "2026-04-10", NOW);
    expect(p.from).toBe("2026-04-01");
    expect(p.to).toBe("2026-04-10");
    expect(p.prevTo).toBe("2026-03-31");
    expect(p.prevFrom).toBe("2026-03-22"); // 10-day window
    expect(p.compareLabel).toBe("vs prev period");
  });

  it("a custom range that is exactly a calendar month is labelled as that month", () => {
    const p = resolvePeriod("custom", "2026-05-01", "2026-05-31", NOW);
    expect(p.label).toBe("May 2026");
  });
});

describe("asCalendarMonth", () => {
  it("detects a full calendar month and rejects partial ranges", () => {
    expect(asCalendarMonth("2026-05-01", "2026-05-31")).toBe("2026-05");
    expect(asCalendarMonth("2026-06-01", "2026-06-23")).toBeNull();
  });
});

describe("enumerateBuckets + bucketKeyForDate", () => {
  it("daily buckets cover each day and map dates correctly", () => {
    const buckets = enumerateBuckets("2026-06-01", "2026-06-03", "day");
    expect(buckets.map((b) => b.key)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(bucketKeyForDate("2026-06-02", "2026-06-01", "day")).toBe("2026-06-02");
  });

  it("monthly buckets collapse a date to YYYY-MM", () => {
    const buckets = enumerateBuckets("2026-01-15", "2026-03-02", "month");
    expect(buckets.map((b) => b.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(bucketKeyForDate("2026-02-18", "2026-01-15", "month")).toBe("2026-02");
  });

  it("weekly buckets are 7-day chunks anchored at `from`", () => {
    const buckets = enumerateBuckets("2026-06-01", "2026-06-20", "week");
    expect(buckets.map((b) => b.key)).toEqual(["2026-06-01", "2026-06-08", "2026-06-15"]);
    expect(bucketKeyForDate("2026-06-10", "2026-06-01", "week")).toBe("2026-06-08");
  });
});

describe("bucketRange", () => {
  it("maps a day key to a single-day inclusive range", () => {
    expect(bucketRange("2026-06-11", "day")).toEqual({
      from: "2026-06-11", to: "2026-06-11", label: "2026-06-11",
    });
  });
  it("maps a week key to a 7-day inclusive range", () => {
    expect(bucketRange("2026-06-01", "week")).toEqual({
      from: "2026-06-01", to: "2026-06-07", label: "2026-06-01",
    });
  });
  it("maps a month key to a full-month inclusive range", () => {
    expect(bucketRange("2026-02", "month")).toEqual({
      from: "2026-02-01", to: "2026-02-28", label: "2026-02",
    });
  });
});
