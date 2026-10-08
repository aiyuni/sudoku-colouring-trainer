import { markedCandidateDigits } from './boardUtils'
import { isAntiKnight, knightCellsOf, seesCell, unitLabel } from './SudokuConstraints'
import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import { boxOf, isStandardLayout, sudokuUnits, sharesHouseOrLink } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export type AicLinkKind = 'strong' | 'weak'

export interface AicCandidate {
  row: number
  col: number
  digit: number
  /** A grouped node (Empty Rectangle, UR-AIC and ALS-AIC make these): every
   * cell of the group, 2 or more, all holding `digit` - "digit is in one of
   * these cells". Normally all in one row or column inside one box; an
   * ALS-AIC's ALS node is any of its ALS's cells, all in one house but
   * possibly in several boxes, or in a box but several lines. `row`/`col` are the
   * first of them, so code that only wants a representative cell still
   * works; anything that lists or draws the chain should use aicNodeCells. */
  cells?: ReadonlyArray<readonly [number, number]>
}

/** Every cell a chain node stands for: a grouped node's whole group, else
 * its one cell. */
export function aicNodeCells(node: AicCandidate): ReadonlyArray<readonly [number, number]> {
  return node.cells ?? [[node.row, node.col]]
}

/** "2r1c7", or "2(r8c3, r9c3)" for a grouped node. */
export function aicNodeText(node: AicCandidate): string {
  const ref = ([row, col]: readonly [number, number]) => `r${row + 1}c${col + 1}`
  return node.cells ? `${node.digit}(${node.cells.map(ref).join(', ')})` : `${node.digit}${ref([node.row, node.col])}`
}

/** An AIC chain written out: "2r1c7 = 2r1c3 - 2(r8c3, r9c3) = 2r9c1". */
export function aicChainText(nodes: readonly AicCandidate[]): string {
  return nodes.map((n, i) => `${i === 0 ? '' : i % 2 === 1 ? ' = ' : ' - '}${aicNodeText(n)}`).join('')
}

/** One chain link as the grid overlay draws it: a representative candidate
 * at each end, plus the whole group for a grouped end (the overlay draws the
 * link to the group's middle and outlines the group). */
export interface AicLinkRef {
  from: { row: number; col: number; digit: number }
  to: { row: number; col: number; digit: number }
  kind: AicLinkKind
  fromCells?: ReadonlyArray<readonly [number, number]>
  toCells?: ReadonlyArray<readonly [number, number]>
}

/** Every candidate a chain touches (a grouped node contributes all of its
 * cells) and its links, in the shape the grid overlay and the Dragon move
 * log carry them. */
export function aicChainView(aic: ShortAicInstance): {
  candidates: Array<{ row: number; col: number; digit: number }>
  links: AicLinkRef[]
} {
  return {
    candidates: aic.nodes.flatMap((n) => aicNodeCells(n).map(([row, col]) => ({ row, col, digit: n.digit }))),
    links: aic.links.map((link) => ({
      from: { row: link.from.row, col: link.from.col, digit: link.from.digit },
      to: { row: link.to.row, col: link.to.col, digit: link.to.digit },
      kind: link.kind,
      ...(link.from.cells ? { fromCells: link.from.cells } : {}),
      ...(link.to.cells ? { toCells: link.to.cells } : {}),
    })),
  }
}

/** UR-AIC only (see SudokuUrAicFinder): the Unique Rectangle a link rests on
 * - its four cells, in the UR finder's canonical order, and its two digits. */
export interface AicUrBasis {
  cells: ReadonlyArray<readonly [number, number]>
  digits: readonly [number, number]
}

/** ALS-AIC only (see SudokuAlsAicFinder): the Almost Locked Set a link rests
 * on - N unsolved cells of one house, row-major, and their N+1 digits. */
export interface AicAlsBasis {
  cells: ReadonlyArray<readonly [number, number]>
  digits: readonly number[]
}

export interface AicLink {
  from: AicCandidate
  to: AicCandidate
  kind: AicLinkKind
  /** UR-AIC only: present on a link that holds only because of a Unique
   * Rectangle, not because of one row/column/box or cell. */
  ur?: AicUrBasis
  /** ALS-AIC only: present on a (strong) link between two digits of one
   * Almost Locked Set. */
  als?: AicAlsBasis
}

/** Chain length 3 (4 nodes, strong-weak-strong) or chain length 5 (6 nodes,
 * strong-weak-strong-weak-strong) - "short" AIC is capped at 5, not an
 * unbounded search. */
export type ShortAicLength = 3 | 5

/** The longest chain SudokuShortAicFinder looks for (in links). Anything
 * longer is the Generic AIC finder's territory - see SudokuGenericAicFinder. */
export const SHORT_AIC_MAX_LENGTH = 5

export interface ShortAicInstance {
  /** The chain's candidates in order: X, the interior nodes, Y - 4 entries
   * for a length-3 chain, 6 for a length-5 chain. */
  nodes: AicCandidate[]
  /** The links joining consecutive nodes - always alternating strong, weak,
   * strong[, weak, strong], one fewer entry than `nodes`. */
  links: AicLink[]
  /** Number of links: 3 or 5 from SudokuShortAicFinder, longer (7, 9, ...)
   * from SudokuGenericAicFinder, which returns this same shape so the
   * panel and Dragon Colouring can treat both alike. */
  length: number
  /** Every node shares one digit - only possible at length 3 (a pure
   * X-chain built entirely from bilocal strong links and same-digit weak
   * links); a length-5 chain always crosses digits at least once, and even
   * some length-3 chains switch digits via a same-cell link. Drives the
   * "Short Single-Digit AIC" vs "Short AIC" split - see classifyShortAic. */
  isSingleDigit: boolean
  /** Type 1: nodes[0] and nodes[3] are the same digit - any other cell that
   * sees both of their cells can't be that digit either. Type 2: different
   * digits, whose cells see each other - each end's own cell can't hold the
   * other end's digit. */
  eliminationType: 1 | 2
  eliminations: CandidateElimination[]
  /** The named pattern the chain is, if any: a Short Single-Digit AIC
   * pattern (see classifySingleDigitPattern and findEmptyRectangles), or a
   * W-Wing, the one named Short AIC (see findWWings). The UI shows this name
   * instead of "Short Single-Digit AIC" / "Short AIC"; it is still that one
   * technique (same toggle, same auto-solve button, same Dynamic Dragon
   * tier). */
  pattern?: ShortAicPattern
  /** With `pattern`: the pattern's shape in words ("2 appears only twice in
   * column 3 (r3c3, r8c3) and ..."), for the Hint popup - the Techniques
   * row shows only the chain, like any other AIC (a W-Wing has its own
   * wording, see `wWing`). */
  patternText?: string
  /** W-Wings only: what the Techniques row's explanation is worded from. */
  wWing?: WWingDetails
  /** Y-Wings only: the pivot and wing cells, which the Techniques row's
   * explanation names after the chain. */
  yWing?: YWingDetails
}

