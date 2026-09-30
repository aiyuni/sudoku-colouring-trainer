import { markedCandidateDigits } from './boardUtils'
import { sudokuUnits, type Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export interface BugCandidateRef {
  row: number
  col: number
  digit: number
}

/** One of the BUG+N pattern's tri-value cells and the extra ("BUG") digit
 * whose removal from it would help leave a true BUG. */
export interface BugPlusNCell {
  cell: Cell
  /** Every candidate `cell` holds (always three). */
  candidates: readonly number[]
  /** The candidate that breaks the pattern. */
  bugDigit: number
  /** A row, column or box of `cell` where `bugDigit` appears three times -
   * the easy way to spot it, for the panel/hint/lesson wording. Null in the
   * rare BUG+2/BUG+3 case where other tri-value cells in every unit of this
   * one skew each count (the digit is still proven by the whole-grid check). */
  unit: readonly Cell[] | null
  unitKind: 'row' | 'column' | 'box' | null
}

/** BUG+N, N = 1, 2 or 3 - one technique (one rank, one Dynamic Dragon
 * checkbox) that the UI names by its N: "BUG+1", "BUG+2", "BUG+3". */
export interface BugPlusNInstance {
  n: 1 | 2 | 3
  /** One entry per tri-value cell, in grid order. */
  cells: readonly BugPlusNCell[]
  /** BUG+1 only: the tri-value cell is its BUG digit. */
  solved: BugCandidateRef | null
  /** BUG+2/BUG+3 only: every candidate that can't be true together with any
   * one of the BUG candidates - almost always the shared BUG digit in cells
   * that see every tri-value cell. Never empty for N >= 2 (such a pattern
   * isn't reported). */
  eliminations: readonly BugCandidateRef[]
}

/** Which kind of unit a set of cells belongs to - used to say "row",
 * "column", or "box" instead of the vaguer "section". */
function classifyUnitKind(cells: readonly Cell[]): 'row' | 'column' | 'box' {
  if (cells.every(([r]) => r === cells[0][0])) {
    return 'row'
  }
  if (cells.every(([, c]) => c === cells[0][1])) {
    return 'column'
  }
  return 'box'
}

function sees(a: Cell, b: Cell): boolean {
  return a[0] === b[0] || a[1] === b[1] || (Math.floor(a[0] / 3) === Math.floor(b[0] / 3) && Math.floor(a[1] / 3) === Math.floor(b[1] / 3))
}

/** Beyond BUG+3 the pattern is too far from all-bivalue to be worth naming
 * (and 3^N combinations to try) - the user asked for 1, 2 and 3. */
const MAX_N = 3

/**
 * BUG+N (Bivalue Universal Grave + N): a grid where every unsolved cell is
 * bivalue except N cells (N = 1..3) holding three candidates each.
 *
 * A "BUG" is a deadly pattern: every unsolved cell bivalue and every digit
 * left in a row, column or box appearing there exactly twice. Such a grid
 * always has an even number of solutions (0 or 2+), so a uniquely solvable
 * puzzle can never be in one. Each tri-value cell has one extra ("BUG")
 * digit - the one that, removed, leaves its units pairing up again. If
 * removing the N BUG candidates leaves a true BUG, at least one of them must
 * be true, or the puzzle would have that BUG's second solution.
 *
 * - BUG+1: the one BUG candidate is true - the cell's solution. It's the
 *   candidate appearing three times in the cell's units. The original BUG+1
 *   finder stopped at that count without checking the rest of the grid
 *   really pairs up, which gave wrong placements whenever a hidden single
 *   was still on the grid (a digit once in a unit is no BUG); the full check
 *   below is what makes it sound, and gives the same answer everywhere the
 *   old count was right.
 * - BUG+2/BUG+3: one of the N BUG candidates is true, so any candidate that
 *   can't be true alongside each of them goes - in practice the shared BUG
 *   digit in every cell that sees all N tri-value cells (the user's example:
 *   2 in r2c2 {1,2,8} and r8c9 {1,2,6}, so r8c2, which sees both, isn't 2).
 *   A digit the tri-value cells merely share is NOT enough: 1 is in both of
 *   those cells too, but it isn't a BUG candidate, and a cell seeing both
 *   can still be 1.
 *
 * The BUG digits are found by trying every choice of one digit
 * per tri-value cell (at most 3^3 = 27) and keeping one whose removal
 * leaves every unit with each unplaced digit exactly twice - counting per
 * unit alone can mislead when two tri-value cells share a unit.
 */
export class SudokuBugPlusNFinder {
  find(board: Board, candidates: CandidateGrid): BugPlusNInstance | null {
    const triValue: { cell: Cell; digits: number[] }[] = []

    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        const digits = markedCandidateDigits(candidates[row][col])
        if (digits.length === 2) {
          continue
        }
        if (digits.length !== 3 || triValue.length === MAX_N) {
          // A cell with only 0-1 candidates is solved or contradictory some
          // other way; one with four or more, or a fourth tri-value cell, is
          // too far from all-bivalue for this pattern.
          return null
        }
        triValue.push({ cell: [row, col], digits })
      }
    }

    if (triValue.length === 0) {
      return null
    }
    return this.findVerified(board, candidates, triValue)
  }

  private findVerified(
    board: Board,
    candidates: CandidateGrid,
    triValue: readonly { cell: Cell; digits: number[] }[],
  ): BugPlusNInstance | null {
    const units = sudokuUnits()
    // Per unit: which digits are placed, how many cells hold each as a
    // candidate, and which tri-value cells it contains.
    const placed = units.map((unit) => {
      const set = new Set<number>()
      for (const [r, c] of unit) {
        if (board[r][c] !== 0) set.add(board[r][c])
      }
      return set
    })
    const counts = units.map((unit) => {
      const perDigit = new Array<number>(10).fill(0)
      for (const [r, c] of unit) {
        if (board[r][c] !== 0) continue
        for (let d = 1; d <= 9; d++) {
          if (candidates[r][c][d - 1]) perDigit[d]++
        }
      }
      return perDigit
    })
    const triInUnit = units.map((unit) =>
      triValue.flatMap((t, i) => (unit.some(([r, c]) => r === t.cell[0] && c === t.cell[1]) ? [i] : [])),
    )

    const isBugWithout = (choice: readonly number[]): boolean => {
      for (let u = 0; u < units.length; u++) {
        for (let d = 1; d <= 9; d++) {
          let count = counts[u][d]
          for (const i of triInUnit[u]) {
            if (choice[i] === d) count--
          }
          if (count !== (placed[u].has(d) ? 0 : 2)) {
            return false
          }
        }
      }
      return true
    }

    const n = triValue.length as 1 | 2 | 3
    const total = 3 ** n
    for (let code = 0; code < total; code++) {
      const choice = triValue.map((t, i) => t.digits[Math.floor(code / 3 ** i) % 3])
      if (!isBugWithout(choice)) {
        continue
      }
      const bugCandidates = triValue.map((t, i) => ({ cell: t.cell, digit: choice[i] }))
      // BUG+1: its one BUG candidate is simply true.
      const solved = n === 1 ? { row: triValue[0].cell[0], col: triValue[0].cell[1], digit: choice[0] } : null
      const eliminations = n === 1 ? [] : this.eliminationsFor(board, candidates, bugCandidates)
      if (!solved && eliminations.length === 0) {
        continue
      }
      return {
        n,
        cells: triValue.map((t, i) => {
          const unitIndex = units.findIndex((_, u) => triInUnit[u].includes(i) && counts[u][choice[i]] === 3)
          const unit = unitIndex >= 0 ? units[unitIndex] : null
          return { cell: t.cell, candidates: t.digits, bugDigit: choice[i], unit, unitKind: unit ? classifyUnitKind(unit) : null }
        }),
        solved,
        eliminations,
      }
    }
    return null
  }

  /** Every marked candidate that is false whichever BUG candidate is the
   * true one: for each of them it's either another digit of that candidate's
   * own cell, or the same digit in a cell that sees it. */
  private eliminationsFor(
    board: Board,
    candidates: CandidateGrid,
    bugCandidates: readonly { cell: Cell; digit: number }[],
  ): BugCandidateRef[] {
    const out: BugCandidateRef[] = []
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (board[row][col] !== 0) continue
        for (let digit = 1; digit <= 9; digit++) {
          if (!candidates[row][col][digit - 1]) continue
          const excluded = bugCandidates.every(({ cell: [r, c], digit: d }) =>
            r === row && c === col ? digit !== d : digit === d && sees([row, col], [r, c]),
          )
          if (excluded) {
            out.push({ row, col, digit })
          }
        }
      }
    }
    return out
  }
}

