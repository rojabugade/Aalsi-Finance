import { useTranslations } from "next-intl";

/** Act 1 — everything goes under the same lamp, whatever shape it arrived in. */
export function Capture() {
  const t = useTranslations("marketing.capture");

  return (
    <section className="m-act" data-act="1" aria-labelledby="capture-title">
      <div className="m-veil" aria-hidden />

      <div className="m-act-body">
        <div className="m-act-col m-rv" data-rv>
          <p className="m-act-label" style={{ color: "var(--m-iris)" }}>
            {t("label")}
          </p>
          <h2 className="m-h2" id="capture-title">
            {t("heading")}
          </h2>
          <p className="m-lede" style={{ marginTop: "22px" }}>
            {t("body")}
          </p>
          <p
            className="m-small"
            style={{ marginTop: "26px", color: "var(--m-mint)", letterSpacing: "0.06em" }}
          >
            {t("foot")}
          </p>
        </div>
      </div>
    </section>
  );
}
