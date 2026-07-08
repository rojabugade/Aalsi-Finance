"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  compact,
  firstFreeRow,
  moveTo,
  packAround,
  resizeTo,
  type GridItem,
  type WidgetConfig,
} from "./grid";
import { BOARD_VERSION, BOARDS, DEFAULT_PREFS, type BoardPrefs, type BoardState } from "./boards";
import { loadBoard, saveBoard, resetBoard } from "./layout-store";
import { WIDGETS } from "./registry";

export function useDashboard(boardId: string) {
  const [state, setState] = useState<BoardState>(() => ({
    version: BOARD_VERSION,
    items: [],
    prefs: { ...DEFAULT_PREFS },
  }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const hydrated = useRef(false);

  // hydrate from localStorage on mount (client only, avoids SSR mismatch)
  useEffect(() => {
    setSelectedId(null);
    setState(loadBoard(boardId));
    hydrated.current = true;
  }, [boardId]);

  useEffect(() => {
    if (selectedId && !state.items.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [selectedId, state.items]);

  const persist = useCallback(
    (next: BoardState) => {
      setState(next);
      if (hydrated.current) saveBoard(boardId, next);
    },
    [boardId],
  );

  const mutateItems = useCallback(
    (fn: (items: GridItem[]) => void) => {
      setState((prev) => {
        const items = prev.items.map((i) => ({ ...i }));
        fn(items);
        const next = { ...prev, items };
        saveBoard(boardId, next);
        return next;
      });
    },
    [boardId],
  );

  const setPrefs = useCallback(
    (patch: Partial<BoardPrefs>) => persist({ ...state, prefs: { ...state.prefs, ...patch } }),
    [persist, state],
  );

  // Replace the board's items wholesale (used by saved-layouts switch).
  const applyItems = useCallback(
    (items: GridItem[]) => persist({ ...state, items }),
    [persist, state],
  );

  const applySetup = useCallback(
    (items: GridItem[], prefs: Partial<BoardPrefs>) => persist({ ...state, items, prefs: { ...state.prefs, ...prefs } }),
    [persist, state],
  );

  const hideWidget = useCallback((id: string) => {
    if (selectedId === id) setSelectedId(null);
    mutateItems((items) => {
      const i = items.findIndex((it) => it.id === id);
      if (i >= 0) items.splice(i, 1);
      compact(items);
    });
  }, [mutateItems, selectedId]);

  const addWidget = useCallback((type: string) => mutateItems((items) => {
    const def = WIDGETS[type];
    items.push({ id: `${type}-${Date.now()}`, type, x: 0, y: firstFreeRow(items), w: def.defW, h: def.defH });
    compact(items);
  }), [mutateItems]);

  const duplicateWidget = useCallback((id: string) => mutateItems((items) => {
    const src = items.find((it) => it.id === id);
    if (!src) return;
    items.push({
      ...src,
      id: `${src.type}-${Date.now()}`,
      x: 0,
      y: firstFreeRow(items),
      config: src.config ? { ...src.config } : undefined,
    });
    compact(items);
  }), [mutateItems]);

  const reset = useCallback(() => {
    setSelectedId(null);
    persist(resetBoard(boardId));
  }, [persist, boardId]);

  const select = useCallback((id: string | null) => setSelectedId(id), []);

  const updateConfig = useCallback((id: string, patch: Partial<WidgetConfig>) => mutateItems((items) => {
    const item = items.find((it) => it.id === id);
    if (!item) return;
    item.config = {
      ...(item.config ?? {}),
      ...patch,
      ...(patch.show ? { show: { ...(item.config?.show ?? {}), ...patch.show } } : {}),
      ...(patch.filter ? { filter: { ...(item.config?.filter ?? {}), ...patch.filter } } : {}),
    };
  }), [mutateItems]);

  // library = board pool − placed types
  const placed = new Set(state.items.map((i) => i.type));
  const library = BOARDS[boardId].pool.filter((t) => !placed.has(t));

  return { boardId, state, library, selectedId, select, updateConfig, setPrefs, applyItems, applySetup, hideWidget, addWidget, duplicateWidget, reset, moveTo, resizeTo, packAround, compact, mutateItems };
}
