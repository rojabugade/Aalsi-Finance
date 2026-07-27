/**
 * The standing "this is information, not advice" notice.
 *
 * It renders above the content it qualifies, not below it. A disclaimer set in
 * muted 12px under a confident-sounding answer is read after the reader has
 * already decided what to do, which is too late to be the thing it claims to
 * be. Same text the API returns — this only fixes where and how loudly it lands.
 */
export function GuidanceDisclaimer({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p
      role="note"
      className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-foreground/80"
    >
      {text}
    </p>
  );
}
