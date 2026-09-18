import { markedCandidateDigits } from './boardUtils'
import { BOARD_SIZE } from './SudokuRules'
import { sudokuUnits } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export interface SingleAssignment {
  row: number
  col: number
  digit: number
}

/**
 * Finds cells whose solution is forced by the currently marked candidates -
 * it reasons only about those marks, not the underlying Sudoku rules, so it
 * finds nothing where candidates haven't been filled in (see Autofill all).
 */
export class SudokuSingleFinder {
  /** A naked single: a cell with exactly one candidate marked. */
  findNakedSingles(board: Board, candidates: CandidateGrid): SingleAssignment[] {
    const found: SingleAssignment[] = []

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        const marked = markedCandidateDigits(candidates[row][col])
        if (marked.length === 1) {
          found.push({ row, col, digit: marked[0] })
        }
      }
    }

    return found
  }

  /**
   * A hidden single: a digit that's a candidate in only one cell of some
   * row, column, or box, even though that cell has other candidates too.
   */
  findHiddenSingles(board: Board, candidates: CandidateGrid): SingleAssignment[] {
    const found: SingleAssignment[] = []

    for (const unit of sudokuUnits()) {
      for (let digit = 1; digit <= 9; digit++) {
        const withCandidate = unit.filter(
          ([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1],
        )
        if (withCandidate.length === 1) {
          const [row, col] = withCandidate[0]
          found.push({ row, col, digit })
        }
      }
    }

    return found
  }

  /**
   * Naked singles plus hidden singles, deduplicated by cell. If the two
   * techniques ever propose different digits for the same cell, the marked
   * candidates are inconsistent; the first assignment found wins rather
   * than guessing which is right.
   */
  findNakedAndHiddenSingles(board: Board, candidates: CandidateGrid): SingleAssignment[] {
    const assignments = new Map<string, SingleAssignment>()

    const add = (assignment: SingleAssignment) => {
      const key = `${assignment.row},${assignment.col}`
      if (!assignments.has(key)) {
        assignments.set(key, assignment)
      }
    }

    this.findNakedSingles(board, candidates).forEach(add)
    this.findHiddenSingles(board, candidates).forEach(add)

    return Array.from(assignments.values())
  }
}
