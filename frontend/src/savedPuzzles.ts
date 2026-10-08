import { readConstraints, savedPuzzlesStorageKey, storagePage, type SavedGrid } from './persistedState'
import { CLASSIC_CONSTRAINTS, type SudokuConstraints } from './sudoku/SudokuConstraints'
import {
  CANDIDATE_COLOR_ORDER,
  type CandidateColor,
  type CandidateColorGrid,
  type CandidatePaint,
  type CandidatePaintLayer,
  type CandidatePaintShape,
} from './sudoku/types'

/** Saved Puzzles: any number of named snapshots of the grid, kept in this
 * browser's localStorage (no account, no server - the puzzles themselves
 * never leave the device; only the analytics row describing a save does,
 * see trackSavedPuzzle in usageTracking.ts).
 *
 * A snapshot is everything GridState holds - givens, entered digits, pencil
 * marks, candidate colours and, on the Variant page, the puzzle's
 * constraints - which is everything that makes a position: undo history,
 * the Solve Path and view state are left out for the same reasons
 * persistedState.ts leaves them out, and settings are the user's, not the
 * puzzle's.
 *
 * **Classic and Variant keep separate lists**, twice over: each page writes
 * its own key (persistedState's storage prefix), and every entry is tagged
 * with its page and dropped on read if the tag isn't this page's - so an
 * entry copied into the other key by hand still can't show up there.
 *
 * Same rule as the rest of the saved state: every read is validated entry
 * by entry and a bad one is skipped, never thrown on. Entries written by a
 * *newer* version of this format are kept in storage untouched (not shown,
 * not deleted), so going back a version doesn't cost anyone their saves. */

export type SavedPuzzlePage = 'classic' | 'variant'

export interface SavedPuzzle {
  id: string
  name: string
  page: SavedPuzzlePage
  /** "Classic", "Killer", "Killer Jigsaw", ... (variantName) at save time. */
  kind: string
  /** The rating line under the grid, if it was known when saved. */
  rating: string | null
  createdAt: number
  updatedAt: number
  grid: SavedGrid
}

const FORMAT_VERSION = 1
export const SAVED_PUZZLE_NAME_MAX_LENGTH = 60
/** Far more than anyone needs, and ~0.5 MB of localStorage at the very most. */
export const MAX_SAVED_PUZZLES = 300

const SHAPES: readonly CandidatePaintShape[] = ['circle', 'square', 'diamond']

/** One entry as stored. Compact on purpose (a plain JSON GridState is ~9 KB,
 * this is under 1 KB): digits as 81-char strings, pencil marks as one 9-bit
 * mask per cell (three hex digits), and only the coloured candidates. */
interface StoredPuzzle {
  v: number
  id: string
  name: string
  page: SavedPuzzlePage
  kind: string
  rating: string | null
  createdAt: number
  updatedAt: number
  board: string
  givens: string
  candidates: string
  /** [cell * 9 + digit - 1, [colour, shape], optional second layer] */
  colours: Array<[number, ...Array<[string, string]>]>
  constraints?: SudokuConstraints
}

function encode(puzzle: SavedPuzzle): StoredPuzzle {
  const { grid } = puzzle
  const colours: StoredPuzzle['colours'] = []
  grid.candidateColors.forEach((row, r) =>
    row.forEach((cell, c) =>
      cell.forEach((paint, d) => {
        if (paint) {
          colours.push([(r * 9 + c) * 9 + d, ...paint.map((layer): [string, string] => [layer.color, layer.shape])])
        }
      }),
    ),
  )
  const stored: StoredPuzzle = {
    v: FORMAT_VERSION,
    id: puzzle.id,
    name: puzzle.name,
    page: puzzle.page,
    kind: puzzle.kind,
    rating: puzzle.rating,
    createdAt: puzzle.createdAt,
    updatedAt: puzzle.updatedAt,
    board: grid.board.flat().join(''),
    givens: grid.givens.flat().map((given) => (given ? '1' : '0')).join(''),
    candidates: grid.candidates
      .flat()
      .map((cell) => cell.reduce((mask, on, d) => (on ? mask | (1 << d) : mask), 0).toString(16).padStart(3, '0'))
      .join(''),
    colours,
  }
  if (grid.constraints && grid.constraints !== CLASSIC_CONSTRAINTS) {
    stored.constraints = grid.constraints
  }
  return stored
}

function decodePaint(layers: unknown[]): CandidatePaint | null {
  const out: CandidatePaintLayer[] = []
  for (const layer of layers) {
    if (!Array.isArray(layer) || layer.length !== 2) {
      return null
    }
    const [color, shape] = layer as unknown[]
    if (!CANDIDATE_COLOR_ORDER.includes(color as CandidateColor) || !SHAPES.includes(shape as CandidatePaintShape)) {
      return null
    }
    out.push({ color: color as CandidateColor, shape: shape as CandidatePaintShape })
  }
  return out.length === 1 ? [out[0]] : out.length === 2 ? [out[0], out[1]] : null
}

