# Widget Rendering Standard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three-axis rendering standard (capacity / preset / form) plus the Block vocabulary and `defineWidget()` SDK, then migrate the breakdown widget as the working proof — fixing the broken donut-at-standard-preset bug by construction.

**Architecture:** A new pure function `resolveTier()` in `lib/dashboard/tier.ts` replaces scattered `effectiveDensity()` branching as the single source of truth for what a widget renders. A serializable `Block` vocabulary in `lib/dashboard/blocks.ts` + a `BlockRenderer` scaffold component handle layout. `defineWidget()` in `lib/dashboard/define-widget.tsx` wraps these into a `WidgetContract<VM>` so authors write data → Block mappings, not flex/overflow/density branches. The breakdown widget is migrated as the §9 worked example. BaseWidget needs no changes — the SDK returns a standard `WidgetContract`. The 10 remaining widgets are a follow-up plan.

**Tech Stack:** TypeScript, React, Next.js `"use client"`, Vitest + jsdom (unit), Playwright (e2e). All imports via `@/` alias. CSS vars: `--accent`, `--c2`, `--c3`, `--muted`, `bg-track`, `text-fg`, `text-muted`, `bg-card`.

## Global Constraints

- **No backend work.** Pure frontend. No new endpoints, no DB migrations.
- **No changes to BaseWidget, grid, registry wiring, or the 10 other widgets.** Scope is exactly the SDK + breakdown migration.
- **`next lint` is not available in this repo.** Verification: `cd web && npx tsc --noEmit`, `cd web && npx vitest run <file>`, `cd web && npx playwright test e2e/widget-rendering.spec.ts`.
- **Cell model constants (working estimates from spec §5):** `HEADER_CHROME_PX=44`, `ROW_PX=22`, `PRIMARY_BLOCK_PX=44`, `GAP=12`, `CELL_H_COZY=104`. Confirmed by measuring during implementation; update constants in `tier.ts` if measurement differs.
- **`config.chart` values that map to list form:** `"list"` and `"none"`.
- **CSS tokens:** donut uses `conic-gradient` with CSS var colors. Keep color logic in `BlockRenderer`; don't re-export donut color helpers from the widget.
- **Block vocabulary is intentionally small.** Do not add new block kinds without updating both `blocks.ts` and `block-renderer.tsx`.

---

### Task 1: `tier.ts` — `capacity`, `resolveTier`, `rowCapacity`

**Files:**
- Create: `web/lib/dashboard/tier.ts`
- Create: `web/lib/dashboard/tier.test.ts`

**Interfaces:**
- Consumes: `Preset`, `PRESET_LEVEL` from `./density`; `WidgetConfig` from `./grid`.
- Produces:
  - `Form = "bars" | "donut" | "area" | "list"`
  - `TierKind = "stat" | "list" | "chart"`
  - `Tier = { kind: TierKind; form: Form | null; rows: number; extras: boolean; chartPx: number }`
  - `HEADER_CHROME_PX`, `ROW_PX`, `PRIMARY_BLOCK_PX`, `GAP` (exported constants)
  - `capacity(w, h): 0|1|2|3`
  - `rowCapacity(w, h, cellH?): number`
  - `resolveTier({ preset?, w, h, form?, supportedForms?, count?, dataLength?, cellH? }): Tier`

- [ ] **Step 1: Write the failing tests**

```ts
// web/lib/dashboard/tier.test.ts
import { describe, expect, it } from "vitest";
import { capacity, rowCapacity, resolveTier } from "./tier";

describe("capacity", () => {
  it("1×1 → 0", () => expect(capacity(1, 1)).toBe(0));
  it("2×1, 1×2 → 1", () => { expect(capacity(2, 1)).toBe(1); expect(capacity(1, 2)).toBe(1); });
  it("2×2 → 2", () => expect(capacity(2, 2)).toBe(2));
  it("4×2 → 3", () => expect(capacity(4, 2)).toBe(3));
  it("5×3 → 3", () => expect(capacity(5, 3)).toBe(3));
});

describe("rowCapacity", () => {
  it("5×2 cozy → 6 rows", () => expect(rowCapacity(5, 2)).toBe(6));
  it("5×3 cozy → 11 rows", () => expect(rowCapacity(5, 3)).toBe(11));
  it("grows monotonically with h", () => {
    expect(rowCapacity(5, 3)).toBeGreaterThan(rowCapacity(5, 2));
    expect(rowCapacity(5, 2)).toBeGreaterThan(rowCapacity(5, 1));
  });
  it("compact cellH=88 yields fewer rows than cozy", () =>
    expect(rowCapacity(5, 2, 88)).toBeLessThanOrEqual(rowCapacity(5, 2, 104)));
});

describe("resolveTier — compact / stat", () => {
  it("compact preset always → stat regardless of size", () => {
    const t = resolveTier({ preset: "compact", w: 5, h: 3 });
    expect(t.kind).toBe("stat");
    expect(t.form).toBeNull();
  });
  it("1×1 (cap=0) → stat", () => {
    const t = resolveTier({ preset: "standard", w: 1, h: 1 });
    expect(t.kind).toBe("stat");
  });
});

describe("resolveTier — the §1 bug fix", () => {
  it("standard + 5×3 + donut + [donut,bars,list] → chart/donut", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 3, form: "donut", supportedForms: ["donut", "bars", "list"] });
    expect(t.kind).toBe("chart");
    expect(t.form).toBe("donut");
  });
  it("standard + 5×2 + donut + [donut,bars,list] → chart/donut (not a list)", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2, form: "donut", supportedForms: ["donut", "bars", "list"] });
    expect(t.kind).toBe("chart");
    expect(t.form).toBe("donut");
  });
});

describe("resolveTier — form fallback", () => {
  it("donut at cap=1 (2×1) falls back to bars when bars is supported", () => {
    const t = resolveTier({ preset: "standard", w: 2, h: 1, form: "donut", supportedForms: ["donut", "bars", "list"] });
    expect(t.form).not.toBe("donut");
    expect(t.kind).toBe("chart");
    expect(t.form).toBe("bars");
  });
  it("donut at cap=1 falls back to list when only donut+list supported", () => {
    const t = resolveTier({ preset: "standard", w: 2, h: 1, form: "donut", supportedForms: ["donut", "list"] });
    expect(t.kind).toBe("list");
    expect(t.form).toBeNull();
  });
});

describe("resolveTier — default form (no explicit choice)", () => {
  it("picks richest supported form at cap≥2", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2, supportedForms: ["donut", "bars", "list"] });
    expect(t.form).toBe("donut");
  });
  it("picks bars over list at cap=1", () => {
    const t = resolveTier({ preset: "standard", w: 2, h: 1, supportedForms: ["donut", "bars", "list"] });
    expect(t.form).toBe("bars");
    expect(t.kind).toBe("chart");
  });
  it("falls to list when no supportedForms given", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2 });
    expect(t.kind).toBe("list");
    expect(t.form).toBeNull();
  });
});

describe("resolveTier — extras / preset tuning", () => {
  it("detailed preset → extras=true", () => {
    const t = resolveTier({ preset: "detailed", w: 5, h: 2, supportedForms: ["donut"] });
    expect(t.extras).toBe(true);
  });
  it("standard preset → extras=false", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2, supportedForms: ["donut"] });
    expect(t.extras).toBe(false);
  });
  it("analytical preset → extras=true", () => {
    const t = resolveTier({ preset: "analytical", w: 5, h: 3, supportedForms: ["donut"] });
    expect(t.extras).toBe(true);
  });
});

describe("resolveTier — rows", () => {
  it("rows capped by rowCapacity: 5×2, count=20 → 6", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2, count: 20, dataLength: 20 });
    expect(t.rows).toBe(6);
  });
  it("rows capped by count: 5×3, count=3 → 3", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 3, count: 3, dataLength: 20 });
    expect(t.rows).toBe(3);
  });
  it("rows capped by dataLength: 5×2, count=10, dataLength=2 → 2", () => {
    const t = resolveTier({ preset: "standard", w: 5, h: 2, count: 10, dataLength: 2 });
    expect(t.rows).toBe(2);
  });
  it("rows is at least 1 in list/chart mode", () => {
    const t = resolveTier({ preset: "standard", w: 2, h: 1, count: 5, dataLength: 5 });
    expect(t.rows).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/dashboard/tier.test.ts`
