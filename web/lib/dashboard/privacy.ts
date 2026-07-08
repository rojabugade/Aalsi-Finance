import type { PrivacyLevel } from "./boards";

export const shouldBlurMoney = (l: PrivacyLevel) => l !== "off";
export const shouldHoverReveal = (l: PrivacyLevel) => l === "privacy";
export const shouldMaskNames = (l: PrivacyLevel) => l !== "off";
export const hideBalances = (l: PrivacyLevel) => l === "presentation" || l === "screenshot";

export function maskMoney(value: string, level: PrivacyLevel): string {
  return shouldBlurMoney(level) ? "•••••" : value;
}
