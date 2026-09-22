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
  /** extension-rule3 only, present whenever its chain used at least one
   * technique (so always, in practice) - the same reasoning `description`
   * states as one flowing sentence, split into one entry per technique
   * application instead, in the order they were chained. Lets the UI step
   * through a multi-technique chain's substeps one at a time (a separate,
   * optional control from the main move-by-move stepper) instead of always
   * showing the whole chain's basis cells and internal eliminations at
   * once - though showing them all at once (every substep "revealed") is
   * still the default, unnavigated view. */
  substeps?: DragonRule3Substep[]
}

/** One technique application within a Dynamic Dragon Colouring step's
 * chained reasoning (see DragonMove.substeps) - either an antecedent that
 * had to fire first to make the next one possible, or the final technique
 * that actually forces the colouring. 'hidden single' never appears here,
 * for the same reason it's excluded from `dynamicTechniques` - see that
 * field's doc comment. */
export interface DragonRule3Substep {
  technique: Exclude<Rule3Technique, 'hidden single'>
  /** This substep's own clause, exactly as it appears joined into the
   * move's full `description` (e.g. "a Locked Candidate (Pointing) for 5
   * in {r1c2, r1c3}, which eliminates 5r1c4"). */
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
 * findNewlyHiddenSingleCell), but is included here so it shares one type
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
  /** The "we have a ..." fragment for this step, used only when it turns
   * out to be a dependency of the final technique. */
  antecedentClause: string
  /** Present only when `technique` is an AIC (either kind) - carried
   * through to the resulting DragonMove's `aicChains` so the step can be
   * drawn with the same purple/curved-line chain visualization the
   * standalone technique gets. */
  aic?: ShortAicInstance
}

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

export class SudokuDragonFinder {
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

