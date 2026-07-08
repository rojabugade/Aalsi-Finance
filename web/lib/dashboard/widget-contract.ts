import type { ReactNode } from "react";
import type { WidgetConfig } from "./grid";
import type { DensityLevel } from "./density";

export type WidgetStatus = "loading" | "error" | "empty" | "partial" | "ready";

export type Insight = {
  label: string;
  tone?: "neutral" | "positive" | "warning" | "danger";
  /** Higher = more important; used to pick which chips survive the cap. */
  severity?: number;
};

export type WidgetState<T> = {
  status: WidgetStatus;
  data?: T;
  error?: unknown;
  partialReason?: string;
};

export type RenderCtx<T> = {
  data: T;
  config: WidgetConfig;
  density: DensityLevel;
  w: number;
  h: number;
  /** Pixel height of a single grid cell (tracks the compact/cozy/spacious board pref). */
  cellH?: number;
};

export type WidgetContract<T> = {
  /** Owns the data fetch; must be a hook (calls TanStack hooks internally). */
  useData: (config: WidgetConfig) => WidgetState<T>;
  /** Renders the glanceable body against a single effective density level. */
  Body: (ctx: RenderCtx<T>) => ReactNode;
  /** Rule-based insight chips. Slice G later swaps the body of this function. */
  deriveInsights?: (data: T, config: WidgetConfig) => Insight[];
  /** Analytical content for the Focus modal (full chart + breakdown). */
  Focus?: (ctx: RenderCtx<T>) => ReactNode;
  /** Copy shown in the empty state. */
  emptyHint?: string;
  /** Minimum grid columns this widget can meaningfully display. Defaults to 1. */
  minW?: number;
  /** Minimum grid rows this widget can meaningfully display. Defaults to 1. */
  minH?: number;
};

type QueryLike<R> = { isLoading: boolean; isError: boolean; error?: unknown; data: R | undefined };

/**
 * Map a TanStack-style query result to a WidgetState. Centralizes the
 * loading/error/empty/partial/ready decision so every widget is consistent.
 */
export function queryState<R, T>(
  q: QueryLike<R>,
  opts: {
    select: (r: R) => T;
    isEmpty: (t: T) => boolean;
    /** Return a reason string to flag the data as partial, else undefined. */
    partialReason?: (t: T) => string | undefined;
  },
): WidgetState<T> {
  if (q.isLoading) return { status: "loading" };
  if (q.isError) return { status: "error", error: q.error };
  if (q.data === undefined || q.data === null) return { status: "loading" };
  const data = opts.select(q.data);
  if (opts.isEmpty(data)) return { status: "empty" };
  const reason = opts.partialReason?.(data);
  if (reason) return { status: "partial", data, partialReason: reason };
  return { status: "ready", data };
}
