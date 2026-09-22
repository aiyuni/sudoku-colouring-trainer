import { cloneBoard, cloneCandidates } from './boardUtils'
import { foldDragonMoves } from './dragonReplay'
import {
  SudokuDragonFinder,
  type DragonCandidateRef,
  type DragonMove,
  type Rule3Technique,
} from './SudokuDragonFinder'
import { SudokuMedusaFinder, type MedusaChain } from './SudokuMedusaFinder'
import { BOARD_SIZE, SudokuRules } from './SudokuRules'
import type { Board, CandidateGrid } from './types'

/**
 * "Find me the Dragon that makes these eliminations": given candidates the
 * user wants gone (typed like 8r2c3 - digit, row, column), searches every
 * Dragon Colouring and Dynamic Dragon Colouring the board supports for one
 * that eliminates all of them, preferring the one that removes the fewest
 * *other* candidates and, after that, takes the fewest steps.
 */

/** A candidate written the way the user types it: digit, row, column. */
export function formatCandidate(ref: DragonCandidateRef): string {
  return `${ref.digit}r${ref.row + 1}c${ref.col + 1}`
}

function keyOf(ref: DragonCandidateRef): string {
  return `${ref.row},${ref.col},${ref.digit}`
}

/** Reads "8r2c3, 2r3c4" (commas, semicolons, spaces or new lines between
 * entries; case and the odd inner space don't matter). Anything left over
 * that isn't an entry is reported back rather than silently dropped, so a
 * typo never quietly turns into a smaller search. Duplicates collapse. */
export function parseEliminationTargets(text: string): { targets: DragonCandidateRef[]; unreadable: string[] } {
  const targets: DragonCandidateRef[] = []
  const seen = new Set<string>()
  const leftover = text.replace(/([1-9])\s*r\s*([1-9])\s*c\s*([1-9])/gi, (_, digit, row, col) => {
    const ref = { digit: Number(digit), row: Number(row) - 1, col: Number(col) - 1 }
    if (!seen.has(keyOf(ref))) {
      seen.add(keyOf(ref))
      targets.push(ref)
    }
    return ' '
  })
  return { targets, unreadable: leftover.split(/[\s,;]+/).filter(Boolean) }
}

export type TargetProblem =
  | { kind: 'filled'; ref: DragonCandidateRef; value: number }
  | { kind: 'not-a-candidate'; ref: DragonCandidateRef }
  | { kind: 'is-the-answer'; ref: DragonCandidateRef }

/** Checks each entry against the live grid and, when the puzzle has exactly
 * one solution, against that solution: eliminating the true digit of a cell
 * can never be right. `solution` is null when the puzzle can't be solved
 * uniquely, in which case only the grid checks run. */
export function checkEliminationTargets(
  board: Board,
  candidates: CandidateGrid,
  targets: DragonCandidateRef[],
  solution: Board | null,
): TargetProblem[] {
  const problems: TargetProblem[] = []
  for (const ref of targets) {
    const value = board[ref.row][ref.col]
    if (value !== 0) {
      problems.push({ kind: 'filled', ref, value })
    } else if (!candidates[ref.row][ref.col][ref.digit - 1]) {
      problems.push({ kind: 'not-a-candidate', ref })
    } else if (solution && solution[ref.row][ref.col] === ref.digit) {
      problems.push({ kind: 'is-the-answer', ref })
    }
  }
  return problems
}

/** Every pencil mark that disappears when a technique's solves and
 * eliminations are all applied - including the peers a solved cell wipes and
 * that cell's own other candidates, but not the solved digit itself (that
 * mark becomes the cell's value). */
export function listEffectiveEliminations(
  board: Board,
  candidates: CandidateGrid,
  effect: { eliminatedCandidates: DragonCandidateRef[]; solvedCandidates: DragonCandidateRef[] },
): DragonCandidateRef[] {
  const nextBoard = cloneBoard(board)
  const after = cloneCandidates(candidates)
  const solvedDigitByCell = new Map<string, number>()
  for (const { row, col, digit } of effect.solvedCandidates) {
    nextBoard[row][col] = digit
    after[row][col] = Array(9).fill(false)
    SudokuRules.eliminatePeerCandidates(after, nextBoard, row, col, digit)
    solvedDigitByCell.set(`${row},${col}`, digit)
  }
  for (const { row, col, digit } of effect.eliminatedCandidates) {
    after[row][col][digit - 1] = false
  }

  const removed: DragonCandidateRef[] = []
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] !== 0) {
        continue
      }
      const solvedDigit = solvedDigitByCell.get(`${row},${col}`)
      for (let digit = 1; digit <= 9; digit++) {
        if (candidates[row][col][digit - 1] && !after[row][col][digit - 1] && digit !== solvedDigit) {
          removed.push({ row, col, digit })
        }
      }
    }
  }
  return removed
}

