"use client";
import type { useDashboard } from "@/lib/dashboard/use-dashboard";
import { DENSITY_MODES } from "@/lib/dashboard/density-modes";
import type { DensityModeId } from "@/lib/dashboard/boards";

const MODES: { id: DensityModeId; label: string; desc: string }[] = [
  { id: "calm",     label: "Calm",     desc: "Spacious cards, light detail — essentials at a glance." },
  { id: "balanced", label: "Balanced", desc: "The default — a measured mix of detail and space." },
  { id: "power",    label: "Power",    desc: "Dense, analytical — every widget shows its richest view." },
  { id: "minimal",  label: "Minimal",  desc: "Only the essential widgets; everything else is hidden." },
];

export function DensitySection({ controller }: { controller: ReturnType<typeof useDashboard> }) {
  const { state, setPrefs } = controller;
  const active = state.prefs.densityMode;

  return (
    <div className="space-y-2">
      {MODES.map(({ id, label, desc }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setPrefs({ densityMode: id, density: DENSITY_MODES[id].gridDensity })}
            aria-pressed={selected}
            className={`w-full rounded-xl border-2 p-3 text-left transition-colors ${selected ? "border-accent bg-accent-soft/30" : "border-border bg-card hover:border-accent/40"}`}
          >
            <span className="block text-[12.5px] font-bold">{label}</span>
            <span className="mt-0.5 block text-[11px] text-muted">{desc}</span>
          </button>
        );
      })}
    </div>
  );
}
