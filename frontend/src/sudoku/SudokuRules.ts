import type { Board } from './types'

export const BOARD_SIZE = 9
export const BOX_SIZE = 3

/** Placement rules shared by the solver and the puzzle generator. */
export class SudokuRules {
  static isSafe(grid: Board, row: number, col: number, value: number): boolean {
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (grid[row][i] === value || grid[i][col] === value) {
        return false
      }
    }

    const boxRow = Math.floor(row / BOX_SIZE) * BOX_SIZE
    const boxCol = Math.floor(col / BOX_SIZE) * BOX_SIZE
    for (let r = boxRow; r < boxRow + BOX_SIZE; r++) {
      for (let c = boxCol; c < boxCol + BOX_SIZE; c++) {
        if (grid[r][c] === value) {
          return false
        }
      }
    }

    return true
  }
}
