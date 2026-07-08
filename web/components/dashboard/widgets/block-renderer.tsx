"use client";
import type { Block, RowBlock } from "@/lib/dashboard/blocks";
import type { Tier } from "@/lib/dashboard/tier";
import { Private } from "@/components/dashboard/privacy-provider";

const RING = [
  "var(--accent)", "var(--c3)", "var(--c2)",
  "color-mix(in srgb, var(--accent) 48%, var(--c3))",
  "var(--muted)",
  "color-mix(in srgb, var(--c2) 70%, var(--accent))",
  "color-mix(in srgb, var(--c3) 65%, var(--c2))",
  "color-mix(in srgb, var(--accent) 60%, var(--fg))",
];

function isMoneyLike(value: string) {
  return /^[-+−]?[\s$€£₹]?\d/.test(value.trim());
}

/** Privacy-aware value: masks monetary figures per the active privacy level. */
function MoneyText({ value }: { value: string }) {
  return isMoneyLike(value) ? <Private kind="money">{value}</Private> : <>{value}</>;
}

export function BlockRenderer({ blocks, tier }: { blocks: Block[]; tier?: Tier }) {
  const sole = blocks.length === 1;
  const tiny = tier?.kind === "stat";
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {blocks.map((b, i) => (
        <BlockNode key={i} block={b} tier={tier} sole={sole} first={i === 0} tiny={tiny} />
      ))}
    </div>
  );
}

function BlockNode({ block, tier, sole, first: _first, tiny }: { block: Block; tier?: Tier; sole: boolean; first: boolean; tiny?: boolean }) {
  switch (block.kind) {
    case "stat":    return <StatBlock block={block} sole={sole} tiny={tiny} />;
    case "list":    return <ListBlock block={block} tier={tier} />;
    case "bars":    return <BarsBlock block={block} />;
    case "donut":   return <DonutBlock block={block} />;
    case "area":    return <AreaBlock block={block} />;
    case "row":     return <RowItem row={block} />;
    case "section": return <SectionBlock block={block} tier={tier} />;
    default: return null;
  }
}

function StatBlock({ block, sole, tiny }: { block: Extract<Block, { kind: "stat" }>; sole: boolean; tiny?: boolean }) {
  const money = tiny && isMoneyLike(block.value);
  return (
    <div
      data-block-kind="stat"
      className={`${sole ? "flex flex-1 flex-col justify-center" : "shrink-0 flex flex-col"} min-h-0 overflow-hidden`}
    >
      <p className={`${tiny ? "text-[8.5px]" : "text-[10px]"} truncate font-bold uppercase tracking-wide text-muted`}>{block.label}</p>
      <p className={`${tiny ? (money ? "whitespace-nowrap text-[20px] leading-none tracking-[-0.04em]" : "text-[17px] leading-[1.02]") : "truncate text-2xl"} mt-0.5 ${tiny && !money ? "max-h-[2.2rem]" : "max-h-12"} overflow-hidden break-words font-extrabold tabular-nums tracking-tight`}><MoneyText value={block.value} /></p>
      {block.hint && <p className={`${tiny ? "text-[10px] leading-tight" : "text-[11px]"} mt-0.5 truncate text-muted`}>{block.hint}</p>}
      {block.delta && <p className={`${tiny ? "text-[10px] leading-tight" : "text-[11px]"} mt-0.5 truncate font-semibold`}>{block.delta}</p>}
    </div>
  );
}

function RowItem({ row }: { row: RowBlock }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="truncate text-muted">{row.label}</span>
        {row.value && <span className="shrink-0 tabular-nums"><MoneyText value={row.value} /></span>}
      </div>
      {row.bar && (
        <div className="mt-0.5 h-1 overflow-hidden rounded bg-track">
          <span
            className="block h-full rounded"
            style={{ width: `${Math.max(4, row.bar.pct)}%`, background: row.bar.color ?? "var(--accent)" }}
          />
        </div>
      )}
    </div>
  );
}

function ListBlock({ block, tier }: { block: Extract<Block, { kind: "list" }>; tier?: Tier }) {
  const rows = tier ? block.rows.slice(0, tier.rows) : block.rows;
  return (
    <div data-block-kind="list" className="flex flex-1 flex-col gap-1 min-h-0 overflow-hidden">
      {rows.map((r, i) => <RowItem key={i} row={r} />)}
    </div>
  );
}

function BarsBlock({ block }: { block: Extract<Block, { kind: "bars" }> }) {
  return (
    <div data-block-kind="bars" className="flex flex-1 flex-col gap-2 min-h-0 overflow-hidden">
      {block.rows.map((r, i) => (
        <div key={i}>
          <div className="flex justify-between gap-2 text-[12.5px]">
            <span className="truncate text-muted">{r.label}</span>
            <span className="shrink-0 tabular-nums"><MoneyText value={r.value} /></span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-track">
            <span
              className="block h-full rounded"
              style={{ width: `${Math.max(4, r.pct)}%`, background: r.color ?? RING[i % RING.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutBlock({ block }: { block: Extract<Block, { kind: "donut" }> }) {
  let acc = 0;
  const gradient = block.slices
    .map((s, i) => {
      const from = acc;
      acc += s.pct;
      return `${s.color ?? RING[i % RING.length]} ${from}% ${acc}%`;
    })
    .join(", ");
  return (
    <div
      data-block-kind="donut"
      className={`flex flex-1 min-h-0 items-center overflow-hidden ${block.legend ? "gap-4" : "justify-center"}`}
    >
      <div
        className="size-28 shrink-0 rounded-full"
        style={{
          background: `conic-gradient(${gradient})`,
          mask: "radial-gradient(transparent 52%, #000 53%)",
          WebkitMask: "radial-gradient(transparent 52%, #000 53%)",
        }}
      />
      {block.legend && (
        // Top-anchored + clipped: if the legend can't fully fit, it loses the
        // last (least important) row, never the top entry.
        <div className="flex min-w-0 max-h-full flex-1 flex-col gap-1 overflow-hidden">
          {block.slices.map((s, i) => (
            <div key={i} className="flex shrink-0 items-center gap-2 text-[11.5px] leading-tight text-muted">
              <span className="size-2 shrink-0 rounded-sm" style={{ background: s.color ?? RING[i % RING.length] }} />
              <span className="truncate">{s.label}</span>
              <b className="ml-auto tabular-nums text-fg"><MoneyText value={s.value} /></b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AreaBlock({ block }: { block: Extract<Block, { kind: "area" }> }) {
  if (block.points.length < 2) return <div data-block-kind="area" className="flex-1 min-h-0" />;
  const max = Math.max(...block.points);
  const min = Math.min(...block.points);
  const range = max - min || 1;
  const W = 100, H = 40;
  const pts = block.points.map((v, i) => ({
    x: (i / (block.points.length - 1)) * W,
    y: H - ((v - min) / range) * H,
  }));
  const line = `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
  const fill = `${line} L ${pts[pts.length - 1].x} ${H} L 0 ${H} Z`;
  return (
    <div data-block-kind="area" className="flex flex-1 min-h-0 items-end">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
        <path d={fill} fill="var(--accent)" fillOpacity="0.15" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function SectionBlock({ block, tier }: { block: Extract<Block, { kind: "section" }>; tier?: Tier }) {
  return (
    <div data-block-kind="section" className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{block.label}</p>
      <div className="space-y-1">
        {block.blocks.map((b, i) => <BlockNode key={i} block={b} tier={tier} sole={false} first={i === 0} />)}
      </div>
    </div>
  );
}
