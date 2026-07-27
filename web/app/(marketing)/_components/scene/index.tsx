"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { SceneEngine, type ScenePose } from "./engine";

/**
 * Mounts the paper scene and hands it the page.
 *
 * This lives in the marketing *layout*, not in any one page, and that placement
 * is the point: the landing page and the auth screens are the same React tree,
 * so clicking `Get started` moves the camera instead of tearing the scene down
 * and building ninety-six documents again. Signing in is a move within the film
 * rather than a cut to another one.
 *
 * Which pose the scene holds is read off the pathname. Everything interesting is
 * in `engine.ts`; this owns the canvas element, the mount/unmount pair, and that
 * one read. The engine is imported statically but pulls three.js in with a
 * dynamic `import()`, so the ~170KB of library lands in its own chunk after the
 * page is interactive rather than in the initial bundle.
 *
 * The scene plays for everyone, `prefers-reduced-motion` included — on this
 * surface the motion is the explanation rather than ornament on top of it. See
 * the note at the foot of `marketing.css`.
 */

/** `/` is the film; the auth screens hold one pose; everything else is a document. */
function poseFor(pathname: string): ScenePose {
  if (pathname === "/") return "scroll";
  if (
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/verify-email"
  ) {
    return "auth";
  }
  return "off";
}

export function Scene() {
  const ref = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const pose = poseFor(usePathname());

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const engine = new SceneEngine(canvas);
    engineRef.current = engine;
    void engine.start();
    return () => {
      engineRef.current = null;
      engine.dispose();
    };
  }, []);

  // Separate effect, so a route change re-poses the engine that is already
  // running rather than replacing it.
  useEffect(() => {
    engineRef.current?.setPose(pose);
  }, [pose]);

  return <canvas ref={ref} className="m-canvas" data-pose={pose} aria-hidden />;
}
