import { activeConstraints, cageFillings, seesCell, type Cell, type KillerCage } from './SudokuConstraints'
import type { CandidateElimination } from './SudokuPairFinder'
import type { Board, CandidateGrid } from './types'

/**
 * What one Killer cage says about its own cells - the Variant solver's own
 * techniques (a Classic grid has no cages, so none of this is ever found
 * there). Three forms, one per `kind`:
 *
 *  - 'sum': the cage has one empty cell left, so it is the sum minus the
 *    rest ("Cage Sum").
 *  - 'combinations': some candidate of a cage cell is in no way of filling
 *    the cage - different digits, each from its own cell's candidates, adding
 *    up to the sum - so it goes ("Cage Combinations"). This is the cage sum
 *    as a logical deduction on the candidate grid; every Classic technique
 *    then runs on what is left.
 *  - 'locked': every way of filling the cage uses some digit, so one of the
 *    cage's cells holds it, and any cell outside the cage seeing all the
 *    cage cells that could hold it can't ("Cage Locked Candidate" - the
 *    cage acting as a pointing group).
 *
 * Like every finder it trusts the candidates as given and never mutates.
 */
export type KillerCageKind = 'sum' | 'combinations' | 'locked'

export interface KillerCageInstance {
  kind: KillerCageKind
  /** Index into activeConstraints().cages. */
  cageIndex: number
  cage: KillerCage
  /** The cage's still-empty cells, in reading order. */
  emptyCells: Cell[]
  /** Every set of digits the empty cells can still be filled with (ascending
   * digits, sets in ascending order) - what the explanation lists. */
  combinations: number[][]
  /** 'locked' only: the digit every combination uses, and the cage cells
   * that can hold it. */
  lockedDigit: number | null
  lockedCells: Cell[]
  eliminations: CandidateElimination[]
  /** 'sum' only: the one empty cell and its digit. */
  solved: CandidateElimination | null
  /** The reasoning without its conclusion - callers add their own. */
  reasonText: string
}

const cellRef = ([row, col]: Cell) => `r${row + 1}c${col + 1}`

const cellsText = (cells: readonly Cell[]) => cells.map(cellRef).join(', ')

function digitsOf(mask: number): number[] {
  const digits: number[] = []
  for (let d = 0; d < 9; d++) {
    if (mask & (1 << d)) {
      digits.push(d + 1)
    }
  }
  return digits
}

/** "a cage of 3 cells summing to 15 (r1c1, r1c2, r2c1)". */
export function killerCageLabel(cage: KillerCage): string {
  return cage.cells.length === 1
    ? `the single-cell cage ${cellRef(cage.cells[0])} = ${cage.sum}`
    : `the ${cage.sum}-cage (${cellsText(cage.cells)})`
}

function combinationsText(combinations: readonly number[][]): string {
  const sets = combinations.map((digits) => `{${digits.join(',')}}`)
  if (sets.length > 8) {
    return `one of ${sets.length} digit sets`
  }
  return sets.length <= 1 ? sets.join('') : `${sets.slice(0, -1).join(', ')} or ${sets[sets.length - 1]}`
}

interface CageAnalysis {
  emptyCells: Cell[]
  /** Per empty cell: the candidates (bitmask) that are part of some way of
   * filling the whole cage. */
  supported: number[]
  /** Per empty cell: its marked candidates (bitmask). */
  marked: number[]
  /** Every complete digit mask (placed digits included) the cage can end on. */
  finalMasks: number[]
  placedMask: number
}

/** Which candidates of a cage's empty cells take part in at least one way of
 * filling it (cageFillings, with the placed digits as cells that have just
 * that digit). Null when the cage can't be judged: an empty cell with no
 * candidates marked (the marks are incomplete), or no filling left at all
 * (the grid is already wrong, which isn't this finder's call). */
function analyseCage(cage: KillerCage, board: Board, candidates: CandidateGrid): CageAnalysis | null {
  let placedMask = 0
  const emptyCells: Cell[] = []
  const marked: number[] = []
  const placed: number[] = []
  for (const [row, col] of cage.cells) {
    const value = board[row][col]
    if (value !== 0) {
      placedMask |= 1 << (value - 1)
      placed.push(1 << (value - 1))
      continue
    }
    let mask = 0
    for (let d = 0; d < 9; d++) {
      if (candidates[row][col][d]) {
        mask |= 1 << d
      }
    }
    if (mask === 0) {
      return null
    }
    emptyCells.push([row, col])
    marked.push(mask)
  }
  if (emptyCells.length === 0) {
    return null
  }
  // Empty cells first, so their answers are the first entries.
  const fillings = cageFillings([...marked, ...placed], cage.sum)
  if (!fillings) {
    return null
  }
  return { emptyCells, supported: fillings.supported.slice(0, emptyCells.length), marked, finalMasks: fillings.finalMasks, placedMask }
}

