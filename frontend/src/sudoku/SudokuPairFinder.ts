import { markedCandidateDigits } from './boardUtils'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import type { Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export interface CandidateElimination {
  row: number
  col: number
  digit: number
}

export interface NakedPairInstance {
  /** The two cells sharing the exact same two candidates. */
  cells: readonly [Cell, Cell]
  /** The two candidates, ascending. */
  digits: readonly [number, number]
  /** Every currently-marked candidate this pair proves can't be there. */
  eliminations: CandidateElimination[]
}

/**
 * Naked pairs: when two cells in the same row, column, or box have the
 * exact same two candidates and nothing else, one of those cells must be
 * each of those two digits - which cell gets which isn't determined yet,
 * but either way neither digit can be a candidate anywhere else in that
 * unit, so they can be eliminated from the rest of the unit's cells.
 */
export class SudokuPairFinder {
  findNakedPairs(board: Board, candidates: CandidateGrid): NakedPairInstance[] {
    const unsolved: Cell[] = []
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] === 0) {
          unsolved.push([row, col])
        }
      }
    }

    const instances: NakedPairInstance[] = []

    for (let i = 0; i < unsolved.length; i++) {
      const [rowA, colA] = unsolved[i]
      const digitsA = markedCandidateDigits(candidates[rowA][colA])
      if (digitsA.length !== 2) {
        continue
      }

      for (let j = i + 1; j < unsolved.length; j++) {
        const [rowB, colB] = unsolved[j]
        const digitsB = markedCandidateDigits(candidates[rowB][colB])
        if (digitsB.length !== 2 || digitsA[0] !== digitsB[0] || digitsA[1] !== digitsB[1]) {
          continue
        }

        const peers = this.sharedPeerCells(rowA, colA, rowB, colB)
        if (peers.length === 0) {
          // Same two candidates, but no shared row/column/box - coincidence, not a naked pair.
          continue
        }

        const eliminations: CandidateElimination[] = []
        for (const [r, c] of peers) {
          for (const digit of digitsA) {
            if (candidates[r][c][digit - 1]) {
              eliminations.push({ row: r, col: c, digit })
            }
          }
        }
        if (eliminations.length === 0) {
          continue
        }

        instances.push({
          cells: [
            [rowA, colA],
            [rowB, colB],
          ],
          digits: [digitsA[0], digitsA[1]],
          eliminations,
        })
      }
    }

    return instances
  }

  /** Every unsolved cell that shares a row, column, or box with both
   * (rowA, colA) and (rowB, colB) - i.e. every cell a naked pair between
   * them would affect - deduplicated (a pair can share up to two units,
   * e.g. same row and same box, without double-counting a peer in both). */
  private sharedPeerCells(rowA: number, colA: number, rowB: number, colB: number): Cell[] {
    const peers = new Map<string, Cell>()
    const addUnlessPair = (row: number, col: number) => {
      if ((row === rowA && col === colA) || (row === rowB && col === colB)) {
        return
      }
      peers.set(`${row},${col}`, [row, col])
    }

    if (rowA === rowB) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        addUnlessPair(rowA, col)
      }
    }
    if (colA === colB) {
      for (let row = 0; row < BOARD_SIZE; row++) {
        addUnlessPair(row, colA)
      }
    }
    const boxRowA = Math.floor(rowA / BOX_SIZE)
    const boxColA = Math.floor(colA / BOX_SIZE)
    if (boxRowA === Math.floor(rowB / BOX_SIZE) && boxColA === Math.floor(colB / BOX_SIZE)) {
      const boxRow = boxRowA * BOX_SIZE
      const boxCol = boxColA * BOX_SIZE
      for (let dr = 0; dr < BOX_SIZE; dr++) {
        for (let dc = 0; dc < BOX_SIZE; dc++) {
          addUnlessPair(boxRow + dr, boxCol + dc)
        }
      }
    }

    return Array.from(peers.values())
  }

  findNakedPairEliminations(board: Board, candidates: CandidateGrid): CandidateElimination[] {
    const eliminations = new Map<string, CandidateElimination>()
    for (const pair of this.findNakedPairs(board, candidates)) {
      for (const elimination of pair.eliminations) {
        eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination)
      }
    }
    return Array.from(eliminations.values())
  }

  /**
   * True once every unsolved cell has at least one candidate marked.
   * Naked-pair elimination assumes a complete candidate picture - a blank,
   * not-yet-marked cell would otherwise look the same as a genuinely
   * exhausted one, and eliminations computed against incomplete marks
   * wouldn't reliably hold once the rest get filled in.
   */
  hasFullCandidates(board: Board, candidates: CandidateGrid): boolean {
    for (let row = 0; row < board.length; row++) {
      for (let col = 0; col < board[row].length; col++) {
        if (board[row][col] === 0 && !candidates[row][col].some(Boolean)) {
          return false
        }
      }
    }
    return true
  }
}
