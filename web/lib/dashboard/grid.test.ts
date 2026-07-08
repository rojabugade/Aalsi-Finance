import { describe, it, expect } from "vitest";
import {
  collide,
  compact,
  packAround,
  moveTo,
  resizeTo,
  firstFreeRow,
  GRID_COLS,
  type GridItem,
} from "./grid";

const item = (id: string, x: number, y: number, w = 1, h = 1): GridItem =>
  ({ id, type: "netWorth", x, y, w, h });

describe("collide", () => {
  it("returns false for the same item", () => {
    expect(collide(item("a", 0, 0, 2, 2), item("a", 0, 0, 2, 2))).toBe(false);
  });
  it("detects overlap", () => {
    expect(collide(item("a", 0, 0, 2, 2), item("b", 1, 1, 2, 2))).toBe(true);
  });
  it("treats edge-adjacent as non-overlapping", () => {
    expect(collide(item("a", 0, 0, 2, 1), item("b", 2, 0, 2, 1))).toBe(false);
    expect(collide(item("a", 0, 0, 1, 2), item("b", 0, 2, 1, 2))).toBe(false);
  });
});

describe("compact", () => {
  it("pulls items up to remove vertical gaps", () => {
    const items: GridItem[] = [
      { id: "a", type: "x", x: 0, y: 0, w: 2, h: 1 },
      { id: "b", type: "x", x: 0, y: 5, w: 2, h: 1 }, // floating below a gap
    ];
    compact(items);
    expect(items.find((i) => i.id === "b")!.y).toBe(1);
  });
  it("stacks same-column items without overlap", () => {
    const items: GridItem[] = [
      { id: "a", type: "x", x: 0, y: 3, w: 1, h: 2 },
      { id: "b", type: "x", x: 0, y: 9, w: 1, h: 1 },
    ];
    compact(items);
    expect(items.find((i) => i.id === "a")!.y).toBe(0);
    expect(items.find((i) => i.id === "b")!.y).toBe(2);
  });
  it("leaves a full column packed from the top", () => {
    const items: GridItem[] = [
      { id: "a", type: "x", x: 0, y: 0, w: 1, h: 1 },
      { id: "b", type: "x", x: 1, y: 0, w: 1, h: 1 },
    ];
    compact(items);
    expect(items.map((i) => i.y)).toEqual([0, 0]);
  });
});

describe("packAround", () => {
  it("keeps the moving item pinned and packs others with no gaps or overlap", () => {
    const items: GridItem[] = [
      { id: "a", type: "x", x: 0, y: 0, w: 2, h: 1 },
      { id: "b", type: "x", x: 0, y: 1, w: 2, h: 1 },
    ];
    // pin "a" at b's old spot; b gravity-packs up into the row a vacated.
    packAround(items, "a", 0, 1, 2, 1);
    const a = items.find((i) => i.id === "a")!;
    const b = items.find((i) => i.id === "b")!;
    expect(a).toMatchObject({ x: 0, y: 1 }); // moving item stays where dropped
    expect(b.y).toBe(0); // fills the vacated top row — no empty space
    expect(collide(a, b)).toBe(false); // never overlap
  });
  it("cascades a same-column item below the pinned one when it cannot float past", () => {
    const items: GridItem[] = [
      { id: "a", type: "x", x: 0, y: 0, w: 1, h: 1 },
      { id: "b", type: "x", x: 0, y: 1, w: 1, h: 1 },
      { id: "c", type: "x", x: 0, y: 2, w: 1, h: 1 },
    ];
    // pin "a" at row 1; b takes the free top row, c packs below the pinned a.
    packAround(items, "a", 0, 1, 1, 1);
    const by = (id: string) => items.find((i) => i.id === id)!.y;
    expect(by("a")).toBe(1);
    expect(by("b")).toBe(0);
    expect(by("c")).toBe(2);
  });
});

describe("moveTo / resizeTo", () => {
  it("moveTo clamps x within the grid and compacts", () => {
    const items: GridItem[] = [{ id: "a", type: "x", x: 0, y: 0, w: 2, h: 1 }];
    moveTo(items, "a", GRID_COLS + 5, 4, GRID_COLS);
    const a = items.find((i) => i.id === "a")!;
    expect(a.x).toBe(GRID_COLS - 2);
    expect(a.y).toBe(0); // compacted to top
  });
  it("resizeTo clamps to grid width and min 1", () => {
    const items: GridItem[] = [{ id: "a", type: "x", x: 2, y: 0, w: 1, h: 1 }];
    resizeTo(items, "a", 9, 0, GRID_COLS);
    const a = items.find((i) => i.id === "a")!;
    expect(a.w).toBe(GRID_COLS - 2); // can't exceed remaining columns
    expect(a.h).toBe(1);
  });
});

describe("firstFreeRow", () => {
  it("returns the row below the lowest item", () => {
    const items: GridItem[] = [{ id: "a", type: "x", x: 0, y: 0, w: 2, h: 2 }];
    expect(firstFreeRow(items)).toBe(2);
  });
  it("returns 0 for an empty board", () => {
    expect(firstFreeRow([])).toBe(0);
  });
});
