import type { GridItem } from "./grid";

export type SavedLayout = { name: string; items: GridItem[]; savedAt: number };
export type LayoutStore = { layouts: SavedLayout[]; active: string | null };

const KEY = (boardId: string) => `cf-layouts:${boardId}`;
const EMPTY: LayoutStore = { layouts: [], active: null };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function loadLayouts(boardId: string): LayoutStore {
  if (typeof localStorage === "undefined") return clone(EMPTY);
  try {
    const raw = localStorage.getItem(KEY(boardId));
    if (!raw) return clone(EMPTY);
    const parsed = JSON.parse(raw) as LayoutStore;
    if (!Array.isArray(parsed.layouts)) return clone(EMPTY);
    return { layouts: parsed.layouts, active: parsed.active ?? null };
  } catch {
    return clone(EMPTY);
  }
}

function persist(boardId: string, store: LayoutStore): LayoutStore {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY(boardId), JSON.stringify(store));
  return store;
}

export function saveLayout(boardId: string, name: string, items: GridItem[]): LayoutStore {
  const store = loadLayouts(boardId);
  const entry: SavedLayout = { name, items: clone(items), savedAt: Date.now() };
  const i = store.layouts.findIndex((l) => l.name === name);
  if (i >= 0) store.layouts[i] = entry;
  else store.layouts.push(entry);
  store.active = name;
  return persist(boardId, store);
}

export function switchLayout(boardId: string, name: string): GridItem[] | null {
  const store = loadLayouts(boardId);
  const found = store.layouts.find((l) => l.name === name);
  if (!found) return null;
  store.active = name;
  persist(boardId, store);
  return clone(found.items);
}

export function deleteLayout(boardId: string, name: string): LayoutStore {
  const store = loadLayouts(boardId);
  store.layouts = store.layouts.filter((l) => l.name !== name);
  if (store.active === name) store.active = null;
  return persist(boardId, store);
}