/** A Y-Wing's cells (sudokuwiki.org/Y_Wing_Strategy): a pivot holding only
 * {X,Y}, and two wings it sees holding only {X,Z} and {Y,Z} - whichever digit
 * the pivot is, one wing is Z. */
export interface YWingDetails {
  pivot: readonly [number, number]
  wings: readonly [readonly [number, number], readonly [number, number]]
  /** Z, the digit eliminated from every cell seeing both wings. */
  eliminatedDigit: number
}

/** A W-Wing's parts: two cells holding only the same two digits, and a unit
 * where every candidate of one of them (`linkDigit`) sees one of the two
 * cells - so they can't both be `linkDigit`, and one is `eliminatedDigit`. */
export interface WWingDetails {
  cells: readonly [readonly [number, number], readonly [number, number]]
  /** The two cells' digits, ascending. */
  digits: readonly [number, number]
  linkDigit: number
  eliminatedDigit: number
  /** "column 3" */
  unitName: string
}

/** The named shapes a Short Single-Digit AIC can take, as Sudoku.Coach
 * defines them (its own solver code, not just its lesson pages, was the
 * reference - see classifySingleDigitPattern). Empty Rectangle is the only
 * one the plain chain search can't find: its chain runs through a grouped
 * node, see findEmptyRectangles. */
export type SingleDigitAicPattern = 'Skyscraper' | 'Two-String Kite' | 'Crane' | 'Empty Rectangle'

/** Every named pattern an AIC row can carry: the single-digit ones, plus
 * W-Wing and Y-Wing, (general) Short AICs. */
export type ShortAicPattern = SingleDigitAicPattern | 'W-Wing' | 'Y-Wing'

/** Which chain explains an elimination set best when several do (see
 * pickBestPerEliminationSet): Sudoku.Coach's own order (it tries Skyscraper,
 * then Two-String Kite, then Crane, then Empty Rectangle), and any named
 * pattern before a plain unnamed chain. */
const PATTERN_PREFERENCE: Record<SingleDigitAicPattern, number> = {
  Skyscraper: 0,
  'Two-String Kite': 1,
  Crane: 2,
  'Empty Rectangle': 3,
}
const UNNAMED_PREFERENCE = 4

/** "Short Single-Digit AIC" (length 3, one digit throughout - the classic
 * X-chain) is treated as its own, easier technique, ranked below the
 * general "Short AIC" and above Simple Colouring; everything else found by
 * this finder (length 5, or a rare length-3 chain that switches digits via
 * a same-cell link) stays "Short AIC". Empty Rectangles (grouped
 * single-digit chains of length 3) are single-digit too. */
export type ShortAicKind = 'single-digit' | 'general'

export function classifyShortAic(instance: ShortAicInstance): ShortAicKind {
  return instance.length === 3 && instance.isSingleDigit ? 'single-digit' : 'general'
}

export function candidateKey(row: number, col: number, digit: number): string {
  return `${row},${col},${digit}`
}

function sameUnit(a: readonly [number, number], b: readonly [number, number]): boolean {
  return sharesHouseOrLink(a[0], a[1], b[0], b[1])
}

export interface LinkGraphs {
  /** Conjugate-pair edges only: a digit candidate to exactly one other
   * candidate of the same digit in a shared unit, or a cell's own two
   * candidates when it has exactly two. */
  strongAdjacency: Map<string, string[]>
  /** Every same-digit-same-unit pair and every same-cell-different-digit
   * pair, regardless of how many candidates share that unit/cell - a
   * strong edge (above) is always also a weak one, but most weak edges
   * aren't strong. */
  weakAdjacency: Map<string, string[]>
  nodeByKey: Map<string, AicCandidate>
}

export function buildLinkGraphs(board: Board, candidates: CandidateGrid): LinkGraphs {
  const strongAdjacency = new Map<string, string[]>()
  const weakAdjacency = new Map<string, string[]>()
  const nodeByKey = new Map<string, AicCandidate>()

  const addEdge = (map: Map<string, string[]>, aKey: string, bKey: string) => {
    if (!map.has(aKey)) {
      map.set(aKey, [])
    }
    if (!map.has(bKey)) {
      map.set(bKey, [])
    }
    map.get(aKey)!.push(bKey)
    map.get(bKey)!.push(aKey)
  }

  const registerNode = (row: number, col: number, digit: number): string => {
    const key = candidateKey(row, col, digit)
    if (!nodeByKey.has(key)) {
      nodeByKey.set(key, { row, col, digit })
    }
    return key
  }

  // Same-digit-same-unit links: weak for every pair sharing the unit,
  // additionally strong when the unit has exactly two such cells.
  for (let digit = 1; digit <= 9; digit++) {
    for (const unit of sudokuUnits()) {
      const withCandidate = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1])
      for (let i = 0; i < withCandidate.length; i++) {
        for (let j = i + 1; j < withCandidate.length; j++) {
          const [r1, c1] = withCandidate[i]
          const [r2, c2] = withCandidate[j]
          const key1 = registerNode(r1, c1, digit)
          const key2 = registerNode(r2, c2, digit)
          addEdge(weakAdjacency, key1, key2)
          if (withCandidate.length === 2) {
            addEdge(strongAdjacency, key1, key2)
          }
        }
      }
    }
  }

  // Anti-Knight (Variant page): two cells a knight's move apart can't hold
  // the same digit either - a weak link with no unit behind it, so never a
  // strong one. Pairs already weakly linked through a unit can't be a
  // knight's move apart in the same row or column, but can share a box, so
  // those are skipped rather than listed twice.
  if (isAntiKnight()) {
    for (let digit = 1; digit <= 9; digit++) {
      for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
          if (board[row][col] !== 0 || !candidates[row][col][digit - 1]) {
            continue
          }
          for (const [r2, c2] of knightCellsOf(row, col)) {
            // Each pair once (from its upper cell), and only if no unit
            // links it already.
            if (r2 < row || board[r2][c2] !== 0 || !candidates[r2][c2][digit - 1] || seesCell(row, col, r2, c2)) {
              continue
            }
            addEdge(weakAdjacency, registerNode(row, col, digit), registerNode(r2, c2, digit))
          }
        }
      }
    }
  }

  // Same-cell-different-digit links: weak for every pair of candidates the
  // cell holds, additionally strong when the cell has exactly two.
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] !== 0) {
        continue
      }
      const digits = markedCandidateDigits(candidates[row][col])
      for (let i = 0; i < digits.length; i++) {
        for (let j = i + 1; j < digits.length; j++) {
          const key1 = registerNode(row, col, digits[i])
          const key2 = registerNode(row, col, digits[j])
          addEdge(weakAdjacency, key1, key2)
          if (digits.length === 2) {
            addEdge(strongAdjacency, key1, key2)
          }
        }
      }
    }
  }

  return { strongAdjacency, weakAdjacency, nodeByKey }
}

