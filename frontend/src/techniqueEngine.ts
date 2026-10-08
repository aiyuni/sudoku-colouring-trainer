/**
 * The technique engine: every finder wired into one flat, simplest-first
 * TechniqueInstance list (buildTechniqueInstances), and the Solve Path search
 * built on it (buildSolvePath). Pure logic, no React or DOM - kept out of
 * App.tsx so solvePath.worker.ts can run the (up to many seconds) search off
 * the main thread.
 */
import { cloneBoard, cloneCandidates, markedCandidateDigits } from './sudoku/boardUtils'
import { SudokuAlsXzFinder, type AlsXzInstance } from './sudoku/SudokuAlsXzFinder'
import { SudokuAvoidableRectangleFinder, type GivenMask } from './sudoku/SudokuAvoidableRectangleFinder'
import { SudokuBivalueOddagonFinder } from './sudoku/SudokuBivalueOddagonFinder'
import { bugPlusNName, bugPlusNEliminationsText, bugPlusNReasonText, SudokuBugPlusNFinder } from './sudoku/SudokuBugPlusNFinder'
import { SudokuColorFinder } from './sudoku/SudokuColorFinder'
import {
  isDynamicDragonMove,
  SudokuDragonFinder,
  DEFAULT_RULE3_TECHNIQUES,
  dragonColourLabel,
  type DragonExtendOptions,
  type DragonMove,
  type DragonNode,
  type Rule3Technique,
} from './sudoku/SudokuDragonFinder'
import { autocompleteMedusa } from './sudoku/SudokuMedusaAutocompleter'
import { foldDragonMoves } from './sudoku/dragonReplay'
import { formatCandidate, listEffectiveEliminations, type TargetProblem } from './sudoku/SudokuDragonTargetFinder'
import { FISH_TECHNIQUE_NAMES, SudokuFishFinder, type FishInstance, type FishTechnique } from './sudoku/SudokuFishFinder'
import { SudokuHiddenPairFinder } from './sudoku/SudokuHiddenPairFinder'
import { killerEliminationsText, SudokuKillerCageFinder, type KillerCageInstance } from './sudoku/SudokuKillerCageFinder'
import { SudokuEntropyFinder, type EntropySquareInstance } from './sudoku/SudokuEntropyFinder'
import { SudokuVariantLockedFinder, type VariantLockedInstance } from './sudoku/SudokuVariantLockedFinder'
import { SudokuKillerRule45Finder, type KillerRule45Instance } from './sudoku/SudokuKillerRule45Finder'
import { SudokuLockedCandidateFinder } from './sudoku/SudokuLockedCandidateFinder'
import {
  type ChainColor,
  type MassEliminationInstance,
  type MedusaChain,
  SudokuMedusaFinder,
} from './sudoku/SudokuMedusaFinder'
import { SudokuNakedSubsetFinder } from './sudoku/SudokuNakedSubsetFinder'
import { SudokuPairFinder } from './sudoku/SudokuPairFinder'
import { BOARD_SIZE, SudokuRules } from './sudoku/SudokuRules'
import { sameBox } from './sudoku/SudokuUnits'
import { SudokuGenericAicFinder } from './sudoku/SudokuGenericAicFinder'
import {
  aicChainText,
  aicChainView,
  aicNodeText,
  classifyShortAic,
  SudokuShortAicFinder,
  type AicLinkRef,
  type ShortAicInstance,
  type ShortAicKind,
  type ShortAicPattern,
} from './sudoku/SudokuShortAicFinder'
import { SudokuSingleFinder } from './sudoku/SudokuSingleFinder'
import { SudokuExtendedUniqueRectangleFinder, type ExtendedUrInstance } from './sudoku/SudokuExtendedUniqueRectangleFinder'
import { SudokuGroupedAicFinder } from './sudoku/SudokuGroupedAicFinder'
import { alsAicAlsUseText, alsAicChainText, SudokuAlsAicFinder, type AlsAicInstance } from './sudoku/SudokuAlsAicFinder'
import { SudokuSueDeCoqFinder, type SueDeCoqInstance } from './sudoku/SudokuSueDeCoqFinder'
import { explainUniqueRectangle, SudokuUniqueRectangleFinder } from './sudoku/SudokuUniqueRectangleFinder'
import {
  SudokuUrAicFinder,
  urAicChainText,
  urAicRectangleUseText,
  urBasisText,
  type UrAicInstance,
} from './sudoku/SudokuUrAicFinder'
import type { Board, CandidateGrid } from './sudoku/types'
import { RULE3_TECHNIQUE_GROUPS } from './settingsDefaults'


export const singleFinder = new SudokuSingleFinder()
export const lockedCandidateFinder = new SudokuLockedCandidateFinder()
export const pairFinder = new SudokuPairFinder()
export const nakedSubsetFinder = new SudokuNakedSubsetFinder()
export const hiddenPairFinder = new SudokuHiddenPairFinder()
export const fishFinder = new SudokuFishFinder()
export const shortAicFinder = new SudokuShortAicFinder()
export const genericAicFinder = new SudokuGenericAicFinder()
export const groupedAicFinder = new SudokuGroupedAicFinder()
export const alsXzFinder = new SudokuAlsXzFinder()
export const urAicFinder = new SudokuUrAicFinder()
export const alsAicFinder = new SudokuAlsAicFinder()
export const sueDeCoqFinder = new SudokuSueDeCoqFinder()
export const extendedUrFinder = new SudokuExtendedUniqueRectangleFinder()
export const uniqueRectangleFinder = new SudokuUniqueRectangleFinder()
export const bugPlusNFinder = new SudokuBugPlusNFinder()
export const avoidableRectangleFinder = new SudokuAvoidableRectangleFinder()
export const bivalueOddagonFinder = new SudokuBivalueOddagonFinder()
export const colorFinder = new SudokuColorFinder()
export const medusaFinder = new SudokuMedusaFinder()
export const dragonFinder = new SudokuDragonFinder()
// Variant solver only: a Classic grid has no cages, so these find nothing there.
export const killerCageFinder = new SudokuKillerCageFinder()
export const variantLockedFinder = new SudokuVariantLockedFinder()
export const entropyFinder = new SudokuEntropyFinder()
export const killerRule45Finder = new SudokuKillerRule45Finder()

// A 3x3 grid of 3x3 boxes; reused for both the box index and the cell
// index within a box, since both range over the same nine values.
export const NINE = [0, 1, 2, 3, 4, 5, 6, 7, 8]
export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export interface TechniqueCandidateRef {
  row: number
  col: number
  digit: number
}

/**
 * One instance of a technique currently applicable to the board, ready for
 * the Techniques panel: its notation, and which cells/candidates a click
 * on it should highlight (yellow = the technique's basis, red = what it
 * eliminates, green = the solution it places).
 */
export interface TechniqueInstance {
  id: string
  name: string
  notation: string
  usedCells: Array<readonly [number, number]>
  usedCandidates: TechniqueCandidateRef[]
  eliminatedCandidates: TechniqueCandidateRef[]
  solvedCandidates: TechniqueCandidateRef[]
  /** Simple Coloring/3D Medusa only: which candidates are which color, for
   * the click-to-highlight view. */
  blueCandidates?: TechniqueCandidateRef[]
  yellowCandidates?: TechniqueCandidateRef[]
  /** 3D Medusa only: the cell(s) holding the elimination or the same-cell/
   * same-unit colour contradiction that this instance rests on - drawn with
   * a yellow border distinct from the eliminated-candidate pip highlight. */
  medusaHighlightCells?: Array<readonly [number, number]>
  /** Short AIC only: the chain's 4 candidates (highlighted purple) and the
   * 3 links between consecutive ones, drawn as curved lines - solid red
   * for a strong link, dotted blue for a weak one. */
  aicCandidates?: TechniqueCandidateRef[]
  /** A link to or from a grouped node (Empty Rectangle) also carries the
   * group's cells, drawn outlined with the link meeting its middle. */
  aicLinks?: AicLinkRef[]
  /** Short Single-Digit AIC / Short AIC only: the named pattern the chain
   * is (see ShortAicPattern) and its shape in words, for the Hint popup. */
  aicPattern?: ShortAicPattern
  aicPatternText?: string
  /** Dragon Colouring only: the ordered move log driving the move-by-move
   * player. When present, the panel row opens a stepper instead of
   * highlighting statically - the colors/eliminations/solves shown come
   * from folding moves[0..step] together, not from the fields above. */
  moves?: DragonMove[]
  /** Dev-only "AIC equivalent Dragon" note in App: an equivalent Medusa or
   * Dragon shown in place of a chain carries the chain's own eliminations
   * here, so the grid can ring them (as the chain's targets) while the
   * colouring builds up. Set nowhere else. */
  aicTargetCandidates?: TechniqueCandidateRef[]
  /** This instance's difficulty tier - see the RANK_* constants below. Used
   * by the Solve Path search: the default search tie-breaks an equal-
   * eliminations choice on it, and "Easy Solve" sorts on it directly. */
  techniqueRank: number
  /** Variant solver only: set on a deduction that comes from a constraint a
   * Classic Sudoku doesn't have (a Killer cage's sum, an X-Sudoku diagonal,
   * an Anti-Knight knight's move, an Entropy 2x2 square), so the Techniques
   * list can say so. Every
   * other row is a Classic technique - on a Jigsaw, run on its regions in
   * place of the boxes. */
  variantConstraint?: 'killer' | 'x-sudoku' | 'anti-knight' | 'entropy'
  /** Double Dynamic Dragon only: a row found with an easier Dynamic Dragon
   * technique set than every single Dynamic Dragon on the grid needs (see
   * pushEasierDoubleDynamicDragons). The Solve Path's "Prefer easier double
   * dragons" ranks such a row below single Dynamic Dragon. */
  easierThanSingleDynamicDragon?: true
}

/** Numeric difficulty tier for every technique, lowest = easiest - the exact
 * order buildTechniqueInstances below pushes its blocks in (see CLAUDE.md's
 * documented difficulty order: Single -> LockedCandidate ->
 * Pair/NakedSubset/HiddenPair -> UniqueRectangle -> BUG+N -> AvoidableRectangle
 * -> BivalueOddagon
 * -> Color -> X-Wing -> Short Single-Digit AIC -> Extended UR (exotic)
 * -> Finned X-Wing -> Medusa
 * -> Short AIC -> Swordfish -> Finned Swordfish -> Sue-de-Coq (exotic)
 * -> Generic AIC -> Dragon -> Double Dragon -> Grouped AIC -> ALS-xz -> UR-AIC
 * -> ALS-AIC
 * -> Dynamic Dragon -> Double Dynamic Dragon).
 * Techniques sharing a tier are equally "simple" as far as this goes - a
 * naked pair is no simpler than a naked quad here, since a solver who can
 * spot one can spot the other; what matters is the category, not which
 * specific instance of it happened to be found. Adding a new technique?
 * Give its instances a rank here too, in its place in the difficulty order -
 * see CLAUDE.md's "Adding a technique" note. */
export const RANK_SINGLE = 0
// Killer cages (Variant solver only; nothing on a Classic grid ever has these
// ranks). Fractions, so the Classic tiers keep their numbers: what a cage's
// sum says about its own cells is the first thing a Killer solver looks at,
// right after singles (a cage with one empty cell left *is* a single, rank
// 0); a digit a cage must hold, and the Rule of 45, sit around Locked
// Candidates - all of them Basics (<= RANK_SUBSET).
export const RANK_CAGE_COMBINATIONS = 0.5
// Entropy (Variant page): what one 2x2 square says about its own four cells
// (SudokuEntropyFinder) - the rule itself applied to the candidates, so the
// first thing to look at after singles, like a cage's combinations.
export const RANK_ENTROPY_SQUARE = 0.75
export const RANK_LOCKED_CANDIDATE = 1
// X-Sudoku / Anti-Knight (Variant page): a Locked Candidate whose cells are
// seen along a diagonal or by a knight's move - the same idea as Pointing and
// Claiming, one notch harder to spot, so right after them.
export const RANK_VARIANT_LOCKED_CANDIDATE = 1.125
export const RANK_CAGE_LOCKED_CANDIDATE = 1.25
export const RANK_RULE_OF_45 = 1.5
export const RANK_SUBSET = 2 // naked pair/triple/quad, hidden pair
export const RANK_UR = 3
export const RANK_BUG_PLUS_N = 4 // BUG+1, BUG+2 and BUG+3 alike - one technique
export const RANK_AVOIDABLE_RECTANGLE = 5
export const RANK_BIVALUE_ODDAGON = 6
export const RANK_SIMPLE_COLOR = 7
// The fish interleave with the short AICs, and each fish is its own tier
// (unlike the subsets above): a Swordfish is genuinely harder to spot than an
// X-Wing, and a fin harder again.
export const RANK_X_WING = 8
export const RANK_SHORT_SINGLE_DIGIT_AIC = 9
// Exotic (off by default), ranked just after the Short Single-Digit AICs, by
// request: a Unique Rectangle on a 6-cell deadly pattern (see
// SudokuExtendedUniqueRectangleFinder).
export const RANK_EXTENDED_UR = 10
export const RANK_FINNED_X_WING = 11
// 3D Medusa before Short AIC (and so before Swordfish), by request.
export const RANK_MEDUSA = 12
export const RANK_SHORT_AIC = 13
export const RANK_SWORDFISH = 14
export const RANK_FINNED_SWORDFISH = 15
// Exotic (Technique Selections -> Exotic Techniques, off by default), but ranked before
// Generic AIC, ALS-xz and every Dragon, by request.
export const RANK_SUE_DE_COQ = 16
// Harder than 3D Medusa: a long chain is harder to find than a colouring.
export const RANK_GENERIC_AIC = 17
export const RANK_DRAGON = 18
// Two plain Dragons linked together - no Dynamic Dragon techniques.
export const RANK_DOUBLE_DRAGON = 19
// Just before ALS-xz, by request: a Generic AIC whose nodes may be groups
// (see SudokuGroupedAicFinder).
export const RANK_GROUPED_AIC = 20
// Ranked above Generic AIC - and above plain and Double plain Dragon too
// (only Dynamic Dragons rank higher), by request.
export const RANK_ALS_XZ = 21
// Just above ALS-xz, by request: an AIC that may link through a Unique
// Rectangle (see SudokuUrAicFinder).
export const RANK_UR_AIC = 22
// Just above UR-AIC, by request: an AIC that may link through an Almost
// Locked Set (see SudokuAlsAicFinder).
export const RANK_ALS_AIC = 23
export const RANK_DYNAMIC_DRAGON = 24
// Two Dragons linked, at least one of them Dynamic - only where single
// Dynamic Dragon is stuck, so the hardest tier.
export const RANK_DOUBLE_DYNAMIC_DRAGON = 25

/** Technique Selections -> Exotic Techniques: advanced techniques the solver only looks
 * for when enabled there (all off by default), each at its own rank. Never used by the puzzle
 * generator (so the stocks needn't be checked against them), and never inside Dynamic Dragon -
 * except Extended UR, which by request is also a Rule3Technique ('extended ur', its own
 * Dynamic Dragon checkbox, off by default and master-switched by this setting). */
