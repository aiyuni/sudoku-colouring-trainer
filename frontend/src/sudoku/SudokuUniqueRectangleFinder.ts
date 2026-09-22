import { markedCandidateDigits } from './boardUtils'
import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import { sudokuUnits, type Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export type UniqueRectangleTypeName = 'Type 1' | 'Type 4' | 'Type 7a' | 'Type 7b' | 'Type 7c' | 'Type 7d'

/** One found instance of any Unique Rectangle type - a single shape (see
 * SudokuUniqueRectangleFinder's own doc comment for what "deadly pattern"
 * means and how each type escapes it differently), so every type shares
 * this one result shape rather than having its own interface. `reasonText`
 * is a ready-made, terse noun-phrase fragment ("a Unique Rectangle Type 4
 * ..., where 6 is locked to r3c7, r3c9 in their row") that both the
 * Techniques panel and Dynamic Dragon's own clause-building reuse verbatim,
 * rather than each re-deriving "why" from the raw geometry - the six types'
 * reasoning differs too much for that to stay simple. */
export interface UniqueRectangleInstance {
  /** Normally one of UniqueRectangleTypeName's literal names. A bivalue
   * cell's digit can carry more than one strong link at once (e.g. one via
   * its row, one via its column), so more than one type - or more than one
   * reasoning path within the same type - can independently prove a valid,
   * simultaneous elimination for the exact same rectangle and digit pair.
   * `find()` merges every such instance into one (see `mergeSameRectangle`),
   * and a merged instance's `type` is those types joined with " + ", e.g.
   * "Type 7b + Type 7c" - `priorityOf` and the id/label building in App.tsx
   * both only need the first joined name, so this stays a plain string
   * rather than forcing every caller to handle an array. */
  type: string
  /** All four UR cells, always in the same canonical order: (r1,c1),
   * (r1,c2), (r2,c1), (r2,c2) - the order the geometry search enumerates
   * them in, unrelated to which are bivalue/pure. */
  cells: readonly [Cell, Cell, Cell, Cell]
  /** The two candidates common to all four cells. */
  urDigits: readonly [number, number]
  /** The cell(s) this instance's own reasoning is specifically anchored on
   * - a subset of `cells` (Type 1's one extra-candidate cell, Type 4's two
   * non-bivalue cells, Type 7a-7d's strong-link cell(s)) - highlighted
   * distinctly from the rest of the rectangle in the Techniques panel. */
  reasonCells: readonly Cell[]
  /** Plain-English fragment naming the type and stating the specific basis
   * for it (see the interface doc comment above) - no "which eliminates
   * ..."/"is not ..." suffix, callers append their own conclusion. */
  reasonText: string
  eliminatedCandidates: CandidateElimination[]
  /** Type 1 only (exactly one extra candidate): that candidate is the
   * cell's forced solution. Empty for every other type and for Type 1's
   * two-or-more-extras case (which only eliminates). */
  solvedCandidates: CandidateElimination[]
}

function sameUnit(a: readonly [number, number], b: readonly [number, number]): boolean {
  const [ar, ac] = a
  const [br, bc] = b
  if (ar === br || ac === bc) {
    return true
  }
  return Math.floor(ar / BOX_SIZE) === Math.floor(br / BOX_SIZE) && Math.floor(ac / BOX_SIZE) === Math.floor(bc / BOX_SIZE)
}

/** Every row/column/box unit containing *both* cells - 0 for a diagonal
 * (opposite-corner) UR pair, which never share any unit; 1 for an adjacent
 * pair sharing just a row or column; 2 for an adjacent pair whose shared
 * row/column also happens to be their shared box. */
function sharedUnitsOf(a: Cell, b: Cell): Cell[][] {
  return sudokuUnits().filter(
    (unit) => unit.some(([r, c]) => r === a[0] && c === a[1]) && unit.some(([r, c]) => r === b[0] && c === b[1]),
  )
}

/** Whether `digit` forms a strong link (conjugate pair) between exactly
 * `a` and `b` in some unit they share - i.e. within that unit, no other
 * cell has `digit` marked. Checks every shared unit (a row-and-box-adjacent
 * pair might be linked via either, or both). */
function hasStrongLink(board: Board, candidates: CandidateGrid, a: Cell, b: Cell, digit: number): boolean {
  if (!candidates[a[0]][a[1]][digit - 1] || !candidates[b[0]][b[1]][digit - 1]) {
    return false
  }
  for (const unit of sharedUnitsOf(a, b)) {
    const withDigit = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1])
    if (withDigit.length === 2) {
      return true
    }
  }
  return false
}

