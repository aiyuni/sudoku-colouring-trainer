import type { Board, CandidateGrid } from '../sudoku/types'
import {
  easiestFirstSolveReachesTarget,
  practiceStartState,
  practiceStateNeedsTarget,
  type PracticePuzzleState,
} from './practicePuzzleGenerator'
import { PRACTICE_PUZZLE_STOCK } from './practicePuzzleStockData'
import { practiceTargetById, type PracticeSolverSettings } from './practiceTargets'

/**
 * Pre-generated positions for the practice targets that are too rare to
 * find live in a few seconds - the techniques ranked above Dragon Colouring
 * (a position where plain Dragon is stuck on every chain is rare in itself)
 * and a couple of rare Unique / Avoidable Rectangle types. Mined by
 * dragon-research/practice/mine-stock.ts with every optional technique on,
 * the strictest hierarchy there is, so an entry also holds with fewer
 * techniques on; it is re-checked under the user's own Technique Selections
 * every time it is served all the same (Double Dragon Colouring, off while
 * mining, can make one stop qualifying; a finder may change).
 *
 * A stock entry is served under a random symmetry of the grid (digits
 * renamed, rows and columns shuffled inside their bands, bands shuffled, the
 * grid transposed), so a few dozen positions don't look like the same few
 * dozen puzzles. Every one of these keeps what a technique's logic rests on
 * (rows, columns and boxes stay rows, columns and boxes); the re-check runs on
 * the transformed grid, and the entry is served as stored if that fails.
 */

const BASE32 = '0123456789abcdefghijklmnopqrstuv'

/** board (81 digits) | givens (81 x 0/1) | candidates (81 x two base-32
 * characters, a 9-bit mask with bit d-1 for digit d). */
export function encodePracticeState(state: PracticePuzzleState): string {
  const board = state.board.flat().join('')
  const givens = state.givens.flat().map((given) => (given ? '1' : '0')).join('')
  const candidates = state.candidates
    .flat()
    .map((marks) => {
      const mask = marks.reduce((bits, on, index) => (on ? bits | (1 << index) : bits), 0)
      return BASE32[mask >> 5] + BASE32[mask & 31]
    })
    .join('')
  return `${board}|${givens}|${candidates}`
}

/** Null for anything that isn't a well-formed entry: wrong lengths or
 * characters, a given without a digit, marks in a filled cell. */
export function decodePracticeState(text: string): PracticePuzzleState | null {
  const parts = text.split('|')
  if (parts.length !== 3 || !/^[0-9]{81}$/.test(parts[0]) || !/^[01]{81}$/.test(parts[1]) || !/^[0-9a-v]{162}$/.test(parts[2])) {
    return null
  }
  const board: Board = []
  const givens: boolean[][] = []
  const candidates: CandidateGrid = []
  for (let r = 0; r < 9; r++) {
    board.push([])
    givens.push([])
    candidates.push([])
    for (let c = 0; c < 9; c++) {
      const i = r * 9 + c
      const value = Number(parts[0][i])
      const given = parts[1][i] === '1'
      const mask = BASE32.indexOf(parts[2][i * 2]) * 32 + BASE32.indexOf(parts[2][i * 2 + 1])
      if (mask > 511 || (given && value === 0) || (value !== 0 && mask !== 0)) {
        return null
      }
      board[r].push(value)
      givens[r].push(given)
      candidates[r].push(Array.from({ length: 9 }, (_, d) => (mask & (1 << d)) !== 0))
    }
  }
  return { board, givens, candidates }
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** A random order of the nine lines that keeps bands together: the three
 * bands shuffled, and the three lines inside each. */
function lineOrder(random: () => number): number[] {
  return shuffled([0, 1, 2], random).flatMap((band) => shuffled([0, 1, 2], random).map((line) => band * 3 + line))
}

/** `state` under a random Sudoku symmetry (see the file comment). */
export function transformPracticeState(state: PracticePuzzleState, random: () => number = Math.random): PracticePuzzleState {
  const rows = lineOrder(random)
  const cols = lineOrder(random)
  const transpose = random() < 0.5
  // digitOf[d] = what digit d becomes.
  const digitOf = [0, ...shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], random)]
  const board: Board = []
  const givens: boolean[][] = []
  const candidates: CandidateGrid = []
  for (let r = 0; r < 9; r++) {
    board.push([])
    givens.push([])
    candidates.push([])
    for (let c = 0; c < 9; c++) {
      const sourceRow = transpose ? cols[c] : rows[r]
      const sourceCol = transpose ? rows[r] : cols[c]
      board[r].push(digitOf[state.board[sourceRow][sourceCol]])
      givens[r].push(state.givens[sourceRow][sourceCol])
      const marks = Array<boolean>(9).fill(false)
      state.candidates[sourceRow][sourceCol].forEach((on, index) => {
        if (on) {
          marks[digitOf[index + 1] - 1] = true
        }
      })
      candidates[r].push(marks)
    }
  }
  return { board, givens, candidates }
}

export function practiceTargetHasStock(targetId: string): boolean {
  return (PRACTICE_PUZZLE_STOCK[targetId]?.length ?? 0) > 0
}

/** A stock position for `targetId` that needs it under `settings`, or null
 * (no stock for it, or no entry qualifies with these settings). Entries are
 * tried in random order; each is checked with the full Techniques list
 * before it is returned, transformed first and as stored second.
 *
 * `fromStart` ("Start from beginning"): the entry's puzzle at its start
 * instead - its givens are part of every entry - and only if an
 * easiest-first solve of it under `settings` reaches a point that needs the
 * target (easiestFirstSolveReachesTarget; the mined position itself is one
 * such point, but the miner did not insist that nothing harder comes first). */
export function pickStockPracticePuzzle(
  targetId: string,
  settings: PracticeSolverSettings,
  random: () => number = Math.random,
  fromStart = false,
): PracticePuzzleState | null {
  const target = practiceTargetById(targetId)
  if (!target) {
    return null
  }
  for (const text of shuffled(PRACTICE_PUZZLE_STOCK[targetId] ?? [], random)) {
    const stored = decodePracticeState(text)
    if (!stored) {
      continue
    }
    for (const state of [transformPracticeState(stored, random), stored]) {
      if (fromStart) {
        const puzzle = state.board.map((row, r) => row.map((value, c) => (state.givens[r][c] ? value : 0)))
        if (easiestFirstSolveReachesTarget(puzzle, settings, target)) {
          return practiceStartState(puzzle)
        }
      } else if (practiceStateNeedsTarget(state, settings, target)) {
        return state
      }
    }
  }
  return null
}
