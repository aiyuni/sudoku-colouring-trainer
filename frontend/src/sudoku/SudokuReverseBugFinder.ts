import type { Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

/**
 * Which placed digits the pattern must contain.
 * - `'solved'`: Sudopedia's own statement - *every* solved cell of the two
 *   digits (givens and deduced placements alike) must be part of the
 *   pattern. Needs no knowledge of which cells were givens.
 * - `'givens'`: only the givens must be. The uniqueness argument only needs
 *   the swapped region to be free of givens (a deduced placement there is
 *   just a cell the second solution fills differently), so the pattern is
 *   grown from the givens plus the hypothetical placement, pulling in solved
 *   cells only as partners it needs. Finds every Sudopedia elimination and
 *   more, but is only sound when the givens mask really is the puzzle's clues.
 */
export type ReverseBugSeed = 'solved' | 'givens'

export interface ReverseBugInstance {
  kind: 'reverse-bug' | 'reverse-bug-lite'
  /** The candidate that can't be true. */
  eliminated: { row: number; col: number; digit: number }
  /** Reverse BUG: the two digits. Lite: every digit of the pattern. */
  digits: number[]
  /** Every placed cell of the pattern, the eliminated cell included - with
   * it placed they would form an unavoidable set of their own. */
  patternCells: Cell[]
  /** Reverse BUG: how many rows (= columns = boxes) the pattern spans. Lite:
   * how many columns (or rows) of the two lines it fills. */
  size: number
}

const boxOf = (row: number, col: number) => Math.floor(row / 3) * 3 + Math.floor(col / 3)

/**
 * Reverse BUG (Sudopedia): for two digits a and b, a solution's 18 a/b cells
 * split into two unavoidable sets whenever 2n of them occupy exactly n rows,
 * n columns and n boxes: the other 18 - 2n then occupy exactly the other
 * 9 - n rows, columns and boxes, one a and one b in each, so swapping a and b
 * among just those cells gives another valid grid. If none of those cells is
 * a given, that second grid is a second solution. So in a unique puzzle, the
 * given a/b cells can never all lie inside such a "closed" set of n < 9 rows,
 * columns and boxes - and a candidate whose placement would close one is
 * false.
 *
 * Closing test: a set is closed exactly when each of its a cells has its
 * row's, column's and box's b in the set too, and vice versa. Growing a seed
 * by that rule gives the smallest closed set containing it, as long as every
 * partner it asks for is already placed; one that isn't means we can't tell,
 * so nothing is concluded.
 *
 * Reverse BUG Lite (Sudopedia): two rows of one band (or two columns of one
 * stack). If their placed cells fill the same positions with the same set of
 * digits in both lines, swapping the two lines' cells in every other position
 * keeps every row, column and box valid - a second solution unless one of
 * those positions holds a given. Same closure idea, over positions instead of
 * digit partners.
 */
export class SudokuReverseBugFinder {
  find(board: Board, candidates: CandidateGrid, givens: boolean[][] | null, seed: ReverseBugSeed = 'solved'): ReverseBugInstance[] {
    return [...this.findReverseBug(board, candidates, givens, seed), ...this.findReverseBugLite(board, candidates, givens, seed)]
  }

  findReverseBug(board: Board, candidates: CandidateGrid, givens: boolean[][] | null, seed: ReverseBugSeed = 'solved'): ReverseBugInstance[] {
    const out: ReverseBugInstance[] = []
    for (let a = 1; a <= 9; a++) {
      for (let b = a + 1; b <= 9; b++) {
        for (let row = 0; row < 9; row++) {
          for (let col = 0; col < 9; col++) {
            if (board[row][col] !== 0) {
              continue
            }
            for (const digit of [a, b]) {
              if (!candidates[row][col][digit - 1]) {
                continue
              }
              const pattern = closeDigitPair(board, givens, seed, a, b, row, col, digit)
              if (pattern) {
                out.push({ kind: 'reverse-bug', eliminated: { row, col, digit }, digits: [a, b], patternCells: pattern, size: pattern.length / 2 })
              }
            }
          }
        }
      }
    }
    return out
  }

  findReverseBugLite(board: Board, candidates: CandidateGrid, givens: boolean[][] | null, seed: ReverseBugSeed = 'solved'): ReverseBugInstance[] {
    const out: ReverseBugInstance[] = []
    for (const byRow of [true, false]) {
      // (line, position) -> cell, so columns reuse the row code.
      const at = (line: number, pos: number): Cell => (byRow ? [line, pos] : [pos, line])
      for (let band = 0; band < 3; band++) {
        for (let i = 0; i < 3; i++) {
          for (let j = i + 1; j < 3; j++) {
            const lines = [band * 3 + i, band * 3 + j]
            for (const [k, line] of lines.entries()) {
              for (let pos = 0; pos < 9; pos++) {
                const [row, col] = at(line, pos)
                if (board[row][col] !== 0) {
                  continue
                }
                for (let digit = 1; digit <= 9; digit++) {
                  if (!candidates[row][col][digit - 1]) {
                    continue
                  }
                  const value = (l: number, p: number) => {
                    if (l === k && p === pos) return digit
                    const [r, c] = at(lines[l], p)
                    return board[r][c]
                  }
                  const inSeed = (l: number, p: number) => {
                    if (l === k && p === pos) return true
                    const [r, c] = at(lines[l], p)
                    return seed === 'givens' && givens ? givens[r][c] : board[r][c] !== 0
                  }
                  const positions = closeLinePair(value, inSeed)
                  if (positions) {
                    out.push({
                      kind: 'reverse-bug-lite',
                      eliminated: { row, col, digit },
                      digits: positions.map((p) => value(0, p)).sort((x, y) => x - y),
                      patternCells: positions.flatMap((p) => [at(lines[0], p), at(lines[1], p)]),
                      size: positions.length,
                    })
                  }
                }
              }
            }
          }
        }
      }
    }
    return out
  }
}

/** The smallest closed a/b set containing the seed and (row, col) = digit,
 * or null if it needs an unplaced partner or would be all 18 cells. */
function closeDigitPair(
  board: Board,
  givens: boolean[][] | null,
  seed: ReverseBugSeed,
  a: number,
  b: number,
  row: number,
  col: number,
  digit: number,
): Cell[] | null {
  const valueAt = (r: number, c: number) => (r === row && c === col ? digit : board[r][c])
  // placed[d][kind][i]: the placed cell of digit d in row/column/box i.
  const placed: Record<number, (Cell | null)[][]> = {
    [a]: [Array(9).fill(null), Array(9).fill(null), Array(9).fill(null)],
    [b]: [Array(9).fill(null), Array(9).fill(null), Array(9).fill(null)],
  }
  const queue: Cell[] = []
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = valueAt(r, c)
      if (v !== a && v !== b) {
        continue
      }
      const slots = [r, c, boxOf(r, c)]
      for (let kind = 0; kind < 3; kind++) {
        if (placed[v][kind][slots[kind]]) {
          // The hypothetical placement clashes with a placed peer - a stale
          // mark, not ours to judge.
          return null
        }
        placed[v][kind][slots[kind]] = [r, c]
      }
      const seeded = (r === row && c === col) || (seed === 'givens' && givens ? givens[r][c] : true)
      if (seeded) {
        queue.push([r, c])
      }
    }
  }

  const inSet = new Set<number>()
  for (const [r, c] of queue) {
    inSet.add(r * 9 + c)
  }
  for (let q = 0; q < queue.length; q++) {
    const [r, c] = queue[q]
    const other = valueAt(r, c) === a ? b : a
    const slots = [r, c, boxOf(r, c)]
    for (let kind = 0; kind < 3; kind++) {
      const partner = placed[other][kind][slots[kind]]
      if (!partner) {
        return null
      }
      const key = partner[0] * 9 + partner[1]
      if (!inSet.has(key)) {
        inSet.add(key)
        queue.push(partner)
      }
    }
  }
  return queue.length < 18 ? queue : null
}