/** What a chain ending in candidates x and y (in that order) can eliminate -
 * null if x/y don't yield anything (or are degenerate, e.g. the same cell). */
export function computeEliminations(
  board: Board,
  candidates: CandidateGrid,
  x: AicCandidate,
  y: AicCandidate,
): { type: 1 | 2; eliminations: CandidateElimination[] } | null {
  if (x.row === y.row && x.col === y.col) {
    // The two ends share a cell - already a direct link on its own, not a
    // chain conclusion worth surfacing.
    return null
  }

  if (x.digit === y.digit) {
    const eliminations: CandidateElimination[] = []
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if ((row === x.row && col === x.col) || (row === y.row && col === y.col)) {
          continue
        }
        if (board[row][col] !== 0 || !candidates[row][col][x.digit - 1]) {
          continue
        }
        if (sameUnit([row, col], [x.row, x.col]) && sameUnit([row, col], [y.row, y.col])) {
          eliminations.push({ row, col, digit: x.digit })
        }
      }
    }
    if (eliminations.length === 0) {
      return null
    }
    return { type: 1, eliminations }
  }

  if (!sameUnit([x.row, x.col], [y.row, y.col])) {
    return null
  }

  const eliminations: CandidateElimination[] = []
  if (candidates[x.row][x.col][y.digit - 1]) {
    eliminations.push({ row: x.row, col: x.col, digit: y.digit })
  }
  if (candidates[y.row][y.col][x.digit - 1]) {
    eliminations.push({ row: y.row, col: y.col, digit: x.digit })
  }
  if (eliminations.length === 0) {
    return null
  }
  return { type: 2, eliminations }
}

/** Forward and reverse traversal of the same underlying chain describe the
 * identical 3 links - canonicalize to whichever direction sorts first so
 * the two are recognized as one finding, not two. */
function chainDedupeKey(nodes: readonly AicCandidate[]): string {
  const forward = nodes.map((n) => candidateKey(n.row, n.col, n.digit)).join('-')
  const backward = [...nodes].reverse().map((n) => candidateKey(n.row, n.col, n.digit)).join('-')
  return forward < backward ? forward : backward
}

/** A strong link is "bilocal" when its two candidates share a digit (a
 * conjugate pair - the digit can go in exactly two cells of some row,
 * column, or box); the other kind of strong link ("bivalue") instead
 * shares a cell, with two candidate digits. Only strong links can be
 * bilocal - a same-digit weak link never has the "exactly two cells"
 * property (see buildLinkGraphs). */
function isBilocalStrongLink(link: AicLink): boolean {
  return link.kind === 'strong' && link.from.digit === link.to.digit
}

function bilocalStrongLinkCount(links: readonly AicLink[]): number {
  return links.filter(isBilocalStrongLink).length
}

/** Order-independent identity for a set of eliminations - two chains that
 * eliminate the exact same candidate(s) are competing explanations for the
 * same conclusion, not two distinct findings. */
function eliminationSetKey(eliminations: readonly CandidateElimination[]): string {
  return eliminations
    .map((e) => `${e.row}.${e.col}.${e.digit}`)
    .sort()
    .join('|')
}

function patternPreference(instance: ShortAicInstance): number {
  return instance.pattern && instance.pattern in PATTERN_PREFERENCE
    ? PATTERN_PREFERENCE[instance.pattern as SingleDigitAicPattern]
    : UNNAMED_PREFERENCE
}

/** When several chains reach the exact same elimination(s), keep only the
 * most "elegant" explanation: the shortest chain, and among equally short
 * ones, whichever leans on more bilocal (conjugate-pair) strong links
 * rather than bivalue (same-cell) ones. Between two single-digit chains
 * still tied after that, a named pattern wins (see PATTERN_PREFERENCE) - so
 * a Skyscraper is never listed as a plain chain just because an unnamed
 * chain to the same eliminations happened to be found first. That last rule
 * only compares single-digit chains with each other, so it never changes
 * whether an elimination set counts as single-digit or general.
 *
 * Likewise a W-Wing beats any other general Short AIC to the same
 * eliminations, whatever their lengths (by request: a W-Wing is always shown
 * as one) - but never a single-digit chain, which is a different, easier
 * technique and is always shorter. A Y-Wing then beats any other general
 * chain except a W-Wing, the same way (by request: shown as one whenever the
 * elimination is one). */
export function pickBestPerEliminationSet(instances: readonly ShortAicInstance[]): ShortAicInstance[] {
  const bestBySet = new Map<string, ShortAicInstance>()
  for (const instance of instances) {
    const key = eliminationSetKey(instance.eliminations)
    const current = bestBySet.get(key)
    if (!current) {
      bestBySet.set(key, instance)
      continue
    }
    const instanceIsWWing = instance.pattern === 'W-Wing'
    if (
      instanceIsWWing !== (current.pattern === 'W-Wing') &&
      classifyShortAic(instance) === 'general' &&
      classifyShortAic(current) === 'general'
    ) {
      if (instanceIsWWing) {
        bestBySet.set(key, instance)
      }
      continue
    }
    const instanceIsYWing = instance.pattern === 'Y-Wing'
    if (
      instanceIsYWing !== (current.pattern === 'Y-Wing') &&
      current.pattern !== 'W-Wing' &&
      classifyShortAic(instance) === 'general' &&
      classifyShortAic(current) === 'general'
    ) {
      if (instanceIsYWing) {
        bestBySet.set(key, instance)
      }
      continue
    }
    if (instance.links.length < current.links.length) {
      bestBySet.set(key, instance)
    } else if (instance.links.length === current.links.length) {
      const instanceBilocal = bilocalStrongLinkCount(instance.links)
      const currentBilocal = bilocalStrongLinkCount(current.links)
      if (instanceBilocal > currentBilocal) {
        bestBySet.set(key, instance)
      } else if (
        instanceBilocal === currentBilocal &&
        classifyShortAic(instance) === 'single-digit' &&
        classifyShortAic(current) === 'single-digit' &&
        patternPreference(instance) < patternPreference(current)
      ) {
        bestBySet.set(key, instance)
      }
    }
  }
  return Array.from(bestBySet.values())
}

