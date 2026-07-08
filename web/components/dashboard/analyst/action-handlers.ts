import type { AnalystAction } from "@/lib/api/analyst";
import { WIDGETS } from "@/lib/dashboard/registry";

type Controller = { addWidget: (type: string) => void };

export type ActionDeps = {
  controller: Controller;
  openPersonalize: (tab?: string) => void;
  focusWidget: (widget: string) => void;
  snooze: (id: string) => void;
  dismiss: (id: string) => void;
};

export function makeActionHandler(deps: ActionDeps) {
  return (action: AnalystAction): void => {
    const params = action.params ?? {};
    switch (action.type) {
      case "create_widget":
        if (typeof params.widget === "string" && params.widget in WIDGETS) deps.controller.addWidget(params.widget);
        return;
      case "open_personalize":
        deps.openPersonalize(typeof params.tab === "string" ? params.tab : undefined);
        return;
      case "focus_widget":
        if (typeof params.widget === "string") deps.focusWidget(params.widget);
        return;
      case "set_budget":
        deps.openPersonalize("widgets");
        return;
      case "snooze_alert":
        if (typeof params.id === "string") deps.snooze(params.id);
        return;
      case "dismiss_alert":
        if (typeof params.id === "string") deps.dismiss(params.id);
        return;
    }
  };
}
