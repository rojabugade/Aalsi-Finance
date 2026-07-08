"use client";

export type CaptureType =
  | "auto" | "receipt" | "invoice" | "statement" | "paystub" | "spreadsheet" | "loan" | "other";

export const CAPTURE_TYPES: { value: CaptureType; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "receipt", label: "Receipt" },
  { value: "invoice", label: "Invoice" },
  { value: "statement", label: "Statement" },
  { value: "paystub", label: "Paystub" },
  { value: "loan", label: "Loan / Debt" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "other", label: "Other" },
];

/** Backend `type` to send for the document pipeline. auto = let server infer;
 * spreadsheet = handled by the CSV wizard client-side, so no doc type. */
export function captureTypeToDocType(t: CaptureType): string | undefined {
  if (t === "auto" || t === "spreadsheet") return undefined;
  return t;
}

export function TypeSelector({
  value,
  onChange,
}: {
  value: CaptureType;
  onChange: (t: CaptureType) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Document type">
      {CAPTURE_TYPES.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(t.value)}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
              (active
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:bg-card")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
