import { SudokuGenerator } from '../sudoku/SudokuGenerator'
import { SudokuRules } from '../sudoku/SudokuRules'
import { SudokuSolver } from '../sudoku/SudokuSolver'
import type { Board, CandidateGrid } from '../sudoku/types'
import {
  applyTechniqueEffect,
  buildTechniqueInstances,
  fullTechniqueEffect,
  type TechniqueInstance,
} from '../techniqueEngine'
import { practiceTargetById, practiceTargetRank, type PracticeSolverSettings, type PracticeTarget } from './practiceTargets'

/** A practice position: the puzzle's givens, the digits solved on the way
 * here (ordinary cells, not givens - Avoidable Rectangle needs to tell them
 * apart), and the candidates left at this point. */
export interface PracticePuzzleState {
  board: Board
  givens: boolean[][]
  candidates: CandidateGrid
}

export interface PracticeGenerateOptions {
  targetId: string
  settings: PracticeSolverSettings
  timeBudgetMs: number
  /** Stop after this many random puzzles even with time left (the
   * main-thread fallback walks one at a time, to yield in between). */
  maxPuzzles?: number
  /** "Start from beginning": return the puzzle at its start (givens only,
   * candidates autofilled) instead of at the point that needs the target.
   * Solving it easiest technique first then leads to that point - see
   * easiestFirstSolveReachesTarget for exactly what is promised. */
  fromStart?: boolean
}

export interface PracticeGenerateResult {
  state: PracticePuzzleState | null
  /** Random puzzles walked, for the progress line and the benchmarks. */
  puzzlesTried: number
}

/** A solve never needs this many easiest-tier rounds (each round applies
 * every row of the easiest tier at once); a walk that gets here is cut. */
const MAX_WALK_ROUNDS = 400

const generator = new SudokuGenerator()
const solver = new SudokuSolver()

/** The Techniques list for a practice state under `settings`: Dynamic and
 * Double Dynamic Dragon off (they rank above everything a practice puzzle
 * targets, so they can never be the "easier technique"), Exhaustive off (only
 * whether a Dragon exists matters, not how far it runs).
 * `easiestTierOnly` is the solve path's shortcut - the list stops at the first
 * difficulty tier with a row, see EasiestTierOnly. */
export function practiceTechniqueInstances(
  state: PracticePuzzleState,
  settings: PracticeSolverSettings,
  easiestTierOnly: boolean,
): TechniqueInstance[] {
  return buildTechniqueInstances(
    state.board,
    state.candidates,
    0,
    new Set(),
    settings.shortAicEnabled,
    settings.shortSingleDigitAicEnabled,
    true,
    false,
    settings.genericAicEnabled,
    false,
    false,
    false,
    new Set(settings.enabledFish),
    settings.alsXzEnabled,
    Infinity,
    settings.doubleDragonEnabled,
    false,
    state.givens,
    new Set(settings.enabledExotic),
    settings.urAicEnabled,
    settings.alsAicEnabled,
    settings.groupedAicEnabled,
    false,
    easiestTierOnly ? { preferEasierDoubleDragons: false } : false,
  )
}

/** The rows of the easiest difficulty tier that has any. */
export function easiestRows(instances: readonly TechniqueInstance[]): TechniqueInstance[] {
  let lowest = Infinity
  for (const instance of instances) {
    lowest = Math.min(lowest, instance.techniqueRank)
  }
  return instances.filter((instance) => instance.techniqueRank === lowest)
}

/** Does `state` need `target` for its next progress? Checked with the full
 * Techniques list (no easiest-tier shortcut - an independent route to the
 * same answer as the generator's): there is a row, and every row of the
 * easiest tier is the target. So nothing easier applies, and nothing equally
 * easy that is a different technique or pattern either. */
export function practiceStateNeedsTarget(state: PracticePuzzleState, settings: PracticeSolverSettings, target: PracticeTarget): boolean {
  const rows = easiestRows(practiceTechniqueInstances(state, settings, false))
  return rows.length > 0 && rows.every((row) => target.matches(row))
}