export interface DragonTargetMatch {
  kind: 'dragon' | 'dynamic'
  /** Same key App uses to name a chain's technique instance. */
  chainKey: string
  /** The move log, cut off right after the first move by which every entered
   * candidate is eliminated - nothing later in the colouring is included. */
  moves: DragonMove[]
  /** Every candidate applying `moves` removes from the grid. */
  eliminated: DragonCandidateRef[]
  /** The part of `eliminated` the user did not ask for. */
  extras: DragonCandidateRef[]
}

export interface DragonTargetSearch {
  best: DragonTargetMatch | null
  /** For each entered candidate, in order: does *some* Dragon eliminate it
   * (whether or not it also gets the others)? Explains a "not found". */
  individually: boolean[]
  /** How many stuck Medusa chains there were to try. */
  chainsTried: number
}

export interface DragonTargetOptions {
  allowedRule3Techniques?: ReadonlySet<Rule3Technique>
  aicLimitPerStep?: boolean
}

function chainKeyOf(chain: MedusaChain): string {
  return chain.candidates
    .map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`)
    .sort()
    .join('-')
}

export class SudokuDragonTargetFinder {
  private readonly medusaFinder = new SudokuMedusaFinder()
  private readonly dragonFinder = new SudokuDragonFinder()

  /**
   * Every stuck Medusa chain is extended as plain Dragon Colouring and as
   * Dynamic Dragon Colouring (the latter only counted when it really used a
   * dynamic step), always in Exhaustive mode: an exhaustive run's log begins
   * with the very moves a non-exhaustive run would stop at, so it contains
   * every stopping point either mode could give.
   *
   * Each log is then cut at its earliest elimination-carrying move whose
   * accumulated result covers all the entered candidates. Later moves can only
   * remove more, so that earliest cut is both the fewest steps and the fewest
   * extra eliminations that log can achieve. The best cut across all logs wins
   * on extras first, then steps, then plain Dragon over Dynamic.
   */
  find(
    board: Board,
    candidates: CandidateGrid,
    targets: DragonCandidateRef[],
    options: DragonTargetOptions = {},
  ): DragonTargetSearch {
    const wanted = new Set(targets.map(keyOf))
    const individually = targets.map(() => false)
    let best: DragonTargetMatch | null = null
    let chainsTried = 0

    const consider = (kind: DragonTargetMatch['kind'], chainKey: string, moves: DragonMove[]) => {
      // Whole-log effect: which entered candidates does this Dragon reach at all?
      const whole = foldDragonMoves(moves, moves.length - 1)
      const wholeKeys = new Set(
        listEffectiveEliminations(board, candidates, {
          eliminatedCandidates: whole.eliminatedCandidates,
          solvedCandidates: whole.solvedCandidates,
        }).map(keyOf),
      )
      targets.forEach((target, i) => {
        if (wholeKeys.has(keyOf(target))) individually[i] = true
      })

      for (let k = 0; k < moves.length; k++) {
        if (moves[k].eliminated.length === 0 && moves[k].solved.length === 0) {
          continue
        }
        const fold = foldDragonMoves(moves, k)
        const eliminated = listEffectiveEliminations(board, candidates, {
          eliminatedCandidates: fold.eliminatedCandidates,
          solvedCandidates: fold.solvedCandidates,
        })
        const keys = new Set(eliminated.map(keyOf))
        if (![...wanted].every((key) => keys.has(key))) {
          continue
        }
        const extras = eliminated.filter((ref) => !wanted.has(keyOf(ref)))
        const cut = moves.slice(0, k + 1)
        const better =
          best === null ||
          extras.length < best.extras.length ||
          (extras.length === best.extras.length &&
            (cut.length < best.moves.length ||
              (cut.length === best.moves.length && kind === 'dragon' && best.kind === 'dynamic')))
        if (better) {
          best = { kind, chainKey, moves: cut, eliminated, extras }
        }
        return
      }
    }

    for (const chain of this.medusaFinder.findChains(board, candidates)) {
      const stuck =
        this.medusaFinder.findMassElimination(chain, board, candidates) === null &&
        this.medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
        this.medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
        this.medusaFinder.findRule5Eliminations(chain, candidates).length === 0
      if (!stuck) {
        continue
      }
      chainsTried++
      const chainKey = chainKeyOf(chain)

      const plain = this.dragonFinder.extend(chain, board, candidates, { exhaustive: true })
      if (plain) {
        consider('dragon', chainKey, plain.moves)
      }
      const dynamic = this.dragonFinder.extend(chain, board, candidates, {
        dynamic: true,
        exhaustive: true,
        allowedRule3Techniques: options.allowedRule3Techniques,
        aicLimitPerStep: options.aicLimitPerStep,
      })
      if (dynamic && dynamic.moves.some((move) => move.kind === 'extension-rule3')) {
        consider('dynamic', chainKey, dynamic.moves)
      }
    }

    return { best, individually, chainsTried }
  }
}
