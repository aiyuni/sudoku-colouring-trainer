import { markedCandidateDigits } from './boardUtils'
import type { CandidateElimination } from './SudokuPairFinder'
import { BOX_SIZE } from './SudokuRules'
import type { Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

/**
 * ============================================================================
 *  BIVALUE ODDAGON - LONGEST LOOP TO LOOK FOR
 * ============================================================================
 * The one number to change: how many cells the longest loop may have. Loops
 * are always odd (5, 7, 9, ...); an even value here is rounded down. Real
 * puzzles essentially never need a loop longer than 7 or 9, so this is kept
 * generous rather than tight - raise it freely if you want longer ones.
 */
export const BIVALUE_ODDAGON_MAX_LENGTH = 15

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/** Safety nets against a pathological candidate grid (hand-painted, or from
 * a bug elsewhere) rather than anything a real solve reaches: a *valid*
 * board's candidates never come close to either limit - real puzzles have
 * only a handful of cells eligible for any one digit pair. Without them, a
 * grid where most cells are pure bivalue for the same pair (so nearly every
 * cell is mutually "adjacent" to 15-20 others) turns simple-cycle
 * enumeration catastrophic: this finder runs on every board/candidate
 * change, so it must return quickly regardless of what candidates it's
 * handed, not just on realistic ones. */
/** A pair with more eligible cells than this is skipped outright - cheap to
 * check before ever building its graph. */
const MAX_NODES_PER_PAIR = 40
/** Total DFS edge-visits allowed across the *entire* find() call, all pairs
 * combined - once hit, the search stops early and returns whatever it has
 * found so far, rather than search further. */
const MAX_SEARCH_STEPS = 300_000

export interface BivalueOddagonInstance {
  type: 1 | 2
  /** The two candidates every loop cell holds. */
  loopDigits: readonly [number, number]
  /** Every cell in the loop, in cyclic order (closing back to the first). */
  cells: Cell[]
  /** The 1-3 loop cells holding `guardianDigit` on top of the two loop
   * digits - the only thing keeping the loop from being a "deadly" pattern
   * (see the class doc comment). Length 1 for Type 1, 2 or 3 for Type 2. */
  guardianCells: Cell[]
  /** The single extra candidate shared by every guardian cell. */
  guardianDigit: number
  /** Type 1 only: `guardianDigit`, the one thing this cell's solution can
   * be. */
  solvedCell: Cell | null
  /** Type 2 only: every other marked `guardianDigit` that sees *every*
   * guardian cell. */
  eliminations: CandidateElimination[]
}

function sameUnit(a: readonly [number, number], b: readonly [number, number]): boolean {
  const [ar, ac] = a
  const [br, bc] = b
  if (ar === br || ac === bc) {
    return true
  }
  return Math.floor(ar / BOX_SIZE) === Math.floor(br / BOX_SIZE) && Math.floor(ac / BOX_SIZE) === Math.floor(bc / BOX_SIZE)
}

/** One node of the loop-search graph for a given digit pair: either a pure
 * bivalue cell (holding only the pair) or a "guardian" one (the pair plus
 * exactly one more digit). */
interface OddagonNode {
  cell: Cell
  /** null for a pure cell; the one extra digit for a guardian cell. */
  extraDigit: number | null
}

/**
 * Bivalue Oddagon (a "Deadly Loop"): an odd number (5, 7, 9, ...) of bivalue
 * cells, all holding the exact same two candidates, arranged in a loop where
 * each cell shares a unit (row, column, or box) with the next. In any actual
 * solution, two cells sharing a unit can't hold the same digit - so if every
 * loop cell really did resolve to one of just the two loop digits, walking
 * the loop would have to alternate them, cell by cell. An *even* loop
 * returns to a consistent assignment; an *odd* one doesn't - the last cell
 * would need to be both digits at once. A valid Sudoku always has a
 * solution, so an odd loop that's *entirely* pure bivalue can never actually
 * occur - somewhere in it, at least one cell's real solution must be
 * something other than the two loop digits.
 *
 * That "somewhere" is only usable as a deduction when it's narrowed down to
 * one or a few candidates: a cell in the loop holding one extra candidate
 * beyond the pair (a "guardian", since it's what stops the loop being
 * deadly) is exactly that escape hatch.
 *  - **Type 1**: exactly one guardian cell. It's the *only* place the loop
 *    can break, so its extra candidate must be its solution (eliminate the
 *    two loop digits from it, same as Unique Rectangle Type 1).
 *  - **Type 2**: two or three guardian cells, all sharing the *same* extra
 *    candidate. That candidate is confined to being the solution of
 *    whichever one of them breaks the loop - "locked" between them - so it
 *    can be eliminated from any other cell that sees every guardian cell,
 *    same reasoning as a naked pair/triple.
 *
 * Search: for each of the 36 digit pairs, build a small graph of that pair's
 * pure and guardian cells (edges = sharing a unit) and depth-first search
 * for simple cycles up to `maxLength`, allowing at most 3 guardian cells per
 * path and requiring them to share one extra digit. Real puzzles have very
 * few cells eligible for any one pair, so this graph is tiny in practice;
 * only the search depth is bounded to keep a worst case bounded too.
 */
export class SudokuBivalueOddagonFinder {
  find(board: Board, candidates: CandidateGrid, maxLength: number = BIVALUE_ODDAGON_MAX_LENGTH): BivalueOddagonInstance[] {
    const limit = maxLength % 2 === 0 ? maxLength - 1 : maxLength
    if (limit < 5) {
      return []
    }

    const instances: BivalueOddagonInstance[] = []
    const seen = new Set<string>()
    // A single mutable counter shared across every pair's search - see
    // MAX_SEARCH_STEPS.
    const budget = { stepsLeft: MAX_SEARCH_STEPS }

    outer: for (let ai = 0; ai < DIGITS.length - 1; ai++) {
      for (let bi = ai + 1; bi < DIGITS.length; bi++) {
        const a = DIGITS[ai]
        const b = DIGITS[bi]
        const nodes = this.eligibleNodes(board, candidates, a, b)
        if (nodes.length < 5 || nodes.length > MAX_NODES_PER_PAIR) {
          continue
        }
        this.findLoopsForPair(board, candidates, [a, b], nodes, limit, instances, seen, budget)
        if (budget.stepsLeft <= 0) {
          break outer
        }
      }
    }

    return this.pickBestPerOutcome(instances)
  }

  /** Different loops (different pure cells filling out the rest of the
   * cycle) can reach the exact same conclusion - same cell solved, or the
   * same set of candidates eliminated. Keeps only the shortest (simplest)
   * loop per distinct conclusion, the same "most elegant explanation wins"
   * rule Short AIC's pickBestPerEliminationSet applies. */
  private pickBestPerOutcome(instances: readonly BivalueOddagonInstance[]): BivalueOddagonInstance[] {
    const bestByOutcome = new Map<string, BivalueOddagonInstance>()
    for (const instance of instances) {
      const key =
        instance.type === 1
          ? `solve:${instance.solvedCell![0]}.${instance.solvedCell![1]}.${instance.guardianDigit}`
          : `elim:${instance.eliminations
              .map((e) => `${e.row}.${e.col}.${e.digit}`)
              .sort()
              .join('|')}`
      const current = bestByOutcome.get(key)
      if (!current || instance.cells.length < current.cells.length) {
        bestByOutcome.set(key, instance)
      }
    }
    return Array.from(bestByOutcome.values())
  }

  /** Every unsolved cell holding both `a` and `b` as candidates, with
   * nothing else marked but at most one further digit. */
  private eligibleNodes(board: Board, candidates: CandidateGrid, a: number, b: number): OddagonNode[] {
    const nodes: OddagonNode[] = []
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        const digits = markedCandidateDigits(candidates[row][col])
        if (!digits.includes(a) || !digits.includes(b)) {
          continue
        }
        if (digits.length === 2) {
          nodes.push({ cell: [row, col], extraDigit: null })
        } else if (digits.length === 3) {
          nodes.push({ cell: [row, col], extraDigit: digits.find((d) => d !== a && d !== b)! })
        }
      }
    }
    return nodes
  }

  private findLoopsForPair(
    board: Board,
    candidates: CandidateGrid,
    loopDigits: readonly [number, number],
    nodes: OddagonNode[],
    maxLength: number,
    out: BivalueOddagonInstance[],
    seen: Set<string>,
    budget: { stepsLeft: number },
  ): void {
    const n = nodes.length
    const adjacency: number[][] = nodes.map((node, i) =>
      nodes.flatMap((other, j) => (i !== j && sameUnit(node.cell, other.cell) ? [j] : [])),
    )

    const path: number[] = []
    const inPath = new Array<boolean>(n).fill(false)
    // The single extra digit any guardian cell on the current path holds -
    // every guardian on the path (including the DFS root itself, via
    // tryEnterGuardian below - it's a node on the path exactly like any
    // other) must agree on it, reset as the DFS backtracks past the last
    // guardian on the path.
    let extraDigit: number | null = null
    let guardianCount = 0

    /** Registers `index`'s own guardian status (a no-op if it's a pure
     * cell) before it's added to the path, honouring the "at most 3, all
     * the same extra digit" rule - returns whether it was allowed on. */
    const tryEnterGuardian = (index: number): boolean => {
      const extra = nodes[index].extraDigit
      if (extra === null) {
        return true
      }
      if (guardianCount >= 3 || (extraDigit !== null && extraDigit !== extra)) {
        return false
      }
      extraDigit = extra
      guardianCount++
      return true
    }
    const exitGuardian = (index: number): void => {
      if (nodes[index].extraDigit === null) {
        return
      }
      guardianCount--
      if (guardianCount === 0) {
        extraDigit = null
      }
    }

    const visit = (current: number, startIndex: number) => {
      for (const next of adjacency[current]) {
        if (budget.stepsLeft-- <= 0) {
          return
        }
        if (next === startIndex) {
          if (path.length >= 5 && path.length % 2 === 1) {
            this.reportLoop(board, candidates, loopDigits, nodes, path, out, seen)
          }
          continue
        }
        if (inPath[next] || next < startIndex) {
          // < startIndex: only the lexicographically-smallest node in a
          // cycle is ever used as its DFS root, so a cycle is found exactly
          // once regardless of which of its nodes happens to be iterated
          // first in the outer loop below.
          continue
        }
        if (!tryEnterGuardian(next)) {
          continue
        }
        if (path.length < maxLength) {
          path.push(next)
          inPath[next] = true
          visit(next, startIndex)
          inPath[next] = false
          path.pop()
        }
        exitGuardian(next)
      }
    }

    for (let start = 0; start < n; start++) {
      if (budget.stepsLeft <= 0) {
        return
      }
      if (!tryEnterGuardian(start)) {
        // A guardian root can't happen on its own (guardianCount was 0),
        // but kept symmetrical with the extension case for clarity.
        continue
      }
      path.push(start)
      inPath[start] = true
      visit(start, start)
      inPath[start] = false
      path.pop()
      exitGuardian(start)
    }
  }

  private reportLoop(
    board: Board,
    candidates: CandidateGrid,
    loopDigits: readonly [number, number],
    nodes: OddagonNode[],
    path: readonly number[],
    out: BivalueOddagonInstance[],
    seen: Set<string>,
  ): void {
    const loopNodes = path.map((i) => nodes[i])
    const guardians = loopNodes.filter((node) => node.extraDigit !== null)
    if (guardians.length === 0) {
      // A fully pure odd loop is a genuine contradiction, not a usable
      // deduction - see the class doc comment. Can only happen if the
      // candidates themselves are already inaccurate; nothing to report.
      return
    }
    const guardianDigit = guardians[0].extraDigit!
    const cells = loopNodes.map((node) => node.cell)
    const guardianCells = guardians.map((node) => node.cell)

    const key = `${loopDigits.join(',')}|${guardianDigit}|${[...cells]
      .map(([r, c]) => `${r}.${c}`)
      .sort()
      .join('-')}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)

    if (guardianCells.length === 1) {
      out.push({
        type: 1,
        loopDigits,
        cells,
        guardianCells,
        guardianDigit,
        solvedCell: guardianCells[0],
        eliminations: [],
      })
      return
    }

    const loopCellKeys = new Set(cells.map(([r, c]) => `${r},${c}`))
    const eliminations: CandidateElimination[] = []
    // Every empty, non-loop cell holding guardianDigit that sees *all*
    // guardian cells - checked directly rather than via sudokuUnits(),
    // since "sees every one of 2-3 cells" isn't naturally a single unit.
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (board[row][col] !== 0 || loopCellKeys.has(`${row},${col}`)) {
          continue
        }
        if (!candidates[row][col][guardianDigit - 1]) {
          continue
        }
        if (guardianCells.every(([gr, gc]) => sameUnit([row, col], [gr, gc]))) {
          eliminations.push({ row, col, digit: guardianDigit })
        }
      }
    }
    if (eliminations.length === 0) {
      return
    }

    out.push({
      type: 2,
      loopDigits,
      cells,
      guardianCells,
      guardianDigit,
      solvedCell: null,
      eliminations,
    })
  }
}
