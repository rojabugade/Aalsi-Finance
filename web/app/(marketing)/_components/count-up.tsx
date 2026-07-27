"use client";

import { useEffect, useState } from "react";

/**
 * Counts a figure up on mount, quartic-eased so it decelerates into the value
 * rather than stopping dead.
 *
 * The formatting is done here rather than passed in because the intermediate
 * values need the same grouping and decimal places as the final one — a number
 * that gains a comma halfway through the animation reads as a glitch.
 *
 * Rendered on the server at its final value, so the number is correct in the
 * HTML and never absent — the count is decoration on top of a correct figure.
 * It runs regardless of `prefers-reduced-motion`, in step with the rest of this
 * page; see the note at the foot of `marketing.css`.
 */
export function CountUp({ value, locale }: { value: number; locale: string }) {
  const [n, setN] = useState(value);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const q = Math.min(1, (t - start) / 1500);
      setN(value * (1 - Math.pow(1 - q, 4)));
      if (q < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <>
      {n.toLocaleString(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
    </>
  );
}
