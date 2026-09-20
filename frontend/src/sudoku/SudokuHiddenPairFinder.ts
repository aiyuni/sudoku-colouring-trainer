import { markedCandidateDigits } from './boardUtils'
import type { CandidateElimination } from './SudokuPairFinder'
import { sudokuUnits, type Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export interface HiddenPairInstance {
  /** The two cells that, within some shared row/column/box, are the only
   * place either of this pair's two digits can go. */
  cells: readonly [Cell, Cell]
  /** The two candidates, ascending. */
  digits: readonly [number, number]
  /** Every OTHER currently-marked candidate in those same two cells - a
   * hidden pair eliminates from the pair's own cells, the opposite of a
   * naked pair, which eliminates from the rest of the unit instead. */
  eliminations: CandidateElimination[]
}

/**
 * Hidden pairs: when two candidate digits, within a single row, column, or
 * box, are only ever marked in the same two cells and nowhere else in that
 * unit, those two cells must be those two digits, in some order - so every
 * other candidate still marked in those two cells can be eliminated, even
 * though the cells themselves keep showing marks beyond just the pair until
 * that happens. A unit where both cells already show only the pair's two
 * digits (nothing to eliminate) is a naked pair, not a hidden one, and is
 * left to SudokuPairFinder instead.
 */
export class SudokuHiddenPairFinder {
  findHiddenPairs(board: Board, candidates: CandidateGrid): HiddenPairInstance[] {
    const seen = new Set<string>()
    const instances: HiddenPairInstance[] = []

    for (const unit of sudokuUnits()) {
      const digitCells: Cell[][] = Array.from({ length: 9 }, () => [])
      for (const [row, col] of unit) {
        if (board[row][col] !== 0) {
          continue
        }
        for (const digit of markedCandidateDigits(candidates[row][col])) {
          digitCells[digit - 1].push([row, col])
        }
      }

      for (let d1 = 1; d1 <= 9; d1++) {
        const cellsA = digitCells[d1 - 1]
        if (cellsA.length !== 2) {
          continue
        }
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          const cellsB = digitCells[d2 - 1]
          if (cellsB.length !== 2 || !sameCells(cellsA, cellsB)) {
            continue
          }

          const eliminations: CandidateElimination[] = []
          for (const [row, col] of cellsA) {
            for (const digit of markedCandidateDigits(candidates[row][col])) {
              if (digit !== d1 && digit !== d2) {
                eliminations.push({ row, col, digit })
              }
            }
          }
          if (eliminations.length === 0) {
            // Both cells already show only d1/d2 - a naked pair, not a
            // hidden one; nothing for this technique to claim credit for.
            continue
          }

          // The same two cells can turn up via more than one unit (e.g.
          // sharing both a row and a box) - dedupe so the panel doesn't
          // list the identical pair twice.
          const key = `${cellsA[0][0]}.${cellsA[0][1]}-${cellsA[1][0]}.${cellsA[1][1]}|${d1},${d2}`
          if (seen.has(key)) {
            continue
          }
          seen.add(key)

          instances.push({ cells: [cellsA[0], cellsA[1]], digits: [d1, d2], eliminations })
        }
      }
    }

    return instances
  }

  findHiddenPairEliminations(board: Board, candidates: CandidateGrid): CandidateElimination[] {
    const eliminations = new Map<string, CandidateElimination>()
    for (const pair of this.findHiddenPairs(board, candidates)) {
      for (const elimination of pair.eliminations) {
        eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination)
      }
    }
    return Array.from(eliminations.values())
  }
}

/** Whether two same-length cell lists built by walking the same `unit`
 * array (so equal-valued lists are also equal-ordered) refer to the same
 * two cells. */
function sameCells(a: readonly Cell[], b: readonly Cell[]): boolean {
  return a[0][0] === b[0][0] && a[0][1] === b[0][1] && a[1][0] === b[1][0] && a[1][1] === b[1][1]
}
