"use client";
import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "@/lib/dashboard/use-dashboard";
import { DashboardGrid } from "@/components/dashboard/grid/dashboard-grid";
import { PersonalizePane, type PaneTab } from "@/components/dashboard/grid/personalize/personalize-pane";
import { DashboardControls } from "@/components/dashboard/controls/dashboard-controls";
import { PrivacyProvider } from "@/components/dashboard/privacy-provider";
import { appearanceVars } from "@/lib/theme/appearance";
import { OnboardingModal } from "@/components/dashboard/onboarding/onboarding-modal";
import { shouldOnboard, markOnboarded } from "@/lib/dashboard/onboarding-gate";
import { getTemplate, itemsFromTemplate, type TemplateId } from "@/lib/dashboard/templates";
import { makeActionHandler } from "@/components/dashboard/analyst/action-handlers";
import { useAnalyst } from "@/components/dashboard/analyst/use-analyst";
import { presetRange } from "@/lib/dates";

export function ClassicTargetDashboard() {
  const controller = useDashboard("dashboard");
  const analyst = useAnalyst();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PaneTab>("layout");
  const editing = open && tab === "layout"; // drag/resize only in Layout tab
  // Stable per prefs.range — presetRange() returns a fresh object, so memoize it
  // to keep the analyst-range sync effect from firing on every render.
  const range = useMemo(() => presetRange(controller.state.prefs.range), [controller.state.prefs.range]);

  const [onboarding, setOnboarding] = useState(false);
  const [blurb, setBlurb] = useState<string | null>(null);

  useEffect(() => {
    if (shouldOnboard("dashboard")) setOnboarding(true);
  }, []);

  const pickTemplate = (id: TemplateId) => {
    const t = getTemplate(id);
    controller.applySetup(itemsFromTemplate(t), t.prefs ?? {});
    markOnboarded("dashboard");
    setOnboarding(false);
    setBlurb(t.blurb);
  };

  const skipOnboarding = () => {
    markOnboarded("dashboard");
    setOnboarding(false);
  };

  const { radius, glass, shadow, accent } = controller.state.prefs;
  useEffect(() => {
    const el = document.documentElement;
    const vars = appearanceVars({ radius, glass, shadow, accent });
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    // accent: null clears any prior override so the theme preset default applies
    if (!accent) el.style.removeProperty("--accent");
  }, [radius, glass, shadow, accent]);

  const setOpenMode = (next: boolean) => {
    setOpen(next);
    if (!next) controller.select(null);
  };

  const onAction = makeActionHandler({
    controller,
    openPersonalize: (nextTab) => {
      const validTabs: PaneTab[] = ["layout", "widgets", "appearance", "privacy"];
      setTab(validTabs.includes(nextTab as PaneTab) ? nextTab as PaneTab : "layout");
      setOpen(true);
    },
    focusWidget: (widget) => {
      document.querySelector(`[data-widget="${CSS.escape(widget)}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    },
    snooze: () => {},
    dismiss: () => {},
  });

  // The analyst lives in the app shell now; register the dashboard's richer
  // action handler + its own date range while this page is mounted.
  const { setActionHandler, setRange } = analyst;
  useEffect(() => { setActionHandler(onAction); }, [onAction, setActionHandler]);
  useEffect(() => { setRange(range); }, [range, setRange]);

  return (
    <PrivacyProvider level={controller.state.prefs.privacy}>
      <div className="space-y-3" data-liquid-source>
          {blurb && (
            <div className="flex items-start gap-3 rounded-[0.95rem] border border-accent/40 bg-accent-soft/15 px-4 py-3">
              <p className="flex-1 text-[13px] text-fg">{blurb}</p>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setBlurb(null)}
                className="text-[12px] font-semibold text-muted hover:text-fg"
              >
                Got it
              </button>
            </div>
          )}
          <DashboardControls
            range={controller.state.prefs.range}
            onRangeChange={(range) => controller.setPrefs({ range })}
            editing={open}
            onToggleEditing={() => setOpenMode(!open)}
            personalizeSlot={
              <PersonalizePane open={open} tab={tab} onTabChange={setTab} onOpenChange={setOpenMode} controller={controller} />
            }
          />
          <DashboardGrid boardId="dashboard" editing={editing} controller={controller} />
          <OnboardingModal open={onboarding} onPick={pickTemplate} onSkip={skipOnboarding} />
        </div>
    </PrivacyProvider>
  );
}