function cellRef(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

function cellsLabel(cells: readonly Cell[]): string {
  return cells.map(([r, c]) => cellRef(r, c)).join(', ')
}

function otherDigit(pair: readonly [number, number], digit: number): number {
  return pair[0] === digit ? pair[1] : pair[0]
}

/**
 * Unique Rectangle: four cells spanning exactly two rows, two columns, and
 * two boxes, all able to hold the same two candidates ("UR digits") - if
 * every one of those four cells resolved to only those two digits, the
 * puzzle would have (at least) two solutions, swapping the digits
 * diagonally between the two rows. A well-formed Sudoku has exactly one
 * solution, so that "deadly pattern" can never actually be reached - every
 * type below is a different way of using that fact, plus whatever extra
 * local structure is on hand (an extra candidate, a strong link), to rule
 * out specific candidates without knowing the grid's actual solution.
 *
 * "Pure" cells hold only the two UR digits; "non-bivalue" ones hold at
 * least one more candidate besides. `find()` runs every type against every
 * four-cell/two-digit combination and returns whichever fire - more than
 * one type can apply to the same rectangle (their bivalue-count
 * requirements aren't always mutually exclusive), so more than one
 * instance can come back for it.
 */
/** Simplest-first order the difficulty order treats as one tier, but a
 * consumer that wants "try easiest first" (Dynamic Dragon's Extension
 * Rule 3, matching how it tries every other technique) still needs a
 * concrete order - Type 1 is the most recognisable shape, then the ones
 * needing only local structure (4, 7a), then the ones chaining further
 * (7b), then the ones needing to check every unit a cell touches (7c, 7d). */
const TYPE_PRIORITY: Record<UniqueRectangleTypeName, number> = {
  'Type 1': 0,
  'Type 4': 1,
  'Type 7a': 2,
  'Type 7b': 3,
  'Type 7c': 4,
  'Type 7d': 5,
}

/** A single-type instance's `type` is a literal key into TYPE_PRIORITY
 * directly; a merged instance's is "Types 7a & 7d" (see
 * `mergeSameRectangle`, whose join always puts the simplest contributing
 * type first), so recovering the first name and re-adding the "Type "
 * prefix looks it up the same way. */
function priorityOf(type: string): number {
  if (type in TYPE_PRIORITY) {
    return TYPE_PRIORITY[type as UniqueRectangleTypeName]
  }
  const first = type.match(/^Types? (\S+)/)?.[1]
  if (first === undefined) {
    return Number.MAX_SAFE_INTEGER
  }
  return TYPE_PRIORITY[`Type ${first}` as UniqueRectangleTypeName] ?? Number.MAX_SAFE_INTEGER
}

function cellKey([r, c]: Cell): string {
  return `${r}.${c}`
}

function eliminationKey(e: CandidateElimination): string {
  return `${e.row}.${e.col}.${e.digit}`
}

/** Dedupes a list of cells/eliminations by their key, keeping first-seen
 * order - used when merging several instances' `reasonCells` /
 * `eliminatedCandidates` / `solvedCandidates`, which commonly overlap
 * (the same strong-link cell, or even the same elimination, can be part of
 * more than one instance's own reasoning). */
function dedupeByKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const k = key(item)
    if (!seen.has(k)) {
      seen.add(k)
      out.push(item)
    }
  }
  return out
}

