import { useTranslations } from "next-intl";

/**
 * The eight ways in, as a rail that travels sideways while the page scrolls
 * down. The section is 280vh tall and its stage is sticky; the scene engine
 * translates `[data-rail]` by the section's progress.
 *
 * Each card carries a small abstract drawing of its source type, built from
 * divs rather than icons so they inherit the palette and cost nothing to ship.
 * They are not meant to be recognised in isolation — they are meant to make
 * eight cards scan as eight different kinds of thing.
 */
export function Sources() {
  const t = useTranslations("marketing.sources");

  const cards = [
    { key: "receipt", glyph: <ReceiptGlyph /> },
    { key: "statement", glyph: <StatementGlyph /> },
    { key: "csv", glyph: <TableGlyph /> },
    { key: "sms", glyph: <SmsGlyph /> },
    { key: "bank", glyph: <LinkGlyph /> },
    { key: "paystub", glyph: <PaystubGlyph /> },
    { key: "loan", glyph: <BarsGlyph /> },
    { key: "fx", glyph: <FxGlyph /> },
  ];

  return (
    <section className="m-band" data-band="sources" aria-labelledby="sources-title">
      <div className="m-band-stage">
        <div className="m-band-veil" aria-hidden />

        <div className="m-band-head">
          <div>
            <p className="m-act-label" style={{ color: "var(--m-ember)", marginBottom: "14px" }}>
              {t("label")}
            </p>
            <h2 className="m-h2 m-h2-sm" id="sources-title">
              {t("heading")}
            </h2>
          </div>
          <p className="m-band-hint">{t("hint")}</p>
        </div>

        <ul className="m-rail-sources" data-rail="sources">
          {cards.map(({ key, glyph }, i) => (
            <li className="m-source" key={key}>
              <div className="m-source-head">
                <span className="m-source-n">{String(i + 1).padStart(2, "0")}</span>
                {glyph}
              </div>
              <div>
                <p className="m-h3">{t(`${key}.title`)}</p>
                <p className="m-body">{t(`${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReceiptGlyph() {
  return (
    <div
      className="m-glyph m-glyph-lines"
      style={{ width: 44, height: 58 }}
      aria-hidden
    >
      <i style={{ width: "60%", background: "var(--m-ember)" }} />
      <i style={{ width: "100%" }} />
      <i style={{ width: "85%" }} />
      <i style={{ width: "100%" }} />
      <i style={{ width: "45%", background: "rgba(255,255,255,.36)", marginTop: "auto" }} />
    </div>
  );
}

function StatementGlyph() {
  return (
    <div className="m-glyph m-glyph-cells" style={{ width: 60, height: 46 }} aria-hidden>
      <i style={{ background: "var(--m-iris)" }} />
      <i />
      <i />
      <i />
      <i />
      <i style={{ background: "var(--m-mint)" }} />
    </div>
  );
}

function TableGlyph() {
  return (
    <div className="m-glyph m-glyph-table" style={{ width: 60, height: 46 }} aria-hidden>
      <i />
      <i />
      <i style={{ background: "rgba(139,123,255,.28)" }} />
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

function SmsGlyph() {
  return (
    <div
      className="m-glyph m-glyph-lines"
      style={{ width: 58, height: 40, borderRadius: 9, justifyContent: "center" }}
      aria-hidden
    >
      <i style={{ width: "80%", background: "rgba(255,255,255,.24)" }} />
      <i style={{ width: "55%", background: "var(--m-mint)" }} />
    </div>
  );
}

function LinkGlyph() {
  return (
    <div className="m-glyph m-glyph-link" style={{ width: 58, height: 44 }} aria-hidden>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 999,
          border: "1px solid var(--m-iris)",
        }}
      />
      <span
        style={{
          flex: 1,
          height: 1,
          background: "linear-gradient(90deg, var(--m-iris), rgba(255,255,255,.2))",
        }}
      />
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          border: "1px solid rgba(255,255,255,.28)",
        }}
      />
    </div>
  );
}

function PaystubGlyph() {
  return (
    <div className="m-glyph m-glyph-lines" style={{ width: 46, height: 58 }} aria-hidden>
      <i style={{ width: "100%" }} />
      <i style={{ width: "70%" }} />
      <i style={{ width: "100%" }} />
      <i
        style={{
          width: "60%",
          height: 8,
          background: "var(--m-mint)",
          opacity: 0.5,
          marginTop: "auto",
        }}
      />
    </div>
  );
}

function BarsGlyph() {
  return (
    <div className="m-glyph m-glyph-bars" style={{ width: 60, height: 46 }} aria-hidden>
      <i style={{ height: "80%", opacity: 1 }} />
      <i style={{ height: "64%", opacity: 0.78 }} />
      <i style={{ height: "50%", opacity: 0.58 }} />
      <i style={{ height: "38%", opacity: 0.42 }} />
      <i style={{ height: "26%", opacity: 0.3 }} />
    </div>
  );
}

function FxGlyph() {
  return (
    <div className="m-glyph m-glyph-fx" style={{ width: 60, height: 46 }} aria-hidden>
      $ ⇄ ₹
    </div>
  );
}
