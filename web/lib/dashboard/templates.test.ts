import { describe, expect, it } from "vitest";
import { TEMPLATES, itemsFromTemplate, getTemplate, type TemplateId } from "./templates";
import { BOARDS } from "./boards";
import { GRID_COLS, collide, type GridItem } from "./grid";

const GOALS = [
  "Understand my money", "Keep it minimal", "Pay off debt",
  "Manage credit cards", "Track spending", "Build net worth",
];

describe("dashboard templates", () => {
  it("defines exactly 6 templates with unique ids", () => {
    expect(TEMPLATES).toHaveLength(6);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(6);
  });

  it("covers each onboarding goal exactly once", () => {
    expect(TEMPLATES.map((t) => t.goal).sort()).toEqual([...GOALS].sort());
  });

  it("only uses widget types offered by the dashboard board pool", () => {
    const pool = new Set(BOARDS.dashboard.pool);
    for (const t of TEMPLATES) {
      for (const item of t.items) {
        expect(pool.has(item.type), `${t.id}:${item.type}`).toBe(true);
      }
    }
  });

  it("places every widget inside the grid with no overlaps", () => {
    for (const t of TEMPLATES) {
      const items = itemsFromTemplate(t);
      for (const it of items) {
        expect(it.x).toBeGreaterThanOrEqual(0);
        expect(it.x + it.w).toBeLessThanOrEqual(GRID_COLS);
        expect(it.h).toBeGreaterThan(0);
      }
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          expect(collide(items[i] as GridItem, items[j] as GridItem)).toBe(false);
        }
      }
    }
  });

  it("builds items with unique fresh ids prefixed by type", () => {
    const t = getTemplate("debt" as TemplateId);
    const items = itemsFromTemplate(t);
    expect(items).toHaveLength(t.items.length);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items[0]?.id.startsWith(items[0]?.type ?? "")).toBe(true);
  });

  it("carries spec config through to built items", () => {
    const cc = getTemplate("creditCard" as TemplateId);
    const built = itemsFromTemplate(cc);
    const breakdown = built.find((i) => i.type === "breakdown");
    expect(breakdown?.config?.dimension).toBe("merchant");
  });
});
