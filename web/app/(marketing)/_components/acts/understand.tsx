import { useTranslations } from "next-intl";

/**
 * Act 3 — the analyst. The quote is the point: an answer that names the two
 * rows it came from, because an assistant that will not show its sources is
 * not something anyone should let near their money.
 */
export function Understand() {
  const t = useTranslations("marketing.understand");

  return (
    <section className="m-act" data-act="3" aria-labelledby="understand-title">
      <div className="m-veil" aria-hidden />

      <div className="m-act-body">
        <div className="m-act-col m-rv" style={{ maxWidth: "34ch" }} data-rv>
          <p className="m-act-label" style={{ color: "var(--m-ember-soft)" }}>
            {t("label")}
          </p>
          <h2 className="m-h2" id="understand-title">
            {t("heading")}
          </h2>
          <p className="m-lede" style={{ marginTop: "22px" }}>
            {t("body")}
          </p>

          <blockquote className="m-quote">
            {t("question")}
            <br />
            <span className="m-quote-answer">{t("answer")}</span>
          </blockquote>
        </div>
      </div>
    </section>
  );
}
