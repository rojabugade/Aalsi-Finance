"use client";
import type { useDashboard } from "@/lib/dashboard/use-dashboard";
import type { PrivacyLevel } from "@/lib/dashboard/boards";

const LEVELS: { id: PrivacyLevel; label: string; desc: string }[] = [
  { id: "off",          label: "Off",              desc: "Everything visible — your normal view." },
  { id: "privacy",      label: "Privacy",          desc: "Blur amounts & names; hover to reveal a value." },
  { id: "presentation", label: "Presentation",     desc: "Hide exact balances & identifiers, keep charts. No reveal." },
  { id: "screenshot",   label: "Safe Screenshot",  desc: "Strongest — strips identifiers for safe sharing. No reveal." },
];

export function PrivacySection({ controller }: { controller: ReturnType<typeof useDashboard> }) {
  const { state, setPrefs } = controller;
  const active = state.prefs.privacy;

  return (
    // p-4 matches the Layout/Widgets tabs so options don't sit flush against the panel edge.
    <div className="space-y-2 p-4">
      {LEVELS.map(({ id, label, desc }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setPrefs({ privacy: id })}
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
