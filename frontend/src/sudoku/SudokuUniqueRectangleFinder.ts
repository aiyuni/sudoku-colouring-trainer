import { hasDiagonals, onActiveDiagonal, uniquenessHolds } from './SudokuConstraints'
import { markedCandidateDigits } from './boardUtils'
import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE } from './SudokuRules'
import { boxOf, boxWord, sameBox, sudokuUnits, type Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export type UniqueRectangleTypeName =
  | 'Type 1'
  | 'Type 2'
  | 'Type 3'
  | 'Type 4'
  | 'Type 5'
  | 'Type 7a'
  | 'Type 7b'
  | 'Type 7c'
  | 'Type 7d'

/** One reasoning path behind a UR instance: which type found it, the bare
 * "where" clause stating its basis ("6r1c4 is strongly linked to 6r1c6"),
 * and exactly what *this* path proves. A merged instance keeps one per
 * contributing path, so the panel can pair each clause with its own
 * conclusion (explainUniqueRectangle) instead of listing every clause and
 * then every elimination as two unconnected lists. */
export interface UniqueRectangleReason {
  type: UniqueRectangleTypeName
  clause: string
  /** Types 7a and 7d only: the strong link(s) the clause states, as
   * candidate labels ("6r1c4" -> ["6r1c6"]), so paths sharing a source can
   * be told as one clause ("6r1c4 is strongly linked to 6r1c6 and 6r9c4"). */
  link?: { from: string; to: string[] }
  eliminatedCandidates: CandidateElimination[]
  solvedCandidates: CandidateElimination[]
}

/** One found instance of any Unique Rectangle type - a single shape (see
 * SudokuUniqueRectangleFinder's own doc comment for what "deadly pattern"
 * means and how each type escapes it differently), so every type shares
 * this one result shape rather than having its own interface. `reasonText`
 * is a ready-made, terse noun-phrase fragment ("UR Type 4 of {2,6} at ...,
 * where 6 is locked to r3c7, r3c9") that Dynamic Dragon's own
 * clause-building reuses verbatim, rather than re-deriving "why" from the
 * raw geometry - the types' reasoning differs too much for that to stay
 * simple. The Techniques panel uses explainUniqueRectangle instead, which
 * also knows what the resulting grid looks like. */
export interface UniqueRectangleInstance {
  /** Normally one of UniqueRectangleTypeName's literal names. A bivalue
   * cell's digit can carry more than one strong link at once (e.g. one via
   * its row, one via its column), so more than one type - or more than one
   * reasoning path within the same type - can independently prove a valid,
   * simultaneous elimination for the exact same rectangle and digit pair.
   * `find()` merges every such instance into one (see `mergeSameRectangle`),
   * and a merged instance's `type` is "Types 7a & 7d" (see typeLabelOf) -
   * `priorityOf` and the id/label building in techniqueEngine.ts both only
   * need the first name, so this stays a plain string rather than forcing
   * every caller to handle an array. `reasons` has the per-path detail. */
  type: string
  /** Every reasoning path behind this instance, simplest type first - one
   * for an unmerged instance. */
  reasons: readonly UniqueRectangleReason[]
  /** All four UR cells, always in the same canonical order: (r1,c1),
   * (r1,c2), (r2,c1), (r2,c2) - the order the geometry search enumerates
   * them in, unrelated to which are bivalue/pure. */
  cells: readonly [Cell, Cell, Cell, Cell]
  /** The two candidates common to all four cells. */
  urDigits: readonly [number, number]
  /** The cell(s) this instance's own reasoning is specifically anchored on
   * - a subset of `cells` (Type 1's one extra-candidate cell, Types 2/3/5's
   * extra-candidate corners, Type 4's two non-bivalue cells, Type 7a-7d's
   * strong-link cell(s)) - highlighted
   * distinctly from the rest of the rectangle in the Techniques panel. */
  reasonCells: readonly Cell[]
  /** Type 3 only: the cells *outside* the rectangle that complete its naked
   * subset with the two extra-candidate corners (see findType3) - part of
   * the basis, but not UR cells, so kept apart from `cells`/`reasonCells`.
   * Absent for every other type. */
  subsetCells?: readonly Cell[]
  /** Plain-English fragment naming the type and stating the specific basis
   * for it (see the interface doc comment above) - no "which eliminates
   * ..."/"is not ..." suffix, callers append their own conclusion. Built
   * from `reasons` by reasonTextOf, never by hand. */
  reasonText: string
  eliminatedCandidates: CandidateElimination[]
  /** Type 1 only (exactly one extra candidate): that candidate is the
   * cell's forced solution. Empty for every other type and for Type 1's
   * two-or-more-extras case (which only eliminates). */
  solvedCandidates: CandidateElimination[]
}

export function sameUnit(a: readonly [number, number], b: readonly [number, number]): boolean {
  const [ar, ac] = a
  const [br, bc] = b
  if (ar === br || ac === bc) {
    return true
  }
  return sameBox(ar, ac, br, bc)
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
export function hasStrongLink(board: Board, candidates: CandidateGrid, a: Cell, b: Cell, digit: number): boolean {
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

function bitCount(mask: number): number {
  let count = 0
  for (let m = mask; m !== 0; m &= m - 1) {
    count++
  }
  return count
}

/** "row 6" / "column 3" / "box 5" for one of sudokuUnits()'s houses. */
function houseLabel(house: readonly Cell[]): string {
  const [[r0, c0]] = house
  if (house.every(([r]) => r === r0)) {
    return `row ${r0 + 1}`
  }
  if (house.every(([, c]) => c === c0)) {
    return `column ${c0 + 1}`
  }
  return `${boxWord()} ${boxOf(r0, c0) + 1}`
}

/** Every unsolved cell outside the rectangle that still has `digit` marked
 * and sees every one of `targets` - where a digit that must land on one of
 * `targets` can't go. */
function cellsSeeingAll(
  board: Board,
  candidates: CandidateGrid,
  rectangle: readonly Cell[],
  targets: readonly Cell[],
  digit: number,
): Cell[] {
  const out: Cell[] = []
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== 0 || !candidates[r][c][digit - 1] || rectangle.some(([rr, rc]) => rr === r && rc === c)) {
        continue
      }
      if (targets.every((target) => sameUnit([r, c], target))) {
        out.push([r, c])
      }
    }
  }
  return out
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
 * concrete order - Type 1 is the most recognisable shape, then the "one
 * shared extra candidate" ones (2, and 5, its diagonal/three-corner
 * variant), then the ones needing only local structure (4, 7a), then the
 * ones chaining further (7b), then the ones needing to check every unit a
 * cell touches (7c, 7d). Type 3 sits right after 4: it needs a whole naked
 * subset spotted around the rectangle, but no chaining. */
