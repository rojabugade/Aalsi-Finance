import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * A rule, four links and one line of small print, set in the same mono as every
 * other label on the page.
 *
 * Slimmer than it used to be because the invite act above it already closes the
 * page — this is the legal and navigational floor under it, not a second
 * ending. The unbuilt-features accounting lives at /roadmap; the last thing
 * someone reads before deciding shouldn't be a list of what's missing.
 */
export function MarketingFooter() {
  const t = useTranslations("marketing.footer");

  return (
    <footer className="m-footer">
      <div className="m-shell m-footer-inner">
        <p className="m-footer-legal">
          {t("copyright", { year: new Date().getFullYear() })} — {t("legal")}
        </p>

        <div className="m-footer-links">
          <Link className="m-link" href="/roadmap">
            {t("roadmap")}
          </Link>
          <Link className="m-link" href="/privacy">
            {t("privacy")}
          </Link>
          <Link className="m-link" href="/terms">
            {t("terms")}
          </Link>
          <a className="m-link" href={`mailto:${t("contactAddress")}`}>
            {t("contact")}
          </a>
        </div>
      </div>
    </footer>
  );
}
