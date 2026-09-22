import { markedCandidateDigits } from './boardUtils'
import { sudokuUnits, type Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export interface BugPlusOneInstance {
  /** The one cell with three marked candidates - every other unsolved cell
   * has exactly two. */
  cell: Cell
  /** Every candidate `cell` holds. */
  candidates: readonly number[]
  /** Which of `candidates` is the solution. */
  solvedDigit: number
  /** The row, column, or box that shows `solvedDigit` three times - what
   * proves it, for the panel notation/highlight. */
  unit: readonly Cell[]
  unitKind: 'row' | 'column' | 'box'
}

/** Which kind of unit a set of cells belongs to - used to say "row",
 * "column", or "box" instead of the vaguer "section". */
function classifyUnitKind(cells: readonly Cell[]): 'row' | 'column' | 'box' {
  if (cells.every(([r]) => r === cells[0][0])) {
    return 'row'
  }
  if (cells.every(([, c]) => c === cells[0][1])) {
    return 'column'
  }
  return 'box'
}

/**
 * BUG+1 (Bivalue Universal Grave + 1): a grid where every unsolved cell is
 * bivalue except exactly one, which holds three candidates, is one step
 * short of a "BUG" - a deadly pattern where every digit's remaining
 * candidates pair up two-to-a-cell across every row, column, and box it
 * touches, so any of those pairs could swap and the grid would still look
 * consistent. A valid Sudoku always has exactly one solution, so a puzzle
 * can never actually reach a state where *every* cell is bivalue - the one
 * cell with a third candidate is what keeps this position out of that
 * deadly pattern, and its solution must be whichever of its three
 * candidates is what breaks the pattern.
 *
 * In a true BUG, a digit's candidates always come in pairs within any one
 * unit (0 or 2 of them, never 1 - that would already be a hidden single -
 * and never an odd number beyond that). The lone tri-value cell adds one
 * extra instance of its third candidate to each of its row, column, and
 * box; whichever of those three units already had exactly two other cells
 * holding that digit now shows three, an odd count a real BUG can't have -
 * so that candidate is what the grid is actually resolving to, and it's the
 * cell's solution.
 */
export class SudokuBugPlusOneFinder {
  find(board: Board, candidates: CandidateGrid): BugPlusOneInstance | null {
    let triValueCell: Cell | null = null
    let triValueDigits: number[] | null = null

    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        const digits = markedCandidateDigits(candidates[row][col])
        if (digits.length === 2) {
          continue
        }
        if (digits.length !== 3 || triValueCell) {
          // Anything other than exactly one cell with exactly three
          // candidates (and every other unsolved cell exactly two) isn't
          // this pattern at all - a cell with only 0-1 candidates would
          // already be solved or contradictory some other way, one with
          // four or more is too far from all-bivalue, and a *second*
          // tri-value cell means there's no single, unique escape hatch.
          return null
        }
        triValueCell = [row, col]
        triValueDigits = digits
      }
    }

    if (!triValueCell || !triValueDigits) {
      return null
    }

    for (const unit of sudokuUnits()) {
      if (!unit.some(([r, c]) => r === triValueCell![0] && c === triValueCell![1])) {
        continue
      }
      for (const digit of triValueDigits) {
        const count = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1]).length
        if (count === 3) {
          return { cell: triValueCell, candidates: triValueDigits, solvedDigit: digit, unit, unitKind: classifyUnitKind(unit) }
        }
      }
    }

    return null
  }
}
