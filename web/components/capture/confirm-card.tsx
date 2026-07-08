"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Pencil, XCircle } from "lucide-react";
import type { ReviewItem, ResolveAction } from "@/lib/api/review";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Data = Record<string, unknown>;

/** snake_case / camelCase → "Title Case" for field labels. */
function humanize(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isScalar(v: unknown): v is string | number | boolean | null {
  return v == null || ["string", "number", "boolean"].includes(typeof v);
}

/** Best human title for the card, per doc type. */
function titleFor(data: Data, type: string): string {
  for (const k of ["merchant", "name", "employer", "account_hint"]) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return humanize(type);
}

export function ConfirmCard({
  item,
  onResolve,
  pending,
}: {
  item: ReviewItem;
  onResolve: (action: ResolveAction, data?: Data) => Promise<void>;
  pending: boolean;
}) {
  const initial = (item.data ?? {}) as Data;

  // Split extraction into editable scalar fields and non-editable nested parts
  // (line items, transactions, deductions) which we summarise rather than edit.
  const { scalarKeys, nested } = useMemo(() => {
    const scalars: string[] = [];
    const nestedParts: Array<{ key: string; count: number }> = [];
    for (const [k, v] of Object.entries(initial)) {
      if (k === "confidence") continue;
      if (Array.isArray(v)) nestedParts.push({ key: k, count: v.length });
      else if (isScalar(v)) scalars.push(k);
    }
    return { scalarKeys: scalars, nested: nestedParts };
  }, [initial]);

  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(scalarKeys.map((k) => [k, initial[k] == null ? "" : String(initial[k])])),
  );

  const high = (item.confidence ?? 0) >= 0.8;
  const title = titleFor(editing ? { ...initial, ...fields } : initial, item.type);

  async function confirm() {
    if (!editing) {
      await onResolve("confirm");
      return;
    }
    // Merge edits back over the original; empty strings become null so we don't
    // persist blank values as "".
    const merged: Data = { ...initial };
    for (const k of scalarKeys) merged[k] = fields[k].trim() === "" ? null : fields[k];
    await onResolve("confirm", merged);
  }

  return (
    <li className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="text-xs capitalize text-muted">{humanize(item.type)}</p>
        </div>
        <Badge variant={high ? "success" : "warning"}>
          {item.confidence != null ? `${Math.round(item.confidence * 100)}%` : "check"}
        </Badge>
      </div>

      {/* Details — read-only field list, or inline editors when fixing. */}
      {scalarKeys.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {scalarKeys.map((k) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-muted">{humanize(k)}</dt>
              {editing ? (
                <input
                  className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-sm"
                  value={fields[k]}
                  onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                />
              ) : (
                <dd className="truncate text-sm">
                  {initial[k] == null || String(initial[k]) === "" ? (
                    <span className="text-muted">—</span>
                  ) : (
                    String(initial[k])
                  )}
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}

      {nested.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {nested.map((n) => `${n.count} ${humanize(n.key).toLowerCase()}`).join(" · ")}
        </p>
      )}

      {item.reasons && item.reasons.length > 0 && !editing && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{item.reasons[0]}</p>
      )}

      <div className="mt-2.5 flex items-center gap-1.5">
        <Button size="sm" disabled={pending} onClick={confirm}>
          <CheckCircle2 className="size-4" /> {editing ? "Save & confirm" : "Confirm"}
        </Button>
        {scalarKeys.length > 0 && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => setEditing((v) => !v)}>
            <Pencil className="size-4" /> {editing ? "Cancel" : "Edit"}
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onResolve("reject")}>
          <XCircle className="size-4" /> Reject
        </Button>
      </div>
    </li>
  );
}
