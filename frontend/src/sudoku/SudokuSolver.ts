import { SolveResponse } from './SolveResponse'
import { BOARD_SIZE as SIZE, SudokuRules } from './SudokuRules'
import type { Board } from './types'

type CellCoordinate = [row: number, col: number]

type CopyResult = { ok: true; grid: Board } | { ok: false; error: string }

interface SolutionSearchState {
  count: number
  solution: Board | null
}

/**
 * Backtracking Sudoku solver with minimum-remaining-values cell selection.
 * Counts up to two solutions so callers can tell a unique solution apart
 * from an unsolvable or ambiguous puzzle.
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
    this.countSolutions(grid, 2, search)

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

  private countSolutions(grid: Board, limit: number, search: SolutionSearchState): void {
    if (search.count >= limit) {
      return
    }

    const empty = this.findBestEmptyCell(grid)
    if (!empty) {
      search.count++
      search.solution ??= this.copyGrid(grid)
      return
    }

    const [row, col] = empty
    for (let value = 1; value <= SIZE; value++) {
      if (search.count >= limit) {
        return
      }
      if (!SudokuRules.isSafe(grid, row, col, value)) {
        continue
      }

      grid[row][col] = value
      this.countSolutions(grid, limit, search)
      grid[row][col] = 0
    }
  }

  private findBestEmptyCell(grid: Board): CellCoordinate | null {
    let best: CellCoordinate | null = null
    let bestCandidateCount = SIZE + 1

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] !== 0) {
          continue
        }

        let candidateCount = 0
        for (let value = 1; value <= SIZE; value++) {
          if (SudokuRules.isSafe(grid, r, c, value)) {
            candidateCount++
          }
        }

        if (candidateCount < bestCandidateCount) {
          bestCandidateCount = candidateCount
          best = [r, c]
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
