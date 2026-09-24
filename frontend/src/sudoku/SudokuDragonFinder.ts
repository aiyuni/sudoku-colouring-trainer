import { cloneBoard, cloneCandidates, markedCandidateDigits } from './boardUtils'
import { SudokuBivalueOddagonFinder, type BivalueOddagonInstance } from './SudokuBivalueOddagonFinder'
import { SudokuBugPlusOneFinder, type BugPlusOneInstance } from './SudokuBugPlusOneFinder'
import { SudokuHiddenPairFinder, type HiddenPairInstance } from './SudokuHiddenPairFinder'
import { SudokuLockedCandidateFinder, type LockedCandidateInstance } from './SudokuLockedCandidateFinder'
import {
  SudokuMedusaFinder,
  type ChainColor,
  type ColoredCandidate,
  type MedusaChain,
  type StrongLinkGraph,
} from './SudokuMedusaFinder'
import { SudokuNakedSubsetFinder, type NakedSubsetInstance } from './SudokuNakedSubsetFinder'
import { SudokuPairFinder, type NakedPairInstance } from './SudokuPairFinder'
import { BOARD_SIZE, BOX_SIZE, SudokuRules } from './SudokuRules'
import { SudokuGenericAicFinder } from './SudokuGenericAicFinder'
import {
  buildLinkGraphs,
  classifyShortAic,
  SudokuShortAicFinder,
  type LinkGraphs,
  type ShortAicInstance,
} from './SudokuShortAicFinder'
import { sudokuUnits } from './SudokuUnits'
import { SudokuUniqueRectangleFinder, type UniqueRectangleInstance } from './SudokuUniqueRectangleFinder'
import type { Board, CandidateGrid } from './types'

export type PrimaryColor = 'blue' | 'yellow'
export type DragonColor = 'blue' | 'yellow' | 'darkBlue' | 'orange'
export type Side = 'A' | 'B'

export interface DragonNode {
  row: number
  col: number
  digit: number
  color: DragonColor
}

export type DragonMoveKind =
  | 'medusa'
  | 'extension-rule1'
  | 'extension-rule2'
  | 'extension-hidden-single'
  | 'extension-rule3'
  | 'promotion'
  | 'medusa-growth'
  | 'mass-elimination'
  | 'rule3'
  | 'rule4'
  | 'rule5'
  | 'solution'

/** extend()'s options. `dynamic` turns on Dynamic Dragon Colouring:
 * Extension Rule 3, which reaches further than Rules 1-2 by simulating
 * what naked pairs and Unique Rectangle Type 1 would find if a side's
 * assumption were propagated through the board first, not just what's
 * already directly visible from the colouring alone. */
export interface DragonExtendOptions {
  dynamic?: boolean
  /** Which non-colouring techniques Extension Rule 3's simulation may lean
   * on - defaults to DEFAULT_RULE3_TECHNIQUES (every technique except the
   * two AIC kinds, which are opt-in for Dynamic Dragon Colouring). 'naked
   * pair' is always allowed regardless of what's passed here, since the
   * settings UI never lets it be excluded. */
  allowedRule3Techniques?: ReadonlySet<Rule3Technique>
  /** At most one of a combined move's chained technique applications may
   * be an AIC (either kind) - defaults to true. False allows as many as
   * the chain needs. */
  aicLimitPerStep?: boolean
  /** Exhaustive Dragon Colouring - defaults to false, which stops at the
   * first elimination found (the original behaviour).
   *
   * When true, a non-mass elimination (Rules 3-5) doesn't end the
   * technique: its eliminations are applied to a working copy of the
   * candidates and the colouring carries on from that state, promotions
   * first, then the usual eliminations/extensions, each promotion or
   * extension its own move. It ends at a mass elimination (a whole side
   * proved false - that step is kept), at a colouring that covers every
   * empty cell with one side (a 'solution' move), or - keeping only the
   * moves up to the last elimination - once nothing more can be extended or
   * every dragon colour has been promoted to its medusa colour.
   *
   * Never changes *whether* a chain yields a result (that is decided by the
   * first elimination, exactly as when false), only how much it reports, so
   * callers that only need to know if a chain resolves can leave it off. */
  exhaustive?: boolean
  /** Optimize Dragons - defaults to false (the original behaviour: the two
   * sides take turns to extend). When true, each stretch of colouring up to
   * an elimination (the first one, and in exhaustive mode each later one)
   * uses as few Dragon colour extensions as the search can find, extending
   * whichever side gets there quickest instead of strictly alternating -
   * see extendOptimized. Like `exhaustive`, it never changes *whether* a
   * chain yields a result, only which moves it reports. */
  optimize?: boolean
  /** Optimize Dynamic Dragons - defaults to false; only matters with both
   * `optimize` and `dynamic`. When true, the search also branches on every
   * candidate Extension Rule 3 can force (not just its first, and not only
   * when a side has no plain extension), so a Dynamic Dragon too is reported
   * with as few extensions as the search can find. Much costlier than plain
   * Optimize - see OPTIMIZE_MAX_RULE3_SIMULATIONS. */
  optimizeDynamic?: boolean
}

export interface DragonCandidateRef {
  row: number
  col: number
  digit: number
}

/** One step of a Dragon Colouring session, for the move-by-move playback:
 * the reasoning that justifies it, plus anything it newly colors,
 * eliminates, or solves - cumulative across all moves up to and including
 * this one is the state shown at that point in the playback. */
export interface DragonMove {
  id: string
  kind: DragonMoveKind
  description: string
  colored: DragonNode[]
  eliminated: DragonCandidateRef[]
  solved: DragonCandidateRef[]
  /** mass-elimination and solution only: the medusa colour a same-side
   * contradiction proved true (its opposite proved false) or whose
   * colouring covers the whole grid - the actual conclusion the move's
   * eliminations/solves are both just consequences of. */
  provenTrueColor?: PrimaryColor
  /** extension-rule3 only: every non-colouring technique this step's
   * reasoning actually depended on, in the order they were chained -
   * usually just the one that directly produced the colouring, but when an
   * earlier technique (of a different kind) had to fire first to make that
   * one applicable, its own technique is included too (see
   * findExtensionRule3Move for how "actually depended on" is decided).
   * Drives both the "(naked pair, UR)"-style Dynamic Dragon Colouring
   * label and which techniques' basis cells get highlighted.
   *
   * Never includes 'hidden single': that's checked (and, when it applies
   * on its own, resolved) as a plain, always-on extension step before
   * Extension Rule 3 is ever attempted - see findExtensionHiddenSingleMove
   * - so by the time Extension Rule 3 finds one, it only ever did so
   * because some *other*, genuinely dynamic technique narrowed things
   * first. Mentioning "hidden single" here would wrongly credit it as the
   * reason this chain needed Dynamic Dragon Colouring at all. */
  dynamicTechniques?: Exclude<Rule3Technique, 'hidden single'>[]
  /** extension-rule3 only: the basis cells of every technique listed in
   * `dynamicTechniques` (a naked pair's two cells, a Unique Rectangle's
   * four, etc.), for highlighting them while this step is on screen. */
  dynamicTechniqueCells?: readonly (readonly [number, number])[]
  /** extension-rule3 only: one entry per AIC (either kind) this move's
   * chain leaned on - its own candidates/links, for the same purple/
   * curved-line rendering the standalone Short AIC technique gets, plus
   * which candidate(s) the AIC itself eliminated as its own internal
   * deduction. That internal elimination isn't a real board elimination
   * this move claims (it's consumed within the chain's own reasoning), so
   * it's rendered as a hollow circle + faint cross rather than the usual
   * red elimination pip - see App.tsx's technique-hypothetical-elimination
   * class. Kept (rather than folded into `substeps` below) for backward
   * compatibility with callers, like the tutorial, that want this move's
   * whole AIC chain at once and don't care about substep-by-substep
   * reveal. */
  aicChains?: Array<{
    candidates: DragonCandidateRef[]
    links: Array<{ from: DragonCandidateRef; to: DragonCandidateRef; kind: 'strong' | 'weak' }>
    hypotheticalEliminations: DragonCandidateRef[]
  }>
  /** extension-rule3 only (always present there): the step's reasoning,
   * one entry per technique application in the order they were chained,
   * then a closing 'dragon colour extension' entry for the colouring
   * itself - so always at least 2 entries. `description` only *names* the
   * techniques; their detail (cells, eliminations) is in these clauses.
   * Lets the UI step through the substeps one at a time (a separate,
   * optional control from the main move-by-move stepper) instead of always
   * showing the whole chain's basis cells and internal eliminations at
   * once - though showing them all at once (every substep "revealed") is
   * still the default, unnavigated view. */
  substeps?: DragonRule3Substep[]
  /** mass-elimination only, when the contradiction is an uncoloured cell
   * that would be left with no candidates at all (every one of them sees
   * the false side) - that cell, for the grid to highlight. */
  emptiedCell?: readonly [number, number]
}

/** One entry within a Dynamic Dragon Colouring step's chained reasoning
 * (see DragonMove.substeps) - an antecedent that had to fire first to
 * make the next one possible, the final technique that actually forces
 * the colouring, or (always last, exactly once) 'dragon colour extension':
 * the new dragon colour itself, with the forced cell as its basis cell.
 * 'hidden single' never appears as a technique here, for the same reason
 * it's excluded from `dynamicTechniques` - see that field's doc comment;
 * when it's what forced the cell, the extension substep says so. */
export interface DragonRule3Substep {
  technique: Exclude<Rule3Technique, 'hidden single'> | 'dragon colour extension'
  /** This substep's own explanation, no trailing full stop (e.g. "a Locked
   * Candidate (Pointing) for 5 in {r1c2, r1c3}, which eliminates 5r1c4",
   * or "As a result, r2c8 will only have 1 option (6), so colour 6r2c8
   * dark blue"). */
  clause: string
  /** The cells this technique rests on - not cumulative; each substep
   * supplies only its own, unlike DragonMove.dynamicTechniqueCells which
   * is every substep's basis cells flattened together. */
  basisCells: readonly (readonly [number, number])[]
  /** The candidates this substep's technique eliminates - a hypothetical/
   * internal deduction the chain's reasoning depends on, not a real board
   * elimination this move claims (DragonMove.eliminated only ever holds
   * the move's actual, final real-board effect, which for extension-rule3
   * is always empty - a Dynamic Dragon Colouring step only ever colours a
   * candidate, it never itself removes one from the board). Drawn with a
   * hollow red circle + cross, the same marker an AIC's own hypothetical
   * elimination has always had - see technique-hypothetical-elimination in
   * App.css. */
  eliminatedCandidates: readonly DragonCandidateRef[]
  /** Present only when `technique` is an AIC (either kind) - its own chain
   * for the purple/curved-line rendering the standalone technique gets. */
  aic?: {
    candidates: DragonCandidateRef[]
    links: Array<{ from: DragonCandidateRef; to: DragonCandidateRef; kind: 'strong' | 'weak' }>
  }
}

export interface DragonResult {
  moves: DragonMove[]
}

function sideOf(color: DragonColor): Side {
  return color === 'blue' || color === 'darkBlue' ? 'A' : 'B'
}

function isPrimary(color: DragonColor): boolean {
  return color === 'blue' || color === 'yellow'
}

function primaryForSide(side: Side): PrimaryColor {
  return side === 'A' ? 'blue' : 'yellow'
}

function secondaryForSide(side: Side): DragonColor {
  return side === 'A' ? 'darkBlue' : 'orange'
}

function sideOfPrimary(primary: PrimaryColor): Side {
  return primary === 'blue' ? 'A' : 'B'
}

function oppositeSide(side: Side): Side {
  return side === 'A' ? 'B' : 'A'
}

function oppositePrimary(primary: PrimaryColor): PrimaryColor {
  return primary === 'blue' ? 'yellow' : 'blue'
}

function colorLabel(color: DragonColor): string {
  switch (color) {
    case 'blue':
      return 'light blue'
    case 'yellow':
      return 'yellow'
    case 'darkBlue':
      return 'dark blue'
    case 'orange':
      return 'orange'
  }
}

