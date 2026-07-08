import type { LucideIcon } from "lucide-react";
import type { WidgetConfig } from "@/lib/dashboard/grid";
import { Private } from "@/components/dashboard/privacy-provider";

export type WidgetProps = { w: number; h: number; config: WidgetConfig };

/** Extract the currency symbol/prefix from a formatted currency string.
 *  e.g. "$1,234" → "$", "₹50K" → "₹", "US$100" → "US$", "INR 500" → "INR". */
function extractCurrencyPrefix(formatted: string): string {
  // Multi-char: US$, CA$, A$, HK$, NZ$, SG$, R$ etc.
  const m = formatted.match(/^[+\u2212\-]?([A-Z]{2,3}\$|R\$|[A-Z]{3})\s?/);
  if (m) return m[1];
  // Single-char Unicode or ASCII currency symbols
  const s = formatted.match(/^[+\u2212\-]?([$\u00A2-\u00A5\u058F\u060B\u07FE\u07FF\u09F2\u09F3\u0AF1\u0BF9\u0E3F\u17DB\u20A0-\u20C0])/);
  if (s) return s[1];
  return "";
}

function microValue(value: string): string {
  // Fast-path: already in compact notation (e.g. "$50K", "₹1.2M", "EUR 500K")
  const compact = value.trim().match(/^([-+−]?)([^\d][^\d]*?)(\d+(?:\.\d+)?)\s*([KMB])(?:\/mo)?$/i);
  if (compact) {
    const [, sign, prefixRaw, amount, suffix] = compact;
    const prefix = prefixRaw.trim();
    const perMonth = value.includes("/mo") ? "/mo" : "";
    return `${sign}${prefix}${Math.round(Number(amount))}${suffix.toUpperCase()}${perMonth}`;
  }
  // Non-compact fallback: try to compact large values while preserving the currency prefix
  const prefix = extractCurrencyPrefix(value.trim());
  const numericPart = value.trim().replace(/^[+\u2212\-]?\s*\S+\s*/, ""); // strip sign + prefix
  const cleaned = numericPart.replace(/[,]/g, "");
  const amount = Number(cleaned.replace(/[+\u2212\-]/g, ""));
  if (!Number.isFinite(amount)) return value;
  const sign = value.trim().startsWith("-") || value.trim().startsWith("−") ? "−" : value.trim().startsWith("+") ? "+" : "";
  if (amount >= 1_000_000) return `${sign}${prefix}${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (amount >= 1_000) return `${sign}${prefix}${Math.round(amount / 1_000)}K`;
  return value;
}

/** A small uniform stat shown when a widget is at its smallest (sm) tier. */
export function CompactStat({
  icon: _Icon,
  label,
  value,
  hint,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  const valueText = microValue(value);
  return (
    <div className="flex h-full min-h-0 flex-col justify-center overflow-hidden">
      <div className="flex min-w-0 items-center text-muted">
        <span className="truncate text-[9px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-0.5 text-[20px] font-extrabold leading-none tabular-nums tracking-[-0.04em]"><Private kind="money">{valueText}</Private></p>
      {hint ? <p className="mt-0.5 truncate text-[10px] leading-tight text-muted">{hint}</p> : null}
    </div>
  );
}
