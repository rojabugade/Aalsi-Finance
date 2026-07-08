import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AnalystAction } from "@/lib/api/analyst";

/** Default analyst action handler used everywhere outside the dashboard.
 *  Dashboard-only actions (widgets / personalize / focus) route to /dashboard,
 *  where the page registers its richer handler via setActionHandler. */
export function makeGlobalActionHandler({ router }: { router: AppRouterInstance }) {
  return (action: AnalystAction): void => {
    switch (action.type) {
      case "create_widget":
      case "open_personalize":
      case "focus_widget":
      case "set_budget":
        router.push("/dashboard");
        return;
      case "snooze_alert":
      case "dismiss_alert":
        return; // handled by the monitor feed's own dismiss controls
    }
  };
}
