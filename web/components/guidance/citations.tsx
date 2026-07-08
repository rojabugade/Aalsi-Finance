import type { Citation } from "@/lib/api/guidance";

/** Renders any opaque backend dict as key/value rows. Never assumes inner keys. */
export function KeyValues({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== "");
  if (entries.length === 0) return null;
  return (
    <dl className="grid gap-1 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="capitalize text-muted">{k.replace(/_/g, " ")}</dt>
          <dd data-numeric className="text-right font-medium">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Renders a list of opaque dicts (e.g. wizard checklist items) as small bordered blocks. */
export function DictList({ items }: { items: Record<string, unknown>[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted">Nothing here.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="rounded-lg border border-border p-3">
          <KeyValues data={item} />
        </li>
      ))}
    </ul>
  );
}

export function Citations({ citations }: { citations: Citation[] }) {
  if (!citations || citations.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted">Sources</p>
      <ul className="space-y-1 text-sm">
        {citations.map((c, i) => (
          <li key={i}>
            {c.source_url ? (
              <a
                href={c.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {c.title ?? c.source_url}
              </a>
            ) : (
              <span>{c.title ?? "Untitled source"}</span>
            )}
            {c.effective_date && (
              <span className="text-muted"> · {c.effective_date}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
