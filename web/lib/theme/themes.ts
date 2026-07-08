export const PALETTES = ["emerald", "indigo", "ink", "dollar", "glass", "editorial", "neon", "softmin", "midnight"] as const;
/** Brand palettes for the compact light/dark quick-picker (both modes; no mode-lock).
 *  The 5 named presets (incl. mode-locked ones) live in the Personalize → Theme pane. */
export const CORE_PALETTES = ["emerald", "indigo", "ink"] as const;
export const MODES = ["light", "dark"] as const;

export type Palette = (typeof PALETTES)[number];
export type Mode = (typeof MODES)[number];
export type ThemeId = `${Palette}-${Mode}`;

export const DEFAULT_PALETTE: Palette = "indigo";
export const DEFAULT_MODE: Mode = "light";
export const DEFAULT_THEME: ThemeId = `${DEFAULT_PALETTE}-${DEFAULT_MODE}`;

export const THEME_COOKIE = "cf-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Single source of truth for valid theme ids — shared by isThemeId AND the
 *  pre-paint no-flash bootstrap script in layout.tsx (keep them in sync). */
export const THEME_ID_PATTERN = "^(emerald|indigo|ink|dollar|glass|editorial|neon|softmin|midnight)-(light|dark)$";
const THEME_RE = new RegExp(THEME_ID_PATTERN);

export function isThemeId(value: string | undefined | null): value is ThemeId {
  return typeof value === "string" && THEME_RE.test(value);
}

export function parseTheme(value: string | undefined | null): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}

export function splitTheme(theme: ThemeId): { palette: Palette; mode: Mode } {
  const [palette, mode] = theme.split("-") as [Palette, Mode];
  return { palette, mode };
}

export function joinTheme(palette: Palette, mode: Mode): ThemeId {
  return `${palette}-${mode}`;
}

/** `--app-bg` per theme — drives <meta name="theme-color"> + manifest. */
export const THEME_BG: Record<ThemeId, string> = {
  "indigo-light": "#f1f1fa",
  "indigo-dark": "#0e0d16",
  "emerald-light": "#eef3f0",
  "emerald-dark": "#0b1512",
  "ink-light": "#f3f5f8",
  "ink-dark": "#0c0e12",
  // slice E named presets (authored modes)
  "dollar-light": "#eef2e9",
  "glass-dark": "#0a0e16",
  "editorial-light": "#f7f6f3",
  "neon-dark": "#06080b",
  "softmin-light": "#f4f4f5",
  "softmin-dark": "#141416",
  "midnight-dark": "#0b1020",
  // mode-locked-out combos (never selectable — fallback bg only)
  "dollar-dark": "#10140e",
  "glass-light": "#eef2f6",
  "editorial-dark": "#101010",
  "neon-light": "#f2f5f3",
  "midnight-light": "#0b1020", // Neon Nights is dark-only; fallback bg keeps Record<ThemeId> total
};

/** Swatch dot color per palette (drawer + ThemePicker). */
export const PALETTE_SWATCH: Record<Palette, string> = {
  emerald: "#0f9d76",
  indigo: "#6b5bf0",
  ink: "#2f6bff",
  dollar: "#2f7d4f",
  glass: "#5ec8ff",
  editorial: "#c0392b",
  neon: "#3df5a0",
  softmin: "#7c7f8a",
  midnight: "#7c6cff",
};

/** Named theme presets (slice E §18). Mode-locked presets only author supported modes. */
export const THEME_PRESETS: { id: ThemeId; name: string; palette: Palette; modes: Mode[] }[] = [
  { palette: "dollar",    name: "Dollar Bill",   modes: ["light"],          id: "dollar-light" },
  { palette: "glass",     name: "Liquid Glass",  modes: ["dark"],           id: "glass-dark" },
  { palette: "editorial", name: "Editorial",     modes: ["light"],          id: "editorial-light" },
  { palette: "neon",      name: "Neon Ledger",   modes: ["dark"],           id: "neon-dark" },
  { palette: "softmin",   name: "Soft Minimal",  modes: ["light","dark"],   id: "softmin-light" },
  { palette: "midnight",  name: "Neon Nights",   modes: ["dark"],           id: "midnight-dark" },
  { palette: "indigo",    name: "Indigo",        modes: ["light","dark"],   id: "indigo-light" },
  { palette: "emerald",   name: "Emerald",       modes: ["light","dark"],   id: "emerald-light" },
  { palette: "ink",       name: "Ink",           modes: ["light","dark"],   id: "ink-light" },
];

export function presetSupportsMode(palette: Palette, mode: Mode): boolean {
  return THEME_PRESETS.find((p) => p.palette === palette)?.modes.includes(mode) ?? false;
}
