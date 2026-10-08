import {
  ENTROPY_GROUP_DIGITS,
  ENTROPY_GROUP_MASKS,
  ENTROPY_GROUP_NAMES,
  ENTROPY_SQUARES,
  entropyGroupOf,
  entropyGroupsOfMask,
  isEntropy,
  type Cell,
} from './SudokuConstraints'
import { BOARD_SIZE } from './SudokuRules'
import type { Board, CandidateGrid } from './types'

export interface EntropySquareInstance {
  /** 'single': one group has one cell left in the square that can hold it.
   * 'pair': two groups have, between them, only two cells left. */
  kind: 'single' | 'pair'
  /** The 2x2 square's four cells: top-left, top-right, bottom-left,
   * bottom-right. */
  square: Cell[]
  /** The group(s) (0 low, 1 middle, 2 high) the holders are tied to. */
  groups: number[]
  /** The cell(s) that must hold those groups, in the square's order. */
  holders: Cell[]
  eliminations: { row: number; col: number; digit: number }[]
  /** "In the 2x2 square r1c1-r2c2, only r2c2 can still hold a high digit
   * (7-9)", conclusion-free. */
  reasonText: string
}

/**
 * Variant solver only (Entropy Sudoku; finds nothing on any other grid): what
 * one 2x2 square says about its own cells.
 *
 * Every 2x2 square must hold a low (1-3), a middle (4-6) and a high (7-9)
 * digit. Four cells, three groups: each group needs a cell of its own. So
 *  - a group that only one cell of the square can still hold belongs to
 *    that cell, which loses its digits of the other two groups;
 *  - two groups that only the same two cells can still hold take those two
 *    cells, one each, which lose their digits of the third group.
 * That is all a square can say by itself: a group is impossible in a cell
 * exactly when giving it that group leaves the other two groups without a
 * cell each among the other three, which is one of the two cases above
 * (checked against the exhaustive ENTROPY_SUPPORT table by
 * dragon-research/entropy/sweep.ts).
 *
 * A solved cell counts as holding its digit's group only. What a square's
 * *placed* digits say is not this technique's: Autofill (SudokuRules.isSafe
 * -> entropyAllows) and every placement (eliminatePeerCandidates ->
 * entropyCancelAround) already keep that out of the candidates, as they keep
 * a placed digit out of its row - the rating does the same (free
 * bookkeeping, variant-rating/RATINGS.md). This finder is the rule on the
 * candidates, where it takes looking.
 */
export class SudokuEntropyFinder {
  find(board: Board, candidates: CandidateGrid): EntropySquareInstance[] {
    if (!isEntropy()) {
      return []
    }
    const out: EntropySquareInstance[] = []
    for (const square of ENTROPY_SQUARES) {
      // Per cell of the square: the groups it can still hold (bit 0 low,
      // 1 middle, 2 high).
      const groupSets = square.map(([row, col]) => {
        if (board[row][col] !== 0) {
          return 1 << entropyGroupOf(board[row][col])
        }
        let mask = 0
        for (let digit = 1; digit <= BOARD_SIZE; digit++) {
          if (candidates[row][col][digit - 1]) {
            mask |= 1 << (digit - 1)
          }
        }
        return entropyGroupsOfMask(mask)
      })
      // An unmarked empty cell (no candidates yet) says nothing; a square
      // with one is left alone rather than read as broken.
      if (groupSets.some((set) => set === 0)) {
        continue
      }
      const holdersOf = (groups: number) => [0, 1, 2, 3].filter((i) => groupSets[i] & groups)
      const single = [0, 1, 2].map((group) => holdersOf(1 << group))
      if (single.some((holders) => holders.length === 0)) {
        // No cell left for a group: the grid is already wrong. Not ours to say.
        continue
      }
      for (let group = 0; group < 3; group++) {
        if (single[group].length === 1) {
          this.push(out, board, candidates, square, 'single', [group], single[group])
        }
      }
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 3; b++) {
          // Each of the two has two holders and they are the same two cells.
          // (One with a single holder is the case above, and what is left
          // of the other follows from it on the next look.)
          const holders = holdersOf((1 << a) | (1 << b))
          if (holders.length === 2 && single[a].length === 2 && single[b].length === 2) {
            this.push(out, board, candidates, square, 'pair', [a, b], holders)
          }
        }
      }
    }
    return out
  }

  private push(
    out: EntropySquareInstance[],
    board: Board,
    candidates: CandidateGrid,
    square: readonly Cell[],
    kind: 'single' | 'pair',
    groups: number[],
    holderIndexes: number[],
  ): void {
    const keep = groups.reduce((mask, group) => mask | ENTROPY_GROUP_MASKS[group], 0)
    const holders = holderIndexes.map((i) => square[i])
    const eliminations: EntropySquareInstance['eliminations'] = []
    for (const [row, col] of holders) {
      if (board[row][col] !== 0) {
        continue
      }
      for (let digit = 1; digit <= BOARD_SIZE; digit++) {
        if (candidates[row][col][digit - 1] && !(keep & (1 << (digit - 1)))) {
          eliminations.push({ row, col, digit })
        }
      }
    }
    if (eliminations.length === 0) {
      return
    }
    const [top, left] = square[0]
    const where = `the 2x2 square r${top + 1}c${left + 1}-r${top + 2}c${left + 2}`
    const cell = ([row, col]: Cell) => `r${row + 1}c${col + 1}`
    const named = (group: number) => `${ENTROPY_GROUP_NAMES[group]} digit (${ENTROPY_GROUP_DIGITS[group]})`
    out.push({
      kind,
      square: [...square],
      groups,
      holders,
      eliminations,
      reasonText:
        kind === 'single'
          ? `in ${where}, only ${cell(holders[0])} can still hold a ${named(groups[0])}`
          : `in ${where}, only ${cell(holders[0])} and ${cell(holders[1])} can still hold a ${named(groups[0])} or a ${named(groups[1])}, so one of them is ${ENTROPY_GROUP_NAMES[groups[0]]} and the other ${ENTROPY_GROUP_NAMES[groups[1]]}`,
    })
  }
}
