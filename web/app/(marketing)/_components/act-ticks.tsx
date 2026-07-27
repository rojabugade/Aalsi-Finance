"use client";

import { useTranslations } from "next-intl";

/**
 * The act index down the right edge.
 *
 * Which tick is lit is written by the scene engine, not by React — it already
 * knows the smoothed act position every frame, and a `useState` mirroring it
 * would be a commit per frame to render one bar 18px wider. So this component
 * renders six buttons and stops; `data-on` and `aria-current` arrive from the
 * loop, and the styling hangs off the attribute.
 *
 * Hidden under 1000px, where there is no room beside the copy and the ticks
 * would sit on top of it. Nothing is lost: they duplicate scrolling.
 */
export function ActTicks() {
  const t = useTranslations("marketing.ticks");
  const labels = [t("t0"), t("t1"), t("t2"), t("t3"), t("t4"), t("t5")];

  function jump(index: number) {
    const acts = document.querySelectorAll<HTMLElement>("[data-act]");
    const el = acts[index];
    if (!el) return;
    window.scrollTo({
      // Land the act a fifth of the way down rather than flush to the top: its
      // copy is vertically centred, so a flush scroll puts the heading above
      // the fold.
      top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.22,
      behavior: "smooth",
    });
  }

  return (
    <nav className="m-ticks" aria-label={t("label")}>
      {labels.map((label, i) => (
        <button key={label} type="button" className="m-tick" data-tick={i} onClick={() => jump(i)}>
          {label}
        </button>
      ))}
    </nav>
  );
}
