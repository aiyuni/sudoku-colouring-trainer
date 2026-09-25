import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import { sudokuUnits, type Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

/** One Almost Locked Set: N unsolved cells of a single house holding N+1
 * candidates between them. */
export interface AlsInfo {
  /** Row-major order. */
  cells: Cell[]
  /** The N+1 candidates, ascending. */
  digits: number[]
}

export interface AlsXzInstance {
  alsA: AlsInfo
  alsB: AlsInfo
  /** The restricted common candidate (HoDoKu's X). */
  rcc: number
  /** Every common digit other than the RCC that eliminates something (HoDoKu's
   * Z) - more than one when the same pair of ALS proves several things. */
  zDigits: number[]
  eliminations: CandidateElimination[]
  /** "ALS A {6,7,9} at r1c6, r1c7 and ALS B {6,7,8,9} at r3c2, r3c8, r3c9
   * are linked by 6, so 7 must be in A or B" - shared by the Techniques panel
   * and Dynamic Dragon's clauses so the wording lives in one place. */
  reasonText: string
}

/** Past this many ALS pairs one find() stops looking - a guard against a
 * pathological candidate grid (Dynamic Dragon simulates on hypothetical ones),
 * far above what a real position needs: a fresh autofill of a hard puzzle has
 * a few hundred ALS, so tens of thousands of pairs. */
const MAX_ALS_PAIRS = 2_000_000

// 81-cell sets as three 27-bit words (cell index = row * 9 + col), so every
// set operation below is three integer ANDs.
const WORD_BITS = 27

interface Als extends AlsInfo {
  digitMask: number
  /** Bit per house (rows 0-8, columns 9-17, boxes 18-26) holding every cell
   * of the ALS - one, or two for cells sharing a row or column and a box. */
  houseMask: number
  /** Per digit (index digit-1, three words each): the ALS cells holding it. */
  digitCells: Int32Array
  /** Per digit (same layout): every cell that sees *all* of the ALS's
   * candidates of that digit. A cell never sees itself, so an ALS cell
   * holding the digit is never in here. */
  commonPeers: Int32Array
}

let cachedPeerWords: Int32Array | null = null

/** Per cell, the 20 peers as three words. */
function peerWords(): Int32Array {
  if (cachedPeerWords) {
    return cachedPeerWords
  }
  const words = new Int32Array(81 * 3)
  for (let a = 0; a < 81; a++) {
    const ra = Math.floor(a / BOARD_SIZE)
    const ca = a % BOARD_SIZE
    for (let b = 0; b < 81; b++) {
      if (a === b) continue
      const rb = Math.floor(b / BOARD_SIZE)
      const cb = b % BOARD_SIZE
      const sameBox =
        Math.floor(ra / BOX_SIZE) === Math.floor(rb / BOX_SIZE) && Math.floor(ca / BOX_SIZE) === Math.floor(cb / BOX_SIZE)
      if (ra === rb || ca === cb || sameBox) {
        words[a * 3 + Math.floor(b / WORD_BITS)] |= 1 << (b % WORD_BITS)
      }
    }
  }
  return (cachedPeerWords = words)
}

/**
 * ALS-xz, singly linked, as defined on HoDoKu's ALS page
 * (hodoku.sourceforge.net/en/tech_als.php).
 *
 *  - An Almost Locked Set (ALS) is N unsolved cells in one house with N+1
 *    candidates between them. A single bivalue cell is an ALS (N = 1).
 *    Remove any one of its digits and the rest become a locked set - N cells,
 *    N digits, every digit placed somewhere in the ALS.
 *  - A Restricted Common Candidate (RCC) X of two ALS A and B is a digit both
 *    hold where every X in A sees every X in B. X can then be true in at most
 *    one of them, so at least one of A and B loses X and is locked.
 *    HoDoKu lets ALS overlap in every ALS technique, provided the overlap holds
 *    no RCC - which needs no separate check here: an overlap cell holding X
 *    would have to see itself.
 *  - ALS-xz: take any other digit Z both hold. Whichever ALS is locked has a Z
 *    in it, so Z is in A or in B, and can go from every other cell that sees
 *    every Z in both. (Those cells are never in A or B themselves - see
 *    Als.commonPeers.)
 *
 * Two ALS that fit in one house together are skipped: that is always a naked
 * set, never a real ALS-xz. Inside one house any common digit outside the
 * overlap is automatically an RCC, and counting digits (each ALS has one more
 * digit than cells, X and Z are shared, and on a consistent grid k overlap
 * cells hold at least k digits, none of them X) leaves two cases: either the
 * union of the two ALS is a naked set, or the overlap cells are one on their
 * own and Z is one of their digits. Either way the naked set makes every
 * elimination the ALS-xz would. On a realistic grid that was nearly all of
 * what this used to find (32 of 34 instances on one mid-solve position), so
 * the check, one AND per pair, also saves most of the work.
 *
 * Only the singly linked form. A pair of ALS with two RCCs (the doubly linked
 * case) is still reported here, once per RCC, each taken on its own - which
 * is sound, it just leaves out the extra eliminations doubly linked ALS-XZ
 * would add. ALS-XY-Wing, ALS chains and Death Blossom are not implemented.
 *
 * find() never mutates. Results are sorted simplest-first (fewest cells across
 * both ALS, then most eliminations), and a pair whose eliminations a simpler
 * pair already makes is left out - the same conclusion is typically reachable
 * from several nearly identical pairs.
 */
export class SudokuAlsXzFinder {
  find(board: Board, candidates: CandidateGrid): AlsXzInstance[] {
    const allAls = this.findAllAls(board, candidates)

    // Per digit, every cell (as three words) still holding it.
    const digitCandidates = new Int32Array(BOARD_SIZE * 3)
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0) continue
        const index = row * BOARD_SIZE + col
        for (let d = 0; d < BOARD_SIZE; d++) {
          if (candidates[row][col][d]) {
            digitCandidates[d * 3 + Math.floor(index / WORD_BITS)] |= 1 << (index % WORD_BITS)
          }
        }
      }
    }

    const found: AlsXzInstance[] = []
    let pairsChecked = 0
    for (let i = 0; i < allAls.length && pairsChecked < MAX_ALS_PAIRS; i++) {
      const a = allAls[i]
      for (let j = i + 1; j < allAls.length; j++) {
        const b = allAls[j]
        pairsChecked++
        // Both ALS inside one house is a naked set, not an ALS-xz - see the
        // class comment.
        if (a.houseMask & b.houseMask) continue
        const common = a.digitMask & b.digitMask
        // An RCC and a Z, so at least two common digits.
        if ((common & (common - 1)) === 0) continue

        for (let x = 0; x < BOARD_SIZE; x++) {
          if (!(common & (1 << x)) || !this.isRestrictedCommon(a, b, x)) continue

          const eliminations: CandidateElimination[] = []
          const zDigits: number[] = []
          for (let z = 0; z < BOARD_SIZE; z++) {
            if (z === x || !(common & (1 << z))) continue
            const before = eliminations.length
            for (let w = 0; w < 3; w++) {
              let targets = a.commonPeers[z * 3 + w] & b.commonPeers[z * 3 + w] & digitCandidates[z * 3 + w]
              while (targets) {
                const bit = 31 - Math.clz32(targets & -targets)
                targets &= targets - 1
                const index = w * WORD_BITS + bit
                eliminations.push({ row: Math.floor(index / BOARD_SIZE), col: index % BOARD_SIZE, digit: z + 1 })
              }
            }
            if (eliminations.length > before) {
              zDigits.push(z + 1)
            }
          }
          if (eliminations.length === 0) continue
          eliminations.sort((p, q) => p.row - q.row || p.col - q.col || p.digit - q.digit)
          found.push({
            alsA: { cells: a.cells, digits: a.digits },
            alsB: { cells: b.cells, digits: b.digits },
            rcc: x + 1,
            zDigits,
            eliminations,
            reasonText: alsXzReasonText(a, b, x + 1, zDigits),
          })
        }
      }
    }

    found.sort(
      (p, q) =>
        p.alsA.cells.length + p.alsB.cells.length - (q.alsA.cells.length + q.alsB.cells.length) ||
        q.eliminations.length - p.eliminations.length,
    )
    // A realistic mid-solve grid has dozens of ALS pairs proving overlapping
    // things (a ~1700-state random sweep averaged ~90 per state before this), so an
    // instance is dropped when one already-kept, at-most-as-big instance
    // makes every one of its eliminations - the exact-duplicate case
    // included. Only against a single instance, never the union of several:
    // that would hide a pair that proves something no one other pair does.
    const kept: Array<{ instance: AlsXzInstance; keys: Set<string> }> = []
    for (const instance of found) {
      const keys = instance.eliminations.map((e) => `${e.row}.${e.col}.${e.digit}`)
      if (kept.some((k) => keys.every((key) => k.keys.has(key)))) continue
      kept.push({ instance, keys: new Set(keys) })
    }
    return kept.map((k) => k.instance)
  }

  /** Every X in B sees every X in A - equivalently, B's X cells all lie in
   * A's common peers for X. */
  private isRestrictedCommon(a: Als, b: Als, x: number): boolean {
    for (let w = 0; w < 3; w++) {
      const bCells = b.digitCells[x * 3 + w]
      if ((bCells & a.commonPeers[x * 3 + w]) !== bCells) return false
    }
    return true
  }

  /** Every ALS on the grid, each distinct cell set once (two cells of a row
   * that also share a box are found from both houses), smallest first. */
  private findAllAls(board: Board, candidates: CandidateGrid): Als[] {
    const peers = peerWords()
    const byKey = new Map<string, Als>()
    for (const unit of sudokuUnits()) {
      // Cells with no candidates at all only exist on a broken grid; leaving
      // them out keeps "N cells, N+1 digits" meaning what it should.
      const open: Array<{ cell: Cell; mask: number }> = []
      for (const [row, col] of unit) {
        if (board[row][col] !== 0) continue
        let mask = 0
        for (let d = 0; d < BOARD_SIZE; d++) {
          if (candidates[row][col][d]) mask |= 1 << d
        }
        if (mask !== 0) open.push({ cell: [row, col], mask })
      }
      const subsetCount = 1 << open.length
      for (let subset = 1; subset < subsetCount; subset++) {
        let digitMask = 0
        let size = 0
        for (let k = 0; k < open.length; k++) {
          if (subset & (1 << k)) {
            digitMask |= open[k].mask
            size++
          }
        }
        if (popcount(digitMask) !== size + 1) continue

        const cells = open.filter((_, k) => subset & (1 << k)).map((o) => o.cell)
        cells.sort((p, q) => p[0] - q[0] || p[1] - q[1])
        const key = cells.map(([r, c]) => r * BOARD_SIZE + c).join(',')
        if (byKey.has(key)) continue

        const digitCells = new Int32Array(BOARD_SIZE * 3)
        const commonPeers = new Int32Array(BOARD_SIZE * 3)
        for (let d = 0; d < BOARD_SIZE; d++) {
          if (digitMask & (1 << d)) {
            commonPeers[d * 3] = commonPeers[d * 3 + 1] = commonPeers[d * 3 + 2] = -1
          }
        }
        for (const [row, col] of cells) {
          const index = row * BOARD_SIZE + col
          for (let d = 0; d < BOARD_SIZE; d++) {
            if (!candidates[row][col][d]) continue
            digitCells[d * 3 + Math.floor(index / WORD_BITS)] |= 1 << (index % WORD_BITS)
            for (let w = 0; w < 3; w++) {
              commonPeers[d * 3 + w] &= peers[index * 3 + w]
            }
          }
        }
        byKey.set(key, {
          cells,
          digits: bitsOf(digitMask).map((d) => d + 1),
          digitMask,
          houseMask: houseMaskOf(cells),
          digitCells,
          commonPeers,
        })
      }
    }
    return [...byKey.values()].sort((p, q) => p.cells.length - q.cells.length)
  }
}

