/**
 * The technique engine: every finder wired into one flat, simplest-first
 * TechniqueInstance list (buildTechniqueInstances), and the Solve Path search
 * built on it (buildSolvePath). Pure logic, no React or DOM - kept out of
 * App.tsx so solvePath.worker.ts can run the (up to many seconds) search off
 * the main thread.
 */
import { cloneBoard, cloneCandidates, markedCandidateDigits } from './sudoku/boardUtils'
import { SudokuAlsXzFinder, type AlsXzInstance } from './sudoku/SudokuAlsXzFinder'
import { SudokuBivalueOddagonFinder } from './sudoku/SudokuBivalueOddagonFinder'
import { SudokuBugPlusOneFinder } from './sudoku/SudokuBugPlusOneFinder'
import { SudokuColorFinder } from './sudoku/SudokuColorFinder'
import {
  SudokuDragonFinder,
  DEFAULT_RULE3_TECHNIQUES,
  type DragonMove,
  type Rule3Technique,
} from './sudoku/SudokuDragonFinder'
import { foldDragonMoves } from './sudoku/dragonReplay'
import { formatCandidate, listEffectiveEliminations, type TargetProblem } from './sudoku/SudokuDragonTargetFinder'
import { FISH_TECHNIQUE_NAMES, SudokuFishFinder, type FishInstance, type FishTechnique } from './sudoku/SudokuFishFinder'
import { SudokuHiddenPairFinder } from './sudoku/SudokuHiddenPairFinder'
import { SudokuLockedCandidateFinder } from './sudoku/SudokuLockedCandidateFinder'
import { type MassEliminationInstance, SudokuMedusaFinder } from './sudoku/SudokuMedusaFinder'
import { SudokuNakedSubsetFinder } from './sudoku/SudokuNakedSubsetFinder'
import { SudokuPairFinder } from './sudoku/SudokuPairFinder'
import { BOARD_SIZE, SudokuRules } from './sudoku/SudokuRules'
import { SudokuGenericAicFinder } from './sudoku/SudokuGenericAicFinder'
import { classifyShortAic, SudokuShortAicFinder, type ShortAicInstance, type ShortAicKind } from './sudoku/SudokuShortAicFinder'
import { SudokuSingleFinder } from './sudoku/SudokuSingleFinder'
import { SudokuUniqueRectangleFinder } from './sudoku/SudokuUniqueRectangleFinder'
import type { Board, CandidateGrid } from './sudoku/types'


export const singleFinder = new SudokuSingleFinder()
export const lockedCandidateFinder = new SudokuLockedCandidateFinder()
export const pairFinder = new SudokuPairFinder()
export const nakedSubsetFinder = new SudokuNakedSubsetFinder()
export const hiddenPairFinder = new SudokuHiddenPairFinder()
export const fishFinder = new SudokuFishFinder()
export const shortAicFinder = new SudokuShortAicFinder()
export const genericAicFinder = new SudokuGenericAicFinder()
export const alsXzFinder = new SudokuAlsXzFinder()
export const uniqueRectangleFinder = new SudokuUniqueRectangleFinder()
export const bugPlusOneFinder = new SudokuBugPlusOneFinder()
export const bivalueOddagonFinder = new SudokuBivalueOddagonFinder()
export const colorFinder = new SudokuColorFinder()
export const medusaFinder = new SudokuMedusaFinder()
export const dragonFinder = new SudokuDragonFinder()

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
  aicLinks?: Array<{ from: TechniqueCandidateRef; to: TechniqueCandidateRef; kind: 'strong' | 'weak' }>
  /** Dragon Colouring only: the ordered move log driving the move-by-move
   * player. When present, the panel row opens a stepper instead of
   * highlighting statically - the colors/eliminations/solves shown come
   * from folding moves[0..step] together, not from the fields above. */
  moves?: DragonMove[]
  /** This instance's difficulty tier - see the RANK_* constants below. Used
   * by the Solve Path search: the default search tie-breaks an equal-
   * eliminations choice on it, and "Easy Solve" sorts on it directly. */
  techniqueRank: number
}

