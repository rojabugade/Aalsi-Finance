"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { ChevronLeft } from "@/lib/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useDateRange,
  type DateRange,
  type RangePreset,
  type PresetKey,
  ymd,
  addDays,
  daysBetween,
  ymOffset,
  monthBounds,
  currentMonth,
  asCalendarMonth,
  monthFullLabel,
  RANGE_PRESETS,
  PRESETS,
} from "@/lib/date-range";
import { cn } from "@/lib/utils";

// ===========================================================================
// Shared helpers
// ===========================================================================

const shortDay = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

function rangeLabel(from: string, to: string): string {
  const month = asCalendarMonth(from, to);
  if (month) return monthFullLabel(month);
  return `${shortDay(from)} – ${shortDay(to)}`;
}

// ===========================================================================
// Props
// ===========================================================================

type BaseProps = {
  variant?: "chip" | "pill";
  hideArrows?: boolean;
  hideReset?: boolean;
  hideCompare?: boolean;
};

type ControlledProps = BaseProps & {
  mode: "controlled";
  preset: RangePreset;
  onPresetChange: (preset: RangePreset) => void;
  onCustomRange?: (range: DateRange) => void;
};

type UrlProps = BaseProps & {
  mode?: "url";
};

export type DateRangePickerProps = ControlledProps | UrlProps;

// ===========================================================================
// Entry point
// ===========================================================================

export function DateRangePicker(props: DateRangePickerProps) {
  if ("mode" in props && props.mode === "controlled") {
    return <ControlledPicker {...props} />;
  }
  return <UrlPicker {...props} />;
}

// ===========================================================================
// URL‑backed picker (spend / analytics)
// ===========================================================================

function UrlPicker({ variant = "chip", hideArrows = false, hideReset = false, hideCompare = false }: BaseProps) {
  const { period, setPreset, setCustom, shift, atPresent } = useDateRange();
  return (
    <PickerUI
      label={period.label}
      compareLabel={period.compareLabel}
      options={PRESETS}
      activeKey={period.presetKey}
      onSelect={(k) => setPreset(k as PresetKey)}
      from={period.from}
      to={period.to}
      onCustomApply={setCustom}
      onShift={shift}
      atPresent={atPresent}
      showReset={period.presetKey !== "month"}
      onReset={() => setPreset("month")}
      variant={variant}
      hideArrows={hideArrows}
      hideReset={hideReset}
      hideCompare={hideCompare}
    />
  );
}

// ===========================================================================
// Controlled picker (dashboard)
// ===========================================================================

const DASHBOARD_OPTIONS: { key: string; label: string }[] = [
  { key: "1m", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "3m", label: "3 months" },
  { key: "6m", label: "6 months" },
  { key: "ytd", label: "Year to date" },
  { key: "1y", label: "1 year" },
];

function resolveDashboardPreset(preset: RangePreset, now: Date): { range: DateRange; label: string } {
  if (preset === "7d" || preset === "30d" || preset === "90d") {
    const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
    const from = new Date(now);
    from.setDate(now.getDate() - (days - 1));
    return { range: { from: ymd(from), to: ymd(now) }, label: `Last ${days} days` };
  }
  if (preset === "ytd") {
    return { range: { from: ymd(new Date(now.getFullYear(), 0, 1)), to: ymd(now) }, label: "Year to date" };
  }
  const def = RANGE_PRESETS.find((p) => p.value === preset);
  const months = def?.months ?? 1;
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  return { range: { from: ymd(from), to: ymd(to) }, label: def?.label ?? preset };
}

function ControlledPicker({
  preset,
  onPresetChange,
  onCustomRange,
  variant = "chip",
  hideArrows = false,
  hideReset = false,
  hideCompare = false,
}: ControlledProps) {
  const now = useMemo(() => new Date(), []);
  const resolved = useMemo(() => resolveDashboardPreset(preset, now), [preset, now]);

  const [customFrom, setCustomFrom] = useState(resolved.range.from);
  const [customTo, setCustomTo] = useState(resolved.range.to);

  useEffect(() => {
    setCustomFrom(resolved.range.from);
    setCustomTo(resolved.range.to);
  }, [resolved.range.from, resolved.range.to]);

  const calMonth = asCalendarMonth(resolved.range.from, resolved.range.to);
  const todayStr = ymd(now);
  const atPresent = resolved.range.to >= todayStr;
  const isMonthPreset = preset === "1m";

  const label = useMemo(() => {
    if (isMonthPreset) return monthFullLabel(currentMonth(now));
    return resolved.label;
  }, [isMonthPreset, resolved.label, now]);

  const handleShift = (dir: -1 | 1) => {
    if (isMonthPreset) {
      const src = currentMonth(now);
      const target = ymOffset(src, dir);
      const { first, last } = monthBounds(`${target}-01`);
      if (target === currentMonth(now)) {
        onPresetChange("1m");
      } else if (onCustomRange) {
        onCustomRange({ from: first, to: last });
      }
      return;
    }
    if (calMonth) {
      const target = ymOffset(calMonth, dir);
      const { first, last } = monthBounds(`${target}-01`);
      if (target === currentMonth(now)) {
        onPresetChange("1m");
      } else if (onCustomRange) {
        onCustomRange({ from: first, to: last });
      }
      return;
    }
    const span = daysBetween(resolved.range.from, resolved.range.to) + 1;
    if (onCustomRange) {
      onCustomRange({
        from: addDays(resolved.range.from, dir * span),
        to: addDays(resolved.range.to, dir * span),
      });
    }
  };

  return (
    <PickerUI
      label={label}
      compareLabel={null}
      options={DASHBOARD_OPTIONS}
      activeKey={preset}
      onSelect={(k) => onPresetChange(k as RangePreset)}
      from={customFrom}
      to={customTo}
      onCustomApply={(f, t) => onCustomRange?.({ from: f, to: t })}
      onShift={handleShift}
      atPresent={atPresent}
      showReset={!isMonthPreset}
      onReset={() => onPresetChange("1m")}
      variant={variant}
      hideArrows={hideArrows}
      hideReset={hideReset}
      hideCompare={hideCompare}
    />
  );
}

