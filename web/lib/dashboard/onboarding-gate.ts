import { STORAGE_PREFIX } from "./layout-store";

export const ONBOARD_PREFIX = "cf-onboarded:";

export function markOnboarded(boardId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ONBOARD_PREFIX + boardId, "1");
}

export function shouldOnboard(boardId: string): boolean {
  if (typeof localStorage === "undefined") return false;
  if (localStorage.getItem(ONBOARD_PREFIX + boardId)) return false;
  // Pre-F user with an existing board: never interrupt — flag and skip.
  if (localStorage.getItem(STORAGE_PREFIX + boardId)) {
    markOnboarded(boardId);
    return false;
  }
  return true;
}
