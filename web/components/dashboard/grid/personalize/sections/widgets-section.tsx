"use client";
import { useState } from "react";
import { Plus, Settings2, X } from "lucide-react";
import { useCategories } from "@/lib/api/transactions";
import type { GridItem, WidgetConfig } from "@/lib/dashboard/grid";
import { PALETTE_SWATCH } from "@/lib/theme/themes";
import { resolveConfig, WIDGETS, type WidgetDef } from "@/lib/dashboard/registry";
import type { useDashboard } from "@/lib/dashboard/use-dashboard";
import { PRESETS } from "@/lib/dashboard/density";
import { Section, Seg } from "../controls";

const RANGES: [NonNullable<WidgetConfig["range"]>, string][] = [["7d", "7 d"], ["30d", "30 d"], ["1m", "Month"], ["90d", "90 d"], ["3m", "3 mo"], ["6m", "6 mo"], ["ytd", "YTD"], ["1y", "1 yr"], ["2y", "2 yr"]];
const GLOBAL_RANGE = "__global__";
const rangeLabel = (r?: WidgetConfig["range"]) => RANGES.find(([v]) => v === r)?.[1] ?? r ?? "—";
const DIMENSIONS: [NonNullable<WidgetConfig["dimension"]>, string][] = [["merchant", "Merchant"], ["category", "Category"]];
const CHART_LABELS: Record<NonNullable<WidgetConfig["chart"]>, string> = { donut: "Donut", bars: "Bars", list: "List", area: "Area", none: "None" };
const PRESET_LABELS: Record<(typeof PRESETS)[number], string> = {
  compact: "Compact",
  standard: "Standard",
  detailed: "Detailed",
  analytical: "Analytical",
};
const ACCENTS: { label: string; value: string | null }[] = [
  { label: "Default", value: null },
  { label: "Indigo", value: PALETTE_SWATCH.indigo },
  { label: "Emerald", value: PALETTE_SWATCH.emerald },
  { label: "Ink", value: PALETTE_SWATCH.ink },
  { label: "Orange", value: "#e0653f" },
];

