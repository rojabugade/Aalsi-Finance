"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api/client";
import { enqueueCapture, flushQueue } from "@/lib/offline/sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CANONICAL = ["date", "description", "amount", "currency"] as const;
type Canonical = (typeof CANONICAL)[number];

function parseHeaders(text: string): string[] {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  return firstLine
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/** Both CSV and XLSX statements are handled here; XLSX is mapped server-side. */
export function isSpreadsheetFile(file: File): boolean {
  return /\.(csv|xlsx)$/i.test(file.name);
}

export function CsvWizard({ initialFile, onDone }: { initialFile?: File; onDone?: () => void } = {}) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [map, setMap] = useState<Record<Canonical, string>>({
    date: "",
    description: "",
    amount: "",
    currency: "",
  });
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | null) {
    setFile(f);
    setHeaders([]);
    if (!f) return;
    // XLSX can't be parsed in the browser — hand it to the server pipeline,
    // which now reads its rows (backend xlsx_to_rows) for the mapping flow.
    if (/\.xlsx$/i.test(f.name)) {
      setBusy(true);
      try {
        await enqueueCapture(f, { filename: f.name });
        const { synced } = await flushQueue();
        toast.success(
          synced > 0
            ? "Spreadsheet uploaded — map columns once it's processed"
            : "Spreadsheet queued — will upload when online",
        );
        setFile(null);
        onDone?.();
      } catch {
        toast.error("Couldn't upload that spreadsheet");
      } finally {
        setBusy(false);
      }
      return;
    }
    const text = await f.text();
    const cols = parseHeaders(text);
    setHeaders(cols);
    // Best-effort auto-match by name.
    setMap({
      date: cols.find((c) => /date/i.test(c)) ?? "",
      description: cols.find((c) => /desc|memo|name|payee/i.test(c)) ?? "",
      amount: cols.find((c) => /amount|amt|value/i.test(c)) ?? "",
      currency: cols.find((c) => /currency|ccy/i.test(c)) ?? "",
    });
    if (!label) setLabel(f.name.replace(/\.csv$/i, ""));
  }

  // Preload a file handed in from the capture page (drag/drop or picker).
  useEffect(() => {
    if (initialFile) void onFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const ready =
    file && label.trim() && map.date && map.description && map.amount && !busy;

  async function onSubmit() {
    if (!file || !ready) return;
    setBusy(true);
    try {
      const { error } = await api.PUT("/documents/csv-mappings", {
        body: {
          source_label: label.trim(),
          date: map.date,
          description: map.description,
          amount: map.amount,
          currency: map.currency || null,
          default_currency: defaultCurrency || null,
        },
      });
      if (error) throw error;
      await enqueueCapture(file, {
        filename: file.name,
        docType: "csv",
        sourceLabel: label.trim(),
      });
      const { synced } = await flushQueue();
      toast.success(
        synced > 0 ? "CSV uploaded and processing" : "CSV queued — will upload when online",
      );
      setFile(null);
      setHeaders([]);
      setLabel("");
      setMap({ date: "", description: "", amount: "", currency: "" });
      onDone?.();
    } catch {
      toast.error("Couldn't save the mapping. Check the fields and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-border border-dashed bg-chip px-6 py-8 text-center transition-colors hover:bg-chip">
        <FileSpreadsheet className="size-7 text-muted" />
        <span className="text-sm font-medium">
          {file ? file.name : "Choose a CSV or XLSX statement"}
        </span>
        <span className="text-xs text-muted">
          We&apos;ll read the column headers so you can map them.
        </span>
        <input
          type="file"
          accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </label>

      {headers.length > 0 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-xs text-muted">
                Source label
              </Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Chase Checking"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted">
                Default currency
              </Label>
              <Input
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                placeholder="USD"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">
              Map your columns
            </p>
            {CANONICAL.map((field) => (
              <div key={field} className="flex items-center gap-3">
                <span className="w-24 text-sm capitalize">
                  {field}
                  {field !== "currency" && <span className="text-destructive"> *</span>}
                </span>
                <select
                  value={map[field]}
                  onChange={(e) =>
                    setMap((m) => ({ ...m, [field]: e.target.value }))
                  }
                  className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">
                    {field === "currency" ? "— none —" : "Select column"}
                  </option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <Button onClick={onSubmit} disabled={!ready} className="w-full">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Save mapping & import
          </Button>
        </div>
      )}
    </div>
  );
}
