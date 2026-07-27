import type * as THREE from "three";

import { M } from "@/lib/theme/marketing-palette";

/**
 * The paper scene behind the landing page.
 *
 * Ninety-six documents — receipts, statements and cards, each drawn at runtime
 * into a 2D canvas and used as a texture — move through six poses as the page
 * scrolls. The poses are the argument the page is making: a heap off to one
 * side, a queue under a scanning lamp, a wall of confirmed pages, a bar chart,
 * a grid, and finally a single sheet with the rest receding. Nothing here is a
 * screenshot of the product; it is the pile the product is for.
 *
 * Deliberately free of React. It owns a `requestAnimationFrame` loop that both
 * renders the scene and drives the DOM parts that have to stay in lockstep with
 * it (the horizontal rails, the act ticks, the reveal transitions) — running
 * those through React state would mean a commit per frame. It finds those
 * elements by data attribute rather than by ref so the components that own them
 * can stay on the server.
 */

const ACTS = 6;
/** Sheets in the scene. Each is a group of three meshes: paper, ink, stamp. */
const NS = 96;
/** Twelve months of relative spend, used for the act-3 bar chart. */
const CHART = [0.42, 0.61, 0.35, 0.78, 0.5, 0.9, 0.44, 0.68, 0.3, 0.85, 0.56, 0.72];

/** Camera position and look-at target per act, interpolated between. */
const CAM = [
  { p: [0.4, 0.5, 13.6], l: [2.0, 0.1, -2.0] },
  { p: [-2.6, 1.0, 9.2], l: [1.7, 0.2, -7.0] },
  { p: [-1.2, 0.4, 8.6], l: [-2.0, 0.0, -6.2] },
  { p: [-1.5, 1.8, 9.4], l: [1.6, -2.0, -3.2] },
  { p: [-2.2, 0.6, 15.4], l: [1.2, 0.2, -9.0] },
  { p: [-1.0, 0.25, 7.9], l: [1.0, 0.0, 0.8] },
] as const;

/**
 * Where the camera goes on the auth screens.
 *
 * Not an act — there is nothing to scroll there. It sits close in on the near
 * corner of the pile, looking right and slightly down, which leaves the paper
 * behind the form panel and puts the readable sheets under the left column's
 * type. The scene keeps its idle float and pointer parallax, so the screen
 * breathes rather than being a still image.
 */
const AUTH_CAM = { p: [-0.4, 0.2, 6.6], l: [3.0, -0.1, 1.2] } as const;

/**
 * How the scene is being driven.
 *
 * `scroll` is the landing film. `auth` holds the pose above and keeps breathing.
 * `off` is for the public document pages, which are type on the ink background
 * and want no paper behind them — the loop stops and CSS fades the canvas out,
 * but the engine stays built so coming back is instant.
 */
export type ScenePose = "scroll" | "auth" | "off";

/**
 * Lighting per act: key colour and intensity, fill colour and intensity, and
 * the background the fog matches. The warm key against the violet fill is what
 * makes the paper read as paper under a desk lamp rather than as white planes.
 */
