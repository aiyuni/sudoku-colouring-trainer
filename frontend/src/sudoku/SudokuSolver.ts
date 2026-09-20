import { SolveResponse } from './SolveResponse'
import { BOARD_SIZE as SIZE, SudokuRules } from './SudokuRules'
import type { Board } from './types'

type CopyResult = { ok: true; grid: Board } | { ok: false; error: string }

interface SolutionSearchState {
  count: number
  solution: Board | null
}

/** (row, col, digit-bitmask of still-available digits) for the cell the
 * MRV heuristic picked next - the mask is returned alongside the
 * coordinates so the recursion doesn't have to recompute it a second time
 * just to know which digits to try. */
type BestCell = [row: number, col: number, available: number]

const FULL_MASK = (1 << SIZE) - 1

/** boxIndex[row][col] - precomputed so the hot recursive path never calls
 * Math.floor. */
const BOX_INDEX: number[][] = Array.from({ length: SIZE }, (_, r) =>
  Array.from({ length: SIZE }, (_, c) => Math.floor(r / 3) * 3 + Math.floor(c / 3)),
)

/** Number of set bits in every possible 9-bit mask, indexed by the mask
 * itself - turns "how many digits are still available here" into a single
 * array lookup instead of testing each of the 9 bits in a loop. */
const POPCOUNT9: number[] = Array.from({ length: FULL_MASK + 1 }, (_, mask) => {
  let count = 0
  for (let m = mask; m !== 0; m &= m - 1) {
    count++
  }
  return count
})

/**
 * Backtracking Sudoku solver with minimum-remaining-values cell selection.
 * Counts up to two solutions so callers can tell a unique solution apart
 * from an unsolvable or ambiguous puzzle.
 *
 * The recursive search tracks which digits are already used in each row/
 * column/box as bitmasks (updated incrementally as a digit is placed or
 * backtracked out), rather than rescanning the 27 peer cells with
 * `SudokuRules.isSafe` on every candidate digit at every node - this is
 * the dominant cost during puzzle generation, where `solve` runs tens of
 * thousands of times to check uniqueness after each candidate clue
 * removal. The search order (MRV cell choice, ties broken by row-major
 * position, digits tried 1-9) is unchanged, so results are identical to
 * the previous cell-rescanning version - only the per-node bookkeeping is
 * cheaper. `SudokuRules.isSafe` itself is untouched and still used by
 * every other technique finder.
 */
export class SudokuSolver {
  solve(board: Board | null | undefined): SolveResponse {
    const copy = this.tryCopyBoard(board)
    if (!copy.ok) {
      return SolveResponse.invalid(copy.error)
    }

    const grid = copy.grid
    if (!this.isConsistent(grid)) {
      return SolveResponse.invalid('The given digits conflict with Sudoku rules.')
    }

    // Stop as soon as a second solution is found; we only need to know
    // whether the solution is unique, not enumerate every solution.
    const search: SolutionSearchState = { count: 0, solution: null }
    const { rowMask, colMask, boxMask } = this.buildMasks(grid)
    this.countSolutions(grid, rowMask, colMask, boxMask, 2, search)

    switch (search.count) {
      case 0:
        return SolveResponse.unsolvable()
      case 1:
        return SolveResponse.ok(search.solution!)
      default:
        return SolveResponse.multiple()
    }
  }

  private tryCopyBoard(board: Board | null | undefined): CopyResult {
    if (!board || board.length !== SIZE || board.some((row) => row.length !== SIZE)) {
      return { ok: false, error: 'Board must be a 9x9 grid.' }
    }

    const grid: Board = []
    for (let r = 0; r < SIZE; r++) {
      const row: number[] = []
      for (let c = 0; c < SIZE; c++) {
        const value = board[r][c]
        if (!Number.isInteger(value) || value < 0 || value > 9) {
          return { ok: false, error: 'Each cell must be 0 (empty) or 1-9.' }
        }
        row.push(value)
      }
      grid.push(row)
    }

    return { ok: true, grid }
  }

  private isConsistent(grid: Board): boolean {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const value = grid[r][c]
        if (value === 0) {
          continue
        }

        grid[r][c] = 0
        const safe = SudokuRules.isSafe(grid, r, c, value)
        grid[r][c] = value
        if (!safe) {
          return false
        }
      }
    }

    return true
  }

  /** rowMask[r]/colMask[c]/boxMask[b] - bit (digit-1) set means that digit
   * is already placed somewhere in that row/column/3x3 box. Built once
   * from the (already-validated) starting grid; `countSolutions` keeps
   * them in sync as it places and backtracks digits. */
  private buildMasks(grid: Board): { rowMask: number[]; colMask: number[]; boxMask: number[] } {
    const rowMask = new Array<number>(SIZE).fill(0)
    const colMask = new Array<number>(SIZE).fill(0)
    const boxMask = new Array<number>(SIZE).fill(0)

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const value = grid[r][c]
        if (value === 0) {
          continue
        }
        const bit = 1 << (value - 1)
        rowMask[r] |= bit
        colMask[c] |= bit
        boxMask[BOX_INDEX[r][c]] |= bit
      }
    }

    return { rowMask, colMask, boxMask }
  }

  private countSolutions(
    grid: Board,
    rowMask: number[],
    colMask: number[],
    boxMask: number[],
    limit: number,
    search: SolutionSearchState,
  ): void {
    if (search.count >= limit) {
      return
    }

    const empty = this.findBestEmptyCell(grid, rowMask, colMask, boxMask)
    if (!empty) {
      search.count++
      search.solution ??= this.copyGrid(grid)
      return
    }

    const [row, col, available] = empty
    const box = BOX_INDEX[row][col]
    for (let value = 1; value <= SIZE; value++) {
      if (search.count >= limit) {
        return
      }
      const bit = 1 << (value - 1)
      if ((available & bit) === 0) {
        continue
      }

      grid[row][col] = value
      rowMask[row] |= bit
      colMask[col] |= bit
      boxMask[box] |= bit

      this.countSolutions(grid, rowMask, colMask, boxMask, limit, search)

      grid[row][col] = 0
      rowMask[row] &= ~bit
      colMask[col] &= ~bit
      boxMask[box] &= ~bit
    }
  }

  private findBestEmptyCell(grid: Board, rowMask: number[], colMask: number[], boxMask: number[]): BestCell | null {
    let best: BestCell | null = null
    let bestCandidateCount = SIZE + 1

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] !== 0) {
          continue
        }

        const available = FULL_MASK & ~(rowMask[r] | colMask[c] | boxMask[BOX_INDEX[r][c]])
        const candidateCount = POPCOUNT9[available]

        if (candidateCount < bestCandidateCount) {
          bestCandidateCount = candidateCount
          best = [r, c, available]
          if (candidateCount === 0) {
            return best
          }
        }
      }
    }

    return best
  }

  private copyGrid(grid: Board): Board {
    return grid.map((row) => [...row])
  }
}
