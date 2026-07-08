import { BOARD_VERSION, DEFAULT_PREFS, deriveDensityMode, type BoardState, defaultBoardState } from "./boards";
import { GRID_COLS, type GridItem } from "./grid";

export const STORAGE_PREFIX = "cf-board:";

export function loadBoard(boardId: string): BoardState {
  if (typeof localStorage === "undefined") return defaultBoardState(boardId);
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + boardId);
    if (!raw) return defaultBoardState(boardId);
    const parsed = JSON.parse(raw) as BoardState;
    if (parsed.version === 2 && Array.isArray(parsed.items)) {
      const migrated = migrateV2Board(parsed);
      saveBoard(boardId, migrated);
      return migrated;
    }
    if (parsed.version !== BOARD_VERSION || !Array.isArray(parsed.items)) {
      return defaultBoardState(boardId);
    }
    // Non-destructive: fill any prefs added since this board was saved (e.g. range).
    const savedPrefs = (parsed.prefs ?? {}) as Partial<BoardState["prefs"]>;
    const prefs = { ...DEFAULT_PREFS, ...savedPrefs };
    if (savedPrefs.densityMode === undefined && savedPrefs.density) {
      prefs.densityMode = deriveDensityMode(savedPrefs.density);
    }
    return { ...parsed, prefs };
  } catch {
    return defaultBoardState(boardId);
  }
}

export function saveBoard(boardId: string, state: BoardState): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_PREFIX + boardId, JSON.stringify(state));
}

export function resetBoard(boardId: string): BoardState {
  const fresh = defaultBoardState(boardId);
  saveBoard(boardId, fresh);
  return fresh;
}

function migrateV2Board(state: BoardState): BoardState {
  const legacyCols = 4;
  const scale = GRID_COLS / legacyCols;
  const items = state.items.map((item) => migrateV2Item(item, scale));
  return {
    version: BOARD_VERSION,
    items,
    prefs: { ...DEFAULT_PREFS, ...(state.prefs ?? {}) },
  };
}

function migrateV2Item(item: GridItem, scale: number): GridItem {
  const x = clamp(Math.round(item.x * scale), 0, GRID_COLS - 1);
  const right = clamp(Math.round((item.x + item.w) * scale), x + 1, GRID_COLS);
  return {
    ...item,
    x,
    y: Math.max(0, item.y),
    w: Math.max(1, right - x),
    h: Math.max(1, item.h),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
