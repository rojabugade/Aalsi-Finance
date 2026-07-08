import type { RangePreset } from "@/lib/dates";
import type { GridItem, WidgetConfig, WidgetType } from "./grid";

export type DensityModeId = "calm" | "balanced" | "power" | "minimal";
export type PrivacyLevel = "off" | "privacy" | "presentation" | "screenshot";

export type BoardPrefs = {
  density: "compact" | "cozy" | "spacious";
  radius: number; // px
  glass: number; // 0–90 transparency %
  /** Board-wide default time window; widgets follow it unless config.range overrides. */
  range: RangePreset;
  // slice E
  densityMode: DensityModeId;
  themePreset: string;       // ThemePresetId, validated in theme layer
  accent: string | null;     // null = preset default
  shadow: number;            // 0–100 shadow/glow intensity
  privacy: PrivacyLevel;
  showLabels: boolean;
};

export type BoardState = {
  version: number;
  items: GridItem[];
  prefs: BoardPrefs;
};

export const BOARD_VERSION = 4;

export const DEFAULT_PREFS: BoardPrefs = {
  density: "cozy", radius: 20, glass: 0, range: "3m",
  densityMode: "balanced", themePreset: "indigo-light", accent: null, shadow: 0, privacy: "off", showLabels: true,
};

export function deriveDensityMode(density: BoardPrefs["density"]): DensityModeId {
  return density === "spacious" ? "calm" : density === "compact" ? "power" : "balanced";
}

type Def = [type: WidgetType, x: number, y: number, w: number, h: number, config?: WidgetConfig];

export type BoardConfig = {
  id: string;
  /** Widget types available to add on this board. */
  pool: WidgetType[];
  /** Default placement. */
  def: Def[];
};

export const BOARDS: Record<string, BoardConfig> = {
  dashboard: {
    id: "dashboard",
    pool: [
      "netWorth",
      "safeToSpend",
      "breakdown",
      "cashflow",
      "budgets",
      "recentActivity",
      "aiAlert",
      "creditCard",
      "debt",
      "recurring",
      "holdings",
    ],
    def: [
      ["netWorth", 0, 0, 5, 2, { range: "6m" }],
      ["budgets", 5, 0, 5, 2],
      // breakdown carries no range -> follows the global board range
      ["breakdown", 0, 2, 5, 2, { dimension: "merchant", title: "Merchant Categorization" }],
      ["safeToSpend", 5, 2, 5, 2, { range: "1m" }],
      ["recentActivity", 0, 4, 5, 2],
      ["cashflow", 5, 4, 3, 2, { range: "6m" }],
      ["aiAlert", 8, 4, 2, 2],
      ["creditCard", 0, 6, 5, 2],
      ["debt", 5, 6, 5, 2],
      ["recurring", 0, 8, 5, 2],
      ["holdings", 5, 8, 5, 2],
    ],
  },
};

let idSeq = 0;
export function defaultBoardState(boardId: string): BoardState {
  const cfg = BOARDS[boardId];
  return {
    version: BOARD_VERSION,
    prefs: { ...DEFAULT_PREFS },
    items: cfg.def.map(([type, x, y, w, h, config]) => ({
      id: `${type}-${Date.now()}-${idSeq++}`,
      type,
      x,
      y,
      w,
      h,
      ...(config ? { config: { ...config } } : {}),
    })),
  };
}
