import { Geist, Instrument_Serif, JetBrains_Mono } from "next/font/google";

/**
 * Type and palette for the public surface — the landing page, the auth screens
 * and /roadmap.
 *
 * This surface is deliberately dark-only and does not participate in the app's
 * eight-palette `data-theme` system. A visitor has never picked a palette, the
 * two surfaces share no token set, and the WebGL scene behind the landing page
 * is lit for one background. What used to live here was a light/dark cookie and
 * a no-flash script for it; with a single scheme there is nothing to flash and
 * nothing to remember.
 *
 * Three faces, each doing one job: Geist for prose, JetBrains Mono for every
 * figure and label (the same split the app already makes between text and
 * numbers), and Instrument Serif italic for the one resolving phrase per
 * headline.
 *
 * The palette lives next door in `marketing-palette.ts`, because next/font is a
 * build-time transform and the WebGL scene needs the colours somewhere it can
 * import them without it.
 */

export const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--m-font-sans",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--m-font-mono",
  display: "swap",
});

export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--m-font-serif",
  display: "swap",
});

/** Applied to whichever element owns the marketing token scope. */
export const MARKETING_FONT_VARS = `${geist.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable}`;
