import { cageAllows, entropyAllows, entropyCancelAround, ruleCellsOf } from './SudokuConstraints'
import type { Board, CandidateGrid } from './types'

export const BOARD_SIZE = 9
export const BOX_SIZE = 3

/** Placement rules shared by the solver and the puzzle generator. They read
 * the active constraints (SudokuConstraints.ts): on a Classic grid that is
 * the row, column and 3x3 box, exactly as before; on a variant the "box" is
 * the cell's Jigsaw region, and a Killer cage's cells are peers too. */
export class SudokuRules {
  static isSafe(grid: Board, row: number, col: number, value: number): boolean {
    for (const [r, c] of ruleCellsOf(row, col)) {
      if (grid[r][c] === value) {
        return false
      }
    }
    // A Killer cage must still be able to reach its sum (always true off a
    // cage), and on an Entropy puzzle every 2x2 square over the cell must
    // still have room for a low, a middle and a high digit.
    return cageAllows(grid, row, col, value) && entropyAllows(grid, row, col, value)
  }

  /**
   * Removes `digit` as a candidate from every unsolved peer of (row, col) in
   * its row, column, and box (and its Killer cage, if it is in one), in
   * place. Once a digit is placed in a cell, Sudoku's rules forbid it
   * anywhere else in that row, column, or box, so any leftover candidate
   * mark for it there is stale and must be cleared - otherwise later
   * candidate-based deductions (like hidden singles) can mistake that stale
   * mark for a real possibility and solve a cell wrong.
   */
  static eliminatePeerCandidates(
    candidates: CandidateGrid,
    board: Board,
    row: number,
    col: number,
    digit: number,
  ): void {
    for (const [r, c] of ruleCellsOf(row, col)) {
      if (board[r][c] === 0) {
        candidates[r][c][digit - 1] = false
      }
    }
    // Entropy (nothing on any other grid): the 2x2 squares over the cell.
    entropyCancelAround(candidates, board, row, col, digit)
  }
}
