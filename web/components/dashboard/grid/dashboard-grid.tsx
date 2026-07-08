"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GRID_COLS, moveTo, packAround, resizeTo, type GridItem } from "@/lib/dashboard/grid";
import { resolveConfig, WIDGETS } from "@/lib/dashboard/registry";
import { useDashboard } from "@/lib/dashboard/use-dashboard";
import { WidgetFrame } from "./widget-frame";
import { WidgetConfigControls } from "./personalize/sections/widgets-section";
import { X } from "lucide-react";

const GAP = 12;
const CELL_H: Record<string, number> = { compact: 120, cozy: 148, spacious: 180 };
const CELL_H_SCALE: Record<string, number> = { compact: 0.72, cozy: 0.86, spacious: 1 };

export function DashboardGrid({
  boardId: _boardId,
  editing,
  controller,
}: {
  boardId: string;
  editing: boolean;
  controller: ReturnType<typeof useDashboard>;
}) {
  const { state, hideWidget, mutateItems, selectedId, select, duplicateWidget, updateConfig } = controller;
  const ref = useRef<HTMLDivElement>(null);
  const [colW, setColW] = useState(0);
  const cellH = colW > 0 ? colW * (CELL_H_SCALE[state.prefs.density] ?? 0.86) : (CELL_H[state.prefs.density] ?? 104);
  const [ph, setPh] = useState<null | { x: number; y: number; w: number; h: number }>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const measure = () => { if (ref.current) setColW((ref.current.clientWidth - (GRID_COLS - 1) * GAP) / GRID_COLS); };
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  // Bring selected widgets into view when customized from the inline personalize panel.
  useEffect(() => {
    if (!selectedId) return;
    ref.current?.querySelector<HTMLElement>(`[data-widget-id="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "start", behavior: "smooth" });
  }, [selectedId]);

  useEffect(() => {
    if (!editing) setConfiguringId(null);
  }, [editing]);

  const px = (it: { x: number; y: number; w: number; h: number }) => ({
    left: it.x * (colW + GAP),
    top: it.y * (cellH + GAP),
    width: it.w * colW + (it.w - 1) * GAP,
    height: it.h * cellH + (it.h - 1) * GAP,
  });

  // Minimal mode hides non-essential widgets at render only (reversible; state untouched).
  // While editing all widgets stay visible so the user can still arrange them.
  const renderItems =
    state.prefs.densityMode === "minimal" && !editing
      ? state.items.filter((it) => WIDGETS[it.type]?.essential)
      : state.items;

  const rows = Math.max(1, ...renderItems.map((i) => i.y + i.h));
  const boardHeight = rows * cellH + (rows - 1) * GAP;

  const startDrag = useCallback((e: React.PointerEvent, item: GridItem) => {
    if (!editing || !ref.current) return;
    e.preventDefault();
    const br = ref.current.getBoundingClientRect();
    const grabX = e.clientX - (br.left + item.x * (colW + GAP));
    const grabY = e.clientY - (br.top + item.y * (cellH + GAP));
    setDragId(item.id);
    let tx = item.x, ty = item.y;
    const onMove = (ev: PointerEvent) => {
      const left = ev.clientX - br.left - grabX;
      const top = ev.clientY - br.top - grabY;
      tx = Math.max(0, Math.min(GRID_COLS - item.w, Math.round(left / (colW + GAP))));
      ty = Math.max(0, Math.round(top / (cellH + GAP)));
      mutateItems((items) => packAround(items, item.id, tx, ty, item.w, item.h));
      setPh({ x: tx, y: ty, w: item.w, h: item.h });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      mutateItems((items) => moveTo(items, item.id, tx, ty));
      setPh(null); setDragId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [editing, colW, cellH, mutateItems]);

  const startResize = useCallback((e: React.PointerEvent, item: GridItem) => {
    if (!editing) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = item.w, oh = item.h;
    const contract = WIDGETS[item.type]?.contract;
    const minW = contract?.minW ?? 1;
    const minH = contract?.minH ?? 1;
    setDragId(item.id);
    let w = ow, h = oh;
    const onMove = (ev: PointerEvent) => {
      w = Math.max(minW, Math.min(GRID_COLS - item.x, ow + Math.round((ev.clientX - sx) / (colW + GAP))));
      h = Math.max(minH, Math.min(maxWidgetHeight(item, w), oh + Math.round((ev.clientY - sy) / (cellH + GAP))));
      mutateItems((items) => packAround(items, item.id, item.x, item.y, w, h));
      setPh({ x: item.x, y: item.y, w, h });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      mutateItems((items) => resizeTo(items, item.id, w, h, GRID_COLS, maxWidgetHeight(item, w)));
      setPh(null); setDragId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [editing, colW, cellH, mutateItems]);

  return (
    <div
      ref={ref}
      data-testid="dashboard-grid"
      className="relative w-full"
      style={{ height: boardHeight, ["--cardrad" as string]: `${state.prefs.radius}px` }}
      onPointerDown={(e) => {
        if (editing && e.target === e.currentTarget) select(null);
      }}
    >
      {editing && colW > 0 && (
        <LatticeOverlay colW={colW} cellH={cellH} rows={rows} boardHeight={boardHeight} />
      )}
      {editing && ph && (
        <div className="pointer-events-none absolute rounded-card-sm border-2 border-dashed border-accent bg-accent-soft/40"
          style={{ ...px(ph), zIndex: 1 }} />
      )}
      {renderItems.map((item) => {
        const p = px(item);
        const dragging = dragId === item.id;
        const config = resolveConfig(item, state.prefs.range);
        const selected = editing && selectedId === item.id;
        const configuring = configuringId === item.id;
        const def = WIDGETS[item.type];
        return (
          <div key={item.id} data-widget={item.type} data-widget-id={item.id}
            className="absolute"
            onPointerDown={(e) => {
              if (!editing || (e.target as HTMLElement).closest("button")) return;
              e.stopPropagation();
              select(item.id);
              startDrag(e, item);
            }}
            style={{
              left: p.left, top: p.top, width: p.width, height: p.height,
              borderRadius: "var(--cardrad)",
              ...(config.accent ? { ["--accent" as string]: config.accent } : {}),
              transition: dragging ? "none" : "left .2s cubic-bezier(.32,.72,0,1), top .2s cubic-bezier(.32,.72,0,1), width .2s, height .2s",
              zIndex: dragging ? 50 : configuring ? 40 : 2,
            }}>
            <WidgetFrame
              item={item}
              config={config}
              selected={selected}
              editing={editing}
              onHide={() => hideWidget(item.id)}
              onResizePointerDown={(e) => startResize(e, item)}
              onDuplicate={() => duplicateWidget(item.id)}
              onCustomize={() => setConfiguringId(configuring ? null : item.id)}
              cellH={cellH}
              mode={state.prefs.densityMode}
              showLabels={state.prefs.showLabels}
            />
            {configuring && def && (
              <aside
                aria-label={`Edit ${config.title || def.title}`}
                className="absolute top-0 z-[70] w-80 rounded-2xl border border-border bg-card p-3 shadow-2xl"
                style={item.x + item.w > GRID_COLS / 2 ? { right: "calc(100% + 12px)" } : { left: "calc(100% + 12px)" }}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-bold">Edit widget</p>
                  <button type="button" aria-label="Close widget editor" onClick={() => setConfiguringId(null)} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-chip hover:text-fg">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="max-h-[min(70vh,560px)] overflow-y-auto">
                  <WidgetConfigControls item={item} def={def} config={config} globalRange={state.prefs.range} updateConfig={updateConfig} />
                </div>
              </aside>
            )}
          </div>
        );
      })}
    </div>
  );
}

function maxWidgetHeight(item: GridItem, w: number) {
  if (item.type !== "breakdown") return 6;
  const config = resolveConfig(item);
  const count = Math.max(1, Math.round(Number(config.count ?? 8)));
  if (w >= 4) return count > 8 ? 3 : 2;
  if (w >= 3) return count > 5 ? 3 : 2;
  return 2;
}

function LatticeOverlay({ colW, cellH, boardHeight }: { colW: number; cellH: number; rows: number; boardHeight: number }) {
  return (
    <div
      data-testid="dashboard-grid-lattice"
      className="pointer-events-none absolute inset-x-0 top-0 opacity-50"
      style={{
        height: boardHeight,
        zIndex: 0,
        backgroundImage: `radial-gradient(circle, var(--border) 1.5px, transparent 1.5px)`,
        backgroundSize: `${colW + GAP}px ${cellH + GAP}px`,
        backgroundPosition: `0 0`,
      }}
    />
  );
}
