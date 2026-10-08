import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE } from './SudokuRules'
import { boxCells, boxOf, type Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export interface LockedCandidateInstance {
  type: 'pointing' | 'claiming'
  digit: number
  /** The cells the digit is confined to - the box's cells on that
   * row/column for Pointing, or the row/column's cells in that box for
   * Claiming. */
  basisCells: Cell[]
  eliminations: CandidateElimination[]
}

/** A box's cells ordered column first, then row. */
function boxCellsByColumn(box: number): Cell[] {
  return [...boxCells(box)].sort((a, b) => a[1] - b[1] || a[0] - b[0])
}

/**
 * Locked Candidates, in its two forms:
 *  - Pointing: within a box, if every remaining candidate for a digit sits
 *    in a single row (or column), that digit can't be the solution to any
 *    other cell of that row (or column) outside the box, since one of the
 *    box's own cells must hold it.
 *  - Claiming: within a row (or column), if every remaining candidate for a
 *    digit sits in a single box, that digit can't be the solution to any
 *    other cell of that box, since one of the row's (or column's) own
 *    cells must hold it.
 *
 * "Box" is whatever the active constraints say it is (SudokuUnits.ts): both
 * forms only need "a box and a line are two units of nine cells that
 * overlap", so on a Jigsaw the same logic runs on its irregular regions - a
 * region's candidates for a digit all on one row, or a row's all inside one
 * region - with nothing else changed.
 */
export class SudokuLockedCandidateFinder {
  findPointingInstances(board: Board, candidates: CandidateGrid): LockedCandidateInstance[] {
    const instances: LockedCandidateInstance[] = []

    for (let box = 0; box < BOARD_SIZE; box++) {
      const unsolvedBoxCells = boxCells(box).filter(([row, col]) => board[row][col] === 0)

      for (let digit = 1; digit <= BOARD_SIZE; digit++) {
        const holders = unsolvedBoxCells.filter(([row, col]) => candidates[row][col][digit - 1])
        if (holders.length < 2) {
          continue
        }

        const rows = new Set(holders.map(([row]) => row))
        const cols = new Set(holders.map(([, col]) => col))

        if (rows.size === 1) {
          const [row] = rows
          const eliminations: CandidateElimination[] = []
          for (let col = 0; col < BOARD_SIZE; col++) {
            if (boxOf(row, col) === box) {
              continue
            }
            if (candidates[row][col][digit - 1]) {
              eliminations.push({ row, col, digit })
            }
          }
          if (eliminations.length > 0) {
            instances.push({ type: 'pointing', digit, basisCells: holders, eliminations })
          }
        }

        if (cols.size === 1) {
          const [col] = cols
          const eliminations: CandidateElimination[] = []
          for (let row = 0; row < BOARD_SIZE; row++) {
            if (boxOf(row, col) === box) {
              continue
            }
            if (candidates[row][col][digit - 1]) {
              eliminations.push({ row, col, digit })
            }
          }
          if (eliminations.length > 0) {
            instances.push({ type: 'pointing', digit, basisCells: holders, eliminations })
          }
        }
      }
    }

    return instances
  }

  findClaimingInstances(board: Board, candidates: CandidateGrid): LockedCandidateInstance[] {
    const instances: LockedCandidateInstance[] = []

    for (let row = 0; row < BOARD_SIZE; row++) {
      const rowCells: Cell[] = []
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] === 0) {
          rowCells.push([row, col])
        }
      }

      for (let digit = 1; digit <= BOARD_SIZE; digit++) {
        const holders = rowCells.filter(([, col]) => candidates[row][col][digit - 1])
        if (holders.length < 2) {
          continue
        }

        const boxes = new Set(holders.map(([, col]) => boxOf(row, col)))
        if (boxes.size !== 1) {
          continue
        }
        const [box] = boxes

        // The box's other cells, row by row (reading order).
        const eliminations: CandidateElimination[] = []
        for (const [r, c] of boxCells(box)) {
          if (r !== row && candidates[r][c][digit - 1]) {
            eliminations.push({ row: r, col: c, digit })
          }
        }
        if (eliminations.length > 0) {
          instances.push({ type: 'claiming', digit, basisCells: holders, eliminations })
        }
      }
    }

    for (let col = 0; col < BOARD_SIZE; col++) {
      const colCells: Cell[] = []
      for (let row = 0; row < BOARD_SIZE; row++) {
        if (board[row][col] === 0) {
          colCells.push([row, col])
        }
      }

      for (let digit = 1; digit <= BOARD_SIZE; digit++) {
        const holders = colCells.filter(([row]) => candidates[row][col][digit - 1])
        if (holders.length < 2) {
          continue
        }

        const boxes = new Set(holders.map(([row]) => boxOf(row, col)))
        if (boxes.size !== 1) {
          continue
        }
        const [box] = boxes

        // The box's other cells, column by column - the order this list has
        // always been in (the instances are compared step by step in the
        // equivalence sweeps).
        const eliminations: CandidateElimination[] = []
        for (const [r, c] of boxCellsByColumn(box)) {
          if (c !== col && candidates[r][c][digit - 1]) {
            eliminations.push({ row: r, col: c, digit })
          }
        }
        if (eliminations.length > 0) {
          instances.push({ type: 'claiming', digit, basisCells: holders, eliminations })
        }
      }
    }

    return instances
  }

  findInstances(board: Board, candidates: CandidateGrid): LockedCandidateInstance[] {
    return [...this.findPointingInstances(board, candidates), ...this.findClaimingInstances(board, candidates)]
  }

  findEliminations(board: Board, candidates: CandidateGrid): CandidateElimination[] {
    const eliminations = new Map<string, CandidateElimination>()
    for (const instance of this.findInstances(board, candidates)) {
      for (const elimination of instance.eliminations) {
        eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination)
      }
    }
    return Array.from(eliminations.values())
  }
}