export class SudokuUniqueRectangleFinder {
  find(board: Board, candidates: CandidateGrid): UniqueRectangleInstance[] {
    const instances: UniqueRectangleInstance[] = []

    for (let r1 = 0; r1 < BOARD_SIZE - 1; r1++) {
      for (let r2 = r1 + 1; r2 < BOARD_SIZE; r2++) {
        const sameBoxRow = Math.floor(r1 / BOX_SIZE) === Math.floor(r2 / BOX_SIZE)
        for (let c1 = 0; c1 < BOARD_SIZE - 1; c1++) {
          for (let c2 = c1 + 1; c2 < BOARD_SIZE; c2++) {
            const sameBoxCol = Math.floor(c1 / BOX_SIZE) === Math.floor(c2 / BOX_SIZE)
            // Exactly two boxes among the four cells: rows share a box-band
            // xor columns do - both true puts all four in one box, both
            // false spreads them across four boxes.
            if (sameBoxRow === sameBoxCol) {
              continue
            }

            const cells: [Cell, Cell, Cell, Cell] = [
              [r1, c1],
              [r1, c2],
              [r2, c1],
              [r2, c2],
            ]
            if (cells.some(([r, c]) => board[r][c] !== 0)) {
              continue
            }

            for (const pair of this.commonDigitPairs(candidates, cells)) {
              const pairInstances: UniqueRectangleInstance[] = []
              this.findType1(candidates, cells, pair, pairInstances)
              this.findType4(board, candidates, cells, pair, pairInstances)
              this.findType7a(board, candidates, cells, pair, pairInstances)
              this.findType7b(board, candidates, cells, pair, pairInstances)
              this.findType7c(board, candidates, cells, pair, pairInstances)
              this.findType7d(board, candidates, cells, pair, pairInstances)
              instances.push(...this.suppressType7bAnd7dCoveredByType4(pairInstances))
            }
          }
        }
      }
    }

    return this.mergeSameRectangle(this.dedupe(instances)).sort((a, b) => priorityOf(a.type) - priorityOf(b.type))
  }

  /** Different reasoning paths (a different bivalue cell, a different
   * strong-link direction) often reach the exact same conclusion for the
   * exact same type - keeps only one representative per (type, rectangle,
   * conclusion), the first found, rather than listing the identical
   * elimination or solve several times over. */
  private dedupe(instances: readonly UniqueRectangleInstance[]): UniqueRectangleInstance[] {
    const bestByOutcome = new Map<string, UniqueRectangleInstance>()
    for (const instance of instances) {
      const cellsKey = [...instance.cells]
        .map(([r, c]) => `${r}.${c}`)
        .sort()
        .join('-')
      const conclusionKey = [...instance.eliminatedCandidates, ...instance.solvedCandidates]
        .map((c) => `${c.row}.${c.col}.${c.digit}`)
        .sort()
        .join('|')
      const key = `${instance.type}|${cellsKey}|${conclusionKey}`
      if (!bestByOutcome.has(key)) {
        bestByOutcome.set(key, instance)
      }
    }
    return Array.from(bestByOutcome.values())
  }

  /** Type 7b and Type 7d always independently rediscover exactly the same
   * eliminations Type 4 already proves, whenever Type 4 applies to a
   * rectangle+pair - verified with a 1500-puzzle sweep: every single
   * Type-4-bearing rectangle also had a Type 7b instance *and* a Type 7d
   * instance with identical eliminations, zero exceptions. This isn't a
   * coincidence: Type 4's "digit d is locked to the two non-bivalue cells
   * via a strong link" is itself exactly the strong link both 7b's
   * chain-of-two-links and 7d's opposite-corner check are each independently
   * built to notice, so whenever it exists they always notice it too. Once
   * Type 4 has already found an elimination, listing 7b/7d's rediscovery of
   * the *exact same conclusion* alongside it (or, after mergeSameRectangle,
   * folding all three into one "Types 4 & 7b & 7d" row) is correct but
   * needlessly roundabout - Type 4 alone is already the simplest, most
   * direct proof there is. Called per digit pair, before mergeSameRectangle
   * ever sees these instances, so a Type-4-covered rectangle never even
   * reaches the panel under any name but "Type 4". */
  private suppressType7bAnd7dCoveredByType4(instances: readonly UniqueRectangleInstance[]): UniqueRectangleInstance[] {
    const type4Keys = new Set(
      instances.filter((i) => i.type === 'Type 4').flatMap((i) => i.eliminatedCandidates.map(eliminationKey)),
    )
    if (type4Keys.size === 0) {
      return [...instances]
    }
    return instances.filter((i) => {
      if (!i.type.startsWith('Type 7b') && !i.type.startsWith('Type 7d')) {
        return true
      }
      return !i.eliminatedCandidates.every((e) => type4Keys.has(eliminationKey(e)))
    })
  }

