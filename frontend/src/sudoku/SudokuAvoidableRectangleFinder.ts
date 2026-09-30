import type { CandidateElimination } from './SudokuPairFinder'
import type { Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

/** Which cells are the puzzle's givens (true) - as opposed to solved by the
 * solver. Only Avoidable Rectangle needs it. */
export type GivenMask = readonly (readonly boolean[])[]

export interface AvoidableRectangleInstance {
  type: 1 | 2
  /** The rectangle's four corners, in cyclic order: two rows, two columns,
   * exactly two boxes. */
  cells: readonly [Cell, Cell, Cell, Cell]
  /** The two digits of the would-be deadly pattern, ascending. */
  digits: readonly [number, number]
  /** The solved (not given) corners: three for Type 1, two for Type 2. */
  solvedCells: readonly Cell[]
  /** What the rest of the grid loses. Type 1: the one unsolved corner's
   * pattern-completing digit. Type 2: `extraDigit` from every cell that sees
   * both unsolved corners. */
  eliminations: CandidateElimination[]
  /** Type 2 only: the one extra candidate both unsolved corners share. */
  extraDigit: number | null
  /** The pattern in words, without its conclusion ("where r3c4 and r2c7 are
   * 5 and r3c7 is 8 (solved, not givens)") - callers add their own. */
  reasonText: string
}

const boxOf = (row: number, col: number) => Math.floor(row / 3) * 3 + Math.floor(col / 3)
const cellRef = ([row, col]: Cell) => `r${row + 1}c${col + 1}`
const sees = (a: Cell, b: Cell) => a[0] === b[0] || a[1] === b[1] || boxOf(a[0], a[1]) === boxOf(b[0], b[1])

/**
 * Avoidable Rectangles: a Unique Rectangle some of whose cells are already
 * solved. Four cells spanning exactly two rows, two columns and two boxes,
 * holding A, B, A, B round the rectangle, could swap A and B and the grid
 * would stay valid - a second solution, unless one of the four is a given.
 * So if the solved corners are *solved by the solver, not givens*, the
 * unsolved ones must not complete the pattern.
 *
 * - Type 1 (SudokuWiki's "Avoidable Rectangle", HoDoKu's Type 1): three
 *   corners solved, the same digit A on two diagonal ones and B on the
 *   third. The fourth corner can't be B.
 * - Type 2 (HoDoKu's Type 2, the UR Type 2 analogue): two corners side by
 *   side solved as A and B; each of the other two holds only the digit that
 *   would complete the pattern (the one on its diagonal) plus the same extra
 *   candidate X. One of them must be X, so X goes from every cell seeing
 *   both. (Side by side, as HoDoKu's examples have it: the unsolved pair
 *   shares a row or column.)
 *
 * This is the one technique that needs to know which cells are givens: the
 * same rectangle with a given corner is no contradiction at all - the given
 * is what stops the swap - so it must never be treated as solved. Callers
 * without a givens mask (null) get nothing rather than a wrong answer.
 *
 * Only the 4-cell patterns, by request - not the extended (6+ cell) forms.
 */
export class SudokuAvoidableRectangleFinder {
  find(board: Board, candidates: CandidateGrid, givens: GivenMask | null): AvoidableRectangleInstance[] {
    if (!givens) {
      return []
    }
    const solvedNonGiven = ([row, col]: Cell) => board[row][col] !== 0 && !givens[row][col]
    const value = ([row, col]: Cell) => board[row][col]
    const type1: AvoidableRectangleInstance[] = []
    const type2: AvoidableRectangleInstance[] = []
    for (let r1 = 0; r1 < 9; r1++) {
      for (let r2 = r1 + 1; r2 < 9; r2++) {
        for (let c1 = 0; c1 < 9; c1++) {
          for (let c2 = c1 + 1; c2 < 9; c2++) {
            const boxes = new Set([boxOf(r1, c1), boxOf(r1, c2), boxOf(r2, c1), boxOf(r2, c2)])
            if (boxes.size !== 2) {
              continue
            }
            // Cyclic order, so corners i and i + 2 are diagonal.
            const cells: [Cell, Cell, Cell, Cell] = [
              [r1, c1],
              [r1, c2],
              [r2, c2],
              [r2, c1],
            ]
            const unsolved = [0, 1, 2, 3].filter((i) => board[cells[i][0]][cells[i][1]] === 0)
            if (!cells.every((cell, i) => unsolved.includes(i) || solvedNonGiven(cell))) {
              continue
            }
            if (unsolved.length === 1) {
              const found = this.type1(cells, unsolved[0], value, candidates)
              if (found) type1.push(found)
            } else if (unsolved.length === 2) {
              const found = this.type2(cells, unsolved, value, board, candidates)
              if (found) type2.push(found)
            }
          }
        }
      }
    }
    return [...type1, ...type2]
  }

  private type1(
    cells: readonly [Cell, Cell, Cell, Cell],
    u: number,
    value: (cell: Cell) => number,
    candidates: CandidateGrid,
  ): AvoidableRectangleInstance | null {
    const target = cells[u]
    const opposite = cells[(u + 2) % 4]
    const pairA = cells[(u + 1) % 4]
    const pairB = cells[(u + 3) % 4]
    const pairDigit = value(pairA)
    const digit = value(opposite)
    if (value(pairB) !== pairDigit || digit === pairDigit || !candidates[target[0]][target[1]][digit - 1]) {
      return null
    }
    return {
      type: 1,
      cells,
      digits: pairDigit < digit ? [pairDigit, digit] : [digit, pairDigit],
      solvedCells: [pairA, opposite, pairB],
      eliminations: [{ row: target[0], col: target[1], digit }],
      extraDigit: null,
      reasonText: `where ${cellRef(pairA)} and ${cellRef(pairB)} are ${pairDigit} and ${cellRef(opposite)} is ${digit} (solved, not givens)`,
    }
  }

  private type2(
    cells: readonly [Cell, Cell, Cell, Cell],
    unsolved: number[],
    value: (cell: Cell) => number,
    board: Board,
    candidates: CandidateGrid,
  ): AvoidableRectangleInstance | null {
    const [i, j] = unsolved
    // Side by side (adjacent in the cycle), not diagonal.
    if (j - i === 2) {
      return null
    }
    // Each unsolved corner completes the pattern with its diagonal's digit.
    const needs = unsolved.map((k) => value(cells[(k + 2) % 4]))
    if (needs[0] === needs[1]) {
      return null
    }
    let extraDigit = 0
    for (const [n, k] of unsolved.entries()) {
      const [row, col] = cells[k]
      const marks = candidates[row][col].flatMap((on, d) => (on ? [d + 1] : []))
      const extra = marks.filter((d) => d !== needs[n])
      if (marks.length !== 2 || extra.length !== 1 || (extraDigit !== 0 && extra[0] !== extraDigit)) {
        return null
      }
      extraDigit = extra[0]
    }
    const [a, b] = unsolved.map((k) => cells[k])
    const eliminations: CandidateElimination[] = []
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const cell: Cell = [row, col]
        if (board[row][col] !== 0 || !candidates[row][col][extraDigit - 1] || cells.some(([r, c]) => r === row && c === col)) {
          continue
        }
        if (sees(cell, a) && sees(cell, b)) {
          eliminations.push({ row, col, digit: extraDigit })
        }
      }
    }
    if (eliminations.length === 0) {
      return null
    }
    const solved = [0, 1, 2, 3].filter((k) => !unsolved.includes(k)).map((k) => cells[k])
    const [s1, s2] = solved
    const digits = [value(s1), value(s2)].sort((x, y) => x - y) as [number, number]
    return {
      type: 2,
      cells,
      digits,
      solvedCells: solved,
      eliminations,
      extraDigit,
      reasonText:
        `where ${cellRef(s1)} is ${value(s1)} and ${cellRef(s2)} is ${value(s2)} (solved, not givens) and ` +
        `${cellRef(a)} {${[needs[0], extraDigit].sort().join(',')}} and ${cellRef(b)} {${[needs[1], extraDigit].sort().join(',')}} ` +
        `would complete the rectangle unless one of them is ${extraDigit}`,
    }
  }
}
