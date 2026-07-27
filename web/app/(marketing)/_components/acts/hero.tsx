import { useLocale, useTranslations } from "next-intl";

import { CountUp } from "../count-up";

/**
 * Act 0 — the pile, and the one number it resolves to.
 *
 * The headline breaks across three clipped lines that lift in sequence, the
 * third resolving into the serif. The figure beside it is the product's whole
 * claim in one line: everything you fed it, minus everything already spoken
 * for, is this. The formula under the rule is printed because a number this
 * confident has to show its working.
 */
export function Hero() {
  const t = useTranslations("marketing.hero");
  const locale = useLocale();

  return (
    <section className="m-act m-hero" data-act="0" aria-labelledby="hero-title">
      <div className="m-veil" aria-hidden />

      <div className="m-act-body">
        <p className="m-eyebrow m-hero-eyebrow">
          <span className="m-eyebrow-dot" aria-hidden />
          {t("badge")}
        </p>

        <h1 className="m-h1" id="hero-title">
          <span className="m-line">
            <span style={{ animationDelay: "240ms" }}>{t("line1")}</span>
          </span>
          <span className="m-line">
            <span style={{ animationDelay: "360ms" }}>{t("line2")}</span>
          </span>
          <span className="m-line">
            <span className="m-serif" style={{ animationDelay: "480ms" }}>
              {t("line3")}
            </span>
          </span>
        </h1>

        <div className="m-hero-meta">
          {/* A figure with a caption, because it is invented. Everything on this
              page that looks like someone's money is sample data and says so —
              the product is a record keeper, and a record keeper that fakes a
              balance without saying so has already lost the argument. */}
          <figure className="m-figure-block" style={{ margin: 0 }}>
            <p className="m-figure-label">{t("leftoverLabel")}</p>
            <p className="m-figure">
              <CountUp value={1284.6} locale={locale} />
              <span className="m-caret" aria-hidden>
                _
              </span>
            </p>
            <div className="m-rule" aria-hidden />
            <p className="m-formula">{t("formula")}</p>
            <figcaption className="m-note">{t("sample")}</figcaption>
          </figure>

          <p className="m-hero-lede">{t("lede")}</p>
        </div>

        <p className="m-scroll-hint">{t("scrollHint")}</p>
      </div>
    </section>
  );
}