/** Numeric difficulty tier for every technique, lowest = easiest - the exact
 * order buildTechniqueInstances below pushes its blocks in (see CLAUDE.md's
 * documented difficulty order: Single -> LockedCandidate ->
 * Pair/NakedSubset/HiddenPair -> UniqueRectangle -> BUG+1 -> BivalueOddagon
 * -> Color -> X-Wing -> Short Single-Digit AIC -> Finned X-Wing -> Short AIC
 * -> Swordfish -> Finned Swordfish -> Medusa -> Generic AIC -> ALS-xz -> Dragon
 * -> Dynamic Dragon).
 * Techniques sharing a tier are equally "simple" as far as this goes - a
 * naked pair is no simpler than a naked quad here, since a solver who can
 * spot one can spot the other; what matters is the category, not which
 * specific instance of it happened to be found. Adding a new technique?
 * Give its instances a rank here too, in its place in the difficulty order -
 * see CLAUDE.md's "Adding a technique" note. */
export const RANK_SINGLE = 0
export const RANK_LOCKED_CANDIDATE = 1
export const RANK_SUBSET = 2 // naked pair/triple/quad, hidden pair
export const RANK_UR = 3
export const RANK_BUG_PLUS_ONE = 4
export const RANK_BIVALUE_ODDAGON = 5
export const RANK_SIMPLE_COLOR = 6
// The fish interleave with the short AICs, and each fish is its own tier
// (unlike the subsets above): a Swordfish is genuinely harder to spot than an
// X-Wing, and a fin harder again.
export const RANK_X_WING = 7
export const RANK_SHORT_SINGLE_DIGIT_AIC = 8
export const RANK_FINNED_X_WING = 9
export const RANK_SHORT_AIC = 10
export const RANK_SWORDFISH = 11
export const RANK_FINNED_SWORDFISH = 12
export const RANK_MEDUSA = 13
// Harder than 3D Medusa: a long chain is harder to find than a colouring.
export const RANK_GENERIC_AIC = 14
// The one non-colouring technique ranked above Generic AIC.
export const RANK_ALS_XZ = 15
export const RANK_DRAGON = 16
export const RANK_DYNAMIC_DRAGON = 17

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
  const chainText = aic.nodes
    .map((n, i) => {
      const connector = i === 0 ? '' : i % 2 === 1 ? ' = ' : ' - '
      return `${connector}${n.digit}${cellRef(n.row, n.col)}`
    })
    .join('')
  const eliminationText = aic.eliminations.map((e) => `${cellRef(e.row, e.col)} cannot be ${e.digit}`).join(', ')
  const techniqueRank =
    idPrefix === 'short-single-digit-aic'
      ? RANK_SHORT_SINGLE_DIGIT_AIC
      : idPrefix === 'short-aic'
        ? RANK_SHORT_AIC
        : RANK_GENERIC_AIC
  return {
    id: `${idPrefix}-${aic.eliminationType}-${aic.nodes.map((n) => `${n.row}.${n.col}.${n.digit}`).join('-')}`,
    name,
    notation: `${chainText} states that either ${x.digit}${cellRef(x.row, x.col)} or ${y.digit}${cellRef(y.row, y.col)} must be true, so ${eliminationText}.`,
    usedCells: [],
    usedCandidates: [],
    eliminatedCandidates: aic.eliminations,
    solvedCandidates: [],
    aicCandidates: aic.nodes.map((n) => ({ row: n.row, col: n.col, digit: n.digit })),
    aicLinks: aic.links.map((link) => ({
      from: { row: link.from.row, col: link.from.col, digit: link.from.digit },
      to: { row: link.to.row, col: link.to.col, digit: link.to.digit },
      kind: link.kind,
    })),
    techniqueRank,
  }
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
          (row === placed.row ||
            col === placed.col ||
            (Math.floor(row / 3) === Math.floor(placed.row / 3) && Math.floor(col / 3) === Math.floor(placed.col / 3)))
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
): TechniqueInstance[] {
  const instances: TechniqueInstance[] = []

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

  for (const ur of uniqueRectangleFinder.find(board, candidates)) {
    const conclusion =
      ur.solvedCandidates.length > 0
        ? ur.solvedCandidates.map((s) => `${cellRef(s.row, s.col)} is ${s.digit}`).join(', ')
        : ur.eliminatedCandidates.map((e) => `${cellRef(e.row, e.col)} cannot be ${e.digit}`).join(', ')
    const idSuffix = ur.cells.map(([row, col]) => `${row}.${col}`).join('-')

    instances.push({
      id: `ur-${ur.type.replace(/\s+/g, '').toLowerCase()}-${idSuffix}-${ur.urDigits.join(',')}`,
      name: `Unique Rectangle (${ur.type})`,
      notation: `${ur.reasonText}, thus ${conclusion}`,
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

  const bugPlusOne = bugPlusOneFinder.find(board, candidates)
  if (bugPlusOne) {
    const [row, col] = bugPlusOne.cell
    const candidatesLabel = bugPlusOne.candidates.join(',')
    instances.push({
      id: `bug-plus-one-${row}.${col}`,
      name: 'BUG+1',
      notation: `${cellRef(row, col)} (candidates ${candidatesLabel}) is the only cell with more than two candidates; ${bugPlusOne.solvedDigit} appears 3 times in its ${bugPlusOne.unitKind}, so ${cellRef(row, col)} is ${bugPlusOne.solvedDigit}`,
      usedCells: [...bugPlusOne.unit],
      usedCandidates: bugPlusOne.unit
        .filter(([r, c]) => board[r][c] === 0 && candidates[r][c][bugPlusOne.solvedDigit - 1])
        .map(([r, c]) => ({ row: r, col: c, digit: bugPlusOne.solvedDigit })),
      eliminatedCandidates: [],
      solvedCandidates: [{ row, col, digit: bugPlusOne.solvedDigit }],
      techniqueRank: RANK_BUG_PLUS_ONE,
    })
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
        rule1Instances.push({
          id: `simple-color-rule1-${digit}-${chainKey}`,
          name: `Simple Colouring Rule 1 (${digit})`,
          notation: `Light ${rule1.falseColor} is false, so light ${rule1.trueColor} is true.`,
          usedCells,
          usedCandidates: [],
          eliminatedCandidates: [],
          solvedCandidates: [],
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

  // Fish and the short AICs interleave in the difficulty order (X-Wing <
  // Short Single-Digit AIC < Finned X-Wing < Short AIC < Swordfish < Finned
  // Swordfish), so they're gathered together and pushed rank by rank. Short
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
          isSingleDigit ? 'Short Single-Digit AIC' : `Short AIC (Type ${aic.eliminationType})`,
        ),
      )
    }
  }
  // Stable, so each technique keeps the finder's own order.
  middleTier.sort((a, b) => a.techniqueRank - b.techniqueRank)
  pushUnlessCoveredByEasier(instances, middleTier)

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
          `In ${cellRef(mass.conflict.row, mass.conflict.col)}, ${mass.conflict.digitA} and ${mass.conflict.digitB} are both ${mass.conflict.color}, so ${mass.conflict.color} is false and ${mass.trueColor} is true.`,
        )
        medusaHighlightCells.push([mass.conflict.row, mass.conflict.col])
      } else if (mass.conflict.kind === 'unit') {
        rules.add(1)
        clauses.push(
          `${mass.conflict.digit} in ${cellRef(...mass.conflict.a)}, ${cellRef(...mass.conflict.b)} are both ${mass.conflict.color}, so ${mass.conflict.color} is false and ${mass.trueColor} is true.`,
        )
        medusaHighlightCells.push(mass.conflict.a, mass.conflict.b)
      } else {
        rules.add(2)
        clauses.push(
          `${cellRef(mass.conflict.row, mass.conflict.col)} has no coloured candidates, but ${mass.conflict.digits.join(', ')} all see ${mass.conflict.color}, so ${mass.conflict.color} is false and ${mass.trueColor} is true.`,
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
      const opponentColor = r5.coloredColor === 'blue' ? 'yellow' : 'blue'
      clauses.push(
        `${cellRef(r5.row, r5.col)} is not ${r5.eliminatedDigit} (it sees opposite colour ${opponentColor} at ${cellRef(...r5.opponent)}).`,
      )
      usedCandidates.push({ row: r5.row, col: r5.col, digit: r5.coloredDigit })
      eliminate(r5.row, r5.col, r5.eliminatedDigit)
      medusaHighlightCells.push([r5.row, r5.col])
    }

    if (rules.size === 0) {
      continue
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
    ;(mass ? massMedusaInstances : otherMedusaInstances).push(instance)
  }

  instances.push(...massMedusaInstances, ...otherMedusaInstances)

  // Generic AIC (chains longer than Short AIC's, up to GENERIC_AIC_MAX_LENGTH
  // links) ranks after 3D Medusa: a long chain that only reaches what any
  // easier row already does - a Short AIC, a fish, a Medusa rule - isn't
  // listed.
  if (genericAicEnabled) {
    pushUnlessCoveredByEasier(
      instances,
      genericAicFinder
        .findGenericAics(board, candidates)
        .map((aic) => buildAicInstance(aic, 'generic-aic', `Generic AIC (Type ${aic.eliminationType}, ${aic.length} links)`)),
    )
  }

  // ALS-xz (singly linked only) ranks after Generic AIC. Every ALS-xz is an
  // AIC with ALS nodes, and the short ones are often a naked pair, a Short
  // AIC or a Medusa rule in disguise, so a row an easier one already makes in
  // full isn't listed.
  if (alsXzEnabled) {
    pushUnlessCoveredByEasier(instances, alsXzFinder.find(board, candidates).map(buildAlsXzInstance))
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
  )
  dynamicDragonExtensions.sort((a, b) => a.moves.length - b.moves.length)
  for (const { chainKey, moves } of dynamicDragonExtensions) {
    instances.push(buildDragonInstance(board, candidates, 'dynamic-dragon', dynamicDragonLabel(moves), chainKey, moves))
  }

  return instances
}

/** Appends `candidates` (sorted by techniqueRank) to `instances`, except any
 * whose eliminations rows of a strictly lower rank - everything already in
 * `instances`, plus lower tiers of `candidates` itself - already make in
 * full. Only elimination-only rows can be hidden this way; one that solves a
 * cell is always kept. */
function pushUnlessCoveredByEasier(instances: TechniqueInstance[], candidates: TechniqueInstance[]): void {
  const keyOf = (e: TechniqueCandidateRef) => `${e.row},${e.col},${e.digit}`
  const covered = new Set(instances.flatMap((instance) => instance.eliminatedCandidates.map(keyOf)))
  let tierRank = -1
  let tierKeys: string[] = []
  for (const candidate of candidates) {
    if (candidate.techniqueRank !== tierRank) {
      tierKeys.forEach((key) => covered.add(key))
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

export function buildDragonInstance(
  board: Board,
  candidates: CandidateGrid,
  idPrefix: string,
  name: string,
  chainKey: string,
  moves: DragonMove[],
): TechniqueInstance {
  const lastMove = moves[moves.length - 1]
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
          const fact = `${lastMove.provenTrueColor === 'blue' ? 'light blue' : 'yellow'} is true`
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
        ? `${lastMove.provenTrueColor === 'blue' ? 'light blue' : 'yellow'} covers every empty cell, solving the puzzle`
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
    techniqueRank: idPrefix === 'dragon' ? RANK_DRAGON : RANK_DYNAMIC_DRAGON,
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
      'BUG+1',
      'bivalue oddagon',
      'x-wing',
      'short single-digit aic',
      'finned x-wing',
      'short aic',
      'swordfish',
      'finned swordfish',
      'generic aic',
      'als-xz',
    ] as const
  ).filter((t) => techniquesUsed.has(t))
  return orderedTechniques.length > 0
    ? `Dynamic Dragon Colouring (${orderedTechniques.join(', ')})`
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
 * and chain length no longer distinguish two instances. */
export function pickEasiestInstance(instances: TechniqueInstance[]): TechniqueInstance | null {
  let best: TechniqueInstance | null = null
  let bestSteps = Infinity
  let bestEliminated = -1
  for (const instance of instances) {
    const rank = instance.techniqueRank
    const steps = dragonStepCount(instance)
    if (!best || rank < best.techniqueRank || (rank === best.techniqueRank && steps < bestSteps)) {
      best = instance
      bestSteps = steps
      bestEliminated = fullTechniqueEffect(instance).eliminatedCandidates.length
      continue
    }
    if (rank === best.techniqueRank && steps === bestSteps) {
      const eliminated = fullTechniqueEffect(instance).eliminatedCandidates.length
      if (eliminated > bestEliminated) {
        best = instance
        bestSteps = steps
        bestEliminated = eliminated
      }
    }
  }
  return best
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
): SolvePathResult {
  const startedAt = Date.now()
  const steps: SolvePathStep[] = []
  const pickInstance = easySolveEnabled ? pickEasiestInstance : pickGreedyInstance
  const log: string[] = [
    easySolveEnabled
      ? 'Method: "Easy Solve", single-candidate-per-step (no branching/backtracking) - at each step, every ' +
        'currently-applicable technique is evaluated once and whichever is simplest is chosen, regardless of how ' +
        'much progress it makes (ties broken by fewest Dragon Colouring steps, then most candidates eliminated). ' +
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
      0,
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
