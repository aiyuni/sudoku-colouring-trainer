import { BOARD_SIZE } from './SudokuRules'
import {
  hasDiagonals,
  isAntiKnight,
  knightLinked,
  sameBox,
  sharesHouseOrLink,
  sudokuUnits,
  unitLabel,
  type Cell,
} from './SudokuConstraints'
import type { Board, CandidateGrid } from './types'

export interface VariantLockedInstance {
  /** What the deduction leans on that a Classic Sudoku doesn't have: a
   * knight's move (Anti-Knight) when any of its links is one, otherwise a
   * diagonal (X-Sudoku). */
  kind: 'diagonal' | 'knight'
  digit: number
  /** Index into sudokuUnits() of the unit the digit is locked in, and its
   * name ("row 3", "box 5", "the \\ diagonal"). */
  unitIndex: number
  unitName: string
  /** Every cell of that unit that can still hold the digit. */
  lockedCells: Cell[]
  eliminations: { row: number; col: number; digit: number }[]
  /** "7 in box 5 can only go in r4c5, r6c5", conclusion-free. */
  reasonText: string
}

/**
 * Variant solver only (X-Sudoku and Anti-Knight; finds nothing on any other
 * grid): the Locked Candidate idea with the variant's own links.
 *
 * A unit must hold each digit once. So if every place a digit can still go
 * in some unit is ruled out by one outside cell holding it - that cell
 * "sees" them all - the outside cell can't hold the digit. In a Classic
 * Sudoku the only way a cell sees several cells of another unit is box/line
 * overlap, which is exactly Pointing and Claiming (SudokuLockedCandidateFinder).
 * The variants add two more ways to see:
 *  - X-Sudoku: along a diagonal. A box's 5s all on the diagonal remove 5
 *    from the rest of the diagonal; a diagonal's 5s all in one box remove it
 *    from the rest of the box (the diagonal's own pointing and claiming).
 *  - Anti-Knight: a knight's move. A box's two places for 5 can both be a
 *    knight's move (or a row, column...) from one cell elsewhere, which then
 *    can't be 5. This is the workhorse of Anti-Knight solving - most of what
 *    the rule gives beyond singles.
 *
 * It is one rule for both, on purpose: it asks sharesHouseOrLink (the same
 * "a digit can't be in both cells" test every colouring and chain finder
 * uses), so a new variant that adds links there gets its locked candidates
 * here without new code.
 *
 * What is left out is what the Classic finder already reports: a row, column
 * or box whose places are all seen through rows, columns and boxes alone.
 */
export class SudokuVariantLockedFinder {
  find(board: Board, candidates: CandidateGrid): VariantLockedInstance[] {
    if (!hasDiagonals() && !isAntiKnight()) {
      return []
    }
    const units = sudokuUnits()
    const out: VariantLockedInstance[] = []
    // The same cells can be a digit's only places in two units at once (a
    // row and a box); one row per (digit, cells) is enough.
    const seen = new Set<string>()
    for (let digit = 1; digit <= BOARD_SIZE; digit++) {
      units.forEach((unit, unitIndex) => {
        if (unit.some(([r, c]) => board[r][c] === digit)) {
          return
        }
        const places = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1])
        // One place is a hidden single (the Classic finder's); none is a
        // broken grid.
        if (places.length < 2) {
          return
        }
        const isDiagonalUnit = unitIndex >= 3 * BOARD_SIZE
        const eliminations: VariantLockedInstance['eliminations'] = []
        let usesKnight = false
        for (let row = 0; row < BOARD_SIZE; row++) {
          for (let col = 0; col < BOARD_SIZE; col++) {
            if (board[row][col] !== 0 || !candidates[row][col][digit - 1]) {
              continue
            }
            if (places.some(([r, c]) => (r === row && c === col) || !sharesHouseOrLink(row, col, r, c))) {
              continue
            }
            // Row/column/box links only, into a row/column/box: Pointing or
            // Claiming, already listed as a Classic Locked Candidate.
            const plain = places.every(([r, c]) => r === row || c === col || sameBox(row, col, r, c))
            if (plain && !isDiagonalUnit) {
              continue
            }
            usesKnight ||= places.some(([r, c]) => r !== row && c !== col && !sameBox(row, col, r, c) && knightLinked(row, col, r, c))
            eliminations.push({ row, col, digit })
          }
        }
        if (eliminations.length === 0) {
          return
        }
        const key = `${digit}|${places.map(([r, c]) => r * BOARD_SIZE + c).join(',')}`
        if (seen.has(key)) {
          return
        }
        seen.add(key)
        const name = unitLabel(unitIndex)
        out.push({
          kind: usesKnight ? 'knight' : 'diagonal',
          digit,
          unitIndex,
          unitName: name,
          lockedCells: places,
          eliminations,
          reasonText: `${digit} in ${name} can only go in ${places.map(([r, c]) => `r${r + 1}c${c + 1}`).join(', ')}`,
        })
      })
    }
    // Fewest places first: the easiest to spot.
    return out.sort((a, b) => a.lockedCells.length - b.lockedCells.length)
  }
}
