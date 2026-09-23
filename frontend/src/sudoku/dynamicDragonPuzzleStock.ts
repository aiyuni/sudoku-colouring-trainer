import { computeGivenMask, createEmptyCandidates } from './boardUtils'
import {
  SudokuDragonPuzzleGenerator,
  type DragonPuzzleGenerateOptions,
  type GeneratedDragonPuzzle,
} from './SudokuDragonPuzzleGenerator'
import { BOARD_SIZE, SudokuRules } from './SudokuRules'
import type { Board } from './types'
import { DYNAMIC_DRAGON_PUZZLE_STOCK } from './dynamicDragonPuzzleStockData'

/** Random symmetry transforms tried (each re-verified) before falling back
 * to the untransformed stock position. */
const TRANSFORM_ATTEMPTS = 3

const generator = new SudokuDragonPuzzleGenerator()
/** Shuffle-bag of stock indices, so every position is served once before
 * any repeats within a session. */
let bag: number[] = []

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
  if (DYNAMIC_DRAGON_PUZZLE_STOCK.length === 0) {
    return null
  }
  if (bag.length === 0) {
    bag = shuffled(DYNAMIC_DRAGON_PUZZLE_STOCK.map((_, index) => index))
  }
  const original = parseBoard(DYNAMIC_DRAGON_PUZZLE_STOCK[bag.pop()!])
  const checkOptions: DragonPuzzleGenerateOptions = { ...options, requireDynamic: true, forbidPlainDragon: true }

  for (let attempt = 0; attempt < TRANSFORM_ATTEMPTS; attempt++) {
    const verified = generator.checkPuzzleState(randomSymmetry(original), checkOptions)
    if (verified) {
      return verified
    }
  }
  return generator.checkPuzzleState(original, checkOptions) ?? withAutofilledCandidates(original)
}

/** Only reached if the original somehow fails its own re-check (it passed
 * offline under stricter settings) - still hand back the position rather
 * than nothing. */
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
