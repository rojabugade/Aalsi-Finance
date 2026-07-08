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
  // Secondary detail (legend / labels) shows when the user dials up detail OR
  // the cell is large enough to host it (wide AND tall, i.e. capacity 3) — so a
  // donut at the default `standard` preset still shows its legend at 4×2+.
  const extras = presetLevel >= 2 || cap >= 3;
  const chartPx = presetLevel >= 2 ? 180 : 140;

  return { kind, form: chartForm, rows, extras, chartPx };
}
