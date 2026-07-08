// ---------------------------------------------------------------------------
// Unified date‑range module — single source of truth for date utilities,
// presets, period resolution, chart buckets, and the URL‑backed hook.
//
// Used by both the dashboard global controls (via dates.ts re‑export) and the
// spend/analytics surfaces (via spend/period.ts re‑export).
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// ===========================================================================
// 1. Core date utilities
// ===========================================================================

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Format a local `Date` as "YYYY-MM-DD". */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse "YYYY-MM-DD" (tolerates ISO timestamps by slicing to the date part). */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** "YYYY-MM-DD" shifted by `n` days (negative = backwards). */
export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86_400_000);
}

/** Inclusive day count of the range `[from, to]`. */
export function spanDays(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

/** Inclusive range test (tolerant of ISO timestamps). */
export function inRange(date: string, from: string, to: string): boolean {
  const d = date.slice(0, 10);
  return d >= from && d <= to;
}

// ===========================================================================
// 2. Calendar‑month helpers
// ===========================================================================

/** "YYYY-MM" for `offset` months from `base` (base may be YYYY-MM or YYYY-MM-DD). */
export function ymOffset(base: string, offset: number): string {
  const [y, m] = base.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** "YYYY-MM" for the current month. */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** "YYYY-MM" → human label e.g. "June 2026". */
export function monthFullLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** First/last day strings for the calendar month containing `date`. */
export function monthBounds(date: string): { first: string; last: string } {
  const d = parseYmd(date);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { first: ymd(first), last: ymd(last) };
}

/** "YYYY-MM" when `[from, to]` is exactly a full calendar month, else `null`. */
export function asCalendarMonth(from: string, to: string): string | null {
  const { first, last } = monthBounds(from);
  return from === first && to === last ? from.slice(0, 7) : null;
}

// ===========================================================================
// 3. Types
// ===========================================================================

export type DateRange = { from: string; to: string };

/** Coarse presets used by the dashboard global‑range dropdown. */
export type RangePreset =
  | "7d"
  | "30d"
  | "1m"
  | "90d"
  | "3m"
  | "6m"
  | "12m"
  | "1y"
  | "2y"
  | "ytd";

/** Finer presets used by the spend/analytics period picker. */
export type PresetKey =
  | "month"
  | "30d"
  | "90d"
  | "qtd"
  | "ytd"
  | "12m"
  | "all"
  | "custom";

export type Granularity = "day" | "week" | "month";

export type Bucket = { key: string; label: string };

export type Period = {
  presetKey: PresetKey;
  from: string;
  to: string;
  prevFrom: string | null;
  prevTo: string | null;
  label: string;
  compareLabel: string | null;
  granularity: Granularity;
  buckets: Bucket[];
};

// ===========================================================================
// 4. Preset definitions
// ===========================================================================

/** Dashboard‑global presets (month‑aligned). */
export const RANGE_PRESETS: {
  value: RangePreset;
  label: string;
  months: number;
}[] = [
  { value: "7d", label: "7 days", months: 1 },
  { value: "30d", label: "30 days", months: 1 },
  { value: "1m", label: "This month", months: 1 },
  { value: "90d", label: "90 days", months: 3 },
  { value: "3m", label: "3 months", months: 3 },
  { value: "6m", label: "6 months", months: 6 },
  { value: "1y", label: "1 year", months: 12 },
  { value: "12m", label: "12 months", months: 12 },
  { value: "2y", label: "2 years", months: 24 },
  { value: "ytd", label: "Year to date", months: 12 },
];

/** Spend‑surface presets. */
export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "qtd", label: "Quarter to date" },
  { key: "ytd", label: "Year to date" },
  { key: "12m", label: "Last 12 months" },
  { key: "all", label: "All time" },
];

// ===========================================================================
// 5. Preset resolution
// ===========================================================================

