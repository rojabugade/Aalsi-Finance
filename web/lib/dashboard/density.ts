/** User-chosen display intent. Ordered from least to most information. */
export const PRESETS = ["compact", "standard", "detailed", "analytical"] as const;
export type Preset = (typeof PRESETS)[number];

/** Effective content density a widget renders against: 0=compact … 3=analytical. */
export type DensityLevel = 0 | 1 | 2 | 3;

export const PRESET_LEVEL: Record<Preset, DensityLevel> = {
  compact: 0,
  standard: 1,
  detailed: 2,
  analytical: 3,
};

/**
 * The richest density a widget's physical span can usefully show. Mirrors the
 * old `tierOf` thresholds but on the 0..3 ladder:
 *   1x1            -> 0 (one metric only)
 *   grows one axis -> 1
 *   2x2            -> 2
 *   wide AND tall  -> 3 (room for chart + detail)
 */
export function maxLevelForSize(w: number, h: number): DensityLevel {
  if (w >= 4 && h >= 2) return 3;
  if (w >= 2 && h >= 2) return 2;
  if (w >= 2 || h >= 2) return 1;
  return 0;
}

/** Effective density = the lower of user intent and what the size can show. */
export function effectiveDensity(preset: Preset | undefined, w: number, h: number): DensityLevel {
  const intent = PRESET_LEVEL[preset ?? "standard"];
  const cap = maxLevelForSize(w, h);
  return Math.min(intent, cap) as DensityLevel;
}

/** Max insight chips to show at a given density. Smallest still shows its top chip. */
export function chipCap(level: DensityLevel): number {
  return [1, 2, 3, 3][level];
}
