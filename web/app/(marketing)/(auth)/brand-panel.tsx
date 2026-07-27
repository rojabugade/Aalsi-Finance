import { useTranslations } from "next-intl";

/**
 * Left half of the auth screens: one line of argument, and the smallest possible
 * demonstration of the product.
 *
 * It sits directly on the scene — no panel, no background of its own — which is
 * what makes the auth screens read as a corner of the landing page rather than a
 * separate site. The layout supplies the palette, the fonts, the scene and the
 * wordmark; the mark used to be repeated here, which put two of them on the
 * screen once the nav became persistent.
 */
export function BrandPanel() {
  const t = useTranslations("marketing.auth");

  return (
    <aside className="m-auth-brand">
      <div>
        <p className="m-auth-line">
          <span className="m-line">
            <span style={{ animationDelay: "200ms" }}>{t("lineLead")}</span>
          </span>
          <span className="m-line">
            <span className="m-serif" style={{ animationDelay: "340ms" }}>
              {t("lineResolve")}
            </span>
          </span>
        </p>

        <div className="m-auth-rule" aria-hidden />

        {/* The smallest possible demonstration of the product: a merchant, a
            date, a number. Sample data, and captioned as such — same rule as
            the landing page. */}
        <figure style={{ margin: 0 }}>
          <p className="m-auth-receipt">
            {t("receiptMerchant")}
            <br />
            {t("receiptDate")}
            <br />
            <b>{t("receiptAmount")}</b>
          </p>
          <figcaption className="m-auth-assurance" style={{ marginTop: "12px" }}>
            {t("sample")}
          </figcaption>
        </figure>
      </div>

      <p className="m-auth-assurance">{t("assurance")}</p>
    </aside>
  );
}
