import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import "./marketing.css";
import { MARKETING_FONT_VARS } from "@/lib/theme/marketing-theme";
import { MarketingNav } from "./_components/marketing-nav";
import { Scene } from "./_components/scene";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.meta");
  return {
    title: t("title"),
    description: t("description"),
    openGraph: { title: t("title"), description: t("description"), type: "website" },
  };
}

/**
 * Shell for the public marketing surface.
 *
 * The root layout puts `data-theme` on <html> and the app's `bg-bg text-fg` on
 * <body>. This wrapper declares its own variables plus its own background and
 * foreground, so app tokens can't bleed in and marketing tokens can't bleed
 * back out. A visitor here has never picked one of the app's eight palettes, so
 * there is nothing to honour yet — and this surface is dark-only regardless,
 * because the scene behind it is lit for one background.
 *
 * The scene is mounted here rather than on the landing page because the auth
 * screens are inside this layout too. One canvas, held across the navigation:
 * `Get started` moves the camera to the form instead of unmounting ninety-six
 * documents and building them again on the next route. `Scene` reads the
 * pathname to decide which pose to hold.
 *
 * The nav is here for the same reason. One bar, mounted once, identical on every
 * public route — it does not re-enter or re-animate when the route under it
 * changes, which is the whole difference between navigating a site and loading
 * pages of one.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`marketing marketing-page ${MARKETING_FONT_VARS}`}>
      <Scene />
      <MarketingNav />
      {children}
    </div>
  );
}
