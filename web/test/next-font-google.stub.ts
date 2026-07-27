/**
 * Stand-in for `next/font/google` under vitest, wired up in vitest.config.ts.
 *
 * next/font is a build-time transform, not a runtime library: outside a Next
 * build its exports are not callable, so any test that reaches a module loading
 * a font dies on import. This returns the shape the callers actually use — the
 * class that would carry the CSS variable — so the markup under test keeps the
 * same structure without a real font ever being fetched.
 *
 * Named exports have to be spelled out: an ES module's named bindings are
 * static, so a Proxy can't stand in for them. One line per face the marketing
 * surface loads; add to it when a face is added.
 */
type FontOptions = { variable?: string };
type Font = { variable: string; className: string; style: { fontFamily: string } };

const font = ({ variable }: FontOptions = {}): Font => ({
  variable: variable ? `__stub${variable.replace(/^--/, "_")}` : "",
  className: "",
  style: { fontFamily: "stub" },
});

export const Geist = font;
export const JetBrains_Mono = font;
export const Instrument_Serif = font;