export class SudokuKillerCageFinder {
  find(board: Board, candidates: CandidateGrid): KillerCageInstance[] {
    const sums: KillerCageInstance[] = []
    const combinations: KillerCageInstance[] = []
    const locked: KillerCageInstance[] = []

    activeConstraints().cages.forEach((cage, cageIndex) => {
      const analysis = analyseCage(cage, board, candidates)
      if (!analysis) {
        return
      }
      const { emptyCells, supported, marked, finalMasks, placedMask } = analysis
      const combos = finalMasks
        .map((mask) => digitsOf(mask & ~placedMask))
        .sort((a, b) => a.join('').localeCompare(b.join('')))
      const placedCells = cage.cells.filter(([row, col]) => board[row][col] !== 0)
      const base = { cageIndex, cage, emptyCells, combinations: combos }

      const eliminations: CandidateElimination[] = []
      emptyCells.forEach(([row, col], i) => {
        for (const digit of digitsOf(marked[i] & ~supported[i])) {
          eliminations.push({ row, col, digit })
        }
      })

      if (emptyCells.length === 1) {
        // One cell left: a placement, whether or not its marks say more.
        const [row, col] = emptyCells[0]
        const digit = digitsOf(supported[0])[0]
        const rest =
          placedCells.length === 0
            ? ''
            : ` and ${placedCells.length === 1 ? `${cellRef(placedCells[0])} is` : `its other cells add up to`} ${cage.sum - digit}`
        sums.push({
          ...base,
          kind: 'sum',
          lockedDigit: null,
          lockedCells: [],
          eliminations,
          solved: { row, col, digit },
          reasonText:
            cage.cells.length === 1
              ? `${cellRef(emptyCells[0])} is a cage by itself, summing to ${cage.sum}`
              : `${killerCageLabel(cage)} sums to ${cage.sum}${rest}`,
        })
        return
      }

      if (eliminations.length > 0) {
        const filled =
          placedCells.length > 0 ? `, with ${cellsText(placedCells)} already filled (${placedCells.map(([r, c]) => board[r][c]).join(', ')})` : ''
        combinations.push({
          ...base,
          kind: 'combinations',
          lockedDigit: null,
          lockedCells: [],
          eliminations,
          solved: null,
          reasonText: `${killerCageLabel(cage)}${filled} can only hold ${combinationsText(combos)} in ${cellsText(emptyCells)}, each digit in a cell that still has it`,
        })
      }

      // Cage Locked Candidate, worked out on what the combinations leave.
      let required = 511 & ~placedMask
      for (const mask of finalMasks) {
        required &= mask
      }
      for (const digit of digitsOf(required)) {
        const holders = emptyCells.filter((_, i) => supported[i] & (1 << (digit - 1)))
        const outside: CandidateElimination[] = []
        for (let row = 0; row < 9; row++) {
          for (let col = 0; col < 9; col++) {
            if (
              board[row][col] === 0 &&
              candidates[row][col][digit - 1] &&
              !cage.cells.some(([r, c]) => r === row && c === col) &&
              holders.every(([r, c]) => seesCell(row, col, r, c))
            ) {
              outside.push({ row, col, digit })
            }
          }
        }
        if (outside.length > 0) {
          locked.push({
            ...base,
            kind: 'locked',
            lockedDigit: digit,
            lockedCells: holders,
            eliminations: outside,
            solved: null,
            reasonText: `${killerCageLabel(cage)} needs a ${digit} whichever way it is filled (${combinationsText(combos)}), in ${cellsText(holders)}`,
          })
        }
      }
    })

    return [...sums, ...combinations, ...locked]
  }
}

/** Shared by the instance builders: "r1c2 is not 4, r1c3 is not [5,6]". */
export function killerEliminationsText(eliminations: readonly CandidateElimination[]): string {
  const byCell = new Map<string, { row: number; col: number; digits: number[] }>()
  for (const { row, col, digit } of eliminations) {
    const key = `${row},${col}`
    const entry = byCell.get(key) ?? { row, col, digits: [] }
    entry.digits.push(digit)
    byCell.set(key, entry)
  }
  return [...byCell.values()]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map(({ row, col, digits }) => {
      const sorted = [...digits].sort((a, b) => a - b)
      return `${cellRef([row, col])} is not ${sorted.length === 1 ? sorted[0] : `[${sorted.join(',')}]`}`
    })
    .join(', ')
}
