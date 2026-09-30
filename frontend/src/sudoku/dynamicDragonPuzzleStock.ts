import { computeGivenMask, createEmptyCandidates } from './boardUtils'
import {
  SudokuDragonPuzzleGenerator,
  type DragonPuzzleGenerateOptions,
  type GeneratedDragonPuzzle,
} from './SudokuDragonPuzzleGenerator'
import { BOARD_SIZE, SudokuRules } from './SudokuRules'
import type { Board } from './types'
import { DOUBLE_DRAGON_PUZZLE_STOCK } from './doubleDragonPuzzleStockData'
import { DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK } from './doubleDynamicDragonPuzzleStockData'
import { PuzzleImporter } from './PuzzleImporter'
import { DYNAMIC_DRAGON_PUZZLE_STOCK } from './dynamicDragonPuzzleStockData'

/** Random symmetry transforms tried (each re-verified) before falling back
 * to the untransformed stock position. */
const TRANSFORM_ATTEMPTS = 3

const generator = new SudokuDragonPuzzleGenerator()
/** Shuffle-bags of stock indices, one per stock, so every position is served
 * once before any repeats within a session. */
const bags = new Map<readonly string[], number[]>()

/**
 * Serves a "Dynamic Dragon puzzle that must not allow plain Dragon"
 * (`forbidPlainDragon`) from the pre-generated stock in
 * dynamicDragonPuzzleStockData.ts, instead of searching live - such
 * positions take ~3 minutes of 14-worker search each (see
 * DRAGON_COLOURING_HANDOFF.md's "Parallel generation"), far past any
 * sensible button-press wait.
 *
 * Every stock entry was generated with every AIC kind *not* disregarded
 * (the strictest setting) and independently re-verified, so it satisfies
 * any combination of the "Dragon Generation disregards" settings: those
 * only ever relax the check.
 *
 * For variety each pick gets a random Sudoku symmetry (digit relabelling,
 * band/stack and row/column-within-band shuffles, optional transpose). The
 * techniques themselves are symmetric under these, but Dragon's search
 * order (which side extends first, scan order) is not obviously so - so
 * rather than assume the property survives, each transformed position is
 * re-checked with the generator's own `checkPuzzleState`, falling back to
 * the untransformed original if TRANSFORM_ATTEMPTS transforms all fail.
 */
export function pickStockDynamicDragonPuzzle(options: DragonPuzzleGenerateOptions): GeneratedDragonPuzzle | null {
  // The Double Dragon stock's positions need Dynamic Dragon too, and plain
  // Dragon is stuck on them - so they count unless Double Dragon is forbidden.
  return pickFromStock(options.forbidDoubleDragon ? DYNAMIC_DRAGON_PUZZLE_STOCK : DYNAMIC_OR_DOUBLE_STOCK, {
    ...options,
    requireDynamic: true,
    forbidPlainDragon: true,
  })
}

const DYNAMIC_OR_DOUBLE_STOCK: readonly string[] = [...DYNAMIC_DRAGON_PUZZLE_STOCK, ...DOUBLE_DRAGON_PUZZLE_STOCK]

/** The "Double Dragon Colouring practice puzzle": plain Dragon stuck on
 * every chain, Double Dragon progresses (`requireDoubleDragon`). Rarer still
 * than the Dynamic stock's positions (they are a subset of that kind), so
 * served the same way, from doubleDragonPuzzleStockData.ts. */
export function pickStockDoubleDragonPuzzle(options: DragonPuzzleGenerateOptions): GeneratedDragonPuzzle | null {
  return pickFromStock(DOUBLE_DRAGON_PUZZLE_STOCK, {
    ...options,
    requireDynamic: false,
    forbidPlainDragon: false,
    requireDoubleDragon: true,
  })
}

/** Serves the next stock entry that checks out under `checkOptions` (a
 * random symmetry of it, or failing that the entry itself). An entry that
 * no longer qualifies at all - e.g. a Dynamic entry a Double Dragon also
 * solves, under "must not allow double Dragons" - is skipped for the next.
 * If none qualifies, the first one tried is served unchecked, as before. */
/** The "Double Dynamic Dragon Colouring practice puzzle": a mid-solve
 * position where nothing else the app has progresses - not even Dynamic
 * Dragon or Double Dragon with every technique and no limits - but Double
 * Dynamic Dragon does. Stored as whole Sudoku.Coach states (the other
 * techniques' eliminations are part of the position, so a fresh autofill
 * would not do) and served as they are: re-checking a transformed copy would
 * mean the full unlimited search, seconds per pick. See
 * doubleDynamicDragonPuzzleStockData.ts. */
let doubleDynamicBag: number[] = []
export async function pickStockDoubleDynamicDragonPuzzle(): Promise<GeneratedDragonPuzzle | null> {
  if (DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK.length === 0) {
    return null
  }
  if (doubleDynamicBag.length === 0) {
    doubleDynamicBag = shuffled(DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK.map((_, index) => index))
  }
  const imported = await new PuzzleImporter().import(DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK[doubleDynamicBag.pop()!])
  return imported.ok ? { board: imported.board, givens: imported.givens, candidates: imported.candidates } : null
}

function pickFromStock(stock: readonly string[], checkOptions: DragonPuzzleGenerateOptions): GeneratedDragonPuzzle | null {
  if (stock.length === 0) {
    return null
  }
  let firstTried: Board | null = null
  for (let tries = 0; tries < stock.length; tries++) {
    let bag = bags.get(stock)
    if (!bag || bag.length === 0) {
      bag = shuffled(stock.map((_, index) => index))
      bags.set(stock, bag)
    }
    const original = parseBoard(stock[bag.pop()!])
    firstTried ??= original

    for (let attempt = 0; attempt < TRANSFORM_ATTEMPTS; attempt++) {
      const verified = generator.checkPuzzleState(randomSymmetry(original), checkOptions)
      if (verified) {
        return verified
      }
    }
    const verified = generator.checkPuzzleState(original, checkOptions)
    if (verified) {
      return verified
    }
  }
  return withAutofilledCandidates(firstTried!)
}

function withAutofilledCandidates(board: Board): GeneratedDragonPuzzle {
  const candidates = createEmptyCandidates()
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) {
        candidates[r][c] = Array.from({ length: 9 }, (_, d) => SudokuRules.isSafe(board, r, c, d + 1))
      }
    }
  }
  return { board, givens: computeGivenMask(board), candidates }
}

function parseBoard(text: string): Board {
  return Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (_, c) => Number(text[r * BOARD_SIZE + c])),
  )
}

/** A uniformly random member of the Sudoku symmetry group (occasionally
 * the identity, which is harmless). */
function randomSymmetry(board: Board): Board {
  const lineOrder = () => shuffled([0, 1, 2]).flatMap((band) => shuffled([0, 1, 2]).map((line) => band * 3 + line))
  const rows = lineOrder()
  const cols = lineOrder()
  const digits = [0, ...shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9])]
  const transpose = Math.random() < 0.5
  return Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (_, c) => {
      const value = transpose ? board[cols[c]][rows[r]] : board[rows[r]][cols[c]]
      return digits[value]
    }),
  )
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