/** The entry, or null if it isn't a well-formed one for `page`. A colour
 * that can't be read is dropped on its own; anything wrong with the digits,
 * marks or (Variant) constraints rejects the entry - half a puzzle is worse
 * than none. */
function decode(value: unknown, page: SavedPuzzlePage): SavedPuzzle | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const s = value as Record<string, unknown>
  if (
    s.v !== FORMAT_VERSION ||
    s.page !== page ||
    typeof s.id !== 'string' ||
    !/^[A-Za-z0-9-]{8,64}$/.test(s.id) ||
    typeof s.name !== 'string' ||
    s.name.trim() === '' ||
    typeof s.board !== 'string' ||
    !/^[0-9]{81}$/.test(s.board) ||
    typeof s.givens !== 'string' ||
    !/^[01]{81}$/.test(s.givens) ||
    typeof s.candidates !== 'string' ||
    !/^[01][0-9a-f]{2}(?:[01][0-9a-f]{2}){80}$/.test(s.candidates)
  ) {
    return null
  }
  const boardText = s.board
  const givensText = s.givens
  const candidatesText = s.candidates
  const cells = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c))
  const board = cells.map((row) => row.map((i) => Number(boardText[i])))
  const givens = cells.map((row) => row.map((i) => givensText[i] === '1'))
  // A given is a digit on the board; a mask that says otherwise is corrupt.
  if (givens.some((row, r) => row.some((given, c) => given && board[r][c] === 0))) {
    return null
  }
  const candidates = cells.map((row) =>
    row.map((i) => {
      const mask = parseInt(candidatesText.slice(i * 3, i * 3 + 3), 16)
      return Array.from({ length: 9 }, (_, d) => (mask & (1 << d)) !== 0)
    }),
  )
  const candidateColors: CandidateColorGrid = cells.map((row) => row.map(() => Array.from({ length: 9 }, () => null)))
  if (Array.isArray(s.colours)) {
    for (const entry of s.colours as unknown[]) {
      if (!Array.isArray(entry) || !Number.isInteger(entry[0]) || entry[0] < 0 || entry[0] >= 729) {
        continue
      }
      const index = entry[0] as number
      const paint = decodePaint(entry.slice(1))
      if (paint) {
        candidateColors[Math.floor(index / 81)][Math.floor(index / 9) % 9][index % 9] = paint
      }
    }
  }
  let constraints: SudokuConstraints | undefined
  if (s.constraints !== undefined) {
    // The Classic page has no constraints to restore; on the Variant page a
    // layout that no longer validates means the puzzle can't be restored.
    constraints = page === 'variant' ? readConstraints(s.constraints) : undefined
    if (page === 'variant' && !constraints) {
      return null
    }
  }
  const time = (t: unknown) => (typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : 0)
  return {
    id: s.id,
    name: s.name.trim().slice(0, SAVED_PUZZLE_NAME_MAX_LENGTH),
    page,
    kind: typeof s.kind === 'string' && s.kind ? s.kind.slice(0, 60) : page === 'classic' ? 'Classic' : 'Variant',
    rating: typeof s.rating === 'string' && s.rating ? s.rating.slice(0, 80) : null,
    createdAt: time(s.createdAt) || time(s.updatedAt),
    updatedAt: time(s.updatedAt) || time(s.createdAt),
    grid: { board, givens, candidates, candidateColors, constraints },
  }
}

interface Stored {
  puzzles: SavedPuzzle[]
  /** Raw entries from a newer format version: written back as they are. */
  newer: unknown[]
}

function readStored(): Stored {
  const page = storagePage()
  let raw: unknown = null
  try {
    const text = localStorage.getItem(savedPuzzlesStorageKey())
    raw = text ? (JSON.parse(text) as unknown) : null
  } catch {
    raw = null
  }
  const puzzles: SavedPuzzle[] = []
  const newer: unknown[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const puzzle = decode(entry, page)
      if (puzzle) {
        if (!seen.has(puzzle.id)) {
          seen.add(puzzle.id)
          puzzles.push(puzzle)
        }
      } else if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { v?: unknown }).v === 'number' &&
        (entry as { v: number }).v > FORMAT_VERSION
      ) {
        newer.push(entry)
      }
    }
  }
  puzzles.sort((a, b) => b.updatedAt - a.updatedAt)
  return { puzzles, newer }
}

/** False when the browser wouldn't take it (storage full, or blocked as in
 * some private windows) - unlike the autosaved grid, a Save the user asked
 * for must not fail silently. */
function writeStored(stored: Stored): boolean {
  try {
    localStorage.setItem(savedPuzzlesStorageKey(), JSON.stringify([...stored.puzzles.map(encode), ...stored.newer]))
    return true
  } catch {
    return false
  }
}

/** This page's saved puzzles, most recently saved first. */
export function loadSavedPuzzles(): SavedPuzzle[] {
  return readStored().puzzles
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  }
}

