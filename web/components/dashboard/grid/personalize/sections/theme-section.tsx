"use client";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import {
  THEME_PRESETS,
  PALETTE_SWATCH,
  presetSupportsMode,
  joinTheme,
  type Mode,
} from "@/lib/theme/themes";
import type { useDashboard } from "@/lib/dashboard/use-dashboard";
import { Section } from "../controls";

const ACCENTS: { label: string; value: string | null }[] = [
  { label: "Default", value: null },
  { label: "Indigo", value: PALETTE_SWATCH.indigo },
  { label: "Emerald", value: PALETTE_SWATCH.emerald },
  { label: "Ink", value: PALETTE_SWATCH.ink },
  { label: "Orange", value: "#e0653f" },
];

const MODE_LABELS: [Mode, string, typeof Sun][] = [["light", "Light", Sun], ["dark", "Dark", Moon]];

export function ThemeSection({ controller }: { controller: ReturnType<typeof useDashboard> }) {
  const { state, setPrefs } = controller;
  const { palette, mode, apply } = useTheme();
  const { prefs } = state;

  const selectPreset = (p: (typeof THEME_PRESETS)[number]) => {
    const targetMode = presetSupportsMode(p.palette, mode) ? mode : p.modes[0];
    const id = joinTheme(p.palette, targetMode);
    apply(id);
    setPrefs({ themePreset: id });
  };

  const selectMode = (m: Mode) => {
    if (!presetSupportsMode(palette, m)) return;
    const id = joinTheme(palette, m);
    apply(id);
    setPrefs({ themePreset: id });
  };

  return (
    // p-4 matches the Layout/Widgets tabs so controls don't sit flush against the panel edge.
    <div className="p-4">
      <Section label="Theme preset">
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map((p) => {
            const selected = palette === p.palette;
            return (
              <button
                key={p.palette}
                type="button"
                onClick={() => selectPreset(p)}
                aria-pressed={selected}
                className={`flex items-center gap-2 rounded-xl border-2 p-2.5 text-left ${selected ? "border-accent" : "border-border"} bg-card`}
              >
                <span className="size-5 shrink-0 rounded-lg" style={{ background: PALETTE_SWATCH[p.palette] }} />
                <span className="truncate text-[11px] font-semibold">{p.name}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Mode">
        <div className="flex flex-wrap gap-1 rounded-xl bg-chip p-1">
          {MODE_LABELS.map(([m, label, Icon]) => {
            const supported = presetSupportsMode(palette, m);
            return (
              <button
                key={m}
                type="button"
                disabled={!supported}
                onClick={() => selectMode(m)}
                className={`flex min-w-[4.15rem] flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${mode === m ? "bg-card text-fg shadow-card" : "text-muted"}`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Accent">
        <div className="flex gap-2">
          {ACCENTS.map((accent) => (
            <button
              key={accent.label}
              type="button"
              onClick={() => setPrefs({ accent: accent.value })}
              aria-label={`Use ${accent.label} accent`}
              className={`grid size-8 place-items-center rounded-xl border-2 ${prefs.accent === accent.value ? "border-accent" : "border-border"} bg-card`}
            >
              <span className="size-4 rounded-full border border-border" style={{ background: accent.value ?? "var(--accent)" }} />
            </button>
          ))}
        </div>
      </Section>

      <Section label={`Card radius · ${prefs.radius}px`}>
        <input type="range" min={6} max={30} value={prefs.radius} onChange={(e) => setPrefs({ radius: +e.target.value })} className="w-full accent-[var(--accent)]" />
      </Section>

      <Section label={`Card transparency · ${prefs.glass ? prefs.glass + "%" : "Off"}`}>
        <input type="range" min={0} max={90} value={prefs.glass} onChange={(e) => setPrefs({ glass: +e.target.value })} className="w-full accent-[var(--accent)]" />
      </Section>

      <Section label={`Shadow / glow · ${prefs.shadow ? prefs.shadow + "%" : "Off"}`}>
        <input type="range" min={0} max={100} value={prefs.shadow} onChange={(e) => setPrefs({ shadow: +e.target.value })} className="w-full accent-[var(--accent)]" />
      </Section>
    </div>
  );
}
