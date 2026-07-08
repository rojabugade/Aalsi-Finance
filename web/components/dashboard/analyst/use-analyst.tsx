"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AnalystAction } from "@/lib/api/analyst";
import type { DateRange } from "@/lib/dates";

export type AnalystMode = "monitor" | "explain" | "plan" | "action";

/** The entity the user is currently looking at, scoping the analyst's answers. */
export type AnalystFocus = { kind: "merchant" | "category"; label: string; id?: string };

const DEFAULT_RANGE: DateRange = { from: "1970-01-01", to: "2999-12-31" };

type AnalystContextValue = {
  open: boolean;
  mode: AnalystMode;
  setMode: (mode: AnalystMode) => void;
  openPane: (mode?: AnalystMode) => void;
  closePane: () => void;
  toggle: () => void;
  runAction: (action: AnalystAction) => void;
  range: DateRange;
  setRange: (range: DateRange) => void;
  focus: AnalystFocus | null;
  setFocus: (focus: AnalystFocus) => void;
  clearFocus: () => void;
  /** Human label for the page the user is on (e.g. "Spend", "Debt"). */
  page: string;
  setPage: (page: string) => void;
  route: string;
  setRoute: (route: string) => void;
  filters: Record<string, unknown> | null;
  setFilters: (filters: Record<string, unknown> | null) => void;
  setActionHandler: (handler: (action: AnalystAction) => void) => void;
};

const AnalystContext = createContext<AnalystContextValue | null>(null);

export function AnalystProvider({
  children,
  onAction,
  defaultRange = DEFAULT_RANGE,
}: {
  children: ReactNode;
  onAction: (action: AnalystAction) => void;
  defaultRange?: DateRange;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AnalystMode>("monitor");
  const [range, setRangeState] = useState<DateRange>(defaultRange);
  // Guard against callers that pass a fresh object every render (e.g. presetRange
  // in a render body): bail on equal values so we don't re-render in a loop.
  const setRange = useCallback((next: DateRange) => {
    setRangeState((prev) => (prev.from === next.from && prev.to === next.to ? prev : next));
  }, []);
  const [focus, setFocus] = useState<AnalystFocus | null>(null);
  const [page, setPage] = useState("Dashboard");
  const [route, setRoute] = useState("/");
  const [filters, setFilters] = useState<Record<string, unknown> | null>(null);
  // The active action handler. Pages (the dashboard) can swap in a richer one.
  const handlerRef = useRef(onAction);
  useEffect(() => { handlerRef.current = onAction; }, [onAction]);

  const value = useMemo<AnalystContextValue>(() => ({
    open,
    mode,
    setMode,
    openPane: (nextMode) => {
      if (nextMode) setMode(nextMode);
      setOpen(true);
    },
    closePane: () => setOpen(false),
    toggle: () => setOpen((current) => !current),
    runAction: (action) => handlerRef.current(action),
    range,
    setRange,
    focus,
    setFocus: (next) => setFocus(next),
    clearFocus: () => setFocus(null),
    page,
    setPage,
    route,
    setRoute,
    filters,
    setFilters,
    setActionHandler: (handler) => { handlerRef.current = handler; },
  }), [mode, open, range, focus, page, route, filters]);

  return <AnalystContext.Provider value={value}>{children}</AnalystContext.Provider>;
}

export function useAnalyst(): AnalystContextValue {
  const context = useContext(AnalystContext);
  if (!context) throw new Error("useAnalyst must be used within AnalystProvider");
  return context;
}
