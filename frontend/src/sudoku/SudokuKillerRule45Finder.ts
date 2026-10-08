import { activeConstraints, boxCells, boxWord, cageOf, cannotRepeat, type Cell } from './SudokuConstraints'
import type { CandidateElimination } from './SudokuPairFinder'
import type { Board, CandidateGrid } from './types'

/**
 * The Rule of 45 ("innies and outies"), the Killer technique that ties the
 * cages to the Classic units: every row, column and box (Jigsaw region)
 * holds 1-9 once, so it sums to 45, and N of them that don't overlap sum to
 * 45 x N. Compare that with the cages lying over them:
 *
 *  - Innies: subtract the cages lying wholly inside the houses. What is left
 *    is the total of the houses' other cells - the parts of cages that stick
 *    out of them, and any cell in no cage.
 *  - Outies: when cages cover the houses completely, add up every cage that
 *    touches them and subtract 45 x N. What is left is the total of those
 *    cages' cells *outside* the houses.
 *
 * Either way a handful of cells get a sum of their own - a cage nobody drew.
 * One such cell is a placement; several lose every candidate that takes part
 * in no way of reaching the sum (cells that can't repeat a digit - same row,
 * column, box or cage - get different digits; the others may repeat).
 *
 * The houses tried are every run of neighbouring rows, every run of
 * neighbouring columns, each box/region, and each pair of touching ones -
 * the shapes a solver looks at. Like every finder it trusts the candidates
 * as given and never mutates.
 */
export interface KillerRule45Instance {
  kind: 'innie' | 'outie'
  /** "row 3", "rows 1-2", "columns 4-6", "box 5", "boxes 1 and 2". */
  housesLabel: string
  /** Every cell of the houses - highlighted as the technique's area. */
  houseCells: Cell[]
  /** 45 x the number of houses. */
  housesTotal: number
  /** Innie: the cages wholly inside add up to this. Outie: every cage
   * touching the houses does. */
  cagesTotal: number
  /** The innies/outies, solved ones included, in reading order. */
  cells: Cell[]
  /** What `cells` add up to. */
  sum: number
  /** The ones still empty, and what they add up to. */
  emptyCells: Cell[]
  emptySum: number
  eliminations: CandidateElimination[]
  /** Set when there is exactly one empty cell. */
  solved: CandidateElimination | null
  /** The reasoning without its conclusion - callers add their own. */
  reasonText: string
}

/** More empty innies/outies than this is a sum too loose to say anything
 * (and 9^N fillings to try): a solver works with one to four. */
const MAX_EMPTY_CELLS = 4

const cellRef = ([row, col]: Cell) => `r${row + 1}c${col + 1}`
const cellsText = (cells: readonly Cell[]) => cells.map(cellRef).join(', ')
const index = ([row, col]: Cell) => row * 9 + col

interface HouseSet {
  label: string
  cells: Cell[]
  houseCount: number
}

