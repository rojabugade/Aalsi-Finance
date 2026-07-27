import { useTranslations } from "next-intl";

import { ActTicks } from "./act-ticks";
import { MarketingFooter } from "./marketing-footer";
import { Hero } from "./acts/hero";
import { Capture } from "./acts/capture";
import { Sources } from "./acts/sources";
import { Confirm } from "./acts/confirm";
import { Ledger } from "./acts/ledger";
import { Understand } from "./acts/understand";
import { Archive } from "./acts/archive";
import { Apply } from "./acts/apply";

/**
 * The whole landing page, composed.
 *
 * Six acts — the pile, capture, confirm, understand, the archive, the invite —
 * with two horizontal bands threaded between them. The acts are what the scene
 * behind the page is keyed to: each carries `data-act`, and the scene engine
 * reads their positions to decide where the camera is and how the paper is
 * arranged. Adding or reordering a section here changes the film. The two
 * `data-band` sections are the sideways stretches and are not acts.
 *
 * `page.tsx` owns the one asynchronous decision (session hint → redirect) and
 * nothing else, which keeps this renderable in a plain test without stubbing
 * request-scoped APIs.
 *
 * The canvas and the nav are not here — they belong to the layout, which the
 * auth screens share, so that navigating between them keeps one scene and one
 * bar alive.
 */
export function Landing() {
  const t = useTranslations("marketing");

  return (
    <>
      <a className="m-skip" href="#main">
        {t("skip")}
      </a>

      <div className="m-layer">
        <ActTicks />

        <main id="main">
          <Hero />
          <Capture />
          <Sources />
          <Confirm />
          <Ledger />
          <Understand />
          <Archive />
          <Apply />
        </main>

        <MarketingFooter />
      </div>
    </>
  );
}
