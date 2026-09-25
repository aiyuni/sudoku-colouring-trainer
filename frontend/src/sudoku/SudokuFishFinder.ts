import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import type { Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

/** The four fish this app implements, simplest first. Sashimi fish (where
 * the pattern left once the fins are ignored is itself degenerate) are
 * deliberately not among them yet - see isNonSashimi below. */
export type FishTechnique = 'x-wing' | 'finned x-wing' | 'swordfish' | 'finned swordfish'

export const ALL_FISH_TECHNIQUES: readonly FishTechnique[] = ['x-wing', 'finned x-wing', 'swordfish', 'finned swordfish']

export const FISH_TECHNIQUE_NAMES: Record<FishTechnique, string> = {
  'x-wing': 'X-Wing',
  'finned x-wing': 'Finned X-Wing',
  swordfish: 'Swordfish',
  'finned swordfish': 'Finned Swordfish',
}

export interface FishInstance {
  technique: FishTechnique
  digit: number
  /** Whether the fish's defining lines are rows (confined to columns) or
   * columns (confined to rows). */
  lineKind: 'row' | 'col'
  /** 0-indexed rows (lineKind 'row') or columns the digit is looked at in. */
  lines: number[]
  /** 0-indexed columns (lineKind 'row') or rows those lines' candidates are
   * confined to, fins aside. */
  crossLines: number[]
  /** Every candidate of the digit in `lines`, fins included. */
  cells: Cell[]
  /** The candidates in `lines` outside `crossLines` - empty for a basic fish. */
  fins: Cell[]
  eliminations: CandidateElimination[]
  /** "5 in rows 2 and 5 is confined to columns 5 and 8" (plus ", apart from
   * the fin at r2c1" for a finned fish) - shared by the Techniques panel and
   * Dynamic Dragon's clauses so the wording lives in one place. */
  reasonText: string
}

/**
 * X-Wing, Swordfish and their finned forms, for one digit at a time.
 *
 * Internally this is the general base/cover set formulation of fish (as on
 * HoDoKu's fish pages), kept out of every user-facing string on purpose - the
 * app explains fish in the traditional "rows confined to columns" terms:
 *  - Base sets: n rows (or n columns). Every candidate of the digit in them
 *    is a base candidate. Each base set holds exactly one true digit, so the
 *    n base sets together hold exactly n.
 *  - Cover sets: n columns (or rows). Each holds at most one true digit, so
 *    if every base candidate lies in some cover set, the n true base digits
 *    use up every cover set - no other candidate of the digit in a cover set
 *    can be true.
 *  - Fins: base candidates in no cover set. If some fin is true the argument
 *    above breaks, so only cover candidates that see *every* fin can go
 *    (either the fish holds, or a fin is true and removes them directly).
 *
 * evaluateFish is that rule, written generically over whichever houses are
 * passed in; the enumeration below only picks which rows/columns to try,
 * using bitmasks to skip combinations that can't produce a fish before
 * paying for evaluateFish.
 *
 * Validity rules on top of the logic itself (the logic alone would accept
 * degenerate patterns that are really something simpler):
 *  - Every base set has at least 2 candidates (1 is a hidden single).
 *  - Every base set keeps at least 2 candidates inside the cover sets once
 *    the fins are set aside - otherwise the fin-less remainder is degenerate
 *    and the fish is Sashimi, not (yet) implemented. For a basic fish this is
 *    the same as the rule above.
 *  - Every cover set holds at least one base candidate.
 *  - It eliminates something.
 *
 * Fins only ever lead to an elimination when they share a box: cells seeing
 * fins in different boxes of one base row are only in that row, and those
 * seeing fins in two different rows and boxes are base cells themselves. So
 * a finned fish's uncovered columns must fit in one band of three, which is
 * what the enumeration prunes on; evaluateFish still does the exact check.
 *
 * find() never mutates, and returns results sorted simplest-technique-first
 * then by digit; the same technique+digit+eliminations is only reported once
 * (a fish in rows and one in columns, or two different cover choices, can
 * prove exactly the same thing).
 */
export class SudokuFishFinder {
  find(board: Board, candidates: CandidateGrid): FishInstance[] {
    const out: FishInstance[] = []
    const seen = new Set<string>()
    for (const technique of ALL_FISH_TECHNIQUES) {
      const size = technique === 'x-wing' || technique === 'finned x-wing' ? 2 : 3
      const finned = technique === 'finned x-wing' || technique === 'finned swordfish'
      for (let digit = 1; digit <= BOARD_SIZE; digit++) {
        for (const lineKind of ['row', 'col'] as const) {
          for (const instance of this.findForDigit(board, candidates, digit, lineKind, size, finned, technique)) {
            const key = `${technique}|${digit}|${instance.eliminations.map((e) => `${e.row}.${e.col}`).join(',')}`
            if (seen.has(key)) {
              continue
            }
            seen.add(key)
            out.push(instance)
          }
        }
      }
    }
    return out
  }

  private findForDigit(
    board: Board,
    candidates: CandidateGrid,
    digit: number,
    lineKind: 'row' | 'col',
    size: 2 | 3,
    finned: boolean,
    technique: FishTechnique,
  ): FishInstance[] {
    const cellAt = (line: number, cross: number): Cell => (lineKind === 'row' ? [line, cross] : [cross, line])
    // masks[line]: bit x set when the digit is a candidate at (line, x).
    const masks: number[] = []
    for (let line = 0; line < BOARD_SIZE; line++) {
      let mask = 0
      for (let cross = 0; cross < BOARD_SIZE; cross++) {
        const [row, col] = cellAt(line, cross)
        if (board[row][col] === 0 && candidates[row][col][digit - 1]) {
          mask |= 1 << cross
        }
      }
      masks.push(mask)
    }
    // A line with a single candidate is a hidden single, and a finned base
    // line can hold at most `size` covered candidates plus fins in one band.
    const maxPerLine = finned ? size + BOX_SIZE : size
    const eligible = masks
      .map((mask, line) => ({ mask, line }))
      .filter(({ mask }) => popcount(mask) >= 2 && popcount(mask) <= maxPerLine)
      .map(({ line }) => line)

    const results: FishInstance[] = []
    for (const lines of combinations(eligible, size)) {
      const union = lines.reduce((acc, line) => acc | masks[line], 0)
      const unionSize = popcount(union)
      const coverChoices: number[] = []
      if (!finned) {
        if (unionSize === size) {
          coverChoices.push(union)
        }
      } else if (unionSize > size && unionSize <= size + BOX_SIZE) {
        for (const cover of combinations(bitsOf(union), size)) {
          const coverMask = cover.reduce((acc, x) => acc | (1 << x), 0)
          const finMask = union & ~coverMask
          if (bandsOf(finMask) === 1) {
            coverChoices.push(coverMask)
          }
        }
      }

      for (const coverMask of coverChoices) {
        // Non-sashimi: each line keeps 2+ candidates inside the covers.
        if (lines.some((line) => popcount(masks[line] & coverMask) < 2)) {
          continue
        }
        const crossLines = bitsOf(coverMask)
        const bases = lines.map((index) => ({ kind: lineKind, index }))
        const covers = crossLines.map((index) => ({ kind: lineKind === 'row' ? ('col' as const) : ('row' as const), index }))
        const evaluated = evaluateFish(board, candidates, digit, bases, covers)
        if (!evaluated || evaluated.eliminations.length === 0 || (evaluated.fins.length > 0) !== finned) {
          continue
        }
        results.push({
          technique,
          digit,
          lineKind,
          lines,
          crossLines,
          cells: evaluated.baseCells,
          fins: evaluated.fins,
          eliminations: evaluated.eliminations,
          reasonText: fishReasonText(digit, lineKind, lines, crossLines, evaluated.fins),
        })
      }
    }
    return results
  }
}

interface House {
  kind: 'row' | 'col' | 'box'
  index: number
}

function houseContains(house: House, [row, col]: Cell): boolean {
  switch (house.kind) {
    case 'row':
      return row === house.index
    case 'col':
      return col === house.index
    case 'box':
      return boxOf(row, col) === house.index
  }
}

// A house's cells never change - built once per house, since evaluateFish
// runs inside Dynamic Dragon's simulation loop when a fish is allowed there.
const houseCellsCache = new Map<string, Cell[]>()

function houseCells(house: House): Cell[] {
  const cacheKey = `${house.kind}${house.index}`
  const cached = houseCellsCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const cells: Cell[] = []
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (houseContains(house, [row, col])) {
        cells.push([row, col])
      }
    }
  }
  houseCellsCache.set(cacheKey, cells)
  return cells
}