const TYPE_PRIORITY: Record<UniqueRectangleTypeName, number> = {
  'Type 1': 0,
  'Type 2': 1,
  'Type 5': 2,
  'Type 4': 3,
  'Type 3': 4,
  'Type 7a': 5,
  'Type 7b': 6,
  'Type 7c': 7,
  'Type 7d': 8,
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

/** "a", "a and b", "a, b and c". */
function joinList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** "Type 7a", or "Types 7a & 7d" when more than one type contributed
 * (simplest first, as `reasons` always is). */
function typeLabelOf(reasons: readonly UniqueRectangleReason[]): string {
  const names = Array.from(new Set(reasons.map((r) => r.type)))
  return names.length === 1 ? names[0] : `Types ${names.map((t) => t.replace(/^Type /, '')).join(' & ')}`
}

interface ReasonGroup {
  type: UniqueRectangleTypeName
  clause: string
  reasons: UniqueRectangleReason[]
}

/** Folds paths that read naturally as one clause: Type 7d paths (the same
 * Hidden Rectangle deduction seen from each bivalue corner - "6r1c4 and
 * 6r9c6 are each strongly linked to both of their neighbouring corners"),
 * and strong-link paths of one type from the same source candidate ("6r1c4
 * is strongly linked to 6r1c6 and 6r9c4"). Anything else stays its own
 * clause. Before this, a rectangle with three Type 7a and two Type 7d paths
 * read as five near-identical "and where ..." clauses. */
function groupReasons(reasons: readonly UniqueRectangleReason[]): ReasonGroup[] {
  const groups = new Map<string, UniqueRectangleReason[]>()
  reasons.forEach((reason, i) => {
    const key = reason.type === 'Type 7d' ? reason.type : reason.link ? `${reason.type}|${reason.link.from}` : `#${i}`
    const group = groups.get(key)
    if (group) {
      group.push(reason)
    } else {
      groups.set(key, [reason])
    }
  })
  return Array.from(groups.values(), (group) => ({ type: group[0].type, clause: groupClause(group), reasons: group }))
}

function groupClause(group: readonly UniqueRectangleReason[]): string {
  if (group.length === 1) {
    return group[0].clause
  }
  // Labels are "<digit>r<row>c<col>" with single-digit parts, so a string
  // sort is reading order (per digit).
  const froms = Array.from(new Set(group.map((r) => r.link!.from))).sort()
  if (froms.length === 1) {
    return `${froms[0]} is strongly linked to ${joinList(Array.from(new Set(group.flatMap((r) => r.link!.to))))}`
  }
  // Only Type 7d groups span several sources (see groupReasons).
  return `${joinList(froms)} are each strongly linked to both of their neighbouring corners`
}

/** " (7a)" after each clause when more than one type is being told, so the
 * reader can tell which type each clause is. */
function typeTag(group: ReasonGroup, multiType: boolean): string {
  return multiType ? ` (${group.type.replace(/^Type /, '')})` : ''
}

/** The instance's `reasonText`: "UR <types> of {a,b} at <cells>, where
 * <clause>[; <clause>...]" - conclusion-free, since Dynamic Dragon appends
 * its own "which eliminates ...". */
function reasonTextOf(
  urDigits: readonly [number, number],
  cells: readonly Cell[],
  reasons: readonly UniqueRectangleReason[],
): string {
  const groups = groupReasons(reasons)
  const multiType = new Set(reasons.map((r) => r.type)).size > 1
  const clauses = groups.map((group) => `${group.clause}${typeTag(group, multiType)}`)
  return `UR ${typeLabelOf(reasons)} of {${urDigits[0]},${urDigits[1]}} at ${cellsLabel(cells)}, where ${clauses.join('; ')}`
}

/** Builds a single-path instance: its one reason, and the reasonText from it. */
function makeInstance(
  fields: Omit<UniqueRectangleInstance, 'type' | 'reasons' | 'reasonText'> & {
    type: UniqueRectangleTypeName
    clause: string
    link?: UniqueRectangleReason['link']
  },
): UniqueRectangleInstance {
  const { clause, link, ...instance } = fields
  const reasons: UniqueRectangleReason[] = [
    {
      type: instance.type,
      clause,
      ...(link && { link }),
      eliminatedCandidates: instance.eliminatedCandidates,
      solvedCandidates: instance.solvedCandidates,
    },
  ]
  return { ...instance, reasons, reasonText: reasonTextOf(instance.urDigits, instance.cells, reasons) }
}

export interface UniqueRectangleExplanation {
  /** The types the text actually cites: a path whose whole conclusion
   * already follows from another path's placement is left out, and so is
   * its type if nothing else of that type is told. */
  typeLabel: string
  /** One sentence, each clause followed by its own conclusion. */
  text: string
  /** Type 1's solve, plus every cell the eliminations leave with a single
   * candidate - what the text states as placements. Wording only: the
   * instance's own eliminatedCandidates/solvedCandidates are what gets
   * applied, unchanged (the cell is left holding just that one candidate). */
  placements: CandidateElimination[]
}

/** The Techniques panel's wording for a UR instance. Unlike `reasonText`
 * this knows the grid, so it can say what the eliminations actually leave:
 *  - a cell cut to one candidate is stated as a placement ("r1c4 is 6"), not
 *    as the elimination that happens to get it there;
 *  - an elimination of that digit from a peer of the placement is left
 *    unsaid (it follows from the placement; it's still in
 *    eliminatedCandidates and still applied), and so is a path left with
 *    nothing else to say;
 * Text only: nothing here changes what the instance eliminates or solves.
 *  - each remaining clause is followed by its own conclusion, instead of
 *    every clause and then every elimination as two unconnected lists.
 * A merged Types 7a & 7d rectangle used to read as five "and where"
 * clauses plus five eliminations; it now reads as one placement clause and
 * one elimination clause. */
export function explainUniqueRectangle(ur: UniqueRectangleInstance, candidates: CandidateGrid): UniqueRectangleExplanation {
  const remainingAfter = (row: number, col: number, eliminated: readonly CandidateElimination[]) =>
    markedCandidateDigits(candidates[row][col]).filter(
      (d) => !eliminated.some((e) => e.row === row && e.col === col && e.digit === d),
    )
  const placements = dedupeByKey(
    [
      ...ur.solvedCandidates,
      ...ur.eliminatedCandidates.flatMap(({ row, col }) => {
        const left = remainingAfter(row, col, ur.eliminatedCandidates)
        return left.length === 1 ? [{ row, col, digit: left[0] }] : []
      }),
    ],
    eliminationKey,
  )
  const placementAt = (row: number, col: number) => placements.find((p) => p.row === row && p.col === col)
  const followsFromPlacement = (e: CandidateElimination) =>
    placements.some((p) => p.digit === e.digit && !(p.row === e.row && p.col === e.col) && sameUnit([p.row, p.col], [e.row, e.col]))

  type Item = { placed: boolean } & CandidateElimination
  const itemKey = (item: Item) => `${item.placed}|${eliminationKey(item)}`
  // Per path first, so a path with nothing left to say is dropped before
  // grouping - otherwise a grouped clause would still cite its link.
  const stated = new Set<string>()
  const itemsByReason = new Map<UniqueRectangleReason, Item[]>()
  for (const reason of ur.reasons) {
    const items: Item[] = reason.solvedCandidates.map((s) => ({ placed: true, ...s }))
    for (const e of reason.eliminatedCandidates) {
      const placement = placementAt(e.row, e.col)
      if (placement) {
        // Only claim the placement when this path's own eliminations are
        // what leave the cell one candidate; otherwise say what it proves.
        items.push(
          remainingAfter(e.row, e.col, reason.eliminatedCandidates).length === 1
            ? { placed: true, ...placement }
            : { placed: false, ...e },
        )
      } else if (!followsFromPlacement(e)) {
        items.push({ placed: false, ...e })
      }
    }
    const fresh = dedupeByKey(items, itemKey).filter((item) => !stated.has(itemKey(item)))
    if (fresh.length > 0) {
      fresh.forEach((item) => stated.add(itemKey(item)))
      itemsByReason.set(reason, fresh)
    }
  }
  const told = groupReasons(Array.from(itemsByReason.keys())).map((group) => ({
    group,
    items: group.reasons.flatMap((r) => itemsByReason.get(r)!),
  }))

  // Cells sharing the same digit(s) are told together, in reading order:
  // "r1c4 and r9c6 are 6", "r6c8 cannot be 1, 3 or 7".
  const grouped = (items: readonly CandidateElimination[], verb: (plural: boolean) => string) => {
    const digitsByCell = new Map<string, { row: number; col: number; digits: number[] }>()
    for (const { row, col, digit } of [...items].sort((a, b) => a.row - b.row || a.col - b.col || a.digit - b.digit)) {
      const entry = digitsByCell.get(`${row}.${col}`) ?? { row, col, digits: [] }
      entry.digits.push(digit)
      digitsByCell.set(`${row}.${col}`, entry)
    }
    const cellsByDigits = new Map<string, string[]>()
    for (const { row, col, digits } of digitsByCell.values()) {
      const key = joinList(digits.map(String)).replace(/ and /, ' or ')
      cellsByDigits.set(key, [...(cellsByDigits.get(key) ?? []), cellRef(row, col)])
    }
    return Array.from(cellsByDigits, ([digits, cells]) => `${joinList(cells)} ${verb(cells.length > 1)} ${digits}`)
  }
  const conclusion = (items: readonly Item[]) =>
    [
      ...grouped(items.filter((i) => i.placed), (plural) => (plural ? 'are' : 'is')),
      ...grouped(items.filter((i) => !i.placed), () => 'cannot be'),
    ].join(', ')
  // A placement no single clause makes on its own (two clauses each cut the
  // same cell by one candidate) is still where the eliminations leave that
  // cell, so say so.
  const unstated = placements.filter((p) => !stated.has(`true|${eliminationKey(p)}`))
  const leaving = unstated.length > 0 ? `, leaving ${grouped(unstated, () => 'as').join(', ')}` : ''

  const toldReasons = told.flatMap(({ group }) => group.reasons)
  const typeLabel = typeLabelOf(toldReasons)
  const multiType = new Set(toldReasons.map((r) => r.type)).size > 1
  const header = `UR ${typeLabel} of {${ur.urDigits[0]},${ur.urDigits[1]}} at ${cellsLabel(ur.cells)}`
  const text =
    told.length === 1
      ? `${header}, where ${told[0].group.clause}, thus ${conclusion(told[0].items)}${leaving}`
      : `${header}: ${told.map(({ group, items }) => `${group.clause}, so ${conclusion(items)}${typeTag(group, multiType)}`).join('; ')}${leaving}`
  return { typeLabel, text, placements }
}

/** Whether the rectangle's four corners lie in exactly two boxes, two
 * corners of one row (or of one column) in each. That is what makes four
 * cells holding only {a, b} a deadly pattern: swapping a and b then leaves
 * every row, column *and box* with the same digits. On a standard grid it is
 * "the rows share a band xor the columns share a stack" (both puts all four
 * in one box, neither spreads them over four). On a Jigsaw it has to be
 * asked of the regions themselves - a rectangle over three or four regions,
 * or with a region holding two diagonal corners, is no deadly pattern.
 *
 * On an X-Sudoku the swap must leave the two diagonals alone as well, and a
 * rectangle has at most one corner on each, so any corner on a diagonal
 * changes what that diagonal holds: no deadly pattern either. Every
 * rectangle-shaped uniqueness technique (this finder, Avoidable Rectangle,
 * UR-AIC, the Complex AIC graph) enumerates through here, so this is the
 * one place that rule lives. */
export function spansTwoBoxes(r1: number, r2: number, c1: number, c2: number): boolean {
  const topLeft = boxOf(r1, c1)
  const topRight = boxOf(r1, c2)
  const bottomLeft = boxOf(r2, c1)
  const bottomRight = boxOf(r2, c2)
  if (
    !(topLeft === topRight && bottomLeft === bottomRight && topLeft !== bottomLeft) &&
    !(topLeft === bottomLeft && topRight === bottomRight && topLeft !== topRight)
  ) {
    return false
  }
  return !(hasDiagonals() && (onActiveDiagonal(r1, c1) || onActiveDiagonal(r1, c2) || onActiveDiagonal(r2, c1) || onActiveDiagonal(r2, c2)))
}

export class SudokuUniqueRectangleFinder {
  /** `mergeTypes: false` skips `mergeSameRectangle`, so every instance keeps
   * its own single type and only its own eliminations - for the How It Works
   * lessons, which teach one type at a time from positions where another
   * type often fires on the same rectangle too. Everything that applies
   * eliminations wants the default (see mergeSameRectangle for why). */
  find(board: Board, candidates: CandidateGrid, { mergeTypes = true }: { mergeTypes?: boolean } = {}): UniqueRectangleInstance[] {
    // A deadly pattern is only deadly when both of its fillings satisfy every
    // constraint - a Killer cage's sum tells them apart (see uniquenessHolds).
    if (!uniquenessHolds()) {
      return []
    }
    const instances: UniqueRectangleInstance[] = []

    for (let r1 = 0; r1 < BOARD_SIZE - 1; r1++) {
      for (let r2 = r1 + 1; r2 < BOARD_SIZE; r2++) {
        for (let c1 = 0; c1 < BOARD_SIZE - 1; c1++) {
          for (let c2 = c1 + 1; c2 < BOARD_SIZE; c2++) {
            if (!spansTwoBoxes(r1, r2, c1, c2)) {
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
              this.findType2Or5(board, candidates, cells, pair, pairInstances)
              this.findType3(board, candidates, cells, pair, pairInstances)
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

    const deduped = this.dedupe(instances)
    return (mergeTypes ? this.mergeSameRectangle(deduped) : deduped).sort((a, b) => priorityOf(a.type) - priorityOf(b.type))
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
      // in the same order the rest of the panel does. Cells/digits are
      // identical within a group by construction; each path's own clause
      // and conclusion is kept in `reasons`. (This used to recover each
      // clause by stripping reasonText up to ", where " - Type 7d's text
      // didn't have one, so its whole sentence got pasted in twice.)
      const sorted = [...group].sort((a, b) => priorityOf(a.type) - priorityOf(b.type))
      const [first] = sorted
      const reasons = sorted.flatMap((i) => i.reasons)
      merged.push({
        type: typeLabelOf(reasons),
        reasons,
        cells: first.cells,
        urDigits: first.urDigits,
        reasonCells: dedupeByKey(sorted.flatMap((i) => i.reasonCells), cellKey),
        ...(sorted.some((i) => i.subsetCells) && {
          subsetCells: dedupeByKey(sorted.flatMap((i) => i.subsetCells ?? []), cellKey),
        }),
        reasonText: reasonTextOf(first.urDigits, first.cells, reasons),
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

    const clause = `${cellRef(...extraCell)} alone holds more than just the pair`
    if (extras.length === 1) {
      out.push(
        makeInstance({
          type: 'Type 1',
          cells,
          urDigits: pair,
          reasonCells: [extraCell],
          clause,
          eliminatedCandidates: [],
          solvedCandidates: [{ row: extraCell[0], col: extraCell[1], digit: extras[0] }],
        }),
      )
    } else {
      out.push(
        makeInstance({
          type: 'Type 1',
          cells,
          urDigits: pair,
          reasonCells: [extraCell],
          clause,
          eliminatedCandidates: [
            { row: extraCell[0], col: extraCell[1], digit: a },
            { row: extraCell[0], col: extraCell[1], digit: b },
          ],
          solvedCandidates: [],
        }),
      )
    }
  }

  /** Types 2 and 5: every non-bivalue corner holds the pair plus the *same*
   * single extra candidate Z, and nothing else. If none of them were Z, each
   * would be one of the pair and all four corners would be the deadly
   * pattern - so at least one of them is Z, and Z can't go in any cell that
   * sees all of them. Type 2 is that with two corners sharing a row or
   * column (HoDoKu's "two non diagonal cells"); Type 5 is the same logic
   * with two diagonal corners or three corners, which just leaves fewer
   * cells seeing them all. Four extra corners is never reported - no cell
   * outside the rectangle can see all four. With one extra corner this is
   * Type 1 instead, so that case is left to findType1.
   */
  private findType2Or5(
    board: Board,
    candidates: CandidateGrid,
    cells: readonly [Cell, Cell, Cell, Cell],
    pair: readonly [number, number],
    out: UniqueRectangleInstance[],
  ): void {
    const [a, b] = pair
    const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))
    const extraIndices = cellDigits.flatMap((digits, i) => (digits.length > 2 ? [i] : []))
    if (extraIndices.length !== 2 && extraIndices.length !== 3) {
      return
    }
    const extrasPerCell = extraIndices.map((i) => cellDigits[i].filter((d) => d !== a && d !== b))
    const z = extrasPerCell[0][0]
    if (!extrasPerCell.every((extras) => extras.length === 1 && extras[0] === z)) {
      return
    }
    const extraCells = extraIndices.map((i) => cells[i])
    const isType2 = extraCells.length === 2 && sameUnit(extraCells[0], extraCells[1])
    const eliminations = cellsSeeingAll(board, candidates, cells, extraCells, z).map(([r, c]) => ({ row: r, col: c, digit: z }))
    if (eliminations.length === 0) {
      return
    }
    const type: UniqueRectangleTypeName = isType2 ? 'Type 2' : 'Type 5'
    out.push(
      makeInstance({
        type,
        cells,
        urDigits: pair,
        reasonCells: extraCells,
        // No "so" of its own: the panel appends ", so <conclusion>".
        clause: `one of ${cellsLabel(extraCells)} must be ${z}, their only extra candidate`,
        eliminatedCandidates: eliminations,
        solvedCandidates: [],
      }),
    )
  }

  /** Type 3: exactly two corners have extra candidates, and they share a row
   * or column (the other two hold only the pair). They can't both be one of
   * the pair (deadly pattern), so at least one of them is one of their extra
   * digits E - which lets the two be counted as one "virtual cell" holding
   * just E. If, in a house containing both, that virtual cell plus N other
   * cells hold only N+1 digits between them, it's a naked subset: those
   * N+1 digits are all placed within it, so they leave every other cell of
   * that house (and of any other house the whole subset also sits in - the
   * "locked" case, e.g. a row subset that's all in one box too).
   *
   * No cap on N beyond "leave at least one cell to eliminate from": a big
   * subset is still the same argument, and real positions do need one (the
   * reference example uses a 4-extra-digit virtual cell plus 4 other cells
   * of the row). Only the smallest subset per house that eliminates
   * something is reported, so the wording names as few cells as it can.
   * A single shared extra digit is Type 2 instead (N = 0), so E must have
   * at least two digits.
   */
  private findType3(
    board: Board,
    candidates: CandidateGrid,
    cells: readonly [Cell, Cell, Cell, Cell],
    pair: readonly [number, number],
    out: UniqueRectangleInstance[],
  ): void {
    const [a, b] = pair
    const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))
    const extraIndices = cellDigits.flatMap((digits, i) => (digits.length > 2 ? [i] : []))
    if (extraIndices.length !== 2) {
      return
    }
    const [x, y] = extraIndices.map((i) => cells[i]) as [Cell, Cell]
    if (!sameUnit(x, y)) {
      return
    }
    let extraMask = 0
    for (const i of extraIndices) {
      for (const d of cellDigits[i]) {
        if (d !== a && d !== b) {
          extraMask |= 1 << d
        }
      }
    }
    if (bitCount(extraMask) < 2) {
      return
    }

    const maskOf = ([r, c]: Cell) => markedCandidateDigits(candidates[r][c]).reduce((mask, d) => mask | (1 << d), 0)
    for (const unit of sharedUnitsOf(x, y)) {
      // The other two UR corners are never in a house with both x and y
      // (that would put all four in one row/column/box), so this is just
      // "every other unsolved cell of the house".
      const others = unit.filter(([r, c]) => board[r][c] === 0 && !(r === x[0] && c === x[1]) && !(r === y[0] && c === y[1]))
      const otherMasks = others.map(maskOf)
      found: for (let size = 1; size < others.length; size++) {
        for (let chosen = 1; chosen < 1 << others.length; chosen++) {
          if (bitCount(chosen) !== size) {
            continue
          }
          let digitMask = extraMask
          for (let i = 0; i < others.length; i++) {
            if (chosen & (1 << i)) {
              digitMask |= otherMasks[i]
            }
          }
          if (bitCount(digitMask) !== size + 1) {
            continue
          }
          const subsetCells = others.filter((_, i) => chosen & (1 << i))
          const allSubsetCells = [x, y, ...subsetCells]
          // Every house the whole subset sits in, not just this one.
          const houses = sudokuUnits().filter((house) =>
            allSubsetCells.every(([sr, sc]) => house.some(([r, c]) => r === sr && c === sc)),
          )
          const eliminations: CandidateElimination[] = []
          const seen = new Set<string>()
          for (const house of houses) {
            for (const [r, c] of house) {
              if (board[r][c] !== 0 || allSubsetCells.some(([sr, sc]) => sr === r && sc === c) || seen.has(`${r}.${c}`)) {
                continue
              }
              seen.add(`${r}.${c}`)
              for (let d = 1; d <= 9; d++) {
                if (digitMask & (1 << d) && candidates[r][c][d - 1]) {
                  eliminations.push({ row: r, col: c, digit: d })
                }
              }
            }
          }
          if (eliminations.length === 0) {
            continue
          }
          const digitsLabel = (mask: number) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => mask & (1 << d)).join(',')
          out.push(
            makeInstance({
              type: 'Type 3',
              cells,
              urDigits: pair,
              reasonCells: [x, y],
              subsetCells,
              clause: `the extras {${digitsLabel(extraMask)}} of ${cellsLabel([x, y])} form a naked subset {${digitsLabel(digitMask)}} with ${cellsLabel(subsetCells)} in ${houses.map(houseLabel).join(' and ')}`,
              eliminatedCandidates: eliminations,
              solvedCandidates: [],
            }),
          )
          break found
        }
      }
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
      out.push(
        makeInstance({
          type: 'Type 4',
          cells,
          urDigits: pair,
          reasonCells: [x, y],
          clause: `${digit} is locked to ${cellsLabel([x, y])}`,
          eliminatedCandidates: eliminations,
          solvedCandidates: [],
        }),
      )
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
          const link = { from: `${digit}${cellRef(...A)}`, to: [`${digit}${cellRef(...N)}`] }
          out.push(
            makeInstance({
              type: 'Type 7a',
              cells,
              urDigits: pair,
              reasonCells: [A, N],
              clause: `${link.from} is strongly linked to ${link.to[0]}`,
              link,
              eliminatedCandidates: [{ row: otherN[0], col: otherN[1], digit }],
              solvedCandidates: [],
            }),
          )
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
            out.push(
              makeInstance({
                type: 'Type 7b',
                cells,
                urDigits: pair,
                reasonCells: [A, B, cells[cIndex]],
                clause: `${X}${cellRef(...A)} strong links ${X}${cellRef(...B)} and ${Y}${cellRef(...B)} strong links ${Y}${cellRef(...cells[cIndex])}`,
                eliminatedCandidates: [{ row: D[0], col: D[1], digit: X }],
                solvedCandidates: [],
              }),
            )
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
        out.push(
          makeInstance({
            type: 'Type 7c',
            cells,
            urDigits: pair,
            reasonCells: [A, cells[aOwnPartnerIndex]],
            clause: `${cellRef(...A)}'s ${ownDigit} is strongly linked to ${cellRef(...cells[aOwnPartnerIndex])}`,
            eliminatedCandidates: [{ row: target[0], col: target[1], digit: ownDigit }],
            solvedCandidates: [],
          }),
        )
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
        // Named by the two links the check actually needs (one to each
        // neighbouring corner, through any house they share) - this used
        // to say "has 3 strong links", which was often false (a corner
        // linked via its box and column but not its row still qualifies).
        // "Hidden Rectangle" is a display name only (techniqueEngine.ts);
        // keeping it out of `type` keeps it out of merged labels, where
        // "Types 7a & 7d aka Hidden Rectangle" read as if both were.
        const link = { from: `${digit}${cellRef(...Z)}`, to: zNeighbourIndices.map((i) => `${digit}${cellRef(...cells[i])}`) }
        out.push(
          makeInstance({
            type: 'Type 7d',
            cells,
            urDigits: pair,
            reasonCells: [cells[aIndex], Z],
            clause: `${link.from} is strongly linked to both ${link.to[0]} and ${link.to[1]}`,
            link,
            eliminatedCandidates: [{ row: Z[0], col: Z[1], digit: eliminated }],
            solvedCandidates: [],
          }),
        )
      }
    }
  }
}
