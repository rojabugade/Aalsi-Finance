import { useTranslations } from "next-intl";

/**
 * Act 4 — what you are left holding. Three lines, each a domain of the product,
 * each keeping the accent the app assigns that domain.
 *
 * Deliberately not a feature grid: a grid invites scanning and comparison
 * between cells, and there is nothing to compare here — these are three parts
 * of one thing, which is what a stack of full-width rules says and a set of
 * boxes does not.
 */
export function Archive() {
  const t = useTranslations("marketing.archive");

  const rows = [
    { key: "ledger", swatch: "var(--m-iris)" },
    { key: "analyst", swatch: "var(--m-mint)" },
    { key: "debt", swatch: "var(--m-ember)" },
  ];

  return (
    <section className="m-act" data-act="4" aria-labelledby="archive-title">
      <div className="m-veil" data-side="wide" aria-hidden />

      <div className="m-act-body">
        <h2
          className="m-act-label m-rv"
          id="archive-title"
          style={{ color: "var(--m-iris)", marginBottom: "34px" }}
          data-rv
        >
          {t("label")}
        </h2>

        <div className="m-archive">
          {rows.map(({ key, swatch }) => (
            <div
              key={key}
              className="m-archive-row m-rv"
              style={{ ["--m-swatch" as string]: swatch }}
              data-rv
            >
              <span className="m-archive-key">{t(`${key}.key`)}</span>
              <p>{t(`${key}.body`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
