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
