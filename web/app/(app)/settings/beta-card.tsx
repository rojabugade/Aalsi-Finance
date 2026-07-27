"use client";

import { useBetaUsage } from "@/lib/api/beta";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * What this account has left today.
 *
 * Renders nothing at all when the server reports `active: false`, which is what
 * every limit set to 0 means — so lifting the beta removes this card without a
 * deploy, and a paying customer never sees a panel about allowances that no
 * longer apply to them.
 *
 * The point is that the first sign of a ceiling shouldn't be a 429 in the
 * middle of a question. The numbers come from `/beta/usage`, which reads the
 * same functions that do the refusing.
 */
export function BetaCard() {
  const usage = useBetaUsage();

  if (usage.isLoading) {
    return (
      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-16 w-full" />
      </div>
    );
  }

  // A failed request is not worth an error state here: the allowance is
  // informational, and the enforcement happens server-side regardless.
  if (usage.isError || !usage.data?.active) return null;

  const { ai_requests, documents, ai_requests_per_minute } = usage.data;

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold tracking-tight">Beta allowance</h2>
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent)",
            border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
          }}
        >
          Closed beta
        </span>
      </div>
      <p className="text-sm text-muted">
        You have every feature. What&apos;s capped is the volume of the things
        that cost us money to run — the AI and document processing.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Meter
          label="AI requests"
          used={ai_requests.used}
          limit={ai_requests.limit}
          nextCreditAt={ai_requests.next_credit_at}
        />
        <Meter
          label="Documents"
          used={documents.used}
          limit={documents.limit}
          nextCreditAt={documents.next_credit_at}
        />
      </div>

      {ai_requests_per_minute > 0 && (
        <p className="mt-4 text-xs text-muted">
          Also capped at {ai_requests_per_minute} AI requests a minute, to keep
          one busy moment from spending the whole day&apos;s allowance.
        </p>
      )}
    </div>
  );
}

function Meter({
  label,
  used,
  limit,
  nextCreditAt,
}: {
  label: string;
  used: number;
  limit: number;
  nextCreditAt: string | null;
}) {
  if (limit <= 0) return null;

  const remaining = Math.max(0, limit - used);
  const pct = Math.min(100, Math.round((used / limit) * 100));
  // Colour only at the point it changes what someone would do. Written against
  // the raw palette variables because the app has no `warning` token — the
  // near-empty state is a mix toward destructive rather than a new colour.
  const fill =
    remaining === 0
      ? "var(--destructive)"
      : pct >= 80
        ? "color-mix(in srgb, var(--destructive) 55%, var(--accent))"
        : "var(--accent)";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-sm tabular-nums">
          {remaining} <span className="text-muted">of {limit} left</span>
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full"
        style={{ background: "color-mix(in srgb, var(--muted) 25%, transparent)" }}
        role="meter"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${label} used`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: fill }}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {/* A rolling 24-hour window has no midnight reset, so the only honest
            thing to show is when the oldest use falls out of it. */}
        {remaining > 0
          ? "Rolls forward over 24 hours."
          : nextCreditAt
            ? `Next one free ${relative(nextCreditAt)}.`
            : "Rolls forward over 24 hours."}
      </p>
    </div>
  );
}

function relative(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (minutes <= 1) return "in a moment";
  if (minutes < 60) return `in ${minutes} min`;
  return `in ${Math.round(minutes / 60)} h`;
}