// ---- Named single-digit patterns ------------------------------------------
//
// Each rule below is Sudoku.Coach's own - read from the solver code behind
// its learn pages (sudoku.coach/en/learn/skyscraper, /two-string-kite,
// /crane), not paraphrased from the prose - applied to a chain this finder
// already found: A = B - C = D, all one digit. Naming never changes a
// chain's eliminations, which stay "every other cell seeing both A and D".

function cellText(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

type LineKind = 'row' | 'column'

/** How many unsolved cells of a unit still hold `digit`, per unit kind -
 * built once per search, only when a single-digit chain needs naming. */
interface DigitUnitCounts {
  row: number[][]
  column: number[][]
  box: number[][]
}

function buildDigitUnitCounts(board: Board, candidates: CandidateGrid): DigitUnitCounts {
  const make = () => Array.from({ length: 10 }, () => new Array<number>(BOARD_SIZE).fill(0))
  const counts: DigitUnitCounts = { row: make(), column: make(), box: make() }
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] !== 0) {
        continue
      }
      for (let digit = 1; digit <= 9; digit++) {
        if (candidates[row][col][digit - 1]) {
          counts.row[digit][row]++
          counts.column[digit][col]++
          counts.box[digit][boxOf(row, col)]++
        }
      }
    }
  }
  return counts
}

/** a and b share a unit of this kind in which `digit` has exactly these two
 * cells - a conjugate pair in that particular unit (the same cells can be a
 * pair in their row but not their box, or both). */
function isPairIn(counts: DigitUnitCounts, kind: 'row' | 'column' | 'box', a: AicCandidate, b: AicCandidate): boolean {
  const digit = a.digit
  if (kind === 'row') return a.row === b.row && counts.row[digit][a.row] === 2
  if (kind === 'column') return a.col === b.col && counts.column[digit][a.col] === 2
  return boxOf(a.row, a.col) === boxOf(b.row, b.col) && counts.box[digit][boxOf(a.row, a.col)] === 2
}

function inSameBox(a: AicCandidate, b: AicCandidate): boolean {
  return boxOf(a.row, a.col) === boxOf(b.row, b.col)
}

function sameLine(kind: LineKind, a: AicCandidate, b: AicCandidate): boolean {
  return kind === 'row' ? a.row === b.row : a.col === b.col
}

function lineName(kind: LineKind, cell: AicCandidate): string {
  return kind === 'row' ? `row ${cell.row + 1}` : `column ${cell.col + 1}`
}

function otherLine(kind: LineKind): LineKind {
  return kind === 'row' ? 'column' : 'row'
}

function pairText(kind: 'row' | 'column' | 'box', a: AicCandidate, b: AicCandidate): string {
  const unit = kind === 'box' ? `box ${boxOf(a.row, a.col) + 1}` : lineName(kind, a)
  return `only twice in ${unit} (${cellText(a.row, a.col)}, ${cellText(b.row, b.col)})`
}

/**
 * The named pattern a plain (ungrouped) length-3 single-digit chain
 * A = B - C = D is, or null. Tried in Sudoku.Coach's order, first match wins:
 *
 * - Skyscraper: A=B and C=D are conjugate pairs in two parallel lines (both
 *   rows or both columns), neither pair inside one box, and the "base" ends
 *   B and C share the crossing line. (Tops A and D in one line too is really
 *   an X-Wing - Sudoku.Coach's own Skyscraper code accepts it, and X-Wing,
 *   the easier technique, is listed first when enabled.)
 * - Two-String Kite: one pair in a row and the other in a column, neither
 *   inside one box, whose ends B and C are two cells of the same box.
 * - Crane: one pair in a row or column (A=B, in line S), the other a box
 *   holding the digit exactly twice (C=D), joined along the line through B
 *   crossing S, which has only C inside that box (so D is off it). Either
 *   end of the chain may be the line end.
 */
function classifySingleDigitPattern(
  counts: DigitUnitCounts,
  nodes: readonly AicCandidate[],
): { pattern: SingleDigitAicPattern; text: string } | null {
  const [a, b, c, d] = nodes
  const digit = a.digit
  for (const kind of ['column', 'row'] as const) {
    const cross = otherLine(kind)
    if (
      isPairIn(counts, kind, a, b) &&
      isPairIn(counts, kind, c, d) &&
      sameLine(cross, b, c) &&
      !inSameBox(a, b) &&
      !inSameBox(c, d)
    ) {
      return {
        pattern: 'Skyscraper',
        text: `${digit} appears ${pairText(kind, a, b)} and ${pairText(kind, c, d)}, and ${cellText(b.row, b.col)} and ${cellText(c.row, c.col)} share ${lineName(cross, b)}`,
      }
    }
  }
  for (const [first, second] of [
    ['row', 'column'],
    ['column', 'row'],
  ] as const) {
    if (isPairIn(counts, first, a, b) && isPairIn(counts, second, c, d) && inSameBox(b, c) && !inSameBox(a, b) && !inSameBox(c, d)) {
      return {
        pattern: 'Two-String Kite',
        text: `${digit} appears ${pairText(first, a, b)} and ${pairText(second, c, d)}, and ${cellText(b.row, b.col)} and ${cellText(c.row, c.col)} share box ${boxOf(b.row, b.col) + 1}`,
      }
    }
  }
  for (const [p, x, y, q] of [
    [a, b, c, d],
    [d, c, b, a],
  ]) {
    for (const kind of ['row', 'column'] as const) {
      const cross = otherLine(kind)
      if (isPairIn(counts, kind, p, x) && isPairIn(counts, 'box', y, q) && sameLine(cross, x, y) && !sameLine(cross, x, q)) {
        return {
          pattern: 'Crane',
          text: `${digit} appears ${pairText(kind, p, x)} and ${pairText('box', y, q)}, and ${cellText(x.row, x.col)} and ${cellText(y.row, y.col)} share ${lineName(cross, x)}`,
        }
      }
    }
  }
  return null
}

/** classifySingleDigitPattern for one chain, from scratch - for research
 * harnesses checking the naming against other solvers. */
export function nameSingleDigitChain(board: Board, candidates: CandidateGrid, nodes: readonly AicCandidate[]): SingleDigitAicPattern | null {
  return classifySingleDigitPattern(buildDigitUnitCounts(board, candidates), nodes)?.pattern ?? null
}

// ---- Empty Rectangle --------------------------------------------------------