const shortDay = (s: string) =>
  parseYmd(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

function rangeLabel(from: string, to: string): string {
  const month = asCalendarMonth(from, to);
  if (month) return monthFullLabel(month);
  return `${shortDay(from)} – ${shortDay(to)}`;
}

/** Equal‑length window immediately before `from`. */
function priorWindow(
  from: string,
  to: string,
): { prevFrom: string; prevTo: string } {
  const span = daysBetween(from, to); // inclusive length − 1
  const prevTo = addDays(from, -1);
  return { prevFrom: addDays(prevTo, -span), prevTo };
}

/**
 * Month‑aligned window used by the dashboard global range.
 * Ending on the last day of the current month, spanning `months` months back.
 */
export function presetRange(
  preset: RangePreset,
  now: Date = new Date(),
): DateRange {
  if (preset === "7d" || preset === "30d" || preset === "90d") {
    const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
    const from = new Date(now);
    from.setDate(now.getDate() - (days - 1));
    return { from: ymd(from), to: ymd(now) };
  }
  if (preset === "ytd") {
    return { from: ymd(new Date(now.getFullYear(), 0, 1)), to: ymd(now) };
  }
  const months =
    RANGE_PRESETS.find((p) => p.value === preset)?.months ?? 1;
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day this month
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  return { from: ymd(from), to: ymd(to) };
}

/**
 * Resolve the active spend period from a preset (+ optional custom bounds).
 *
 * `month` compares to the full previous calendar month; other presets compare
 * to the equal‑length window immediately before; `all` has no comparison.
 */
export function resolvePeriod(
  presetKey: PresetKey,
  fromParam?: string,
  toParam?: string,
  now: Date = new Date(),
): Period {
  const today = ymd(now);
  let from: string;
  let to = today;
  let prevFrom: string | null;
  let prevTo: string | null;
  let label: string;
  let compareLabel: string | null = "vs prev period";

  switch (presetKey) {
    case "month": {
      const { first, last } = monthBounds(today);
      from = first;
      const prevMonthDay = addDays(first, -1);
      const pb = monthBounds(prevMonthDay);
      prevFrom = pb.first;
      prevTo = pb.last;
      label = monthFullLabel(first.slice(0, 7));
      compareLabel = "vs prev month";
      void last;
      break;
    }
    case "30d":
    case "90d":
    case "12m": {
      const span =
        presetKey === "30d" ? 30 : presetKey === "90d" ? 90 : 365;
      from = addDays(today, -(span - 1));
      ({ prevFrom, prevTo } = priorWindow(from, to));
      label =
        presetKey === "12m" ? "Last 12 months" : `Last ${span} days`;
      break;
    }
    case "qtd": {
      const q = Math.floor(now.getMonth() / 3) * 3;
      from = ymd(new Date(now.getFullYear(), q, 1));
      ({ prevFrom, prevTo } = priorWindow(from, to));
      label = "Quarter to date";
      break;
    }
    case "ytd": {
      from = ymd(new Date(now.getFullYear(), 0, 1));
      ({ prevFrom, prevTo } = priorWindow(from, to));
      label = "Year to date";
      break;
    }
    case "all": {
      from = "1970-01-01";
      prevFrom = null;
      prevTo = null;
      compareLabel = null;
      label = "All time";
      break;
    }
    case "custom":
    default: {
      from = (fromParam ?? today).slice(0, 10);
      to = (toParam ?? today).slice(0, 10);
      if (from > to) [from, to] = [to, from];
      ({ prevFrom, prevTo } = priorWindow(from, to));
      label = rangeLabel(from, to);
      break;
    }
  }

  const granularity = granularityFor(from, to);
  return {
    presetKey,
    from,
    to,
    prevFrom,
    prevTo,
    label,
    compareLabel,
    granularity,
    buckets: enumerateBuckets(from, to, granularity),
  };
}

// ===========================================================================
// 6. Granularity & chart buckets
// ===========================================================================

/** Inclusive span → bar granularity: ≤31 d daily, ≤92 d weekly, else monthly. */
export function granularityFor(from: string, to: string): Granularity {
  const days = daysBetween(from, to) + 1;
  if (days <= 31) return "day";
  if (days <= 92) return "week";
  return "month";
}

const shortMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "short",
  });
};

/** Ordered chart buckets spanning `[from, to]` at the given granularity. */
export function enumerateBuckets(
  from: string,
  to: string,
  gran: Granularity,
): Bucket[] {
  const out: Bucket[] = [];
  if (gran === "month") {
    let ym = from.slice(0, 7);
    const end = to.slice(0, 7);
    while (ym <= end) {
      out.push({ key: ym, label: shortMonth(ym) });
      ym = ymOffset(ym, 1);
    }
    return out;
  }
  const step = gran === "week" ? 7 : 1;
  let cur = from;
  while (cur <= to) {
    out.push({ key: cur, label: shortDay(cur) });
    cur = addDays(cur, step);
  }
  return out;
}

