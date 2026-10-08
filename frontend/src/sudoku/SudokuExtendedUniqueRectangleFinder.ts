import { hasDiagonals, isStandardLayout, uniquenessHolds } from './SudokuConstraints'
import type { CandidateElimination } from './SudokuPairFinder'
import type { Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

/** Which of Sudopedia's four 6-cell deadly patterns
 * (http://sudopedia.enjoysudoku.com/Deadly_Pattern.html, "6 cells", its own
 * order renamed):
 *
 *   'three-box rectangle' (3 digits)      'two-box rectangle' (3 digits)
 *   12 . . | 23 . . | 31 . .              12 . . | 21 . . | . . .
 *   21 . . | 32 . . | 13 . .              23 . . | 32 . . | . . .
 *                                         31 . . | 13 . . | . . .
 *
 *   'three-box loop' (2 digits)           'bent loop' (2 digits)
 *   12 . . | 21 . . | .  . .              12 21 . | .  . .
 *   21 . . | .  . . | 12 . .              -------
 *   .  . . | 12 . . | 21 . .              21 .  . | 12 . .
 *                                         .  12 . | 21 . .
 *
 * each also transposed. The three-box rectangle is the one
 * sudokuwiki.org/Extended_Unique_Rectangles describes. */
export type ExtendedUrShape = 'three-box rectangle' | 'two-box rectangle' | 'three-box loop' | 'bent loop'

export interface ExtendedUrInstance {
  type: 1
  shape: ExtendedUrShape
  /** The six pattern cells, row-major. */
  cells: Cell[]
  /** The pattern's digits, ascending: three for a rectangle, two for a loop. */
  digits: number[]
  /** The one cell holding candidates outside `digits`. */
  oddCell: Cell
  /** Its candidates outside `digits`, ascending - one of them is true. */
  extraDigits: number[]
  /** The pattern digits the odd cell loses. Empty when it has exactly one
   * extra candidate: that is then its solution (`solved`), as for Unique
   * Rectangle Type 1. */
  eliminations: CandidateElimination[]
  solved: CandidateElimination | null
  /** The pattern in words, without its conclusion - callers add their own. */
  reasonText: string
}

interface Pattern {
  shape: ExtendedUrShape
  /** How many digits the deadly pattern is made of. */
  digitCount: 2 | 3
  /** Cell indices (row * 9 + col), ascending. */
  cells: number[]
}

const boxOf = (cell: number) => Math.floor(cell / 27) * 3 + Math.floor((cell % 9) / 3)
const cellRef = ([row, col]: Cell) => `r${row + 1}c${col + 1}`

/** Both 3-digit rectangles: 2 "long" lines of 3 cells crossed by 3 "short"
 * lines of 2. Swapping the two cells of every short line keeps each short
 * line's digits and gives each long line the other's - a second solution, as
 * long as no box changes its digits either. That holds in two layouts:
 *  - three-box: the long lines share a chute (band/stack), so each short
 *    line's two cells share a box; the short lines are in three different
 *    chutes (two in one would put four pattern cells in a box - never a
 *    3-digit pattern).
 *  - two-box: the short lines are the three lines of one chute, so each long
 *    line's three cells fill one box line; the long lines are in different
 *    chutes (in the same one all six cells would share a box). */
function rectanglePatterns(): Pattern[] {
  const out: Pattern[] = []
  for (const longAreRows of [true, false]) {
    const cell = (long: number, short: number) => (longAreRows ? long * 9 + short : short * 9 + long)
    const add = (shape: ExtendedUrShape, longs: number[], shorts: number[]) =>
      out.push({ shape, digitCount: 3, cells: longs.flatMap((l) => shorts.map((s) => cell(l, s))).sort((a, b) => a - b) })
    for (let chute = 0; chute < 3; chute++) {
      for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
        for (let a = 0; a < 3; a++) {
          for (let b = 3; b < 6; b++) {
            for (let c = 6; c < 9; c++) {
              add('three-box rectangle', [chute * 3 + i, chute * 3 + j], [a, b, c])
            }
          }
        }
      }
      const shorts = [chute * 3, chute * 3 + 1, chute * 3 + 2]
      for (let a = 0; a < 9; a++) {
        for (let b = (Math.floor(a / 3) + 1) * 3; b < 9; b++) {
          add('two-box rectangle', [a, b], shorts)
        }
      }
    }
  }
  return out
}

