import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { MarketingFooter } from "../_components/marketing-footer";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.roadmap");
  return { title: t("title"), description: t("lede") };
}

/**
 * What is in the beta, and what is not.
 *
 * This is where the footer's "honesty" paragraph went. Nothing was softened —
 * Gmail ingestion still returns 410, push delivery still has no keys behind it,
 * passkeys still aren't implemented — but a list of gaps belongs on a page
 * someone chooses to open, not under the last thing they read before deciding.
 *
 * The README remains the authoritative list; this is its public-facing summary.
 */
export default async function RoadmapPage() {
  const t = await getTranslations("marketing.roadmap");

  const shipped = [t("s1"), t("s2"), t("s3"), t("s4"), t("s5"), t("s6")];
  const later = [t("l1"), t("l2"), t("l3"), t("l4")];

  return (
    <>
      <main id="main" className="m-page">
        <div className="m-shell">
          <h1 className="m-h2">{t("heading")}</h1>
          <p className="m-lede" style={{ marginTop: "1rem" }}>
            {t("lede")}
          </p>

          <div className="m-roadmap">
            <section data-state="shipped">
              <h3 className="m-h3">{t("shippedHeading")}</h3>
              <ul>
                {shipped.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section data-state="later">
              <h3 className="m-h3">{t("laterHeading")}</h3>
              <ul>
                {later.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>

          <p className="m-small" style={{ marginTop: "clamp(40px, 6vh, 72px)" }}>
            {t("foot")}{" "}
            <Link className="m-link" href="/#apply">
              {t("footLink")}
            </Link>
          </p>
        </div>
      </main>

      <MarketingFooter />
    </>
  );
}