/**
 * An Empty Rectangle Intersection (sudokuwiki.org/Empty_Rectangles): a box
 * whose candidates for `digit` all lie in one row and one column of it (the
 * rest of the box - the "empty rectangle" - has none), with at least one on
 * the row away from the crossing and one on the column away from it, so the
 * box genuinely needs both lines. `row`/`col` are the crossing (the ERI
 * cell itself may or may not hold the digit). Then "digit is in the box's
 * part of that row, or else in its part of that column" - a strong link
 * between two groups of cells, which is what an Empty Rectangle chains
 * through.
 */
export interface EmptyRectangleIntersection {
  digit: number
  box: number
  row: number
  col: number
  /** Every cell of the box holding the digit. */
  boxCells: Array<readonly [number, number]>
  /** The box's cells in `row`, including the crossing cell if it holds the
   * digit. */
  rowCells: Array<readonly [number, number]>
  /** The box's cells in `col`, including the crossing cell if it holds the
   * digit. */
  colCells: Array<readonly [number, number]>
}

/**
 * Every Empty Rectangle Intersection on the grid, for every digit and box: a
 * box with 2+ candidates can have more than one (two candidates on a
 * diagonal have two crossings), and a box with 2 candidates is also an
 * ordinary conjugate pair. Kept as its own query because it is a useful
 * building block by itself - findEmptyRectangles is just "an ERI plus a
 * conjugate pair in a line crossing one of its arms".
 */
export function findEmptyRectangleIntersections(board: Board, candidates: CandidateGrid): EmptyRectangleIntersection[] {
  const out: EmptyRectangleIntersection[] = []
  // An Empty Rectangle is described on a 3x3 box (its top-left corner, its
  // three rows and columns, "not in the same band as the box"). The logic
  // would carry over to a Jigsaw region, but that is a variant-specific
  // technique not written yet - none are found on a Jigsaw.
  if (!isStandardLayout()) {
    return out
  }
  for (let digit = 1; digit <= 9; digit++) {
    for (let box = 0; box < BOARD_SIZE; box++) {
      const top = Math.floor(box / BOX_SIZE) * BOX_SIZE
      const left = (box % BOX_SIZE) * BOX_SIZE
      const boxCells: Array<readonly [number, number]> = []
      for (let row = top; row < top + BOX_SIZE; row++) {
        for (let col = left; col < left + BOX_SIZE; col++) {
          if (board[row][col] === 0 && candidates[row][col][digit - 1]) {
            boxCells.push([row, col])
          }
        }
      }
      if (boxCells.length < 2) {
        continue
      }
      for (let row = top; row < top + BOX_SIZE; row++) {
        for (let col = left; col < left + BOX_SIZE; col++) {
          if (!boxCells.every(([r, c]) => r === row || c === col)) {
            continue
          }
          const rowArm = boxCells.some(([r, c]) => r === row && c !== col)
          const colArm = boxCells.some(([r, c]) => c === col && r !== row)
          if (!rowArm || !colArm) {
            continue
          }
          out.push({
            digit,
            box,
            row,
            col,
            boxCells,
            rowCells: boxCells.filter(([r]) => r === row),
            colCells: boxCells.filter(([, c]) => c === col),
          })
        }
      }
    }
  }
  return out
}

function groupNode(digit: number, cells: ReadonlyArray<readonly [number, number]>): AicCandidate {
  const [row, col] = cells[0]
  return cells.length > 1 ? { row, col, digit, cells } : { row, col, digit }
}

/**
 * Empty Rectangle, as a grouped single-digit AIC. For an ERI in box K at
 * (r, c) and a conjugate pair P = Q in a column, with P on row r outside K:
 *
 *   Q = P - (K's cells in row r) = (K's cells in column c, off row r)
 *
 * If Q isn't the digit, P is; then K's row-r cells aren't, so it must be in
 * K's column-c cells. So Q or that column group is the digit, and any cell
 * seeing Q and the whole group can't be - chiefly (Q's row, c), the
 * classic Empty Rectangle elimination. The same with rows and columns
 * swapped. Only boxes with 3+ candidates are used: with exactly 2, the
 * box's groups are single cells and the same chain is an ordinary Crane or
 * Two-String Kite, which the plain chain search already finds and names.
 *
 * The conjugate pair must be in a row or column (Sudokuwiki's definition),
 * and its far end Q must not share K's rows (for a column pair) - otherwise
 * the target cell would sit inside K itself, where the reasoning fails (K
 * could hold the digit right there).
 *
 * sudokuwiki.org has since replaced Empty Rectangles with Rectangle
 * Elimination; findRectangleEliminations is that method, and the two always
 * find the same eliminations - see its comment.
 */
export function findEmptyRectangles(
  board: Board,
  candidates: CandidateGrid,
  eris: readonly EmptyRectangleIntersection[] = findEmptyRectangleIntersections(board, candidates),
  minBoxCandidates = 3,
): ShortAicInstance[] {
  const out: ShortAicInstance[] = []
  const has = (row: number, col: number, digit: number) => board[row][col] === 0 && candidates[row][col][digit - 1]
  for (const eri of eris) {
    if (eri.boxCells.length < minBoxCandidates) {
      continue
    }
    const { digit, box } = eri
    const inBox = (row: number, col: number) => boxOf(row, col) === box
    // `arm` is the ERI line P sits on; the chain enters the box through that
    // line's group and leaves through the other line's group.
    for (const arm of ['row', 'column'] as const) {
      const entryCells = arm === 'row' ? eri.rowCells : eri.colCells
      const exitCells =
        arm === 'row' ? eri.colCells.filter(([r]) => r !== eri.row) : eri.rowCells.filter(([, c]) => c !== eri.col)
      for (let i = 0; i < BOARD_SIZE; i++) {
        const [pRow, pCol] = arm === 'row' ? [eri.row, i] : [i, eri.col]
        if (inBox(pRow, pCol) || !has(pRow, pCol, digit)) {
          continue
        }
        // P's partner Q along the line crossing the arm.
        let q: readonly [number, number] | null = null
        let count = 0
        for (let j = 0; j < BOARD_SIZE; j++) {
          const [r, c] = arm === 'row' ? [j, pCol] : [pRow, j]
          if (has(r, c, digit)) {
            count++
            if (r !== pRow || c !== pCol) {
              q = [r, c]
            }
          }
        }
        if (count !== 2 || !q) {
          continue
        }
        const [qRow, qCol] = q
        // The target (Q's row, c) / (r, Q's column) must lie outside K.
        if (arm === 'row' ? Math.floor(qRow / BOX_SIZE) === Math.floor(eri.row / BOX_SIZE) : Math.floor(qCol / BOX_SIZE) === Math.floor(eri.col / BOX_SIZE)) {
          continue
        }
        const nodes: AicCandidate[] = [
          { row: qRow, col: qCol, digit },
          { row: pRow, col: pCol, digit },
          groupNode(digit, entryCells),
          groupNode(digit, exitCells),
        ]
        const chainCells = new Set(nodes.flatMap((n) => aicNodeCells(n).map(([r, c]) => r * BOARD_SIZE + c)))
        const eliminations: CandidateElimination[] = []
        for (let row = 0; row < BOARD_SIZE; row++) {
          for (let col = 0; col < BOARD_SIZE; col++) {
            if (
              has(row, col, digit) &&
              !chainCells.has(row * BOARD_SIZE + col) &&
              sameUnit([row, col], q) &&
              exitCells.every((cell) => sameUnit([row, col], cell))
            ) {
              eliminations.push({ row, col, digit })
            }
          }
        }
        if (eliminations.length === 0) {
          continue
        }
        const linkLine = arm === 'row' ? `column ${pCol + 1}` : `row ${pRow + 1}`
        out.push({
          nodes,
          links: [
            { from: nodes[0], to: nodes[1], kind: 'strong' },
            { from: nodes[1], to: nodes[2], kind: 'weak' },
            { from: nodes[2], to: nodes[3], kind: 'strong' },
          ],
          length: 3,
          isSingleDigit: true,
          eliminationType: 1,
          eliminations,
          pattern: 'Empty Rectangle',
          patternText:
            `${digit} in box ${box + 1} lies only in row ${eri.row + 1} and column ${eri.col + 1} (an empty rectangle), ` +
            `and appears only twice in ${linkLine} (${cellText(pRow, pCol)}, ${cellText(qRow, qCol)})`,
        })
      }
    }
  }
  return out
}