export type SavePuzzleResult =
  | { ok: true; puzzle: SavedPuzzle; replaced: boolean; puzzles: SavedPuzzle[] }
  | { ok: false; reason: 'storage' | 'limit'; puzzles: SavedPuzzle[] }

/** Saves `grid` under `name`: over the entry `replaceId` (keeping its id and
 * creation time) when given and still there, else as a new entry. The list
 * is re-read first, so a save made in another tab meanwhile isn't lost. */
export function savePuzzle(input: {
  name: string
  kind: string
  rating: string | null
  grid: SavedGrid
  replaceId?: string | null
}): SavePuzzleResult {
  const stored = readStored()
  const now = Date.now()
  const existing = input.replaceId ? stored.puzzles.find((puzzle) => puzzle.id === input.replaceId) : undefined
  if (!existing && stored.puzzles.length >= MAX_SAVED_PUZZLES) {
    return { ok: false, reason: 'limit', puzzles: stored.puzzles }
  }
  const puzzle: SavedPuzzle = {
    id: existing?.id ?? newId(),
    name: input.name.trim().slice(0, SAVED_PUZZLE_NAME_MAX_LENGTH) || 'Untitled puzzle',
    page: storagePage(),
    kind: input.kind,
    rating: input.rating,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    grid: input.grid,
  }
  const puzzles = [puzzle, ...stored.puzzles.filter((other) => other.id !== puzzle.id)]
  if (!writeStored({ puzzles, newer: stored.newer })) {
    return { ok: false, reason: 'storage', puzzles: stored.puzzles }
  }
  return { ok: true, puzzle, replaced: !!existing, puzzles }
}

/** Removes one entry for good. Returns the list as it now stands, and
 * whether storage took the change. */
export function deleteSavedPuzzle(id: string): { ok: boolean; puzzles: SavedPuzzle[] } {
  const stored = readStored()
  const puzzles = stored.puzzles.filter((puzzle) => puzzle.id !== id)
  if (puzzles.length === stored.puzzles.length) {
    return { ok: true, puzzles }
  }
  return writeStored({ puzzles, newer: stored.newer }) ? { ok: true, puzzles } : { ok: false, puzzles: stored.puzzles }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The entry already using `name` (compared without case), if any. */
export function savedPuzzleNamed(puzzles: readonly SavedPuzzle[], name: string): SavedPuzzle | undefined {
  return puzzles.find((puzzle) => sameName(puzzle.name, name))
}

/** `name`, or `name (2)`, `name (3)`... - the first one no entry uses. */
export function unusedSavedPuzzleName(puzzles: readonly SavedPuzzle[], name: string): string {
  const base = name.trim().replace(/ \(\d+\)$/, '') || 'Untitled puzzle'
  if (!savedPuzzleNamed(puzzles, name)) {
    return name.trim()
  }
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`
    const candidate = base.slice(0, SAVED_PUZZLE_NAME_MAX_LENGTH - suffix.length) + suffix
    if (!savedPuzzleNamed(puzzles, candidate)) {
      return candidate
    }
  }
}

/** The puzzle a grid is a position of: its givens and its constraints. Null
 * for a grid with neither (digits typed in and not locked), which is
 * nobody's puzzle in particular - a Killer with no given digits at all is
 * one, told apart by its cages. */
function puzzleIdentity(grid: SavedGrid): string | null {
  let any = false
  const givens = grid.board
    .flatMap((row, r) =>
      row.map((value, c) => {
        any ||= grid.givens[r][c]
        return grid.givens[r][c] ? value : 0
      }),
    )
    .join('')
  // Spelled out field by field: the live constraints and ones read back from
  // storage needn't have their keys in the same order, or the same absent /
  // false flags.
  const k = grid.constraints
  const constraints =
    k && k !== CLASSIC_CONSTRAINTS
      ? [
          k.regions ? k.regions.flat().join('') : '',
          k.cages.map((cage) => `${cage.sum}:${cage.cells.map((cell) => cell.join('')).join(',')}`).join(';'),
          `${k.diagonals ? 1 : 0}${k.antiKnight ? 1 : 0}${k.entropy ? 1 : 0}`,
        ].join('/')
      : ''
  return any || constraints !== '' ? `${givens}|${constraints}` : null
}

/** The most recent save of the puzzle now on the grid, if there is one - the
 * entry a plain "Save" updates, so saving your progress again and again
 * doesn't pile up copies. */
export function savedPuzzleOfGrid(puzzles: readonly SavedPuzzle[], grid: SavedGrid): SavedPuzzle | undefined {
  const identity = puzzleIdentity(grid)
  return identity === null ? undefined : puzzles.find((puzzle) => puzzleIdentity(puzzle.grid) === identity)
}

/** How many cells hold a digit. */
export function filledCellCount(grid: SavedGrid): number {
  return grid.board.reduce((sum, row) => sum + row.filter((value) => value !== 0).length, 0)
}