export type ExoticTechnique = 'sue de coq' | 'extended ur'
export const ALL_EXOTIC_TECHNIQUES: readonly ExoticTechnique[] = ['sue de coq', 'extended ur']
export const EXOTIC_TECHNIQUE_NAMES: Record<ExoticTechnique, string> = {
  'sue de coq': 'Sue-de-Coq',
  'extended ur': 'Extended UR',
}

const FISH_RANKS: Record<FishTechnique, number> = {
  'x-wing': RANK_X_WING,
  'finned x-wing': RANK_FINNED_X_WING,
  swordfish: RANK_SWORDFISH,
  'finned swordfish': RANK_FINNED_SWORDFISH,
}

/** A rejected entry in plain words, for the Find tab. */
export function describeTargetProblem(problem: TargetProblem): string {
  const entry = formatCandidate(problem.ref)
  const cell = cellRef(problem.ref.row, problem.ref.col)
  switch (problem.kind) {
    case 'filled':
      return `${entry}: ${cell} is already filled in (${problem.value}).`
    case 'not-a-candidate':
      return `${entry}: ${problem.ref.digit} isn't a candidate in ${cell} right now (it may already be eliminated).`
    case 'is-the-answer':
      return `${entry}: ${problem.ref.digit} is the real answer for ${cell}, so it can't be eliminated - please double-check your entry.`
  }
}

export function cellRef(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

/** Which base Medusa chains a Dragon Colouring pass is allowed to extend:
 * 'any' is every stuck chain Medusa found, exactly like the Medusa
 * auto-solve button uses, including chains built entirely from bilocal
 * (same-digit conjugate pair) links; 'bivalue-seeded' narrows that to
 * chains that also used at least one bivalue cell link, i.e. chains that
 * couldn't have been found by single-digit Simple Coloring alone. */
export type DragonChainFilter = 'any' | 'bivalue-seeded'

/** What Autocomplete Dragon (Plain) makes of the user's painted colouring -
 * see autocompleteDragon. */
export type DragonAutocompleteOutcome =
  | { kind: 'invalid'; stage: 'medusa' | 'dragon'; problems: string[] }
  /** The Medusa proves something by itself, so it isn't a Dragon's start. */
  | { kind: 'not-stuck' }
  /** Valid, but carrying it on reaches no elimination or placement. */
  | { kind: 'no-result'; checkedMoves: number }
  | { kind: 'found'; chainKey: string; moves: DragonMove[]; checkedMoves: number }

/** Autocomplete Dragon (Plain) / Autocomplete Dynamic Dragon: carries on the
 * Dragon Colouring the user started painting. `painted` is every painted candidate in Dragon's
 * own four colours (blue/yellow = the two Medusa colours, darkBlue/orange =
 * their dragon colours). The Medusa colours are checked and the chain
 * completed exactly as Autocomplete Medusa does (autocompleteMedusa, with
 * Medusa colours outside the chain left for the Dragon check); the chain
 * must then be stuck - the same test computeStuckDragonExtensions applies -
 * and the rest is SudokuDragonFinder.continueColouring with `options` - the
 * same ones the solver passes extend() for that kind of Dragon (see
 * computeStuckDragonExtensions / computeStuckDynamicDragonExtensions). All
 * text uses Dragon's own colour names; the caller renames them to the
 * user's. */
export function autocompleteDragon(
  board: Board,
  candidates: CandidateGrid,
  painted: readonly DragonNode[],
  options: DragonExtendOptions,
): DragonAutocompleteOutcome {
  const medusaSeeds = painted.flatMap((n) =>
    n.color === 'blue' || n.color === 'yellow' ? [{ row: n.row, col: n.col, digit: n.digit, color: n.color }] : [],
  )
  // Which chain is the Medusa: the most-painted one first, then each other
  // chain holding a painted Medusa colour. Medusa growth after a promotion
  // paints its own Medusa colours on another chain, and can paint more of
  // them than the Medusa itself has. The first chain whose whole colouring
  // checks out wins; if none does, the most-painted chain's verdict stands.
  const key = (n: { row: number; col: number; digit: number }) => `${n.row},${n.col},${n.digit}`
  const tried = new Set<string>()
  let firstOutcome: DragonAutocompleteOutcome | null = null
  for (const mainSeed of [undefined, ...medusaSeeds]) {
    if (mainSeed && tried.has(key(mainSeed))) {
      continue
    }
    const outcome = autocompleteDragonFrom(board, candidates, painted, medusaSeeds, mainSeed, options, tried)
    if (outcome.kind === 'found' || outcome.kind === 'no-result') {
      return outcome
    }
    firstOutcome ??= outcome
  }
  return firstOutcome!
}

/** One attempt of autocompleteDragon, with the Medusa taken to be the chain
 * holding `mainSeed` (the most-painted chain when undefined). Adds that
 * chain's candidates to `tried`. */
function autocompleteDragonFrom(
  board: Board,
  candidates: CandidateGrid,
  painted: readonly DragonNode[],
  medusaSeeds: Array<{ row: number; col: number; digit: number; color: 'blue' | 'yellow' }>,
  mainSeed: { row: number; col: number; digit: number; color: 'blue' | 'yellow' } | undefined,
  options: DragonExtendOptions,
  tried: Set<string>,
): DragonAutocompleteOutcome {
  const medusa = autocompleteMedusa(medusaFinder, board, candidates, medusaSeeds, { blue: 'light blue', yellow: 'yellow' }, {
    allowOutside: true,
    mainSeed,
  })
  if (medusa.kind === 'invalid') {
    return { kind: 'invalid', stage: 'medusa', problems: medusa.problems }
  }
  const chain = medusa.chain
  for (const c of chain.candidates) {
    tried.add(`${c.row},${c.col},${c.digit}`)
  }
  const stuck =
    medusaFinder.findMassElimination(chain, board, candidates) === null &&
    medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
    medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
    medusaFinder.findRule5Eliminations(chain, candidates).length === 0
  if (!stuck) {
    return { kind: 'not-stuck' }
  }

  const inChain = new Set(chain.candidates.map((c) => `${c.row},${c.col},${c.digit}`))
  // The dragon colours, the Medusa colours outside the chain, and the dragon
  // colours painted onto the chain itself (checked there for the right side).
  const userNodes = painted.filter(
    (n) => n.color === 'darkBlue' || n.color === 'orange' || !inChain.has(`${n.row},${n.col},${n.digit}`),
  )
  const checked = dragonFinder.continueColouring(chain, userNodes, board, candidates, options)
  if (checked.kind === 'invalid') {
    return { kind: 'invalid', stage: 'dragon', problems: checked.problems }
  }
  if (!checked.result) {
    return { kind: 'no-result', checkedMoves: checked.checkedMoves }
  }
  const chainKey = chain.candidates
    .map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`)
    .sort()
    .join('-')
  return { kind: 'found', chainKey, moves: checked.result.moves, checkedMoves: checked.checkedMoves }
}

/** Dragon Colouring only applies once Medusa's own rules 1-5 find nothing
 * for a chain ("colour the medusa until it gets stuck"); this finds every
 * such stuck chain and extends each one, skipping chains where nothing
 * actionable comes out of the extension. Shared by the Techniques panel and
 * the Dragon colouring auto-solve buttons so the two can't drift apart. */
export function computeStuckDragonExtensions(
  board: Board,
  candidates: CandidateGrid,
  filter: DragonChainFilter = 'any',
  minBaseCandidates = 0,
  exhaustive = true,
  optimize = false,
) {
  const results: Array<{ chainKey: string; moves: DragonMove[]; hasBivalueCellLink: boolean }> = []
  for (const chain of medusaFinder.findChains(board, candidates)) {
    if (filter === 'bivalue-seeded' && !chain.hasBivalueCellLink) {
      continue
    }
    if (chain.candidates.length < minBaseCandidates) {
      continue
    }
    const stuck =
      medusaFinder.findMassElimination(chain, board, candidates) === null &&
      medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
      medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
      medusaFinder.findRule5Eliminations(chain, candidates).length === 0
    if (!stuck) {
      continue
    }
    const result = dragonFinder.extend(chain, board, candidates, { exhaustive, optimize })
    if (!result) {
      continue
    }
    const chainKey = chain.candidates
      .map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`)
      .sort()
      .join('-')
    results.push({ chainKey, moves: result.moves, hasBivalueCellLink: chain.hasBivalueCellLink })
  }
  return results
}

/** Dynamic Dragon Colouring: the same stuck-chain search as plain Dragon
 * Colouring, but only surfacing chains where the *dynamic* extension
 * (Extension Rule 3 - naked pairs and Unique Rectangle (any type) propagated
 * through a side's assumption) was actually necessary. A chain plain
 * Dragon Colouring can already resolve is left to that technique instead,
 * so the two never both claim the same chain. */
export function computeStuckDynamicDragonExtensions(
  board: Board,
  candidates: CandidateGrid,
  filter: DragonChainFilter = 'any',
  minBaseCandidates = 0,
  allowedRule3Techniques: ReadonlySet<Rule3Technique> = new Set(DEFAULT_RULE3_TECHNIQUES),
  aicLimitPerStep = true,
  exhaustive = true,
  optimize = false,
  optimizeDynamic = false,
  maxTechniquesPerStep = Infinity,
  givens: GivenMask | null = null,
) {
  const results: Array<{ chainKey: string; moves: DragonMove[]; hasBivalueCellLink: boolean }> = []
  for (const chain of medusaFinder.findChains(board, candidates)) {
    if (filter === 'bivalue-seeded' && !chain.hasBivalueCellLink) {
      continue
    }
    if (chain.candidates.length < minBaseCandidates) {
      continue
    }
    const stuck =
      medusaFinder.findMassElimination(chain, board, candidates) === null &&
      medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
      medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
      medusaFinder.findRule5Eliminations(chain, candidates).length === 0
    if (!stuck) {
      continue
    }
    // Exhaustive is left off for this check: whether plain Dragon resolves a
    // chain at all is decided by its first elimination, so running on past
    // it would only cost time.
    if (dragonFinder.extend(chain, board, candidates)) {
      // Plain Dragon Colouring already handles this chain.
      continue
    }
    // Optimize Dynamic Dragons implies the optimized search for Dynamic
    // Dragons, whether or not Optimize Dragons (plain) is on.
    const result = dragonFinder.extend(chain, board, candidates, {
      dynamic: true,
      allowedRule3Techniques,
      aicLimitPerStep,
      maxTechniquesPerStep,
      givens,
      exhaustive,
      optimize: optimize || optimizeDynamic,
      optimizeDynamic,
    })
    if (!result) {
      continue
    }
    const chainKey = chain.candidates
      .map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`)
      .sort()
      .join('-')
    results.push({ chainKey, moves: result.moves, hasBivalueCellLink: chain.hasBivalueCellLink })
  }
  return results
}

/** Double Dragon Colouring (SudokuDragonFinder.findDoubleDragons) on every
 * pair of stuck chains. Pairs whose results make exactly the same
 * eliminations and placements are listed once, keeping the shortest log. */
export function computeDoubleDragonExtensions(
  board: Board,
  candidates: CandidateGrid,
  minBaseCandidates = 0,
  exhaustive = true,
  optimize = false,
) {
  const chains = medusaFinder.findChains(board, candidates).filter(
    (chain) =>
      medusaFinder.findMassElimination(chain, board, candidates) === null &&
      medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
      medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
      medusaFinder.findRule5Eliminations(chain, candidates).length === 0,
  )
  const chainKey = (chain: MedusaChain) =>
    chain.candidates
      .map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`)
      .sort()
      .join('-')
  const byEffect = new Map<string, { chainKey: string; moves: DragonMove[] }>()
  for (const { first, second, moves } of dragonFinder.findDoubleDragons(chains, board, candidates, {
    exhaustive,
    optimize,
    minBaseCandidates,
  })) {
    const effect = [
      ...moves.flatMap((m) => m.eliminated.map((e) => `x${e.row}${e.col}${e.digit}`)),
      ...moves.flatMap((m) => m.solved.map((e) => `s${e.row}${e.col}${e.digit}`)),
    ]
      .sort()
      .join(',')
    const existing = byEffect.get(effect)
    if (!existing || moves.length < existing.moves.length) {
      byEffect.set(effect, { chainKey: `${chainKey(first)}~${chainKey(second)}`, moves })
    }
  }
  return Array.from(byEffect.values())
}

/** Double Dynamic Dragon Colouring: Double Dragon Colouring where the Dragons
 * may use Extension Rule 3 (findDoubleDragons with Dynamic limits - so both
 * chains are ones single Dynamic Dragon is stuck on). A result counts only
 * when at least one of its Dragons really is Dynamic (some step of either is
 * an Extension Rule 3 move); without one it would be a plain Double Dragon.
 * A pair plain Double Dragon resolves is left to that technique while it is
 * enabled, the way a chain plain Dragon resolves is never also listed as
 * Dynamic. `minBaseCandidates` applies to the first Dragon's Medusa. Same
 * effect-deduplication as computeDoubleDragonExtensions. */