  private seesSide(
    nodeMap: Map<string, DragonNode>,
    row: number,
    col: number,
    digit: number,
    side: Side,
  ): boolean {
    for (const n of nodeMap.values()) {
      if (sideOf(n.color) !== side || n.digit !== digit) {
        continue
      }
      if (n.row === row && n.col === col) {
        continue
      }
      if (sameUnit([row, col], [n.row, n.col])) {
        return true
      }
    }
    return false
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
    const side = sideOfPrimary(primary)
    // This colour's nodes grouped by digit, built once: seesColor would
    // otherwise rescan the whole node map for every cell of every unit, and
    // this runs on every simulated step of every stuck chain.
    const primaryByDigit: DragonNode[][] = Array.from({ length: 9 }, () => [])
    for (const n of nodeMap.values()) {
      if (n.color === primary) {
        primaryByDigit[n.digit - 1].push(n)
      }
    }
    const seesPrimary = (r: number, c: number, digit: number) =>
      primaryByDigit[digit - 1].some((n) => !(n.row === r && n.col === c) && sameUnit([r, c], [n.row, n.col]))
    for (const unit of sudokuUnits()) {
      for (let digit = 1; digit <= 9; digit++) {
        const cellsWithDigit = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1])
        if (cellsWithDigit.length < 2) {
          continue
        }
        const notSeeing = cellsWithDigit.filter(([r, c]) => !seesPrimary(r, c, digit))
        if (notSeeing.length !== 1) {
          continue
        }
        const [r, c] = notSeeing[0]
        if (nodeMap.has(nodeKey(r, c, digit))) {
          continue
        }
        const secondary = secondaryForSide(side)
        return {
          id: '',
          kind: 'extension-rule1',
          description: `Assuming ${colorLabel(primary)} is true: ${cellRef(r, c)} would be the only remaining ${digit} in its ${classifyUnitKind(unit)}, so colour it ${colorLabel(secondary)}.`,
          colored: [{ row: r, col: c, digit, color: secondary }],
          eliminated: [],
          solved: [],
        }
      }
    }
    return null
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
    const side = sideOfPrimary(primary)
    const secondary = secondaryForSide(side)
    const hypothetical = this.buildHypotheticalBoard(nodeMap, board, candidates, side)
    if (!hypothetical) {
      return null
    }
    const hiddenSingle = this.findNewlyHiddenSingleCell(hypothetical.hypBoard, hypothetical.hypCandidates, nodeMap)
    if (!hiddenSingle) {
      return null
    }
    return {
      id: '',
      kind: 'extension-hidden-single',
      description: `Assuming ${colorLabel(primary)} is true, then we have ${this.hiddenSingleFinalClause(secondary, hiddenSingle)}.`,
      colored: [{ row: hiddenSingle.row, col: hiddenSingle.col, digit: hiddenSingle.digit, color: secondary }],
      eliminated: [],
      solved: [],
    }
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
    const side = sideOfPrimary(primary)
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        const digits = markedCandidateDigits(candidates[row][col])
        if (digits.length === 0 || digits.some((d) => nodeMap.has(nodeKey(row, col, d)))) {
          continue
        }
        const survivors = digits.filter((d) => !this.seesSide(nodeMap, row, col, d, side))
        if (survivors.length !== 1) {
          continue
        }
        const digit = survivors[0]
        const secondary = secondaryForSide(side)
        return {
          id: '',
          kind: 'extension-rule2',
          description: `Assuming ${colorLabel(primary)} is true eliminates every other candidate from ${cellRef(row, col)}, leaving only ${digit} - colour it ${colorLabel(secondary)}.`,
          colored: [{ row, col, digit, color: secondary }],
          eliminated: [],
          solved: [],
        }
      }
    }
    return null
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
    const side = sideOfPrimary(primary)
    const secondary = secondaryForSide(side)
    const hypothetical = this.buildHypotheticalBoard(nodeMap, board, candidates, side)
    if (!hypothetical) {
      return null
    }
    const { hypBoard, hypCandidates } = hypothetical

    const steps: Rule3ChainStep[] = []
    // Counts every AIC application actually tried during this simulation
    // (antecedent or final), not just the ones that end up relevant to the
    // final conclusion - simpler to reason about, and "used" is a fair
    // reading of "used once within a step" either way.
    let aicStepsUsed = 0

    for (let step = 0; step < MAX_RULE3_SIMULATION_STEPS; step++) {
      let appliedSomething = false

      if (allowedTechniques.has('hidden single')) {
        const hiddenSingle = this.findNewlyHiddenSingleCell(hypBoard, hypCandidates, nodeMap)
        if (hiddenSingle) {
          const finalClause = this.hiddenSingleFinalClause(secondary, hiddenSingle)
          return this.buildRule3CombinedMove(
            primary,
            steps,
            'hidden single',
            [[hiddenSingle.row, hiddenSingle.col]],
            finalClause,
            { row: hiddenSingle.row, col: hiddenSingle.col, digit: hiddenSingle.digit, color: secondary },
            { dependencyCells: hiddenSingle.unit },
          )
        }
      }

      if (allowedTechniques.has('locked candidate')) {
        for (const locked of this.lockedCandidateFinder.findInstances(hypBoard, hypCandidates)) {
          if (locked.eliminations.length === 0) {
            continue
          }
          for (const { row, col, digit } of locked.eliminations) {
            hypCandidates[row][col][digit - 1] = false
          }
          const forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, nodeMap)
          if (forced) {
            const finalClause = this.lockedCandidateFinalClause(secondary, locked, forced)
            return this.buildRule3CombinedMove(
              primary,
              steps,
              'locked candidate',
              locked.basisCells,
              finalClause,
              { row: forced.row, col: forced.col, digit: forced.digit, color: secondary },
              { finalEliminatedCandidates: locked.eliminations },
            )
          }
          steps.push({
            technique: 'locked candidate',
            basisCells: locked.basisCells,
            affectedCells: uniqueCells(locked.eliminations),
            eliminatedCandidates: locked.eliminations,
            antecedentClause: this.lockedCandidateAntecedentClause(locked),
          })
          appliedSomething = true
          break
        }
      }
      if (appliedSomething) {
        continue
      }

      // No allowedTechniques.has('naked pair') gate here - extend() always
      // adds 'naked pair' back to the set, so it can never be excluded.
      for (const pair of this.pairFinder.findNakedPairs(hypBoard, hypCandidates)) {
        if (pair.eliminations.length === 0) {
          continue
        }
        for (const { row, col, digit } of pair.eliminations) {
          hypCandidates[row][col][digit - 1] = false
        }
        const forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, nodeMap)
        if (forced) {
          const finalClause = this.nakedPairFinalClause(secondary, pair, forced)
          return this.buildRule3CombinedMove(
            primary,
            steps,
            'naked pair',
            pair.cells,
            finalClause,
            { row: forced.row, col: forced.col, digit: forced.digit, color: secondary },
            { finalEliminatedCandidates: pair.eliminations },
          )
        }
        steps.push({
          technique: 'naked pair',
          basisCells: pair.cells,
          affectedCells: uniqueCells(pair.eliminations),
          eliminatedCandidates: pair.eliminations,
          antecedentClause: this.nakedPairAntecedentClause(pair),
        })
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
        ? this.nakedSubsetFinder.findNakedTriplesAndQuads(hypBoard, hypCandidates)
        : { triples: [], quads: [] }

      if (needsTriple) {
        for (const triple of triples) {
          if (triple.eliminations.length === 0) {
            continue
          }
          for (const { row, col, digit } of triple.eliminations) {
            hypCandidates[row][col][digit - 1] = false
          }
          const forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, nodeMap)
          if (forced) {
            const finalClause = this.nakedSubsetFinalClause(secondary, triple, forced)
            return this.buildRule3CombinedMove(
              primary,
              steps,
              'naked triple',
              triple.cells,
              finalClause,
              { row: forced.row, col: forced.col, digit: forced.digit, color: secondary },
              { finalEliminatedCandidates: triple.eliminations },
            )
          }
          steps.push({
            technique: 'naked triple',
            basisCells: triple.cells,
            affectedCells: uniqueCells(triple.eliminations),
            eliminatedCandidates: triple.eliminations,
            antecedentClause: this.nakedSubsetAntecedentClause(triple),
          })
          appliedSomething = true
          break
        }
      }
      if (appliedSomething) {
        continue
      }

      if (needsQuad) {
        for (const quad of quads) {
          if (quad.eliminations.length === 0) {
            continue
          }
          for (const { row, col, digit } of quad.eliminations) {
            hypCandidates[row][col][digit - 1] = false
          }
          const forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, nodeMap)
          if (forced) {
            const finalClause = this.nakedSubsetFinalClause(secondary, quad, forced)
            return this.buildRule3CombinedMove(
              primary,
              steps,
              'naked quad',
              quad.cells,
              finalClause,
              { row: forced.row, col: forced.col, digit: forced.digit, color: secondary },
              { finalEliminatedCandidates: quad.eliminations },
            )
          }
          steps.push({
            technique: 'naked quad',
            basisCells: quad.cells,
            affectedCells: uniqueCells(quad.eliminations),
            eliminatedCandidates: quad.eliminations,
            antecedentClause: this.nakedSubsetAntecedentClause(quad),
          })
          appliedSomething = true
          break
        }
      }
      if (appliedSomething) {
        continue
      }

      if (allowedTechniques.has('hidden pair')) {
        for (const pair of this.hiddenPairFinder.findHiddenPairs(hypBoard, hypCandidates)) {
          if (pair.eliminations.length === 0) {
            continue
          }
          for (const { row, col, digit } of pair.eliminations) {
            hypCandidates[row][col][digit - 1] = false
          }
          const forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, nodeMap)
          if (forced) {
            const finalClause = this.hiddenPairFinalClause(secondary, pair, forced)
            return this.buildRule3CombinedMove(
              primary,
              steps,
              'hidden pair',
              pair.cells,
              finalClause,
              { row: forced.row, col: forced.col, digit: forced.digit, color: secondary },
              { finalEliminatedCandidates: pair.eliminations },
            )
          }
          steps.push({
            technique: 'hidden pair',
            basisCells: pair.cells,
            affectedCells: uniqueCells(pair.eliminations),
            eliminatedCandidates: pair.eliminations,
            antecedentClause: this.hiddenPairAntecedentClause(pair),
          })
          appliedSomething = true
          break
        }
      }
      if (appliedSomething) {
        continue
      }

      if (allowedTechniques.has('UR')) {
        for (const ur of this.uniqueRectangleFinder.find(hypBoard, hypCandidates)) {
          if (ur.solvedCandidates.length > 0) {
            // The Unique Rectangle's own conclusion *is* the move (Type 1's
            // single-extra-candidate case only) - no need to also check for
            // a newly-single-candidate cell, and no reason to keep
            // simulating past it first.
            const { row, col, digit } = ur.solvedCandidates[0]
            const finalClause = this.uniqueRectangleSolveFinalClause(secondary, ur)
            return this.buildRule3CombinedMove(primary, steps, 'UR', ur.cells, finalClause, {
              row,
              col,
              digit,
              color: secondary,
            })
          }
          if (ur.eliminatedCandidates.length > 0) {
            for (const { row, col, digit } of ur.eliminatedCandidates) {
              hypCandidates[row][col][digit - 1] = false
            }
            const forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, nodeMap)
            if (forced) {
              const finalClause = this.uniqueRectangleEliminationFinalClause(secondary, ur, forced)
              return this.buildRule3CombinedMove(
                primary,
                steps,
                'UR',
                ur.cells,
                finalClause,
                { row: forced.row, col: forced.col, digit: forced.digit, color: secondary },
                { finalEliminatedCandidates: ur.eliminatedCandidates },
              )
            }
            steps.push({
              technique: 'UR',
              basisCells: ur.cells,
              affectedCells: uniqueCells(ur.eliminatedCandidates),
              eliminatedCandidates: ur.eliminatedCandidates,
              antecedentClause: this.uniqueRectangleAntecedentClause(ur),
            })
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
        const bugPlusOne = this.bugPlusOneFinder.find(hypBoard, hypCandidates)
        if (bugPlusOne) {
          const finalClause = this.bugPlusOneFinalClause(secondary, bugPlusOne)
          return this.buildRule3CombinedMove(primary, steps, 'bug plus one', [bugPlusOne.cell], finalClause, {
            row: bugPlusOne.cell[0],
            col: bugPlusOne.cell[1],
            digit: bugPlusOne.solvedDigit,
            color: secondary,
          })
        }
      }

      if (allowedTechniques.has('bivalue oddagon')) {
        for (const oddagon of this.bivalueOddagonFinder.find(hypBoard, hypCandidates)) {
          if (oddagon.solvedCell) {
            const finalClause = this.bivalueOddagonSolveFinalClause(secondary, oddagon)
            return this.buildRule3CombinedMove(primary, steps, 'bivalue oddagon', oddagon.cells, finalClause, {
              row: oddagon.solvedCell[0],
              col: oddagon.solvedCell[1],
              digit: oddagon.guardianDigit,
              color: secondary,
            })
          }
          if (oddagon.eliminations.length > 0) {
            for (const { row, col, digit } of oddagon.eliminations) {
              hypCandidates[row][col][digit - 1] = false
            }
            const forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, nodeMap)
            if (forced) {
              const finalClause = this.bivalueOddagonEliminationFinalClause(secondary, oddagon, forced)
              return this.buildRule3CombinedMove(
                primary,
                steps,
                'bivalue oddagon',
                oddagon.cells,
                finalClause,
                { row: forced.row, col: forced.col, digit: forced.digit, color: secondary },
                { finalEliminatedCandidates: oddagon.eliminations },
              )
            }
            steps.push({
              technique: 'bivalue oddagon',
              basisCells: oddagon.cells,
              affectedCells: uniqueCells(oddagon.eliminations),
              eliminatedCandidates: oddagon.eliminations,
              antecedentClause: this.bivalueOddagonAntecedentClause(oddagon),
            })
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
      if (!(aicLimitPerStep && aicStepsUsed >= 1)) {
        // Built once and handed to both finders when both might run - short
        // and generic AIC otherwise each rebuild the identical link graph
        // for the same hypBoard/hypCandidates, and with the per-step limit
        // off this whole block can run dozens of times per chain.
        const needsGraph =
          allowedTechniques.has('short single-digit aic') ||
          allowedTechniques.has('short aic') ||
          allowedTechniques.has('generic aic')
        const sharedGraph = needsGraph ? buildLinkGraphs(hypBoard, hypCandidates) : undefined
        const aicsInOrder = function* (finder: SudokuDragonFinder): Generator<{ aic: ShortAicInstance; technique: AicTechnique }> {
          if (allowedTechniques.has('short single-digit aic') || allowedTechniques.has('short aic')) {
            for (const aic of finder.shortAicFinder.findShortAics(hypBoard, hypCandidates, sharedGraph)) {
              yield { aic, technique: classifyShortAic(aic) === 'single-digit' ? 'short single-digit aic' : 'short aic' }
            }
          }
          if (allowedTechniques.has('generic aic')) {
            for (const aic of finder.genericAicFinder.findGenericAics(hypBoard, hypCandidates, undefined, sharedGraph)) {
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
          const basisCells = aic.nodes.map((n) => [n.row, n.col] as const)
          const forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, nodeMap)
          if (forced) {
            const finalClause = this.shortAicFinalClause(secondary, aic, forced, technique)
            return this.buildRule3CombinedMove(
              primary,
              steps,
              technique,
              basisCells,
              finalClause,
              { row: forced.row, col: forced.col, digit: forced.digit, color: secondary },
              { finalAic: aic, finalEliminatedCandidates: aic.eliminations },
            )
          }
          steps.push({
            technique,
            basisCells,
            affectedCells: uniqueCells(aic.eliminations),
            eliminatedCandidates: aic.eliminations,
            antecedentClause: this.shortAicAntecedentClause(aic, technique),
            aic,
          })
          appliedSomething = true
          break
        }
      }
      if (appliedSomething) {
        continue
      }

      // Nothing more applies - whatever's accumulated in `steps` never led
      // anywhere actionable, so it's discarded rather than surfaced.
      return null
    }

    // Exceeded the safety cap without either resolving or getting stuck -
    // treat it the same as "nothing actionable found" rather than risk an
    // unbounded simulation.
    return null
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

  private buildRule3CombinedMove(
    primary: PrimaryColor,
    steps: Rule3ChainStep[],
    finalTechnique: Rule3Technique,
    finalBasisCells: readonly (readonly [number, number])[],
    finalClause: string,
    colored: DragonNode,
    options: {
      /** What dependency-tracking checks prior steps against - defaults to
       * `finalBasisCells`, but a hidden single's real dependency is its
       * whole unit (see findNewlyHiddenSingleCell), not just the one cell
       * it resolves, so that case passes the unit's 9 cells here instead
       * while still highlighting only the resolved cell via
       * `finalBasisCells`. */
      dependencyCells?: readonly (readonly [number, number])[]
      /** Set only when `finalTechnique` is an AIC (either kind) - its
       * chain data, folded into `aicChains`/`substeps` alongside any
       * antecedent step that was also an AIC. */
      finalAic?: ShortAicInstance
      /** The final technique's own eliminations (hidden single and a
       * solving UR have none - they place a digit directly) - becomes the
       * last substep's `eliminatedCandidates` and, joined into
       * `finalClause` by the caller already, its own "which eliminates
       * ..." wording. */
      finalEliminatedCandidates?: readonly DragonCandidateRef[]
    } = {},
  ): DragonMove {
    const { dependencyCells = finalBasisCells, finalAic, finalEliminatedCandidates = [] } = options
    const antecedents = this.selectRelevantChainSteps(steps, dependencyCells)
    const clauses = [...antecedents.map((s) => s.antecedentClause), finalClause]
    // 'hidden single' is never labeled - see the dynamicTechniques doc
    // comment on DragonMove. It can still show up as `finalTechnique` here
    // (a hidden single that only emerged mid-chain, after some genuinely
    // dynamic antecedent), but only that antecedent is what made this
    // chain need Dynamic Dragon Colouring in the first place. Substeps
    // exclude it the same way, for the same reason - see DragonRule3Substep.
    const labeledTechniques = [...antecedents.map((s) => s.technique), finalTechnique].filter(
      (t): t is Exclude<Rule3Technique, 'hidden single'> => t !== 'hidden single',
    )
    const aicInstances = [
      ...antecedents.map((s) => s.aic).filter((aic): aic is ShortAicInstance => !!aic),
      ...(finalAic ? [finalAic] : []),
    ]
    const aicChains =
      aicInstances.length > 0
        ? aicInstances.map((aic) => ({
            candidates: aic.nodes.map((n) => ({ row: n.row, col: n.col, digit: n.digit })),
            links: aic.links.map((link) => ({
              from: { row: link.from.row, col: link.from.col, digit: link.from.digit },
              to: { row: link.to.row, col: link.to.col, digit: link.to.digit },
              kind: link.kind,
            })),
            hypotheticalEliminations: aic.eliminations.map((e) => ({ row: e.row, col: e.col, digit: e.digit })),
          }))
        : undefined
    const substeps: DragonRule3Substep[] = [
      ...antecedents.map((s) => ({
        technique: s.technique,
        clause: s.antecedentClause,
        basisCells: s.basisCells,
        eliminatedCandidates: s.eliminatedCandidates,
        aic: s.aic,
      })),
      {
        technique: finalTechnique,
        clause: finalClause,
        basisCells: finalBasisCells,
        eliminatedCandidates: finalEliminatedCandidates,
        aic: finalAic,
      },
    ]
      .filter((s): s is typeof s & { technique: Exclude<Rule3Technique, 'hidden single'> } => s.technique !== 'hidden single')
      .map((s) => ({
        technique: s.technique,
        clause: s.clause,
        basisCells: s.basisCells,
        eliminatedCandidates: s.eliminatedCandidates,
        aic: s.aic
          ? {
              candidates: s.aic.nodes.map((n) => ({ row: n.row, col: n.col, digit: n.digit })),
              links: s.aic.links.map((link) => ({
                from: { row: link.from.row, col: link.from.col, digit: link.from.digit },
                to: { row: link.to.row, col: link.to.col, digit: link.to.digit },
                kind: link.kind,
              })),
            }
          : undefined,
      }))
    return {
      id: '',
      kind: 'extension-rule3',
      dynamicTechniques: labeledTechniques,
      dynamicTechniqueCells: [...antecedents.flatMap((s) => s.basisCells), ...finalBasisCells],
      description: `Assuming ${colorLabel(primary)} is true, then we have ${clauses.join(' which reveals ')}.`,
      colored: [colored],
      eliminated: [],
      solved: [],
      aicChains,
      // Only ever empty when finalTechnique is 'hidden single' with zero
      // antecedents - proven impossible in findExtensionRule3Move's own
      // doc comment (a plain hidden single is always ruled out by
      // extend()'s own always-on check before Rule 3 ever runs, so Rule
      // 3's *own* hidden-single check can only ever succeed after at
      // least one antecedent already fired) - kept as a fallback anyway
      // rather than relying on that invariant never changing.
      substeps: substeps.length > 0 ? substeps : undefined,
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
   * hidden single already resolves would misrepresent the reasoning. */
  private findNewlyHiddenSingleCell(
    hypBoard: Board,
    hypCandidates: CandidateGrid,
    nodeMap: Map<string, DragonNode>,
  ): {
    row: number
    col: number
    digit: number
    unitKind: 'row' | 'column' | 'box'
    /** The unit's own 9 cells - a hidden single's validity rests on *all*
     * of them (every other one no longer holding this digit), not just the
     * resulting cell, so this is what dependency-tracking needs to check a
     * prior antecedent against - see findExtensionRule3Move. */
    unit: readonly (readonly [number, number])[]
  } | null {
    for (const unit of sudokuUnits()) {
      for (let digit = 1; digit <= 9; digit++) {
        const withCandidate = unit.filter(([r, c]) => hypBoard[r][c] === 0 && hypCandidates[r][c][digit - 1])
        if (withCandidate.length !== 1) {
          continue
        }
        const [row, col] = withCandidate[0]
        if (nodeMap.has(nodeKey(row, col, digit))) {
          continue
        }
        return { row, col, digit, unitKind: classifyUnitKind(unit), unit }
      }
    }
    return null
  }

  // --- Extension Rule 3 antecedent clauses (used when a technique fired
  // but didn't itself force anything, and turned out to be a dependency of
  // whichever technique later did): "a TECHNIQUE of DIGITS in {CELLS}, which
  // eliminates ..." - no "Assuming ... is true", no "leaving ... so colour
  // it ..." (that's the final clause's alone) - since this only ever
  // appears chained with "which reveals" into a bigger sentence whose final
  // clause carries the rest.

  private lockedCandidateAntecedentClause(instance: LockedCandidateInstance): string {
    const typeLabel = instance.type === 'pointing' ? 'Pointing' : 'Claiming'
    const basisLabel = instance.basisCells.map(([r, c]) => cellRef(r, c)).join(', ')
    const eliminationsLabel = this.formatCandidateGroups(instance.eliminations)
    return `a Locked Candidate (${typeLabel}) for ${instance.digit} in {${basisLabel}}, which eliminates ${eliminationsLabel}`
  }

  private nakedPairAntecedentClause(pair: NakedPairInstance): string {
    const [a, b] = pair.digits
    const cellsLabel = pair.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    const eliminationsLabel = this.formatCandidateGroups(pair.eliminations)
    return `a naked pair of {${a},${b}} in {${cellsLabel}}, which eliminates ${eliminationsLabel}`
  }

  private nakedSubsetAntecedentClause(subset: NakedSubsetInstance): string {
    const sizeWord = subset.size === 3 ? 'triple' : 'quad'
    const cellsLabel = subset.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    const digitsLabel = subset.digits.join(',')
    const eliminationsLabel = this.formatCandidateGroups(subset.eliminations)
    return `a naked ${sizeWord} of {${digitsLabel}} in {${cellsLabel}}, which eliminates ${eliminationsLabel}`
  }

  private hiddenPairAntecedentClause(pair: HiddenPairInstance): string {
    const [a, b] = pair.digits
    const cellsLabel = pair.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    const eliminationsLabel = this.formatCandidateGroups(pair.eliminations)
    return `a hidden pair of {${a},${b}} in {${cellsLabel}}, which eliminates ${eliminationsLabel}`
  }

  private uniqueRectangleAntecedentClause(ur: UniqueRectangleInstance): string {
    const eliminationsLabel = this.formatCandidateGroups(ur.eliminatedCandidates)
    return `${ur.reasonText}, which eliminates ${eliminationsLabel}`
  }

  private bivalueOddagonClauseIntro(oddagon: BivalueOddagonInstance): string {
    const [a, b] = oddagon.loopDigits
    const cellsLabel = oddagon.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    return `a ${oddagon.cells.length}-cell Bivalue Oddagon of {${a},${b}} at ${cellsLabel}`
  }

  private bivalueOddagonAntecedentClause(oddagon: BivalueOddagonInstance): string {
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

  private shortAicAntecedentClause(aic: ShortAicInstance, technique: AicTechnique): string {
    const eliminationsLabel = this.formatCandidateGroups(aic.eliminations)
    return `a ${this.aicLabel(technique)} (Type ${aic.eliminationType}) of ${this.formatAicChainText(aic)}, which eliminates ${eliminationsLabel}`
  }

  // --- Extension Rule 3 final clauses (the technique that actually forces
  // a cell, or directly solves via a Unique Rectangle) - these keep the
  // original "at CELLS, which eliminates ..., leaving ... so colour it ..."
  // phrasing, since this is always the sentence's last clause.

  private hiddenSingleFinalClause(
    secondary: DragonColor,
    cell: { row: number; col: number; digit: number; unitKind: 'row' | 'column' | 'box' },
  ): string {
    return `a hidden single at ${cellRef(cell.row, cell.col)}, since ${cell.digit} has nowhere else to go in its ${cell.unitKind}, so colour it ${colorLabel(secondary)}`
  }

  private lockedCandidateFinalClause(
    secondary: DragonColor,
    instance: LockedCandidateInstance,
    forced: { row: number; col: number; digit: number },
  ): string {
    const typeLabel = instance.type === 'pointing' ? 'Pointing' : 'Claiming'
    const basisLabel = instance.basisCells.map(([r, c]) => cellRef(r, c)).join(', ')
    const eliminationsLabel = this.formatCandidateGroups(instance.eliminations)
    return `a Locked Candidate (${typeLabel}) for ${instance.digit} at ${basisLabel}, which eliminates ${eliminationsLabel}, leaving ${cellRef(forced.row, forced.col)} with only ${forced.digit} as the sole candidate, so colour it ${colorLabel(secondary)}`
  }

  private nakedPairFinalClause(
    secondary: DragonColor,
    pair: NakedPairInstance,
    forced: { row: number; col: number; digit: number },
  ): string {
    const [a, b] = pair.digits
    const cellsLabel = pair.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    const eliminationsLabel = this.formatCandidateGroups(pair.eliminations)
    return `a naked pair of {${a},${b}} at ${cellsLabel}, which eliminates ${eliminationsLabel}, leaving ${cellRef(forced.row, forced.col)} with only ${forced.digit} as the sole candidate, so colour it ${colorLabel(secondary)}`
  }

  private nakedSubsetFinalClause(
    secondary: DragonColor,
    subset: NakedSubsetInstance,
    forced: { row: number; col: number; digit: number },
  ): string {
    const sizeWord = subset.size === 3 ? 'triple' : 'quad'
    const cellsLabel = subset.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    const digitsLabel = subset.digits.join(',')
    const eliminationsLabel = this.formatCandidateGroups(subset.eliminations)
    return `a naked ${sizeWord} of {${digitsLabel}} at ${cellsLabel}, which eliminates ${eliminationsLabel}, leaving ${cellRef(forced.row, forced.col)} with only ${forced.digit} as the sole candidate, so colour it ${colorLabel(secondary)}`
  }

  private hiddenPairFinalClause(
    secondary: DragonColor,
    pair: HiddenPairInstance,
    forced: { row: number; col: number; digit: number },
  ): string {
    const [a, b] = pair.digits
    const cellsLabel = pair.cells.map(([r, c]) => cellRef(r, c)).join(', ')
    const eliminationsLabel = this.formatCandidateGroups(pair.eliminations)
    return `a hidden pair of {${a},${b}} at ${cellsLabel}, which eliminates ${eliminationsLabel}, leaving ${cellRef(forced.row, forced.col)} with only ${forced.digit} as the sole candidate, so colour it ${colorLabel(secondary)}`
  }

  private shortAicFinalClause(
    secondary: DragonColor,
    aic: ShortAicInstance,
    forced: { row: number; col: number; digit: number },
    technique: AicTechnique,
  ): string {
    const eliminationsLabel = this.formatCandidateGroups(aic.eliminations)
    return `a ${this.aicLabel(technique)} (Type ${aic.eliminationType}) of ${this.formatAicChainText(aic)}, which eliminates ${eliminationsLabel}, leaving ${cellRef(forced.row, forced.col)} with only ${forced.digit} as the sole candidate, so colour it ${colorLabel(secondary)}`
  }

  private uniqueRectangleSolveFinalClause(secondary: DragonColor, ur: UniqueRectangleInstance): string {
    const { row, col, digit } = ur.solvedCandidates[0]
    return `${ur.reasonText}, thus we can colour ${digit}${cellRef(row, col)} in ${colorLabel(secondary)}`
  }

  private uniqueRectangleEliminationFinalClause(
    secondary: DragonColor,
    ur: UniqueRectangleInstance,
    forced: { row: number; col: number; digit: number },
  ): string {
    const eliminationsLabel = this.formatCandidateGroups(ur.eliminatedCandidates)
    return `${ur.reasonText}, which eliminates ${eliminationsLabel}, leaving ${cellRef(forced.row, forced.col)} with only ${forced.digit} as the sole candidate, so colour it ${colorLabel(secondary)}`
  }

  private bugPlusOneFinalClause(secondary: DragonColor, bug: BugPlusOneInstance): string {
    const [row, col] = bug.cell
    return `a BUG+1 at ${cellRef(row, col)} (candidates {${bug.candidates.join(',')}}), where ${bug.solvedDigit} appears three times in its ${bug.unitKind}, so colour it ${colorLabel(secondary)}`
  }

  private bivalueOddagonSolveFinalClause(secondary: DragonColor, oddagon: BivalueOddagonInstance): string {
    const [row, col] = oddagon.solvedCell!
    return `${this.bivalueOddagonClauseIntro(oddagon)}, thus we can colour ${oddagon.guardianDigit}${cellRef(row, col)} in ${colorLabel(secondary)}`
  }

  private bivalueOddagonEliminationFinalClause(
    secondary: DragonColor,
    oddagon: BivalueOddagonInstance,
    forced: { row: number; col: number; digit: number },
  ): string {
    const eliminationsLabel = this.formatCandidateGroups(oddagon.eliminations)
    return `${this.bivalueOddagonClauseIntro(oddagon)}, which eliminates ${eliminationsLabel}, leaving ${cellRef(forced.row, forced.col)} with only ${forced.digit} as the sole candidate, so colour it ${colorLabel(secondary)}`
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
              `${cellRef(row, col)} has no coloured candidates, but ${digits.join(', ')} all see the ${primaryForSide(side)} side, so that side is false.`,
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
  private buildMassMove(nodes: DragonNode[], falseSide: Side, description: string): DragonMove {
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
