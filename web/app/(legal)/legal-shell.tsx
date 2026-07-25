import Link from "next/link";

/**
 * Wrapper for the legal pages.
 *
 * The draft banner is deliberately loud and is NOT decorative: these documents
 * describe this codebase's actual data handling accurately, but they have not been
 * reviewed by a lawyer and contain unfilled placeholders. Publishing them as-is
 * would be a compliance problem, not a solved one.
 */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-6 py-12">
      <div className="mb-8 rounded-lg border-2 border-amber-500 bg-amber-500/10 p-4">
        <p className="text-sm font-bold">⚠ UNREVIEWED DRAFT — do not publish as-is</p>
        <p className="mt-1.5 text-sm">
          Written from what the code actually does, but not reviewed by a qualified
          lawyer, and every <code>[BRACKETED]</code> value below still needs filling
          in. Have it reviewed for your jurisdiction before launch. Plaid production
          access and Google OAuth verification both require a published, accurate
          policy.
        </p>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Last updated: {updated}</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>

      <p className="mt-12 border-t border-border pt-6 text-sm">
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy Policy
        </Link>
        {" · "}
        <Link href="/terms" className="underline underline-offset-4">
          Terms of Service
        </Link>
      </p>
    </main>
  );
}
