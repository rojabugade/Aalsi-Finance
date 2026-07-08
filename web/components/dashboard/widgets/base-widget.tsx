"use client";
import type { WidgetDef } from "@/lib/dashboard/registry";
import type { WidgetConfig } from "@/lib/dashboard/grid";
import type { WidgetContract, RenderCtx } from "@/lib/dashboard/widget-contract";
import { chipCap } from "@/lib/dashboard/density";
import { effectiveDensityFor } from "@/lib/dashboard/density-modes";
import type { DensityModeId } from "@/lib/dashboard/boards";
import { WidgetLoading, WidgetEmpty, WidgetError, WidgetPartial } from "./widget-states";
import { InsightChips } from "./insight-chips";
import { FocusView } from "./focus-view";

type BaseProps = {
  def: WidgetDef;
  config: WidgetConfig;
  w: number;
  h: number;
  cellH?: number;
  /** Active board density mode; supplies the baseline preset when config has none. */
  mode?: DensityModeId;
  focusOpen: boolean;
  onFocusChange: (v: boolean) => void;
};

export function BaseWidget(props: BaseProps) {
  return <ContractWidget {...props} contract={props.def.contract} />;
}

function ContractWidget({
  def,
  config,
  w,
  h,
  cellH,
  mode = "balanced",
  focusOpen,
  onFocusChange,
  contract,
}: BaseProps & { contract: WidgetContract<unknown> }) {
  const state = contract.useData(config);
  const title = config.title || def.title;

  if (state.status === "loading") return <WidgetLoading />;
  if (state.status === "error") return <WidgetError />;
  if (state.status === "empty") return <WidgetEmpty hint={contract.emptyHint} />;

  const density = effectiveDensityFor(config.preset, mode, w, h);
  const ctx: RenderCtx<unknown> = { data: state.data, config, density, w, h, cellH };
  const insights = contract.deriveInsights?.(state.data, config) ?? [];
  const showInsights = density > 0 && insights.length > 0;

  const content = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">{contract.Body(ctx)}</div>
      {showInsights && (
        <div className="mt-1.5 shrink-0">
          <InsightChips insights={insights} cap={chipCap(density)} />
        </div>
      )}
    </div>
  );

  return (
    <>
      {state.status === "partial" ? (
        <WidgetPartial reason={state.partialReason ?? "Partial data"}>{content}</WidgetPartial>
      ) : (
        content
      )}
      {contract.Focus && (
        <FocusView open={focusOpen} onOpenChange={onFocusChange} title={title}>
          {contract.Focus(ctx)}
        </FocusView>
      )}
    </>
  );
}