function houseSets(): HouseSet[] {
  const sets: HouseSet[] = []
  const range = (from: number, to: number) => (from === to ? `${from + 1}` : `${from + 1}-${to + 1}`)
  // Runs of rows / columns, shortest first - a result found from fewer
  // houses is the easier one to see, and wins the dedupe in find(). All nine
  // is the whole grid, which says nothing.
  for (let length = 1; length <= 8; length++) {
    for (let from = 0; from + length <= 9; from++) {
      const to = from + length - 1
      const rows: Cell[] = []
      const cols: Cell[] = []
      for (let line = from; line <= to; line++) {
        for (let cross = 0; cross < 9; cross++) {
          rows.push([line, cross])
          cols.push([cross, line])
        }
      }
      sets.push({ label: `${length === 1 ? 'row' : 'rows'} ${range(from, to)}`, cells: rows, houseCount: length })
      sets.push({ label: `${length === 1 ? 'column' : 'columns'} ${range(from, to)}`, cells: cols, houseCount: length })
    }
  }
  const word = boxWord()
  for (let box = 0; box < 9; box++) {
    sets.push({ label: `${word} ${box + 1}`, cells: boxCells(box), houseCount: 1 })
  }
  // Pairs of boxes/regions sharing an edge.
  for (let a = 0; a < 9; a++) {
    for (let b = a + 1; b < 9; b++) {
      const cellsB = new Set(boxCells(b).map(index))
      const touching = boxCells(a).some(
        ([row, col]) =>
          cellsB.has((row + 1) * 9 + col) || cellsB.has((row - 1) * 9 + col) || (col < 8 && cellsB.has(row * 9 + col + 1)) || (col > 0 && cellsB.has(row * 9 + col - 1)),
      )
      if (touching) {
        sets.push({ label: `${word === 'box' ? 'boxes' : 'regions'} ${a + 1} and ${b + 1}`, cells: [...boxCells(a), ...boxCells(b)], houseCount: 2 })
      }
    }
  }
  return sets.sort((p, q) => p.houseCount - q.houseCount)
}

/** Which candidates of `cells` take part in some way of making them add up
 * to `sum`, where cells that can't repeat a digit get different ones. Per
 * cell, a bitmask (bit digit-1). */
function supportedCandidates(cells: readonly Cell[], sum: number, candidates: CandidateGrid): number[] {
  const marks = cells.map(([row, col]) => candidates[row][col].reduce((mask, on, d) => (on ? mask | (1 << d) : mask), 0))
  const conflicts = cells.map((a, i) => cells.map((b, j) => i !== j && cannotRepeat(a[0], a[1], b[0], b[1])))
  const supported = new Array<number>(cells.length).fill(0)
  const chosen = new Array<number>(cells.length).fill(0)
  // The smallest/largest total the cells from i on can still add, ignoring
  // the no-repeat rule - enough to cut most dead branches early.
  const minRest = new Array<number>(cells.length + 1).fill(0)
  const maxRest = new Array<number>(cells.length + 1).fill(0)
  for (let i = cells.length - 1; i >= 0; i--) {
    const lowest = 32 - Math.clz32(marks[i] & -marks[i])
    const highest = 32 - Math.clz32(marks[i])
    minRest[i] = minRest[i + 1] + lowest
    maxRest[i] = maxRest[i + 1] + highest
  }
  const place = (i: number, remaining: number): boolean => {
    if (i === cells.length) {
      return remaining === 0
    }
    if (remaining < minRest[i] || remaining > maxRest[i]) {
      return false
    }
    let any = false
    for (let digit = 1; digit <= 9; digit++) {
      if ((marks[i] & (1 << (digit - 1))) === 0) {
        continue
      }
      let clash = false
      for (let j = 0; j < i; j++) {
        if (chosen[j] === digit && conflicts[i][j]) {
          clash = true
          break
        }
      }
      if (clash) {
        continue
      }
      chosen[i] = digit
      if (place(i + 1, remaining - digit)) {
        // Every cell's digit in this filling is supported - but the search
        // must go on, to find the fillings the other digits take part in.
        for (let j = 0; j <= i; j++) {
          supported[j] |= 1 << (chosen[j] - 1)
        }
        any = true
      }
    }
    return any
  }
  place(0, sum)
  return supported
}