export function computeDoubleDynamicDragonExtensions(
  board: Board,
  candidates: CandidateGrid,
  minBaseCandidates = 0,
  allowedRule3Techniques: ReadonlySet<Rule3Technique> = new Set(DEFAULT_RULE3_TECHNIQUES),
  aicLimitPerStep = true,
  maxTechniquesPerStep = Infinity,
  exhaustive = true,
  optimize = false,
  optimizeDynamic = false,
  doublePlainEnabled = false,
  givens: GivenMask | null = null,
) {
  const chains = medusaFinder.findChains(board, candidates).filter(
    (chain) =>
      medusaFinder.findMassElimination(chain, board, candidates) === null &&
      medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
      medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
      medusaFinder.findRule5Eliminations(chain, candidates).length === 0,
  )
  const chainKey = (chain: MedusaChain) =>
    chain.candidates
      .map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`)
      .sort()
      .join('-')
  const plainPairs = new Set(
    doublePlainEnabled
      ? dragonFinder
          .findDoubleDragons(chains, board, candidates, { minBaseCandidates })
          .map(({ first, second }) => `${chainKey(first)}~${chainKey(second)}`)
      : [],
  )
  const byEffect = new Map<string, { chainKey: string; moves: DragonMove[] }>()
  for (const { first, second, moves } of dragonFinder.findDoubleDragons(chains, board, candidates, {
    exhaustive,
    // Optimize Dynamic Dragons implies the optimized search, as for a single
    // Dynamic Dragon.
    optimize: optimize || optimizeDynamic,
    optimizeDynamic,
    minBaseCandidates,
    dynamic: { allowedRule3Techniques, aicLimitPerStep, maxTechniquesPerStep, givens },
  })) {
    const key = `${chainKey(first)}~${chainKey(second)}`
    if (plainPairs.has(key) || !moves.some(isDynamicDragonMove)) {
      continue
    }
    const effect = dragonEffectKey(moves)
    const existing = byEffect.get(effect)
    if (!existing || moves.length < existing.moves.length) {
      byEffect.set(effect, { chainKey: key, moves })
    }
  }
  return Array.from(byEffect.values())
}

/** Every distinct candidate eliminated by a Short AIC chain of the given
 * kind - split this way so auto-solve's two separate buttons (Short
 * Single-Digit AIC, Short AIC) each apply only their own kind, matching
 * their own independent enable/disable settings. Unlike the Techniques
 * panel, this never suppresses an elimination just because an easier
 * technique also finds it - auto-solve applying the same elimination twice
 * over via two different buttons is harmless. */
export function computeShortAicEliminationsByKind(
  board: Board,
  candidates: CandidateGrid,
  kind: ShortAicKind,
): Array<{ row: number; col: number; digit: number }> {
  const eliminations = new Map<string, { row: number; col: number; digit: number }>()
  for (const aic of shortAicFinder.findShortAics(board, candidates)) {
    if (classifyShortAic(aic) !== kind) {
      continue
    }
    for (const e of aic.eliminations) {
      eliminations.set(`${e.row},${e.col},${e.digit}`, e)
    }
  }
  return Array.from(eliminations.values())
}

/** Every distinct candidate eliminated by a Generic AIC (chains longer than
 * Short AIC's, up to GENERIC_AIC_MAX_LENGTH links) - what the Generic AIC
 * auto-solve button applies. */
export function computeGenericAicEliminations(
  board: Board,
  candidates: CandidateGrid,
): Array<{ row: number; col: number; digit: number }> {
  const eliminations = new Map<string, { row: number; col: number; digit: number }>()
  for (const aic of genericAicFinder.findGenericAics(board, candidates)) {
    for (const e of aic.eliminations) {
      eliminations.set(`${e.row},${e.col},${e.digit}`, e)
    }
  }
  return Array.from(eliminations.values())
}

/** A Techniques-panel row for one AIC chain (any kind): the chain written out
 * as `digit cell = digit cell - ...`, what it proves, and the chain's links
 * for the purple/curved-line drawing on the grid. */
export function buildAicInstance(aic: ShortAicInstance, idPrefix: string, name: string): TechniqueInstance {
  const x = aic.nodes[0]
  const y = aic.nodes[aic.nodes.length - 1]
  const eliminationText = aic.eliminations.map((e) => `${cellRef(e.row, e.col)} cannot be ${e.digit}`).join(', ')
  const techniqueRank =
    idPrefix === 'short-single-digit-aic'
      ? RANK_SHORT_SINGLE_DIGIT_AIC
      : idPrefix === 'short-aic'
        ? RANK_SHORT_AIC
        : idPrefix === 'grouped-aic'
          ? RANK_GROUPED_AIC
          : RANK_GENERIC_AIC
  // A grouped end reads "2 in (r8c3, r9c3)": one of those cells is the digit.
  const endText = (n: typeof x) => (n.cells ? `${n.digit} in (${n.cells.map(([r, c]) => cellRef(r, c)).join(', ')})` : aicNodeText(n))
  const view = aicChainView(aic)
  // A W-Wing is explained as the contradiction it is, in the user's own
  // wording, instead of as a chain.
  const wWing = aic.wWing
  const notation = wWing
    ? `If any of these eliminated candidates (${aic.eliminations.map((e) => `${e.digit}${cellRef(e.row, e.col)}`).join(', ')}) were true, ` +
      `then it would force the remote pair {${wWing.digits.join(',')}} in ${wWing.cells.map(([r, c]) => cellRef(r, c)).join(', ')} to both be ${wWing.linkDigit}. ` +
      `This would mean there are no places for ${wWing.linkDigit} in ${wWing.unitName}, which is impossible!`
    : `${aicChainText(aic.nodes)} states that either ${endText(x)} or ${endText(y)} must be true, so ${eliminationText}.` +
      // A Y-Wing reads like any chain, then names its cells.
      (aic.yWing
        ? ` Pivot cell is ${cellRef(...aic.yWing.pivot)}; wing cells are ${aic.yWing.wings.map(([r, c]) => cellRef(r, c)).join(', ')}.`
        : '')
  return {
    id: `${idPrefix}-${aic.eliminationType}-${view.candidates.map((n) => `${n.row}.${n.col}.${n.digit}`).join('-')}`,
    name,
    // A named single-digit pattern (Skyscraper, Empty Rectangle, ...) reads
    // like any AIC: the row's name already says which it is, and its shape
    // in words (patternText) is left to the Hint popup.
    notation,
    usedCells: [],
    usedCandidates: [],
    eliminatedCandidates: aic.eliminations,
    solvedCandidates: [],
    aicCandidates: view.candidates,
    aicLinks: view.links,
    ...(aic.pattern ? { aicPattern: aic.pattern, aicPatternText: aic.patternText } : {}),
    techniqueRank,
  }
}

/** What a 3D Medusa chain proves, as the Techniques panel's row for it: its
 * mass elimination (rules 1-2, if any) plus every rule 3/4/5 elimination not
 * already covered by it, or null when the chain proves nothing. Shared by
 * buildTechniqueInstances and the "Autocomplete Colours" tab (which builds
 * the chain from the user's own painting instead of findChains), so both
 * describe a chain identically. `colorNames` only changes the wording - the
 * tab names the user's own paint colours ("light blue") instead of the
 * chain's internal blue/yellow sides. */
export function buildMedusaChainInstance(
  chain: MedusaChain,
  board: Board,
  candidates: CandidateGrid,
  colorNames: Record<ChainColor, string> = { blue: 'blue', yellow: 'yellow' },
): { instance: TechniqueInstance; hasMassElimination: boolean } | null {
  const chainKey = chain.candidates
    .map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`)
    .sort()
    .join('-')
  const blueCandidates = chain.candidates
    .filter((c) => c.color === 'blue')
    .map((c) => ({ row: c.row, col: c.col, digit: c.digit }))
  const yellowCandidates = chain.candidates
    .filter((c) => c.color === 'yellow')
    .map((c) => ({ row: c.row, col: c.col, digit: c.digit }))

  const rules = new Set<number>()
  const clauses: string[] = []
  const usedCandidates: TechniqueCandidateRef[] = []
  const eliminatedByKey = new Map<string, TechniqueCandidateRef>()
  const solvedCandidates: TechniqueCandidateRef[] = []
  const medusaHighlightCells: Array<readonly [number, number]> = []
  const eliminate = (row: number, col: number, digit: number) => {
    eliminatedByKey.set(`${row}.${col}.${digit}`, { row, col, digit })
  }

  const mass = medusaFinder.findMassElimination(chain, board, candidates)
  // When rule 1 or 2 settles which colour is true, a rule 3-5 finding
  // whose eliminations placing that colour would make anyway adds nothing
  // - it's left out of the row (title, text and highlights) entirely.
  const coveredByMass = mass ? medusaMassCoverage(mass, candidates) : null
  const coveredByMassDeduction = (row: number, col: number, digit: number) =>
    coveredByMass?.has(`${row}.${col}.${digit}`) ?? false
  if (mass) {
    if (mass.conflict.kind === 'cell') {
      rules.add(1)
      clauses.push(
        `In ${cellRef(mass.conflict.row, mass.conflict.col)}, ${mass.conflict.digitA} and ${mass.conflict.digitB} are both ${colorNames[mass.conflict.color]}, so ${colorNames[mass.conflict.color]} is false and ${colorNames[mass.trueColor]} is true.`,
      )
      medusaHighlightCells.push([mass.conflict.row, mass.conflict.col])
    } else if (mass.conflict.kind === 'unit') {
      rules.add(1)
      clauses.push(
        `${mass.conflict.digit} in ${cellRef(...mass.conflict.a)}, ${cellRef(...mass.conflict.b)} are both ${colorNames[mass.conflict.color]}, so ${colorNames[mass.conflict.color]} is false and ${colorNames[mass.trueColor]} is true.`,
      )
      medusaHighlightCells.push(mass.conflict.a, mass.conflict.b)
    } else {
      rules.add(2)
      clauses.push(
        `${cellRef(mass.conflict.row, mass.conflict.col)} has no coloured candidates, but ${mass.conflict.digits.join(', ')} all see ${colorNames[mass.conflict.color]}, so ${colorNames[mass.conflict.color]} is false and ${colorNames[mass.trueColor]} is true.`,
      )
      medusaHighlightCells.push([mass.conflict.row, mass.conflict.col])
    }
    for (const c of mass.eliminatedCandidates) {
      eliminate(c.row, c.col, c.digit)
    }
    solvedCandidates.push(...mass.solvedCells.map((c) => ({ row: c.row, col: c.col, digit: c.digit })))
  }

  for (const r3 of medusaFinder.findRule3Eliminations(chain, board, candidates)) {
    if (coveredByMassDeduction(r3.row, r3.col, r3.digit)) {
      continue
    }
    rules.add(3)
    clauses.push(
      `${cellRef(r3.row, r3.col)} cannot be ${r3.digit} (it sees both colours: ${cellRef(...r3.blueSeen)}, ${cellRef(...r3.yellowSeen)}).`,
    )
    eliminate(r3.row, r3.col, r3.digit)
    medusaHighlightCells.push([r3.row, r3.col])
  }

  for (const r4 of medusaFinder.findRule4Eliminations(chain, candidates)) {
    if (r4.eliminatedDigits.every((digit) => coveredByMassDeduction(r4.row, r4.col, digit))) {
      continue
    }
    rules.add(4)
    const sortedDigits = [...r4.eliminatedDigits].sort((a, b) => a - b)
    const value = sortedDigits.length === 1 ? `${sortedDigits[0]}` : `[${sortedDigits.join(',')}]`
    clauses.push(`${cellRef(r4.row, r4.col)} is not ${value} (it holds both colours).`)
    usedCandidates.push(...r4.coloredCandidates.map((c) => ({ row: c.row, col: c.col, digit: c.digit })))
    for (const digit of r4.eliminatedDigits) {
      eliminate(r4.row, r4.col, digit)
    }
    medusaHighlightCells.push([r4.row, r4.col])
  }

  for (const r5 of medusaFinder.findRule5Eliminations(chain, candidates)) {
    if (coveredByMassDeduction(r5.row, r5.col, r5.eliminatedDigit)) {
      continue
    }
    rules.add(5)
    const opponentColor = colorNames[r5.coloredColor === 'blue' ? 'yellow' : 'blue']
    clauses.push(
      `${cellRef(r5.row, r5.col)} is not ${r5.eliminatedDigit} (it sees opposite colour ${opponentColor} at ${cellRef(...r5.opponent)}).`,
    )
    usedCandidates.push({ row: r5.row, col: r5.col, digit: r5.coloredDigit })
    eliminate(r5.row, r5.col, r5.eliminatedDigit)
    medusaHighlightCells.push([r5.row, r5.col])
  }

  if (rules.size === 0) {
    return null
  }
  const ruleList = [...rules].sort((a, b) => a - b)
  const instance: TechniqueInstance = {
    id: `medusa-${chainKey}`,
    name: `3D Medusa ${ruleList.length === 1 ? 'Rule' : 'Rules'} ${ruleList.join(',')}`,
    notation: clauses.join(' '),
    usedCells: [],
    usedCandidates,
    eliminatedCandidates: [...eliminatedByKey.values()],
    solvedCandidates,
    blueCandidates,
    yellowCandidates,
    medusaHighlightCells,
    techniqueRank: RANK_MEDUSA,
  }
  return { instance, hasMassElimination: mass !== null }
}

/** Builds the live list of technique instances the current board/candidates
 * support - recomputed from scratch whenever either changes, so it always
 * reflects exactly what's happening on the grid right now.
 * When a new technique is added to the app, add its instances here too, so
 * the Techniques panel stays a complete list of everything implemented. */
/** Every candidate a 3D Medusa mass elimination (rules 1-2) removes once
 * it's applied, as "row.col.digit" keys: the false colour's candidates, plus
 * what placing each true-colour digit knocks out - the other candidates in
 * its cell and that digit in every peer. The finder only reports the first
 * part; the second is what lets the Techniques panel drop rule 3-5
 * findings from the same chain that the placements already make redundant. */
export function medusaMassCoverage(mass: MassEliminationInstance, candidates: CandidateGrid): Set<string> {
  const covered = new Set(mass.eliminatedCandidates.map((c) => `${c.row}.${c.col}.${c.digit}`))
  for (const placed of mass.solvedCells) {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const sameCell = row === placed.row && col === placed.col
        const peer =
          !sameCell &&
          (row === placed.row || col === placed.col || sameBox(row, col, placed.row, placed.col))
        for (let digit = 1; digit <= 9; digit++) {
          if (candidates[row][col][digit - 1] && ((sameCell && digit !== placed.digit) || (peer && digit === placed.digit))) {
            covered.add(`${row}.${col}.${digit}`)
          }
        }
      }
    }
  }
  return covered
}

/** Easy Solve's solve path picks the lowest-ranked row and nothing else
 * (pickEasiestInstance), so buildTechniqueInstances can stop at the first
 * difficulty tier with a row instead of working out every harder technique
 * too. The list it returns then holds every row of the rank that gets picked
 * (rows of one rank are always pushed together, and nothing easier was there
 * to hide any of them), so the pick is exactly the full list's.
 *
 * Why it matters: with every technique on, a state's Dynamic and Double
 * Dynamic Dragon rows take seconds, and they were computed at every step just
 * to be outranked by a Locked Candidate or a plain Dragon - about 175 of the
 * 185 seconds of a user-reported 81-step path (2026-10-04, see
 * dragon-research/solve-path-perf/). */
export interface EasiestTierOnly {
  /** pickEasiestInstance's second argument: an easier Double Dynamic Dragon
   * then ranks below single Dynamic Dragon, so a state that has Dynamic
   * Dragon rows needs its Double Dynamic rows too. */
  preferEasierDoubleDragons: boolean
}