function boxOf(row: number, col: number): number {
  return Math.floor(row / BOX_SIZE) * BOX_SIZE + Math.floor(col / BOX_SIZE)
}

function sees([r1, c1]: Cell, [r2, c2]: Cell): boolean {
  return (r1 !== r2 || c1 !== c2) && (r1 === r2 || c1 === c2 || boxOf(r1, c1) === boxOf(r2, c2))
}

/** The base/cover fish rule for one digit (see the class comment): null when
 * some base or cover set holds no base candidate, otherwise the base
 * candidates, the fins among them, and every cover candidate that isn't a
 * base candidate and sees all the fins. General over any houses, although
 * the finder only ever passes rows and columns. */
function evaluateFish(
  board: Board,
  candidates: CandidateGrid,
  digit: number,
  bases: House[],
  covers: House[],
): { baseCells: Cell[]; fins: Cell[]; eliminations: CandidateElimination[] } | null {
  const holds = ([row, col]: Cell) => board[row][col] === 0 && candidates[row][col][digit - 1]
  const key = ([row, col]: Cell) => row * BOARD_SIZE + col

  const baseByKey = new Map<number, Cell>()
  for (const base of bases) {
    const own = houseCells(base).filter(holds)
    if (own.length === 0) {
      return null
    }
    for (const cell of own) {
      baseByKey.set(key(cell), cell)
    }
  }
  const baseCells = [...baseByKey.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (covers.some((cover) => !baseCells.some((cell) => houseContains(cover, cell)))) {
    return null
  }
  const fins = baseCells.filter((cell) => !covers.some((cover) => houseContains(cover, cell)))

  const eliminationByKey = new Map<number, CandidateElimination>()
  for (const cover of covers) {
    for (const cell of houseCells(cover)) {
      if (!holds(cell) || baseByKey.has(key(cell)) || !fins.every((fin) => sees(cell, fin))) {
        continue
      }
      eliminationByKey.set(key(cell), { row: cell[0], col: cell[1], digit })
    }
  }
  const eliminations = [...eliminationByKey.values()].sort((a, b) => a.row - b.row || a.col - b.col)
  return { baseCells, fins, eliminations }
}

function fishReasonText(digit: number, lineKind: 'row' | 'col', lines: number[], crossLines: number[], fins: Cell[]): string {
  const lineWord = lineKind === 'row' ? 'rows' : 'columns'
  const crossWord = lineKind === 'row' ? 'columns' : 'rows'
  const base = `${digit} in ${lineWord} ${joinNumbers(lines)} is confined to ${crossWord} ${joinNumbers(crossLines)}`
  if (fins.length === 0) {
    return base
  }
  const finsLabel = fins.map(([row, col]) => `r${row + 1}c${col + 1}`).join(', ')
  return `${base}, apart from the fin${fins.length === 1 ? '' : 's'} at ${finsLabel}`
}

function joinNumbers(indices: number[]): string {
  const labels = indices.map((i) => `${i + 1}`)
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

function popcount(mask: number): number {
  let count = 0
  for (let m = mask; m; m &= m - 1) {
    count++
  }
  return count
}

function bitsOf(mask: number): number[] {
  const bits: number[] = []
  for (let x = 0; x < BOARD_SIZE; x++) {
    if (mask & (1 << x)) {
      bits.push(x)
    }
  }
  return bits
}

/** How many bands of three (columns 1-3, 4-6, 7-9, or the same for rows) a
 * mask touches. */
function bandsOf(mask: number): number {
  let bands = 0
  for (let band = 0; band < BOX_SIZE; band++) {
    if (mask & (0b111 << (band * BOX_SIZE))) {
      bands++
    }
  }
  return bands
}

function* combinations<T>(items: readonly T[], k: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === k) {
    yield [...prefix]
    return
  }
  for (let i = start; i <= items.length - (k - prefix.length); i++) {
    prefix.push(items[i])
    yield* combinations(items, k, i + 1, prefix)
    prefix.pop()
  }
}