// ---- Y-Wing -----------------------------------------------------------------

/**
 * The Y-Wing a plain length-5 chain is, or null: Z(w1) = X(w1) - X(p) = Y(p)
 * - Y(w2) = Z(w2), every strong link inside a cell holding only those two
 * digits, X, Y and Z all different, three different cells (the weak links
 * already make the pivot p see both wings). Naming never changes the chain's
 * eliminations: Z from every cell seeing both wings.
 */
function classifyYWing(candidates: CandidateGrid, nodes: readonly AicCandidate[]): { details: YWingDetails; text: string } | null {
  if (nodes.length !== 6 || nodes.some((n) => n.cells)) {
    return null
  }
  const [a, b, c, d, e, f] = nodes
  const sameCell = (p: AicCandidate, q: AicCandidate) => p.row === q.row && p.col === q.col
  const bivalue = (n: AicCandidate) => markedCandidateDigits(candidates[n.row][n.col]).length === 2
  if (!sameCell(a, b) || !sameCell(c, d) || !sameCell(e, f) || ![a, c, e].every(bivalue)) {
    return null
  }
  if (sameCell(a, c) || sameCell(c, e) || sameCell(a, e)) {
    return null
  }
  const [z, x, y] = [a.digit, b.digit, d.digit]
  if (b.digit !== c.digit || d.digit !== e.digit || f.digit !== z || z === x || x === y || y === z) {
    return null
  }
  const pair = (p: number, q: number) => `{${Math.min(p, q)},${Math.max(p, q)}}`
  return {
    details: {
      pivot: [c.row, c.col],
      wings: [
        [a.row, a.col],
        [e.row, e.col],
      ],
      eliminatedDigit: z,
    },
    text:
      `${cellText(c.row, c.col)} holds only ${pair(x, y)}, and it sees ` +
      `${cellText(a.row, a.col)} holding only ${pair(x, z)} and ${cellText(e.row, e.col)} holding only ${pair(y, z)}`,
  }
}

// ---- W-Wing -----------------------------------------------------------------

/** "row 4", "column 3", "box 7" for an index into sudokuUnits(). */
function unitName(index: number): string {
  // sudokuUnits() order: the 9 rows, then the 9 columns, then the 9 boxes.
  // (An X-Sudoku's two diagonals come after them, Variant page only.)
  if (index >= 3 * BOARD_SIZE) {
    return unitLabel(index)
  }
  const kind = index < BOARD_SIZE ? 'row' : index < 2 * BOARD_SIZE ? 'column' : 'box'
  return `${kind} ${(index % BOARD_SIZE) + 1}`
}

/**
 * W-Wing, as Sudoku.Coach's solver defines it (read from its code behind
 * sudoku.coach/en/learn/w-wing): two cells A and B that don't see each other
 * (seeing each other they'd be a naked pair) holding only the same two digits
 * {L, E}, and a unit, containing neither, in which every candidate for L sees
 * A or B. A and B can't both be L - that unit would have nowhere left for L -
 * so one of them is E, and E goes from every cell seeing both.
 *
 * Usually the unit is a conjugate pair (one L seeing A, one seeing B), but it
 * needn't be: it may hold more L candidates, as long as each sees A or B. As
 * a chain it is a Short AIC of length 5, through two (possibly grouped)
 * nodes for the unit's L candidates:
 *
 *   E(A) = L(A) - L(unit cells seeing A) = L(the unit's other cells) - L(B) = E(B)
 *
 * The plain chain search finds the conjugate-pair W-Wings too (under no
 * name); pickBestPerEliminationSet then keeps this, named, version. A unit
 * where no L candidate sees one of the wings is skipped (Sudoku.Coach accepts
 * it): that proves more - the other wing is E outright - and has no chain of
 * this shape. Each wing pair and link digit is reported once, through its unit
 * with the fewest L candidates (a plain conjugate pair if there is one).
 */
