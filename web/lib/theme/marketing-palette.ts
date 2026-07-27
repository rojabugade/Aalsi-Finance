/**
 * The public surface's palette, as values.
 *
 * Separate from `marketing-theme.ts` — which loads the fonts — so that the
 * WebGL scene can import colours without dragging `next/font/google` in with
 * them. next/font is a build-time transform, so anything that reaches it is
 * unusable outside a Next build, including in unit tests.
 *
 * three.js needs colours it can construct materials from and cannot read a CSS
 * custom property, so these hexes are the source of truth. `marketing.css`
 * mirrors them as `--m-*` variables for the DOM half of the page: change one,
 * change both.
 */
export const M = {
  ink: "#0b0a14",
  paper: "#ECE9FB",
  paperWarm: "#FFF7EE",
  muted: "#A9A4C2",
  dim: "#8A86A6",
  dimmer: "#7B7695",
  faint: "#5C5876",
  faintest: "#4A4661",
  ember: "#F0794F",
  emberSoft: "#F0A985",
  iris: "#8B7BFF",
  mint: "#3FC79A",
} as const;
