import { describe, expect, it } from "vitest";
import { BOARDS, BOARD_VERSION, defaultBoardState } from "./boards";
import { WIDGETS } from "./registry";

describe("BOARDS pool wiring", () => {
  it("every registered widget is offerable on the dashboard board", () => {
    const pool = new Set(BOARDS.dashboard.pool);
    const missing = Object.keys(WIDGETS).filter((t) => !pool.has(t));
    expect(missing).toEqual([]);
  });

  it("every pool entry has a registry definition", () => {
    const unknown = BOARDS.dashboard.pool.filter((t) => !WIDGETS[t]);
    expect(unknown).toEqual([]);
  });

  it("offers the four slice-C widgets", () => {
    const pool = new Set(BOARDS.dashboard.pool);
    for (const t of ["creditCard", "debt", "recurring", "holdings"]) {
      expect(pool.has(t)).toBe(true);
    }
  });

  it("places the four slice-C widgets on the default board", () => {
    const types = new Set(defaultBoardState("dashboard").items.map((i) => i.type));
    for (const t of ["creditCard", "debt", "recurring", "holdings"]) {
      expect(types.has(t)).toBe(true);
    }
  });

  it("default placements fit within the grid and do not overlap", () => {
    const cols = 10;
    const occupied = new Set<string>();
    for (const it of defaultBoardState("dashboard").items) {
      expect(it.x + it.w).toBeLessThanOrEqual(cols);
      for (let dx = 0; dx < it.w; dx++)
        for (let dy = 0; dy < it.h; dy++) {
          const key = `${it.x + dx},${it.y + dy}`;
          expect(occupied.has(key)).toBe(false);
          occupied.add(key);
        }
    }
  });

  it("bumped the board version past 3 so saved boards migrate to the new default", () => {
    expect(BOARD_VERSION).toBeGreaterThan(3);
  });
});
