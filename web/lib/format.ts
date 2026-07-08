export function formatCurrency(
  value: number | string | null | undefined,
  opts: { currency?: string; compact?: boolean; signed?: boolean } = {},
): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  const { currency = "USD", compact = false, signed = false } = opts;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: compact ? 0 : 2,
  }).format(Math.abs(n));
  if (signed && n !== 0) return `${n < 0 ? "−" : "+"}${formatted}`;
  return n < 0 ? `−${formatted}` : formatted;
}

export function formatPercent(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Short month label, e.g. "2026-06" -> "Jun". */
export function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
}

/** Coerce any value to a finite number; non-finite (NaN/Infinity/undefined) -> 0.
 *  Use for chart inputs so an empty/failed load never emits a NaN SVG path. */
export function toFinite(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseIsoDate(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function formatDateShort(date: string): string {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatRelativeDueDate(date: string, now: Date = new Date()): string {
  const due = parseIsoDate(date);
  if (!due) return date;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.round((due.getTime() - today.getTime()) / msPerDay);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  if (days === -1) return "1 day overdue";
  return `${Math.abs(days)} days overdue`;
}
