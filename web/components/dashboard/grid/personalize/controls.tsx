"use client";
import type { ReactNode } from "react";

/** Shared primitives for the Personalize pane sections (migrated from personalize-sheet). */
export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <label className="mb-2 block text-[9.5px] font-bold uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}

export function Seg({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-chip p-1">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`min-w-[4.15rem] flex-1 rounded-lg py-2 text-[12px] font-semibold ${value === v ? "bg-card text-fg shadow-card" : "text-muted"}`}>{label}</button>
      ))}
    </div>
  );
}
