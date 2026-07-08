import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tint = "accent" | "c2" | "c3";

const TINT: Record<Tint, string> = {
  accent: "bg-accent-soft text-accent",
  c2: "bg-soft2 text-c2",
  c3: "bg-soft3 text-c3",
};

export function RowList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card-sm border border-border bg-card px-3.5 py-1.5 shadow-card",
        "[&>*]:border-b [&>*]:border-border [&>*:last-child]:border-b-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function IconChip({ icon: Icon, tint }: { icon: LucideIcon; tint: Tint }) {
  return (
    <span className={cn("grid size-[38px] flex-none place-items-center rounded-chip", TINT[tint])}>
      <Icon className="size-[18px]" />
    </span>
  );
}

export function StatRow({
  icon,
  tint = "accent",
  label,
  sub,
  value,
  href,
  onClick,
  showChevron = true,
}: {
  icon: LucideIcon;
  tint?: Tint;
  label: string;
  sub?: string;
  value?: string;
  href?: string;
  onClick?: () => void;
  showChevron?: boolean;
}) {
  const interactive = Boolean(href || onClick);
  const Comp: React.ElementType = href ? "a" : interactive ? "button" : "div";
  return (
    <Comp
      {...(href ? { href } : {})}
      {...(onClick ? { onClick, type: "button" } : {})}
      className={cn(
        "flex w-full items-center gap-3.5 py-3 text-left",
        interactive &&
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      )}
    >
      <IconChip icon={icon} tint={tint} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        {sub && <span className="mt-px block text-[11.5px] text-muted">{sub}</span>}
      </span>
      {value && <span className="text-sm font-bold tabular-nums">{value}</span>}
      {interactive && showChevron && <ChevronRight className="size-[18px] flex-none text-muted" />}
    </Comp>
  );
}

export function CategoryRow({
  icon,
  tint = "accent",
  label,
  value,
  pct,
}: {
  icon: LucideIcon;
  tint?: Tint;
  label: string;
  value: string;
  /** 0–100 */
  pct: number;
}) {
  return (
    <div className="flex items-center gap-3.5 py-3">
      <IconChip icon={icon} tint={tint} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="mt-1.5 block h-[5px] w-full overflow-hidden rounded-full bg-track">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </span>
      </span>
      <span className="text-sm font-bold tabular-nums">{value}</span>
    </div>
  );
}