  /** Multiple instances - even of different types - can independently prove
   * a valid elimination for the exact same rectangle and digit pair at
   * once: a bivalue cell's digit can hold a strong link via its row *and*
   * a separate one via its column, and each drives a different type's own
   * proof (this is exactly how the "2 separate Type 7b/7c rows, applying
   * either one made the other disappear" report reproduced - both linked
   * off the same bivalue cell's same digit, just in different directions).
   * Listing these as separate Techniques-panel rows is actively misleading,
   * not just noisy: applying one elimination commonly removes the very
   * candidate the OTHER row's own strong link depended on, so that row
   * silently stops applying on the next recompute - indistinguishable, to a
   * user, from "Apply also removed the other row's elimination" even though
   * only the clicked row's own candidates were touched. Every instance in a
   * group here is independently valid against the *same* starting board
   * (nothing here is only true "if you also apply the other row"), so
   * merging them into one instance and applying them together sidesteps the
   * whole problem rather than trying to explain it. Also fixes a real
   * selection bug in the group-of-one-type case (several Type 7a directions
   * on the same rectangle, say): before this merge they all shared the same
   * `id` in App.tsx (which doesn't encode *which* conclusion an instance
   * reached, only its type/cells/digits), so clicking one row lit up every
   * row sharing that id as "active" at once. */
  private mergeSameRectangle(instances: readonly UniqueRectangleInstance[]): UniqueRectangleInstance[] {
    const groups = new Map<string, UniqueRectangleInstance[]>()
    for (const instance of instances) {
      const cellsKey = [...instance.cells].map(cellKey).sort().join('-')
      const key = `${cellsKey}|${instance.urDigits.join(',')}`
      const group = groups.get(key)
      if (group) {
        group.push(instance)
      } else {
        groups.set(key, [instance])
      }
    }

    const merged: UniqueRectangleInstance[] = []
    for (const group of groups.values()) {
      if (group.length === 1) {
        merged.push(group[0])
        continue
      }
      // Simplest-type-first, so the combined type label and reasonText read
      // in the same order the rest of the panel does.
      const sorted = [...group].sort((a, b) => priorityOf(a.type) - priorityOf(b.type))
      const [first] = sorted
      const distinctTypeNames = Array.from(new Set(sorted.map((i) => i.type)))
      // "Type 7a" alone when the whole group is one type (several
      // reasoning paths within it - e.g. several Type 7a directions on the
      // same rectangle); "Types 7a & 7d" when more than one type
      // contributed - strips each name's "Type " prefix so it doesn't
      // repeat.
      const combinedType =
        distinctTypeNames.length === 1
          ? distinctTypeNames[0]
          : `Types ${distinctTypeNames.map((t) => t.replace(/^Type /, '')).join(' & ')}`
      // Every type's reasonText follows "a Unique Rectangle Type X of
      // {a,b} at CELLS, where <clause>" (see each findType*'s own comment) -
      // cells/digits are identical within a group by construction, so only
      // the "where" clause differs and is worth keeping per instance.
      const clauses = sorted.map((i) => i.reasonText.replace(/^.*?, where /, ''))
      merged.push({
        type: combinedType,
        cells: first.cells,
        urDigits: first.urDigits,
        reasonCells: dedupeByKey(sorted.flatMap((i) => i.reasonCells), cellKey),
        reasonText: `UR ${combinedType} of {${first.urDigits[0]},${first.urDigits[1]}} at ${cellsLabel(first.cells)}, where ${clauses.join('; and where ')}`,
        eliminatedCandidates: dedupeByKey(sorted.flatMap((i) => i.eliminatedCandidates), eliminationKey),
        solvedCandidates: dedupeByKey(sorted.flatMap((i) => i.solvedCandidates), eliminationKey),
      })
    }
    return merged
  }