export function findWWings(board: Board, candidates: CandidateGrid): ShortAicInstance[] {
  type Cell = readonly [number, number]
  const out: ShortAicInstance[] = []
  const has = (row: number, col: number, digit: number) => board[row][col] === 0 && candidates[row][col][digit - 1]
  const units = sudokuUnits()
  const bivalue: Array<{ cell: Cell; digits: number[] }> = []
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] === 0) {
        const digits = markedCandidateDigits(candidates[row][col])
        if (digits.length === 2) {
          bivalue.push({ cell: [row, col], digits })
        }
      }
    }
  }
  for (let i = 0; i < bivalue.length; i++) {
    for (let j = i + 1; j < bivalue.length; j++) {
      const a = bivalue[i]
      const b = bivalue[j]
      if (a.digits[0] !== b.digits[0] || a.digits[1] !== b.digits[1] || sameUnit(a.cell, b.cell)) {
        continue
      }
      for (const [linkDigit, eliminatedDigit] of [
        [a.digits[0], a.digits[1]],
        [a.digits[1], a.digits[0]],
      ]) {
        const eliminations: CandidateElimination[] = []
        for (let row = 0; row < BOARD_SIZE; row++) {
          for (let col = 0; col < BOARD_SIZE; col++) {
            if (has(row, col, eliminatedDigit) && sameUnit([row, col], a.cell) && sameUnit([row, col], b.cell)) {
              eliminations.push({ row, col, digit: eliminatedDigit })
            }
          }
        }
        if (eliminations.length === 0) {
          continue
        }
        let bestUnit = -1
        let seesA: Cell[] = []
        let seesB: Cell[] = []
        for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
          const unit = units[unitIndex]
          // A unit with L already placed has no L to place; one holding a
          // wing has an L candidate (the wing) that sees neither wing.
          if (unit.some(([r, c]) => board[r][c] === linkDigit)) {
            continue
          }
          const withL = unit.filter(([r, c]) => has(r, c, linkDigit))
          if (withL.some(([r, c]) => (r === a.cell[0] && c === a.cell[1]) || (r === b.cell[0] && c === b.cell[1]))) {
            continue
          }
          if (!withL.every((cell) => sameUnit(cell, a.cell) || sameUnit(cell, b.cell))) {
            continue
          }
          // Split into the chain's two groups. A cell seeing both wings can
          // go in either; it joins B's group unless that would leave A's
          // empty (B's then takes only the cells that don't see A).
          let unitSeesA = withL.filter((cell) => sameUnit(cell, a.cell) && !sameUnit(cell, b.cell))
          let unitSeesB = withL.filter((cell) => sameUnit(cell, b.cell))
          if (unitSeesA.length === 0) {
            unitSeesA = withL.filter((cell) => sameUnit(cell, a.cell))
            unitSeesB = withL.filter((cell) => !sameUnit(cell, a.cell))
          }
          if (unitSeesA.length === 0 || unitSeesB.length === 0) {
            continue
          }
          if (bestUnit < 0 || withL.length < seesA.length + seesB.length) {
            bestUnit = unitIndex
            seesA = unitSeesA
            seesB = unitSeesB
          }
        }
        if (bestUnit < 0) {
          continue
        }
        const nodes: AicCandidate[] = [
          { row: a.cell[0], col: a.cell[1], digit: eliminatedDigit },
          { row: a.cell[0], col: a.cell[1], digit: linkDigit },
          groupNode(linkDigit, seesA),
          groupNode(linkDigit, seesB),
          { row: b.cell[0], col: b.cell[1], digit: linkDigit },
          { row: b.cell[0], col: b.cell[1], digit: eliminatedDigit },
        ]
        out.push({
          nodes,
          links: nodes.slice(1).map((to, k) => ({ from: nodes[k], to, kind: k % 2 === 0 ? 'strong' : 'weak' })),
          length: 5,
          isSingleDigit: false,
          eliminationType: 1,
          eliminations,
          pattern: 'W-Wing',
          patternText:
            `${cellText(a.cell[0], a.cell[1])} and ${cellText(b.cell[0], b.cell[1])} both hold only {${a.digits.join(',')}}, ` +
            `and every ${linkDigit} in ${unitName(bestUnit)} sees one of them`,
          wWing: {
            cells: [a.cell, b.cell],
            digits: [a.digits[0], a.digits[1]],
            linkDigit,
            eliminatedDigit,
            unitName: unitName(bestUnit),
          },
        })
      }
    }
  }
  return out
}

/**
 * Rectangle Elimination (sudokuwiki.org/Rectangle_Elimination), the method
 * sudokuwiki now uses in place of Empty Rectangles. Not used by the app -
 * it exists to cross-check findEmptyRectangles, which the Techniques panel
 * uses because each of its results is one chain the grid can draw.
 *
 * A hinge H holds the digit in a row (or column) only together with the
 * wing W1. Any other cell W2 holding it in H's column (row), in a different
 * box, can't be the digit if the box at W2's row and W1's column (the
 * "fourth corner") has all its candidates in those two lines: W2 true
 * clears H, which forces W1, and W1 and W2 together clear that box. When
 * W2 is also H's only partner in its line, the same rule with the wings
 * swapped eliminates W1 as well ("two strong links").
 *
 * Why it always agrees with Empty Rectangle: rename W1 = P, H = Q, W2 = E -
 * the fourth-corner box condition is exactly "(W1's line, W2's line) is an
 * ERI of that box", and E = (Q's line, the ERI's other line) is exactly the
 * Empty Rectangle target. The two only differ in what they enumerate first
 * (the box's crossing vs. the hinge's pair). Both require the box's
 * candidates to use both lines (`minBoxCandidates`/arm rules as in
 * findEmptyRectangleIntersections), so the degenerate one-line boxes a
 * locked candidate would already have handled are left out of both.
 */
export function findRectangleEliminations(
  board: Board,
  candidates: CandidateGrid,
  minBoxCandidates = 3,
): Array<{ hinge: readonly [number, number]; wing1: readonly [number, number]; box: number; elimination: CandidateElimination }> {
  const out: Array<{ hinge: readonly [number, number]; wing1: readonly [number, number]; box: number; elimination: CandidateElimination }> = []
  const has = (row: number, col: number, digit: number) => board[row][col] === 0 && candidates[row][col][digit - 1]
  for (let digit = 1; digit <= 9; digit++) {
    for (let hRow = 0; hRow < BOARD_SIZE; hRow++) {
      for (let hCol = 0; hCol < BOARD_SIZE; hCol++) {
        if (!has(hRow, hCol, digit)) {
          continue
        }
        // `pairLine`: the line H and W1 are a conjugate pair in.
        for (const pairLine of ['row', 'column'] as const) {
          const partners: Array<readonly [number, number]> = []
          for (let i = 0; i < BOARD_SIZE; i++) {
            const [r, c] = pairLine === 'row' ? [hRow, i] : [i, hCol]
            if ((r !== hRow || c !== hCol) && has(r, c, digit)) {
              partners.push([r, c])
            }
          }
          if (partners.length !== 1) {
            continue
          }
          const [w1Row, w1Col] = partners[0]
          if (boxOf(w1Row, w1Col) === boxOf(hRow, hCol)) {
            continue
          }
          for (let i = 0; i < BOARD_SIZE; i++) {
            const [w2Row, w2Col] = pairLine === 'row' ? [i, hCol] : [hRow, i]
            if ((w2Row === hRow && w2Col === hCol) || !has(w2Row, w2Col, digit) || boxOf(w2Row, w2Col) === boxOf(hRow, hCol)) {
              continue
            }
            // The fourth corner: W2's line parallel to the pair, crossed with
            // W1's line parallel to H-W2.
            const [cornerRow, cornerCol] = pairLine === 'row' ? [w2Row, w1Col] : [w1Row, w2Col]
            const box = boxOf(cornerRow, cornerCol)
            const top = Math.floor(box / BOX_SIZE) * BOX_SIZE
            const left = (box % BOX_SIZE) * BOX_SIZE
            const cells: Array<readonly [number, number]> = []
            for (let r = top; r < top + BOX_SIZE; r++) {
              for (let c = left; c < left + BOX_SIZE; c++) {
                if (has(r, c, digit)) {
                  cells.push([r, c])
                }
              }
            }
            if (
              cells.length < minBoxCandidates ||
              !cells.every(([r, c]) => r === cornerRow || c === cornerCol) ||
              !cells.some(([r, c]) => r === cornerRow && c !== cornerCol) ||
              !cells.some(([r, c]) => c === cornerCol && r !== cornerRow)
            ) {
              continue
            }
            out.push({ hinge: [hRow, hCol], wing1: [w1Row, w1Col], box, elimination: { row: w2Row, col: w2Col, digit } })
          }
        }
      }
    }
  }
  return out
}