function cellRef(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

function nodeKey(row: number, col: number, digit: number): string {
  return `${row},${col},${digit}`
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`
}

/** Deduplicated (row, col) cells a set of candidate eliminations touched -
 * used to check whether one Extension Rule 3 step's application narrowed a
 * cell that a later step's basis depends on. */
function uniqueCells(eliminations: { row: number; col: number }[]): readonly (readonly [number, number])[] {
  const seen = new Map<string, readonly [number, number]>()
  for (const { row, col } of eliminations) {
    seen.set(cellKey(row, col), [row, col])
  }
  return Array.from(seen.values())
}

/** One successful technique application inside Extension Rule 3's
 * hypothetical simulation, before it's known whether the final, forcing
 * technique actually depended on it - see findExtensionRule3Move. */
/** Every non-colouring technique Extension Rule 3 can lean on - 'hidden
 * single' never actually appears in a Rule3ChainStep (it's always the
 * final technique, never a chainable antecedent - see
 * findNewlyHiddenSingleCells), but is included here so it shares one type
 * with the final-technique parameter and DragonMove.dynamicTechniques. */
export type Rule3Technique =
  | 'hidden single'
  | 'locked candidate'
  | 'naked pair'
  | 'naked triple'
  | 'naked quad'
  | 'hidden pair'
  | 'UR'
  | 'bivalue oddagon'
  | 'bug plus one'
  | 'short single-digit aic'
  | 'short aic'
  | 'generic aic'

/** The Rule3Techniques that are AIC chains (each one's own kind of chain). */
export type AicTechnique = 'short single-digit aic' | 'short aic' | 'generic aic'

/** Every Rule3Technique, in the order the settings checkboxes and
 * findExtensionRule3Move's own simulation loop present them. 'naked pair'
 * can never be excluded (see extend()'s allowedTechniques) - it's included
 * here anyway so this stays the single source of truth for "every
 * technique that exists". */
export const ALL_RULE3_TECHNIQUES: readonly Rule3Technique[] = [
  'hidden single',
  'locked candidate',
  'naked pair',
  'naked triple',
  'naked quad',
  'hidden pair',
  'UR',
  'bivalue oddagon',
  'bug plus one',
  'short single-digit aic',
  'short aic',
  'generic aic',
]

/** ALL_RULE3_TECHNIQUES minus every AIC kind - the default allowed set for
 * both extend()'s own fallback and the app's initial settings state, since
 * the AIC kinds are all opt-in for Dynamic Dragon Colouring, while Bivalue
 * Oddagon and BUG+1 (like every other non-AIC technique here) default to
 * on. */
export const DEFAULT_RULE3_TECHNIQUES: readonly Rule3Technique[] = ALL_RULE3_TECHNIQUES.filter(
  (t) => t !== 'short aic' && t !== 'short single-digit aic' && t !== 'generic aic',
)

interface Rule3ChainStep {
  technique: Rule3Technique
  basisCells: readonly (readonly [number, number])[]
  affectedCells: readonly (readonly [number, number])[]
  /** The exact candidates (with digit) this step eliminates - the same
   * information `affectedCells` gives as bare cells, kept alongside it
   * because the resulting DragonMove.substeps entry (and the antecedent
   * clause's own "which eliminates ..." wording) needs the digit too. */
  eliminatedCandidates: readonly DragonCandidateRef[]
  /** This step's own detailed "a naked pair of {1,2} in {...}, which
   * eliminates ..." explanation - its DragonMove.substeps entry. The same
   * text whether the step ends up an antecedent or the final technique:
   * the colouring it leads to is a substep of its own (see
   * rule3ExtensionClause), never folded into the technique's clause. */
  clause: string
  /** Just the technique's name ("a naked pair", "a short single-digit AIC
   * (Type 1)") for the move's one-line `description`, which leaves the
   * detail to the substeps. */
  summaryName: string
  /** Present only when `technique` is an AIC (either kind) - carried
   * through to the resulting DragonMove's `aicChains` so the step can be
   * drawn with the same purple/curved-line chain visualization the
   * standalone technique gets. */
  aic?: ShortAicInstance
}

/** How Extension Rule 3's final technique pins down the cell it colours -
 * decides the wording of the move's closing "As a result, ..." substep.
 * `single candidate`: its eliminations left an uncoloured cell with one
 * candidate. `hidden single`: its eliminations left a digit one place in a
 * unit. `direct`: the technique itself names the cell's digit (UR Type 1,
 * BUG+1, Bivalue Oddagon Type 1). */
type Rule3Conclusion =
  | { kind: 'single candidate' }
  | { kind: 'hidden single'; unitKind: 'row' | 'column' | 'box' }
  | { kind: 'direct' }

/** Which kind of unit a set of cells belongs to - used to say "row",
 * "column", or "box" instead of the vaguer "section" wherever a
 * conclusion follows from a specific unit sudokuUnits() produced. */
function classifyUnitKind(cells: readonly (readonly [number, number])[]): 'row' | 'column' | 'box' {
  if (cells.every(([r]) => r === cells[0][0])) {
    return 'row'
  }
  if (cells.every(([, c]) => c === cells[0][1])) {
    return 'column'
  }
  return 'box'
}

function sameUnit(a: readonly [number, number], b: readonly [number, number]): boolean {
  const [ar, ac] = a
  const [br, bc] = b
  if (ar === br || ac === bc) {
    return true
  }
  return Math.floor(ar / BOX_SIZE) === Math.floor(br / BOX_SIZE) && Math.floor(ac / BOX_SIZE) === Math.floor(bc / BOX_SIZE)
}

/**
 * Dragon Colouring: an extension of 3D Medusa for chains Medusa's own rules
 * get stuck on. Medusa's two colors (the "primary"/"medusa" colors) become
 * two *sides*, each gaining a "secondary"/"dragon" color that marks a
 * candidate as true *conditional on* its side's primary color being true -
 * derived the same way a hidden or naked single would be, but under that
 * assumption instead of firm knowledge. Two extension rules grow this
 * conditional coloring; a promotion rule upgrades a conditional color to
 * unconditional once two opposite-side colors of the same candidate prove
 * each other's side always holds; and Medusa's own elimination rules 1-5
 * then apply again, generalized to compare *sides* (primary + its own
 * secondary count as the same side) instead of exact colors.
 *
 * Simplification: this treats "Medusa gets stuck" as "this chain has none
 * of Medusa's own rules 1-5 available" (checked by the caller before
 * calling `extend`), and reasons entirely from one fixed snapshot of the
 * board's candidates - it does not re-derive new conjugate pairs that
 * eliminating a candidate might create along the way, the way a from-
 * scratch re-solve would. That keeps the session's moves attributable to
 * one consistent coloring pass rather than an open-ended solve loop.
 */
/** Safety cap on Extension Rule 3's own inner simulation loop - in
 * practice a handful of applications either finds a forced cell or gets
 * stuck, but naked triples/quads make each re-scan of the hypothetical
 * board noticeably pricier than pairs alone, so a pathological candidate
 * layout is capped here rather than risking the UI hanging on it (this
 * runs live, on every board/candidate change). */
const MAX_RULE3_SIMULATION_STEPS = 200

/** When collecting *every* move (Optimize Dynamic Dragons), the simulation
 * runs until nothing more applies instead of stopping at its first forced
 * candidate - and with AICs enabled, every step that no simpler technique
 * covers starts a full AIC search, by far the costliest part (a generic AIC
 * search especially). So the AIC search may run only this many times per
 * collecting simulation; after that, AICs count as "nothing more applies".
 * The non-AIC techniques are cheap and aren't limited, so with AICs off
 * (the default) this changes nothing. Measured: capping *all* steps instead
 * cost as much quality with AICs off as on. */
const MAX_RULE3_ENUMERATION_AIC_SEARCHES = 4

/** Optimize Dragons' per-phase search budget, counted in distinct colourings
 * tried (each one an elimination check, and later its own extension scan).
 * Past it, the phase falls back to the default alternating result, so this
 * only bounds how hard it tries, never correctness. Sized for a computation
 * that runs live on every board change, per stuck chain.
 *
 * The first phase (Medusa to first elimination - the Dragon itself) gets the
 * full budget. Exhaustive mode's later phases start from an already long
 * colouring whose alternating baseline is typically far deeper than any
 * search can reach, so they'd mostly just burn the budget before falling
 * back; they get a smaller one. */
const OPTIMIZE_MAX_SEARCH_STATES = 3000
const OPTIMIZE_MAX_SEARCH_STATES_LATER_PHASES = 500

/** Optimize Dynamic Dragons' per-phase budget of fresh Extension Rule 3
 * simulations (each one the whole technique battery, run until nothing more
 * applies, on one side's hypothetical board). Past it, a newly reached
 * colouring doesn't get its own simulation and uses the Rule 3 moves it
 * inherited instead (see OptimizeState.rule3Known) - still valid, just
 * possibly missing a move only its newest candidate unlocks. The search is
 * breadth-first, so the budget goes to the shallowest colourings first,
 * where a shorter Dragon would be. */
const OPTIMIZE_MAX_RULE3_SIMULATIONS = 20
const OPTIMIZE_MAX_RULE3_SIMULATIONS_LATER_PHASES = 2
/** The same, for plain Optimize Dragons' Rule 3 fallback in dynamic mode
 * (one simulation, stopping at its first forced candidate, for a side with
 * no plain extension) - cheaper each, so more of them. */
const OPTIMIZE_MAX_RULE3_FALLBACK_SIMULATIONS = 60
const OPTIMIZE_MAX_RULE3_FALLBACK_SIMULATIONS_LATER_PHASES = 15

/** Every cell index (row * 9 + col) sharing a row, column or box with each
 * cell - the cell itself included, as sameUnit counts it. Fixed, so built
 * once. */
const PEERS_WITH_SELF: readonly (readonly number[])[] = Array.from({ length: 81 }, (_, cell) => {
  const r = Math.floor(cell / 9)
  const c = cell % 9
  const peers: number[] = []
  for (let other = 0; other < 81; other++) {
    const r2 = Math.floor(other / 9)
    const c2 = other % 9
    if (r === r2 || c === c2 || (Math.floor(r / 3) === Math.floor(r2 / 3) && Math.floor(c / 3) === Math.floor(c2 / 3))) {
      peers.push(other)
    }
  }
  return peers
})

/** seen[(digit - 1) * 81 + row * 9 + col]: some node passing `include`, of
 * that digit, is in a different cell sharing a row, column or box with this
 * one - exactly what the old per-cell "sees this colour" scans (seesSide,
 * Extension Rule 1's seesPrimary) asked, own cell excluded. */
function seenByNodes(nodes: Iterable<DragonNode>, include: (n: DragonNode) => boolean): Uint8Array {
  const seen = new Uint8Array(9 * 81)
  for (const n of nodes) {
    if (!include(n)) {
      continue
    }
    const cell = n.row * 9 + n.col
    const base = (n.digit - 1) * 81
    for (const peer of PEERS_WITH_SELF[cell]) {
      if (peer !== cell) {
        seen[base + peer] = 1
      }
    }
  }
  return seen
}

/** Whether findEliminationMoves would return anything - the same conditions
 * as findMassElimination and findRule3/4/5, each only asking whether a
 * match exists, answered from one table of which cells see each (side,
 * digit) instead of scanning every node per candidate. Must stay exactly in
 * step with those methods: a false "no" would silently drop eliminations.
 * They only ever look at a node's side, never primary vs dragon colour, so
 * neither does this. */
function hasAnyElimination(nodes: readonly DragonNode[], board: Board, candidates: CandidateGrid): boolean {
  // sees[(side * 9 + digit - 1) * 81 + cell]: some node of that side and
  // digit shares a unit with the cell (or is in it).
  const sees = new Uint8Array(2 * 9 * 81)
  const cellSides = new Uint8Array(81) // bit 1 = side A, bit 2 = side B
  const cellNodeCount = new Uint8Array(81)
  const cellFirstDigit = new Uint8Array(81)
  const colored = new Uint8Array(81 * 9)
  for (const n of nodes) {
    const cell = n.row * 9 + n.col
    const side = sideOf(n.color) === 'A' ? 0 : 1
    const base = (side * 9 + n.digit - 1) * 81
    // Mass elimination (same side twice): two nodes in one cell, or the
    // same digit in one unit (an earlier node of this side and digit
    // already sees this cell).
    if (cellSides[cell] & (1 << side) || sees[base + cell]) {
      return true
    }
    cellSides[cell] |= 1 << side
    if (cellNodeCount[cell]++ === 0) {
      cellFirstDigit[cell] = n.digit
    }
    colored[cell * 9 + n.digit - 1] = 1
    for (const peer of PEERS_WITH_SELF[cell]) {
      sees[base + peer] = 1
    }
  }
  for (let cell = 0; cell < 81; cell++) {
    const row = Math.floor(cell / 9)
    const col = cell % 9
    if (board[row][col] !== 0) {
      continue
    }
    const marks = candidates[row][col]
    const sides = cellSides[cell]
    if (sides === 0) {
      // Mass elimination: an uncoloured cell every candidate of which sees
      // one side.
      let anyDigit = false
      let allSeeA = true
      let allSeeB = true
      for (let d = 0; d < 9; d++) {
        if (!marks[d]) {
          continue
        }
        anyDigit = true
        allSeeA &&= sees[d * 81 + cell] === 1
        allSeeB &&= sees[(9 + d) * 81 + cell] === 1
      }
      if (anyDigit && (allSeeA || allSeeB)) {
        return true
      }
    }
    for (let d = 0; d < 9; d++) {
      if (!marks[d] || colored[cell * 9 + d]) {
        continue
      }
      // Rule 3: an uncoloured candidate seeing its digit on both sides.
      if (sees[d * 81 + cell] && sees[(9 + d) * 81 + cell]) {
        return true
      }
      // Rule 4: a cell holding both sides, with an uncoloured candidate.
      if (sides === 3) {
        return true
      }
      // Rule 5: a cell with exactly one node, another candidate of which
      // sees its digit on the other side (the lone node is a different
      // digit, so no same-cell node can be the one seen).
      if (cellNodeCount[cell] === 1 && d + 1 !== cellFirstDigit[cell]) {
        const otherSide = sides === 1 ? 1 : 0
        if (sees[(otherSide * 9 + d) * 81 + cell]) {
          return true
        }
      }
    }
  }
  return false
}

/** How many Rule 3 finder results memoFind keeps (all finders together).
 * Measured on a 41-step solve path (every AIC kind, AIC limit off, Optimize
 * Dynamic on): Dynamic Dragon work took 21.3 s with no cache, 17.0 s at
 * 5000 entries (~6 MB retained), 15.7 s at 20000 (~29 MB). 10000 is the
 * middle of that curve, ~15 MB. */
const FINDER_MEMO_MAX_ENTRIES = 10000

/** The whole grid as a compact string: per cell, its digit (or 0) and its
 * candidate marks as a 9-bit mask - two characters, so equal keys mean
 * exactly equal grids. */
function gridKey(board: Board, candidates: CandidateGrid): string {
  let key = ''
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const marks = candidates[row][col]
      let mask = 0
      for (let d = 0; d < 9; d++) {
        if (marks[d]) {
          mask |= 1 << d
        }
      }
      key += String.fromCharCode(48 + board[row][col], 0x4000 + mask)
    }
  }
  return key
}

/** A hidden single on a side's hypothetical board. */
interface HiddenSingleFind {
  row: number
  col: number
  digit: number
  unitKind: 'row' | 'column' | 'box'
  /** The unit's own 9 cells - a hidden single's validity rests on *all* of
   * them (every other one no longer holding this digit), not just the
   * resulting cell, so this is what dependency-tracking needs to check a
   * prior antecedent against - see findExtensionRule3Move. */
  unit: readonly (readonly [number, number])[]
}

/** One branch of Optimize Dragons' search - see extendOptimized. */
interface OptimizeState {
  nodeMap: Map<string, DragonNode>
  moves: DragonMove[]
  counter: number
  /** Optimize Dynamic Dragons only: every Extension Rule 3 move known so
   * far for each side, carried down from parent to child. A move derived
   * from some of a side's candidates stays valid once the side has more
   * ("if the side is true, these candidates are, so ... forces X" doesn't
   * care what else the side holds), so a child inherits its parent's
   * without simulating again. Reset when an exhaustive-mode elimination
   * changes the candidates, since its explanation would describe marks that
   * are gone. */
  rule3Known: Record<Side, DragonMove[]>
}

/** Where extend()'s loop stands once it next needs an extension, or why it
 * doesn't: 'final' = push these and return (a mass elimination, or any
 * elimination with exhaustive off); 'elimination' = exhaustive, apply and
 * carry on; 'dead-end' = exhaustive, every dragon colour promoted. */
type OptimizeOutcome =
  | { kind: 'extend' }
  | { kind: 'dead-end' }
  | { kind: 'final'; moves: DragonMove[] }
  | { kind: 'elimination'; moves: DragonMove[] }
  | { kind: 'solution'; move: DragonMove }

interface OptimizePhaseResult {
  state: OptimizeState
  outcome: OptimizeOutcome
  /** Whose turn it would be next, for the next phase's baseline. */
  turn: PrimaryColor
  extensions: number
}

/** A colouring's identity for Optimize Dragons' state dedup - which
 * candidates carry which colour, independent of the order they got it. */
function colouringSignature(nodeMap: Map<string, DragonNode>): string {
  // One code per node - (cell, digit, colour), unique by construction and
  // under 2916 - sorted numerically and packed into a string: equal
  // signatures mean exactly equal colourings. Called for every state the
  // Optimize search generates, so this avoids building and sorting a string
  // per node.
  const codes = new Uint16Array(nodeMap.size)
  let i = 0
  for (const n of nodeMap.values()) {
    codes[i++] = ((n.row * 9 + n.col) * 9 + n.digit - 1) * 4 + COLOR_CODE[n.color]
  }
  codes.sort()
  return String.fromCharCode(...codes)
}

const COLOR_CODE: Record<DragonColor, number> = { blue: 0, yellow: 1, darkBlue: 2, orange: 3 }

export class SudokuDragonFinder {
  /** Extension Rule 3 finder results by hypothetical grid - see memoFind. */
  private readonly finderMemo = new Map<string, unknown>()

  /** Every Rule 3 technique finder is a pure function of (board,
   * candidates), and the same hypothetical grid comes up again and again:
   * the default path, Optimize's fallback and Optimize Dynamic's every-move
   * simulation all simulate the same colourings, stepping through identical
   * grids until they first diverge, and consecutive solve-path positions
   * repeat many of them too (measured: ~45% of all finder calls on a long
   * solve path were a grid already seen). So each result is kept, keyed by
   * finder and the grid itself (gridKey - the whole grid, not a hash, so a
   * hit is always the identical input), in a bounded least-recently-used
   * map. Results are only ever read, never mutated, by the simulation and
   * the moves it builds, so sharing them is safe. */
  private memoFind<T>(finder: string, grid: string, compute: () => T): T {
    const key = `${finder}|${grid}`
    if (this.finderMemo.has(key)) {
      const hit = this.finderMemo.get(key) as T
      // Least recently used goes first: re-insert on a hit.
      this.finderMemo.delete(key)
      this.finderMemo.set(key, hit)
      return hit
    }
    const result = compute()
    this.finderMemo.set(key, result)
    if (this.finderMemo.size > FINDER_MEMO_MAX_ENTRIES) {
      this.finderMemo.delete(this.finderMemo.keys().next().value!)
    }
    return result
  }

  private readonly pairFinder = new SudokuPairFinder()
  private readonly lockedCandidateFinder = new SudokuLockedCandidateFinder()
  private readonly medusaFinder = new SudokuMedusaFinder()
  private readonly nakedSubsetFinder = new SudokuNakedSubsetFinder()
  private readonly hiddenPairFinder = new SudokuHiddenPairFinder()
  private readonly shortAicFinder = new SudokuShortAicFinder()
  private readonly genericAicFinder = new SudokuGenericAicFinder()
  private readonly uniqueRectangleFinder = new SudokuUniqueRectangleFinder()
  private readonly bugPlusOneFinder = new SudokuBugPlusOneFinder()
  private readonly bivalueOddagonFinder = new SudokuBivalueOddagonFinder()

  extend(
    medusaChain: MedusaChain,
    board: Board,
    candidates: CandidateGrid,
    options: DragonExtendOptions = {},
  ): DragonResult | null {
    const nodeMap = new Map<string, DragonNode>()
    const seed: DragonNode[] = medusaChain.candidates.map((c) => ({
      row: c.row,
      col: c.col,
      digit: c.digit,
      color: c.color,
    }))
    for (const n of seed) {
      nodeMap.set(nodeKey(n.row, n.col, n.digit), n)
    }

    const blueCount = seed.filter((n) => n.color === 'blue').length
    const yellowCount = seed.filter((n) => n.color === 'yellow').length
    const moves: DragonMove[] = [
      {
        id: 'medusa',
        kind: 'medusa',
        description: `Consider this 3d Medusa with: ${blueCount} candidate${blueCount === 1 ? '' : 's'} light blue, and ${yellowCount} candidates yellow.`,
        colored: seed,
        eliminated: [],
        solved: [],
      },
    ]

    const exhaustive = options.exhaustive ?? false
    // What every rule below reads. The caller's `candidates` is never
    // mutated: in exhaustive mode the first non-mass elimination swaps in a
    // private copy with that elimination applied, and later ones keep
    // editing the copy - so with exhaustive off this is always `candidates`
    // itself, and nothing here differs from the original stop-at-the-first-
    // elimination behaviour.
    let workingCandidates = candidates
    // True once an elimination has been applied and the colouring is being
    // carried on from the resulting state (exhaustive only) - see the
    // continuation rules in the loop below.
    let continuing = false
    // moves.length just after the last elimination group - where a
    // continuation that runs dry gets cut back to, so the result never ends
    // on promotions/extensions that led nowhere.
    let lastEliminationEnd = 0

    // Lazily built on the first promotion, then reused for every later one
    // - building it is far too costly (an O(board) scan) to redo per
    // promotion. Most extend() calls promote zero or one time, but a long
    // chain can promote repeatedly, and this call is itself made many times
    // over during puzzle generation's grind, so avoiding the redundant
    // rebuild matters. Only ever stale in exhaustive mode, where an applied
    // elimination can create new conjugate pairs/bivalue cells - so applying
    // one resets this to null and the next promotion rebuilds it.
    let strongLinkGraph: StrongLinkGraph | null = null

    // 'naked pair' is enforced as always-on here rather than trusted from
    // the caller, since it's the one technique the settings UI itself never
    // lets the user exclude.
    const allowedRule3Techniques = new Set(options.allowedRule3Techniques ?? DEFAULT_RULE3_TECHNIQUES)
    allowedRule3Techniques.add('naked pair')
    const aicLimitPerStep = options.aicLimitPerStep ?? true

    if (options.optimize) {
      return this.extendOptimized(
        nodeMap,
        moves,
        board,
        candidates,
        options.dynamic ?? false,
        exhaustive,
        allowedRule3Techniques,
        aicLimitPerStep,
        options.optimizeDynamic ?? false,
      )
    }

    // Extension Rules 1, 2, 3, and the plain hidden-single check are all
    // that ever grows a side, and every one of them is a pure function of
    // that side's own coloured cells (board/candidates too, but those are
    // fixed for the whole call outside exhaustive mode) - Rule 1/2 look only
    // at *this side's* visibility, and the hidden-single/Rule 3 hypothetical
    // board is built from this side's own cells alone (buildHypotheticalBoard).
    // So when a side's turn comes up with nothing from any of the four, it
    // will keep coming up with nothing on every later turn until that side
    // gains a cell, or (exhaustive mode) an elimination changes the working
    // candidates - the other side colouring more cells in the meantime can
    // only make these rules *less* likely to find something, since all of
    // them skip a cell that's already coloured, never more. That "found
    // nothing" answer is remembered per side rather than re-simulated on
    // every alternating turn - Rule 3 in particular reruns every finder on a
    // cloned board, so repeating all four for both sides every turn was most
    // of this loop's cost. A side's exact node *set* only ever grows once a
    // key is added (recolouring via promotion never adds/removes a key), so
    // node *count* alone safely stands in for "have we added anything new".
    let candidatesVersion = 0
    const sideNothing: Record<Side, { sideNodes: number; version: number } | null> = { A: null, B: null }
    const findExtensionForSide = (primary: PrimaryColor): DragonMove | null => {
      const side = sideOfPrimary(primary)
      let sideNodes = 0
      for (const n of nodeMap.values()) {
        if (sideOf(n.color) === side) {
          sideNodes++
        }
      }
      const known = sideNothing[side]
      if (known && known.sideNodes === sideNodes && known.version === candidatesVersion) {
        return null
      }
      const found =
        this.findExtensionRule1Move(nodeMap, board, workingCandidates, primary) ??
        this.findExtensionRule2Move(nodeMap, board, workingCandidates, primary) ??
        this.findExtensionHiddenSingleMove(nodeMap, board, workingCandidates, primary) ??
        (options.dynamic
          ? this.findExtensionRule3Move(
              nodeMap,
              board,
              workingCandidates,
              primary,
              allowedRule3Techniques,
              aicLimitPerStep,
            )
          : null)
      sideNothing[side] = found ? null : { sideNodes, version: candidatesVersion }
      return found
    }

    let counter = 0
    // Whose turn it is to extend next - alternated after every extension
    // move, so the chain grows both sides evenly instead of exhausting
    // one colour's every possible extension before ever trying the
    // other's. A side with nothing to extend on its turn doesn't block
    // things - the other side's turn is tried immediately as a fallback.
    let turnPrimary: PrimaryColor = 'blue'

    // Promotion is taken before any extension attempt, on every iteration:
    // once two opposite-side colours are proven, that proof doesn't get any
    // more or less true by waiting, and a proactive promotion can itself
    // unlock strong-link growth (see below) or a mass elimination the
    // caller would otherwise have to wait an extra round-trip through this
    // loop to reach. It isn't an extension of either side - it's what
    // resolves the two sides against each other - so it doesn't participate
    // in the turn alternation below. Returns whether it promoted anything.
    const applyPromotion = (): boolean => {
      const promotionMove = this.findPromotionMove(nodeMap)
      if (!promotionMove) {
        return false
      }
      for (const n of promotionMove.colored) {
        nodeMap.set(nodeKey(n.row, n.col, n.digit), n)
      }
      promotionMove.id = `promotion-${counter++}`
      moves.push(promotionMove)

      // A newly-promoted candidate is now genuinely known true, not just
      // "true if this side is true" - so it can have its own strong
      // links (conjugate pairs, bivalue cells) that were never part of
      // the original Medusa chain (Dragon's extension rules don't follow
      // strong links, only colour visibility), reaching cells the
      // original chain never touched. Surfaced as its own step, exactly
      // like the initial "Colour the Medusa chain" move, before
      // anything else is attempted.
      strongLinkGraph ??= this.medusaFinder.buildStrongLinkGraph(board, workingCandidates)
      const growthMove = this.findMedusaGrowthMove(nodeMap, strongLinkGraph, promotionMove.colored)
      if (growthMove) {
        for (const n of growthMove.colored) {
          nodeMap.set(nodeKey(n.row, n.col, n.digit), n)
        }
        growthMove.id = `medusa-growth-${counter++}`
        moves.push(growthMove)
      }
      return true
    }

    for (;;) {
      // Exhaustive continuation only: once an elimination has been applied,
      // promotions come before everything else, eliminations included.
      // (Before the first elimination the order is the original one -
      // eliminations, then promotion - so the first elimination found is the
      // same with or without exhaustive.)
      if (continuing && applyPromotion()) {
        continue
      }

      // Check for an elimination after every single new coloring, not just
      // once the extension is fully exhausted - as soon as one is
      // available, stop growing the chain further and surface it, rather
      // than colouring dozens more (unneeded) candidates first.
      const eliminationMoves = this.findEliminationMoves(Array.from(nodeMap.values()), board, workingCandidates)
      // A mass elimination proves a whole side false, so it ends the
      // technique outright, exhaustive or not: nothing is left to colour.
      const isMassElimination = eliminationMoves.length === 1 && eliminationMoves[0].kind === 'mass-elimination'
      if (eliminationMoves.length > 0 && (!exhaustive || isMassElimination)) {
        moves.push(...eliminationMoves)
        return { moves }
      }

      if (continuing) {
        const solutionMove = this.findColouringSolutionMove(nodeMap, board)
        if (solutionMove) {
          moves.push(solutionMove)
          return { moves }
        }
        if (!Array.from(nodeMap.values()).some((n) => !isPrimary(n.color))) {
          // Every dragon colour has been promoted to its medusa colour.
          return { moves: moves.slice(0, lastEliminationEnd) }
        }
      }

      if (eliminationMoves.length > 0) {
        // Exhaustive, and not a mass elimination: report it, then carry on
        // from the state where it has been applied.
        moves.push(...eliminationMoves)
        lastEliminationEnd = moves.length
        if (workingCandidates === candidates) {
          workingCandidates = cloneCandidates(candidates)
        }
        for (const move of eliminationMoves) {
          for (const { row, col, digit } of move.eliminated) {
            workingCandidates[row][col][digit - 1] = false
          }
        }
        strongLinkGraph = null
        candidatesVersion++
        continuing = true
        continue
      }

      if (!continuing && applyPromotion()) {
        continue
      }

      let move = findExtensionForSide(turnPrimary)
      let extendedPrimary = turnPrimary
      if (!move) {
        extendedPrimary = oppositePrimary(turnPrimary)
        move = findExtensionForSide(extendedPrimary)
      }
      if (!move) {
        // Nothing actionable came out of the extension. Not worth surfacing
        // - unless exhaustive mode has already reported eliminations, in
        // which case those stand and only the dead-end tail is dropped.
        return continuing ? { moves: moves.slice(0, lastEliminationEnd) } : null
      }
      for (const n of move.colored) {
        nodeMap.set(nodeKey(n.row, n.col, n.digit), n)
      }
      move.id = `${move.kind}-${counter++}`
      moves.push(move)
      if (
        move.kind === 'extension-rule1' ||
        move.kind === 'extension-rule2' ||
        move.kind === 'extension-hidden-single' ||
        move.kind === 'extension-rule3'
      ) {
        turnPrimary = oppositePrimary(extendedPrimary)
      }
    }
  }

  /** extend() with Optimize Dragons on. The default loop above is a single
   * path: the two sides take turns, each taking the first extension its
   * rules find. Here each *phase* - the colouring from the medusa (or, in
   * exhaustive mode, from the last applied elimination) up to the next
   * elimination - is instead a search over which candidate (of either side)
   * gets coloured at each point, to reach an elimination with as few
   * extension moves as possible.
   * Promotions and medusa growth aren't extensions (they're forced, and
   * applied exactly where the default loop applies them), so they're free.
   *
   * Per phase:
   *  1. Run the default alternating strategy from the phase's start state
   *     (the "baseline"). If it finds nothing, the phase finds nothing -
   *     exactly as with Optimize off - so this setting never changes
   *     *whether* a chain resolves. That matters beyond tidiness: the
   *     plain-vs-Dynamic split (App's computeStuckDynamicDragonExtensions)
   *     and the puzzle generator both decide from a non-optimized call.
   *  2. Breadth-first search over every extension either side could take
   *     next (allExtensions: every Rule 1, Rule 2 and hidden-single hit,
   *     not just the first), strictly shallower than the baseline (so it
   *     can only ever improve on it), deduplicating states by their exact
   *     colouring - orders that colour the same candidates reach the same
   *     state. The first state at the shallowest depth that reaches an
   *     elimination wins (side A before B, then each rule's scan order, so
   *     ties are deterministic).
   *  3. If the search exceeds OPTIMIZE_MAX_SEARCH_STATES colourings, it
   *     gives up and the baseline stands.
   *
   * Branching on the first hit only (what this first did) missed short
   * Dragons whenever one side had nothing to extend: the side choice was
   * then forced, so the search was the default path. E.g. a chain whose
   * light blue needed 3 extensions (the last a hidden single) for a Rule 5
   * elimination was reported as a 22-extension mass elimination, because
   * the fixed scan order kept picking other Rule 1/2 hits first.
   *
   * Rule 3 (Dynamic) is still only a fallback for a side with no plain
   * extension, and only its first find - see allExtensions. */
  private extendOptimized(
    seedNodeMap: Map<string, DragonNode>,
    seedMoves: DragonMove[],
    board: Board,
    candidates: CandidateGrid,
    dynamic: boolean,
    exhaustive: boolean,
    allowedRule3Techniques: ReadonlySet<Rule3Technique>,
    aicLimitPerStep: boolean,
    optimizeDynamic: boolean,
  ): DragonResult | null {
    // Same meaning as in extend(): fixed within a phase, changed only when
    // an exhaustive-mode elimination is applied between phases.
    let workingCandidates = candidates
    let strongLinkGraph: StrongLinkGraph | null = null
    let continuing = false
    let lastEliminationEnd = 0
    let turnPrimary: PrimaryColor = 'blue'

    const cloneState = (state: OptimizeState): OptimizeState => ({
      nodeMap: new Map(state.nodeMap),
      moves: state.moves.slice(),
      counter: state.counter,
      // Lists are replaced, never mutated, so sharing them is safe.
      rule3Known: { ...state.rule3Known },
    })
    // Fresh Rule 3 simulation budgets for the search, per phase: the plain
    // search's one-move fallback, and Optimize Dynamic Dragons' every-move
    // simulations. Separate, so the first pass can't starve the second.
    let fallbackRule3SimulationsLeft = OPTIMIZE_MAX_RULE3_FALLBACK_SIMULATIONS
    let everyRule3SimulationsLeft = OPTIMIZE_MAX_RULE3_SIMULATIONS

    const findExtension = (state: OptimizeState, primary: PrimaryColor): DragonMove | null =>
      this.findExtensionRule1Move(state.nodeMap, board, workingCandidates, primary) ??
      this.findExtensionRule2Move(state.nodeMap, board, workingCandidates, primary) ??
      this.findExtensionHiddenSingleMove(state.nodeMap, board, workingCandidates, primary) ??
      (dynamic
        ? this.findExtensionRule3Move(
            state.nodeMap,
            board,
            workingCandidates,
            primary,
            allowedRule3Techniques,
            aicLimitPerStep,
          )
        : null)

    // A found move may be applied in several search branches, so each
    // application gets its own copy (the id is per-branch).
    const applyExtension = (state: OptimizeState, move: DragonMove) => {
      for (const n of move.colored) {
        state.nodeMap.set(nodeKey(n.row, n.col, n.digit), n)
      }
      state.moves.push({ ...move, id: `${move.kind}-${state.counter++}` })
    }

    // extend()'s applyPromotion, on a search state. The strong-link graph
    // depends only on the working candidates, so one is shared by every
    // branch of a phase.
    const applyPromotion = (state: OptimizeState): boolean => {
      const promotionMove = this.findPromotionMove(state.nodeMap)
      if (!promotionMove) {
        return false
      }
      for (const n of promotionMove.colored) {
        state.nodeMap.set(nodeKey(n.row, n.col, n.digit), n)
      }
      promotionMove.id = `promotion-${state.counter++}`
      state.moves.push(promotionMove)
      strongLinkGraph ??= this.medusaFinder.buildStrongLinkGraph(board, workingCandidates)
      const growthMove = this.findMedusaGrowthMove(state.nodeMap, strongLinkGraph, promotionMove.colored)
      if (growthMove) {
        for (const n of growthMove.colored) {
          state.nodeMap.set(nodeKey(n.row, n.col, n.digit), n)
        }
        growthMove.id = `medusa-growth-${state.counter++}`
        state.moves.push(growthMove)
      }
      return true
    }

    // Everything extend()'s loop does between two extension moves, in the
    // same order (promotion-first once continuing, elimination-first
    // before), stopping where it would either pick an extension or end.
    const settle = (state: OptimizeState): OptimizeOutcome => {
      for (;;) {
        if (continuing && applyPromotion(state)) {
          continue
        }
        const eliminationMoves = this.findEliminationMoves(Array.from(state.nodeMap.values()), board, workingCandidates)
        const isMassElimination = eliminationMoves.length === 1 && eliminationMoves[0].kind === 'mass-elimination'
        if (eliminationMoves.length > 0 && (!exhaustive || isMassElimination)) {
          return { kind: 'final', moves: eliminationMoves }
        }
        if (continuing) {
          const solutionMove = this.findColouringSolutionMove(state.nodeMap, board)
          if (solutionMove) {
            return { kind: 'solution', move: solutionMove }
          }
          if (!Array.from(state.nodeMap.values()).some((n) => !isPrimary(n.color))) {
            return { kind: 'dead-end' }
          }
        }
        if (eliminationMoves.length > 0) {
          return { kind: 'elimination', moves: eliminationMoves }
        }
        if (!continuing && applyPromotion(state)) {
          continue
        }
        return { kind: 'extend' }
      }
    }

    // The default alternating strategy (turn side first, the other as a
    // fallback, flip after each extension), including extend()'s per-side
    // "found nothing" memo - the working candidates are fixed within a
    // phase, so node count alone keys it. Mutates `state`.
    const runBaseline = (state: OptimizeState): OptimizePhaseResult | null => {
      let turn = turnPrimary
      let extensions = 0
      const sideNothing: Record<Side, number | null> = { A: null, B: null }
      const extensionForSide = (primary: PrimaryColor): DragonMove | null => {
        const side = sideOfPrimary(primary)
        let sideNodes = 0
        for (const n of state.nodeMap.values()) {
          if (sideOf(n.color) === side) {
            sideNodes++
          }
        }
        if (sideNothing[side] === sideNodes) {
          return null
        }
        const found = findExtension(state, primary)
        sideNothing[side] = found ? null : sideNodes
        return found
      }
      for (;;) {
        let move = extensionForSide(turn)
        let extended = turn
        if (!move) {
          extended = oppositePrimary(turn)
          move = extensionForSide(extended)
        }
        if (!move) {
          return null
        }
        applyExtension(state, move)
        extensions++
        turn = oppositePrimary(extended)
        const outcome = settle(state)
        if (outcome.kind === 'dead-end') {
          return null
        }
        if (outcome.kind !== 'extend') {
          return { state, outcome, turn, extensions }
        }
      }
    }

    // Every extension this side could take next, not just the first one the
    // default loop takes - the search branches on each. Rules 1, 2 and the
    // hidden single are cheap scans, so all of their hits are listed (one
    // move per candidate, the simplest rule's explanation kept). Rule 3
    // stays what it is in the default loop: a fallback only when the side
    // has no plain extension at all, and only its first find - enumerating
    // every Rule 3 simulation would multiply the most expensive step.
    //
    // What a side can extend with depends only on that side's own cells,
    // apart from skipping candidates (Rule 2: cells) the other side has
    // already coloured - so it's computed once per distinct side colouring,
    // from that side's cells alone, and the other side's colouring is
    // filtered out per state. Same moves as scanning the full state, but a
    // side that isn't changing (often one side has nothing to extend at
    // all) isn't rescanned - or, in dynamic mode, re-simulated - for every
    // state of the other. Keyed per phase: the working candidates change
    // between phases.
    let sideExtensionCache = new Map<
      string,
      { plain: DragonMove[]; rule3: DragonMove | null | undefined; rule3All?: DragonMove[] }
    >()
    const usableIn = (state: OptimizeState, move: DragonMove): boolean => {
      const [n] = move.colored
      if (state.nodeMap.has(nodeKey(n.row, n.col, n.digit))) {
        return false
      }
      // Rule 2 only ever colours a cell with no coloured candidate yet.
      return (
        move.kind !== 'extension-rule2' ||
        !markedCandidateDigits(workingCandidates[n.row][n.col]).some((d) => state.nodeMap.has(nodeKey(n.row, n.col, d)))
      )
    }
    const allExtensions = (state: OptimizeState, primary: PrimaryColor, everyRule3: boolean): DragonMove[] => {
      const side = sideOfPrimary(primary)
      const own = new Map(Array.from(state.nodeMap).filter(([, n]) => sideOf(n.color) === side))
      const cacheKey = `${side}|${colouringSignature(own)}`
      let cached = sideExtensionCache.get(cacheKey)
      if (!cached) {
        const plain: DragonMove[] = []
        const found = new Set<string>()
        for (const move of [
          ...this.extensionRule1Moves(own, board, workingCandidates, primary, Infinity),
          ...this.extensionRule2Moves(own, board, workingCandidates, primary, Infinity),
          ...this.extensionHiddenSingleMoves(own, board, workingCandidates, primary, Infinity),
        ]) {
          const [n] = move.colored
          const key = nodeKey(n.row, n.col, n.digit)
          if (!found.has(key)) {
            found.add(key)
            plain.push(move)
          }
        }
        cached = { plain, rule3: undefined }
        sideExtensionCache.set(cacheKey, cached)
      }
      const moves = cached.plain.filter((move) => usableIn(state, move))
      // Rule 3: with Optimize Dynamic Dragons (everyRule3) every move it can
      // force is a branch; otherwise, as in the default loop, only one, and
      // only when the side has no plain extension.
      if (!dynamic || (!everyRule3 && moves.length > 0)) {
        return moves
      }
      // A fresh simulation for this exact side colouring while the phase's
      // budget lasts (the costliest thing in the search, by far), pooled
      // with every Rule 3 move the state inherited - see rule3Known.
      let fresh: DragonMove[] | undefined
      if (everyRule3) {
        if (cached.rule3All === undefined && everyRule3SimulationsLeft > 0) {
          everyRule3SimulationsLeft--
          cached.rule3All = this.extensionRule3Moves(own, board, workingCandidates, primary, allowedRule3Techniques, aicLimitPerStep, Infinity)
        }
        fresh = cached.rule3All
      } else {
        if (cached.rule3 === undefined && fallbackRule3SimulationsLeft > 0) {
          fallbackRule3SimulationsLeft--
          cached.rule3 = this.findExtensionRule3Move(own, board, workingCandidates, primary, allowedRule3Techniques, aicLimitPerStep)
        }
        fresh = cached.rule3 === undefined ? undefined : cached.rule3 ? [cached.rule3] : []
      }
      const pool = new Map<string, DragonMove>()
      for (const move of [...(fresh ?? []), ...state.rule3Known[side]]) {
        const [n] = move.colored
        const key = nodeKey(n.row, n.col, n.digit)
        if (!pool.has(key)) {
          pool.set(key, move)
        }
      }
      state.rule3Known = { ...state.rule3Known, [side]: Array.from(pool.values()) }
      // A candidate a plain rule also reaches keeps the plain explanation.
      const plainKeys = new Set(moves.map((m) => nodeKey(m.colored[0].row, m.colored[0].col, m.colored[0].digit)))
      for (const [key, move] of pool) {
        if (!plainKeys.has(key) && usableIn(state, move)) {
          moves.push(move)
          if (!everyRule3) {
            break
          }
        }
      }
      return moves
    }

    // Breadth-first over every extension either side could take next, at
    // most maxDepth extensions deep. Null if nothing within reach, or over
    // budget.
    const searchFewerExtensions = (start: OptimizeState, maxDepth: number, everyRule3: boolean): OptimizePhaseResult | null => {
      const sides: PrimaryColor[] = [turnPrimary, oppositePrimary(turnPrimary)]
      const seen = new Set([colouringSignature(start.nodeMap)])
      let frontier = [start]
      let statesTried = 0
      for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
        const next: OptimizeState[] = []
        for (const state of frontier) {
          for (const primary of sides) {
            for (const move of allExtensions(state, primary, everyRule3)) {
              const child = cloneState(state)
              applyExtension(child, move)
              // Interleavings that colour the same candidates reach the same
              // state (settle is a pure function of the colouring), so a
              // repeat is dropped before paying for settle.
              const signature = colouringSignature(child.nodeMap)
              if (seen.has(signature)) {
                continue
              }
              seen.add(signature)
              if (++statesTried > (continuing ? OPTIMIZE_MAX_SEARCH_STATES_LATER_PHASES : OPTIMIZE_MAX_SEARCH_STATES)) {
                return null
              }
              const outcome = settle(child)
              if (outcome.kind === 'extend') {
                next.push(child)
              } else if (outcome.kind !== 'dead-end') {
                return { state: child, outcome, turn: oppositePrimary(primary), extensions: depth }
              }
            }
          }
        }
        frontier = next
      }
      return null
    }

    const runPhase = (start: OptimizeState): OptimizePhaseResult | null => {
      const outcome = settle(start)
      if (outcome.kind !== 'extend') {
        return { state: start, outcome, turn: turnPrimary, extensions: 0 }
      }
      const baseline = runBaseline(cloneState(start))
      if (!baseline) {
        return null
      }
      let best = (baseline.extensions > 1 && searchFewerExtensions(start, baseline.extensions - 1, false)) || baseline
      // Optimize Dynamic Dragons: a second search that also branches on
      // every Rule 3 move, only looking for something shallower than the
      // plain search already found. Run second, not instead: its much wider
      // branching could hit the state budget before the depth the plain
      // search reaches, so on its own it could do worse than plain Optimize;
      // this way it never does, and the depth bound keeps it small.
      if (dynamic && optimizeDynamic && best.extensions > 1) {
        best = searchFewerExtensions(start, best.extensions - 1, true) ?? best
      }
      return best
    }

    let state: OptimizeState = { nodeMap: seedNodeMap, moves: seedMoves, counter: 0, rule3Known: { A: [], B: [] } }
    for (;;) {
      const phase = runPhase(state)
      if (!phase) {
        return continuing ? { moves: state.moves.slice(0, lastEliminationEnd) } : null
      }
      state = phase.state
      turnPrimary = phase.turn
      const { outcome } = phase
      if (outcome.kind === 'final') {
        state.moves.push(...outcome.moves)
        return { moves: state.moves }
      }
      if (outcome.kind === 'solution') {
        state.moves.push(outcome.move)
        return { moves: state.moves }
      }
      if (outcome.kind !== 'elimination') {
        // 'dead-end' (every dragon colour promoted); 'extend' can't reach
        // here - runPhase only returns once a phase has ended.
        return { moves: state.moves.slice(0, lastEliminationEnd) }
      }
      // Exhaustive, not a mass elimination: report it, apply it, and search
      // the next phase from the resulting state.
      state.moves.push(...outcome.moves)
      lastEliminationEnd = state.moves.length
      if (workingCandidates === candidates) {
        workingCandidates = cloneCandidates(candidates)
      }
      for (const move of outcome.moves) {
        for (const { row, col, digit } of move.eliminated) {
          workingCandidates[row][col][digit - 1] = false
        }
      }
      strongLinkGraph = null
      sideExtensionCache = new Map()
      state.rule3Known = { A: [], B: [] }
      fallbackRule3SimulationsLeft = OPTIMIZE_MAX_RULE3_FALLBACK_SIMULATIONS_LATER_PHASES
      everyRule3SimulationsLeft = OPTIMIZE_MAX_RULE3_SIMULATIONS_LATER_PHASES
      continuing = true
    }
  }

  /** After a promotion, checks whether either newly-primary candidate has
   * strong links (conjugate pairs, bivalue cells) reaching cells the
   * original Medusa chain never coloured - see growChainFrom. Returns null
   * if nothing new turns up, so a promotion that doesn't unlock further
   * strong-link colouring doesn't add an empty, pointless step. */
  private findMedusaGrowthMove(
    nodeMap: Map<string, DragonNode>,
    graph: StrongLinkGraph,
    promoted: DragonNode[],
  ): DragonMove | null {
    const known = new Set(Array.from(nodeMap.keys()))
    const added: ColoredCandidate[] = []
    let hasBivalueCellLink = false

    for (const node of promoted) {
      const startColor = node.color as ChainColor
      const result = this.medusaFinder.growChainFromGraph(graph, node, startColor, known)
      for (const candidate of result.added) {
        const key = nodeKey(candidate.row, candidate.col, candidate.digit)
        if (known.has(key)) {
          // Already reached from the other promoted node this same turn.
          continue
        }
        known.add(key)
        added.push(candidate)
      }
      hasBivalueCellLink ||= result.hasBivalueCellLink
    }

    if (added.length === 0) {
      return null
    }

    const blueCount = added.filter((n) => n.color === 'blue').length
    const yellowCount = added.filter((n) => n.color === 'yellow').length
    const parts = []
    if (blueCount > 0) parts.push(`${blueCount} candidate${blueCount === 1 ? '' : 's'} light blue`)
    if (yellowCount > 0) parts.push(`${yellowCount} yellow`)
    return {
      id: '',
      kind: 'medusa-growth',
description: `Medusa extension(s) using promoted Colour(s): ${added
  .map((candidate) => `${candidate.digit}r${candidate.row + 1}c${candidate.col + 1}`)
  .join(', ')}.`,      colored: added,
      eliminated: [],
      solved: [],
    }
  }

  /** Extension Rule 1: assuming a medusa color is true, if exactly one
   * candidate of a digit in some section survives (doesn't see that color
   * elsewhere), it must be the placement under that assumption. Looks at
   * one side only - the caller alternates which side's turn it is, so
   * both sides get extended evenly instead of one running ahead of the
   * other. */
  private findExtensionRule1Move(
    nodeMap: Map<string, DragonNode>,
    board: Board,
    candidates: CandidateGrid,
    primary: PrimaryColor,
  ): DragonMove | null {
    return this.extensionRule1Moves(nodeMap, board, candidates, primary, 1)[0] ?? null
  }

  /** Every Extension Rule 1 move for this side, in scan order, stopping at
   * `limit` - 1 for the default loop (its first hit, exactly as before),
   * Infinity for Optimize Dragons' search, which branches on each of them.
   * A candidate forced through more than one unit is listed once. */
  private extensionRule1Moves(
    nodeMap: Map<string, DragonNode>,
    board: Board,
    candidates: CandidateGrid,
    primary: PrimaryColor,
    limit: number,
  ): DragonMove[] {
    const moves: DragonMove[] = []
    const found = new Set<string>()
    const side = sideOfPrimary(primary)
    // Which cells see a node of this colour, per digit, built once - this
    // runs for every colouring the Optimize search tries and on every step
    // of the default loop, and rescanning the node map for every cell of
    // every unit was most of its cost.
    const seesPrimary = seenByNodes(nodeMap.values(), (n) => n.color === primary)
    for (const unit of sudokuUnits()) {
      for (let digit = 1; digit <= 9; digit++) {
        // Cells of the unit holding the digit, and the ones among them not
        // seeing it in this colour - only whether there are >= 2 of the
        // first and exactly 1 of the second matters.
        let withDigit = 0
        let notSeeingCount = 0
        let r = -1
        let c = -1
        for (const [ur, uc] of unit) {
          if (board[ur][uc] !== 0 || !candidates[ur][uc][digit - 1]) {
            continue
          }
          withDigit++
          if (!seesPrimary[(digit - 1) * 81 + ur * 9 + uc]) {
            notSeeingCount++
            r = ur
            c = uc
          }
        }
        if (withDigit < 2 || notSeeingCount !== 1) {
          continue
        }
        const key = nodeKey(r, c, digit)
        if (nodeMap.has(key) || found.has(key)) {
          continue
        }
        found.add(key)
        const secondary = secondaryForSide(side)
        moves.push({
          id: '',
          kind: 'extension-rule1',
          description: `Assuming ${colorLabel(primary)} is true: ${cellRef(r, c)} would be the only remaining ${digit} in its ${classifyUnitKind(unit)}, so colour it ${colorLabel(secondary)}.`,
          colored: [{ row: r, col: c, digit, color: secondary }],
          eliminated: [],
          solved: [],
        })
        if (moves.length >= limit) {
          return moves
        }
      }
    }
    return moves
  }

  /** Places this side's own already-coloured cells onto a copy of the
   * board (as if that side's assumption had already been solved out) and
   * eliminates their peers accordingly - the hypothetical starting point
   * both the plain hidden-single check and Extension Rule 3's fuller
   * simulation reason from. Returns null if this side has nothing coloured
   * yet to place. */
  private buildHypotheticalBoard(
    nodeMap: Map<string, DragonNode>,
    board: Board,
    candidates: CandidateGrid,
    side: Side,
  ): { hypBoard: Board; hypCandidates: CandidateGrid } | null {
    const sideNodes = Array.from(nodeMap.values()).filter((n) => sideOf(n.color) === side)
    if (sideNodes.length === 0) {
      return null
    }

    const hypBoard = cloneBoard(board)
    const hypCandidates = cloneCandidates(candidates)
    for (const n of sideNodes) {
      hypBoard[n.row][n.col] = n.digit
      hypCandidates[n.row][n.col] = Array(9).fill(false)
    }
    for (const n of sideNodes) {
      SudokuRules.eliminatePeerCandidates(hypCandidates, hypBoard, n.row, n.col, n.digit)
    }
    return { hypBoard, hypCandidates }
  }

  /** A hidden single is ordinary Sudoku logic, not a "dynamic" technique -
   * unlike locked candidates, naked pairs/triples/quads, and Unique
   * Rectangles (which only make sense once a side's assumption has been
   * propagated through other techniques), a hidden single follows directly
   * from placing this side's own already-coloured cells and eliminating
   * their peers, with nothing else needed. So it's checked here, as part
   * of plain Dragon Colouring's normal extension - alongside Rules 1 and
   * 2 - rather than gated behind `dynamic`. A chain that only ever needs
   * this (and Rules 1-2) is exactly as "plain" as one that never uses it
   * at all. */
  private findExtensionHiddenSingleMove(
    nodeMap: Map<string, DragonNode>,
    board: Board,
    candidates: CandidateGrid,
    primary: PrimaryColor,
  ): DragonMove | null {
    return this.extensionHiddenSingleMoves(nodeMap, board, candidates, primary, 1)[0] ?? null
  }

  /** Every hidden-single extension for this side, in scan order, up to
   * `limit` - see extensionRule1Moves. */
  private extensionHiddenSingleMoves(
    nodeMap: Map<string, DragonNode>,
    board: Board,
    candidates: CandidateGrid,
    primary: PrimaryColor,
    limit: number,
  ): DragonMove[] {
    const side = sideOfPrimary(primary)
    const secondary = secondaryForSide(side)
    const hypothetical = this.buildHypotheticalBoard(nodeMap, board, candidates, side)
    if (!hypothetical) {
      return []
    }
    return this.findNewlyHiddenSingleCells(hypothetical.hypBoard, hypothetical.hypCandidates, nodeMap, limit).map(
      (hiddenSingle) => ({
        id: '',
        kind: 'extension-hidden-single',
        description: `Assuming ${colorLabel(primary)} is true, then we have ${this.hiddenSingleClause(secondary, hiddenSingle)}.`,
        colored: [{ row: hiddenSingle.row, col: hiddenSingle.col, digit: hiddenSingle.digit, color: secondary }],
        eliminated: [],
        solved: [],
      }),
    )
  }

  /** Extension Rule 2: assuming a medusa color (or its dragon color) is
   * true, if exactly one candidate survives in an otherwise-uncolored cell,
   * it must be that cell's placement under the assumption. Looks at one
   * side only, same reason as Extension Rule 1 above. */
  private findExtensionRule2Move(
    nodeMap: Map<string, DragonNode>,
    board: Board,
    candidates: CandidateGrid,
    primary: PrimaryColor,
  ): DragonMove | null {
    return this.extensionRule2Moves(nodeMap, board, candidates, primary, 1)[0] ?? null
  }

  /** Every Extension Rule 2 move for this side, in scan order, up to
   * `limit` - see extensionRule1Moves. */
  private extensionRule2Moves(
    nodeMap: Map<string, DragonNode>,
    board: Board,
    candidates: CandidateGrid,
    primary: PrimaryColor,
    limit: number,
  ): DragonMove[] {
    const moves: DragonMove[] = []
    const side = sideOfPrimary(primary)
    // See extensionRule1Moves - the same table, for the whole side.
    const seesSide = seenByNodes(nodeMap.values(), (n) => sideOf(n.color) === side)
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        const digits = markedCandidateDigits(candidates[row][col])
        if (digits.length === 0 || digits.some((d) => nodeMap.has(nodeKey(row, col, d)))) {
          continue
        }
        const survivors = digits.filter((d) => !seesSide[(d - 1) * 81 + row * 9 + col])
        if (survivors.length !== 1) {
          continue
        }
        const digit = survivors[0]
        const secondary = secondaryForSide(side)
        moves.push({
          id: '',
          kind: 'extension-rule2',
          description: `Assuming ${colorLabel(primary)} is true eliminates every other candidate from ${cellRef(row, col)}, leaving only ${digit} - colour it ${colorLabel(secondary)}.`,
          colored: [{ row, col, digit, color: secondary }],
          eliminated: [],
          solved: [],
        })
        if (moves.length >= limit) {
          return moves
        }
      }
    }
    return moves
  }

  /** Extension Rule 3 (Dynamic Dragon Colouring only): Rules 1-2, and the
   * plain hidden-single check, only ever find something directly visible
   * from placing this side's own coloured cells and eliminating their
   * peers once. This rule reaches further: it keeps that same hypothetical
   * board going and, on every iteration, checked in this order (easiest
   * first) - looks for a *newly* available hidden single, then tries
   * locked candidates, naked pairs, naked triples, naked quads, and Unique
   * Rectangle Type 1 - this app's other implemented non-colouring
   * techniques - against that hypothetical board, one application at a
   * time, until one of them either directly forces a cell (a hidden
   * single, or a Type 1 Unique Rectangle with a single extra candidate) or
   * narrows some cell down to its last candidate. That one becomes this
   * call's move.
   *
   * The hidden-single check here exists only to catch one that *only*
   * becomes available after some genuinely dynamic technique (locked
   * candidate, naked pair/triple/quad, UR) narrows things first - the
   * caller (`extend`) already tried a plain hidden single, with nothing
   * else propagated, before ever calling this method, so finding one again
   * here always means some antecedent made it possible. Checking it first
   * on every iteration still matters: a more complex technique can
   * independently reach the very same conclusion (e.g. a naked quad's own
   * elimination can happen to leave a cell down to its last candidate,
   * when a hidden single already justified colouring that same candidate
   * more simply) - without checking the simplest technique first, the more
   * roundabout explanation would win the race and get reported instead.
   * Either way, a resulting "hidden single" is never itself credited as
   * the reason this chain needed Dynamic Dragon Colouring - see the
   * dynamicTechniques field.
   *
   * Sometimes the technique that actually does the forcing only applies
   * because an *earlier* application (of a different technique) narrowed
   * one of its own basis cells first (e.g. a naked quad frees up a cell
   * just enough for a naked triple to then apply there) - so rather than
   * silently presupposing that earlier step, its own "we have a ..." is
   * folded into the SAME move's description, chained with "which reveals".
   * Only technique applications the final one actually depended on (traced
   * backward through which cells each application touched, transitively)
   * are included - an application that happened along the way but never
   * affected any cell the final technique's basis or dependencies rest on
   * is exactly as irrelevant to this conclusion as one that never ran at
   * all, so it's left out. A chain that never reaches a forcing conclusion
   * is discarded entirely (returns null), the same as if nothing had been
   * found. */
  private findExtensionRule3Move(
    nodeMap: Map<string, DragonNode>,
    board: Board,
    candidates: CandidateGrid,
    primary: PrimaryColor,
    allowedTechniques: ReadonlySet<Rule3Technique>,
    aicLimitPerStep: boolean,
  ): DragonMove | null {
    return this.extensionRule3Moves(nodeMap, board, candidates, primary, allowedTechniques, aicLimitPerStep, 1)[0] ?? null
  }

  /** Every Extension Rule 3 move for this side, up to `limit`. With
   * `limit` 1 this is exactly findExtensionRule3Move's old behaviour: the
   * simulation stops at the first candidate it forces. Otherwise
   * (Optimize Dynamic Dragons) it records that candidate and keeps
   * simulating - the forced candidate is left unplaced, and skipped by the
   * "newly forced" checks from then on - so every candidate the simulation
   * reaches becomes its own move, each explained by only the steps it
   * depended on (buildRule3CombinedMove prunes the rest). The AIC limit
   * covers the whole simulation, so no move ever leans on more than it. */
  private extensionRule3Moves(
    nodeMap: Map<string, DragonNode>,
    board: Board,
    candidates: CandidateGrid,
    primary: PrimaryColor,
    allowedTechniques: ReadonlySet<Rule3Technique>,
    aicLimitPerStep: boolean,
    limit: number,
  ): DragonMove[] {
    const moves: DragonMove[] = []
    // nodeMap plus every candidate already reported this call - what the
    // "newly forced" checks skip.
    const known = new Map(nodeMap)
    /** Records a move; true once `limit` is reached (stop simulating).
     * Never one for a candidate that's already coloured, by either side -
     * the same rule every other extension path follows. The direct-solve
     * branches (UR Type 1, BUG+1, Oddagon Type 1) used to return such a move
     * anyway, recolouring the other side's dragon node (e.g. orange ->
     * dark blue): that side silently lost a candidate it implied, and the
     * per-side "found nothing" memo, which assumes a side's nodes only grow,
     * could go stale. Now they're skipped and the simulation carries on. */
    const emit = (move: DragonMove): boolean => {
      const [n] = move.colored
      const key = nodeKey(n.row, n.col, n.digit)
      if (known.has(key)) {
        return false
      }
      known.set(key, n)
      moves.push(move)
      return moves.length >= limit
    }
    const side = sideOfPrimary(primary)
    const secondary = secondaryForSide(side)
    const hypothetical = this.buildHypotheticalBoard(nodeMap, board, candidates, side)
    if (!hypothetical) {
      return moves
    }
    const { hypBoard, hypCandidates } = hypothetical

    const steps: Rule3ChainStep[] = []
    // Counts every AIC application actually tried during this simulation
    // (antecedent or final), not just the ones that end up relevant to the
    // final conclusion - simpler to reason about, and "used" is a fair
    // reading of "used once within a step" either way.
    let aicStepsUsed = 0

    // Collecting every move: how many more times the AIC search may run
    // (see MAX_RULE3_ENUMERATION_AIC_SEARCHES). Unlimited for one move.
    let aicSearchesLeft = limit === 1 ? Infinity : MAX_RULE3_ENUMERATION_AIC_SEARCHES
    for (let step = 0; step < MAX_RULE3_SIMULATION_STEPS; step++) {
      let appliedSomething = false
      const grid = gridKey(hypBoard, hypCandidates)

      if (allowedTechniques.has('hidden single')) {
        for (const hiddenSingle of this.findNewlyHiddenSingleCells(hypBoard, hypCandidates, known, limit - moves.length)) {
          // Never its own technique substep (see DragonRule3Substep) - the
          // closing "As a result, ..." substep states the hidden single.
          const move = this.buildRule3CombinedMove(
            primary,
            steps,
            {
              technique: 'hidden single',
              basisCells: [[hiddenSingle.row, hiddenSingle.col]],
              affectedCells: [],
              eliminatedCandidates: [],
              clause: '',
              summaryName: '',
            },
            { row: hiddenSingle.row, col: hiddenSingle.col, digit: hiddenSingle.digit, color: secondary },
            { kind: 'hidden single', unitKind: hiddenSingle.unitKind },
            hiddenSingle.unit,
          )
          if (emit(move)) {
            return moves
          }
        }
      }

      if (allowedTechniques.has('locked candidate')) {
        for (const locked of this.memoFind('locked', grid, () => this.lockedCandidateFinder.findInstances(hypBoard, hypCandidates))) {
          if (locked.eliminations.length === 0) {
            continue
          }
          for (const { row, col, digit } of locked.eliminations) {
            hypCandidates[row][col][digit - 1] = false
          }
          const chainStep: Rule3ChainStep = {
            technique: 'locked candidate',
            basisCells: locked.basisCells,
            affectedCells: uniqueCells(locked.eliminations),
            eliminatedCandidates: locked.eliminations,
            clause: this.lockedCandidateClause(locked),
            summaryName: `a Locked Candidate (${locked.type === 'pointing' ? 'Pointing' : 'Claiming'})`,
          }
          if (
            this.emitForcedCells(hypBoard, hypCandidates, known, (forced) =>
              emit(this.buildRule3CombinedMove(primary, steps, chainStep, { ...forced, color: secondary }, { kind: 'single candidate' })),
            )
          ) {
            return moves
          }
          steps.push(chainStep)
          appliedSomething = true
          break
        }
      }
      if (appliedSomething) {
        continue
      }

      // No allowedTechniques.has('naked pair') gate here - extend() always
      // adds 'naked pair' back to the set, so it can never be excluded.
      for (const pair of this.memoFind('pair', grid, () => this.pairFinder.findNakedPairs(hypBoard, hypCandidates))) {
        if (pair.eliminations.length === 0) {
          continue
        }
        for (const { row, col, digit } of pair.eliminations) {
          hypCandidates[row][col][digit - 1] = false
        }
        const chainStep: Rule3ChainStep = {
          technique: 'naked pair',
          basisCells: pair.cells,
          affectedCells: uniqueCells(pair.eliminations),
          eliminatedCandidates: pair.eliminations,
          clause: this.nakedPairClause(pair),
          summaryName: 'a naked pair',
        }
        if (
          this.emitForcedCells(hypBoard, hypCandidates, known, (forced) =>
            emit(this.buildRule3CombinedMove(primary, steps, chainStep, { ...forced, color: secondary }, { kind: 'single candidate' })),
          )
        ) {
          return moves
        }
        steps.push(chainStep)
        appliedSomething = true
        break
      }
      if (appliedSomething) {
        continue
      }

      // Triples and quads are found together (findNakedTriplesAndQuads
      // shares its per-unit scan between the two sizes instead of each
      // redoing it), but still applied in the same order as before - all
      // triples get first refusal, quads are only tried once no triple
      // eliminates anything.
      const needsTriple = allowedTechniques.has('naked triple')
      const needsQuad = allowedTechniques.has('naked quad')
      const { triples, quads } = needsTriple || needsQuad
        ? this.memoFind('subset', grid, () => this.nakedSubsetFinder.findNakedTriplesAndQuads(hypBoard, hypCandidates))
        : { triples: [], quads: [] }

      for (const [technique, subsets] of [
        ['naked triple', needsTriple ? triples : []],
        ['naked quad', needsQuad ? quads : []],
      ] as const) {
        for (const subset of subsets) {
          if (subset.eliminations.length === 0) {
            continue
          }
          for (const { row, col, digit } of subset.eliminations) {
            hypCandidates[row][col][digit - 1] = false
          }
          const chainStep: Rule3ChainStep = {
            technique,
            basisCells: subset.cells,
            affectedCells: uniqueCells(subset.eliminations),
            eliminatedCandidates: subset.eliminations,
            clause: this.nakedSubsetClause(subset),
            summaryName: technique === 'naked triple' ? 'a naked triple' : 'a naked quad',
          }
          if (
            this.emitForcedCells(hypBoard, hypCandidates, known, (forced) =>
              emit(this.buildRule3CombinedMove(primary, steps, chainStep, { ...forced, color: secondary }, { kind: 'single candidate' })),
            )
          ) {
            return moves
          }
          steps.push(chainStep)
          appliedSomething = true
          break
        }
        if (appliedSomething) {
          break
        }
      }
      if (appliedSomething) {
        continue
      }

      if (allowedTechniques.has('hidden pair')) {
        for (const pair of this.memoFind('hiddenPair', grid, () => this.hiddenPairFinder.findHiddenPairs(hypBoard, hypCandidates))) {
          if (pair.eliminations.length === 0) {
            continue
          }
          for (const { row, col, digit } of pair.eliminations) {
            hypCandidates[row][col][digit - 1] = false
          }
          const chainStep: Rule3ChainStep = {
            technique: 'hidden pair',
            basisCells: pair.cells,
            affectedCells: uniqueCells(pair.eliminations),
            eliminatedCandidates: pair.eliminations,
            clause: this.hiddenPairClause(pair),
            summaryName: 'a hidden pair',
          }
          if (
            this.emitForcedCells(hypBoard, hypCandidates, known, (forced) =>
              emit(this.buildRule3CombinedMove(primary, steps, chainStep, { ...forced, color: secondary }, { kind: 'single candidate' })),
            )
          ) {
            return moves
          }
          steps.push(chainStep)
          appliedSomething = true
          break
        }
      }
      if (appliedSomething) {
        continue
      }

      if (allowedTechniques.has('UR')) {
        for (const ur of this.memoFind('ur', grid, () => this.uniqueRectangleFinder.find(hypBoard, hypCandidates))) {
          const summaryName = `a Unique Rectangle (${ur.type})`
          if (ur.solvedCandidates.length > 0) {
            // The Unique Rectangle's own conclusion *is* the move (Type 1's
            // single-extra-candidate case only) - no need to also check for
            // a newly-single-candidate cell, and no reason to keep
            // simulating past it first.
            const move = this.buildRule3CombinedMove(
              primary,
              steps,
              {
                technique: 'UR',
                basisCells: ur.cells,
                affectedCells: [],
                eliminatedCandidates: [],
                clause: ur.reasonText,
                summaryName,
              },
              { ...ur.solvedCandidates[0], color: secondary },
              { kind: 'direct' },
            )
            if (emit(move)) {
              return moves
            }
            continue
          }
          if (ur.eliminatedCandidates.length > 0) {
            for (const { row, col, digit } of ur.eliminatedCandidates) {
              hypCandidates[row][col][digit - 1] = false
            }
            const chainStep: Rule3ChainStep = {
              technique: 'UR',
              basisCells: ur.cells,
              affectedCells: uniqueCells(ur.eliminatedCandidates),
              eliminatedCandidates: ur.eliminatedCandidates,
              clause: this.uniqueRectangleClause(ur),
              summaryName,
            }
            if (
              this.emitForcedCells(hypBoard, hypCandidates, known, (forced) =>
                emit(this.buildRule3CombinedMove(primary, steps, chainStep, { ...forced, color: secondary }, { kind: 'single candidate' })),
              )
            ) {
              return moves
            }
            steps.push(chainStep)
            appliedSomething = true
            break
          }
        }
      }
      if (appliedSomething) {
        continue
      }

      if (allowedTechniques.has('bug plus one')) {
        // Never a mid-chain antecedent - a BUG+1 is either the whole
        // grid's one escape-hatch cell (and directly forces its own
        // solution) or it doesn't apply at all, unlike every other
        // technique here which can also just narrow things down.
        const bugPlusOne = this.memoFind('bug', grid, () => this.bugPlusOneFinder.find(hypBoard, hypCandidates))
        if (bugPlusOne) {
          const move = this.buildRule3CombinedMove(
            primary,
            steps,
            {
              technique: 'bug plus one',
              basisCells: [bugPlusOne.cell],
              affectedCells: [],
              eliminatedCandidates: [],
              clause: this.bugPlusOneClause(bugPlusOne),
              summaryName: 'a BUG+1',
            },
            { row: bugPlusOne.cell[0], col: bugPlusOne.cell[1], digit: bugPlusOne.solvedDigit, color: secondary },
            { kind: 'direct' },
          )
          if (emit(move)) {
            return moves
          }
        }
      }

      if (allowedTechniques.has('bivalue oddagon')) {
        for (const oddagon of this.memoFind('oddagon', grid, () => this.bivalueOddagonFinder.find(hypBoard, hypCandidates))) {
          const summaryName = `a Bivalue Oddagon (Type ${oddagon.type})`
          if (oddagon.solvedCell) {
            const move = this.buildRule3CombinedMove(
              primary,
              steps,
              {
                technique: 'bivalue oddagon',
                basisCells: oddagon.cells,
                affectedCells: [],
                eliminatedCandidates: [],
                clause: this.bivalueOddagonSolveClause(oddagon),
                summaryName,
              },
              { row: oddagon.solvedCell[0], col: oddagon.solvedCell[1], digit: oddagon.guardianDigit, color: secondary },
              { kind: 'direct' },
            )
            if (emit(move)) {
              return moves
            }
            continue
          }
          if (oddagon.eliminations.length > 0) {
            for (const { row, col, digit } of oddagon.eliminations) {
              hypCandidates[row][col][digit - 1] = false
            }
            const chainStep: Rule3ChainStep = {
              technique: 'bivalue oddagon',
              basisCells: oddagon.cells,
              affectedCells: uniqueCells(oddagon.eliminations),
              eliminatedCandidates: oddagon.eliminations,
              clause: this.bivalueOddagonEliminationClause(oddagon),
              summaryName,
            }
            if (
              this.emitForcedCells(hypBoard, hypCandidates, known, (forced) =>
                emit(this.buildRule3CombinedMove(primary, steps, chainStep, { ...forced, color: secondary }, { kind: 'single candidate' })),
              )
            ) {
              return moves
            }
            steps.push(chainStep)
            appliedSomething = true
            break
          }
        }
      }
      if (appliedSomething) {
        continue
      }

      // AIC chains, shortest kind first: single-digit, then short, then
      // generic. The generic search only runs when nothing shorter applied
      // (it's a generator, so it's never started otherwise), and not at
      // all once the per-step AIC limit is used up.
      if (!(aicLimitPerStep && aicStepsUsed >= 1) && aicSearchesLeft-- > 0) {
        // Built at most once and handed to both finders - short and generic
        // AIC otherwise each rebuild the identical link graph for the same
        // hypBoard/hypCandidates, and with the per-step limit off this whole
        // block can run dozens of times per chain. Only built when a finder's
        // result isn't already cached (see memoFind).
        let sharedGraph: LinkGraphs | undefined
        const graph = () => (sharedGraph ??= buildLinkGraphs(hypBoard, hypCandidates))
        const aicsInOrder = function* (finder: SudokuDragonFinder): Generator<{ aic: ShortAicInstance; technique: AicTechnique }> {
          if (allowedTechniques.has('short single-digit aic') || allowedTechniques.has('short aic')) {
            for (const aic of finder.memoFind('shortAic', grid, () => finder.shortAicFinder.findShortAics(hypBoard, hypCandidates, graph()))) {
              yield { aic, technique: classifyShortAic(aic) === 'single-digit' ? 'short single-digit aic' : 'short aic' }
            }
          }
          if (allowedTechniques.has('generic aic')) {
            for (const aic of finder.memoFind('genericAic', grid, () => finder.genericAicFinder.findGenericAics(hypBoard, hypCandidates, undefined, graph()))) {
              yield { aic, technique: 'generic aic' }
            }
          }
        }
        for (const { aic, technique } of aicsInOrder(this)) {
          if (!allowedTechniques.has(technique)) {
            continue
          }

          for (const { row, col, digit } of aic.eliminations) {
            hypCandidates[row][col][digit - 1] = false
          }
          aicStepsUsed++
          const chainStep: Rule3ChainStep = {
            technique,
            basisCells: aic.nodes.map((n) => [n.row, n.col] as const),
            affectedCells: uniqueCells(aic.eliminations),
            eliminatedCandidates: aic.eliminations,
            clause: this.aicClause(aic, technique),
            summaryName: `a ${this.aicLabel(technique)} (Type ${aic.eliminationType})`,
            aic,
          }
          if (
            this.emitForcedCells(hypBoard, hypCandidates, known, (forced) =>
              emit(this.buildRule3CombinedMove(primary, steps, chainStep, { ...forced, color: secondary }, { kind: 'single candidate' })),
            )
          ) {
            return moves
          }
          steps.push(chainStep)
          appliedSomething = true
          break
        }
      }
      if (appliedSomething) {
        continue
      }

      // Nothing more applies - whatever's accumulated in `steps` that
      // never led anywhere actionable is discarded rather than surfaced.
      return moves
    }

    // Exceeded the safety cap without getting stuck - keep what was found
    // (always nothing when `limit` is 1, which returns at its first find),
    // rather than risk an unbounded simulation.
    return moves
  }

  /** After a Rule 3 step: hands every uncoloured, not-yet-reported cell the
   * step left with a single candidate to `record` (just the first when
   * only one move is wanted - `record` returns true to stop), returning
   * whether `record` asked to stop. */
  private emitForcedCells(
    hypBoard: Board,
    hypCandidates: CandidateGrid,
    known: Map<string, DragonNode>,
    record: (forced: { row: number; col: number; digit: number }) => boolean,
  ): boolean {
    for (let forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, known); forced; ) {
      if (record(forced)) {
        return true
      }
      // record() added it to `known` (or it already was), so the next
      // scan moves past it.
      forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, known)
    }
    return false
  }

  /** Walks `steps` (in the order they were applied) backward from the
   * final technique's own basis cells, keeping only the ones that actually
   * narrowed a cell the final technique - or an already-kept earlier step -
   * depends on. Growing the dependency set as it walks backward is what
   * catches transitive chains (an antecedent's antecedent). The result
   * keeps the original chronological order, since that's the order the
   * reasoning actually happened in. */
  private selectRelevantChainSteps(
    steps: Rule3ChainStep[],
    finalBasisCells: readonly (readonly [number, number])[],
  ): Rule3ChainStep[] {
    const dependsOn = new Set(finalBasisCells.map(([r, c]) => cellKey(r, c)))
    const relevant: Rule3ChainStep[] = []
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i]
      const touchesDependency = step.affectedCells.some(([r, c]) => dependsOn.has(cellKey(r, c)))
      if (!touchesDependency) {
        continue
      }
      relevant.unshift(step)
      for (const [r, c] of step.basisCells) {
        dependsOn.add(cellKey(r, c))
      }
    }
    return relevant
  }

  /** `final` is the technique that forced `colored`, in the same shape an
   * antecedent is recorded in. `dependencyCells` is what dependency-
   * tracking checks prior steps against - defaults to `final.basisCells`,
   * but a hidden single's real dependency is its whole unit (see
   * findNewlyHiddenSingleCells), not just the one cell it resolves, so that
   * case passes the unit's 9 cells here instead while still highlighting
   * only the resolved cell. */
  private buildRule3CombinedMove(
    primary: PrimaryColor,
    steps: Rule3ChainStep[],
    final: Rule3ChainStep,
    colored: DragonNode,
    conclusion: Rule3Conclusion,
    dependencyCells: readonly (readonly [number, number])[] = final.basisCells,
  ): DragonMove {
    const antecedents = this.selectRelevantChainSteps(steps, dependencyCells)
    // 'hidden single' is never labeled - see the dynamicTechniques doc
    // comment on DragonMove. It can still show up as the final technique
    // here (a hidden single that only emerged mid-chain, after some
    // genuinely dynamic antecedent), but only that antecedent is what made
    // this chain need Dynamic Dragon Colouring in the first place. Substeps
    // exclude it the same way, for the same reason - see
    // DragonRule3Substep - and the closing extension substep states it.
    const techniqueSteps = [...antecedents, final].filter(
      (s): s is Rule3ChainStep & { technique: Exclude<Rule3Technique, 'hidden single'> } =>
        s.technique !== 'hidden single',
    )
    const toAicChain = (aic: ShortAicInstance) => ({
      candidates: aic.nodes.map((n) => ({ row: n.row, col: n.col, digit: n.digit })),
      links: aic.links.map((link) => ({
        from: { row: link.from.row, col: link.from.col, digit: link.from.digit },
        to: { row: link.to.row, col: link.to.col, digit: link.to.digit },
        kind: link.kind,
      })),
    })
    const aicInstances = techniqueSteps.map((s) => s.aic).filter((aic): aic is ShortAicInstance => !!aic)
    const aicChains =
      aicInstances.length > 0
        ? aicInstances.map((aic) => ({
            ...toAicChain(aic),
            hypotheticalEliminations: aic.eliminations.map((e) => ({ row: e.row, col: e.col, digit: e.digit })),
          }))
        : undefined
    const extensionClause = this.rule3ExtensionClause(colored, conclusion)
    const substeps: DragonRule3Substep[] = [
      ...techniqueSteps.map((s) => ({
        technique: s.technique,
        clause: s.clause,
        basisCells: s.basisCells,
        eliminatedCandidates: s.eliminatedCandidates,
        aic: s.aic ? toAicChain(s.aic) : undefined,
      })),
      {
        technique: 'dragon colour extension',
        clause: extensionClause,
        basisCells: [[colored.row, colored.col]],
        eliminatedCandidates: [],
      },
    ]
    // The one-line description only names the techniques; each one's own
    // detail (basis cells, eliminations) lives in its substep. Zero named
    // techniques is only possible for a hidden single with no antecedent,
    // which findExtensionRule3Move's doc comment proves can't happen (a
    // plain hidden single is always ruled out by extend()'s own always-on
    // check before Rule 3 ever runs) - worded sensibly anyway rather than
    // relying on that invariant never changing.
    const techniquesText =
      techniqueSteps.length > 0 ? `, then we have ${techniqueSteps.map((s) => s.summaryName).join(', which reveals ')}` : ''
    return {
      id: '',
      kind: 'extension-rule3',
      dynamicTechniques: techniqueSteps.map((s) => s.technique),
      dynamicTechniqueCells: [...antecedents.flatMap((s) => s.basisCells), ...final.basisCells],
      description: `Assuming ${colorLabel(primary)} is true${techniquesText}. ${extensionClause}.`,
      colored: [colored],
      eliminated: [],
      solved: [],
      aicChains,
      substeps,
    }
  }

  /** The closing "As a result, ..." substep of every Extension Rule 3 move:
   * the colouring itself, kept apart from the technique that forced it so
   * the substep player shows the technique's own work first and the new
   * dragon colour after it. */
  private rule3ExtensionClause(colored: DragonNode, conclusion: Rule3Conclusion): string {
    const cell = cellRef(colored.row, colored.col)
    const colouring = `so colour ${colored.digit}${cell} ${colorLabel(colored.color)}`
    switch (conclusion.kind) {
      case 'single candidate':
        return `As a result, ${cell} will only have 1 option (${colored.digit}), ${colouring}`
      case 'hidden single':
        return `As a result, ${cell} is the only place left for ${colored.digit} in its ${conclusion.unitKind}, ${colouring}`
      case 'direct':
        return `As a result, ${cell} must be ${colored.digit}, ${colouring}`
    }
  }

  /** Any uncoloured cell the hypothetical simulation has narrowed to
   * exactly one remaining candidate - the thing both Extension Rule 3's
   * naked-pair and elimination-only-Unique-Rectangle branches are looking
   * for after applying their own step. */
  private findNewlySingleCandidateCell(
    hypBoard: Board,
    hypCandidates: CandidateGrid,
    nodeMap: Map<string, DragonNode>,
  ): { row: number; col: number; digit: number } | null {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (hypBoard[row][col] !== 0) {
          continue
        }
        const digits = markedCandidateDigits(hypCandidates[row][col])
        if (digits.length !== 1) {
          continue
        }
        const digit = digits[0]
        if (nodeMap.has(nodeKey(row, col, digit))) {
          continue
        }
        return { row, col, digit }
      }
    }
    return null
  }

  /** A hidden single anywhere in the hypothetical simulation - a digit
   * that's a candidate in only one cell of some row, column, or box, even
   * though that cell may still show other candidates too. Checked before
   * any elimination-only technique on every iteration, since it needs
   * nothing beyond the current candidate marks to be a valid, standalone
   * conclusion - simulating a more complex technique to reach a cell a
   * hidden single already resolves would misrepresent the reasoning.
   *
   * Every such hidden single, in scan order, up to `limit` - see
   * extensionRule1Moves. A candidate that's a hidden single in more than one
   * unit is listed once, with the first unit found. */
  private findNewlyHiddenSingleCells(
    hypBoard: Board,
    hypCandidates: CandidateGrid,
    nodeMap: Map<string, DragonNode>,
    limit: number,
  ): HiddenSingleFind[] {
    const finds: HiddenSingleFind[] = []
    const found = new Set<string>()
    for (const unit of sudokuUnits()) {
      for (let digit = 1; digit <= 9; digit++) {
        // Count without building a list - this runs on every simulated step.
        let count = 0
        let row = -1
        let col = -1
        for (const [r, c] of unit) {
          if (hypBoard[r][c] === 0 && hypCandidates[r][c][digit - 1]) {
            if (++count > 1) {
              break
            }
            row = r
            col = c
          }
        }
        if (count !== 1) {
          continue
        }
        const key = nodeKey(row, col, digit)
        if (nodeMap.has(key) || found.has(key)) {
          continue
        }
        found.add(key)
        finds.push({ row, col, digit, unitKind: classifyUnitKind(unit), unit })
        if (finds.length >= limit) {
          return finds
        }
      }
    }
    return finds
  }

  // --- Extension Rule 3 technique clauses: "a TECHNIQUE of DIGITS in
  // {CELLS}, which eliminates ..." - one per substep, the same whether the
  // technique turns out an antecedent or the final one. No "Assuming ...
  // is true" and no "so colour it ..." - the move's description and its
  // closing extension substep (rule3ExtensionClause) carry those.

  private lockedCandidateClause(instance: LockedCandidateInstance): string {
    const typeLabel = instance.type === 'pointing' ? 'Pointing' : 'Claiming'
    const basisLabel = instance.basisCells.map(([r, c]) => cellRef(r, c)).join(', ')
    const eliminationsLabel = this.formatCandidateGroups(instance.eliminations)
    return `a Locked Candidate (${typeLabel}) for ${instance.digit} in {${basisLabel}}, which eliminates ${eliminationsLabel}`
  }

  private nakedPairClause(pair: NakedPairInstance): string {
    const [a, b] = pair.digits
    const cellsLabel = pair.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    const eliminationsLabel = this.formatCandidateGroups(pair.eliminations)
    return `a naked pair of {${a},${b}} in {${cellsLabel}}, which eliminates ${eliminationsLabel}`
  }

  private nakedSubsetClause(subset: NakedSubsetInstance): string {
    const sizeWord = subset.size === 3 ? 'triple' : 'quad'
    const cellsLabel = subset.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    const digitsLabel = subset.digits.join(',')
    const eliminationsLabel = this.formatCandidateGroups(subset.eliminations)
    return `a naked ${sizeWord} of {${digitsLabel}} in {${cellsLabel}}, which eliminates ${eliminationsLabel}`
  }

  private hiddenPairClause(pair: HiddenPairInstance): string {
    const [a, b] = pair.digits
    const cellsLabel = pair.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    const eliminationsLabel = this.formatCandidateGroups(pair.eliminations)
    return `a hidden pair of {${a},${b}} in {${cellsLabel}}, which eliminates ${eliminationsLabel}`
  }

  private uniqueRectangleClause(ur: UniqueRectangleInstance): string {
    const eliminationsLabel = this.formatCandidateGroups(ur.eliminatedCandidates)
    return `${ur.reasonText}, which eliminates ${eliminationsLabel}`
  }

  private bugPlusOneClause(bug: BugPlusOneInstance): string {
    const [row, col] = bug.cell
    return `a BUG+1 at ${cellRef(row, col)} (candidates {${bug.candidates.join(',')}}), where ${bug.solvedDigit} appears three times in its ${bug.unitKind}`
  }

  private bivalueOddagonClauseIntro(oddagon: BivalueOddagonInstance): string {
    const [a, b] = oddagon.loopDigits
    const cellsLabel = oddagon.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    return `a ${oddagon.cells.length}-cell Bivalue Oddagon of {${a},${b}} at ${cellsLabel}`
  }

  private bivalueOddagonSolveClause(oddagon: BivalueOddagonInstance): string {
    const [row, col] = oddagon.solvedCell!
    return `${this.bivalueOddagonClauseIntro(oddagon)}, whose only guardian is ${oddagon.guardianDigit}${cellRef(row, col)}`
  }

  private bivalueOddagonEliminationClause(oddagon: BivalueOddagonInstance): string {
    const eliminationsLabel = this.formatCandidateGroups(oddagon.eliminations)
    return `${this.bivalueOddagonClauseIntro(oddagon)}, which eliminates ${eliminationsLabel}`
  }

  private formatAicChainText(aic: ShortAicInstance): string {
    return aic.nodes
      .map((n, i) => {
        const connector = i === 0 ? '' : i % 2 === 1 ? ' = ' : ' - '
        return `${connector}${n.digit}${cellRef(n.row, n.col)}`
      })
      .join('')
  }

  private aicLabel(technique: AicTechnique): string {
    return technique === 'short single-digit aic'
      ? 'short single-digit AIC'
      : technique === 'generic aic'
        ? 'generic AIC'
        : 'short AIC'
  }

  private aicClause(aic: ShortAicInstance, technique: AicTechnique): string {
    const eliminationsLabel = this.formatCandidateGroups(aic.eliminations)
    return `a ${this.aicLabel(technique)} (Type ${aic.eliminationType}) of ${this.formatAicChainText(aic)}, which eliminates ${eliminationsLabel}`
  }

  /** The plain (always-on) hidden-single extension's whole explanation -
   * see findExtensionHiddenSingleMove. Extension Rule 3's own hidden
   * single is worded by rule3ExtensionClause instead. */
  private hiddenSingleClause(
    secondary: DragonColor,
    cell: { row: number; col: number; digit: number; unitKind: 'row' | 'column' | 'box' },
  ): string {
    return `a hidden single at ${cellRef(cell.row, cell.col)}, since ${cell.digit} has nowhere else to go in its ${cell.unitKind}, so colour it ${colorLabel(secondary)}`
  }

  /** Formats a set of candidate eliminations as compact "digitscellref"
   * groups (e.g. "23r1c7"), one per affected cell, matching how a
   * solving guide would write it. */
  private formatCandidateGroups(eliminations: { row: number; col: number; digit: number }[]): string {
    const byCell = new Map<string, number[]>()
    for (const { row, col, digit } of eliminations) {
      const key = cellKey(row, col)
      const digits = byCell.get(key) ?? []
      digits.push(digit)
      byCell.set(key, digits)
    }
    return Array.from(byCell.entries())
      .map(([key, digits]) => {
        const [row, col] = key.split(',').map(Number)
        return `${[...digits].sort((x, y) => x - y).join('')}${cellRef(row, col)}`
      })
      .join(', ')
  }

  /** Promotion: an opposite-side pair of the same candidate seeing each
   * other, or an opposite-side pair sharing a cell, each prove the other's
   * side always holds exactly when their own does - so both can drop the
   * "conditional on" and become their side's medusa color outright. */
  private findPromotionMove(nodeMap: Map<string, DragonNode>): DragonMove | null {
    const nodes = Array.from(nodeMap.values())

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        if (a.digit !== b.digit || sideOf(a.color) === sideOf(b.color)) {
          continue
        }
        if (isPrimary(a.color) && isPrimary(b.color)) {
          continue
        }
        if (!sameUnit([a.row, a.col], [b.row, b.col])) {
          continue
        }
        return this.buildPromotionMove(a, b)
      }
    }

    const byCell = new Map<string, DragonNode[]>()
    for (const n of nodes) {
      const k = cellKey(n.row, n.col)
      const list = byCell.get(k) ?? []
      list.push(n)
      byCell.set(k, list)
    }
    for (const cellNodes of byCell.values()) {
      for (let i = 0; i < cellNodes.length; i++) {
        for (let j = i + 1; j < cellNodes.length; j++) {
          const a = cellNodes[i]
          const b = cellNodes[j]
          if (sideOf(a.color) === sideOf(b.color) || (isPrimary(a.color) && isPrimary(b.color))) {
            continue
          }
          return this.buildPromotionMove(a, b)
        }
      }
    }

    return null
  }

  private buildPromotionMove(a: DragonNode, b: DragonNode): DragonMove {
    const colored: DragonNode[] = []
    if (!isPrimary(a.color)) {
      colored.push({ ...a, color: primaryForSide(sideOf(a.color)) })
    }
    if (!isPrimary(b.color)) {
      colored.push({ ...b, color: primaryForSide(sideOf(b.color)) })
    }
    const description = `${a.digit}${cellRef(a.row, a.col)} and ${b.digit}${cellRef(b.row, b.col)} are coloured in ${colorLabel(a.color)} and ${colorLabel(b.color)}. Promote both colours to their primary Medusa colour (if not already Medusa).`
    return { id: '', kind: 'promotion', description, colored, eliminated: [], solved: [] }
  }

  /** Exhaustive mode only: if one side's nodes (primary or dragon) between
   * them cover every empty cell, assuming that side true fills the whole
   * grid. Callers must already have ruled out a mass elimination (which
   * would show that side contradicting itself), so what's left is a
   * conflict-free full grid - and a valid puzzle has just one solution, so
   * it's the solution. The same reliance on uniqueness as Unique Rectangle
   * Type 1. Returns null if neither side, or both sides, cover the grid
   * (two conflict-free full grids would mean two solutions, so there's no
   * telling which is meant). */
  private findColouringSolutionMove(nodeMap: Map<string, DragonNode>, board: Board): DragonMove | null {
    const sidesByCell = new Map<string, Set<Side>>()
    for (const n of nodeMap.values()) {
      const key = cellKey(n.row, n.col)
      const sides = sidesByCell.get(key) ?? new Set<Side>()
      sides.add(sideOf(n.color))
      sidesByCell.set(key, sides)
    }

    const covers: Record<Side, boolean> = { A: true, B: true }
    let emptyCells = 0
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        emptyCells++
        const sides = sidesByCell.get(cellKey(row, col))
        covers.A &&= sides?.has('A') ?? false
        covers.B &&= sides?.has('B') ?? false
        if (!covers.A && !covers.B) {
          return null
        }
      }
    }
    if (emptyCells === 0 || covers.A === covers.B) {
      return null
    }

    const side: Side = covers.A ? 'A' : 'B'
    return {
      id: '',
      kind: 'solution',
      description: `Every empty cell is coloured ${colorLabel(primaryForSide(side))} (or its dragon colour), so that colouring is the solution.`,
      colored: [],
      provenTrueColor: primaryForSide(side),
      eliminated: [],
      solved: Array.from(nodeMap.values())
        .filter((n) => sideOf(n.color) === side)
        .map((n) => ({ row: n.row, col: n.col, digit: n.digit })),
    }
  }

  private findEliminationMoves(nodes: DragonNode[], board: Board, candidates: CandidateGrid): DragonMove[] {
    // Almost every call - once per colouring the Optimize search tries, and
    // after every step of the default loop - finds nothing. The rules below
    // each rescan every node for every candidate, so an exact, cheap "is
    // there anything at all?" test goes first; only a yes pays for building
    // the moves.
    if (!hasAnyElimination(nodes, board, candidates)) {
      return []
    }
    const mass = this.findMassElimination(nodes, board, candidates)
    if (mass) {
      // A mass elimination resolves every node in the chain at once, so the
      // per-candidate rules below would find nothing new.
      return [mass]
    }
    return [
      ...this.findRule3(nodes, board, candidates),
      ...this.findRule4(nodes, candidates),
      ...this.findRule5(nodes, candidates),
    ]
  }

  private findMassElimination(nodes: DragonNode[], board: Board, candidates: CandidateGrid): DragonMove | null {
    const byCell = new Map<string, DragonNode[]>()
    for (const n of nodes) {
      const k = cellKey(n.row, n.col)
      const list = byCell.get(k) ?? []
      list.push(n)
      byCell.set(k, list)
    }

    for (const cellNodes of byCell.values()) {
      for (let i = 0; i < cellNodes.length; i++) {
        for (let j = i + 1; j < cellNodes.length; j++) {
          const a = cellNodes[i]
          const b = cellNodes[j]
          if (sideOf(a.color) === sideOf(b.color)) {
            return this.buildMassMove(
              nodes,
              sideOf(a.color),
              `In ${cellRef(a.row, a.col)}, ${a.digit} (${colorLabel(a.color)}) and ${b.digit} (${colorLabel(b.color)}) are colours belonging to the same Medusa color, so that Medusa color is false.`,
            )
          }
        }
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        if (a.digit !== b.digit || sideOf(a.color) !== sideOf(b.color)) {
          continue
        }
        if (!sameUnit([a.row, a.col], [b.row, b.col])) {
          continue
        }
        return this.buildMassMove(
          nodes,
          sideOf(a.color),
          `${a.digit} in ${cellRef(a.row, a.col)} (${colorLabel(a.color)}) and ${cellRef(b.row, b.col)} (${colorLabel(b.color)}) are colours belonging to the same Medusa color, so that Medusa color is false.`,
        )
      }
    }

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0 || byCell.has(cellKey(row, col))) {
          continue
        }
        const digits = markedCandidateDigits(candidates[row][col])
        if (digits.length === 0) {
          continue
        }
        for (const side of ['A', 'B'] as const) {
          const seesForEveryDigit = digits.every((digit) =>
            nodes.some((n) => sideOf(n.color) === side && n.digit === digit && sameUnit([row, col], [n.row, n.col])),
          )
          if (seesForEveryDigit) {
            return this.buildMassMove(
              nodes,
              side,
              `${cellRef(row, col)} has no coloured candidates, but ${digits.join(', ')} all see the ${colorLabel(primaryForSide(side))} side, so that side is false.`,
              [row, col],
            )
          }
        }
      }
    }

    return null
  }

  /** A dragon (secondary) color only records "if this side is true, this
   * candidate is true" - one direction. Proving a side false says nothing
   * about its still-conditional dragon candidates (denying the antecedent),
   * so only that side's *primary* nodes - including ones promotion has
   * already turned into primary colors - can be eliminated here. Proving a
   * side true is the sound direction (modus ponens) for both its primary
   * and dragon nodes, so the true side's dragon candidates can be solved. */
  private buildMassMove(
    nodes: DragonNode[],
    falseSide: Side,
    description: string,
    emptiedCell?: readonly [number, number],
  ): DragonMove {
    const trueSide = oppositeSide(falseSide)
    return {
      id: '',
      kind: 'mass-elimination',
      description,
      colored: [],
      provenTrueColor: primaryForSide(trueSide),
      eliminated: nodes
        .filter((n) => sideOf(n.color) === falseSide && isPrimary(n.color))
        .map((n) => ({ row: n.row, col: n.col, digit: n.digit })),
      solved: nodes
        .filter((n) => sideOf(n.color) === trueSide)
        .map((n) => ({ row: n.row, col: n.col, digit: n.digit })),
      emptiedCell,
    }
  }

  /** Rule 3: a candidate outside the chain that sees the same digit colored
   * on both sides - eliminated whichever side turns out true. */
  private findRule3(nodes: DragonNode[], board: Board, candidates: CandidateGrid): DragonMove[] {
    const coloredKeys = new Set(nodes.map((n) => nodeKey(n.row, n.col, n.digit)))
    const results: DragonMove[] = []
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        for (const digit of markedCandidateDigits(candidates[row][col])) {
          if (coloredKeys.has(nodeKey(row, col, digit))) {
            continue
          }
          const seesA = nodes.find(
            (n) => sideOf(n.color) === 'A' && n.digit === digit && sameUnit([row, col], [n.row, n.col]),
          )
          const seesB = nodes.find(
            (n) => sideOf(n.color) === 'B' && n.digit === digit && sameUnit([row, col], [n.row, n.col]),
          )
          if (seesA && seesB) {
            results.push({
              id: '',
              kind: 'rule3',
              description: `${cellRef(row, col)} cannot be ${digit} - it sees ${digit}'s coloured with opposite colours (${cellRef(seesA.row, seesA.col)} ${colorLabel(seesA.color)}, ${cellRef(seesB.row, seesB.col)} ${colorLabel(seesB.color)}).`,
              colored: [],
              eliminated: [{ row, col, digit }],
              solved: [],
            })
          }
        }
      }
    }
    return results
  }

  /** Rule 4: a cell with a colored candidate on each side - every other
   * candidate in that cell is eliminated. */
  private findRule4(nodes: DragonNode[], candidates: CandidateGrid): DragonMove[] {
    const byCell = new Map<string, DragonNode[]>()
    for (const n of nodes) {
      const k = cellKey(n.row, n.col)
      const list = byCell.get(k) ?? []
      list.push(n)
      byCell.set(k, list)
    }

    const results: DragonMove[] = []
    for (const [key, cellNodes] of byCell) {
      const hasA = cellNodes.some((n) => sideOf(n.color) === 'A')
      const hasB = cellNodes.some((n) => sideOf(n.color) === 'B')
      if (!hasA || !hasB) {
        continue
      }
      const [row, col] = key.split(',').map(Number)
      const coloredDigits = new Set(cellNodes.map((n) => n.digit))
      const eliminatedDigits = markedCandidateDigits(candidates[row][col]).filter((d) => !coloredDigits.has(d))
      if (eliminatedDigits.length === 0) {
        continue
      }
      results.push({
        id: '',
        kind: 'rule4',
        description: `${cellRef(row, col)} has candidates coloured with opposite colours, so the uncoloured candidate${eliminatedDigits.length === 1 ? '' : 's'} (${eliminatedDigits.join(', ')}) can be eliminated.`,
        colored: [],
        eliminated: eliminatedDigits.map((digit) => ({ row, col, digit })),
        solved: [],
      })
    }
    return results
  }

  /** Rule 5: a cell with exactly one colored candidate - its other
   * candidates are eliminated if they see the same digit colored on the
   * opposite side elsewhere. */
  private findRule5(nodes: DragonNode[], candidates: CandidateGrid): DragonMove[] {
    const byCell = new Map<string, DragonNode[]>()
    for (const n of nodes) {
      const k = cellKey(n.row, n.col)
      const list = byCell.get(k) ?? []
      list.push(n)
      byCell.set(k, list)
    }

    const results: DragonMove[] = []
    for (const [key, cellNodes] of byCell) {
      if (cellNodes.length !== 1) {
        continue
      }
      const [row, col] = key.split(',').map(Number)
      const colored = cellNodes[0]
      const otherSide = oppositeSide(sideOf(colored.color))

      for (const digit of markedCandidateDigits(candidates[row][col])) {
        if (digit === colored.digit) {
          continue
        }
        const opponent = nodes.find(
          (n) =>
            sideOf(n.color) === otherSide &&
            n.digit === digit &&
            !(n.row === row && n.col === col) &&
            sameUnit([row, col], [n.row, n.col]),
        )
        if (opponent) {
          results.push({
            id: '',
            kind: 'rule5',
            description: `${cellRef(row, col)} is not ${digit} - its cell has a candidate coloured ${colorLabel(colored.color)}, and it sees an oppositely coloured ${digit} (${colorLabel(opponent.color)}) at ${cellRef(opponent.row, opponent.col)}.`,
            colored: [],
            eliminated: [{ row, col, digit }],
            solved: [],
          })
        }
      }
    }
    return results
  }
}
