import type { Preset, DensityLevel } from "./density";
import { effectiveDensity } from "./density";
import type { DensityModeId, BoardPrefs } from "./boards";

export const DENSITY_MODES: Record<DensityModeId, { baselinePreset: Preset; gridDensity: BoardPrefs["density"]; essentialOnly: boolean }> = {
  calm:     { baselinePreset: "compact",    gridDensity: "spacious", essentialOnly: false },
  balanced: { baselinePreset: "standard",   gridDensity: "cozy",     essentialOnly: false },
  power:    { baselinePreset: "analytical", gridDensity: "compact",  essentialOnly: false },
  minimal:  { baselinePreset: "standard",   gridDensity: "spacious", essentialOnly: true  },
};

export function baselineFor(mode: DensityModeId): Preset { return DENSITY_MODES[mode].baselinePreset; }

export function effectiveDensityFor(configPreset: Preset | undefined, mode: DensityModeId, w: number, h: number): DensityLevel {
  return effectiveDensity(configPreset ?? baselineFor(mode), w, h);
}