/** Both 2-digit loops: every 6-cell set in which each row, column and box
 * holds either none or exactly two of the cells - with only {a,b} in them,
 * swapping a and b everywhere is a second solution. Found by search rather
 * than from templates (a unit holding one cell so far must get exactly one
 * more, so that is the only thing ever tried); Sudopedia's catalogue says
 * these are the three-box loop and the bent loop and nothing else, and the
 * counts agree with a count by hand (972 and 5832 - the bent loop is its own
 * transpose, read from its other end). */
function loopPatterns(): Pattern[] {
  const out: Pattern[] = []
  const seen = new Set<string>()
  const rows = new Array<number>(9).fill(0)
  const cols = new Array<number>(9).fill(0)
  const boxes = new Array<number>(9).fill(0)
  const chosen: number[] = []
  const add = (cell: number, by: number) => {
    rows[Math.floor(cell / 9)] += by
    cols[cell % 9] += by
    boxes[boxOf(cell)] += by
  }
  const fits = (cell: number) => rows[Math.floor(cell / 9)] < 2 && cols[cell % 9] < 2 && boxes[boxOf(cell)] < 2
  /** The cells of the first unit that holds exactly one chosen cell. */
  const openUnit = (): number[] | null => {
    for (const cell of chosen) {
      const row = Math.floor(cell / 9)
      const col = cell % 9
      if (rows[row] === 1) return Array.from({ length: 9 }, (_, c) => row * 9 + c)
      if (cols[col] === 1) return Array.from({ length: 9 }, (_, r) => r * 9 + col)
      if (boxes[boxOf(cell)] === 1) {
        const top = Math.floor(row / 3) * 3
        const left = Math.floor(col / 3) * 3
        return Array.from({ length: 9 }, (_, k) => (top + Math.floor(k / 3)) * 9 + left + (k % 3))
      }
    }
    return null
  }
  const search = () => {
    const unit = openUnit()
    if (chosen.length === 6) {
      if (!unit) {
        const cells = [...chosen].sort((a, b) => a - b)
        const key = cells.join(',')
        if (!seen.has(key)) {
          seen.add(key)
          // The three-box loop stays inside one band or one stack.
          const oneBand = cells.every((c) => Math.floor(c / 27) === Math.floor(cells[0] / 27))
          const oneStack = cells.every((c) => Math.floor((c % 9) / 3) === Math.floor((cells[0] % 9) / 3))
          out.push({ shape: oneBand || oneStack ? 'three-box loop' : 'bent loop', digitCount: 2, cells })
        }
      }
      return
    }
    // Closed with fewer than six cells: a plain Unique Rectangle.
    if (!unit) {
      return
    }
    for (const cell of unit) {
      // Cells after the first: each set is built from its lowest cell only.
      if (cell <= chosen[0] || chosen.includes(cell) || !fits(cell)) {
        continue
      }
      chosen.push(cell)
      add(cell, 1)
      search()
      add(cell, -1)
      chosen.pop()
    }
  }
  for (let start = 0; start < 81; start++) {
    chosen.push(start)
    add(start, 1)
    search()
    add(start, -1)
    chosen.pop()
  }
  return out
}

let cachedPatterns: Pattern[] | undefined
/** Every 6-cell pattern on the grid (7,452 of them) - pure geometry, so
 * built once, on first use. The rectangles come first: they are the
 * technique's namesake, and so the ones reported when a loop makes the same
 * elimination. */
const allPatterns = () => (cachedPatterns ??= [...rectanglePatterns(), ...loopPatterns()])

/** How many patterns of each shape the grid has - for
 * dragon-research/extended-ur/sweep.ts, which checks them against the counts
 * worked out by hand (486, 162, 972, 5832). */
export function extendedUrPatternCounts(): Record<ExtendedUrShape, number> {
  const counts: Record<ExtendedUrShape, number> = { 'three-box rectangle': 0, 'two-box rectangle': 0, 'three-box loop': 0, 'bent loop': 0 }
  for (const pattern of allPatterns()) {
    counts[pattern.shape]++
  }
  return counts
}

const POPCOUNT =Array.from({ length: 512 }, (_, mask) => {
  let n = 0
  for (let m = mask; m; m &= m - 1) n++
  return n
})
const digitsOf = (mask: number) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => mask & (1 << (d - 1)))