/** Positions (0-8) of the smallest set, containing every seeded position,
 * where both lines are placed and hold the same digits - or null. */
function closeLinePair(value: (line: number, pos: number) => number, inSeed: (line: number, pos: number) => boolean): number[] | null {
  const posOf = [new Map<number, number>(), new Map<number, number>()]
  for (let line = 0; line < 2; line++) {
    for (let pos = 0; pos < 9; pos++) {
      const v = value(line, pos)
      if (v !== 0) {
        // A digit twice in one line, or twice at one position (the two cells
        // share a column/row there): the hypothetical clashes with a placed
        // peer - a stale mark, not ours to judge.
        if (posOf[line].has(v) || value(1 - line, pos) === v) return null
        posOf[line].set(v, pos)
      }
    }
  }
  const queue: number[] = []
  const inSet = new Set<number>()
  for (let pos = 0; pos < 9; pos++) {
    if (inSeed(0, pos) || inSeed(1, pos)) {
      queue.push(pos)
      inSet.add(pos)
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const pos = queue[q]
    for (let line = 0; line < 2; line++) {
      const v = value(line, pos)
      if (v === 0) {
        return null
      }
      // The same digit must sit at an included position of the other line.
      const partner = posOf[1 - line].get(v)
      if (partner === undefined) {
        return null
      }
      if (!inSet.has(partner)) {
        inSet.add(partner)
        queue.push(partner)
      }
    }
  }
  return queue.length < 9 ? queue : null
}