function autofill(board: Board): CandidateGrid {
  return board.map((row, r) => row.map((value, c) => Array.from({ length: 9 }, (_, d) => value === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
}

/** Every placed digit is the solution's, and every empty cell still has its
 * solution digit among its candidates. A finder that broke this would have
 * handed the walk a wrong grid; such a puzzle is dropped, never served. */
export function practiceStateIsConsistent(state: PracticePuzzleState, solution: Board): boolean {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const value = state.board[r][c]
      if (value !== 0 ? value !== solution[r][c] : !state.candidates[r][c][solution[r][c] - 1]) {
        return false
      }
    }
  }
  return true
}

/** Walks one puzzle from its autofill with the app's own easiest-first
 * solving, looking for a state that needs `target`:
 *
 *  - every row of the easiest tier is the target: that state is the answer;
 *  - otherwise the easiest tier's rows that are *not* the target are all
 *    applied (each is a sound deduction, so applying them together is a
 *    state the solver could be in) and the walk carries on. That is also how
 *    a tier holding the target and something else is handled - e.g. a
 *    Skyscraper next to a Two-String Kite: the Kite is made, and if the
 *    Skyscraper is still there afterwards with nothing else beside it, that
 *    is a state that needs the Skyscraper.
 *
 * Null when the puzzle is solved or stuck without ever needing the target.
 * `nothingHarderFirst` ("Start from beginning"): also null as soon as the
 * easiest tier is a *harder* one than the target's - a solver starting from
 * the givens would have to get past that first. */
export function walkPuzzleForTarget(
  puzzle: Board,
  settings: PracticeSolverSettings,
  target: PracticeTarget,
  deadline = Infinity,
  nothingHarderFirst = false,
): PracticePuzzleState | null {
  const givens = puzzle.map((row) => row.map((value) => value !== 0))
  const targetRank = nothingHarderFirst ? practiceTargetRank(target.id) : Infinity
  let state: PracticePuzzleState = { board: puzzle.map((row) => [...row]), givens, candidates: autofill(puzzle) }
  for (let round = 0; round < MAX_WALK_ROUNDS; round++) {
    if (Date.now() > deadline) {
      return null
    }
    const rows = easiestRows(practiceTechniqueInstances(state, settings, true))
    if (rows.length === 0) {
      return null
    }
    const others = rows.filter((row) => !target.matches(row))
    if (others.length === 0) {
      return state
    }
    if (rows[0].techniqueRank > targetRank) {
      return null
    }
    let { board, candidates } = state
    for (const row of others) {
      ;({ board, candidates } = applyTechniqueEffect(board, candidates, fullTechniqueEffect(row)))
    }
    state = { board, givens, candidates }
  }
  return null
}

/** The puzzle at its start: the givens and nothing else, candidates
 * autofilled (as the other practice puzzles load with theirs). */
export function practiceStartState(puzzle: Board): PracticePuzzleState {
  return { board: puzzle.map((row) => [...row]), givens: puzzle.map((row) => row.map((value) => value !== 0)), candidates: autofill(puzzle) }
}

/** "Start from beginning", checked the way a person would solve it: from
 * the givens, one move at a time, always a move of the easiest tier that has
 * any - and, where that tier holds the target next to something else, the
 * something else first. True when that reaches a state whose easiest tier is
 * all target; false when a tier *harder* than the target's comes up first,
 * or the puzzle is solved or stuck before either.
 *
 * So what a "from the beginning" puzzle promises is: take the easiest
 * available technique every time (among equally easy ones, leave the picked
 * technique for last) and you arrive at a point where the pick is the
 * easiest way on, having needed nothing harder on the way. A different
 * route to the same generator answer - walkPuzzleForTarget applies a whole
 * tier at once, this one row at a time. */
export function easiestFirstSolveReachesTarget(puzzle: Board, settings: PracticeSolverSettings, target: PracticeTarget): boolean {
  const targetRank = practiceTargetRank(target.id)
  let state = practiceStartState(puzzle)
  for (let step = 0; step < MAX_WALK_ROUNDS * 4; step++) {
    const rows = easiestRows(practiceTechniqueInstances(state, settings, true))
    if (rows.length === 0) {
      return false
    }
    const other = rows.find((row) => !target.matches(row))
    if (!other) {
      return true
    }
    if (other.techniqueRank > targetRank) {
      return false
    }
    const { board, candidates } = applyTechniqueEffect(state.board, state.candidates, fullTechniqueEffect(other))
    state = { board, givens: state.givens, candidates }
  }
  return false
}

/** Random puzzles (SudokuGenerator: one solution, 17-30 clues) walked one
 * after another until one yields a state needing the target, or the time is
 * up. Blocking - run it in a Web Worker (parallelPracticePuzzle.ts). Every
 * answer is re-checked with the full Techniques list and against the
 * puzzle's solution before it is returned. */
export function generatePracticePuzzleBlocking(
  options: PracticeGenerateOptions,
  onProgress?: (puzzlesTried: number) => void,
): PracticeGenerateResult {
  const target = practiceTargetById(options.targetId)
  if (!target) {
    throw new Error(`Unknown practice target: ${options.targetId}`)
  }
  const deadline = Date.now() + options.timeBudgetMs
  let puzzlesTried = 0
  const maxPuzzles = options.maxPuzzles ?? Infinity
  while (Date.now() < deadline && puzzlesTried < maxPuzzles) {
    const puzzle = generator.generate()
    puzzlesTried++
    onProgress?.(puzzlesTried)
    const state = walkPuzzleForTarget(puzzle, options.settings, target, deadline, options.fromStart === true)
    if (!state) {
      continue
    }
    const [solution] = solver.findSolutions(puzzle, 1)
    if (!solution || !practiceStateIsConsistent(state, solution) || !practiceStateNeedsTarget(state, options.settings, target)) {
      continue
    }
    if (!options.fromStart) {
      return { state, puzzlesTried }
    }
    if (easiestFirstSolveReachesTarget(puzzle, options.settings, target)) {
      return { state: practiceStartState(puzzle), puzzlesTried }
    }
  }
  return { state: null, puzzlesTried }
}