/**
 * Extended Unique Rectangle, Type 1, on the 6-cell deadly patterns only (by
 * request: not the 8- or 9-cell ones, and none of the other types).
 *
 * A deadly pattern is a set of unsolved cells that could be filled in two
 * ways without anything outside them noticing - so a puzzle with one
 * solution can never end up there. The Unique Rectangle is the 4-cell one;
 * Sudopedia's catalogue lists four on 6 cells (see ExtendedUrShape), two
 * made of three digits and two of two.
 *
 * Type 1 (sudokuwiki.org/Extended_Unique_Rectangles): five of the six cells
 * hold only the pattern's digits and the sixth holds something else as well.
 * If the sixth were a pattern digit too, all six would be, and that is
 * deadly whichever way they are filled:
 *  - a rectangle: each long line's three cells hold the three digits, so
 *    swapping the two cells of every short line is a second solution;
 *  - a loop: every row, column and box of the pattern holds two of its
 *    cells, so both digits, and swapping the two digits is a second solution.
 * So the sixth cell is one of its other candidates and loses the pattern's
 * digits. The five cells needn't hold every pattern digit each (SudokuWiki's
 * "triple": {1,5}, {1,3}, {3,5} will do) - the argument only needs them to
 * hold nothing else.
 *
 * Relies on the puzzle having one solution, like every uniqueness technique,
 * and needs no givens mask: all six cells are unsolved, so none is a given.
 */
export class SudokuExtendedUniqueRectangleFinder {
  find(board: Board, candidates: CandidateGrid): ExtendedUrInstance[] {
    // The 6-cell patterns are built for the standard 3x3 boxes (allPatterns),
    // and like every deadly pattern they need a puzzle without Killer cages
    // (or the Anti-Knight rule). On an X-Sudoku a pattern would also have to
    // keep clear of the diagonals; the precomputed patterns don't know them,
    // so the technique is simply off there.
    if (!isStandardLayout() || !uniquenessHolds() || hasDiagonals()) {
      return []
    }
    const masks = new Array<number>(81).fill(0)
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (board[row][col] !== 0) continue
        let mask = 0
        for (let d = 0; d < 9; d++) {
          if (candidates[row][col][d]) mask |= 1 << d
        }
        masks[row * 9 + col] = mask
      }
    }

    const found: ExtendedUrInstance[] = []
    // Two patterns can share their odd cell and rule out the same digits.
    const effects = new Set<string>()
    for (const pattern of allPatterns()) {
      const { cells, digitCount } = pattern
      // Cheap rejections first - this runs over every pattern, live and
      // inside Dynamic Dragon's simulation: all six unsolved, and at least
      // five of them small enough to hold only pattern digits.
      let small = 0
      let unsolved = true
      for (const cell of cells) {
        const mask = masks[cell]
        if (mask === 0) {
          unsolved = false
          break
        }
        if (POPCOUNT[mask] <= digitCount) small++
      }
      if (!unsolved || small < 5) {
        continue
      }
      for (let odd = 0; odd < 6; odd++) {
        let others = 0
        for (let k = 0; k < 6; k++) {
          if (k !== odd) others |= masks[cells[k]]
        }
        const oddMask = masks[cells[odd]]
        const extras = oddMask & ~others
        const shared = oddMask & others
        if (POPCOUNT[others] !== digitCount || extras === 0 || shared === 0) {
          continue
        }
        const row = Math.floor(cells[odd] / 9)
        const col = cells[odd] % 9
        const key = `${cells[odd]}:${shared}`
        if (effects.has(key)) {
          continue
        }
        effects.add(key)
        const extraDigits = digitsOf(extras)
        const instance: ExtendedUrInstance = {
          type: 1,
          shape: pattern.shape,
          cells: cells.map((cell): Cell => [Math.floor(cell / 9), cell % 9]),
          digits: digitsOf(others),
          oddCell: [row, col],
          extraDigits,
          eliminations: extraDigits.length === 1 ? [] : digitsOf(shared).map((digit) => ({ row, col, digit })),
          solved: extraDigits.length === 1 ? { row, col, digit: extraDigits[0] } : null,
          reasonText: '',
        }
        instance.reasonText = extendedUrReasonText(instance)
        found.push(instance)
      }
    }
    return found
  }
}

function extendedUrReasonText(eur: ExtendedUrInstance): string {
  return (
    `an Extended UR (Type 1) of {${eur.digits.join(',')}} at ${eur.cells.map(cellRef).join(', ')}, ` +
    `where only ${cellRef(eur.oddCell)} has ${eur.extraDigits.length === 1 ? 'another candidate' : 'other candidates'} (${eur.extraDigits.join(',')})`
  )
}
