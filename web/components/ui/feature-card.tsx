import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function FeatureCard({
  icon: Icon,
  title,
  href,
  variant,
}: {
  icon: LucideIcon;
  title: string;
  href: string;
  variant: "ai" | "xb";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-[92px] flex-col justify-between overflow-hidden rounded-[18px] p-3.5 text-white",
        "transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        variant === "ai"
          ? "bg-hero"
          : "bg-[linear-gradient(135deg,var(--c3),color-mix(in_srgb,var(--c3)_55%,#000))]",
      )}
    >
      <span className="grid size-[30px] place-items-center rounded-[9px] bg-white/20">
        <Icon className="size-[18px]" />
      </span>
      <span className="text-[13.5px] font-bold leading-tight">{title}</span>
    </Link>
  );
}
