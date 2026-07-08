"use client";
import { useState } from "react";
import { Settings2, X } from "lucide-react";
import { WIDGETS } from "@/lib/dashboard/registry";
import type { GridItem, WidgetConfig } from "@/lib/dashboard/grid";
import type { DensityModeId } from "@/lib/dashboard/boards";
import { BaseWidget } from "@/components/dashboard/widgets/base-widget";
import { WidgetActions } from "@/components/dashboard/widgets/widget-actions";

export function WidgetFrame({
  item,
  config,
  selected,
  editing,
  onHide,
  onResizePointerDown,
  onDuplicate,
  onCustomize,
  cellH,
  mode,
  showLabels = true,
}: {
  item: GridItem;
  config: WidgetConfig;
  selected: boolean;
  editing: boolean;
  onHide: () => void;
  onResizePointerDown: (e: React.PointerEvent) => void;
  onDuplicate?: () => void;
  onCustomize?: () => void;
  cellH?: number;
  mode?: DensityModeId;
  showLabels?: boolean;
}) {
  const [focusOpen, setFocusOpen] = useState(false);
  const def = WIDGETS[item.type];
  if (!def) return null;
  const Icon = def.icon;
  const title = config.title || def.title;
  const tiny = item.w === 1 && item.h === 1;
  const variant =
    selected
      ? "ring-2 ring-accent"
      : def.variant === "ai"
        ? "ring-1 ring-accent"
        : def.variant === "feature"
          ? "shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_0_0_1px_var(--accent)]"
          : "";
  return (
    <div className={`relative flex h-full w-full flex-col overflow-hidden rounded-card-sm border border-border bg-card shadow-card ${variant}`}>
      <div className={`flex items-center gap-2 ${tiny ? "px-2.5 pb-0.5 pt-2" : "px-3.5 pb-1.5 pt-3"} ${editing ? "cursor-grab active:cursor-grabbing" : ""}`}>
        <Icon className={`${tiny ? "size-3" : "size-3.5"} shrink-0 text-muted`} />
        {!tiny && showLabels && <span className="truncate text-[10.5px] font-bold uppercase tracking-wide text-muted">{title}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {editing && <span className="rounded border border-border bg-chip px-1.5 py-0.5 text-[9px] font-bold text-muted">{item.w}×{item.h}</span>}
          {editing && onCustomize && (
            <button
              type="button"
              aria-label={`Edit ${title}`}
              onClick={onCustomize}
              className="grid size-5 place-items-center rounded text-muted hover:bg-chip hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Settings2 className="size-3.5" />
            </button>
          )}
          <WidgetActions
            onExpand={() => setFocusOpen(true)}
            onDuplicate={onDuplicate}
            onRemove={editing ? onHide : undefined}
          />
          {editing && (
            <button aria-label="Hide widget" onClick={onHide} className="grid size-5 place-items-center rounded text-muted hover:bg-chip hover:text-fg">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className={`min-h-0 flex-1 ${tiny ? "px-2.5 pb-2" : "px-3.5 pb-3"}`}>
        <BaseWidget def={def} config={config} w={item.w} h={item.h} cellH={cellH} mode={mode} focusOpen={focusOpen} onFocusChange={setFocusOpen} />
      </div>
      {editing && (
        <button aria-label="Resize widget" onPointerDown={onResizePointerDown} className="absolute bottom-0 right-0 size-5 cursor-nwse-resize">
          <span className="absolute bottom-1 right-1 size-2 rounded-br-[3px] border-b-2 border-r-2 border-accent" />
        </button>
      )}
    </div>
  );
}