// ===========================================================================
// Shared UI shell
// ===========================================================================

function PickerUI({
  label,
  compareLabel,
  options,
  activeKey,
  onSelect,
  from,
  to,
  onCustomApply,
  onShift,
  atPresent,
  showReset,
  onReset,
  variant,
  hideArrows,
  hideReset,
  hideCompare,
}: {
  label: string;
  compareLabel: string | null;
  options: { key: string; label: string }[];
  activeKey: string;
  onSelect: (key: string) => void;
  from: string;
  to: string;
  onCustomApply: (from: string, to: string) => void;
  onShift: (dir: -1 | 1) => void;
  atPresent: boolean;
  showReset: boolean;
  onReset: () => void;
  variant: "chip" | "pill";
  hideArrows: boolean;
  hideReset: boolean;
  hideCompare: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  useEffect(() => {
    setLocalFrom(from);
    setLocalTo(to);
  }, [from, to]);

  const isChip = variant === "chip";
  const btnClass = isChip
    ? "inline-flex items-center gap-1.5 rounded-chip border border-border bg-card px-3 py-2 text-xs font-semibold text-fg transition-colors hover:border-accent"
    : "flex min-w-[140px] items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-semibold text-fg tabular-nums transition-colors hover:bg-chip";

  const arrowClass =
    "grid size-8 place-items-center rounded-full border border-border bg-card text-muted transition-colors hover:text-fg";

  return (
    <div className="flex items-center gap-1.5">
      {!hideArrows && (
        <button type="button" onClick={() => onShift(-1)} aria-label="Previous period" className={arrowClass}>
          <ChevronLeft className="size-4" />
        </button>
      )}

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={btnClass}>
            {isChip && <Calendar className="size-4 text-muted" />}
            <span className="whitespace-nowrap">{label}</span>
            <ChevronDown className="size-3.5 text-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={isChip ? "end" : "start"} className="w-64 p-2">
          <div className="grid grid-cols-2 gap-1">
            {options.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => { onSelect(opt.key); setOpen(false); }}
                className={cn(
                  "rounded-chip px-2.5 py-1.5 text-left text-xs font-semibold transition-colors",
                  activeKey === opt.key ? "bg-accent text-on-accent" : "text-muted hover:bg-chip hover:text-fg",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="mt-2 border-t border-border pt-2">
            <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">Custom range</p>
            <div className="flex items-center gap-1.5">
              <input
                type="date" aria-label="From date" value={localFrom} max={localTo || undefined}
                onChange={(e) => setLocalFrom(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-chip border border-border bg-bg px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <span className="text-xs text-muted">–</span>
              <input
                type="date" aria-label="To date" value={localTo} min={localFrom || undefined}
                onChange={(e) => setLocalTo(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-chip border border-border bg-bg px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
            <button
              type="button"
              onClick={() => { if (localFrom && localTo) { onCustomApply(localFrom, localTo); setOpen(false); } }}
              disabled={!localFrom || !localTo}
              className="mt-1.5 h-8 w-full rounded-chip bg-accent text-xs font-semibold text-on-accent disabled:opacity-40"
            >
              Apply range
            </button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {!hideArrows && (
        <button
          type="button" onClick={() => onShift(1)} disabled={atPresent} aria-label="Next period"
          className={cn(arrowClass, "disabled:cursor-not-allowed disabled:opacity-35")}
        >
          <ChevronLeft className="size-4 rotate-180" />
        </button>
      )}

      {!hideReset && showReset && (
        <button type="button" onClick={onReset} className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent">
          This month
        </button>
      )}

      {!hideCompare && compareLabel && (
        <span className="ml-auto rounded-full bg-chip px-3 py-1.5 text-xs font-semibold text-muted">
          {compareLabel}
        </span>
      )}
    </div>
  );
}
