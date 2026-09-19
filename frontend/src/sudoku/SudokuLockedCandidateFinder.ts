import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import type { Cell } from './SudokuUnits'
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
 */
export class SudokuLockedCandidateFinder {
  findPointingInstances(board: Board, candidates: CandidateGrid): LockedCandidateInstance[] {
    const instances: LockedCandidateInstance[] = []

    for (let boxRow = 0; boxRow < BOX_SIZE; boxRow++) {
      for (let boxCol = 0; boxCol < BOX_SIZE; boxCol++) {
        const boxCells: Cell[] = []
        for (let dr = 0; dr < BOX_SIZE; dr++) {
          for (let dc = 0; dc < BOX_SIZE; dc++) {
            const row = boxRow * BOX_SIZE + dr
            const col = boxCol * BOX_SIZE + dc
            if (board[row][col] === 0) {
              boxCells.push([row, col])
            }
          }
        }

        for (let digit = 1; digit <= BOARD_SIZE; digit++) {
          const holders = boxCells.filter(([row, col]) => candidates[row][col][digit - 1])
          if (holders.length < 2) {
            continue
          }

          const rows = new Set(holders.map(([row]) => row))
          const cols = new Set(holders.map(([, col]) => col))

          if (rows.size === 1) {
            const [row] = rows
            const eliminations: CandidateElimination[] = []
            for (let col = 0; col < BOARD_SIZE; col++) {
              if (Math.floor(col / BOX_SIZE) === boxCol) {
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
              if (Math.floor(row / BOX_SIZE) === boxRow) {
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

        const boxCols = new Set(holders.map(([, col]) => Math.floor(col / BOX_SIZE)))
        if (boxCols.size !== 1) {
          continue
        }
        const [boxCol] = boxCols
        const boxRow = Math.floor(row / BOX_SIZE)

        const eliminations: CandidateElimination[] = []
        for (let dr = 0; dr < BOX_SIZE; dr++) {
          const r = boxRow * BOX_SIZE + dr
          if (r === row) {
            continue
          }
          for (let dc = 0; dc < BOX_SIZE; dc++) {
            const c = boxCol * BOX_SIZE + dc
            if (candidates[r][c][digit - 1]) {
              eliminations.push({ row: r, col: c, digit })
            }
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

        const boxRows = new Set(holders.map(([row]) => Math.floor(row / BOX_SIZE)))
        if (boxRows.size !== 1) {
          continue
        }
        const [boxRow] = boxRows
        const boxCol = Math.floor(col / BOX_SIZE)

        const eliminations: CandidateElimination[] = []
        for (let dc = 0; dc < BOX_SIZE; dc++) {
          const c = boxCol * BOX_SIZE + dc
          if (c === col) {
            continue
          }
          for (let dr = 0; dr < BOX_SIZE; dr++) {
            const r = boxRow * BOX_SIZE + dr
            if (candidates[r][c][digit - 1]) {
              eliminations.push({ row: r, col: c, digit })
            }
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