export function buildTechniqueInstances(
  board: Board,
  candidates: CandidateGrid,
  minBaseMedusaCandidates = 0,
  allowedRule3Techniques: ReadonlySet<Rule3Technique> = new Set(DEFAULT_RULE3_TECHNIQUES),
  shortAicEnabled = true,
  shortSingleDigitAicEnabled = true,
  aicLimitPerDragonStep = true,
  exhaustiveDragon = true,
  genericAicEnabled = false,
  optimizeDragons = false,
  optimizeDynamicDragons = false,
  dynamicDragonEnabled = true,
  enabledFish: ReadonlySet<FishTechnique> = new Set(),
  alsXzEnabled = false,
  maxTechniquesPerDragonStep = Infinity,
  doubleDragonEnabled = false,
  doubleDynamicDragonEnabled = false,
  // Which cells are givens - only Avoidable Rectangle needs it, and it is
  // skipped (here and inside Dynamic Dragon) without one.
  givens: GivenMask | null = null,
  enabledExotic: ReadonlySet<ExoticTechnique> = new Set(),
  urAicEnabled = false,
  alsAicEnabled = false,
  groupedAicEnabled = false,
  // The "All Possible Techniques" setting (Techniques list only - the solve
  // path never passes it): a row is no longer hidden because easier rows
  // already make its eliminations, unless those are Basic Techniques rows.
  allPossibleTechniques = false,
  // Easy Solve's solve path only (see EasiestTierOnly): stop at the first
  // difficulty tier that has a row.
  easiestTierOnly: EasiestTierOnly | false = false,
  // The Techniques tab's own "Prefer easiest techs within dragon" (the list
  // only; the solve path never passes it - its picker has its own setting and
  // doesn't read the order): Dynamic and Double Dynamic Dragon rows are
  // listed easiest techniques first, then shortest, instead of shortest first.
  easiestDragonTechniquesFirst = false,
): TechniqueInstance[] {
  const instances: TechniqueInstance[] = []
  // The order of a batch of Dragon rows of one kind. The key is the one
  // pickEasiestInstance compares under the Solve Path's setting of the same
  // name, so a list in this order starts with the Dragon that would pick.
  const sortDragonRows = (extensions: { moves: DragonMove[] }[]) => {
    if (!easiestDragonTechniquesFirst) {
      extensions.sort((a, b) => a.moves.length - b.moves.length)
      return
    }
    const demands = new Map(extensions.map((extension) => [extension, dragonMovesTechniqueDemand(extension.moves)]))
    extensions.sort((a, b) => {
      const demandA = demands.get(a)!
      const demandB = demands.get(b)!
      return (
        demandA.hardestGroup - demandB.hardestGroup ||
        demandA.mostTechniquesInOneStep - demandB.mostTechniquesInOneStep ||
        a.moves.length - b.moves.length
      )
    })
  }
  const easiestFound = () => easiestTierOnly !== false && instances.length > 0
  const pushUnlessCovered = (rows: TechniqueInstance[], coveringRows: readonly TechniqueInstance[] = instances) =>
    pushUnlessCoveredByEasier(instances, rows, coveringRows, allPossibleTechniques)

  for (const { row, col, digit } of singleFinder.findNakedSingles(board, candidates)) {
    instances.push({
      id: `naked-single-${row}-${col}`,
      name: 'Naked Single',
      notation: `${cellRef(row, col)} is ${digit}`,
      usedCells: [[row, col]],
      usedCandidates: [],
      eliminatedCandidates: [],
      solvedCandidates: [{ row, col, digit }],
      techniqueRank: RANK_SINGLE,
    })
  }

  const seenHiddenSingles = new Set<string>()
  for (const { row, col, digit } of singleFinder.findHiddenSingles(board, candidates)) {
    const key = `${row},${col},${digit}`
    if (seenHiddenSingles.has(key)) {
      continue
    }
    seenHiddenSingles.add(key)
    instances.push({
      id: `hidden-single-${row}-${col}-${digit}`,
      name: 'Hidden Single',
      notation: `${cellRef(row, col)} is ${digit}`,
      usedCells: [[row, col]],
      usedCandidates: [],
      eliminatedCandidates: [],
      solvedCandidates: [{ row, col, digit }],
      techniqueRank: RANK_SINGLE,
    })
  }
  // Killer cages (none on a Classic grid). A cage with one empty cell left is
  // a single of its own kind; the combinations come next.
  const cageRows = killerCageFinder.find(board, candidates)
  instances.push(...cageRows.filter((cage) => cage.kind === 'sum').map(buildKillerCageInstance))
  if (easiestFound()) {
    return instances
  }
  instances.push(...cageRows.filter((cage) => cage.kind === 'combinations').map(buildKillerCageInstance))
  if (easiestFound()) {
    return instances
  }
  // Entropy (nothing on any other grid): a 2x2 square's own deductions.
  instances.push(...entropyFinder.find(board, candidates).map(buildEntropySquareInstance))
  if (easiestFound()) {
    return instances
  }

  for (const locked of lockedCandidateFinder.findInstances(board, candidates)) {
    const typeLabel = locked.type === 'pointing' ? 'Pointing' : 'Claiming'
    const cellsLabel = [...locked.eliminations]
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((e) => cellRef(e.row, e.col))
      .join(', ')

    instances.push({
      id: `locked-candidate-${locked.type}-${locked.digit}-${locked.basisCells.map(([row, col]) => `${row}.${col}`).join('-')}`,
      name: `Locked Candidate (${typeLabel})`,
      notation: `Locked Candidate (${typeLabel}) - ${cellsLabel} cannot be a ${locked.digit}.`,
      usedCells: locked.basisCells,
      usedCandidates: locked.basisCells.map(([row, col]) => ({ row, col, digit: locked.digit })),
      eliminatedCandidates: locked.eliminations,
      solvedCandidates: [],
      techniqueRank: RANK_LOCKED_CANDIDATE,
    })
  }
  if (easiestFound()) {
    return instances
  }

  // X-Sudoku / Anti-Knight (nothing on any other grid): locked candidates
  // through a diagonal or a knight's move.
  instances.push(...variantLockedFinder.find(board, candidates).map(buildVariantLockedInstance))
  if (easiestFound()) {
    return instances
  }

  pushUnlessCovered(cageRows.filter((cage) => cage.kind === 'locked').map(buildKillerCageInstance))
  if (easiestFound()) {
    return instances
  }
  instances.push(...killerRule45Finder.find(board, candidates).map(buildKillerRule45Instance))
  if (easiestFound()) {
    return instances
  }

  for (const pair of pairFinder.findNakedPairs(board, candidates)) {
    const [[rowA, colA], [rowB, colB]] = pair.cells
    const [digitA, digitB] = pair.digits

    // Group eliminations by cell - a cell might only have had one of the
    // pair's two digits as a candidate, so each cell states exactly which
    // digit(s) it loses rather than assuming both.
    const byCell = new Map<string, { row: number; col: number; digits: number[] }>()
    for (const elimination of pair.eliminations) {
      const key = `${elimination.row},${elimination.col}`
      const entry = byCell.get(key) ?? { row: elimination.row, col: elimination.col, digits: [] }
      entry.digits.push(elimination.digit)
      byCell.set(key, entry)
    }
    const results = Array.from(byCell.values())
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map(({ row, col, digits }) => {
        const sorted = [...digits].sort((a, b) => a - b)
        const value = sorted.length === 1 ? `${sorted[0]}` : `[${sorted.join(',')}]`
        return `${cellRef(row, col)} is not ${value}`
      })

    instances.push({
      id: `naked-pair-${rowA}-${colA}-${rowB}-${colB}`,
      name: 'Naked Pair',
      notation: `${cellRef(rowA, colA)}, ${cellRef(rowB, colB)} => ${results.join(', ')}`,
      usedCells: [
        [rowA, colA],
        [rowB, colB],
      ],
      usedCandidates: [
        { row: rowA, col: colA, digit: digitA },
        { row: rowA, col: colA, digit: digitB },
        { row: rowB, col: colB, digit: digitA },
        { row: rowB, col: colB, digit: digitB },
      ],
      eliminatedCandidates: pair.eliminations,
      solvedCandidates: [],
      techniqueRank: RANK_SUBSET,
    })
  }

  for (const size of [3, 4] as const) {
    const label = size === 3 ? 'Naked Triple' : 'Naked Quad'
    const idPrefix = size === 3 ? 'naked-triple' : 'naked-quad'
    const finderResults = size === 3 ? nakedSubsetFinder.findNakedTriples(board, candidates) : nakedSubsetFinder.findNakedQuads(board, candidates)

    for (const subset of finderResults) {
      const byCell = new Map<string, { row: number; col: number; digits: number[] }>()
      for (const elimination of subset.eliminations) {
        const key = `${elimination.row},${elimination.col}`
        const entry = byCell.get(key) ?? { row: elimination.row, col: elimination.col, digits: [] }
        entry.digits.push(elimination.digit)
        byCell.set(key, entry)
      }
      const results = Array.from(byCell.values())
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map(({ row, col, digits }) => {
          const sorted = [...digits].sort((a, b) => a - b)
          const value = sorted.length === 1 ? `${sorted[0]}` : `[${sorted.join(',')}]`
          return `${cellRef(row, col)} is not ${value}`
        })
      const cellsLabel = subset.cells.map(([row, col]) => cellRef(row, col)).join(', ')

      instances.push({
        id: `${idPrefix}-${subset.cells.map(([row, col]) => `${row}.${col}`).join('-')}`,
        name: label,
        notation: `${cellsLabel} => ${results.join(', ')}`,
        usedCells: subset.cells,
        usedCandidates: subset.cells.flatMap(([row, col]) =>
          subset.digits.filter((digit) => candidates[row][col][digit - 1]).map((digit) => ({ row, col, digit })),
        ),
        eliminatedCandidates: subset.eliminations,
        solvedCandidates: [],
        techniqueRank: RANK_SUBSET,
      })
    }
  }

  for (const pair of hiddenPairFinder.findHiddenPairs(board, candidates)) {
    const [[rowA, colA], [rowB, colB]] = pair.cells
    const [digitA, digitB] = pair.digits

    const byCell = new Map<string, { row: number; col: number; digits: number[] }>()
    for (const elimination of pair.eliminations) {
      const key = `${elimination.row},${elimination.col}`
      const entry = byCell.get(key) ?? { row: elimination.row, col: elimination.col, digits: [] }
      entry.digits.push(elimination.digit)
      byCell.set(key, entry)
    }
    const results = Array.from(byCell.values())
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map(({ row, col, digits }) => {
        const sorted = [...digits].sort((a, b) => a - b)
        const value = sorted.length === 1 ? `${sorted[0]}` : `[${sorted.join(',')}]`
        return `${cellRef(row, col)} is not ${value}`
      })

    instances.push({
      id: `hidden-pair-${rowA}-${colA}-${rowB}-${colB}-${digitA}-${digitB}`,
      name: 'Hidden Pair',
      notation: `${cellRef(rowA, colA)}, ${cellRef(rowB, colB)} hide ${digitA},${digitB} => ${results.join(', ')}`,
      usedCells: [
        [rowA, colA],
        [rowB, colB],
      ],
      usedCandidates: [
        { row: rowA, col: colA, digit: digitA },
        { row: rowA, col: colA, digit: digitB },
        { row: rowB, col: colB, digit: digitA },
        { row: rowB, col: colB, digit: digitB },
      ],
      eliminatedCandidates: pair.eliminations,
      solvedCandidates: [],
      techniqueRank: RANK_SUBSET,
    })
  }
  if (easiestFound()) {
    return instances
  }

  for (const ur of uniqueRectangleFinder.find(board, candidates)) {
    const explanation = explainUniqueRectangle(ur, candidates)
    const idSuffix = ur.cells.map(([row, col]) => `${row}.${col}`).join('-')

    instances.push({
      id: `ur-${ur.type.replace(/\s+/g, '').toLowerCase()}-${idSuffix}-${ur.urDigits.join(',')}`,
      name: `Unique Rectangle (${explanation.typeLabel === 'Type 7d' ? 'Type 7d, Hidden Rectangle' : explanation.typeLabel})`,
      notation: explanation.text,
      usedCells: [...ur.cells, ...(ur.subsetCells ?? [])],
      usedCandidates: [
        ...ur.cells.flatMap(([row, col]) => ur.urDigits.map((digit) => ({ row, col, digit }))),
        // Type 3's naked-subset partners: every mark they hold is part of
        // the subset.
        ...(ur.subsetCells ?? []).flatMap(([row, col]) =>
          markedCandidateDigits(candidates[row][col]).map((digit) => ({ row, col, digit })),
        ),
      ],
      eliminatedCandidates: ur.eliminatedCandidates,
      solvedCandidates: ur.solvedCandidates,
      medusaHighlightCells: [...ur.reasonCells],
      techniqueRank: RANK_UR,
    })
  }
  if (easiestFound()) {
    return instances
  }

  // BUG+N: one technique and rank, named by its N in the UI (BUG+1/2/3).
  // The id carries N (bug-plus-n-2-...) so the Hint popup and the How It
  // Works link can tell them apart.
  const bug = bugPlusNFinder.find(board, candidates)
  if (bug?.solved) {
    const { row, col, digit } = bug.solved
    const [{ candidates: cellCandidates, unit, unitKind }] = bug.cells
    instances.push({
      id: `bug-plus-n-1-${row}.${col}`,
      name: bugPlusNName(bug),
      notation: `${cellRef(row, col)} (candidates ${cellCandidates.join(',')}) is the only cell with more than two candidates; ${digit} appears 3 times in its ${unitKind}, so ${cellRef(row, col)} is ${digit}`,
      usedCells: [...(unit ?? [])],
      usedCandidates: (unit ?? [])
        .filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1])
        .map(([r, c]) => ({ row: r, col: c, digit })),
      eliminatedCandidates: [],
      solvedCandidates: [{ row, col, digit }],
      techniqueRank: RANK_BUG_PLUS_N,
    })
  } else if (bug) {
    instances.push({
      id: `bug-plus-n-${bug.n}-${bug.cells.map(({ cell: [r, c] }) => `${r}.${c}`).join('-')}`,
      name: bugPlusNName(bug),
      notation: `${bugPlusNReasonText(bug)}. So ${bugPlusNEliminationsText(bug)}`,
      usedCells: bug.cells.map(({ cell }) => cell),
      usedCandidates: bug.cells.map(({ cell: [row, col], bugDigit }) => ({ row, col, digit: bugDigit })),
      eliminatedCandidates: [...bug.eliminations],
      solvedCandidates: [],
      techniqueRank: RANK_BUG_PLUS_N,
    })
  }
  if (easiestFound()) {
    return instances
  }

  // Two Type 1 rectangles can rule out the same candidate - one row for it.
  const avoidableRectangleEffects = new Set<string>()
  for (const ar of avoidableRectangleFinder.find(board, candidates, givens)) {
    const effectKey = ar.eliminations.map((e) => `${e.row},${e.col},${e.digit}`).join(';')
    if (avoidableRectangleEffects.has(effectKey)) {
      continue
    }
    avoidableRectangleEffects.add(effectKey)
    const unsolvedCells = ar.cells.filter(([r, c]) => board[r][c] === 0)
    instances.push({
      id: `avoidable-rectangle-${ar.type}-${ar.cells.map(([r, c]) => `${r}.${c}`).join('-')}-${effectKey}`,
      name: `Avoidable Rectangle (Type ${ar.type})`,
      notation:
        `Avoidable Rectangle Type ${ar.type} of {${ar.digits.join(',')}} at ${ar.cells.map(([r, c]) => cellRef(r, c)).join(', ')}, ` +
        `${ar.reasonText}, thus ${ar.eliminations.map((e) => `${cellRef(e.row, e.col)} cannot be ${e.digit}`).join(', ')}`,
      usedCells: [...ar.cells],
      // Type 2: the unsolved corners' marks (the completing digit and the
      // extra one) are the pattern.
      usedCandidates:
        ar.type === 2
          ? unsolvedCells.flatMap(([r, c]) => markedCandidateDigits(candidates[r][c]).map((digit) => ({ row: r, col: c, digit })))
          : [],
      eliminatedCandidates: ar.eliminations,
      solvedCandidates: [],
      techniqueRank: RANK_AVOIDABLE_RECTANGLE,
    })
  }
  if (easiestFound()) {
    return instances
  }

  for (const oddagon of bivalueOddagonFinder.find(board, candidates)) {
    const [a, b] = oddagon.loopDigits
    const cellsLabel = oddagon.cells.map(([row, col]) => cellRef(row, col)).join(', ')
    const guardianCellsLabel = oddagon.guardianCells.map(([row, col]) => cellRef(row, col)).join(', ')
    const guardianKeys = new Set(oddagon.guardianCells.map(([row, col]) => `${row},${col}`))
    const usedCandidates = oddagon.cells.flatMap(([row, col]) => {
      const digits = guardianKeys.has(`${row},${col}`) ? [a, b, oddagon.guardianDigit] : [a, b]
      return digits.map((digit) => ({ row, col, digit }))
    })
    const idSuffix = oddagon.cells.map(([row, col]) => `${row}.${col}`).join('-')

    if (oddagon.type === 1) {
      const [row, col] = oddagon.solvedCell!
      instances.push({
        id: `bivalue-oddagon-1-${idSuffix}`,
        name: 'Bivalue Oddagon (Type 1)',
        notation: `${oddagon.cells.length}-cell bivalue oddagon of {${a},${b}} at ${cellsLabel} => ${cellRef(row, col)} is ${oddagon.guardianDigit}`,
        usedCells: oddagon.cells,
        usedCandidates,
        eliminatedCandidates: [],
        solvedCandidates: [{ row, col, digit: oddagon.guardianDigit }],
        techniqueRank: RANK_BIVALUE_ODDAGON,
      })
    } else {
      const eliminationText = oddagon.eliminations.map((e) => `${cellRef(e.row, e.col)} cannot be ${e.digit}`).join(', ')
      instances.push({
        id: `bivalue-oddagon-2-${idSuffix}`,
        name: 'Bivalue Oddagon (Type 2)',
        notation: `${oddagon.cells.length}-cell bivalue oddagon of {${a},${b}} at ${cellsLabel}, guardians ${guardianCellsLabel} holding ${oddagon.guardianDigit} => ${eliminationText}`,
        usedCells: oddagon.cells,
        usedCandidates,
        eliminatedCandidates: oddagon.eliminations,
        solvedCandidates: [],
        techniqueRank: RANK_BIVALUE_ODDAGON,
      })
    }
  }

  if (easiestFound()) {
    return instances
  }

  // Simple Coloring: two passes so every Rule 1 instance is listed before
  // any Rule 2 instance, even though the underlying scan is per-digit.
  const rule1Instances: TechniqueInstance[] = []
  const rule2Instances: TechniqueInstance[] = []

  for (const digit of DIGITS) {
    for (const chain of colorFinder.findChains(board, candidates, digit)) {
      const chainKey = chain.cells
        .map((c) => `${c.row}.${c.col}.${c.color[0]}`)
        .sort()
        .join('-')
      const usedCells: Array<readonly [number, number]> = chain.cells.map((c) => [c.row, c.col])
      const blueCandidates = chain.cells
        .filter((c) => c.color === 'blue')
        .map((c) => ({ row: c.row, col: c.col, digit }))
      const yellowCandidates = chain.cells
        .filter((c) => c.color === 'yellow')
        .map((c) => ({ row: c.row, col: c.col, digit }))

      const rule1 = colorFinder.findRule1(chain)
      if (rule1) {
        // The true colour's cells are placed (Apply, auto-solve's solve
        // path, and the greedy picker all read solvedCandidates); the false
        // colour's candidates then go as peer eliminations, since every one
        // shares a unit with a true-colour cell. This row used to carry no
        // effect at all, so Apply did nothing.
        const sortedSolved = [...rule1.solvedCells].sort((a, b) => a[0] - b[0] || a[1] - b[1])
        rule1Instances.push({
          id: `simple-color-rule1-${digit}-${chainKey}`,
          name: `Simple Colouring Rule 1 (${digit})`,
          notation: `Light ${rule1.falseColor} is false, so light ${rule1.trueColor} is true: ${sortedSolved.map(([row, col]) => cellRef(row, col)).join(', ')} ${sortedSolved.length === 1 ? 'is' : 'are'} ${digit}.`,
          usedCells,
          usedCandidates: [],
          eliminatedCandidates: [],
          solvedCandidates: sortedSolved.map(([row, col]) => ({ row, col, digit })),
          blueCandidates,
          yellowCandidates,
          techniqueRank: RANK_SIMPLE_COLOR,
        })
      }

      const rule2 = colorFinder.findRule2(chain, board, candidates)
      if (rule2) {
        const sortedEliminated = [...rule2.eliminatedCells].sort(
          (a, b) => a[0] - b[0] || a[1] - b[1],
        )
        rule2Instances.push({
          id: `simple-color-rule2-${digit}-${chainKey}`,
          name: `Simple Colouring Rule 2 (${digit})`,
          notation: `${sortedEliminated.map(([row, col]) => cellRef(row, col)).join(', ')} cannot be ${digit}.`,
          usedCells,
          usedCandidates: [],
          eliminatedCandidates: rule2.eliminatedCells.map(([row, col]) => ({ row, col, digit })),
          solvedCandidates: [],
          blueCandidates,
          yellowCandidates,
          techniqueRank: RANK_SIMPLE_COLOR,
        })
      }
    }
  }

  instances.push(...rule1Instances, ...rule2Instances)
  if (easiestFound()) {
    return instances
  }

  // Fish and the short AICs interleave in the difficulty order (X-Wing <
  // Short Single-Digit AIC < Finned X-Wing < [3D Medusa] < Short AIC <
  // Swordfish < Finned Swordfish), so they're gathered together and pushed rank by rank. Short
  // Single-Digit AIC (length 3, one digit throughout - a classic X-chain) and
  // Short AIC (everything else that finder finds: length 5, or the rare
  // length-3 chain that switches digits via a same-cell link) are two
  // techniques with their own toggles, as is each fish. The AIC search still
  // runs when either AIC toggle is on - a length-5 chain is found by
  // continuing through the same length-3 intermediate states regardless of
  // whether length-3 itself is being surfaced - but nothing is added for a
  // kind whose toggle is off.
  //
  // A row whose eliminations easier rows already make in full isn't worth
  // listing (a Finned X-Wing is very often just a pointing pair seen the long
  // way round). "Easier" means a strictly lower rank: rows of the same
  // technique never hide each other.
  const middleTier: TechniqueInstance[] = []
  if (enabledFish.size > 0) {
    for (const fish of fishFinder.find(board, candidates)) {
      if (enabledFish.has(fish.technique)) {
        middleTier.push(buildFishInstance(fish))
      }
    }
  }
  if (shortAicEnabled || shortSingleDigitAicEnabled) {
    for (const aic of shortAicFinder.findShortAics(board, candidates)) {
      const isSingleDigit = classifyShortAic(aic) === 'single-digit'
      if (isSingleDigit ? !shortSingleDigitAicEnabled : !shortAicEnabled) {
        continue
      }
      middleTier.push(
        buildAicInstance(
          aic,
          isSingleDigit ? 'short-single-digit-aic' : 'short-aic',
          // A named pattern (Skyscraper, Empty Rectangle, W-Wing, Y-Wing, ...) is
          // shown by its name; it is still this one technique.
          aic.pattern ?? (isSingleDigit ? 'Short Single-Digit AIC' : `Short AIC (Type ${aic.eliminationType})`),
        ),
      )
    }
  }
  // Extended UR (exotic, off by default) ranks inside this tier, just after
  // the Short Single-Digit AICs. Its 3-digit rectangles are quite often a
  // naked subset seen the long way round, which the tier's own "already made
  // by easier rows" filter drops.
  if (enabledExotic.has('extended ur')) {
    middleTier.push(...extendedUrFinder.find(board, candidates).map((eur) => buildExtendedUrInstance(eur, candidates)))
  }
  // Stable, so each technique keeps the finder's own order. 3D Medusa ranks
  // inside this tier (after Finned X-Wing, before Short AIC), so the tier is
  // pushed in two halves around it - Medusa rows themselves are never hidden
  // (see below), but they do hide the harder half's redundant rows.
  middleTier.sort((a, b) => a.techniqueRank - b.techniqueRank)
  pushUnlessCovered(middleTier.filter((instance) => instance.techniqueRank < RANK_MEDUSA))
  if (easiestFound()) {
    return instances
  }

  // 3D Medusa: one row per chain, listing everything that chain proves -
  // its mass elimination (rules 1-2, if any) and every rule 3/4/5
  // elimination - named after the rules involved ("3D Medusa Rules 3,5"),
  // except rule 3-5 findings a rule 1-2 deduction on the same chain already
  // makes redundant (see medusaMassCoverage).
  // These used to be one row per rule per eliminated candidate, so a single
  // chain showed up several times, each row highlighting the same colouring
  // and only a slice of what it proves (and Apply took only that slice).
  // Chains with a mass elimination are listed first, matching the old
  // rules-1-2-before-3-5 order. usedCells is left empty throughout - a chain
  // can span most of the board, so outlining every cell in it would be too
  // noisy; the blue/yellow candidate coloring alone marks the chain instead.
  const massMedusaInstances: TechniqueInstance[] = []
  const otherMedusaInstances: TechniqueInstance[] = []

  for (const chain of medusaFinder.findChains(board, candidates)) {
    const built = buildMedusaChainInstance(chain, board, candidates)
    if (built) {
      ;(built.hasMassElimination ? massMedusaInstances : otherMedusaInstances).push(built.instance)
    }
  }

  instances.push(...massMedusaInstances, ...otherMedusaInstances)
  if (easiestFound()) {
    return instances
  }

  pushUnlessCovered(middleTier.filter((instance) => instance.techniqueRank > RANK_MEDUSA))
  if (easiestFound()) {
    return instances
  }

  // Exotic techniques (Technique Selections -> Exotic Techniques), each at its own rank.
  // Sue-de-Coq: after Finned Swordfish, before Generic AIC. A small one is
  // often a naked/hidden subset or locked candidate in disguise, so a row an
  // easier one already makes in full isn't listed.
  if (enabledExotic.has('sue de coq')) {
    pushUnlessCovered(sueDeCoqFinder.find(board, candidates).map(buildSueDeCoqInstance))
  }
  if (easiestFound()) {
    return instances
  }

  // Generic AIC (chains longer than Short AIC's, up to GENERIC_AIC_MAX_LENGTH
  // links) ranks after 3D Medusa: a long chain that only reaches what any
  // easier row already does - a Short AIC, a fish, a Medusa rule - isn't
  // listed.
  if (genericAicEnabled) {
    pushUnlessCovered(
      genericAicFinder
        .findGenericAics(board, candidates)
        .map((aic) => buildAicInstance(aic, 'generic-aic', `Generic AIC (Type ${aic.eliminationType}; ${aic.length} links)`)),
    )
  }
  if (easiestFound()) {
    return instances
  }

  // Dragon Colouring and Dynamic Dragon Colouring: one instance per stuck
  // Medusa chain the extension turned into something actionable, each
  // carrying its own move log for the Techniques panel's step-by-step
  // player. A chain plain Dragon Colouring can already resolve is never
  // also listed under Dynamic - see computeStuckDynamicDragonExtensions.
  const dragonExtensions = computeStuckDragonExtensions(
    board,
    candidates,
    'any',
    minBaseMedusaCandidates,
    exhaustiveDragon,
    optimizeDragons,
  )
  dragonExtensions.sort((a, b) => a.moves.length - b.moves.length)
  for (const { chainKey, moves } of dragonExtensions) {
    instances.push(buildDragonInstance(board, candidates, 'dragon', 'Dragon Colouring', chainKey, moves))
  }
  if (easiestFound()) {
    return instances
  }
  // Double Dragon Colouring (off by default): two stuck plain Dragons linked
  // - see computeDoubleDragonExtensions. Ranked between plain and Dynamic.
  if (doubleDragonEnabled) {
    const doubleDragonExtensions = computeDoubleDragonExtensions(
      board,
      candidates,
      minBaseMedusaCandidates,
      exhaustiveDragon,
      optimizeDragons,
    )
    doubleDragonExtensions.sort((a, b) => a.moves.length - b.moves.length)
    for (const { chainKey, moves } of doubleDragonExtensions) {
      instances.push(buildDragonInstance(board, candidates, 'double-dragon', 'Double Dragon Colouring', chainKey, moves))
    }
  }
  if (easiestFound()) {
    return instances
  }
  // Grouped AIC (off by default) ranks just before ALS-xz. A grouped chain
  // very often only reaches what a plain chain, a fish or a locked candidate
  // already does (an Empty Rectangle is one), so a row an easier technique
  // already makes in full isn't listed - Generic AIC included, by request;
  // as for ALS-xz, a Dragon or Double Dragon row doesn't hide it.
  if (groupedAicEnabled) {
    pushUnlessCovered(
      groupedAicFinder.find(board, candidates).map((aic) => buildAicInstance(aic, 'grouped-aic', 'Grouped AIC')),
      instances.filter((instance) => instance.techniqueRank < RANK_DRAGON),
    )
  }
  if (easiestFound()) {
    return instances
  }
  // ALS-xz (singly linked only) ranks after Generic AIC,
  // plain Dragon and Double Dragon, before Dynamic Dragon. Every ALS-xz is an
  // AIC with ALS nodes, and the short ones are often a naked pair, a Short
  // AIC or a Medusa rule in disguise, so a row an easier one already makes in
  // full isn't listed - but a Dragon or Double Dragon row making the same
  // eliminations doesn't hide it, by request (only the non-Dragon rows
  // count).
  if (alsXzEnabled) {
    pushUnlessCovered(
      alsXzFinder.find(board, candidates).map(buildAlsXzInstance),
      // Grouped AIC ranks between the Dragons and ALS-xz, and is not a Dragon.
      instances.filter((instance) => instance.techniqueRank < RANK_DRAGON || instance.techniqueRank === RANK_GROUPED_AIC),
    )
  }
  if (easiestFound()) {
    return instances
  }
  // UR-AIC (off by default) ranks just above ALS-xz. A row an easier
  // technique (ALS-xz included) already makes in full isn't listed - except
  // that neither a Dragon row nor an easier AIC row (Short Single-Digit,
  // Short or Generic AIC) hides it, by request: a UR-AIC is shown even when
  // a plain chain or a Dragon reaches the same eliminations.
  if (urAicEnabled) {
    const aicRanks = new Set([RANK_SHORT_SINGLE_DIGIT_AIC, RANK_SHORT_AIC, RANK_GENERIC_AIC])
    pushUnlessCovered(
      urAicFinder.find(board, candidates).map(buildUrAicInstance),
      instances.filter(
        (instance) =>
          (instance.techniqueRank < RANK_DRAGON || instance.techniqueRank === RANK_ALS_XZ) && !aicRanks.has(instance.techniqueRank),
      ),
    )
  }
  if (easiestFound()) {
    return instances
  }
  // ALS-AIC (off by default) ranks just above UR-AIC. It is hidden by an
  // easier non-Dragon row that makes all its eliminations - ALS-xz (itself
  // the shortest ALS chain) and, unlike UR-AIC, the plain AICs too (Short
  // Single-Digit, Short, Generic), by request (2026-10-06): an ALS of two
  // bivalue cells sharing a digit is just two ordinary strong links, so such
  // an "ALS-AIC" is a plain chain written shorter - the user's case was a
  // Y-Wing listed again as `1r1c9 = 5r1c9 - 5r5c9 =ALS= 1r4c7`. Grouped AIC
  // and UR-AIC rows (both ranked above Dragon) never hide it, by request.
  if (alsAicEnabled) {
    pushUnlessCovered(
      alsAicFinder.find(board, candidates).map(buildAlsAicInstance),
      instances.filter((instance) => instance.techniqueRank < RANK_DRAGON || instance.techniqueRank === RANK_ALS_XZ),
    )
  }
  if (easiestFound()) {
    return instances
  }

  // The "Disable Dynamic Dragons" setting: plain Dragon becomes the
  // strongest technique, here and so in the solve path built on this list.
  const dynamicDragonExtensions = !dynamicDragonEnabled ? [] : computeStuckDynamicDragonExtensions(
    board,
    candidates,
    'any',
    minBaseMedusaCandidates,
    allowedRule3Techniques,
    aicLimitPerDragonStep,
    exhaustiveDragon,
    optimizeDragons,
    optimizeDynamicDragons,
    maxTechniquesPerDragonStep,
    givens,
  )
  sortDragonRows(dynamicDragonExtensions)
  for (const { chainKey, moves } of dynamicDragonExtensions) {
    instances.push(buildDragonInstance(board, candidates, 'dynamic-dragon', dynamicDragonLabel(moves), chainKey, moves))
  }
  // "Prefer easier double dragons" ranks an easier Double Dynamic Dragon
  // below these rows, and whether one counts as easier is only known once
  // the Double Dynamic rows are, so that setting needs the rest.
  if (easiestFound() && !(easiestTierOnly !== false && easiestTierOnly.preferEasierDoubleDragons && doubleDynamicDragonEnabled)) {
    return instances
  }
  // Double Dynamic Dragon Colouring (off by default, and off with Dynamic
  // Dragons disabled) - see computeDoubleDynamicDragonExtensions.
  if (dynamicDragonEnabled && doubleDynamicDragonEnabled) {
    const doubleDynamicExtensions = computeDoubleDynamicDragonExtensions(
      board,
      candidates,
      minBaseMedusaCandidates,
      allowedRule3Techniques,
      aicLimitPerDragonStep,
      maxTechniquesPerDragonStep,
      exhaustiveDragon,
      optimizeDragons,
      optimizeDynamicDragons,
      doubleDragonEnabled,
      givens,
    )
    sortDragonRows(doubleDynamicExtensions)
    for (const { chainKey, moves } of doubleDynamicExtensions) {
      instances.push(
        buildDragonInstance(board, candidates, 'double-dynamic-dragon', `Double ${dynamicDragonLabel(moves)}`, chainKey, moves),
      )
    }

    // The search above only pairs chains single Dynamic Dragon is stuck on
    // with *every* allowed technique, so a chain a single Dragon resolves
    // only by leaning on an Unfair technique never gets a Double - even
    // though two Dragons with easier techniques are what a human would look
    // for first. By request, per grid state: when no single Dynamic Dragon
    // gets anywhere without the Unfair techniques, the Doubles found without
    // them are listed too; likewise with only the Defaults, when every single
    // Dynamic Dragon needs something beyond them.
    if (dynamicDragonExtensions.length > 0) {
      const listedChains = new Set(doubleDynamicExtensions.map((extension) => extension.chainKey))
      const listedEffects = new Set(doubleDynamicExtensions.map((extension) => dragonEffectKey(extension.moves)))
      // RULE3_TECHNIQUE_GROUPS runs Defaults, Advanced, Brutal, Unfair.
      const unfair = RULE3_TECHNIQUE_GROUPS[RULE3_TECHNIQUE_GROUPS.length - 1].techniques
      const beyondDefaults = RULE3_TECHNIQUE_GROUPS.slice(1).flatMap((group) => group.techniques)
      let previousSize = allowedRule3Techniques.size
      for (const dropped of [unfair, beyondDefaults]) {
        const easier = new Set([...allowedRule3Techniques].filter((technique) => !dropped.includes(technique)))
        // Nothing dropped is ticked (or nothing more than the last round
        // dropped): the same search again.
        if (easier.size === previousSize) {
          continue
        }
        previousSize = easier.size
        // Cheap first: a listed single Dragon that already keeps to the
        // easier set settles it. Otherwise ask outright whether any single
        // Dynamic Dragon resolves with the easier set - Exhaustive off, since
        // its first elimination decides that.
        const everySingleNeedsDropped =
          dynamicDragonExtensions.every(({ moves }) =>
            moves.some((move) => (move.dynamicTechniques ?? []).some((technique) => dropped.includes(technique))),
          ) &&
          computeStuckDynamicDragonExtensions(
            board,
            candidates,
            'any',
            minBaseMedusaCandidates,
            easier,
            aicLimitPerDragonStep,
            false,
            optimizeDragons,
            optimizeDynamicDragons,
            maxTechniquesPerDragonStep,
            givens,
          ).length === 0
        if (!everySingleNeedsDropped) {
          continue
        }
        const easierExtensions = computeDoubleDynamicDragonExtensions(
          board,
          candidates,
          minBaseMedusaCandidates,
          easier,
          aicLimitPerDragonStep,
          maxTechniquesPerDragonStep,
          exhaustiveDragon,
          optimizeDragons,
          optimizeDynamicDragons,
          doubleDragonEnabled,
          givens,
        )
        sortDragonRows(easierExtensions)
        for (const { chainKey, moves } of easierExtensions) {
          const effect = dragonEffectKey(moves)
          // Already a row (the chain key is the row's id), or the same
          // eliminations and placements as one.
          if (listedChains.has(chainKey) || listedEffects.has(effect)) {
            continue
          }
          listedChains.add(chainKey)
          listedEffects.add(effect)
          instances.push({
            ...buildDragonInstance(board, candidates, 'double-dynamic-dragon', `Double ${dynamicDragonLabel(moves)}`, chainKey, moves),
            easierThanSingleDynamicDragon: true,
          })
        }
      }
    }
  }

  return instances
}