export function WidgetsSection({ controller }: { controller: ReturnType<typeof useDashboard> }) {
  const { state, library, hideWidget, addWidget, updateConfig } = controller;
  const { prefs } = state;
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingItem = state.items.find((item) => item.id === editingId) ?? null;
  const editingDef = editingItem ? WIDGETS[editingItem.type] : null;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      {library.length > 0 && (
        <div>
          <div className="mb-3">
            <p className="text-[14px] font-bold">Add widgets</p>
            <p className="mt-0.5 text-[11px] text-muted">Bring hidden widgets back onto the board.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {library.map((t) => {
              const def = WIDGETS[t];
              if (!def) return null;
              const Icon = def.icon;
              return (
                <button
                  key={t}
                  type="button"
                  aria-label={`Add ${def.title}`}
                  onClick={() => addWidget(t)}
                  className="flex items-center gap-2.5 rounded-2xl border border-border bg-card/45 p-3 text-left hover:border-accent/50"
                >
                  <span className="grid size-8 place-items-center rounded-xl bg-chip text-accent"><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{def.title}</span>
                  <span className="grid size-6 place-items-center rounded-lg bg-accent-soft text-accent"><Plus className="size-3.5" /></span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={library.length > 0 ? "" : "lg:col-span-2"}>
        <div className="mb-3">
          <p className="text-[14px] font-bold">Visible widgets</p>
          <p className="mt-0.5 text-[11px] text-muted">Hide anything you do not need right now.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {state.items.map((it) => {
            const def = WIDGETS[it.type];
            if (!def) return null;
            const Icon = def.icon;
            const title = resolveConfig(it, prefs.range).title || def.title;
            return (
              <div key={it.id} className="flex items-center gap-2.5 rounded-2xl border border-border bg-card/45 p-3">
                <span className="grid size-8 place-items-center rounded-xl bg-chip text-muted"><Icon className="size-4" /></span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{title}</span>
                <button
                  type="button"
                  aria-label={`Edit ${title}`}
                  onClick={() => setEditingId((current) => current === it.id ? null : it.id)}
                  className={`grid size-7 place-items-center rounded-lg border border-border text-muted hover:border-accent/50 hover:text-fg ${editingId === it.id ? "border-accent text-accent" : ""}`}
                >
                  <Settings2 className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Hide ${title}`}
                  onClick={() => {
                    if (editingId === it.id) setEditingId(null);
                    hideWidget(it.id);
                  }}
                  className="h-6 w-10 rounded-full bg-accent p-0.5 transition-colors"
                >
                  <span className="block size-5 translate-x-4 rounded-full bg-white transition-transform" />
                </button>
              </div>
            );
          })}
        </div>
        {editingItem && editingDef && (
          <div className="mt-3 rounded-2xl border border-border bg-card/55 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[13px] font-bold">Edit {resolveConfig(editingItem, prefs.range).title || editingDef.title}</p>
              <button type="button" aria-label="Close widget editor" onClick={() => setEditingId(null)} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-chip hover:text-fg">
                <X className="size-4" />
              </button>
            </div>
            <WidgetConfigControls
              item={editingItem}
              def={editingDef}
              config={resolveConfig(editingItem, prefs.range)}
              globalRange={prefs.range}
              updateConfig={updateConfig}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function WidgetConfigControls({ item, def, config, globalRange, updateConfig }: { item: GridItem; def: WidgetDef; config: WidgetConfig; globalRange: WidgetConfig["range"]; updateConfig: (id: string, patch: Partial<WidgetConfig>) => void }) {
  const cats = useCategories();
  const title = config.title || def.title;

  return (
    <div data-testid="widget-config-controls" className="rounded-2xl border border-accent/40 bg-accent-soft/30 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Editing: {title}</p>

      {def.controls.fields.includes("preset") && (
        <Section label="Display preset">
          <Seg
            options={PRESETS.map((preset) => [preset, PRESET_LABELS[preset]] as [string, string])}
            value={config.preset ?? "standard"}
            onChange={(preset) => updateConfig(item.id, { preset: preset as (typeof PRESETS)[number] })}
          />
        </Section>
      )}

      {def.controls.fields.includes("title") && (
        <Section label="Widget name">
          <input
            value={config.title ?? ""}
            onChange={(e) => updateConfig(item.id, { title: e.target.value })}
            placeholder={def.title}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[12px] outline-none focus:border-accent"
          />
        </Section>
      )}

      {def.controls.fields.includes("range") && (
        <Section label={item.config?.range == null ? `Range · following global (${rangeLabel(globalRange)})` : "Range · custom"}>
          <Seg
            options={[[GLOBAL_RANGE, "Global"], ...RANGES]}
            value={item.config?.range ?? GLOBAL_RANGE}
            onChange={(v) => updateConfig(item.id, { range: v === GLOBAL_RANGE ? undefined : (v as WidgetConfig["range"]) })}
          />
        </Section>
      )}

      {def.controls.fields.includes("dimension") && (
        <Section label="Dimension">
          <Seg
            options={(def.controls.dimensions ?? DIMENSIONS.map(([v]) => v)).map((v) => [v, DIMENSIONS.find(([d]) => d === v)?.[1] ?? v] as [string, string])}
            value={config.dimension ?? "merchant"}
            onChange={(v) => updateConfig(item.id, { dimension: v as WidgetConfig["dimension"] })}
          />
        </Section>
      )}

      {def.controls.fields.includes("chart") && (
        <Section label="Chart">
          <Seg
            options={(def.controls.charts ?? []).map((v) => [v, CHART_LABELS[v]] as [string, string])}
            value={config.chart ?? def.defaults.chart ?? "none"}
            onChange={(v) => updateConfig(item.id, { chart: v as WidgetConfig["chart"] })}
          />
        </Section>
      )}

      {def.controls.fields.includes("count") && def.controls.countRange && (
        <Section label={`Top rows: ${config.count ?? def.defaults.count ?? def.controls.countRange[0]}`}>
          <input
            type="range"
            min={def.controls.countRange[0]}
            max={def.controls.countRange[1]}
            value={config.count ?? def.defaults.count ?? def.controls.countRange[0]}
            onChange={(e) => updateConfig(item.id, { count: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
        </Section>
      )}

      {def.controls.fields.includes("filter") && (
        <Section label="Category filter">
          <select
            value={config.filter?.category ?? ""}
            onChange={(e) => updateConfig(item.id, { filter: { category: e.target.value || undefined } })}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[12px] outline-none focus:border-accent"
          >
            <option value="">All categories</option>
            {(cats.data ?? []).map((cat) => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
          </select>
        </Section>
      )}

      {def.controls.fields.includes("accent") && (
        <Section label="Accent">
          <div className="flex gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent.label}
                type="button"
                onClick={() => updateConfig(item.id, { accent: accent.value })}
                aria-label={`Use ${accent.label} accent`}
                className={`grid size-8 place-items-center rounded-xl border-2 ${config.accent === accent.value ? "border-accent" : "border-border"} bg-card`}
              >
                <span className="size-4 rounded-full border border-border" style={{ background: accent.value ?? "var(--accent)" }} />
              </button>
            ))}
          </div>
        </Section>
      )}

      {def.controls.toggles?.length ? (
        <Section label="Content">
          <div className="space-y-2">
            {def.controls.toggles.map((toggle) => {
              const checked = config.show?.[toggle.key] ?? true;
              return (
                <div key={toggle.key} className="flex items-center justify-between gap-3">
                  <span className="text-[12px] font-semibold">{toggle.label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-label={`${checked ? "Hide" : "Show"} ${toggle.label}`}
                    onClick={() => updateConfig(item.id, { show: { [toggle.key]: !checked } })}
                    className={`h-5 w-9 rounded-full transition-colors ${checked ? "bg-accent" : "bg-track"}`}
                  >
                    <span className={`block size-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