Expected: FAIL — cannot find module `./tier`.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/dashboard/tier.ts
import type { Preset } from "./density";
import { PRESET_LEVEL } from "./density";

export type Form = "bars" | "donut" | "area" | "list";
export type TierKind = "stat" | "list" | "chart";

export type Tier = {
  kind: TierKind;
  form: Form | null;
  rows: number;
  extras: boolean;
  chartPx: number;
};

export const HEADER_CHROME_PX = 44;
export const ROW_PX = 22;
export const PRIMARY_BLOCK_PX = 44;
export const GAP = 12;

const FORM_THRESHOLD: Record<Form, number> = { list: 1, bars: 1, donut: 2, area: 2 };

export function capacity(w: number, h: number): 0 | 1 | 2 | 3 {
  if (w >= 4 && h >= 2) return 3;
  if (w >= 2 && h >= 2) return 2;
  if (w >= 2 || h >= 2) return 1;
  return 0;
}

export function rowCapacity(w: number, h: number, cellH = 104): number {
  const bodyPx = h * cellH + (h - 1) * GAP - HEADER_CHROME_PX;
  return Math.max(0, Math.floor((bodyPx - PRIMARY_BLOCK_PX) / ROW_PX));
}

function richestFittingForm(validForms: Form[], cap: number): Form {
  const fitting = validForms.filter((f) => FORM_THRESHOLD[f] <= cap);
  if (fitting.length === 0) return "list";
  return fitting.reduce((best, f) => (FORM_THRESHOLD[f] > FORM_THRESHOLD[best] ? f : best));
}

export function resolveTier(opts: {
  preset?: Preset;
  w: number;
  h: number;
  form?: string | null;
  supportedForms?: Form[];
  count?: number;
  dataLength?: number;
  cellH?: number;
}): Tier {
  const {
    preset = "standard", w, h,
    form, supportedForms = [],
    count = 999, dataLength = 999, cellH = 104,
  } = opts;
  const cap = capacity(w, h);

  if (preset === "compact" || cap === 0) {
    return { kind: "stat", form: null, rows: 0, extras: false, chartPx: 0 };
  }

  const validForms: Form[] = supportedForms.length > 0 ? supportedForms : ["list"];
  const isValidForm = (f: string): f is Form =>
    f !== "none" && f !== "list" && validForms.includes(f as Form);

  let resolvedForm: Form;
  if (form && isValidForm(form)) {
    resolvedForm = FORM_THRESHOLD[form as Form] <= cap
      ? (form as Form)
      : richestFittingForm(validForms, cap);
  } else if (form === "list" && validForms.includes("list")) {
    resolvedForm = "list";
  } else {
    resolvedForm = richestFittingForm(validForms, cap);
  }

  const kind: TierKind = resolvedForm === "list" ? "list" : "chart";
  const chartForm: Form | null = kind === "chart" ? resolvedForm : null;

  const presetLevel = PRESET_LEVEL[preset];
  const rc = rowCapacity(w, h, cellH);
  const rows = Math.max(1, Math.min(count, rc > 0 ? rc : 999, dataLength));
  const extras = presetLevel >= 2;
  const chartPx = presetLevel >= 2 ? 180 : 140;

  return { kind, form: chartForm, rows, extras, chartPx };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/dashboard/tier.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/lib/dashboard/tier.ts web/lib/dashboard/tier.test.ts
git commit -m "feat(dashboard): resolveTier + rowCapacity — three-axis rendering standard"
```

---

### Task 2: Block vocabulary + BlockRenderer scaffold

**Files:**
- Create: `web/lib/dashboard/blocks.ts`
- Create: `web/components/dashboard/widgets/block-renderer.tsx`
- Create: `web/components/dashboard/widgets/block-renderer.test.tsx`

**Interfaces:**
- Consumes: `Tier` from `@/lib/dashboard/tier`.
- Produces:
  - `blocks.ts`: `Tone`, `RowBlock`, `Block` (exported union — 7 kinds)
  - `block-renderer.tsx`: `BlockRenderer({ blocks: Block[]; tier?: Tier })`

- [ ] **Step 1: Write `blocks.ts` types**

```ts
// web/lib/dashboard/blocks.ts
export type Tone = "neutral" | "positive" | "warning" | "danger";

export type RowBlock = {
  kind: "row";
  label: string;
  value?: string;
  meta?: string;
  tone?: Tone;
  bar?: { pct: number; color?: string };
};

export type Block =
  | { kind: "stat"; label: string; value: string; hint?: string; delta?: string; tone?: Tone }
  | RowBlock
  | { kind: "list"; rows: RowBlock[] }
  | { kind: "bars"; rows: { label: string; value: string; pct: number; color?: string }[] }
  | { kind: "donut"; slices: { label: string; value: string; pct: number; color?: string }[]; legend?: boolean }
  | { kind: "area"; points: number[] }
  | { kind: "section"; label: string; blocks: Block[] };
```

No test needed — pure types.

- [ ] **Step 2: Write the failing BlockRenderer tests**

```tsx
// web/components/dashboard/widgets/block-renderer.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockRenderer } from "./block-renderer";
import type { Block } from "@/lib/dashboard/blocks";
import type { Tier } from "@/lib/dashboard/tier";

const listTier: Tier = { kind: "list", form: null, rows: 5, extras: false, chartPx: 0 };

describe("BlockRenderer — stat block", () => {
  it("renders label and value", () => {
    render(<BlockRenderer blocks={[{ kind: "stat", label: "Net Worth", value: "$12,000" }]} />);
    expect(screen.getByText("Net Worth")).toBeTruthy();
    expect(screen.getByText("$12,000")).toBeTruthy();
  });
  it("outer wrapper has h-full flex-col", () => {
    const { container } = render(<BlockRenderer blocks={[{ kind: "stat", label: "L", value: "V" }]} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("h-full");
    expect(wrapper.className).toContain("flex-col");
  });
  it("applies data-block-kind=stat", () => {
    const { container } = render(<BlockRenderer blocks={[{ kind: "stat", label: "L", value: "V" }]} />);
    expect(container.querySelector('[data-block-kind="stat"]')).toBeTruthy();
  });
  it("renders optional hint", () => {
    render(<BlockRenderer blocks={[{ kind: "stat", label: "L", value: "V", hint: "hint text" }]} />);
    expect(screen.getByText("hint text")).toBeTruthy();
  });
});

describe("BlockRenderer — list block", () => {
  it("renders row labels", () => {
    const block: Block = { kind: "list", rows: [{ kind: "row", label: "Amazon", value: "$200" }, { kind: "row", label: "Uber", value: "$30" }] };
    render(<BlockRenderer blocks={[block]} tier={listTier} />);
    expect(screen.getByText("Amazon")).toBeTruthy();
    expect(screen.getByText("Uber")).toBeTruthy();
  });
  it("applies data-block-kind=list", () => {
    const block: Block = { kind: "list", rows: [{ kind: "row", label: "A", value: "B" }] };
    const { container } = render(<BlockRenderer blocks={[block]} tier={listTier} />);
    expect(container.querySelector('[data-block-kind="list"]')).toBeTruthy();
  });
  it("caps rows to tier.rows", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ kind: "row" as const, label: `Row ${i}`, value: "$1" }));
    render(<BlockRenderer blocks={[{ kind: "list", rows }]} tier={{ ...listTier, rows: 3 }} />);
    expect(screen.queryByText("Row 3")).toBeNull();
    expect(screen.getByText("Row 0")).toBeTruthy();
    expect(screen.getByText("Row 2")).toBeTruthy();
  });
  it("list block has flex-1 min-h-0", () => {
    const block: Block = { kind: "list", rows: [{ kind: "row", label: "A", value: "B" }] };
    const { container } = render(<BlockRenderer blocks={[block]} tier={listTier} />);
    const listEl = container.querySelector('[data-block-kind="list"]') as HTMLElement;
    expect(listEl.className).toContain("flex-1");
    expect(listEl.className).toContain("min-h-0");
  });
});

