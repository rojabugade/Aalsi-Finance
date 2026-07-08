"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME,
  joinTheme,
  parseTheme,
  splitTheme,
  THEME_BG,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  type Mode,
  type Palette,
  type ThemeId,
} from "@/lib/theme/themes";

type ThemeContextValue = {
  palette: Palette;
  mode: Mode;
  theme: ThemeId;
  setPalette: (p: Palette) => void;
  setMode: (m: Mode) => void;
  toggleMode: () => void;
  /** Apply a full theme id at once (needed for mode-locked presets). */
  apply: (t: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeId {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return parseTheme(document.documentElement.getAttribute("data-theme"));
}

function persist(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_BG[theme]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(readInitialTheme);
  const { palette, mode } = splitTheme(theme);

  const apply = useCallback((next: ThemeId) => {
    setTheme(next);
    persist(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      palette,
      mode,
      theme,
      setPalette: (p) => apply(joinTheme(p, mode)),
      setMode: (m) => apply(joinTheme(palette, m)),
      toggleMode: () => apply(joinTheme(palette, mode === "dark" ? "light" : "dark")),
      apply,
    }),
    [apply, palette, mode, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
