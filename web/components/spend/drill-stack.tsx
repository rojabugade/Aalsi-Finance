"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Category, Transaction } from "@/lib/api/transactions";
import type { Period } from "@/lib/spend/period";
import { DrillPanel } from "./drill-panel";
import { DrillNavContext, frameKey, frameTitle, type DrillFrame } from "./drill-nav";
import { Sparkles } from "lucide-react";
import { CategoryDrillBody } from "./category-drill";
import { MerchantDrillBody } from "./merchant-drill";
import { BucketDrillBody } from "./bucket-drill";
import { TransactionDetailBody } from "@/components/transactions/transaction-detail";
import { useAnalyst } from "@/components/dashboard/analyst/use-analyst";

/**
 * One slide-over panel hosting a horizontal track of drill frames. Pushing a
 * frame slides the track left so the current view exits left and the new one
 * enters from the right; popping reverses it. Back at depth 1 (and the close ✕)
 * call onClose. The root frame is supplied by the page (URL-addressable for
 * category/merchant); deeper frames live in local state.
 */
export function DrillStack({
  rootFrame, rootBackLabel, onClose, txns, cats, currency, period,
}: {
  rootFrame: DrillFrame | null;
  rootBackLabel: string;
  onClose: () => void;
  txns: Transaction[];
  cats: Category[];
  currency: string;
  period: Period;
}) {
  const [frames, setFrames] = useState<DrillFrame[]>([]);
  const [active, setActive] = useState(0);
  const analyst = useAnalyst();

  // Seed / reset the stack from the page-supplied root frame.
  const rootKey = rootFrame ? frameKey(rootFrame) : null;
  useEffect(() => {
    if (rootFrame) { setFrames([rootFrame]); setActive(0); }
    else { setFrames([]); setActive(0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootKey]);

  const push = useCallback((f: DrillFrame) => {
    setFrames((prev) => [...prev.slice(0, active + 1), f]);
    setActive((i) => i + 1);
  }, [active]);

  const trim = useCallback(() => setFrames((prev) => prev.slice(0, active + 1)), [active]);

  const clearFocus = analyst.clearFocus;
  const pop = useCallback(() => {
    if (active === 0) { clearFocus(); onClose(); return; }
    // Slide back; the stale tail column is trimmed on transitionEnd.
    setActive((i) => i - 1);
  }, [active, onClose, clearFocus]);

  const nav = useMemo(() => ({ push, pop, depth: active + 1 }), [push, pop, active]);

  const top = frames[active] ?? null;
  const parent = active > 0 ? frames[active - 1] : null;
  const title = top ? frameTitle(top, cats, txns) : "";
  const backLabel = parent ? frameTitle(parent, cats, txns) : rootBackLabel;

  // The analyst can be asked about the entity in view (category or merchant).
  const askFocus =
    top && top.kind === "category" ? { kind: "category" as const, label: title, id: top.id }
    : top && top.kind === "merchant" ? { kind: "merchant" as const, label: title, id: undefined }
    : null;

  const handleClose = () => { analyst.clearFocus(); onClose(); };

  const renderFrame = (f: DrillFrame) => {
    switch (f.kind) {
      case "category": {
        const parentCat = cats.find((c) => c.id === f.id);
        return parentCat
          ? <CategoryDrillBody parent={parentCat} txns={txns} cats={cats} currency={currency} period={period} />
          : <Gone />;
      }
      case "merchant":
        return <MerchantDrillBody merchant={f.name} txns={txns} cats={cats} currency={currency} period={period} />;
      case "bucket":
        return <BucketDrillBody from={f.from} to={f.to} txns={txns} currency={currency} />;
      case "transaction": {
        const txn = txns.find((t) => t.id === f.id);
        return txn ? <TransactionDetailBody txn={txn} categories={cats} onClose={pop} /> : <Gone />;
      }
    }
  };

  return (
    <DrillNavContext.Provider value={nav}>
      <DrillPanel
        open={rootFrame !== null}
        onOpenChange={(o) => { if (!o) handleClose(); }}
        onBack={pop}
        title={title}
        subtitle={period.label}
        backLabel={backLabel}
      >
        <div className="flex h-full flex-col">
          {askFocus && (
            <button
              type="button"
              onClick={() => { analyst.setFocus(askFocus); analyst.openPane("explain"); }}
              className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-chip bg-accent-soft/30 px-3 py-1.5 text-[12px] font-semibold text-accent transition-colors hover:bg-accent-soft/50"
            >
              <Sparkles className="size-3.5" /> Ask about {title}
            </button>
          )}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              className="flex h-full transition-transform duration-300 ease-out will-change-transform"
              style={{ transform: `translateX(-${active * 100}%)` }}
              onTransitionEnd={trim}
            >
              {frames.map((f, i) => (
                <div key={frameKey(f) + i} className="h-full w-full flex-none overflow-y-auto pr-0.5" aria-hidden={i !== active}>
                  {Math.abs(i - active) <= 1 ? renderFrame(f) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DrillPanel>
    </DrillNavContext.Provider>
  );
}

function Gone() {
  return <p className="py-10 text-center text-sm text-muted">This item is no longer available.</p>;
}