const MOOD = {
  key: ["#ffc79a", "#fff6e8", "#fff2e2", "#ffd3a4", "#f4efff", "#ffd7ad"],
  ki: [1.5, 2.1, 1.8, 2.2, 1.85, 2.0],
  fill: [M.iris, "#7c6cff", M.mint, M.iris, M.iris, M.ember],
  fi: [0.75, 0.5, 0.7, 0.5, 0.6, 0.45],
  bg: [M.ink, "#0d0b18", "#0a1017", "#120e14", "#0c0b16", "#100c14"],
} as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Smoothstep. Used everywhere a linear ramp would read as mechanical. */
const sm = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/** Deterministic PRNG, so the same sheet is the same document on every load. */
function rng(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;

type Pose = {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
};

type Sheet = {
  g: THREE.Group;
  ink: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  st: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Poses per act. */
  P: Pose[];
  /** Per-sheet delay in 0..1, so a transition ripples instead of snapping. */
  d: number;
  /** Phase offset for the idle float. */
  ph: number;
};

/**
 * A document, drawn twice: `base` is the paper (stock, fibre noise, torn edge or
 * card gradient), `ink` is everything printed on it. They are separate textures
 * on separate meshes so the ink can fade up independently — that fade is act 1,
 * the moment the pile becomes readable.
 */
type Doc = { base: THREE.Texture; ink: THREE.Texture; w: number; h: number };

export class SceneEngine {
  private readonly canvas: HTMLCanvasElement;
  private pose: ScenePose = "scroll";
  private T: typeof THREE | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private disposed = false;
  private raf = 0;

  private sheets: Sheet[] = [];
  private keyLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private bgColor!: THREE.Color;
  private lamp!: THREE.Group;
  private barMat!: THREE.MeshBasicMaterial;
  private glowMat!: THREE.MeshBasicMaterial;
  private lineMat!: THREE.LineBasicMaterial;
  private dotMat!: THREE.MeshBasicMaterial;
  private poolMat!: THREE.MeshBasicMaterial;
  private shadowMat!: THREE.MeshBasicMaterial;
  private motes!: THREE.Points;

  // Scratch objects, allocated once. Allocating a Vector3 per frame is how a
  // scroll scene ends up garbage-collecting mid-scroll.
  private v1!: THREE.Vector3;
  private v2!: THREE.Vector3;
  private v3!: THREE.Vector3;
  private v4!: THREE.Vector3;
  private c1!: THREE.Color;
  private c2!: THREE.Color;

  /** Smoothed act position in 0..ACTS-1, and its target from the scroll read. */
  private actT = 0;
  /** Pointer parallax: target and smoothed. */
  private tx = 0;
  private ty = 0;
  private mx = 0;
  private my = 0;
  /** Smoothed -1..1 progress through whichever horizontal band is on screen. */
  private bandT = 0;
  /**
   * 0 = the act camera, 1 = the auth camera, eased between. This is what makes
   * `Get started` read as a move rather than a page load: the pile stays exactly
   * where the visitor left it and the camera walks over to the form.
   */
  private authT = 0;
  /** Set by `setPose`: take the next scroll read as-is instead of easing to it. */
  private snapAct = false;

  // DOM the loop drives. Re-read lazily so a client-side navigation that swaps
  // the page's sections doesn't leave the loop writing to detached nodes.
  private actEls: HTMLElement[] | null = null;
  private bandEls: HTMLElement[] = [];
  private railEls: HTMLElement[] = [];
  private tickEls: HTMLElement[] = [];
  private revealEls: HTMLElement[] = [];

  private onPointerMove = (e: PointerEvent) => {
    this.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    this.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  };

  private onResize = () => {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Change what the scene is doing, without rebuilding it.
   *
   * Called on every client-side route change within the public surface. Moving
   * to or from `auth` is eased over the following frames by `authT`; moving to
   * `off` parks the loop on the next frame, and moving away from it starts the
   * loop again from wherever the scene was left.
   */
  setPose(pose: ScenePose) {
    if (pose === this.pose) return;
    const wasParked = this.pose === "off";
    this.pose = pose;

    // Every pose change means the route changed, which means the elements the
    // loop had cached are detached. They must be re-found: a detached node
    // reports a zero rect, every act anchor collapses to the same value, and the
    // scroll read then decides we are past the last one — which is why returning
    // to the landing page used to arrive on the closing act instead of the hero.
    this.rescan();
    // Read the act fresh rather than easing toward it. The browser has just put
    // the new page at the top, so the act is 0; easing there from wherever the
    // visitor left would play the whole film backwards at scroll-independent
    // speed. The camera still travels, because `authT` is what eases.
    this.snapAct = true;

    // Coming back from `off` the loop returned without queueing a frame.
    if (wasParked && !this.raf) this.loop();
  }

  // ---- lifecycle ---------------------------------------------------------

  async start() {
    this.scanDom();
    // The DOM half runs immediately. If three.js never arrives — offline, a
    // blocked chunk, no WebGL — the page still reveals, the rails still move
    // and the ticks still track; it just has a flat background behind it.
    this.loop();

    let T: typeof THREE;
    try {
      T = await import("three");
    } catch (error) {
      console.warn("[marketing] three.js unavailable; scene stays flat", error);
      return;
    }
    if (this.disposed) return;
    this.T = T;

    try {
      await document.fonts.ready;
    } catch {
      // Documents get drawn in whatever face is resolved. Not worth failing over.
    }
    if (this.disposed) return;

    try {
      this.build(T);
    } catch (error) {
      console.warn("[marketing] scene could not be built", error);
      this.T = null;
      this.renderer?.dispose();
      this.renderer = null;
      return;
    }

    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("resize", this.onResize);
    this.scene?.traverse((obj) => {
      const mesh = obj as Partial<THREE.Mesh>;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
  }

  /** Called after a section swap so the loop re-finds its elements. */
  rescan() {
    this.actEls = null;
    this.scanDom();
  }

  private scanDom() {
    this.revealEls = Array.from(document.querySelectorAll<HTMLElement>("[data-rv]"));
    this.revealEls.forEach((el, i) => {
      if (el.dataset.rvOn) return;
      el.dataset.rvOn = "1";
      // Three per stagger group: enough to read as a cascade, short enough that
      // the last item is not still arriving when the eye has moved on.
      el.style.transitionDelay = `${(i % 3) * 90}ms`;
    });
  }

  // ---- procedural documents ----------------------------------------------

  /**
   * Draw one document into a pair of canvases.
   *
   * kind 0 is a till receipt (torn edges, item lines, a total, a barcode), 1 is
   * a statement page (header, ruled rows, a page-of-42 footer), 2 is a card.
   * The figures are randomised per sheet from the seeded PRNG — at the scale
   * these are seen, what has to be legible is the *shape* of a receipt, and a
   * plausible one beats nine copies of the same one.
   */
  private doc(T: typeof THREE, kind: 0 | 1 | 2, R: Rand): Doc {
    const [W, H] = [
      [256, 512],
      [460, 340],
      [460, 290],
    ][kind];
    const s = 2;

    const cb = document.createElement("canvas");
    const ci = document.createElement("canvas");
    cb.width = W * s;
    cb.height = H * s;
    ci.width = W * s;
    ci.height = H * s;
    const b = cb.getContext("2d")!;
    const k = ci.getContext("2d")!;
    b.scale(s, s);
    k.scale(s, s);

    const money = (v: number) => v.toFixed(2);
    const mono = (size: number, weight = "") =>
      `${weight}${weight ? " " : ""}${size}px "JetBrains Mono", ui-monospace, monospace`;
    const dash = (c: CanvasRenderingContext2D, x1: number, y: number, x2: number, col: string) => {
      c.strokeStyle = col;
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.beginPath();
      c.moveTo(x1, y);
      c.lineTo(x2, y);
      c.stroke();
      c.setLineDash([]);
    };

    if (kind === 0) {
      // Torn top and bottom edges, clipped so the stock ends raggedly.
      b.save();
      b.beginPath();
      b.moveTo(0, 9);
      for (let x = 0; x <= W; x += 14) b.lineTo(x, 3 + R() * 11);
      b.lineTo(W, H - 9);
      for (let x = W; x >= 0; x -= 14) b.lineTo(x, H - 3 - R() * 11);
      b.closePath();
      b.clip();
      const g = b.createLinearGradient(0, 0, W * 0.7, H);
      g.addColorStop(0, "#fdf9f0");
      g.addColorStop(0.55, "#f6f0e2");
      g.addColorStop(1, "#e6dfcd");
      b.fillStyle = g;
      b.fillRect(0, 0, W, H);
      b.globalAlpha = 0.05;
      for (let i = 0; i < 240; i++) {
        b.fillStyle = i % 2 ? "#7d7359" : "#ffffff";
        b.fillRect(R() * W, R() * H, R() * 12 + 1, 1);
      }
      b.globalAlpha = 1;
      b.restore();

      const merchants = [
        "TRADER JOE'S",
        "WHOLE FOODS",
        "SHELL #4411",
        "STARBUCKS",
        "CVS PHARMACY",
        "CHIPOTLE",
      ];
      k.textAlign = "center";
      k.fillStyle = "#231f36";
      k.font = mono(15, "500");
      k.fillText(merchants[Math.floor(R() * merchants.length)], W / 2, 50);
      k.font = mono(9);
      k.fillStyle = "#6d6683";
      k.fillText(
        `2026-07-${String(3 + Math.floor(R() * 25)).padStart(2, "0")}  1${Math.floor(R() * 9)}:4${Math.floor(R() * 9)}`,
        W / 2,
        68,
      );
      dash(k, 20, 84, W - 20, "#9a93ad");

      const items = [
        "BANANAS",
        "OAT MILK",
        "COFFEE 12OZ",
        "EGGS LRG",
        "SOURDOUGH",
        "OLIVE OIL",
        "GREENS",
        "YOGURT",
        "TOMATOES",
        "PASTA",
      ];
      let y = 106;
      let total = 0;
      const rows = 5 + Math.floor(R() * 4);
      for (let i = 0; i < rows; i++) {
        const amt = Math.round((1.2 + R() * 21) * 100) / 100;
        total += amt;
        k.textAlign = "left";
        k.font = mono(10);
        k.fillStyle = "#3c3654";
        k.fillText(items[Math.floor(R() * items.length)], 22, y);
        k.textAlign = "right";
        k.fillStyle = "#231f36";
        k.fillText(money(amt), W - 22, y);
        y += 21;
      }
      dash(k, 20, y, W - 20, "#9a93ad");
      y += 28;
      k.textAlign = "left";
      k.font = mono(12, "500");
      k.fillStyle = "#231f36";
      k.fillText("TOTAL", 22, y);
      k.textAlign = "right";
      k.font = mono(19, "500");
      k.fillText(money(total), W - 22, y + 3);

      let bx = 32;
      k.fillStyle = "#231f36";
      while (bx < W - 32) {
        const w = 1 + Math.floor(R() * 3);
        k.fillRect(bx, H - 74, w, 28);
        bx += w + 2 + Math.floor(R() * 3);
      }
      k.font = mono(8);
      k.textAlign = "center";
      k.fillStyle = "#6d6683";
      k.fillText(`VISA ****${Math.floor(1000 + R() * 8999)}`, W / 2, H - 36);
    } else if (kind === 1) {
      const g = b.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#fbfaff");
      g.addColorStop(1, "#e7e6f1");
      b.fillStyle = g;
      b.fillRect(0, 0, W, H);
      b.fillStyle = "#e2e0ef";
      b.fillRect(0, 0, W, 46);
      for (let i = 0; i < 10; i++) {
        if (i % 2) {
          b.fillStyle = "rgba(120,112,160,.07)";
          b.fillRect(18, 96 + i * 21, W - 36, 21);
        }
      }
      b.globalAlpha = 0.04;
      for (let i = 0; i < 160; i++) {
        b.fillStyle = "#5c5680";
        b.fillRect(R() * W, R() * H, R() * 9 + 1, 1);
      }
      b.globalAlpha = 1;

      k.textAlign = "left";
      k.fillStyle = "#231f36";
      k.font = mono(13, "500");
      k.fillText("STATEMENT", 18, 28);
      k.textAlign = "right";
      k.font = mono(10);
      k.fillStyle = "#6d6683";
      const accounts = ["CHASE •4412", "AMEX •1007", "ALLY •8830", "HDFC •9021"];
      k.fillText(`${accounts[Math.floor(R() * accounts.length)]}   JUL 2026`, W - 18, 28);
      k.textAlign = "left";
      k.font = mono(8);
      k.fillStyle = "#8a83a0";
      k.fillText("DATE", 20, 86);
      k.fillText("DESCRIPTION", 78, 86);
      k.textAlign = "right";
      k.fillText("AMOUNT", W - 22, 86);

      const desc = [
        "AMAZON MKTP US",
        "UBER TRIP",
        "NETFLIX.COM",
        "COSTCO WHSE",
        "SHELL OIL",
        "SPOTIFY",
        "DELTA AIR",
        "KROGER",
        "VERIZON WRLS",
        "APPLE.COM/BILL",
      ];
      for (let i = 0; i < 10; i++) {
        const yy = 111 + i * 21;
        const credit = R() < 0.12;
        const amt = Math.round((3 + R() * 260) * 100) / 100;
        k.textAlign = "left";
        k.font = mono(9);
        k.fillStyle = "#6d6683";
        k.fillText(`07/${String(2 + Math.floor(R() * 26)).padStart(2, "0")}`, 20, yy);
        k.fillStyle = "#3c3654";
        k.fillText(desc[Math.floor(R() * desc.length)], 78, yy);
        k.textAlign = "right";
        k.fillStyle = credit ? "#1c8e6a" : "#231f36";
        k.font = mono(10, "500");
        k.fillText((credit ? "+" : "−") + money(amt), W - 22, yy);
      }
      k.strokeStyle = "#b6b1c9";
      k.lineWidth = 1;
      k.beginPath();
      k.moveTo(18, 328);
      k.lineTo(W - 18, 328);
      k.stroke();
      k.textAlign = "left";
      k.font = mono(8);
      k.fillStyle = "#8a83a0";
      k.fillText(`PAGE ${1 + Math.floor(R() * 30)} OF 42`, 20, H - 8);
    } else {
      b.save();
      const r = 26;
      b.beginPath();
      b.moveTo(r, 0);
      b.lineTo(W - r, 0);
      b.quadraticCurveTo(W, 0, W, r);
      b.lineTo(W, H - r);
      b.quadraticCurveTo(W, H, W - r, H);
      b.lineTo(r, H);
      b.quadraticCurveTo(0, H, 0, H - r);
      b.lineTo(0, r);
      b.quadraticCurveTo(0, 0, r, 0);
      b.closePath();
      b.clip();
      const pal = [
        ["#3a2f6e", "#171436"],
        ["#123a35", "#0b1c22"],
        ["#4a2418", "#1d1013"],
      ][Math.floor(R() * 3)];
      const g = b.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, pal[0]);
      g.addColorStop(1, pal[1]);
      b.fillStyle = g;
      b.fillRect(0, 0, W, H);
      b.strokeStyle = "rgba(255,255,255,.12)";
      b.lineWidth = 40;
      b.beginPath();
      b.moveTo(-40, H * 0.75);
      b.lineTo(W + 40, H * 0.1);
      b.stroke();
      b.restore();

      k.fillStyle = "#e0b25c";
      k.beginPath();
      k.roundRect(34, 92, 54, 40, 6);
      k.fill();
      k.strokeStyle = "rgba(0,0,0,.25)";
      k.lineWidth = 1;
      k.beginPath();
      k.moveTo(34, 112);
      k.lineTo(88, 112);
      k.moveTo(61, 92);
      k.lineTo(61, 132);
      k.stroke();
      k.fillStyle = "rgba(255,255,255,.9)";
      k.font = mono(20, "500");
      k.textAlign = "left";
      k.fillText(`••••  ••••  ••••  ${Math.floor(1000 + R() * 8999)}`, 34, 190);
      k.font = mono(10);
      k.fillStyle = "rgba(255,255,255,.55)";
      k.fillText(`VALID THRU  0${1 + Math.floor(R() * 9)}/29`, 34, 224);
      k.font = mono(13, "500");
      k.fillStyle = "rgba(255,255,255,.85)";
      k.fillText("A. RAMAKRISHNAN", 34, 252);
    }

    const base = new T.CanvasTexture(cb);
    const ink = new T.CanvasTexture(ci);
    base.anisotropy = 4;
    ink.anisotropy = 4;
    base.colorSpace = T.SRGBColorSpace;
    ink.colorSpace = T.SRGBColorSpace;
    const [w, h] = [
      [0.9, 1.8],
      [2.06, 1.52],
      [1.66, 1.05],
    ][kind];
    return { base, ink, w, h };
  }

  /** The review stamp: a ✓ for confirmed, a ? for the ones still waiting. */
  private stampTex(T: typeof THREE, color: string, glyph: string) {
    const S = 256;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const x = c.getContext("2d")!;
    x.strokeStyle = color;
    x.lineWidth = 9;
    x.globalAlpha = 0.9;
    x.beginPath();
    x.arc(S / 2, S / 2, 96, 0, Math.PI * 2);
    x.stroke();
    x.beginPath();
    x.arc(S / 2, S / 2, 82, 0, Math.PI * 2);
    x.globalAlpha = 0.4;
    x.lineWidth = 3;
    x.stroke();
    x.globalAlpha = 0.95;
    x.fillStyle = color;
    x.font = '500 74px "JetBrains Mono", ui-monospace, monospace';
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(glyph, S / 2, S / 2 + 4);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  /** Soft radial falloff, used for the lamp glow, the desk pool and shadows. */
  private radialTex(T: typeof THREE, inner: string, outer: string, power: number) {
    const S = 256;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, inner);
    g.addColorStop(power, outer);
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  /** Where sheet `i` sits in each of the six acts. */
  private poses(i: number, R: Rand): Pose[] {
    const P: Pose[] = [];

    // 0 — the pile. A loose sphere off to the right of frame.
    const a = R() * Math.PI * 2;
    const ph = Math.acos(2 * R() - 1);
    const rr = 2.4 + Math.pow(R(), 0.62) * 5.9;
    P[0] = {
      x: 6.4 + Math.sin(ph) * Math.cos(a) * rr,
      y: Math.cos(ph) * rr * 0.78,
      z: -3.4 + Math.sin(ph) * Math.sin(a) * rr * 1.15,
      rx: (R() - 0.5) * 2.6,
      ry: (R() - 0.5) * 3.4,
      rz: (R() - 0.5) * 1.7,
      s: 0.85 + R() * 0.5,
    };
    // The first three sit close to camera so the opening frame has something
    // legible in it rather than a distant cloud.
    if (i < 3) {
      P[0].x = 8.4 + R() * 2.6;
      P[0].y = (R() - 0.5) * 6;
      P[0].z = 5.2 + R() * 2.6;
      P[0].s = 1.4 + R() * 0.5;
    }

    // 1 — the queue, running away from camera through the scan lamp.
    const q = i / (NS - 1);
    P[1] = {
      x: 2.1 + Math.sin(i * 0.92) * 1.3,
      y: Math.cos(i * 0.63) * 1.2 - 0.1,
      z: 5.2 - q * 44,
      rx: Math.sin(i * 0.4) * 0.05,
      ry: -0.1 + Math.sin(i * 0.5) * 0.07,
      rz: Math.sin(i * 1.3) * 0.07,
      s: 1,
    };

    // 2 — one sheet held up for review, a fan behind it, a wall behind that.
    if (i === 0) {
      P[2] = { x: -2.5, y: 0.1, z: 3.2, rx: 0.03, ry: 0.16, rz: -0.02, s: 1.5 };
    } else if (i < 16) {
      const aa = ((i - 1) / 15 - 0.5) * 1.6;
      P[2] = {
        x: -2.5 + Math.sin(aa) * 7.8,
        y: (R() - 0.5) * 4.4,
        z: -1.6 - Math.cos(aa) * 4.6,
        rx: (R() - 0.5) * 0.22,
        ry: -aa * 0.55,
        rz: (R() - 0.5) * 0.14,
        s: 0.7,
      };
    } else {
      const j = i - 16;
      const cc = j % 10;
      const rr2 = Math.floor(j / 10);
      P[2] = {
        x: (cc - 4.5) * 2.05 - 2.5 + (R() - 0.5) * 0.7,
        y: (3.5 - rr2) * 1.72 + (R() - 0.5) * 0.55,
        z: -13.5 - ((cc + rr2) % 4) * 2.3,
        rx: (R() - 0.5) * 0.16,
        ry: (R() - 0.5) * 0.22,
        rz: (R() - 0.5) * 0.13,
        s: 0.6,
      };
    }

    // 3 — twelve stacks, laid flat, height driven by CHART. The pile as a year.
    const m = i % 12;
    const kk = Math.floor(i / 12);
    P[3] = {
      x: (m - 5.5) * 1.34 + 1.7 + (R() - 0.5) * 0.05,
      y: -4.3 + kk * (0.1 + CHART[m] * 0.56),
      z: -3.2,
      rx: -Math.PI / 2,
      ry: (R() - 0.5) * 0.14,
      rz: 0,
      s: 0.62,
    };

    // 4 — the archive: an even grid, everything filed.
    const gc = i % 12;
    const gr = Math.floor(i / 12);
    P[4] = {
      x: (gc - 5.5) * 1.64 + 1.1,
      y: (3.5 - gr) * 1.3 + 0.3,
      z: -9 - ((gc + gr) % 3) * 0.55,
      rx: 0,
      ry: (gc - 5.5) * -0.028,
      rz: 0,
      s: 0.6,
    };

    // 5 — one sheet, close. Everything else recedes so the invite is the frame.
    if (i === 0) {
      P[5] = { x: 3.5, y: 0.05, z: 2.4, rx: 0.05, ry: -0.3, rz: -0.015, s: 1.85 };
    } else {
      P[5] = {
        x: P[4].x * 0.35 + 2,
        y: P[4].y * 0.35,
        z: -26 - R() * 16,
        rx: 0,
        ry: 0,
        rz: 0,
        s: 0.3,
      };
    }

    return P;
  }

  // ---- build -------------------------------------------------------------

  private build(T: typeof THREE) {
    const renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    this.renderer = renderer;

    const scene = new T.Scene();
    const bg = new T.Color(MOOD.bg[0]);
    scene.background = bg;
    scene.fog = new T.FogExp2(bg.clone().getHex(), 0.028);
    const camera = new T.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 220);
    this.scene = scene;
    this.camera = camera;
    this.bgColor = bg;

    scene.add(new T.HemisphereLight("#b9aeff", "#241a2e", 0.7));
    scene.add(new T.AmbientLight("#efe6ff", 0.5));
    const key = new T.DirectionalLight("#ffb27a", 1.0);
    key.position.set(6, 8, 7);
    scene.add(key);
    const fill = new T.DirectionalLight("#7c6cff", 1.0);
    fill.position.set(-8, -3, 4);
    scene.add(fill);
    const rim = new T.DirectionalLight("#ffffff", 0.35);
    rim.position.set(-2, 4, -12);
    scene.add(rim);
    this.keyLight = key;
    this.fillLight = fill;

    // Nine documents — three variants of each kind — shared across 96 sheets.
    const docs: Doc[] = [];
    for (let kind = 0; kind < 3; kind++) {
      for (let v = 0; v < 3; v++) {
        docs.push(this.doc(T, kind as 0 | 1 | 2, rng(kind * 977 + v * 131 + 17)));
      }
    }
    const geo = docs.map((d) => new T.PlaneGeometry(d.w, d.h));
    const baseMats = docs.map(
      (d) =>
        new T.MeshLambertMaterial({
          map: d.base,
          transparent: true,
          alphaTest: 0.03,
          side: T.DoubleSide,
        }),
    );
    const inkMats = docs.map(
      (d) =>
        new T.MeshLambertMaterial({
          map: d.ink,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: T.FrontSide,
        }),
    );
    const stampGeo = new T.PlaneGeometry(0.62, 0.62);
    const stampOk = new T.MeshBasicMaterial({
      map: this.stampTex(T, "#2fae83", "✓"),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const stampNo = new T.MeshBasicMaterial({
      map: this.stampTex(T, "#e0653f", "?"),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    const group = new T.Group();
    const sheets: Sheet[] = [];
    for (let i = 0; i < NS; i++) {
      const R = rng(i * 2654435761 + 12345);
      // The nearest sheet is always a statement — it is the one the opening
      // frame is composed around.
      const r = R();
      const kind = i === 0 ? 1 : r < 0.55 ? 0 : r < 0.86 ? 1 : 2;
      const di = kind * 3 + Math.floor(R() * 3);

      const g = new T.Group();
      g.add(new T.Mesh(geo[di], baseMats[di]));
      const ink = new T.Mesh(geo[di], inkMats[di].clone());
      ink.position.z = 0.006;
      ink.renderOrder = 1;
      g.add(ink);
      // Roughly one in ten is flagged, which is the honest rate: most reads
      // pass, a few need a person.
      const flagged = R() < 0.1;
      const st = new T.Mesh(stampGeo, (flagged ? stampNo : stampOk).clone());
      st.position.set(docs[di].w * 0.24, -docs[di].h * 0.3, 0.014);
      st.rotation.z = (R() - 0.5) * 0.5;
      st.renderOrder = 2;
      st.scale.setScalar(0.01);
      g.add(st);
      group.add(g);

      sheets.push({
        g,
        ink: ink as Sheet["ink"],
        st: st as Sheet["st"],
        P: this.poses(i, R),
        d: (i * 0.618033) % 1,
        ph: R() * 6.283,
      });
    }
    scene.add(group);
    this.sheets = sheets;

    // The scan lamp — a bright bar with a glow behind it, on during act 1.
    const lamp = new T.Group();
    this.barMat = new T.MeshBasicMaterial({ color: "#fff8ec", transparent: true, opacity: 0 });
    lamp.add(new T.Mesh(new T.PlaneGeometry(13, 0.045), this.barMat));
    this.glowMat = new T.MeshBasicMaterial({
      map: this.radialTex(T, "rgba(255,215,170,.85)", "rgba(240,121,79,.18)", 0.5),
      transparent: true,
      opacity: 0,
      blending: T.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new T.Mesh(new T.PlaneGeometry(15, 7), this.glowMat);
    glow.position.z = -0.02;
    lamp.add(glow);
    lamp.position.set(2.0, 0, -0.6);
    scene.add(lamp);
    this.lamp = lamp;

    // The balance line across the tops of the twelve act-3 stacks.
    const pts: number[] = [];
    const cols: number[] = [];
    const cA = new T.Color(M.ember);
    const cB = new T.Color("#FFD9A8");
    for (let m = 0; m < 12; m++) {
      const top = -4.3 + 7 * (0.1 + CHART[m] * 0.56) + 0.42;
      pts.push((m - 5.5) * 1.34 + 1.7, top, -3.2);
      const c = cA.clone().lerp(cB, m / 11);
      cols.push(c.r, c.g, c.b);
    }
    const lg = new T.BufferGeometry();
    lg.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
    lg.setAttribute("color", new T.Float32BufferAttribute(cols, 3));
    this.lineMat = new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 });
    scene.add(new T.Line(lg, this.lineMat));

    this.dotMat = new T.MeshBasicMaterial({ color: "#FFD9A8", transparent: true, opacity: 0 });
    const dots = new T.Group();
    for (let m = 0; m < 12; m++) {
      const d = new T.Mesh(new T.CircleGeometry(0.075, 16), this.dotMat);
      d.position.set(pts[m * 3], pts[m * 3 + 1], pts[m * 3 + 2] + 0.02);
      dots.add(d);
    }
    scene.add(dots);

    // Desk pool and contact shadows: what stops the stacks reading as floating.
    this.poolMat = new T.MeshBasicMaterial({
      map: this.radialTex(T, "rgba(255,190,132,.42)", "rgba(120,90,190,.1)", 0.42),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const pool = new T.Mesh(new T.PlaneGeometry(46, 46), this.poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(2.4, -5.34, -5);
    scene.add(pool);

    this.shadowMat = new T.MeshBasicMaterial({
      map: this.radialTex(T, "rgba(0,0,0,.72)", "rgba(0,0,0,.22)", 0.4),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const shadows = new T.Group();
    for (let m = 0; m < 12; m++) {
      const s = new T.Mesh(new T.PlaneGeometry(2.1, 2.1), this.shadowMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set((m - 5.5) * 1.34 + 1.7, -5.26, -3.2);
      shadows.add(s);
    }
    scene.add(shadows);

    // Dust in the lamp beam.
    const dp: number[] = [];
    for (let i = 0; i < 900; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 1.5 + Math.random() * 22;
      dp.push(Math.cos(ang) * rad + 2, (Math.random() - 0.5) * 16, 8 - Math.random() * 46);
    }
    const dg = new T.BufferGeometry();
    dg.setAttribute("position", new T.Float32BufferAttribute(dp, 3));
    this.motes = new T.Points(
      dg,
      new T.PointsMaterial({
        color: "#e6c9a4",
        size: 0.045,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    scene.add(this.motes);

    this.v1 = new T.Vector3();
    this.v2 = new T.Vector3();
    this.v3 = new T.Vector3();
    this.v4 = new T.Vector3();
    this.c1 = new T.Color();
    this.c2 = new T.Color();
  }

  // ---- per-frame ---------------------------------------------------------

  /**
   * Read the page's scroll position into everything the frame needs: which act
   * we are between, how far through the current horizontal band, how far each
   * rail should be translated, and which reveals have crossed the trigger line.
   */
  private readScroll() {
    const vh = window.innerHeight;
    if (!this.actEls) {
      this.actEls = Array.from(document.querySelectorAll<HTMLElement>("[data-act]"));
      this.bandEls = Array.from(document.querySelectorAll<HTMLElement>("[data-band]"));
      this.railEls = Array.from(document.querySelectorAll<HTMLElement>("[data-rail]"));
      this.tickEls = Array.from(document.querySelectorAll<HTMLElement>("[data-tick]"));
    }
    if (!this.actEls.length) return { act: this.actT, band: 0, rails: [], reveal: [] };

    const y = window.scrollY;
    // Anchor each act 40% down the viewport: the act changes when its copy is
    // comfortably readable, not when its section's top edge grazes the fold.
    const anchors = this.actEls.map((el) => el.getBoundingClientRect().top + y - vh * 0.4);
    let act = 0;
    if (y <= anchors[0]) {
      act = 0;
    } else if (y >= anchors[anchors.length - 1]) {
      act = anchors.length - 1;
    } else {
      for (let i = 0; i < anchors.length - 1; i++) {
        if (y >= anchors[i] && y < anchors[i + 1]) {
          const u = (y - anchors[i]) / Math.max(1, anchors[i + 1] - anchors[i]);
          // The 0.42 dead zone holds each act still for the first stretch of
          // its scroll, so copy can be read before the scene starts moving.
          act = i + sm((u - 0.42) / 0.58);
          break;
        }
      }
    }

    let band = 0;
    const rails: [HTMLElement, number][] = [];
    for (let i = 0; i < this.bandEls.length; i++) {
      const r = this.bandEls[i].getBoundingClientRect();
      const span = Math.max(1, r.height - vh);
      const p = clamp01(-r.top / span);
      if (r.top <= vh * 0.6 && r.bottom >= vh * 0.4) band = (p - 0.5) * 2;
      const rail = this.railEls[i];
      if (rail) {
        const shift = Math.max(0, rail.scrollWidth - window.innerWidth);
        rails.push([rail, -p * shift]);
      }
    }

    const reveal: HTMLElement[] = [];
    for (let i = this.revealEls.length - 1; i >= 0; i--) {
      const el = this.revealEls[i];
      if (el.getBoundingClientRect().top < vh * 0.88) {
        reveal.push(el);
        this.revealEls.splice(i, 1);
      }
    }

    return { act, band, rails, reveal };
  }

  private loop = () => {
    // Parked: no frame queued, nothing drawn. `setPose` restarts the loop.
    if (this.pose === "off") {
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.loop);

    // The auth screens have no acts, bands, rails or ticks to read — their one
    // entrance animation is CSS. Skipping the scroll read there also skips a
    // getBoundingClientRect per frame on elements that are not there, and holds
    // `actT` where the landing page left it so the pile does not jump.
    if (this.pose === "auth") {
      if (!this.T || !this.renderer) return;
      this.authT += (1 - this.authT) * 0.05;
      this.mx += (this.tx - this.mx) * 0.05;
      this.my += (this.ty - this.my) * 0.05;
      this.draw(performance.now() / 1000);
      return;
    }

    const s = this.readScroll();
    if (this.snapAct) {
      this.actT = s.act;
      this.snapAct = false;
    }

    for (const el of s.reveal) {
      el.style.opacity = "1";
      el.style.transform = "none";
    }
    for (const [el, x] of s.rails) {
      el.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    }
    this.markTicks();

    if (!this.T || !this.renderer) {
      this.actT += (s.act - this.actT) * 0.12;
      return;
    }

    this.actT += (s.act - this.actT) * 0.09;
    this.bandT += (s.band - this.bandT) * 0.08;
    this.authT += (0 - this.authT) * 0.05;
    this.mx += (this.tx - this.mx) * 0.05;
    this.my += (this.ty - this.my) * 0.05;
    this.draw(performance.now() / 1000);
  };

  private markTicks() {
    if (!this.tickEls.length) return;
    const current = Math.round(this.actT);
    for (const tick of this.tickEls) {
      const on = Number(tick.dataset.tick) === current;
      tick.dataset.on = on ? "1" : "";
      tick.setAttribute("aria-current", on ? "true" : "false");
    }
  }

  private draw(t: number) {
    if (!this.T || !this.renderer || !this.camera || !this.scene) return;

    const A = Math.max(0, Math.min(ACTS - 1.001, this.actT));
    const i0 = Math.floor(A);
    const i1 = Math.min(ACTS - 1, i0 + 1);
    const e = sm(A - i0);

    for (const sh of this.sheets) {
      const a = sh.P[i0];
      const b = sh.P[i1];
      // Each sheet lags by its own `d`, so the pile reorganises as a wave.
      const ee = sm(clamp01((e - sh.d * 0.35) / 0.65));
      const float = Math.sin(t * 0.5 + sh.ph) * 0.055 * (1 - ee * 0.5);
      sh.g.position.set(
        a.x + (b.x - a.x) * ee,
        a.y + (b.y - a.y) * ee + float,
        a.z + (b.z - a.z) * ee,
      );
      sh.g.rotation.set(
        a.rx + (b.rx - a.rx) * ee,
        a.ry + (b.ry - a.ry) * ee + Math.sin(t * 0.32 + sh.ph) * 0.02 * (1 - ee),
        a.rz + (b.rz - a.rz) * ee,
      );
      sh.g.scale.setScalar(a.s + (b.s - a.s) * ee);

      // Ink fades up through act 1 — the pile becoming readable.
      sh.ink.material.opacity = 0.32 + 0.68 * sm((clamp01((A - 0.7) / 0.95) - sh.d * 0.5) / 0.5);
      // Stamps land through act 2 and lift again by act 4, where the archive
      // is filed and the review state is no longer the point.
      const sv = sm((clamp01((A - 1.6) / 0.95) - sh.d * 0.55) / 0.45);
      sh.st.material.opacity = sv * (A > 4.4 ? Math.max(0, 1 - (A - 4.4) * 1.6) : 1);
      sh.st.scale.setScalar(0.01 + sv * (1.2 - 0.2 * sv));
    }

    const lampOn = Math.max(0, 1 - Math.abs(A - 1.05) * 1.5);
    this.barMat.opacity = lampOn * 0.95;
    this.glowMat.opacity = lampOn * 0.7;
    this.lamp.position.y = Math.sin(t * 0.7) * 0.12;

    const chartOn = Math.max(0, 1 - Math.abs(A - 3) * 1.6);
    this.lineMat.opacity = chartOn * 0.95;
    this.dotMat.opacity = chartOn * 0.9;
    this.shadowMat.opacity = chartOn * 0.75;
    this.poolMat.opacity = 0.12 + 0.34 * Math.max(0, 1 - Math.abs(A - 3) * 0.55);
    this.motes.rotation.y = t * 0.006;

    this.c1.set(MOOD.key[i0]).lerp(this.c2.set(MOOD.key[i1]), e);
    this.keyLight.color.copy(this.c1);
    this.keyLight.intensity = MOOD.ki[i0] + (MOOD.ki[i1] - MOOD.ki[i0]) * e;
    this.c1.set(MOOD.fill[i0]).lerp(this.c2.set(MOOD.fill[i1]), e);
    this.fillLight.color.copy(this.c1);
    this.fillLight.intensity = MOOD.fi[i0] + (MOOD.fi[i1] - MOOD.fi[i0]) * e;
    this.c1.set(MOOD.bg[i0]).lerp(this.c2.set(MOOD.bg[i1]), e);
    this.bgColor.copy(this.c1);
    (this.scene.fog as THREE.FogExp2).color.copy(this.c1);

    // Horizontal bands push the camera sideways, so scrolling a rail of cards
    // and moving through the scene are the same gesture.
    const ka = CAM[i0];
    const kb = CAM[i1];
    const bx = this.bandT * 1.9;
    this.v1.set(
      ka.p[0] + (kb.p[0] - ka.p[0]) * e + bx,
      ka.p[1] + (kb.p[1] - ka.p[1]) * e,
      ka.p[2] + (kb.p[2] - ka.p[2]) * e,
    );
    this.v2.set(
      ka.l[0] + (kb.l[0] - ka.l[0]) * e + bx * 0.45,
      ka.l[1] + (kb.l[1] - ka.l[1]) * e,
      ka.l[2] + (kb.l[2] - ka.l[2]) * e,
    );

    // …and the auth pose pulls it off that path entirely, eased so arriving at
    // /login is a camera move over about a second rather than a jump.
    const bl = sm(this.authT);
    if (bl > 0.001) {
      this.v3.set(AUTH_CAM.p[0], AUTH_CAM.p[1], AUTH_CAM.p[2]);
      this.v4.set(AUTH_CAM.l[0], AUTH_CAM.l[1], AUTH_CAM.l[2]);
      this.v1.lerp(this.v3, bl);
      this.v2.lerp(this.v4, bl);
    }

    this.camera.position.set(
      this.v1.x + this.mx * 0.95,
      this.v1.y - this.my * 0.62,
      this.v1.z + Math.sin(t * 0.19) * 0.16,
    );
    this.camera.lookAt(this.v2.x + this.mx * 0.18, this.v2.y - this.my * 0.1, this.v2.z);
    this.camera.rotation.z = this.mx * 0.008 + Math.sin(t * 0.13) * 0.004;

    this.renderer.render(this.scene, this.camera);
  };
}

export { ACTS };