export class SudokuKillerRule45Finder {
  find(board: Board, candidates: CandidateGrid): KillerRule45Instance[] {
    const cages = activeConstraints().cages
    if (cages.length === 0) {
      return []
    }
    const found = new Map<string, KillerRule45Instance>()

    for (const houses of houseSets()) {
      const inHouses = new Uint8Array(81)
      for (const cell of houses.cells) {
        inHouses[index(cell)] = 1
      }
      const housesTotal = 45 * houses.houseCount
      let insideTotal = 0
      let touchingTotal = 0
      const innies: Cell[] = []
      const outies: Cell[] = []
      const fullyCaged = houses.cells.every(([row, col]) => cageOf(row, col) >= 0)
      for (const cage of cages) {
        const inside = cage.cells.filter((cell) => inHouses[index(cell)])
        if (inside.length === 0) {
          continue
        }
        touchingTotal += cage.sum
        if (inside.length === cage.cells.length) {
          insideTotal += cage.sum
        } else {
          innies.push(...inside)
          outies.push(...cage.cells.filter((cell) => !inHouses[index(cell)]))
        }
      }
      innies.push(...houses.cells.filter(([row, col]) => cageOf(row, col) < 0))

      const groups: Array<{ kind: 'innie' | 'outie'; cells: Cell[]; sum: number; cagesTotal: number }> = [
        { kind: 'innie', cells: innies, sum: housesTotal - insideTotal, cagesTotal: insideTotal },
      ]
      if (fullyCaged) {
        groups.push({ kind: 'outie', cells: outies, sum: touchingTotal - housesTotal, cagesTotal: touchingTotal })
      }
      for (const group of groups) {
        const cells = [...group.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])
        const emptyCells = cells.filter(([row, col]) => board[row][col] === 0)
        if (emptyCells.length === 0 || emptyCells.length > MAX_EMPTY_CELLS) {
          continue
        }
        // Incomplete marks: nothing can be said about a cell with none.
        if (emptyCells.some(([row, col]) => !candidates[row][col].some(Boolean))) {
          continue
        }
        const key = `${emptyCells.map(index).join('.')}`
        if (found.has(key)) {
          continue
        }
        const emptySum = group.sum - cells.reduce((total, [row, col]) => total + board[row][col], 0)
        const supported = supportedCandidates(emptyCells, emptySum, candidates)
        // No filling at all: the grid is already wrong - not this finder's call.
        if (supported.some((mask) => mask === 0)) {
          continue
        }
        const eliminations: CandidateElimination[] = []
        emptyCells.forEach(([row, col], i) => {
          for (let digit = 1; digit <= 9; digit++) {
            if (candidates[row][col][digit - 1] && (supported[i] & (1 << (digit - 1))) === 0) {
              eliminations.push({ row, col, digit })
            }
          }
        })
        const single = emptyCells.length === 1
        if (eliminations.length === 0 && !single) {
          continue
        }
        const solvedCells = cells.filter(([row, col]) => board[row][col] !== 0)
        const where =
          group.kind === 'innie'
            ? `the cages wholly inside add up to ${group.cagesTotal}, so the rest of ${houses.label} (${cellsText(cells)}) adds up to ${group.sum}`
            : `the cages covering ${houses.label} add up to ${group.cagesTotal}, so their cells outside (${cellsText(cells)}) add up to ${group.sum}`
        const already =
          solvedCells.length > 0
            ? `; ${cellsText(solvedCells)} ${solvedCells.length === 1 ? 'is' : 'are'} already ${solvedCells.map(([r, c]) => board[r][c]).join(', ')}, leaving ${emptySum} for ${cellsText(emptyCells)}`
            : ''
        found.set(key, {
          kind: group.kind,
          housesLabel: houses.label,
          houseCells: houses.cells,
          housesTotal,
          cagesTotal: group.cagesTotal,
          cells,
          sum: group.sum,
          emptyCells,
          emptySum,
          eliminations,
          solved: single ? { row: emptyCells[0][0], col: emptyCells[0][1], digit: emptySum } : null,
          reasonText: `${capitalize(houses.label)} ${houses.houseCount === 1 ? 'adds' : 'add'} up to ${housesTotal}; ${where}${already}`,
        })
      }
    }

    // Placements first, then fewest cells.
    return [...found.values()].sort((a, b) => Number(b.solved !== null) - Number(a.solved !== null) || a.emptyCells.length - b.emptyCells.length)
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
