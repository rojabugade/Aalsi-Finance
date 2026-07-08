"use client";

import { Check, Moon, Sun } from "lucide-react";
import { CORE_PALETTES, PALETTE_SWATCH } from "@/lib/theme/themes";
import { useTheme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";

export function ThemePicker({ className }: { className?: string }) {
  const { palette, mode, setPalette, toggleMode } = useTheme();
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex gap-2" role="group" aria-label="Color palette">
        {CORE_PALETTES.map((p) => {
          const active = p === palette;
          return (
            <button
              key={p}
              type="button"
              aria-label={p}
              aria-pressed={active}
              onClick={() => setPalette(p)}
              className={cn(
                "grid size-5 place-items-center rounded-[7px] ring-offset-2 ring-offset-bg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                active && "ring-2 ring-fg/30",
              )}
              style={{ background: PALETTE_SWATCH[p] }}
            >
              {active && <Check className="size-3 text-white" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={toggleMode}
        aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="grid size-8 place-items-center rounded-chip bg-chip text-fg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {mode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    </div>
  );
}