/** Bucket key a transaction date falls into (consistent with `enumerateBuckets`). */
export function bucketKeyForDate(
  date: string,
  from: string,
  gran: Granularity,
): string {
  const d = date.slice(0, 10);
  if (gran === "month") return d.slice(0, 7);
  if (gran === "day") return d;
  const weekIndex = Math.floor(daysBetween(from, d) / 7);
  return addDays(from, weekIndex * 7);
}

/** Inverse of `bucketKeyForDate`: bucket key → inclusive range. */
export function bucketRange(
  key: string,
  gran: Granularity,
): { from: string; to: string; label: string } {
  if (gran === "month") {
    const [y, m] = key.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      from: `${key}-01`,
      to: `${key}-${pad(last)}`,
      label: key,
    };
  }
  if (gran === "week")
    return { from: key, to: addDays(key, 6), label: key };
  return { from: key, to: key, label: key };
}

// ===========================================================================
// 7. URL‑backed hook
// ===========================================================================

/**
 * Date‑range state persisted in the URL (`?p=`, plus `?from=&to=` for custom).
 * Defaults to the current month. Other params are preserved so the range carries
 * across surfaces.
 *
 * ← → step the window by its own length (calendar‑month aware). When stepping
 * forward into the current calendar month the preset is restored to `"month"`
 * so the label, comparison window, and UI reset state are consistent.
 */
export function useDateRange() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const p = (params.get("p") as PresetKey | null) ?? "month";
  const fromParam = params.get("from") ?? undefined;
  const toParam = params.get("to") ?? undefined;

  const period = useMemo(
    () => resolvePeriod(p, fromParam, toParam),
    [p, fromParam, toParam],
  );

  const write = useCallback(
    (preset: PresetKey, from?: string, to?: string) => {
      const sp = new URLSearchParams(params.toString());
      if (preset === "month") {
        sp.delete("p");
        sp.delete("from");
        sp.delete("to");
      } else if (preset === "custom") {
        sp.set("p", "custom");
        if (from) sp.set("from", from);
        if (to) sp.set("to", to);
      } else {
        sp.set("p", preset);
        sp.delete("from");
        sp.delete("to");
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const setPreset = useCallback(
    (key: PresetKey) => write(key),
    [write],
  );
  const setCustom = useCallback(
    (from: string, to: string) => write("custom", from, to),
    [write],
  );

  // ← → step the window by its own length (calendar‑month aware).
  //
  // The "month" preset uses first-of-month … today (not end-of-month), so
  // `asCalendarMonth` returns null and we must detect it explicitly.  Other
  // presets that land on full calendar months (e.g. custom ranges) use the
  // `calMonth` fast‑path.
  const calMonth = asCalendarMonth(period.from, period.to);
  const curMonth = currentMonth();
  const shift = useCallback(
    (dir: -1 | 1) => {
      // ── "month" preset: step by whole calendar months ──────────────
      if (period.presetKey === "month") {
        const src = period.from.slice(0, 7); // "YYYY-MM"
        const target = ymOffset(src, dir);
        const { first, last } = monthBounds(`${target}-01`);
        if (target === curMonth) {
          write("month");
        } else {
          write("custom", first, last);
        }
        return;
      }
      // ── full‑calendar‑month custom ranges ──────────────────────────
      if (calMonth) {
        const target = ymOffset(calMonth, dir);
        const { first, last } = monthBounds(`${target}-01`);
        if (target === curMonth) {
          write("month");
        } else {
          write("custom", first, last);
        }
        return;
      }
      // ── generic: shift by the window's own length ──────────────────
      const span = daysBetween(period.from, period.to) + 1;
      write(
        "custom",
        addDays(period.from, dir * span),
        addDays(period.to, dir * span),
      );
    },
    [calMonth, curMonth, period.from, period.to, period.presetKey, write],
  );

  const todayStr = ymd(new Date());
  return {
    period,
    setPreset,
    setCustom,
    shift,
    /** `true` when the window already includes today (next‑step disabled). */
    atPresent: period.to >= todayStr,
    /** The calendar month when the window is exactly one (for stepper UI). */
    calendarMonth: calMonth,
  };
}
