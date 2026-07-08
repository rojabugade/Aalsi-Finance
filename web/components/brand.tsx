import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm ring-1 ring-inset ring-accent/30",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-[1.15rem]" fill="none">
        <path
          d="M5 16.5 10 7l4 6.5L17 9l2 7.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-[1.45rem] font-black uppercase leading-none tracking-normal text-fg",
        className,
      )}
    >
      ALSI
    </span>
  );
}

export function Brand({ className }: { className?: string }) {
  const t = useTranslations("app");
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="text-[0.95rem] font-semibold tracking-tight">
        {t("name")}
      </span>
    </span>
  );
}