/** A Dragon log's whole effect as one string: two logs with the same key make
 * exactly the same eliminations and placements. */
function dragonEffectKey(moves: DragonMove[]): string {
  return [
    ...moves.flatMap((m) => m.eliminated.map((e) => `x${e.row}${e.col}${e.digit}`)),
    ...moves.flatMap((m) => m.solved.map((e) => `s${e.row}${e.col}${e.digit}`)),
  ]
    .sort()
    .join(',')
}

/** Appends `candidates` (sorted by techniqueRank) to `instances`, except any
 * whose eliminations rows of a strictly lower rank - everything already in
 * `instances` (or just the `coveringRows` given), plus lower tiers of
 * `candidates` itself - already make in full. Only elimination-only rows can
 * be hidden this way; one that solves a cell is always kept.
 *
 * `basicOnly` (the "All Possible Techniques" setting): only Basic Techniques
 * rows (the always-on ones in Technique Selections: locked candidates, naked
 * pairs/triples/quads, hidden pairs - singles eliminate nothing) can hide a
 * row, so every other technique's rows are all listed. */
function pushUnlessCoveredByEasier(
  instances: TechniqueInstance[],
  candidates: TechniqueInstance[],
  coveringRows: readonly TechniqueInstance[] = instances,
  basicOnly = false,
): void {
  const keyOf = (e: TechniqueCandidateRef) => `${e.row},${e.col},${e.digit}`
  const covering = basicOnly ? coveringRows.filter((instance) => instance.techniqueRank <= RANK_SUBSET) : coveringRows
  const covered = new Set(covering.flatMap((instance) => instance.eliminatedCandidates.map(keyOf)))
  let tierRank = -1
  let tierKeys: string[] = []
  for (const candidate of candidates) {
    if (candidate.techniqueRank !== tierRank) {
      // No candidate row is ever a Basic Technique.
      if (!basicOnly) {
        tierKeys.forEach((key) => covered.add(key))
      }
      tierKeys = []
      tierRank = candidate.techniqueRank
    }
    if (candidate.solvedCandidates.length === 0 && candidate.eliminatedCandidates.every((e) => covered.has(keyOf(e)))) {
      continue
    }
    instances.push(candidate)
    tierKeys.push(...candidate.eliminatedCandidates.map(keyOf))
  }
}

