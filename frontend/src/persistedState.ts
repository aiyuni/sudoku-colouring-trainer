import { ALL_RULE3_TECHNIQUES } from './sudoku/SudokuDragonFinder'
import { readHotkeyBindings } from './hotkeys'
import type { Board, CandidateColorGrid, CandidateGrid } from './sudoku/types'
import {
  DEFAULT_SETTINGS,
  DRAGON_GENERATION_TIMEOUT_OPTIONS,
  MAX_TECHNIQUES_PER_DRAGON_STEP_OPTIONS,
  SOLVE_PATH_TIMEOUT_OPTIONS,
  type AppSettings,
} from './settingsDefaults'

/** Restores the page as the user left it after closing the tab or browser:
 * the current puzzle (board, givens, pencil marks, candidate paint) and
 * every setting in AppSettings. The swatch colours/shapes have their own
 * keys in App.tsx and predate this.
 *
 * Deliberately not saved: undo history (each entry can carry a whole Solve
 * Path, far too big for localStorage, and a history that silently starts
 * mid-way would be more confusing than a fresh one), the Solve Path itself,
 * and view state like the selected technique.
 *
 * Every read is validated and falls back to the defaults - corrupt or
 * inaccessible storage (private browsing, a hand-edited value, a save from
 * an older version whose shape has since changed) must never break the
 * page, same rule as loadCustomSwatchColors. */

const SETTINGS_STORAGE_KEY = 'sudoku-solver-settings'
const GRID_STORAGE_KEY = 'sudoku-solver-grid'

export interface SavedGrid {
  board: Board
  givens: boolean[][]
  candidates: CandidateGrid
  candidateColors: CandidateColorGrid
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage inaccessible or full - everything still works for this
    // session, it just won't be restored next time.
  }
}

/** One saved value, or undefined if it isn't a value that setting can
 * take. Numbers are checked against their dropdown's own options, so a
 * removed option falls back to the default rather than showing a select
 * with nothing chosen. */
function readSetting<K extends keyof AppSettings>(key: K, value: unknown): AppSettings[K] | undefined {
  const fallback = DEFAULT_SETTINGS[key]
  let result: unknown
  switch (key) {
    case 'keyboardMode':
      result = value === 'solution' || value === 'candidate' ? value : undefined
      break
    case 'allowedRule3Techniques':
      result = Array.isArray(value)
        ? // 'BUG+1' is the old name of 'BUG+N' (BUG+1/2/3, one technique).
          ALL_RULE3_TECHNIQUES.filter((technique) => value.includes(technique) || (technique === 'BUG+N' && value.includes('BUG+1')))
        : undefined
      break
    case 'maxTechniquesPerDragonStep': {
      // JSON has no Infinity (stringify turns it into null), which is how
      // "no limit" is stored.
      const limit = value === null ? Infinity : value
      result = MAX_TECHNIQUES_PER_DRAGON_STEP_OPTIONS.includes(limit as number) ? limit : undefined
      break
    }
    case 'dragonGenerationTimeoutMs':
      result = DRAGON_GENERATION_TIMEOUT_OPTIONS.some((option) => option.ms === value) ? value : undefined
      break
    case 'solvePathTimeoutMs':
      result = SOLVE_PATH_TIMEOUT_OPTIONS.some((option) => option.ms === value) ? value : undefined
      break
    case 'hotkeys':
      result = readHotkeyBindings(value)
      break
    default:
      result = typeof value === typeof fallback ? value : undefined
  }
  return result as AppSettings[K] | undefined
}

/** DEFAULT_SETTINGS, overlaid with every valid saved value. A setting added
 * since the save simply takes its default. */
export function loadSavedSettings(): AppSettings {
  const settings: AppSettings = { ...DEFAULT_SETTINGS }
  const saved = readJson(SETTINGS_STORAGE_KEY)
  if (!saved || typeof saved !== 'object') {
    return settings
  }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const value = readSetting(key, (saved as Record<string, unknown>)[key])
    if (value !== undefined) {
      ;(settings as unknown as Record<string, unknown>)[key] = value
    }
  }
  return settings
}

export function saveSettings(settings: AppSettings): void {
  writeJson(SETTINGS_STORAGE_KEY, settings)
}

function isGrid<T>(value: unknown, isCell: (cell: unknown) => cell is T): value is T[][] {
  return (
    Array.isArray(value) &&
    value.length === 9 &&
    value.every((row) => Array.isArray(row) && row.length === 9 && row.every(isCell))
  )
}

const isDigit = (cell: unknown): cell is number => Number.isInteger(cell) && (cell as number) >= 0 && (cell as number) <= 9
const isBoolean = (cell: unknown): cell is boolean => typeof cell === 'boolean'
const isCandidateCell = (cell: unknown): cell is boolean[] =>
  Array.isArray(cell) && cell.length === 9 && cell.every(isBoolean)

/** Paint is a 1-2 layer array of {color, shape} or null. The colour/shape
 * names aren't re-checked here: an unknown one just renders unpainted. */
const isPaintCell = (cell: unknown): cell is CandidateColorGrid[number][number] =>
  Array.isArray(cell) &&
  cell.length === 9 &&
  cell.every(
    (paint) =>
      paint === null ||
      (Array.isArray(paint) &&
        (paint.length === 1 || paint.length === 2) &&
        paint.every(
          (layer) =>
            layer !== null &&
            typeof layer === 'object' &&
            typeof (layer as Record<string, unknown>).color === 'string' &&
            typeof (layer as Record<string, unknown>).shape === 'string',
        )),
  )

/** The puzzle as it was left, or null if nothing (valid) was saved. */
export function loadSavedGrid(): SavedGrid | null {
  const saved = readJson(GRID_STORAGE_KEY)
  if (!saved || typeof saved !== 'object') {
    return null
  }
  const { board, givens, candidates, candidateColors } = saved as Record<string, unknown>
  if (
    !isGrid(board, isDigit) ||
    !isGrid(givens, isBoolean) ||
    !isGrid(candidates, isCandidateCell) ||
    !isGrid(candidateColors, isPaintCell)
  ) {
    return null
  }
  return { board, givens, candidates, candidateColors }
}

export function saveGrid(grid: SavedGrid): void {
  writeJson(GRID_STORAGE_KEY, grid)
}
