"use client";
import type { WidgetConfig } from "./grid";
import type { WidgetContract, WidgetState, Insight, RenderCtx } from "./widget-contract";
import type { Block } from "./blocks";
import type { Form, Tier } from "./tier";
import { resolveTier } from "./tier";
import type { Preset } from "./density";
import { BlockRenderer } from "@/components/dashboard/widgets/block-renderer";

type WidgetView<VM> = {
  stat: (vm: VM) => Block[];
  list: (vm: VM, tier: Tier) => Block[];
  chart?: (vm: VM, tier: Tier) => Block[];
};

export type SDKWidgetOpts<VM> = {
  data: (config: WidgetConfig) => WidgetState<VM>;
  insights?: (vm: VM, config: WidgetConfig) => Insight[];
  supportedForms?: Form[];
  view: WidgetView<VM>;
  focus?: (vm: VM) => Block[];
  emptyHint?: string;
  /** Minimum columns this widget can meaningfully display. Defaults to 1. */
  minW?: number;
  /** Minimum rows this widget can meaningfully display. Defaults to 1. */
  minH?: number;
};

export function defineWidget<VM>(opts: SDKWidgetOpts<VM>): WidgetContract<VM> {
  return {
    useData: opts.data,
    deriveInsights: opts.insights,
    emptyHint: opts.emptyHint,
    minW: opts.minW,
    minH: opts.minH,
    Body(ctx: RenderCtx<VM>) {
      const tier = resolveTier({
        preset: ctx.config.preset as Preset | undefined,
        w: ctx.w,
        h: ctx.h,
        form: ctx.config.chart,
        supportedForms: opts.supportedForms,
        count: ctx.config.count,
        cellH: ctx.cellH,
      });
      let blocks: Block[];
      if (tier.kind === "stat") {
        blocks = opts.view.stat(ctx.data);
      } else if (tier.kind === "chart" && opts.view.chart) {
        blocks = opts.view.chart(ctx.data, tier);
      } else {
        blocks = opts.view.list(ctx.data, tier);
      }
      return <BlockRenderer blocks={blocks} tier={tier} />;
    },
    Focus: opts.focus
      ? (ctx: RenderCtx<VM>) => <BlockRenderer blocks={opts.focus!(ctx.data)} />
      : undefined,
  };
}