/**
 * Short AIC (Alternating Inference Chain): a strong link, a weak link, and
 * another strong link joining four candidates X-A-B-Y in a row. Whichever
 * of X or Y is false forces the other true (if X is false, the first
 * strong link forces A true, the weak link then forces B false, and the
 * second strong link forces Y true) - so X and Y behave exactly like a
 * strong link themselves, even though no single link connects them
 * directly. Two eliminations follow depending on whether X and Y are the
 * same digit (Type 1: any other cell seeing both of their cells can't be
 * that digit) or different digits whose cells see each other (Type 2:
 * neither end's cell can hold the other end's digit).
 */
export class SudokuShortAicFinder {
  /** `graphs` lets a caller that's about to also run Generic AIC on the same
   * board/candidates (Dynamic Dragon's Extension Rule 3 - see aicsInOrder in
   * SudokuDragonFinder) build the link graph once and pass it to both,
   * instead of it being rebuilt twice for identical input. Defaults to
   * building it here, so every other caller is unaffected. */
  findShortAics(board: Board, candidates: CandidateGrid, graphs?: LinkGraphs): ShortAicInstance[] {
    const { strongAdjacency, weakAdjacency, nodeByKey } = graphs ?? buildLinkGraphs(board, candidates)
    const seen = new Set<string>()
    const instances: ShortAicInstance[] = []
    let unitCounts: DigitUnitCounts | undefined

    const emit = (keys: string[]) => {
      const nodes = keys.map((k) => nodeByKey.get(k)!)
      const x = nodes[0]
      const y = nodes[nodes.length - 1]

      const outcome = computeEliminations(board, candidates, x, y)
      if (!outcome) {
        return
      }

      const key = chainDedupeKey(nodes)
      if (seen.has(key)) {
        return
      }
      seen.add(key)

      const links: AicLink[] = []
      for (let i = 0; i < nodes.length - 1; i++) {
        links.push({ from: nodes[i], to: nodes[i + 1], kind: i % 2 === 0 ? 'strong' : 'weak' })
      }

      const instance: ShortAicInstance = {
        nodes,
        links,
        length: nodes.length - 1,
        isSingleDigit: nodes.every((n) => n.digit === nodes[0].digit),
        eliminationType: outcome.type,
        eliminations: outcome.eliminations,
      }
      if (classifyShortAic(instance) === 'single-digit') {
        const named = classifySingleDigitPattern((unitCounts ??= buildDigitUnitCounts(board, candidates)), nodes)
        if (named) {
          instance.pattern = named.pattern
          instance.patternText = named.text
        }
      } else {
        const yWing = classifyYWing(candidates, nodes)
        if (yWing) {
          instance.pattern = 'Y-Wing'
          instance.patternText = yWing.text
          instance.yWing = yWing.details
        }
      }
      instances.push(instance)
    }

    for (const [aKey, aStrongNeighbors] of strongAdjacency) {
      for (const bKey of aStrongNeighbors) {
        const bWeakNeighbors = weakAdjacency.get(bKey) ?? []
        for (const cKey of bWeakNeighbors) {
          if (cKey === aKey || cKey === bKey) {
            continue
          }
          const cStrongNeighbors = strongAdjacency.get(cKey) ?? []
          for (const dKey of cStrongNeighbors) {
            if (dKey === aKey || dKey === bKey || dKey === cKey) {
              continue
            }

            // Chain length 3: X=a, ..., Y=d.
            emit([aKey, bKey, cKey, dKey])

            // Extend one more strong-weak round for chain length 5.
            const dWeakNeighbors = weakAdjacency.get(dKey) ?? []
            for (const eKey of dWeakNeighbors) {
              if (eKey === aKey || eKey === bKey || eKey === cKey || eKey === dKey) {
                continue
              }
              const eStrongNeighbors = strongAdjacency.get(eKey) ?? []
              for (const fKey of eStrongNeighbors) {
                if (fKey === aKey || fKey === bKey || fKey === cKey || fKey === dKey || fKey === eKey) {
                  continue
                }

                // Chain length 5: X=a, ..., Y=f.
                emit([aKey, bKey, cKey, dKey, eKey, fKey])
              }
            }
          }
        }
      }
    }

    // Empty Rectangles are length-3 single-digit chains too, just through
    // grouped nodes the link graph above doesn't have - found separately and
    // judged alongside the plain chains.
    instances.push(...findEmptyRectangles(board, candidates))
    // W-Wings likewise: a grouped one is out of the link graph's reach, and
    // a plain one needs its name.
    instances.push(...findWWings(board, candidates))

    // Bidirectional traversal already collapsed forward/backward duplicates
    // of the *same* chain (see chainDedupeKey); this collapses *different*
    // chains that happen to reach the same conclusion, keeping only the
    // most elegant one per elimination set. W-Wings go first, then Y-Wings,
    // then every other chain, by request - in the Techniques list and as
    // Dynamic Dragon's first pick among Short AICs.
    const best = pickBestPerEliminationSet(instances)
    return [
      ...best.filter((aic) => aic.pattern === 'W-Wing'),
      ...best.filter((aic) => aic.pattern === 'Y-Wing'),
      ...best.filter((aic) => aic.pattern !== 'W-Wing' && aic.pattern !== 'Y-Wing'),
    ]
  }

  findShortAicEliminations(board: Board, candidates: CandidateGrid): CandidateElimination[] {
    const eliminations = new Map<string, CandidateElimination>()
    for (const instance of this.findShortAics(board, candidates)) {
      for (const elimination of instance.eliminations) {
        eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination)
      }
    }
    return Array.from(eliminations.values())
  }
}