/** A Techniques-panel row for one fish. */
function buildKillerCageInstance(cage: KillerCageInstance): TechniqueInstance {
  const id = `killer-cage-${cage.kind}-${cage.cage.cells.map(([row, col]) => `${row}.${col}`).join('-')}`
  if (cage.kind === 'sum') {
    const { row, col, digit } = cage.solved!
    return {
      id,
      name: 'Cage Sum',
      notation: `${capitalizeFirst(cage.reasonText)}, so ${cellRef(row, col)} is ${digit}`,
      usedCells: cage.cage.cells,
      usedCandidates: [],
      eliminatedCandidates: cage.eliminations,
      solvedCandidates: [cage.solved!],
      techniqueRank: RANK_SINGLE,
      variantConstraint: 'killer',
    }
  }
  if (cage.kind === 'locked') {
    return {
      id: `${id}-${cage.lockedDigit}`,
      name: 'Cage Locked Candidate',
      notation: `${capitalizeFirst(cage.reasonText)}, so ${killerEliminationsText(cage.eliminations)}`,
      usedCells: cage.cage.cells,
      usedCandidates: cage.lockedCells.map(([row, col]) => ({ row, col, digit: cage.lockedDigit! })),
      eliminatedCandidates: cage.eliminations,
      solvedCandidates: [],
      techniqueRank: RANK_CAGE_LOCKED_CANDIDATE,
      variantConstraint: 'killer',
    }
  }
  return {
    id,
    name: 'Cage Combinations',
    notation: `${capitalizeFirst(cage.reasonText)}, so ${killerEliminationsText(cage.eliminations)}`,
    usedCells: cage.cage.cells,
    usedCandidates: [],
    eliminatedCandidates: cage.eliminations,
    solvedCandidates: [],
    techniqueRank: RANK_CAGE_COMBINATIONS,
    variantConstraint: 'killer',
  }
}

function buildEntropySquareInstance(entropy: EntropySquareInstance): TechniqueInstance {
  const [top, left] = entropy.square[0]
  return {
    id: `entropy-square-${entropy.kind}-${top}.${left}-${entropy.groups.join('')}`,
    name: 'Entropy Square',
    notation: `${capitalizeFirst(entropy.reasonText)}, so ${killerEliminationsText(entropy.eliminations)}`,
    usedCells: entropy.square,
    usedCandidates: [],
    eliminatedCandidates: entropy.eliminations,
    solvedCandidates: [],
    techniqueRank: RANK_ENTROPY_SQUARE,
    variantConstraint: 'entropy',
  }
}

function buildVariantLockedInstance(locked: VariantLockedInstance): TechniqueInstance {
  const how = locked.kind === 'knight' ? "Knight's Move" : 'Diagonal'
  return {
    id: `variant-locked-${locked.kind}-${locked.digit}-${locked.lockedCells.map(([row, col]) => `${row}.${col}`).join('-')}`,
    name: `Locked Candidate (${how})`,
    notation: `${locked.reasonText}, and ${
      locked.kind === 'knight' ? "each of these cells sees all of them (a knight's move counts)" : 'each of these cells sees all of them'
    }, so ${killerEliminationsText(locked.eliminations)}`,
    usedCells: locked.lockedCells,
    usedCandidates: locked.lockedCells.map(([row, col]) => ({ row, col, digit: locked.digit })),
    eliminatedCandidates: locked.eliminations,
    solvedCandidates: [],
    techniqueRank: RANK_VARIANT_LOCKED_CANDIDATE,
    variantConstraint: locked.kind === 'knight' ? 'anti-knight' : 'x-sudoku',
  }
}