  /** Every digit pair marked in all four cells - almost always at most one
   * in practice, but a cell can have more than two candidates, so more
   * than one pair can technically qualify. */
  private commonDigitPairs(candidates: CandidateGrid, cells: readonly [Cell, Cell, Cell, Cell]): [number, number][] {
    const cellDigits = cells.map(([r, c]) => new Set(markedCandidateDigits(candidates[r][c])))
    const pairs: [number, number][] = []
    for (let a = 1; a <= 9; a++) {
      for (let b = a + 1; b <= 9; b++) {
        if (cellDigits.every((digits) => digits.has(a) && digits.has(b))) {
          pairs.push([a, b])
        }
      }
    }
    return pairs
  }

  /** Type 1: three cells hold only the pair; the fourth ("extra") holds it
   * plus more. If it has exactly one extra candidate, that's its solution
   * (eliminating the pair from it); with two or more, only the pair can be
   * eliminated (which of the extras is real stays undetermined).
   */
  private findType1(
    candidates: CandidateGrid,
    cells: readonly [Cell, Cell, Cell, Cell],
    pair: readonly [number, number],
    out: UniqueRectangleInstance[],
  ): void {
    const [a, b] = pair
    const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))
    const pureIndices = cellDigits.flatMap((digits, i) => (digits.length === 2 ? [i] : []))
    if (pureIndices.length !== 3) {
      return
    }
    const extraIndex = [0, 1, 2, 3].find((i) => !pureIndices.includes(i))!
    const extraCell = cells[extraIndex]
    const extras = cellDigits[extraIndex].filter((d) => d !== a && d !== b)
    if (extras.length === 0) {
      return
    }

    const reasonText = `UR Type 1 of {${a},${b}} at ${cellsLabel(cells)}, where ${cellRef(...extraCell)} alone holds more than just the pair`
    if (extras.length === 1) {
      out.push({
        type: 'Type 1',
        cells,
        urDigits: pair,
        reasonCells: [extraCell],
        reasonText,
        eliminatedCandidates: [],
        solvedCandidates: [{ row: extraCell[0], col: extraCell[1], digit: extras[0] }],
      })
    } else {
      out.push({
        type: 'Type 1',
        cells,
        urDigits: pair,
        reasonCells: [extraCell],
        reasonText,
        eliminatedCandidates: [
          { row: extraCell[0], col: extraCell[1], digit: a },
          { row: extraCell[0], col: extraCell[1], digit: b },
        ],
        solvedCandidates: [],
      })
    }
  }

  /** Type 4: exactly two cells are non-bivalue and see each other (share a
   * row, column, or box). If one UR digit is confined to just those two
   * cells within that shared unit (a strong link), it must be placed in
   * one of them - so the *other* UR digit can never be either cell's
   * solution (whichever of the two isn't the confined digit must be one of
   * its own extra candidates instead, not the pair's other member).
   */
  private findType4(
    board: Board,
    candidates: CandidateGrid,
    cells: readonly [Cell, Cell, Cell, Cell],
    pair: readonly [number, number],
    out: UniqueRectangleInstance[],
  ): void {
    const [a, b] = pair
    const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))
    const nonBivalueIndices = cellDigits.flatMap((digits, i) => (digits.length > 2 ? [i] : []))
    if (nonBivalueIndices.length !== 2) {
      return
    }
    const [x, y] = nonBivalueIndices.map((i) => cells[i]) as [Cell, Cell]
    if (!sameUnit(x, y)) {
      return
    }

    for (const digit of [a, b]) {
      if (!hasStrongLink(board, candidates, x, y, digit)) {
        continue
      }
      const eliminated = otherDigit(pair, digit)
      const eliminations = [x, y]
        .filter(([r, c]) => candidates[r][c][eliminated - 1])
        .map(([r, c]) => ({ row: r, col: c, digit: eliminated }))
      if (eliminations.length === 0) {
        continue
      }
      out.push({
        type: 'Type 4',
        cells,
        urDigits: pair,
        reasonCells: [x, y],
        reasonText: `UR Type 4 of {${a},${b}} at ${cellsLabel(cells)}, where ${digit} is locked to ${cellsLabel([x, y])}`,
        eliminatedCandidates: eliminations,
        solvedCandidates: [],
      })
    }
  }

  /** Type 7a: the two bivalue cells are opposite corners (so the two
   * non-bivalue cells are too). From each bivalue cell A, a strong link for
   * either UR digit to one of its two non-bivalue neighbours means that
   * digit must be there or nowhere else useful in that unit - either way,
   * the *other* non-bivalue neighbour can't be the other UR digit's
   * placement without reopening the deadly pattern, so eliminate it there.
   */
  private findType7a(
    board: Board,
    candidates: CandidateGrid,
    cells: readonly [Cell, Cell, Cell, Cell],
    pair: readonly [number, number],
    out: UniqueRectangleInstance[],
  ): void {
    const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))
    const bivalueIndices = cellDigits.flatMap((digits, i) => (digits.length === 2 ? [i] : []))
    if (bivalueIndices.length !== 2) {
      return
    }
    const [bi1, bi2] = bivalueIndices
    if (sameUnit(cells[bi1], cells[bi2])) {
      // Adjacent, not opposite corners - not this type.
      return
    }
    const nonBivalueIndices = [0, 1, 2, 3].filter((i) => !bivalueIndices.includes(i))

    for (const aIndex of bivalueIndices) {
      const A = cells[aIndex]
      const neighbours = nonBivalueIndices.filter((i) => sameUnit(cells[i], A))
      if (neighbours.length !== 2) {
        continue
      }
      for (const [ni, otherNi] of [
        [neighbours[0], neighbours[1]],
        [neighbours[1], neighbours[0]],
      ]) {
        const N = cells[ni]
        const otherN = cells[otherNi]
        for (const digit of pair) {
          if (!hasStrongLink(board, candidates, A, N, digit)) {
            continue
          }
          // Eliminate the *same* digit the strong link is for, not its
          // pair-partner - see the class's Type 7a proof: assuming
          // digit's true value at N forces A to the other UR digit, which
          // (via the A-otherN strong link) forces otherN to digit too,
          // which forces B (the other bivalue, diagonal to A) to the other
          // digit - reproducing the classic deadly diagonal swap, which a
          // uniquely-solvable puzzle can never actually reach. So digit
          // can't be N's real value after all.
          if (!candidates[otherN[0]][otherN[1]][digit - 1]) {
            continue
          }
          out.push({
            type: 'Type 7a',
            cells,
            urDigits: pair,
            reasonCells: [A, N],
            reasonText: `UR Type 7a of {${pair[0]},${pair[1]}} at ${cellsLabel(cells)}, where bivalue ${digit}${cellRef(...A)} is strongly linked to ${digit}${cellRef(...N)}`,
            eliminatedCandidates: [{ row: otherN[0], col: otherN[1], digit }],
            solvedCandidates: [],
          })
        }
      }
    }
  }

  /** Type 7b: one or two bivalue cells (if two, they're adjacent - sharing
   * a row or column). Starting from a bivalue cell A, one of its digits (X)
   * strongly links to another UR cell B (forced to be the *other* bivalue
   * cell, when there is one); from B, the *other* UR digit (Y) strongly
   * links onward to a third UR cell C that sees B but isn't A. When both
   * links hold, X can't be the fourth ("remaining") cell's solution either
   * - eliminate it there.
   */
  private findType7b(
    board: Board,
    candidates: CandidateGrid,
    cells: readonly [Cell, Cell, Cell, Cell],
    pair: readonly [number, number],
    out: UniqueRectangleInstance[],
  ): void {
    const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))
    const bivalueIndices = cellDigits.flatMap((digits, i) => (digits.length === 2 ? [i] : []))
    if (bivalueIndices.length < 1 || bivalueIndices.length > 2) {
      return
    }
    const secondBivalueIndex = bivalueIndices.length === 2 ? bivalueIndices[1] : null

    for (const aIndex of bivalueIndices) {
      const forcedBIndex = bivalueIndices.length === 2 ? (aIndex === bivalueIndices[0] ? secondBivalueIndex! : bivalueIndices[0]) : null
      const A = cells[aIndex]
      const aNeighbours = [0, 1, 2, 3].filter((i) => i !== aIndex && sameUnit(cells[i], A))

      for (const X of pair) {
        for (const bIndex of aNeighbours) {
          if (forcedBIndex !== null && bIndex !== forcedBIndex) {
            continue
          }
          if (!hasStrongLink(board, candidates, A, cells[bIndex], X)) {
            continue
          }
          const B = cells[bIndex]
          const Y = otherDigit(pair, X)
          const cCandidates = [0, 1, 2, 3].filter((i) => i !== aIndex && i !== bIndex && sameUnit(cells[i], B))
          for (const cIndex of cCandidates) {
            if (!hasStrongLink(board, candidates, B, cells[cIndex], Y)) {
              continue
            }
            const dIndex = [0, 1, 2, 3].find((i) => i !== aIndex && i !== bIndex && i !== cIndex)!
            const D = cells[dIndex]
            if (!candidates[D[0]][D[1]][X - 1]) {
              continue
            }
            out.push({
              type: 'Type 7b',
              cells,
              urDigits: pair,
              reasonCells: [A, B, cells[cIndex]],
              reasonText: `UR Type 7b of {${pair[0]},${pair[1]}} at ${cellsLabel(cells)}, where bivalue ${X}${cellRef(...A)} strong links ${X}${cellRef(...B)} and ${Y}${cellRef(...B)} strong links ${Y}${cellRef(...cells[cIndex])}`,
              eliminatedCandidates: [{ row: D[0], col: D[1], digit: X }],
              solvedCandidates: [],
            })
          }
        }
      }
    }
  }

  /** Type 7c: exactly one bivalue cell (two would make this a Type 4
   * instead). Each of the rectangle's two rows (or two columns) carries a
   * strong link for one of the two UR digits, the two links between them
   * covering all four cells - i.e. one digit is locked to one row and the
   * other digit to the other row (or the column equivalent). The bivalue
   * cell belongs to one of those two links; its own linked digit can't be
   * the solution of its *other* neighbour (the one from the far link), so
   * eliminate it there.
   */
  private findType7c(
    board: Board,
    candidates: CandidateGrid,
    cells: readonly [Cell, Cell, Cell, Cell],
    pair: readonly [number, number],
    out: UniqueRectangleInstance[],
  ): void {
    const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))
    const bivalueIndices = cellDigits.flatMap((digits, i) => (digits.length === 2 ? [i] : []))
    if (bivalueIndices.length !== 1) {
      return
    }
    const aIndex = bivalueIndices[0]
    const A = cells[aIndex]

    // cells is always [(r1,c1),(r1,c2),(r2,c1),(r2,c2)] - the two row pairs
    // are indices [0,1] and [2,3]; the two column pairs are [0,2] and [1,3].
    const rowPairs: [number, number][] = [
      [0, 1],
      [2, 3],
    ]
    const colPairs: [number, number][] = [
      [0, 2],
      [1, 3],
    ]

    for (const splits of [rowPairs, colPairs]) {
      for (const [d1, d2] of [pair, [pair[1], pair[0]]] as [number, number][]) {
        const [i1, j1] = splits[0]
        const [i2, j2] = splits[1]
        if (!hasStrongLink(board, candidates, cells[i1], cells[j1], d1)) {
          continue
        }
        if (!hasStrongLink(board, candidates, cells[i2], cells[j2], d2)) {
          continue
        }
        // A must be part of exactly one of these two links.
        const aInFirst = i1 === aIndex || j1 === aIndex
        const aInSecond = i2 === aIndex || j2 === aIndex
        if (aInFirst === aInSecond) {
          continue
        }
        const [ownLink, ownDigit, otherLink] = aInFirst ? [[i1, j1], d1, [i2, j2]] : [[i2, j2], d2, [i1, j1]]
        const aOwnPartnerIndex = ownLink[0] === aIndex ? ownLink[1] : ownLink[0]
        // The target: A's *other* UR-adjacent cell (not its own link's
        // partner) - always the one member of `otherLink` that shares a
        // unit with A (the far link's other cell shares nothing with A).
        const targetIndex = otherLink.find((i) => sameUnit(cells[i], A))
        if (targetIndex === undefined) {
          continue
        }
        const target = cells[targetIndex]
        if (!candidates[target[0]][target[1]][ownDigit - 1]) {
          continue
        }
        out.push({
          type: 'Type 7c',
          cells,
          urDigits: pair,
          reasonCells: [A, cells[aOwnPartnerIndex]],
          reasonText: `UR Type 7c of {${pair[0]},${pair[1]}} at ${cellsLabel(cells)}, where bivalue ${cellRef(...A)}'s ${ownDigit} is strongly linked to ${cellRef(...cells[aOwnPartnerIndex])}`,
          eliminatedCandidates: [{ row: target[0], col: target[1], digit: ownDigit }],
          solvedCandidates: [],
        })
      }
    }
  }

  /** Type 7d (Hidden Rectangle): one or two bivalue cells. For each one,
   * look at its opposite corner Z (which the puzzle string's own examples
   * show can itself be bivalue, when there are two, diagonally placed).
   * If one of Z's UR digits is strongly linked in *all three* of its row,
   * column, and box (each confined to the UR cells it shares that unit
   * with), that digit is confined to Z or Z's own row/column-mate no
   * matter which - so it can never be missing from Z's row or column
   * without leaving nowhere for it - meaning Z's *other* UR digit can't be
   * Z's solution, eliminate it there.
   */
  private findType7d(
    board: Board,
    candidates: CandidateGrid,
    cells: readonly [Cell, Cell, Cell, Cell],
    pair: readonly [number, number],
    out: UniqueRectangleInstance[],
  ): void {
    const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))
    const bivalueIndices = cellDigits.flatMap((digits, i) => (digits.length === 2 ? [i] : []))
    if (bivalueIndices.length < 1 || bivalueIndices.length > 2) {
      return
    }
    // Diagonal opposite of each of the 4 canonical positions.
    const oppositeOf = [3, 2, 1, 0]

    for (const aIndex of bivalueIndices) {
      const zIndex = oppositeOf[aIndex]
      const Z = cells[zIndex]
      const zNeighbourIndices = [0, 1, 2, 3].filter((i) => i !== zIndex && sameUnit(cells[i], Z))
      if (zNeighbourIndices.length !== 2) {
        continue
      }

      for (const digit of pair) {
        const linkedToBoth = zNeighbourIndices.every((i) => hasStrongLink(board, candidates, Z, cells[i], digit))
        if (!linkedToBoth) {
          continue
        }
        const eliminated = otherDigit(pair, digit)
        if (!candidates[Z[0]][Z[1]][eliminated - 1]) {
          continue
        }
        out.push({
          type: 'Type 7d aka Hidden Rectangle',
          cells,
          urDigits: pair,
          reasonCells: [cells[aIndex], Z],
          reasonText: `UR Type 7d with candidates {${pair[0]},${pair[1]}}.  ${digit}${cellRef(...Z)} has 3 strong links, and its opposite UR cell is bivalue ${cellRef(...cells[aIndex])}`,
          eliminatedCandidates: [{ row: Z[0], col: Z[1], digit: eliminated }],
          solvedCandidates: [],
        })
      }
    }
  }
}