function cellRef(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

function joinAnd(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "BUG+1", "BUG+2", "BUG+3" - what the UI calls an instance. */
export function bugPlusNName(instance: BugPlusNInstance): string {
  return `BUG+${instance.n}`
}

/** "r2c2 {1,2,8} and r8c9 {1,2,6}" - the tri-value cells. */
export function bugPlusNCellsText(instance: BugPlusNInstance): string {
  return joinAnd(instance.cells.map(({ cell: [r, c], candidates }) => `${cellRef(r, c)} {${candidates.join(',')}}`))
}

/** "2 in r2c2 (three times in its column) and 2 in r8c9 (three times in its
 * row)" - each tri-value cell's BUG digit and, where there is one, the unit
 * that shows it. */
export function bugPlusNExtrasText(instance: BugPlusNInstance): string {
  return joinAnd(
    instance.cells.map(
      ({ cell: [r, c], bugDigit, unitKind }) =>
        `${bugDigit} in ${cellRef(r, c)}${unitKind ? ` (three times in its ${unitKind})` : ''}`,
    ),
  )
}

/** "r8c2 is not 2" / "r7c1, r8c2 are not 2, r2c2 is not 6" - a BUG+2/BUG+3's
 * eliminations grouped by digit. */
export function bugPlusNEliminationsText(instance: BugPlusNInstance): string {
  const byDigit = new Map<number, string[]>()
  for (const { row, col, digit } of instance.eliminations) {
    byDigit.set(digit, [...(byDigit.get(digit) ?? []), cellRef(row, col)])
  }
  return [...byDigit.entries()]
    .map(([digit, cells]) => `${cells.join(', ')} ${cells.length === 1 ? 'is' : 'are'} not ${digit}`)
    .join(', ')
}

/** The reasoning of a BUG+2/BUG+3, without its conclusion - the panel
 * notation and Dynamic Dragon's clause both build on it. */
export function bugPlusNReasonText(instance: BugPlusNInstance): string {
  return (
    `${bugPlusNCellsText(instance)} are the only cells with more than two candidates. ` +
    `Their extra digits are ${bugPlusNExtrasText(instance)}: without them every digit would pair up in every row, column and box (two solutions), so one of them is true`
  )
}
