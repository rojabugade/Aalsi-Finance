"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, CircleDot, Grid2X2, LayoutDashboard, Palette, Shield, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import type { useDashboard } from "@/lib/dashboard/use-dashboard";
import { WidgetsSection } from "./sections/widgets-section";
import { ThemeSection } from "./sections/theme-section";
import { PrivacySection } from "./sections/privacy-section";
import type { BoardPrefs } from "@/lib/dashboard/boards";
import { TemplateGallery } from "@/components/dashboard/onboarding/template-gallery";
import { getTemplate, itemsFromTemplate, type TemplateId } from "@/lib/dashboard/templates";

export type PaneTab = "layout" | "widgets" | "appearance" | "privacy";
const TABS = [
  ["layout", "Layout", LayoutDashboard],
  ["widgets", "Widgets", Grid2X2],
  ["appearance", "Appearance", Palette],
  ["privacy", "Privacy", Shield],
] as const satisfies readonly [PaneTab, string, LucideIcon][];

const DENSITY_LABELS: Record<BoardPrefs["density"], string> = {
  compact: "Compact",
  cozy: "Balanced",
  spacious: "Open",
};

export function PersonalizePane({ open, tab, onTabChange, onOpenChange, controller }: {
  open: boolean; tab: PaneTab; onTabChange: (t: PaneTab) => void;
  onOpenChange: (v: boolean) => void; controller: ReturnType<typeof useDashboard>;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousOpenRef = useRef(open);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const measure = () => setContentHeight(content.scrollHeight);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (previousOpenRef.current === open || contentHeight === 0) return;
    previousOpenRef.current = open;

    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    const timing: KeyframeAnimationOptions = {
      duration: 480,
      easing: "cubic-bezier(0.32, 0.72, 0, 1)",
      fill: "both",
    };
    const wrapperAnimation = wrapper.animate(
      open
        ? [{ height: "0px", opacity: 0 }, { height: `${contentHeight}px`, opacity: 1 }]
        : [{ height: `${contentHeight}px`, opacity: 1 }, { height: "0px", opacity: 0 }],
      timing,
    );
    const contentAnimation = content.animate(
      open
        ? [{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }]
        : [{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }],
      timing,
    );

    return () => {
      wrapperAnimation.cancel();
      contentAnimation.cancel();
    };
  }, [contentHeight, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  return (
    <div
      ref={wrapperRef}
      aria-hidden={!open}
      style={{ height: open ? contentHeight : 0, opacity: open ? 1 : 0 }}
      className={`w-full overflow-hidden ${
        open ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div ref={contentRef} className="pt-2 will-change-transform">
        <section
          className="overflow-hidden rounded-[1.1rem] border border-border bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent)_12%,transparent),transparent_30%),var(--card)]/80 shadow-card backdrop-blur-xl"
        >
          <div className="grid gap-3 border-b border-border px-4 py-3 xl:grid-cols-[minmax(240px,0.75fr)_minmax(380px,1fr)_auto] xl:items-center">
            <div className="min-w-0">
              <h2 className="text-[16px] font-bold text-fg">Personalize your dashboard</h2>
              <p className="mt-0.5 text-[12px] text-muted">Make your dashboard work the way you do.</p>
            </div>

            <div role="tablist" className="flex min-w-0 items-center justify-center gap-4 overflow-hidden">
              {TABS.map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => onTabChange(id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-1 py-2 text-[12px] font-semibold transition-colors ${tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 xl:justify-end">
              <button type="button" onClick={() => onTabChange("layout")} className="rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-fg hover:border-accent/50">Save preset</button>
              <button aria-label="Close" onClick={() => onOpenChange(false)} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-chip hover:text-fg"><X className="size-3.5" /></button>
            </div>
          </div>

          <div>
            {tab === "layout" && <LayoutPanel controller={controller} onMoreOptions={() => onTabChange("widgets")} />}
            {tab === "widgets" && <WidgetsSection controller={controller} />}
            {tab === "appearance" && <ThemeSection controller={controller} />}
            {tab === "privacy" && <PrivacySection controller={controller} />}
          </div>
        </section>
      </div>
    </div>
  );
}

function LayoutPanel({ controller, onMoreOptions }: { controller: ReturnType<typeof useDashboard>; onMoreOptions: () => void }) {
  const { state, setPrefs } = controller;
  const { prefs } = state;

  const applyTemplate = (id: TemplateId) => {
    const t = getTemplate(id);
    controller.applySetup(itemsFromTemplate(t), t.prefs ?? {});
  };

  return (
    <div>
      <div className="grid lg:grid-cols-[1.02fr_0.98fr]">
        <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
          <p className="text-[15px] font-bold">1. Choose a preset</p>
          <p className="mt-1.5 text-[12px] text-muted">Pick a goal-focused starting point. This swaps in a new set of widgets.</p>

          <div className="mt-3">
            <TemplateGallery onPick={applyTemplate} labelKey="name" />
          </div>
        </div>

        <div className="p-4">
          <p className="text-[15px] font-bold">2. Quick tweaks</p>
          <p className="mt-1.5 text-[12px] text-muted">Adjust the essentials. See changes instantly.</p>

          <div className="mt-4 space-y-3">
            <TweakRow icon={<Grid2X2 className="size-5" />} label="Density">
              <div className="grid w-full max-w-[236px] grid-cols-3 rounded-lg border border-border bg-card/50 p-1">
                {(["compact", "cozy", "spacious"] as const).map((density) => (
                  <button
                    key={density}
                    type="button"
                    aria-label={DENSITY_LABELS[density]}
                    onClick={() => setPrefs({ density })}
                    className={`rounded-md px-1.5 py-1.5 text-[11px] font-semibold ${prefs.density === density ? "border border-accent bg-accent-soft/20 text-accent" : "text-muted hover:text-fg"}`}
                  >
                    {DENSITY_LABELS[density]}
                  </button>
                ))}
              </div>
            </TweakRow>

            <TweakRow icon={<CircleDot className="size-5" />} label="Transparency">
              <div className="w-full max-w-[236px]">
                <input aria-label="Transparency" type="range" min={0} max={100} value={prefs.glass} onChange={(e) => setPrefs({ glass: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
                <div className="mt-0.5 flex justify-between text-[10px] font-semibold text-muted"><span>0%</span><span className="text-accent">{prefs.glass}%</span><span>100%</span></div>
              </div>
            </TweakRow>

            <TweakRow icon={<span className="text-[18px] font-bold text-accent">Aa</span>} label="Show labels">
              <button type="button" role="switch" aria-checked={prefs.showLabels} onClick={() => setPrefs({ showLabels: !prefs.showLabels })} className={`flex h-8 w-12 items-center rounded-full p-1 transition-colors ${prefs.showLabels ? "bg-accent" : "bg-track"}`}>
                <span className={`size-6 rounded-full bg-white transition-transform ${prefs.showLabels ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </TweakRow>
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <button type="button" onClick={onMoreOptions} className="flex w-full items-center justify-between rounded-[0.9rem] border border-border bg-card/35 px-4 py-3 text-left hover:border-accent/40">
          <span className="flex min-w-0 items-center gap-3">
            <SlidersHorizontal className="size-4 text-fg" />
            <span className="text-[13px] font-bold text-fg">More options</span>
            <span className="truncate text-[12px] text-muted">Fine-tune widgets, layout, and visibility.</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted" />
        </button>
      </div>
    </div>
  );
}

function TweakRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[50px] items-center gap-3 rounded-[0.9rem] border border-border bg-card/35 px-3 py-2.5">
      <div className="grid size-6 place-items-center text-accent">{icon}</div>
      <div className="min-w-[92px] flex-1 text-[13px] font-bold">{label}</div>
      <div className="flex justify-end">{children}</div>
    </div>
  );
}
