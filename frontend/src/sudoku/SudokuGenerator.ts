import { SudokuSolver } from './SudokuSolver'
import { BOARD_SIZE, SudokuRules } from './SudokuRules'
import type { Board } from './types'

const MIN_CLUES = 20
const MAX_CLUES = 25
const MAX_ATTEMPTS = 20

type CellCoordinate = [row: number, col: number]

/**
 * Generates a random, uniquely-solvable Sudoku puzzle: a full solved grid
 * with cells removed one at a time (checking uniqueness after each removal
 * via SudokuSolver) until 20-25 clues remain.
 */
export class SudokuGenerator {
  private readonly solver = new SudokuSolver()

  generate(): Board {
    let best: Board | null = null

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const puzzle = this.reduceToUniquePuzzle(this.generateSolvedGrid(), this.randomClueTarget())
      const clueCount = this.countClues(puzzle)

      if (clueCount <= MAX_CLUES) {
        return puzzle
      }
      if (!best || clueCount < this.countClues(best)) {
        best = puzzle
      }
    }

    // Extremely unlikely fallback: every attempt overshot the clue band.
    return best!
  }

  private randomClueTarget(): number {
    return MIN_CLUES + Math.floor(Math.random() * (MAX_CLUES - MIN_CLUES + 1))
  }

  private generateSolvedGrid(): Board {
    const grid: Board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0))
    this.fillCell(grid, 0)
    return grid
  }

  private fillCell(grid: Board, position: number): boolean {
    if (position === BOARD_SIZE * BOARD_SIZE) {
      return true
    }

    const row = Math.floor(position / BOARD_SIZE)
    const col = position % BOARD_SIZE

    for (const value of this.shuffled(this.digits())) {
      if (!SudokuRules.isSafe(grid, row, col, value)) {
        continue
      }

      grid[row][col] = value
      if (this.fillCell(grid, position + 1)) {
        return true
      }
      grid[row][col] = 0
    }

    return false
  }

  private reduceToUniquePuzzle(solved: Board, clueTarget: number): Board {
    const puzzle = solved.map((row) => [...row])
    let clueCount = BOARD_SIZE * BOARD_SIZE

    for (const [row, col] of this.shuffled(this.allCoordinates())) {
      if (clueCount <= clueTarget) {
        break
      }

      const removedValue = puzzle[row][col]
      puzzle[row][col] = 0

      if (this.solver.solve(puzzle).status === 'solved') {
        clueCount--
      } else {
        puzzle[row][col] = removedValue
      }
    }

    return puzzle
  }

  private countClues(board: Board): number {
    return board.reduce(
      (count, row) => count + row.filter((value) => value !== 0).length,
      0,
    )
  }

  private digits(): number[] {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9]
  }

  private allCoordinates(): CellCoordinate[] {
    const coordinates: CellCoordinate[] = []
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        coordinates.push([r, c])
      }
    }
    return coordinates
  }

  private shuffled<T>(items: T[]): T[] {
    const result = [...items]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }
}
