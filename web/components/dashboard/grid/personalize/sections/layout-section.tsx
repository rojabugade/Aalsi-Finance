"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { useDashboard } from "@/lib/dashboard/use-dashboard";
import { loadLayouts, saveLayout, switchLayout, deleteLayout } from "@/lib/dashboard/layout-presets";
import { Section } from "../controls";

export function LayoutSection({ controller }: { controller: ReturnType<typeof useDashboard> }) {
  const { boardId, state, applyItems, reset } = controller;
  const [name, setName] = useState("");
  const [store, setStore] = useState(() => loadLayouts(boardId));

  const refresh = () => setStore(loadLayouts(boardId));

  const onSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveLayout(boardId, trimmed, state.items);
    setName("");
    refresh();
  };

  const onSwitch = (layoutName: string) => {
    const items = switchLayout(boardId, layoutName);
    if (items) applyItems(items);
    refresh();
  };

  const onDelete = (layoutName: string) => {
    deleteLayout(boardId, layoutName);
    refresh();
  };

  return (
    <div>
      <p className="text-[11px] text-muted">Drag &amp; resize widgets directly — this tab unlocks editing. Save arrangements as named layouts below.</p>

      <Section label="Save current arrangement">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Layout name…"
            className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-[12px] outline-none focus:border-accent"
          />
          <button onClick={onSave} className="shrink-0 rounded-xl bg-accent px-3 py-2 text-[12px] font-semibold text-on-accent hover:opacity-90">Save current</button>
        </div>
      </Section>

      <Section label="Saved layouts">
        {store.layouts.length === 0 ? (
          <p className="text-[12px] text-muted">No saved layouts yet.</p>
        ) : (
          <div className="space-y-1.5">
            {store.layouts.map((l) => (
              <div key={l.name} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${store.active === l.name ? "border-accent bg-accent-soft/30" : "border-border"}`}>
                <button onClick={() => onSwitch(l.name)} aria-label={`Switch to ${l.name}`} className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold">{l.name}</button>
                <button onClick={() => onDelete(l.name)} aria-label={`Delete ${l.name}`} className="grid size-6 shrink-0 place-items-center rounded-lg text-muted hover:bg-chip hover:text-fg"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <button onClick={reset} className="mt-4 w-full rounded-xl border border-border py-2.5 text-[12px] text-muted hover:text-fg">↺ Reset layout</button>
    </div>
  );
}