function buildKillerRule45Instance(rule: KillerRule45Instance): TechniqueInstance {
  const kindName = rule.kind === 'innie' ? 'Innies' : 'Outies'
  return {
    id: `killer-45-${rule.kind}-${rule.emptyCells.map(([row, col]) => `${row}.${col}`).join('-')}`,
    name: `Rule of 45 (${rule.emptyCells.length === 1 ? kindName.slice(0, -1) : kindName})`,
    notation: rule.solved
      ? `${rule.reasonText}, so ${cellRef(rule.solved.row, rule.solved.col)} is ${rule.solved.digit}`
      : `${rule.reasonText}, so ${killerEliminationsText(rule.eliminations)}`,
    usedCells: rule.houseCells,
    usedCandidates: [],
    eliminatedCandidates: rule.eliminations,
    solvedCandidates: rule.solved ? [rule.solved] : [],
    // The innies/outies themselves get the yellow border, inside the houses.
    medusaHighlightCells: rule.cells,
    techniqueRank: RANK_RULE_OF_45,
    variantConstraint: 'killer',
  }
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function buildFishInstance(fish: FishInstance): TechniqueInstance {
  const eliminatedLabel = fish.eliminations.map((e) => cellRef(e.row, e.col)).join(', ')
  return {
    id: `fish-${fish.technique.replace(/s+/g, '-')}-${fish.digit}-${fish.lineKind}-${fish.lines.join('')}-${fish.crossLines.join('')}`,
    name: FISH_TECHNIQUE_NAMES[fish.technique],
    notation: `${fish.reasonText}, thus ${eliminatedLabel} cannot be ${fish.digit}`,
    usedCells: [...fish.cells],
    usedCandidates: fish.cells.map(([row, col]) => ({ row, col, digit: fish.digit })),
    eliminatedCandidates: fish.eliminations,
    solvedCandidates: [],
    // The fins get the same distinct cell border a UR's reason cells do.
    medusaHighlightCells: fish.fins.length > 0 ? [...fish.fins] : undefined,
    techniqueRank: FISH_RANKS[fish.technique],
  }
}

/** A Techniques-panel row for one ALS-xz. Both ALS' cells are outlined as the
 * basis, ALS B's also get the distinct border (so an overlap cell has both);
 * the RCC's candidates are blue and the Z digits' yellow. */
function buildAlsXzInstance(als: AlsXzInstance): TechniqueInstance {
  const alsCells = [...als.alsA.cells, ...als.alsB.cells]
  const candidatesOf = (digits: readonly number[]): TechniqueCandidateRef[] =>
    alsCells.flatMap(([row, col]) => digits.map((digit) => ({ row, col, digit })))
  const eliminationText = als.zDigits
    .map((z) => {
      const cells = als.eliminations.filter((e) => e.digit === z).map((e) => cellRef(e.row, e.col))
      return `${cells.join(', ')} cannot be ${z}`
    })
    .join(', ')
  const cellsKey = (cells: readonly (readonly [number, number])[]) => cells.map(([row, col]) => `${row}${col}`).join('.')
  return {
    id: `als-xz-${cellsKey(als.alsA.cells)}-${cellsKey(als.alsB.cells)}-${als.rcc}`,
    name: 'ALS-xz',
    notation: `${als.reasonText}, thus ${eliminationText}.`,
    usedCells: alsCells,
    usedCandidates: [],
    eliminatedCandidates: als.eliminations,
    solvedCandidates: [],
    // Duplicates (an overlap cell) are harmless: these are only ever
    // membership-tested, and the grid only paints a candidate that's marked.
    blueCandidates: candidatesOf([als.rcc]),
    yellowCandidates: candidatesOf(als.zDigits),
    medusaHighlightCells: [...als.alsB.cells],
    techniqueRank: RANK_ALS_XZ,
  }
}

/** A Techniques-panel row for one UR-AIC: drawn like any AIC (a UR link as
 * the strong or weak link it is), with every rectangle it uses outlined as
 * the basis. The text is the chain, then each rectangle fact it rests on. */
export function buildUrAicInstance(aic: UrAicInstance): TechniqueInstance {
  const x = aic.nodes[0]
  const y = aic.nodes[aic.nodes.length - 1]
  const endText = (n: typeof x) => (n.cells ? `${n.digit} in (${n.cells.map(([r, c]) => cellRef(r, c)).join(', ')})` : aicNodeText(n))
  const eliminationText = aic.eliminations.map((e) => `${cellRef(e.row, e.col)} cannot be ${e.digit}`).join(', ')
  const linkUses = aic.rectangleUses.filter((use) => use.inChain).map(urAicRectangleUseText)
  const elimUses = aic.rectangleUses.filter((use) => !use.inChain).map(urAicRectangleUseText)
  const sameCell = !x.cells && !y.cells && x.row === y.row && x.col === y.col
  const notation =
    `${urAicChainText(aic)} states that either ${endText(x)} or ${endText(y)} must be true` +
    (linkUses.length > 0 ? ` (${linkUses.join('; ')})` : '') +
    `, so ${eliminationText}` +
    (sameCell ? ` (${cellRef(x.row, x.col)} must be ${x.digit} or ${y.digit})` : '') +
    (elimUses.length > 0 ? `, since ${elimUses.join('; ')}` : '') +
    '.'
  const rectangles = new Map<string, UrAicInstance['rectangleUses'][number]['ur']>()
  for (const { ur } of aic.rectangleUses) {
    rectangles.set(urBasisText(ur), ur)
  }
  const urCells = [...rectangles.values()].flatMap((ur) => ur.cells)
  const view = aicChainView(aic)
  return {
    id: `uraic-${aic.eliminationType}-${view.candidates.map((n) => `${n.row}.${n.col}.${n.digit}`).join('-')}`,
    name: `UR-AIC (Type ${aic.eliminationType}; ${aic.length} link${aic.length === 1 ? '' : 's'})`,
    notation,
    usedCells: urCells,
    usedCandidates: [],
    eliminatedCandidates: aic.eliminations,
    solvedCandidates: [],
    aicCandidates: view.candidates,
    aicLinks: view.links,
    techniqueRank: RANK_UR_AIC,
  }
}

/** A Techniques-panel row for one ALS-AIC: drawn like any AIC (an ALS link
 * as the strong link it is, its ends outlined as groups), with every ALS it
 * uses as the basis. The text is the chain, then any closure it rests on.
 * An ALS *link* is not explained in words, by request: the chain's own =ALS=
 * and the outlined ALS cells already show it (a closure still is - it is
 * off-chain, so nothing else says where those eliminations come from). */
export function buildAlsAicInstance(aic: AlsAicInstance): TechniqueInstance {
  const x = aic.nodes[0]
  const y = aic.nodes[aic.nodes.length - 1]
  const endText = (n: typeof x) => (n.cells ? `${n.digit} in (${n.cells.map(([r, c]) => cellRef(r, c)).join(', ')})` : aicNodeText(n))
  const eliminationText = aic.eliminations.map((e) => `${cellRef(e.row, e.col)} cannot be ${e.digit}`).join(', ')
  const closureUses = aic.alsUses.filter((use) => use.kind === 'closure').map((use) => alsAicAlsUseText(use, aic))
  const sameCell = !x.cells && !y.cells && x.row === y.row && x.col === y.col
  const notation =
    `${alsAicChainText(aic)} states that either ${endText(x)} or ${endText(y)} must be true` +
    (sameCell ? ` (${cellRef(x.row, x.col)} must be ${x.digit} or ${y.digit})` : '') +
    (closureUses.length > 0 ? `; ${closureUses.join('; ')}` : '') +
    `, so ${eliminationText}.`
  const alsCells = new Map<string, readonly [number, number]>()
  for (const { als } of aic.alsUses) {
    for (const cell of als.cells) {
      alsCells.set(cellRef(cell[0], cell[1]), cell)
    }
  }
  const view = aicChainView(aic)
  return {
    id: `alsaic-${aic.eliminationType}-${view.candidates.map((n) => `${n.row}.${n.col}.${n.digit}`).join('-')}`,
    name: `ALS-AIC (Type ${aic.eliminationType}; ${aic.length} link${aic.length === 1 ? '' : 's'})`,
    notation,
    usedCells: [...alsCells.values()],
    usedCandidates: [],
    eliminatedCandidates: aic.eliminations,
    solvedCandidates: [],
    aicCandidates: view.candidates,
    aicLinks: view.links,
    techniqueRank: RANK_ALS_AIC,
  }
}

/** A Techniques-panel row for one Sue-de-Coq. The intersection cells and the
 * two bivalue cells are the basis (the bivalue cells also get the distinct
 * border); the line's digits are blue and the box's yellow, in all the cells
 * they're locked to. */
function buildSueDeCoqInstance(s: SueDeCoqInstance): TechniqueInstance {
  const refs = (cells: readonly (readonly [number, number])[], digits: readonly number[]): TechniqueCandidateRef[] =>
    cells.flatMap(([row, col]) => digits.map((digit) => ({ row, col, digit })))
  // Grouped by cell ("r6c9 cannot be 269"): eliminations are sorted by cell.
  const byCell = new Map<string, number[]>()
  for (const e of s.eliminations) {
    const key = cellRef(e.row, e.col)
    byCell.set(key, [...(byCell.get(key) ?? []), e.digit])
  }
  const eliminationText = [...byCell].map(([cell, digits]) => `${cell} cannot be ${digits.join('')}`).join(', ')
  return {
    id: `sue-de-coq-${s.cells.map(([r, c]) => `${r}${c}`).join('.')}-${s.lineCell.join('')}-${s.boxCell.join('')}`,
    name: 'Sue-de-Coq',
    notation: `${s.reasonText}, thus ${eliminationText}.`,
    usedCells: [...s.cells, s.lineCell, s.boxCell],
    usedCandidates: refs(s.cells, s.extraDigits),
    eliminatedCandidates: s.eliminations,
    solvedCandidates: [],
    blueCandidates: refs([...s.cells, s.lineCell], s.lineDigits),
    yellowCandidates: refs([...s.cells, s.boxCell], s.boxDigits),
    medusaHighlightCells: [s.lineCell, s.boxCell],
    techniqueRank: RANK_SUE_DE_COQ,
  }
}

/** A Techniques-panel row for one Extended UR (Type 1): the six pattern cells
 * and their pattern digits are the basis, and the odd cell - the one that
 * keeps the pattern from being deadly - gets the distinct border. */
function buildExtendedUrInstance(eur: ExtendedUrInstance, candidates: CandidateGrid): TechniqueInstance {
  const odd = cellRef(eur.oddCell[0], eur.oddCell[1])
  const conclusion = eur.solved
    ? `${odd} is ${eur.solved.digit}`
    : `${odd} cannot be ${eur.eliminations.map((e) => e.digit).join('')}`
  return {
    id: `extended-ur-1-${eur.cells.map(([r, c]) => `${r}${c}`).join('.')}-${eur.digits.join('')}`,
    name: 'Extended UR (Type 1)',
    notation:
      `${eur.reasonText.replace(/^an /, '')}. If ${odd} were ${joinDigits(eur.digits)}, the six cells would hold only ` +
      `{${eur.digits.join(',')}} and could be filled in two ways, so ${conclusion}.`,
    usedCells: [...eur.cells],
    usedCandidates: eur.cells.flatMap(([row, col]) =>
      eur.digits.filter((digit) => candidates[row][col][digit - 1]).map((digit) => ({ row, col, digit })),
    ),
    eliminatedCandidates: eur.eliminations,
    solvedCandidates: eur.solved ? [eur.solved] : [],
    medusaHighlightCells: [eur.oddCell],
    techniqueRank: RANK_EXTENDED_UR,
  }
}

/** "1, 3 or 5". */
function joinDigits(digits: readonly number[]): string {
  return digits.length === 1 ? String(digits[0]) : `${digits.slice(0, -1).join(', ')} or ${digits[digits.length - 1]}`
}

export function buildDragonInstance(
  board: Board,
  candidates: CandidateGrid,
  idPrefix: string,
  name: string,
  chainKey: string,
  moves: DragonMove[],
): TechniqueInstance {
  const lastMove = moves[moves.length - 1]
  // A Double Dragon's conclusion is usually about its second Dragon's colours.
  const provenTrueLabel = lastMove.provenTrueColor ? dragonColourLabel(lastMove.provenTrueColor, lastMove.secondDragon) : ''
  // A mass elimination's solves/eliminates are both just consequences of
  // one fact - a side proved false, so the other side is proved true - so
  // that fact leads the summary. The tally still follows it, but as the
  // number of candidates that actually disappear from the grid, not a
  // count of what the move log lists: that covers the Dragon steps' own
  // eliminations plus everything the now-true colour forces (the false
  // colour's candidates, and the peers of every cell it solves), each
  // candidate counted once.
  const summaryText =
    lastMove.kind === 'mass-elimination' && lastMove.provenTrueColor
      ? (() => {
          const fact = `${provenTrueLabel} is true`
          const eliminatedCount = countEffectiveEliminations(
            board,
            candidates,
            foldDragonMoves(moves, moves.length - 1),
          )
          return eliminatedCount > 0
            ? `${fact}; eliminates ${eliminatedCount} candidate${eliminatedCount === 1 ? '' : 's'}`
            : fact
        })()
      : lastMove.kind === 'solution' && lastMove.provenTrueColor
        ? `${provenTrueLabel} covers every empty cell, solving the puzzle`
        : (() => {
          const eliminated = moves.flatMap((m) => m.eliminated)
          const solvedCount = moves.reduce((n, m) => n + m.solved.length, 0)
          const summary: string[] = []
          if (solvedCount > 0) {
            summary.push(`solves ${solvedCount} cell${solvedCount === 1 ? '' : 's'}`)
          }
          if (eliminated.length === 1) {
            summary.push(`eliminates ${eliminated[0].digit}${cellRef(eliminated[0].row, eliminated[0].col)}`)
          } else if (eliminated.length > 1) {
            summary.push(`eliminates ${eliminated.length} candidates`)
          }
          return summary.join(', ')
        })()
  return {
    id: `${idPrefix}-${chainKey}`,
    name,
    notation: `${moves.length} steps - ${summaryText}.`,
    usedCells: [],
    usedCandidates: [],
    eliminatedCandidates: moves.flatMap((m) => m.eliminated),
    solvedCandidates: moves.flatMap((m) => m.solved),
    moves,
    techniqueRank:
      idPrefix === 'dragon'
        ? RANK_DRAGON
        : idPrefix === 'double-dragon'
          ? RANK_DOUBLE_DRAGON
          : idPrefix === 'double-dynamic-dragon'
            ? RANK_DOUBLE_DYNAMIC_DRAGON
            : RANK_DYNAMIC_DRAGON,
  }
}

/** "Dynamic Dragon Colouring (naked pair, UR)" - named after whichever
 * non-colouring technique(s) its Extension Rule 3 steps actually leaned on,
 * so "Dynamic Dragon Colouring" alone never has to be taken on faith. Fixed
 * order regardless of which happened to fire first. */
export function dynamicDragonLabel(moves: DragonMove[]): string {
  const techniquesUsed = new Set(moves.flatMap((m) => m.dynamicTechniques ?? []))
  const orderedTechniques = (
    [
      'locked candidate',
      'naked pair',
      'naked triple',
      'naked quad',
      'hidden pair',
      'UR',
      'BUG+N',
      'avoidable rectangle',
      'bivalue oddagon',
      'x-wing',
      'short single-digit aic',
      'extended ur',
      'finned x-wing',
      'short aic',
      'swordfish',
      'finned swordfish',
      'generic aic',
      'grouped aic',
      'als-xz',
      'ur-aic',
      'als-aic',
    ] as const
  ).filter((t) => techniquesUsed.has(t))
  // A short AIC is listed by the pattern(s) it was (a Skyscraper, an Empty
  // Rectangle, a W-Wing, ...), plain "short single-digit aic" / "short aic"
  // only for a chain that isn't one of them.
  const patternLabels = (technique: 'short single-digit aic' | 'short aic') => [
    ...new Set(
      moves.flatMap((m) =>
        (m.substeps ?? []).filter((s) => s.technique === technique).map((s) => s.aic?.pattern?.toLowerCase() ?? technique),
      ),
    ),
  ]
  const singleDigitLabels = patternLabels('short single-digit aic')
  const shortAicLabels = patternLabels('short aic')
  // BUG+N is listed by the N it had: "BUG+2", not the internal "BUG+N".
  const bugLabels = [
    ...new Set(
      moves.flatMap((m) => (m.substeps ?? []).filter((s) => s.technique === 'BUG+N').map((s) => s.displayName ?? 'BUG+N')),
    ),
  ].sort()
  const labels = orderedTechniques.flatMap((t) =>
    t === 'short single-digit aic' && singleDigitLabels.length > 0
      ? singleDigitLabels
      : t === 'short aic' && shortAicLabels.length > 0
        ? shortAicLabels
        : t === 'BUG+N'
          ? bugLabels
          : [t],
  )
  return labels.length > 0
    ? `Dynamic Dragon Colouring (${labels.join(', ')})`
    : 'Dynamic Dragon Colouring'
}

/** The full effect of a technique instance, including - for a Dragon
 * Colouring or Dynamic Dragon Colouring instance - its entire move chain
 * folded to the end, not just whichever step a user happens to be
 * viewing. Used by the Solve Path search and by jumping straight to a
 * solve-path step, where a Dragon instance always counts as one complete
 * step regardless of how many internal moves it took. */
export function fullTechniqueEffect(
  instance: TechniqueInstance,
): { eliminatedCandidates: TechniqueCandidateRef[]; solvedCandidates: TechniqueCandidateRef[] } {
  if (instance.moves && instance.moves.length > 0) {
    const fold = foldDragonMoves(instance.moves, instance.moves.length - 1)
    return { eliminatedCandidates: fold.eliminatedCandidates, solvedCandidates: fold.solvedCandidates }
  }
  return { eliminatedCandidates: instance.eliminatedCandidates, solvedCandidates: instance.solvedCandidates }
}

/** How many pencil marks a technique's full effect removes from the grid:
 * every candidate that is marked before and gone after applying it,
 * counting peers wiped by a solve and the other digits of a solved cell,
 * but not the solved digit itself (that mark becomes the cell's value, it
 * isn't eliminated). Each mark counts once however many times the effect
 * lists it. */
export function countEffectiveEliminations(
  board: Board,
  candidates: CandidateGrid,
  effect: { eliminatedCandidates: TechniqueCandidateRef[]; solvedCandidates: TechniqueCandidateRef[] },
): number {
  return listEffectiveEliminations(board, candidates, effect).length
}

export function applyTechniqueEffect(
  board: Board,
  candidates: CandidateGrid,
  effect: { eliminatedCandidates: TechniqueCandidateRef[]; solvedCandidates: TechniqueCandidateRef[] },
): { board: Board; candidates: CandidateGrid } {
  const nextBoard = cloneBoard(board)
  const nextCandidates = cloneCandidates(candidates)
  for (const { row, col, digit } of effect.solvedCandidates) {
    nextBoard[row][col] = digit
    nextCandidates[row][col] = Array(9).fill(false)
    SudokuRules.eliminatePeerCandidates(nextCandidates, nextBoard, row, col, digit)
  }
  for (const { row, col, digit } of effect.eliminatedCandidates) {
    nextCandidates[row][col][digit - 1] = false
  }
  return { board: nextBoard, candidates: nextCandidates }
}

/** Picks whichever currently-applicable technique instance makes the most
 * progress right now: most cells solved, tie-broken by most candidates
 * eliminated, tie-broken by whichever technique buildTechniqueInstances
 * already lists first (its own simplest-first order). This directly
 * targets the fewest-steps goal, since solving more cells now leaves
 * fewer future steps to take - see buildSolvePath for why this is a
 * heuristic, not a guaranteed-minimum search. */
export function pickGreedyInstance(instances: TechniqueInstance[]): TechniqueInstance | null {
  let best: TechniqueInstance | null = null
  let bestSolved = -1
  let bestEliminated = -1
  for (const instance of instances) {
    const effect = fullTechniqueEffect(instance)
    const solved = effect.solvedCandidates.length
    const eliminated = effect.eliminatedCandidates.length
    if (
      !best ||
      solved > bestSolved ||
      (solved === bestSolved && eliminated > bestEliminated) ||
      // Most progress is still the deciding factor; only once that's an
      // exact tie does the simpler technique (lower techniqueRank) win,
      // rather than whichever happened to be found/listed first.
      (solved === bestSolved && eliminated === bestEliminated && instance.techniqueRank < best.techniqueRank)
    ) {
      best = instance
      bestSolved = solved
      bestEliminated = eliminated
    }
  }
  return best
}

/** How many Dragon Colouring steps an instance takes to apply - 0 for every
 * non-Dragon technique, so comparing this between two instances is a no-op
 * unless both are Dragon/Dynamic Dragon. */
export function dragonStepCount(instance: TechniqueInstance): number {
  return instance.moves?.length ?? 0
}

/** Solve Path search, "Easy Solve" setting: picks whichever applicable
 * technique is simplest (lowest techniqueRank) right now, ignoring how much
 * progress it makes - unlike the default (pickGreedyInstance), a Naked
 * Single that only fills one cell is always preferred here over a Dragon
 * Colouring chain that would solve half the grid, since a human working
 * through the puzzle by hand would reach for the single first regardless of
 * payoff. Ties - usually several instances of the exact same technique -
 * are broken by fewest Dragon Colouring steps (a shorter chain is a simpler
 * one; always a tie, at 0, between two non-Dragon instances) and then by
 * most candidates eliminated, the only differentiator left once technique
 * and chain length no longer distinguish two instances.
 *
 * `preferEasierDoubleDragons` (the Solve Path's "Prefer easier double
 * dragons"): a Double Dynamic Dragon found with an easier technique set than
 * every single Dynamic Dragon needs (`easierThanSingleDynamicDragon`) counts
 * as easier than single Dynamic Dragon, instead of as the hardest tier.
 *
 * `preferEasiestDragonTechniques` (the Solve Path's "Prefer easiest techs
 * within dragon"): between Dragons of one rank, what a Dragon asks of the
 * solver comes before its length - the hardest technique group it uses, then
 * the most techniques any one of its steps chains (dragonTechniqueDemand) -
 * and only then the shorter Dragon wins. Off, length decides straight away. */
export function pickEasiestInstance(
  instances: TechniqueInstance[],
  preferEasierDoubleDragons = false,
  preferEasiestDragonTechniques = false,
): TechniqueInstance | null {
  const rankOf = (instance: TechniqueInstance) =>
    preferEasierDoubleDragons && instance.easierThanSingleDynamicDragon ? RANK_DYNAMIC_DRAGON - 0.5 : instance.techniqueRank
  // Smaller is easier, compared left to right; most candidates eliminated
  // settles a full tie.
  const keyOf = (instance: TechniqueInstance): number[] => {
    const demand = preferEasiestDragonTechniques ? dragonTechniqueDemand(instance) : { hardestGroup: 0, mostTechniquesInOneStep: 0 }
    return [rankOf(instance), demand.hardestGroup, demand.mostTechniquesInOneStep, dragonStepCount(instance)]
  }
  const compareKeys = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return a[i] - b[i]
      }
    }
    return 0
  }
  let best: TechniqueInstance | null = null
  let bestKey: number[] = []
  let bestEliminated = -1
  for (const instance of instances) {
    const key = keyOf(instance)
    const order = best ? compareKeys(key, bestKey) : -1
    if (order > 0) {
      continue
    }
    const eliminated = fullTechniqueEffect(instance).eliminatedCandidates.length
    if (order < 0 || eliminated > bestEliminated) {
      best = instance
      bestKey = key
      bestEliminated = eliminated
    }
  }
  return best
}

