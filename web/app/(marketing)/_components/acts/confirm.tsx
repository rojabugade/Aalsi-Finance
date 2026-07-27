import { useTranslations } from "next-intl";

/**
 * Act 2 — the review gate. Set right, against the mirrored veil, because this
 * is the half of the loop the person does rather than the half the product
 * does, and the page should not read as one voice all the way down.
 */
export function Confirm() {
  const t = useTranslations("marketing.confirm");

  return (
    <section className="m-act" data-act="2" data-align="right" aria-labelledby="confirm-title">
      <div className="m-veil" data-side="right" aria-hidden />

      <div className="m-act-body">
        <div className="m-act-col m-rv" data-rv>
          <p className="m-act-label" style={{ color: "var(--m-mint)" }}>
            {t("label")}
          </p>
          <h2 className="m-h2" id="confirm-title">
            {t("heading")}
          </h2>
          <p className="m-lede" style={{ marginTop: "22px" }}>
            {t("body")}
          </p>

          <p className="m-legend">
            <span className="m-confirmed">
              <span className="m-legend-dot" aria-hidden />
              {t("confirmed")}
            </span>
            <span className="m-flagged">
              <span className="m-legend-dot" aria-hidden />
              {t("needsYou")}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