function houseMaskOf(cells: readonly Cell[]): number {
  const [row, col] = cells[0]
  const box = Math.floor(row / BOX_SIZE) * BOX_SIZE + Math.floor(col / BOX_SIZE)
  let mask = 0
  if (cells.every(([r]) => r === row)) mask |= 1 << row
  if (cells.every(([, c]) => c === col)) mask |= 1 << (BOARD_SIZE + col)
  if (cells.every(([r, c]) => Math.floor(r / BOX_SIZE) * BOX_SIZE + Math.floor(c / BOX_SIZE) === box)) {
    mask |= 1 << (2 * BOARD_SIZE + box)
  }
  return mask
}

function alsLabel(als: AlsInfo): string {
  return `{${als.digits.join(',')}} at ${als.cells.map(([row, col]) => `r${row + 1}c${col + 1}`).join(', ')}`
}

function alsXzReasonText(a: AlsInfo, b: AlsInfo, rcc: number, zDigits: number[]): string {
  const zLabel =
    zDigits.length === 1
      ? `${zDigits[0]} must be in one of them`
      : `${zDigits.slice(0, -1).join(', ')} and ${zDigits[zDigits.length - 1]} must each be in one of them`
  return (
    `ALS A ${alsLabel(a)} and ALS B ${alsLabel(b)} are linked by ${rcc} ` +
    `(every ${rcc} in A sees every ${rcc} in B, so at most one of them holds ${rcc} and the other is locked), so ${zLabel}`
  )
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