/** What a Dragon's Extension Rule 3 steps ask of the solver, for "Prefer
 * easiest techs within dragon": the hardest group of Dragon Configuration's
 * technique list any step uses (RULE3_TECHNIQUE_GROUPS: 0 Defaults, 1
 * Advanced, 2 Brutal, 3 Unfair), and the most techniques one single step
 * chains together (its substeps, the closing colouring aside). Both 0 for a
 * plain Dragon and for anything that isn't a Dragon; a Double Dragon counts
 * the steps of both its Dragons. */
export function dragonTechniqueDemand(instance: TechniqueInstance): { hardestGroup: number; mostTechniquesInOneStep: number } {
  return dragonMovesTechniqueDemand(instance.moves ?? [])
}

/** dragonTechniqueDemand for a bare move log (the Techniques list orders its
 * Dragon rows by it before they are instances). */
function dragonMovesTechniqueDemand(moves: readonly DragonMove[]): { hardestGroup: number; mostTechniquesInOneStep: number } {
  let hardestGroup = 0
  let mostTechniquesInOneStep = 0
  for (const move of moves) {
    const techniques = move.dynamicTechniques ?? []
    mostTechniquesInOneStep = Math.max(mostTechniquesInOneStep, techniques.length)
    for (const technique of techniques) {
      hardestGroup = Math.max(hardestGroup, RULE3_TECHNIQUE_GROUPS.findIndex((group) => group.techniques.includes(technique)))
    }
  }
  return { hardestGroup, mostTechniquesInOneStep }
}

export interface SolvePathStep {
  /** The full instance chosen for this step, captured once at search
   * time - not just its id/name, but everything the Techniques tab's own
   * highlight rendering needs (usedCells, usedCandidates, moves, etc.),
   * so selecting this step can drive that exact same highlight/explain
   * path instead of a separate one. Its own eliminated/solved candidates
   * (via fullTechniqueEffect) are what applying it replays, rather than
   * needing to re-derive them (which would require the live board to
   * still match boardBefore exactly). */
  instance: TechniqueInstance
  boardBefore: Board
  candidatesBefore: CandidateGrid
}

export interface SolvePathResult {
  steps: SolvePathStep[]
  solvedFully: boolean
  stoppedReason: 'solved' | 'stuck' | 'step-cap' | 'time-budget'
  /** Whether this path was picked with pickEasiestInstance ("Easy Solve").
   * Stored rather than read from the live setting, since toggling the
   * checkbox doesn't regenerate an existing path. */
  easySolve: boolean
  /** One line per step (plus a final summary), for the "how was this
   * calculated" log window - the console gets the same lines. */
  log: string[]
}

// Generous on purpose: this also decides the "Solvable" verdict under the grid, and
// a search that merely runs out of time must not be mistaken for one that got
// stuck (that used to happen - the more Dynamic Dragon techniques were ticked, the
// slower each step, until a perfectly solvable puzzle was reported as needing brute
// force). A search that genuinely gets stuck stops long before this; only a long,
// still-progressing one (e.g. Exhaustive Dragon OFF, where every Dragon chain is its
// own step) gets anywhere near it. Only a fallback now: the app passes the
// user's "Solve path timeout" setting (solvePathTimeoutMs) in instead.
export const SOLVE_PATH_TIME_BUDGET_MS = 12000
export const SOLVE_PATH_MAX_STEPS = 200

/**
 * Finds a sequence of technique applications - a full Dragon Colouring or
 * Dynamic Dragon Colouring chain counts as a single step, regardless of
 * how many moves it took internally - that solves the puzzle from the
 * given board/candidates through to completion.
 *
 * Truly minimizing the step count would mean searching every combination
 * of technique choices at every step - combinatorially intractable for a
 * full puzzle. Instead this uses a greedy heuristic (see
 * pickGreedyInstance): always take whichever currently-applicable
 * technique solves the most cells right now - there's no branching or
 * backtracking, so there's exactly one candidate chosen per step, not
 * several branches compared against each other. That keeps the path short
 * without an exponential search, at the cost of not being provably
 * minimal - a different, harder-to-justify choice at some step could
 * occasionally shave off a step later on. A wall-clock budget bounds the
 * total search time regardless of puzzle difficulty; if it's hit, the
 * path found so far is returned. Every call logs how the path was found,
 * how long each step's own evaluation took, and why it stopped, so that
 * tradeoff is never silent - see the log field and the Solve Path tab's
 * "View search log" option.
 */
export function boardsEqual(a: Board, b: Board): boolean {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (a[r][c] !== b[r][c]) {
        return false
      }
    }
  }
  return true
}

export function candidatesEqual(a: CandidateGrid, b: CandidateGrid): boolean {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      for (let d = 0; d < 9; d++) {
        if (a[r][c][d] !== b[r][c][d]) {
          return false
        }
      }
    }
  }
  return true
}
export function buildSolvePath(
  board: Board,
  candidates: CandidateGrid,
  allowedRule3Techniques: ReadonlySet<Rule3Technique> = new Set(DEFAULT_RULE3_TECHNIQUES),
  shortAicEnabled = true,
  shortSingleDigitAicEnabled = true,
  aicLimitPerDragonStep = true,
  exhaustiveDragon = true,
  genericAicEnabled = false,
  easySolveEnabled = false,
  optimizeDragons = false,
  optimizeDynamicDragons = false,
  timeBudgetMs = SOLVE_PATH_TIME_BUDGET_MS,
  dynamicDragonEnabled = true,
  enabledFish: ReadonlySet<FishTechnique> = new Set(),
  alsXzEnabled = false,
  maxTechniquesPerDragonStep = Infinity,
  doubleDragonEnabled = false,
  doubleDynamicDragonEnabled = false,
  givens: GivenMask | null = null,
  enabledExotic: ReadonlySet<ExoticTechnique> = new Set(),
  urAicEnabled = false,
  alsAicEnabled = false,
  groupedAicEnabled = false,
  // "Prefer easier double dragons": only means anything under Easy Solve.
  preferEasierDoubleDragons = false,
  // "Prefer easiest techs within dragon": likewise.
  preferEasiestDragonTechniques = false,
  // The Techniques list's "Dragon: require 3+ base Medusa candidates" filter
  // (0 = off): the path then only takes Dragons the list would show.
  minBaseMedusaCandidates = 0,
): SolvePathResult {
  const startedAt = Date.now()
  const steps: SolvePathStep[] = []
  const pickInstance = easySolveEnabled
    ? (instances: TechniqueInstance[]) => pickEasiestInstance(instances, preferEasierDoubleDragons, preferEasiestDragonTechniques)
    : pickGreedyInstance
  const log: string[] = [
    easySolveEnabled
      ? 'Method: "Easy Solve", single-candidate-per-step (no branching/backtracking) - at each step, every ' +
        'currently-applicable technique is evaluated once and whichever is simplest is chosen, regardless of how ' +
        'much progress it makes (ties broken by ' +
        (preferEasiestDragonTechniques
          ? 'the easiest techniques inside a Dragon - the hardest technique group it uses, then the most techniques ' +
            'in any one of its steps - then by '
          : '') +
        'fewest Dragon Colouring steps, then most candidates eliminated). ' +
        'Techniques harder than the one chosen are not looked for at that step, so each step counts only the ' +
        'easiest applicable techniques. ' +
        (preferEasierDoubleDragons
          ? 'A Double Dynamic Dragon that uses easier techniques than every single Dynamic Dragon needs counts as ' +
            'simpler than single Dynamic Dragon. '
          : '') +
        'This is not an exhaustive search for the true minimum step count, which is combinatorially intractable ' +
        'for a full puzzle.'
      : 'Method: greedy, single-candidate-per-step (no branching/backtracking) - at each step, every currently-applicable ' +
        'technique is evaluated once and whichever solves the most cells right now is chosen (ties broken by most ' +
        'candidates eliminated, then by simplest technique). This is not an exhaustive search for the true minimum ' +
        'step count, which is combinatorially intractable for a full puzzle.',
  ]
  let curBoard = board
  let curCandidates = candidates
  let stoppedReason: SolvePathResult['stoppedReason'] = 'stuck'

  while (steps.length < SOLVE_PATH_MAX_STEPS) {
    if (curBoard.every((row) => row.every((v) => v !== 0))) {
      stoppedReason = 'solved'
      break
    }
    if (Date.now() - startedAt > timeBudgetMs) {
      stoppedReason = 'time-budget'
      break
    }

    const stepStart = Date.now()
    const instances = buildTechniqueInstances(
      curBoard,
      curCandidates,
      minBaseMedusaCandidates,
      allowedRule3Techniques,
      shortAicEnabled,
      shortSingleDigitAicEnabled,
      aicLimitPerDragonStep,
      exhaustiveDragon,
      genericAicEnabled,
      optimizeDragons,
      optimizeDynamicDragons,
      dynamicDragonEnabled,
      enabledFish,
      alsXzEnabled,
      maxTechniquesPerDragonStep,
      doubleDragonEnabled,
      doubleDynamicDragonEnabled,
      givens,
      enabledExotic,
      urAicEnabled,
      alsAicEnabled,
      groupedAicEnabled,
      false,
      // The greedy picker compares every row, so it needs the whole list.
      easySolveEnabled ? { preferEasierDoubleDragons } : false,
    )
    const chosen = pickInstance(instances)
    const stepElapsed = Date.now() - stepStart
    if (!chosen) {
      log.push(`Step ${steps.length + 1}: no technique applies (evaluated 0 candidates in ${stepElapsed}ms) - stuck.`)
      stoppedReason = 'stuck'
      break
    }

    const effect = fullTechniqueEffect(chosen)
    log.push(
      `Step ${steps.length + 1}: chose "${chosen.name}" (solves ${effect.solvedCandidates.length} cell${effect.solvedCandidates.length === 1 ? '' : 's'}, eliminates ${effect.eliminatedCandidates.length} candidate${effect.eliminatedCandidates.length === 1 ? '' : 's'}) - evaluated ${instances.length} applicable technique${instances.length === 1 ? '' : 's'} in ${stepElapsed}ms (cumulative ${Date.now() - startedAt}ms).`,
    )

    steps.push({
      instance: chosen,
      boardBefore: curBoard,
      candidatesBefore: curCandidates,
    })

    const next = applyTechniqueEffect(curBoard, curCandidates, effect)
    curBoard = next.board
    curCandidates = next.candidates
  }

  if (steps.length >= SOLVE_PATH_MAX_STEPS && stoppedReason !== 'solved') {
    stoppedReason = 'step-cap'
  }

  const elapsed = Date.now() - startedAt
  const solvedFully = stoppedReason === 'solved'
  const stopSummary =
    stoppedReason === 'solved'
      ? 'reached a full solve'
      : stoppedReason === 'time-budget'
        ? `stopped after hitting the ${timeBudgetMs}ms time budget - the puzzle may need more steps than shown`
        : stoppedReason === 'step-cap'
          ? `stopped after hitting the ${SOLVE_PATH_MAX_STEPS}-step safety cap`
          : 'got stuck - no known technique applies from here; the rest would need brute force'
  log.push(`Total: ${steps.length} step${steps.length === 1 ? '' : 's'} found in ${elapsed}ms - ${stopSummary}.`)
  //for (const line of log) {
    //console.log(`[Solve Path] ${line}`)
 // }

  return { steps, solvedFully, stoppedReason, easySolve: easySolveEnabled, log }
}
