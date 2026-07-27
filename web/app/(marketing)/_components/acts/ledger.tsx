import { useTranslations } from "next-intl";

/**
 * The ledger, as a rail that travels sideways over 300vh of scroll.
 *
 * This is the only place the product's actual output is shown, and the column
 * that earns the section is Evidence: every row names the document it came out
 * of. A ledger you cannot trace back to paper is just a spreadsheet someone
 * typed, which is the thing this replaces.
 *
 * Sample data, and it says so. It is laid out as a grid rather than a <table>
 * because the row template has to be shared with a sticky transform, so the
 * table roles are declared explicitly instead.
 */

type Row = {
  date: string;
  merchant: string;
  cat: string;
  account: string;
  evidence: string;
  ok: boolean;
  amount: string;
  credit?: boolean;
  balance: string;
};

const ROWS: Row[] = [
  {
    date: "07-17",
    merchant: "Costco",
    cat: "groceries",
    account: "Costco •2219",
    evidence: "costco_jul.csv",
    ok: false,
    amount: "−318.64",
    balance: "7,681.36",
  },
  {
    date: "07-18",
    merchant: "Verizon",
    cat: "utilities",
    account: "Chase •4412",
    evidence: "autopay",
    ok: true,
    amount: "−85.00",
    balance: "7,596.36",
  },
  {
    date: "07-18",
    merchant: "Whole Foods",
    cat: "groceries",
    account: "Chase •4412",
    evidence: "IMG_2836.jpg",
    ok: true,
    amount: "−124.77",
    balance: "7,471.59",
  },
  {
    date: "07-19",
    merchant: "Payroll — Northwind",
    cat: "salary",
    account: "Ally •8830",
    evidence: "paystub_07.pdf",
    ok: true,
    amount: "+3,150.00",
    credit: true,
    balance: "10,621.59",
  },
  {
    date: "07-19",
    merchant: "Marriott",
    cat: "travel",
    account: "Amex •1007",
    evidence: "amex_jul.pdf p.12",
    ok: false,
    amount: "−412.00",
    balance: "10,209.59",
  },
  {
    date: "07-20",
    merchant: "Uber",
    cat: "rideshare",
    account: "Chase •4412",
    evidence: "SMS 21:04",
    ok: true,
    amount: "−18.35",
    balance: "10,191.24",
  },
  {
    date: "07-20",
    merchant: "Netflix",
    cat: "subscriptions",
    account: "Amex •1007",
    evidence: "amex_jul.pdf p.3",
    ok: true,
    amount: "−22.99",
    balance: "10,168.25",
  },
  {
    date: "07-21",
    merchant: "Shell #4411",
    cat: "fuel",
    account: "Chase •4412",
    evidence: "IMG_2843.jpg",
    ok: true,
    amount: "−54.10",
    balance: "10,114.15",
  },
  {
    date: "07-21",
    merchant: "Trader Joe's",
    cat: "groceries",
    account: "Chase •4412",
    evidence: "IMG_2841.jpg",
    ok: true,
    amount: "−86.42",
    balance: "10,027.73",
  },
];

export function Ledger() {
  const t = useTranslations("marketing.ledger");
  const waiting = ROWS.filter((r) => !r.ok).length;

  return (
    <section className="m-band" data-band="ledger" aria-labelledby="ledger-title">
      <div className="m-band-stage">
        <div className="m-band-veil" aria-hidden />

        <div className="m-band-head">
          <div>
            <p className="m-act-label" style={{ color: "var(--m-iris)", marginBottom: "14px" }}>
              {t("label")}
            </p>
            <h2 className="m-h2 m-h2-sm" id="ledger-title">
              {t("heading")}
            </h2>
          </div>
          <p className="m-band-hint">{t("hint")}</p>
        </div>

        <figure className="m-ledger-clip" style={{ margin: 0 }}>
          <div className="m-ledger" data-rail="ledger" role="table" aria-label={t("heading")}>
            <div className="m-ledger-row m-ledger-head" role="row">
              <span role="columnheader">{t("colDate")}</span>
              <span role="columnheader">{t("colMerchant")}</span>
              <span role="columnheader">{t("colCategory")}</span>
              <span role="columnheader">{t("colAccount")}</span>
              <span role="columnheader">{t("colEvidence")}</span>
              <span role="columnheader">{t("colStatus")}</span>
              <span role="columnheader" className="m-c-amount">
                {t("colAmount")}
              </span>
              <span role="columnheader" className="m-c-balance">
                {t("colBalance")}
              </span>
            </div>

            {ROWS.map((row) => (
              <div className="m-ledger-row" role="row" key={`${row.date}-${row.merchant}`}>
                <span role="cell" className="m-c-date">
                  {row.date}
                </span>
                <span role="cell" className="m-c-merchant">
                  {row.merchant}
                </span>
                <span role="cell" className="m-c-category">
                  {t(`cats.${row.cat}`)}
                </span>
                <span role="cell" className="m-c-account">
                  {row.account}
                </span>
                <span role="cell" className="m-c-evidence">
                  {row.evidence}
                </span>
                <span role="cell" className={row.ok ? "m-confirmed" : "m-flagged"}>
                  {row.ok ? `✓ ${t("statusConfirmed")}` : `◇ ${t("statusWaiting")}`}
                </span>
                <span
                  role="cell"
                  className={`m-c-amount${row.credit ? " m-credit" : ""}`}
                >
                  {row.amount}
                </span>
                <span role="cell" className="m-c-balance">
                  {row.balance}
                </span>
              </div>
            ))}

            <div className="m-ledger-row m-ledger-foot" role="row">
              <span role="cell" />
              <span role="cell">{t("footEvents", { count: ROWS.length })}</span>
              <span role="cell" />
              <span role="cell" />
              <span role="cell">{t("footDocuments", { count: ROWS.length })}</span>
              <span role="cell" className="m-flagged">
                {t("footWaiting", { count: waiting })}
              </span>
              <span role="cell" className="m-c-amount">
                +2,027.73
              </span>
              <span role="cell" className="m-c-balance" />
            </div>
          </div>
          <figcaption className="m-note" style={{ paddingInline: "var(--m-pad)" }}>
            {t("sample")}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
