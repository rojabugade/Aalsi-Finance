import type { BoardPrefs } from "@/lib/dashboard/boards";

/** Maps board appearance prefs to live CSS custom properties applied on <html>. */
export function appearanceVars(prefs: Pick<BoardPrefs, "radius" | "glass" | "shadow" | "accent">): Record<string, string> {
  const vars: Record<string, string> = {
    "--board-radius": `${prefs.radius}px`,
    "--board-glass": String(prefs.glass / 100),
    "--board-shadow": String(prefs.shadow / 100),
  };
  if (prefs.accent) vars["--accent"] = prefs.accent;
  return vars;
}
