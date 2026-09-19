import { markedCandidateDigits } from './boardUtils'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import type { Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export interface UniqueRectangleType1Instance {
  /** All four UR cells, for highlighting - the three plain ones first, the
   * extra-candidate one last (also available as `extraCell`). */
  cells: readonly [Cell, Cell, Cell, Cell]
  /** The two candidates shared by all four cells. */
  urDigits: readonly [number, number]
  /** The one cell of the four holding more than just the two UR digits. */
  extraCell: Cell
  /** Whatever `extraCell` holds beyond the two UR digits. */
  extraCandidates: number[]
  /** Set when there's exactly one extra candidate - it must be the
   * solution, or the deadly pattern's other three cells would leave more
   * than one valid completion. */
  solvedDigit: number | null
  /** Set (to both UR digits) when there are two or more extra candidates -
   * neither UR digit can be the solution here without leaving the other
   * three cells free to complete the deadly pattern two different ways. */
  eliminatedDigits: number[]
}

/**
 * Unique Rectangle Type 1: a "deadly pattern" is four cells spanning
 * exactly two rows, two columns, and two boxes, where the same two
 * candidates (the "UR digits") could legally go in all four - if every one
 * of those four cells had only those two candidates left, the puzzle would
 * have (at least) two valid solutions, swapping the digits diagonally
 * between the two rows. Since a well-formed Sudoku has exactly one
 * solution, this configuration can never actually be reached - so if three
 * of the four cells already show only the two UR digits and the fourth
 * holds them plus something extra, that extra is the only thing keeping
 * the pattern from being deadly:
 *  - exactly one extra candidate: it must be the cell's solution.
 *  - two or more: neither UR digit can be this cell's solution, so both
 *    are eliminated from it (leaving only the extra candidates).
 */
export class SudokuUniqueRectangleFinder {
  findType1Instances(board: Board, candidates: CandidateGrid): UniqueRectangleType1Instance[] {
    const instances: UniqueRectangleType1Instance[] = []

    for (let r1 = 0; r1 < BOARD_SIZE - 1; r1++) {
      for (let r2 = r1 + 1; r2 < BOARD_SIZE; r2++) {
        const sameBoxRow = Math.floor(r1 / BOX_SIZE) === Math.floor(r2 / BOX_SIZE)
        for (let c1 = 0; c1 < BOARD_SIZE - 1; c1++) {
          for (let c2 = c1 + 1; c2 < BOARD_SIZE; c2++) {
            const sameBoxCol = Math.floor(c1 / BOX_SIZE) === Math.floor(c2 / BOX_SIZE)
            // Exactly two boxes among the four cells: rows share a box-band
            // xor columns do - both true puts all four in one box, both
            // false spreads them across four boxes.
            if (sameBoxRow === sameBoxCol) {
              continue
            }

            const cells: [Cell, Cell, Cell, Cell] = [
              [r1, c1],
              [r1, c2],
              [r2, c1],
              [r2, c2],
            ]
            if (cells.some(([r, c]) => board[r][c] !== 0)) {
              continue
            }

            const instance = this.findType1ForCells(candidates, cells)
            if (instance) {
              instances.push(instance)
            }
          }
        }
      }
    }

    return instances
  }

  private findType1ForCells(
    candidates: CandidateGrid,
    cells: [Cell, Cell, Cell, Cell],
  ): UniqueRectangleType1Instance | null {
    const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))

    const bivalueGroups = new Map<string, Cell[]>()
    for (let i = 0; i < 4; i++) {
      if (cellDigits[i].length !== 2) {
        continue
      }
      const key = cellDigits[i].join(',')
      const group = bivalueGroups.get(key) ?? []
      group.push(cells[i])
      bivalueGroups.set(key, group)
    }

    for (const [key, group] of bivalueGroups) {
      if (group.length !== 3) {
        // All four sharing the pair is an unavoidable deadly pattern (not
        // fixable by Type 1); fewer than three isn't this pattern at all.
        continue
      }
      const [a, b] = key.split(',').map(Number)
      const extraCell = cells.find((cell) => !group.includes(cell))!
      const [er, ec] = extraCell
      const extraCellDigits = markedCandidateDigits(candidates[er][ec])
      if (!extraCellDigits.includes(a) || !extraCellDigits.includes(b)) {
        continue
      }
      const extraCandidates = extraCellDigits.filter((d) => d !== a && d !== b)
      if (extraCandidates.length === 0) {
        continue
      }

      return {
        cells,
        urDigits: [a, b],
        extraCell,
        extraCandidates,
        solvedDigit: extraCandidates.length === 1 ? extraCandidates[0] : null,
        eliminatedDigits: extraCandidates.length >= 2 ? [a, b] : [],
      }
    }

    return null
  }
}
