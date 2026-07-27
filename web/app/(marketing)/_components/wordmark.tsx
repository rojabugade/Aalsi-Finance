import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * The app's mark, drawn against marketing tokens.
 *
 * `components/brand.tsx` styles itself from the app's `data-theme` palette,
 * which this surface deliberately doesn't participate in. Same glyph, same
 * wordmark, scoped colours.
 *
 * A `Link`, never a bare anchor: this is the mark on the auth screens as well as
 * the landing page, and a plain `href` there would reload the document and take
 * the scene down with it. Routed, the canvas survives and the camera walks back
 * to the act the visitor came from.
 */
export function Wordmark({ href = "/" }: { href?: string | null }) {
  const t = useTranslations("app");
  const inner = (
    <>
      <span className="m-wordmark-glyph" aria-hidden>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
          <path
            d="M5 16.5 10 7l4 6.5L17 9l2 7.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="m-wordmark-text">{t("name")}</span>
    </>
  );

  if (!href) return <span className="m-wordmark">{inner}</span>;
  return (
    <Link className="m-wordmark" href={href}>
      {inner}
    </Link>
  );
}
