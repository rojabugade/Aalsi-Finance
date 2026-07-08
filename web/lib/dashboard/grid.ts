import type { RangePreset } from "@/lib/dates";
import type { Preset } from "./density";

export const GRID_COLS = 10;
export const MIN_W = 1;
export const MIN_H = 1;

export type WidgetType = string;

export type WidgetConfig = {
  range?: RangePreset;
  preset?: Preset;
  dimension?: "category" | "merchant";
  chart?: "donut" | "bars" | "list" | "area" | "none";
  count?: number;
  title?: string;
  accent?: string | null;
  show?: Record<string, boolean>;
  filter?: { category?: string };
};

export type GridItem = {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: WidgetConfig;
};

/** Axis-aligned overlap test. An item never collides with itself. */
export function collide(a: GridItem, b: GridItem): boolean {
  return (
    a.id !== b.id &&
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/**
 * Gravity compaction: mutate `items` so each floats up to the lowest free row,
 * removing vertical gaps. Order of resolution is top-to-bottom, left-to-right.
 */
export function compact(items: GridItem[]): void {
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: GridItem[] = [];
  for (const it of order) {
    let y = it.y;
    while (y > 0) {
      const test = { ...it, y: y - 1 };
      if (placed.some((p) => collide(test, p))) break;
      y -= 1;
    }
    it.y = y;
    placed.push(it);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Lay out `items` with one item pinned at (tx,ty,mw,mh); every other item is
 * gravity-packed at its own column around the pinned one. Mutates `items`.
 */
export function packAround(
  items: GridItem[],
  movingId: string,
  tx: number,
  ty: number,
  mw: number,
  mh: number,
): void {
  const moving = items.find((i) => i.id === movingId);
  if (!moving) return;
  moving.x = tx;
  moving.y = ty;
  moving.w = mw;
  moving.h = mh;
  const others = items
    .filter((i) => i.id !== movingId)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: GridItem[] = [moving];
  for (const o of others) {
    let y = 0;
    while (placed.some((p) => collide({ ...o, y }, p))) y += 1;
    o.y = y;
    placed.push(o);
  }
}

/** Move an item to a snapped cell, clamp into the grid, then compact. */
export function moveTo(
  items: GridItem[],
  id: string,
  x: number,
  y: number,
  cols = GRID_COLS,
): void {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  it.x = clamp(x, 0, cols - it.w);
  it.y = Math.max(0, y);
  compact(items);
}

/** Resize an item (snapped spans), clamp to grid, then compact. */
export function resizeTo(
  items: GridItem[],
  id: string,
  w: number,
  h: number,
  cols = GRID_COLS,
  maxH = 6,
): void {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  it.w = clamp(w, MIN_W, cols - it.x);
  it.h = clamp(h, MIN_H, maxH);
  compact(items);
}

/** The first row strictly below every placed item (where a new widget lands). */
export function firstFreeRow(items: GridItem[]): number {
  return items.reduce((max, it) => Math.max(max, it.y + it.h), 0);
}
