import { TrendingDown, TrendingUp } from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";

export function HeroCard({
  label,
  value,
  delta,
  deltaLabel,
  series,
  className,
}: {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  series?: number[];
  className?: string;
}) {
  const showDelta = typeof delta === "number" && Number.isFinite(delta) && delta !== 0;
  const up = (delta ?? 0) > 0;
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-card bg-hero p-[18px_18px_14px] text-white shadow-hero",
        className,
      )}
    >
      <p className="text-xs font-semibold opacity-85">{label}</p>
      <p className="mt-0.5 text-[32px] font-extrabold tracking-[-0.03em] tabular-nums">{value}</p>
      {showDelta && (
        <span className="mt-[7px] inline-flex items-center gap-1.5 rounded-full bg-white/20 px-[9px] py-1 text-xs font-semibold">
          {up ? <TrendingUp className="size-[13px]" /> : <TrendingDown className="size-[13px]" />}
          {deltaLabel}
        </span>
      )}
      {series && series.length > 1 && (
        <Sparkline
          data={series}
          height={80}
          className="mt-2.5 block h-20 w-full text-white"
          stroke="rgba(255,255,255,.95)"
          fill="rgba(255,255,255,.18)"
        />
      )}
    </section>
  );
}
