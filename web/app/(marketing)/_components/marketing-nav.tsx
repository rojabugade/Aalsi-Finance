"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Wordmark } from "./wordmark";

/**
 * The one bar across the whole public surface — landing page, auth screens and
 * the document pages alike.
 *
 * It is mounted by the layout, not by any page, so moving between those routes
 * never rebuilds it: the bar and the scene behind it are the two things that hold
 * still while everything between them changes. Every destination is a `Link` for
 * the same reason — one bare `href` here would reload the document and take the
 * canvas down with it.
 *
 * A client component, but only to read the pathname: `Sign in` is dropped on the
 * screens that *are* signing in, and `Request access` has to know whether the
 * invite form is on this page or back on the landing page.
 */
export function MarketingNav() {
  const t = useTranslations("marketing.nav");
  const pathname = usePathname();
  const onAuth = pathname !== "/" && pathname !== "/roadmap";

  return (
    <header className="m-nav">
      <nav className="m-shell m-nav-inner" aria-label={t("label")}>
        <Wordmark href="/" />

        <div className="m-nav-actions">
          {!onAuth && (
            <Link className="m-link" href="/login">
              {t("signIn")}
            </Link>
          )}
          <Link className="m-cta" href={pathname === "/" ? "#apply" : "/#apply"}>
            {t("apply")}
          </Link>
        </div>
      </nav>
    </header>
  );
}