describe("BlockRenderer — bars block", () => {
  it("renders each bar label and value", () => {
    const block: Block = { kind: "bars", rows: [{ label: "Food", value: "$400", pct: 40, color: "var(--accent)" }, { label: "Travel", value: "$200", pct: 20 }] };
    render(<BlockRenderer blocks={[block]} />);
    expect(screen.getByText("Food")).toBeTruthy();
    expect(screen.getByText("Travel")).toBeTruthy();
  });
  it("applies data-block-kind=bars", () => {
    const block: Block = { kind: "bars", rows: [{ label: "X", value: "$1", pct: 10 }] };
    const { container } = render(<BlockRenderer blocks={[block]} />);
    expect(container.querySelector('[data-block-kind="bars"]')).toBeTruthy();
  });
});

describe("BlockRenderer — donut block", () => {
  it("renders slice labels when legend=true", () => {
    const block: Block = { kind: "donut", slices: [{ label: "Amazon", value: "$320", pct: 78 }, { label: "Other", value: "$90", pct: 22 }], legend: true };
    render(<BlockRenderer blocks={[block]} />);
    expect(screen.getByText("Amazon")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
  });
  it("applies data-block-kind=donut", () => {
    const block: Block = { kind: "donut", slices: [{ label: "X", value: "$1", pct: 100 }] };
    const { container } = render(<BlockRenderer blocks={[block]} />);
    expect(container.querySelector('[data-block-kind="donut"]')).toBeTruthy();
  });
});

describe("BlockRenderer — area block", () => {
  it("renders an SVG for area points", () => {
    const block: Block = { kind: "area", points: [10, 20, 15, 30, 25] };
    const { container } = render(<BlockRenderer blocks={[block]} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
  it("applies data-block-kind=area", () => {
    const block: Block = { kind: "area", points: [1, 2, 3] };
    const { container } = render(<BlockRenderer blocks={[block]} />);
    expect(container.querySelector('[data-block-kind="area"]')).toBeTruthy();
  });
});

describe("BlockRenderer — section block", () => {
  it("renders the section label and nested blocks", () => {
    const block: Block = { kind: "section", label: "Top spend", blocks: [{ kind: "stat", label: "L", value: "V" }] };
    render(<BlockRenderer blocks={[block]} />);
    expect(screen.getByText("Top spend")).toBeTruthy();
    expect(screen.getByText("V")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run components/dashboard/widgets/block-renderer.test.tsx`
Expected: FAIL — cannot find module `./block-renderer`.

- [ ] **Step 4: Write `BlockRenderer`**

```tsx
// web/components/dashboard/widgets/block-renderer.tsx
"use client";
import type { Block, RowBlock } from "@/lib/dashboard/blocks";
import type { Tier } from "@/lib/dashboard/tier";

const RING = [
  "var(--accent)", "var(--c3)", "var(--c2)",
  "color-mix(in srgb, var(--accent) 48%, var(--c3))",
  "var(--muted)",
  "color-mix(in srgb, var(--c2) 70%, var(--accent))",
  "color-mix(in srgb, var(--c3) 65%, var(--c2))",
  "color-mix(in srgb, var(--accent) 60%, var(--fg))",
];

export function BlockRenderer({ blocks, tier }: { blocks: Block[]; tier?: Tier }) {
  const sole = blocks.length === 1;
  return (
    <div className="flex h-full flex-col">
      {blocks.map((b, i) => (
        <BlockNode key={i} block={b} tier={tier} sole={sole} first={i === 0} />
      ))}
    </div>
  );
}

function BlockNode({ block, tier, sole, first }: { block: Block; tier?: Tier; sole: boolean; first: boolean }) {
  switch (block.kind) {
    case "stat":   return <StatBlock block={block} sole={sole} />;
    case "list":   return <ListBlock block={block} tier={tier} />;
    case "bars":   return <BarsBlock block={block} />;
    case "donut":  return <DonutBlock block={block} />;
    case "area":   return <AreaBlock block={block} />;
    case "row":    return <RowItem row={block} />;
    case "section": return <SectionBlock block={block} tier={tier} />;
    default: return null;
  }
}

function StatBlock({ block, sole }: { block: Extract<Block, { kind: "stat" }>; sole: boolean }) {
  return (
    <div
      data-block-kind="stat"
      className={sole ? "flex flex-1 flex-col justify-center" : "shrink-0 flex flex-col"}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{block.label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight">{block.value}</p>
      {block.hint && <p className="mt-0.5 text-[11px] text-muted">{block.hint}</p>}
      {block.delta && <p className="mt-0.5 text-[11px] font-semibold">{block.delta}</p>}
    </div>
  );
}

function RowItem({ row }: { row: RowBlock }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="truncate text-muted">{row.label}</span>
        {row.value && <span className="shrink-0 tabular-nums">{row.value}</span>}
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
            <span className="shrink-0 tabular-nums">{r.value}</span>
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
        <div className="min-w-0 flex-1 space-y-1">
          {block.slices.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-[11.5px] leading-tight text-muted">
              <span className="size-2 shrink-0 rounded-sm" style={{ background: s.color ?? RING[i % RING.length] }} />
              <span className="truncate">{s.label}</span>
              <b className="ml-auto tabular-nums text-fg">{s.value}</b>
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run components/dashboard/widgets/block-renderer.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/lib/dashboard/blocks.ts web/components/dashboard/widgets/block-renderer.tsx web/components/dashboard/widgets/block-renderer.test.tsx
git commit -m "feat(dashboard): Block vocabulary types + BlockRenderer scaffold with height-fill"
```

---

### Task 3: `defineWidget()` SDK

**Files:**
- Create: `web/lib/dashboard/define-widget.tsx`
- Create: `web/lib/dashboard/define-widget.test.tsx`

**Interfaces:**
- Consumes: `WidgetConfig` from `./grid`; `WidgetContract`, `WidgetState`, `Insight` from `./widget-contract`; `Block` from `./blocks`; `Form`, `Tier`, `resolveTier` from `./tier`; `BlockRenderer` from `@/components/dashboard/widgets/block-renderer`; `Preset` from `./density`.
- Produces: `defineWidget<VM>(opts: SDKWidgetOpts<VM>): WidgetContract<VM>` — returns a standard `WidgetContract` so `BaseWidget` needs no changes. The returned contract's `Body` calls `resolveTier` internally instead of using `ctx.density`.

Note: `define-widget.tsx` is a `"use client"` file because `Body` renders JSX via `BlockRenderer`.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/lib/dashboard/define-widget.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { defineWidget } from "./define-widget";
import type { Block } from "./blocks";
import type { RenderCtx } from "./widget-contract";

function makeCtx(overrides: Partial<RenderCtx<unknown>> = {}): RenderCtx<unknown> {
  return { data: {}, config: { preset: "standard" }, density: 1, w: 5, h: 2, ...overrides };
}

function Wrapper({ contract, ctx }: { contract: ReturnType<typeof defineWidget>; ctx: RenderCtx<unknown> }) {
  return <>{contract.Body(ctx)}</>;
}

describe("defineWidget — routing", () => {
  it("routes to view.stat when compact preset", () => {
    const statMock = vi.fn((): Block[] => [{ kind: "stat", label: "L", value: "V" }]);
    const contract = defineWidget({ data: () => ({ status: "ready", data: {} }), view: { stat: statMock, list: () => [] } });
    render(<Wrapper contract={contract} ctx={makeCtx({ config: { preset: "compact" } })} />);
    expect(statMock).toHaveBeenCalledTimes(1);
  });

  it("routes to view.list when no supportedForms", () => {
    const listMock = vi.fn((): Block[] => [{ kind: "list", rows: [{ kind: "row", label: "A" }] }]);
    const contract = defineWidget({ data: () => ({ status: "ready", data: {} }), view: { stat: () => [], list: listMock } });
    render(<Wrapper contract={contract} ctx={makeCtx({ w: 5, h: 2 })} />);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("routes to view.chart when donut supported and capacity allows", () => {
    const chartMock = vi.fn((): Block[] => [{ kind: "donut", slices: [{ label: "X", value: "$1", pct: 100 }] }]);
    const contract = defineWidget({
      data: () => ({ status: "ready", data: {} }),
      supportedForms: ["donut", "list"],
      view: { stat: () => [], list: () => [], chart: chartMock },
    });
    render(<Wrapper contract={contract} ctx={makeCtx({ w: 5, h: 2, config: { preset: "standard", chart: "donut" } })} />);
    expect(chartMock).toHaveBeenCalledTimes(1);
  });

  it("passes tier to list view", () => {
    let capturedTier: unknown;
    const contract = defineWidget({
      data: () => ({ status: "ready", data: {} }),
      view: {
        stat: () => [],
        list: (_, tier) => { capturedTier = tier; return []; },
      },
    });
    render(<Wrapper contract={contract} ctx={makeCtx({ w: 5, h: 2 })} />);
    expect(capturedTier).toBeDefined();
    expect((capturedTier as { kind: string }).kind).toBe("list");
  });

  it("passes tier.form to chart view", () => {
    let capturedForm: unknown;
    const contract = defineWidget({
      data: () => ({ status: "ready", data: {} }),
      supportedForms: ["donut"],
      view: {
        stat: () => [],
        list: () => [],
        chart: (_, tier) => { capturedForm = tier.form; return []; },
      },
    });
    render(<Wrapper contract={contract} ctx={makeCtx({ w: 5, h: 2, config: { preset: "standard", chart: "donut" } })} />);
    expect(capturedForm).toBe("donut");
  });

  it("exposes insights as deriveInsights on the returned contract", () => {
    const contract = defineWidget({
      data: () => ({ status: "ready", data: "hello" }),
      insights: (vm) => [{ label: String(vm), tone: "positive" }],
      view: { stat: () => [], list: () => [] },
    });
    const chips = contract.deriveInsights?.("hello", {}) ?? [];
    expect(chips[0].label).toBe("hello");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/dashboard/define-widget.test.tsx`
Expected: FAIL — cannot find module `./define-widget`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/lib/dashboard/define-widget.tsx
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
};

export function defineWidget<VM>(opts: SDKWidgetOpts<VM>): WidgetContract<VM> {
  return {
    useData: opts.data,
    deriveInsights: opts.insights,
    emptyHint: opts.emptyHint,
    Body(ctx: RenderCtx<VM>) {
      const tier = resolveTier({
        preset: ctx.config.preset as Preset | undefined,
        w: ctx.w,
        h: ctx.h,
        form: ctx.config.chart,
        supportedForms: opts.supportedForms,
        count: ctx.config.count,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/dashboard/define-widget.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/lib/dashboard/define-widget.tsx web/lib/dashboard/define-widget.test.tsx
git commit -m "feat(dashboard): defineWidget() SDK — returns WidgetContract from Block view map"
```

---

### Task 4: Migrate breakdown widget to `defineWidget()`

**Files:**
- Modify: `web/components/dashboard/widgets/breakdown-widget.tsx`
- Modify: `web/components/dashboard/widgets/breakdown-widget.test.tsx`

**Interfaces:**
- Consumes: `defineWidget` from `@/lib/dashboard/define-widget`; `queryState` from `@/lib/dashboard/widget-contract`; `Block` from `@/lib/dashboard/blocks`; existing hooks/helpers.
- Produces: `breakdownContract` — a `WidgetContract<BreakdownVM>` (same export name, new implementation). `donutSize` is removed — sizing is now handled by `BlockRenderer`'s `DonutBlock`. The `BreakdownVM` type is exported for tests.

Note: The registry entry for breakdown already does `contract: breakdownContract as WidgetContract<unknown>` — this cast stays and no registry change is needed as long as `breakdownContract` is still exported from `breakdown-widget.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/components/dashboard/widgets/breakdown-widget.test.tsx
import { describe, expect, it } from "vitest";
import { breakdownContract, type BreakdownVM } from "./breakdown-widget";
import type { Tier } from "@/lib/dashboard/tier";
import type { Insight } from "@/lib/dashboard/widget-contract";

const mockVM: BreakdownVM = {
  top: { label: "Amazon", value: 320 },
  topPct: 78,
  rows: [
    { label: "Amazon", value: 320 },
    { label: "Uber", value: 90 },
    { label: "Starbucks", value: 40 },
  ],
  total: 450,
  dimension: "merchant",
  showAmounts: true,
};

const listTier: Tier = { kind: "list", form: null, rows: 3, extras: false, chartPx: 0 };
const donutTier: Tier = { kind: "chart", form: "donut", rows: 8, extras: true, chartPx: 180 };
const barsTier: Tier = { kind: "chart", form: "bars", rows: 5, extras: false, chartPx: 140 };

describe("breakdownContract.deriveInsights", () => {
  it("names the top entry in a chip", () => {
    const chips = breakdownContract.deriveInsights!(mockVM, {}) as Insight[];
    expect(chips.some((c) => /Amazon/.test(c.label))).toBe(true);
  });
  it("warning tone when top is ≥40% of spend", () => {
    const chips = breakdownContract.deriveInsights!(mockVM, {}) as Insight[];
    expect(chips.some((c) => c.tone === "warning")).toBe(true);
  });
  it("neutral tone when top is <40%", () => {
    const vm: BreakdownVM = { ...mockVM, topPct: 30, top: { label: "Uber", value: 90 } };
    const chips = breakdownContract.deriveInsights!(vm, {}) as Insight[];
    expect(chips.some((c) => c.tone === "neutral")).toBe(true);
  });
  it("returns empty array when no top entry", () => {
    const vm: BreakdownVM = { ...mockVM, top: undefined, rows: [] };
    const chips = breakdownContract.deriveInsights!(vm, {}) as Insight[];
    expect(chips).toHaveLength(0);
  });
});

describe("breakdown view.stat", () => {
  it("returns a stat block with dimension-aware label", () => {
    const contract = breakdownContract as unknown as { view: { stat: (vm: BreakdownVM) => import("@/lib/dashboard/blocks").Block[] } };
    const [block] = contract.view.stat(mockVM);
    expect(block.kind).toBe("stat");
    if (block.kind === "stat") {
      expect(block.label).toMatch(/merchant/i);
      expect(block.value).toBe("Amazon");
      expect(block.hint).toContain("78%");
    }
  });
  it("uses category label when dimension is category", () => {
    const vm: BreakdownVM = { ...mockVM, dimension: "category" };
    const contract = breakdownContract as unknown as { view: { stat: (vm: BreakdownVM) => import("@/lib/dashboard/blocks").Block[] } };
    const [block] = contract.view.stat(vm);
    if (block.kind === "stat") expect(block.label).toMatch(/category/i);
  });
});

describe("breakdown view.list", () => {
  it("returns a list block sliced to tier.rows", () => {
    const contract = breakdownContract as unknown as { view: { list: (vm: BreakdownVM, t: Tier) => import("@/lib/dashboard/blocks").Block[] } };
    const [block] = contract.view.list(mockVM, listTier);
    expect(block.kind).toBe("list");
    if (block.kind === "list") {
      expect(block.rows).toHaveLength(3);
      expect(block.rows[0].label).toBe("Amazon");
    }
  });
  it("row blocks have bar sub-key", () => {
    const contract = breakdownContract as unknown as { view: { list: (vm: BreakdownVM, t: Tier) => import("@/lib/dashboard/blocks").Block[] } };
    const [block] = contract.view.list(mockVM, { ...listTier, rows: 1 });
    if (block.kind === "list") {
      expect(block.rows[0].bar).toBeDefined();
      expect(block.rows[0].bar!.pct).toBeGreaterThan(0);
    }
  });
});

describe("breakdown view.chart", () => {
  it("returns bars block when tier.form === bars", () => {
    const contract = breakdownContract as unknown as { view: { chart: (vm: BreakdownVM, t: Tier) => import("@/lib/dashboard/blocks").Block[] } };
    const [block] = contract.view.chart(mockVM, barsTier);
    expect(block.kind).toBe("bars");
    if (block.kind === "bars") expect(block.rows[0].label).toBe("Amazon");
  });
  it("returns donut block when tier.form === donut", () => {
    const contract = breakdownContract as unknown as { view: { chart: (vm: BreakdownVM, t: Tier) => import("@/lib/dashboard/blocks").Block[] } };
    const [block] = contract.view.chart(mockVM, donutTier);
    expect(block.kind).toBe("donut");
    if (block.kind === "donut") {
      expect(block.slices.some((s) => s.label === "Amazon")).toBe(true);
      expect(block.legend).toBe(true);
    }
  });
  it("donut legend=false when extras=false", () => {
    const contract = breakdownContract as unknown as { view: { chart: (vm: BreakdownVM, t: Tier) => import("@/lib/dashboard/blocks").Block[] } };
    const [block] = contract.view.chart(mockVM, { ...donutTier, extras: false });
    if (block.kind === "donut") expect(block.legend).toBe(false);
  });
});

describe("breakdown focus", () => {
  it("returns donut block with legend=true", () => {
    const contract = breakdownContract as unknown as { focus: (vm: BreakdownVM) => import("@/lib/dashboard/blocks").Block[] };
    const [block] = contract.focus(mockVM);
    expect(block.kind).toBe("donut");
    if (block.kind === "donut") expect(block.legend).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run components/dashboard/widgets/breakdown-widget.test.tsx`
Expected: FAIL — `BreakdownVM` not exported; tests for old structure pass but new VM/view tests fail.

- [ ] **Step 3: Rewrite `breakdown-widget.tsx` using `defineWidget()`**

Replace `web/components/dashboard/widgets/breakdown-widget.tsx` completely:

```tsx
// web/components/dashboard/widgets/breakdown-widget.tsx
"use client";
import { useBreakdown } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import type { Breakdown } from "@/lib/api/analytics";
import { formatCurrency } from "@/lib/format";
import { defineWidget } from "@/lib/dashboard/define-widget";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";
import type { Block, RowBlock } from "@/lib/dashboard/blocks";
import type { Tier } from "@/lib/dashboard/tier";

const RING = [
  "var(--accent)", "var(--c3)", "var(--c2)",
  "color-mix(in srgb, var(--accent) 48%, var(--c3))",
  "var(--muted)",
  "color-mix(in srgb, var(--c2) 70%, var(--accent))",
  "color-mix(in srgb, var(--c3) 65%, var(--c2))",
  "color-mix(in srgb, var(--accent) 60%, var(--fg))",
];
const OTHER_COLOR = "color-mix(in srgb, var(--muted) 55%, var(--card))";

export type BreakdownVM = {
  top: { label: string; value: number } | undefined;
  topPct: number;
  rows: { label: string; value: number }[];
  total: number;
  dimension: "merchant" | "category";
  showAmounts: boolean;
};

function rowsFromData(data: Breakdown | undefined, dimension: "merchant" | "category") {
  return (data?.rows ?? [])
    .map((r) => ({
      label: String(r.dimensions?.[dimension] ?? (dimension === "merchant" ? "Unknown merchant" : "Uncategorized")),
      value: Math.abs(Number(r.total ?? 0)),
    }))
    .sort((a, b) => b.value - a.value);
}

function toRowBlock(r: { label: string; value: number }, vm: BreakdownVM, i: number): RowBlock {
  return {
    kind: "row",
    label: r.label,
    value: vm.showAmounts ? formatCurrency(r.value) : `${Math.round((r.value / vm.total) * 100)}%`,
    bar: { pct: (r.value / vm.total) * 100, color: RING[i % RING.length] },
  };
}

function toBarRow(r: { label: string; value: number }, vm: BreakdownVM, i: number) {
  return {
    label: r.label,
    value: vm.showAmounts ? formatCurrency(r.value) : `${Math.round((r.value / vm.total) * 100)}%`,
    pct: (r.value / vm.total) * 100,
    color: RING[i % RING.length],
  };
}

function withOtherSlices(rows: { label: string; value: number }[], vm: BreakdownVM) {
  const shown = rows.reduce((sum, r) => sum + r.value, 0);
  const other = vm.total - shown;
  const all = other > 0.005 ? [...rows, { label: "Other", value: other, color: OTHER_COLOR }] : rows;
  return all.map((r, i) => ({
    label: r.label,
    value: vm.showAmounts ? formatCurrency(r.value) : `${Math.round((r.value / vm.total) * 100)}%`,
    pct: (r.value / vm.total) * 100,
    color: (r as { color?: string }).color ?? RING[i % RING.length],
  }));
}

export const breakdownContract = defineWidget<BreakdownVM>({
  data: (config) => {
    const dimension = config.dimension === "category" ? "category" : "merchant";
    const breakdown = useBreakdown(presetRange(config.range ?? "3m"), dimension, config.filter?.category);
    return queryState(breakdown, {
      select: (data): BreakdownVM => {
        const rows = rowsFromData(data, dimension);
        const total = rows.reduce((sum, r) => sum + r.value, 0);
        const top = rows[0];
        const topPct = total > 0 && top ? Math.round((top.value / total) * 100) : 0;
        return { top, topPct, rows, total: total || 1, dimension, showAmounts: config.show?.amounts ?? true };
      },
      isEmpty: (vm) => vm.rows.length === 0,
    });
  },
  insights: (vm) => {
    if (!vm.top) return [];
    return [{ label: `${vm.top.label} ${vm.topPct}%`, tone: vm.topPct >= 40 ? "warning" : "neutral", severity: vm.topPct }];
  },
  supportedForms: ["donut", "bars", "list"],
  emptyHint: "No spending to break down here.",
  view: {
    stat: (vm): Block[] => [
      {
        kind: "stat",
        label: vm.dimension === "merchant" ? "Top merchant" : "Top category",
        value: vm.top?.label ?? "—",
        hint: `${vm.topPct}% of spend`,
      },
    ],
    list: (vm, t: Tier): Block[] => [
      { kind: "list", rows: vm.rows.slice(0, t.rows).map((r, i) => toRowBlock(r, vm, i)) },
    ],
    chart: (vm, t: Tier): Block[] =>
      t.form === "bars"
        ? [{ kind: "bars", rows: vm.rows.slice(0, t.rows).map((r, i) => toBarRow(r, vm, i)) }]
        : [{ kind: "donut", slices: withOtherSlices(vm.rows.slice(0, 8), vm), legend: t.extras }],
  },
  focus: (vm): Block[] => [
    { kind: "donut", slices: withOtherSlices(vm.rows.slice(0, 8), vm), legend: true },
  ],
}) as unknown as WidgetContract<BreakdownVM>;

// Re-export for tests to access view functions directly
(breakdownContract as unknown as { view: ReturnType<typeof defineWidget<BreakdownVM>>["view"] }).view =
  (breakdownContract as unknown as { _opts: { view: ReturnType<typeof defineWidget<BreakdownVM>>["view"] } })._opts?.view;
```

Wait — this last bit is wrong. The `defineWidget` function doesn't expose `_opts` or `view`. The tests need to access `view` directly. 

The cleanest approach: export the `opts` separately and expose the contract + a test-accessible view map:

```tsx
// Export the view map separately for tests, then compose with defineWidget
export const breakdownViews = {
  stat: (vm: BreakdownVM): Block[] => [...],
  list: (vm: BreakdownVM, t: Tier): Block[] => [...],
  chart: (vm: BreakdownVM, t: Tier): Block[] => [...],
};
export const breakdownFocus = (vm: BreakdownVM): Block[] => [...];
export const breakdownContract = defineWidget<BreakdownVM>({
  data: ...,
  insights: ...,
  supportedForms: [...],
  emptyHint: ...,
  view: breakdownViews,
  focus: breakdownFocus,
}) as unknown as WidgetContract<BreakdownVM>;
```

Then in tests: `import { breakdownContract, breakdownViews, breakdownFocus, type BreakdownVM } from "./breakdown-widget"`.

This is the clean approach. Let me rewrite `breakdown-widget.tsx` with this structure:

```tsx
// web/components/dashboard/widgets/breakdown-widget.tsx
"use client";
import { useBreakdown } from "@/lib/api/analytics";
import { presetRange } from "@/lib/dates";
import type { Breakdown } from "@/lib/api/analytics";
import { formatCurrency } from "@/lib/format";
import { defineWidget } from "@/lib/dashboard/define-widget";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";
import type { Block, RowBlock } from "@/lib/dashboard/blocks";
import type { Tier } from "@/lib/dashboard/tier";

const RING = [
  "var(--accent)", "var(--c3)", "var(--c2)",
  "color-mix(in srgb, var(--accent) 48%, var(--c3))",
  "var(--muted)",
  "color-mix(in srgb, var(--c2) 70%, var(--accent))",
  "color-mix(in srgb, var(--c3) 65%, var(--c2))",
  "color-mix(in srgb, var(--accent) 60%, var(--fg))",
];
const OTHER_COLOR = "color-mix(in srgb, var(--muted) 55%, var(--card))";

export type BreakdownVM = {
  top: { label: string; value: number } | undefined;
  topPct: number;
  rows: { label: string; value: number }[];
  total: number;
  dimension: "merchant" | "category";
  showAmounts: boolean;
};

function rowsFromData(data: Breakdown | undefined, dimension: "merchant" | "category") {
  return (data?.rows ?? [])
    .map((r) => ({
      label: String(r.dimensions?.[dimension] ?? (dimension === "merchant" ? "Unknown merchant" : "Uncategorized")),
      value: Math.abs(Number(r.total ?? 0)),
    }))
    .sort((a, b) => b.value - a.value);
}

function toRowBlock(r: { label: string; value: number }, vm: BreakdownVM, i: number): RowBlock {
  return {
    kind: "row",
    label: r.label,
    value: vm.showAmounts ? formatCurrency(r.value) : `${Math.round((r.value / vm.total) * 100)}%`,
    bar: { pct: (r.value / vm.total) * 100, color: RING[i % RING.length] },
  };
}

function toBarRow(r: { label: string; value: number }, vm: BreakdownVM, i: number) {
  return {
    label: r.label,
    value: vm.showAmounts ? formatCurrency(r.value) : `${Math.round((r.value / vm.total) * 100)}%`,
    pct: (r.value / vm.total) * 100,
    color: RING[i % RING.length],
  };
}

function withOtherSlices(rows: { label: string; value: number }[], vm: BreakdownVM) {
  const shown = rows.reduce((sum, r) => sum + r.value, 0);
  const other = vm.total - shown;
  const all = other > 0.005 ? [...rows, { label: "Other", value: other, color: OTHER_COLOR }] : rows;
  return all.map((r, i) => ({
    label: (r as { label: string }).label,
    value: vm.showAmounts
      ? formatCurrency((r as { value: number }).value)
      : `${Math.round(((r as { value: number }).value / vm.total) * 100)}%`,
    pct: ((r as { value: number }).value / vm.total) * 100,
    color: (r as { color?: string }).color ?? RING[i % RING.length],
  }));
}

export const breakdownViews = {
  stat: (vm: BreakdownVM): Block[] => [
    {
      kind: "stat",
      label: vm.dimension === "merchant" ? "Top merchant" : "Top category",
      value: vm.top?.label ?? "—",
      hint: `${vm.topPct}% of spend`,
    },
  ],
  list: (vm: BreakdownVM, t: Tier): Block[] => [
    { kind: "list", rows: vm.rows.slice(0, t.rows).map((r, i) => toRowBlock(r, vm, i)) },
  ],
  chart: (vm: BreakdownVM, t: Tier): Block[] =>
    t.form === "bars"
      ? [{ kind: "bars", rows: vm.rows.slice(0, t.rows).map((r, i) => toBarRow(r, vm, i)) }]
      : [{ kind: "donut", slices: withOtherSlices(vm.rows.slice(0, 8), vm), legend: t.extras }],
};

export const breakdownFocus = (vm: BreakdownVM): Block[] => [
  { kind: "donut", slices: withOtherSlices(vm.rows.slice(0, 8), vm), legend: true },
];

export const breakdownContract = defineWidget<BreakdownVM>({
  data: (config) => {
    const dimension = config.dimension === "category" ? "category" : "merchant";
    const breakdown = useBreakdown(presetRange(config.range ?? "3m"), dimension, config.filter?.category);
    return queryState(breakdown, {
      select: (data): BreakdownVM => {
        const rows = rowsFromData(data, dimension);
        const total = rows.reduce((sum, r) => sum + r.value, 0);
        const top = rows[0];
        const topPct = total > 0 && top ? Math.round((top.value / total) * 100) : 0;
        return { top, topPct, rows, total: total || 1, dimension, showAmounts: config.show?.amounts ?? true };
      },
      isEmpty: (vm) => vm.rows.length === 0,
    });
  },
  insights: (vm) => {
    if (!vm.top) return [];
    return [{ label: `${vm.top.label} ${vm.topPct}%`, tone: vm.topPct >= 40 ? "warning" : "neutral", severity: vm.topPct }];
  },
  supportedForms: ["donut", "bars", "list"],
  emptyHint: "No spending to break down here.",
  view: breakdownViews,
  focus: breakdownFocus,
}) as unknown as WidgetContract<BreakdownVM>;
```

Now update the tests to use the exported view functions directly:

```tsx
// updated test file uses breakdownViews and breakdownFocus directly
import { describe, expect, it } from "vitest";
import { breakdownContract, breakdownViews, breakdownFocus, type BreakdownVM } from "./breakdown-widget";
import type { Tier } from "@/lib/dashboard/tier";
import type { Insight } from "@/lib/dashboard/widget-contract";

// ... (tests call breakdownViews.stat(vm) etc.)
```

Let me rewrite the test to use the exported view map.

- [ ] **Step 3 (revised): Rewrite `breakdown-widget.tsx`**

Replace the entire file with the version above that exports `breakdownViews`, `breakdownFocus`, `BreakdownVM`, and `breakdownContract`.

- [ ] **Step 4: Update the test file**

Replace `web/components/dashboard/widgets/breakdown-widget.test.tsx` completely:

```tsx
// web/components/dashboard/widgets/breakdown-widget.test.tsx
import { describe, expect, it } from "vitest";
import { breakdownContract, breakdownViews, breakdownFocus, type BreakdownVM } from "./breakdown-widget";
import type { Tier } from "@/lib/dashboard/tier";
import type { Insight } from "@/lib/dashboard/widget-contract";

const mockVM: BreakdownVM = {
  top: { label: "Amazon", value: 320 },
  topPct: 78,
  rows: [
    { label: "Amazon", value: 320 },
    { label: "Uber", value: 90 },
    { label: "Starbucks", value: 40 },
  ],
  total: 450,
  dimension: "merchant",
  showAmounts: true,
};

const listTier: Tier = { kind: "list", form: null, rows: 3, extras: false, chartPx: 0 };
const donutTier: Tier = { kind: "chart", form: "donut", rows: 8, extras: true, chartPx: 180 };
const barsTier: Tier = { kind: "chart", form: "bars", rows: 5, extras: false, chartPx: 140 };

describe("breakdownContract.deriveInsights", () => {
  it("names the top entry in a chip", () => {
    const chips = breakdownContract.deriveInsights!(mockVM, {}) as Insight[];
    expect(chips.some((c) => /Amazon/.test(c.label))).toBe(true);
  });
  it("warning tone when top ≥40%", () => {
    const chips = breakdownContract.deriveInsights!(mockVM, {}) as Insight[];
    expect(chips.some((c) => c.tone === "warning")).toBe(true);
  });
  it("neutral tone when top <40%", () => {
    const vm: BreakdownVM = { ...mockVM, topPct: 30, top: { label: "Uber", value: 90 } };
    const chips = breakdownContract.deriveInsights!(vm, {}) as Insight[];
    expect(chips.some((c) => c.tone === "neutral")).toBe(true);
  });
  it("returns [] when no top entry", () => {
    const vm: BreakdownVM = { ...mockVM, top: undefined, rows: [] };
    expect(breakdownContract.deriveInsights!(vm, {})).toHaveLength(0);
  });
});

describe("breakdownViews.stat", () => {
  it("returns a stat block with merchant label", () => {
    const [block] = breakdownViews.stat(mockVM);
    expect(block.kind).toBe("stat");
    if (block.kind === "stat") {
      expect(block.label).toMatch(/merchant/i);
      expect(block.value).toBe("Amazon");
      expect(block.hint).toContain("78%");
    }
  });
  it("uses category label when dimension=category", () => {
    const [block] = breakdownViews.stat({ ...mockVM, dimension: "category" });
    if (block.kind === "stat") expect(block.label).toMatch(/category/i);
  });
  it("falls back to em-dash when no top", () => {
    const [block] = breakdownViews.stat({ ...mockVM, top: undefined });
    if (block.kind === "stat") expect(block.value).toBe("—");
  });
});

describe("breakdownViews.list", () => {
  it("returns a list block sliced to tier.rows", () => {
    const [block] = breakdownViews.list(mockVM, listTier);
    expect(block.kind).toBe("list");
    if (block.kind === "list") {
      expect(block.rows).toHaveLength(3);
      expect(block.rows[0].label).toBe("Amazon");
    }
  });
  it("row blocks carry a bar sub-key with pct > 0", () => {
    const [block] = breakdownViews.list(mockVM, { ...listTier, rows: 1 });
    if (block.kind === "list") {
      expect(block.rows[0].bar).toBeDefined();
      expect(block.rows[0].bar!.pct).toBeGreaterThan(0);
    }
  });
  it("formats value as percentage when showAmounts=false", () => {
    const vm: BreakdownVM = { ...mockVM, showAmounts: false };
    const [block] = breakdownViews.list(vm, { ...listTier, rows: 1 });
    if (block.kind === "list") expect(block.rows[0].value).toMatch(/%/);
  });
});

describe("breakdownViews.chart", () => {
  it("returns bars block when tier.form=bars", () => {
    const [block] = breakdownViews.chart(mockVM, barsTier);
    expect(block.kind).toBe("bars");
    if (block.kind === "bars") expect(block.rows[0].label).toBe("Amazon");
  });
  it("returns donut block when tier.form=donut", () => {
    const [block] = breakdownViews.chart(mockVM, donutTier);
    expect(block.kind).toBe("donut");
    if (block.kind === "donut") {
      expect(block.slices.some((s) => s.label === "Amazon")).toBe(true);
      expect(block.legend).toBe(true);
    }
  });
  it("donut legend=false when extras=false", () => {
    const [block] = breakdownViews.chart(mockVM, { ...donutTier, extras: false });
    if (block.kind === "donut") expect(block.legend).toBe(false);
  });
  it("adds Other slice when rows do not sum to total", () => {
    const [block] = breakdownViews.chart({ ...mockVM, rows: [mockVM.rows[0]], total: 500 }, donutTier);
    if (block.kind === "donut") expect(block.slices.some((s) => s.label === "Other")).toBe(true);
  });
});

describe("breakdownFocus", () => {
  it("returns donut block with legend=true", () => {
    const [block] = breakdownFocus(mockVM);
    expect(block.kind).toBe("donut");
    if (block.kind === "donut") expect(block.legend).toBe(true);
  });
  it("limits to 8 slices max (plus possible Other)", () => {
    const manyRows = Array.from({ length: 12 }, (_, i) => ({ label: `Row ${i}`, value: 10 }));
    const vm: BreakdownVM = { ...mockVM, rows: manyRows, total: 120 };
    const [block] = breakdownFocus(vm);
    if (block.kind === "donut") expect(block.slices.length).toBeLessThanOrEqual(9);
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run components/dashboard/widgets/breakdown-widget.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run all unit tests to check for regressions**

Run: `cd web && npx vitest run lib/dashboard components/dashboard/widgets`
Expected: PASS (all pre-existing tests still green).

- [ ] **Step 7: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/components/dashboard/widgets/breakdown-widget.tsx web/components/dashboard/widgets/breakdown-widget.test.tsx
git commit -m "feat(dashboard): migrate breakdown widget to defineWidget() — fixes donut-at-standard-preset bug"
```

---

### Task 5: E2e test — donut renders at default preset

**Files:**
- Create: `web/e2e/widget-rendering.spec.ts`

**Interfaces:**
- Consumes: same auth pattern as `dashboard-grid.spec.ts` (`signup`, `authenticate` helpers).
- Verifies: the `[data-block-kind="donut"]` element inside the breakdown widget is visible on the default board with default config (chart=donut, preset=standard, size 5×2).

- [ ] **Step 1: Write the test**

```ts
// web/e2e/widget-rendering.spec.ts
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function signup(request: APIRequestContext) {
  const res = await request.post(`${API}/auth/signup`, {
    data: { email: EMAIL, password: PASSWORD, display_name: "E2E", household_name: "E2E House" },
  });
  if (res.ok()) return (await res.json()) as { access_token: string; refresh_token: string };
  const login = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD, totp_code: null },
  });
  expect(login.ok(), `login failed: ${login.status()}`).toBeTruthy();
  return (await login.json()) as { access_token: string; refresh_token: string };
}

async function authenticate(page: Page, tokens: { access_token: string; refresh_token: string }) {
  await page.addInitScript(
    (t) => {
      window.localStorage.setItem("cbf.accessToken", t.access);
      window.localStorage.setItem("cbf.refreshToken", t.refresh);
      if (!window.sessionStorage.getItem("cf.e2eDashboardSeeded")) {
        window.localStorage.removeItem("cf-board:dashboard");
        window.sessionStorage.setItem("cf.e2eDashboardSeeded", "1");
      }
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

test.describe("widget rendering standard", () => {
  test("breakdown donut renders at standard preset on default board (§1 bug fix)", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");

    const breakdown = page.locator('[data-widget="breakdown"]');
    await expect(breakdown).toBeVisible();

    // At default preset=standard, chart=donut, 5×2: resolveTier → chart/donut.
    // Before the fix this rendered a list. Now it must render the donut.
    const donut = breakdown.locator('[data-block-kind="donut"]');
    await expect(donut).toBeVisible({ timeout: 10_000 });
  });

  test("breakdown falls back to list when preset=compact", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    // Seed a compact-preset breakdown widget
    await page.addInitScript(() => {
      const board = JSON.parse(window.localStorage.getItem("cf-board:dashboard") ?? "{}");
      const breakdown = (board.items ?? []).find((i: { type: string }) => i.type === "breakdown");
      if (breakdown) breakdown.config = { ...breakdown.config, preset: "compact" };
      window.localStorage.setItem("cf-board:dashboard", JSON.stringify(board));
    });
    await page.goto("/dashboard");
    const breakdown = page.locator('[data-widget="breakdown"]');
    await expect(breakdown).toBeVisible();
    await expect(breakdown.locator('[data-block-kind="donut"]')).toHaveCount(0);
    await expect(breakdown.locator('[data-block-kind="stat"]')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `cd web && npx playwright test e2e/widget-rendering.spec.ts`
Expected: PASS (requires API on `localhost:8000` and `next dev` on `localhost:3000` per `playwright.config.ts`).

> If the test fails with "donut not visible" after the migration, check: (1) the breakdown widget in the default board has `chart: "donut"` and `preset: "standard"` in its config, (2) `resolveTier` at (5×2, standard, donut, [donut,bars,list]) returns `{ kind: "chart", form: "donut" }`, (3) `BlockRenderer` receives a donut block and applies `data-block-kind="donut"`.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/widget-rendering.spec.ts
git commit -m "test(dashboard): e2e — verify breakdown donut renders at standard preset"
```
