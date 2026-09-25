import { cloneBoard, cloneCandidates, computeGivenMask, createEmptyCandidates } from './boardUtils'
import { SudokuBivalueOddagonFinder } from './SudokuBivalueOddagonFinder'
import { SudokuBugPlusOneFinder } from './SudokuBugPlusOneFinder'
import { SudokuColorFinder } from './SudokuColorFinder'
import { SudokuDragonFinder } from './SudokuDragonFinder'
import { SudokuFishFinder, type FishTechnique } from './SudokuFishFinder'
import { SudokuHiddenPairFinder } from './SudokuHiddenPairFinder'
import { SudokuLockedCandidateFinder } from './SudokuLockedCandidateFinder'
import { type MedusaChain, SudokuMedusaFinder } from './SudokuMedusaFinder'
import { SudokuNakedSubsetFinder } from './SudokuNakedSubsetFinder'
import { SudokuPairFinder } from './SudokuPairFinder'
import { BOARD_SIZE, SudokuRules } from './SudokuRules'
import { SudokuGenericAicFinder } from './SudokuGenericAicFinder'
import { SudokuAlsXzFinder } from './SudokuAlsXzFinder'
import { classifyShortAic, SudokuShortAicFinder } from './SudokuShortAicFinder'
import { SudokuSingleFinder } from './SudokuSingleFinder'
import { SudokuSolver } from './SudokuSolver'
import { SudokuUniqueRectangleFinder } from './SudokuUniqueRectangleFinder'
import { sudokuUnits } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
/** A generous backstop only - `generate` is normally bounded by
 * `timeBudgetMs`, not by attempt count (each attempt's own cost varies a
 * lot with how quickly a random solved grid's reduction dead-ends). This
 * just prevents a runaway loop if a caller passes a near-zero budget. */
const MAX_GRID_ATTEMPTS = 1_000_000
const DEFAULT_TIME_BUDGET_MS = 30_000
/** How long generate()'s attempt loop is allowed to run uninterrupted
 * before it hands control back to the browser for a tick - without this,
 * a long timeBudgetMs (a minute, five minutes) blocks the main thread
 * continuously for that whole duration, which is exactly what trips
 * Chrome's own "Page Unresponsive" warning, not just makes the UI feel
 * laggy. Short enough that even a run that's about to succeed on the very
 * next attempt still yields well before the browser's own hang detector
 * would fire. */
const YIELD_INTERVAL_MS = 50
/** Above this many remaining clues, `reduceUntilDragonNeeded` skips calling
 * `buildRobustCheckpoint` entirely and just keeps reducing - not a
 * probabilistic shortcut, but exploiting that `buildRobustCheckpoint`'s
 * very first check, `isFullySolved` (naked/hidden singles alone fully
 * solve the board - see solveWithSinglesOnly), makes every check after it
 * moot once it's true: a fully-solved board has no empty cells left, so
 * every other check (locked candidates, pairs, subsets, hidden pairs, UR,
 * BUG+1, Bivalue Oddagon, Simple Colouring, AIC, Medusa/Dragon) is
 * necessarily a no-op against it too (there's nothing left with candidates
 * to search). So "skip the whole call above this threshold" and "call it
 * and let isFullySolved reject it" are exactly the same outcome, for any
 * board this dense - the skip just avoids paying for the computation.
 * Calibrated with a dedicated ~900k-trial sweep (many random solved grids,
 * reduced one clue at a time down to whatever a bare uniqueness check
 * allows, checking only solveWithSinglesOnly + isFullySolved - no other
 * finder) that found singles alone were *always* still enough above 51
 * remaining clues, never once falling short; this constant keeps a wide
 * margin above that observed ceiling. Before this optimization, profiling
 * the reported-slow case (requireDynamic + no AIC kind disregarded) showed
 * ~95% of all buildRobustCheckpoint calls - the majority of the generator's
 * total time - were this exact wasted case, concentrated entirely above
 * clue count 45. Re-run that calibration sweep (kept as a throwaway script,
 * not checked in) before lowering this number. */
const PHASE1_CLUE_THRESHOLD = 55

/** Lookup tables for solveWithSinglesOnly's bitmask search, cells indexed
 * row * 9 + col. */
const FULL_DIGIT_MASK = (1 << BOARD_SIZE) - 1
const BOX_OF: number[] = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, cell) => {
  const r = Math.floor(cell / BOARD_SIZE)
  const c = cell % BOARD_SIZE
  return Math.floor(r / 3) * 3 + Math.floor(c / 3)
})
const UNIT_CELLS: number[][] = sudokuUnits().map((unit) => unit.map(([r, c]) => r * BOARD_SIZE + c))

/** Hands control back to the browser's event loop for a tick - see
 * YIELD_INTERVAL_MS. A plain `setTimeout(resolve, 0)` rather than
 * `requestAnimationFrame`, since rAF never fires in a backgrounded tab and
 * a generation the user tabbed away from should still keep progressing
 * (just slower, throttled like any other background timer) rather than
 * stall completely. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

type CellCoordinate = [row: number, col: number]

/** Which Short AIC kinds a checkpoint may still have available. */
interface DisregardedAicKinds {
  singleDigit: boolean
  general: boolean
  /** Generic AIC: chains longer than Short AIC's 5 links. */
  generic: boolean
}

/** What a checkpoint must satisfy - DragonPuzzleGenerateOptions with its
 * defaults resolved. */
interface CheckpointTarget {
  technique: GeneratedPuzzleTechnique
  requireDynamic: boolean
  forbidPlainDragon: boolean
  disregardKinds: DisregardedAicKinds
  enabledFish: ReadonlySet<FishTechnique>
  alsXzEnabled: boolean
}

/** The technique a generated puzzle state is built around - the easiest
 * move available once candidates are freshly autofilled. */
export type GeneratedPuzzleTechnique = 'simple-colouring' | 'medusa' | 'dragon'

export interface GeneratedDragonPuzzle {
  board: Board
  givens: boolean[][]
  candidates: CandidateGrid
}

export interface DragonPuzzleGenerateOptions {
  /** Which technique the state must need (default 'dragon'):
   *  - 'simple-colouring': every technique easier than Simple Colouring
   *    (singles through Bivalue Oddagon, in the app's difficulty order)
   *    fails, and Simple Colouring rule 1 or 2 applies.
   *  - 'medusa': the same plus Simple Colouring fails, and some 3D Medusa
   *    chain has a mass elimination (rules 1-2) or a rule 3/4/5 elimination.
   *  - 'dragon': see the class comment; requireDynamic/forbidPlainDragon and
   *    the disregard* AIC flags only apply here.
   * The two colouring targets skip every AIC check: Simple Colouring and
   * Medusa eliminations can always also be expressed as an AIC (usually a
   * short one), so "no AIC available" would reject essentially every state.
   * Such states are common (seconds at most), unlike Dragon ones. */
  target?: GeneratedPuzzleTechnique
  /** When true, generates a puzzle where plain Dragon Colouring (Rules 1-2
   * and Promotion alone) is *not* enough - Dynamic Dragon Colouring's
   * Extension Rule 3 (naked pairs / Unique Rectangle Type 1 propagated
   * through a side's assumption) is what's actually needed. */
  requireDynamic?: boolean
  /** Only with requireDynamic. When false (the default), it's enough that
   * one stuck chain needs Dynamic Dragon - plain Dragon may still work on
   * some other chain. When true, plain Dragon must fail on *every* chain,
   * so Dynamic Dragon is the only way forward. Such positions are ~30-60x
   * rarer (~3 minutes of 14-worker search each), so the app serves them from
   * a pre-generated stock (dynamicDragonPuzzleStock.ts) instead of
   * generating live. */
  forbidPlainDragon?: boolean
  /** Wall-clock budget for the whole search, across as many fresh solved
   * grids as it takes - defaults to DEFAULT_TIME_BUDGET_MS. A qualifying
   * checkpoint (especially a Dynamic-Dragon-only one) can be rare enough
   * that finding one is mostly a function of how long the search keeps
   * retrying with fresh random grids, not of any single grid's own cost. */
  timeBudgetMs?: number
  /** When true (the default), a checkpoint may also have a Short
   * Single-Digit AIC available alongside the Dragon technique; when false,
   * one existing means "something easier than Dragon still works" and the
   * checkpoint is rejected. */
  disregardSingleDigitAic?: boolean
  /** Same as disregardSingleDigitAic, for the general Short AIC (everything
   * classifyShortAic doesn't call single-digit). The two are independent
   * here; the UI is what keeps "don't disregard general AIC" from being
   * combined with "disregard single-digit AIC". */
  disregardAic?: boolean
  /** Same again for Generic AIC (see SudokuGenericAicFinder). The UI only
   * lets this be false when disregardAic is too. */
  disregardGenericAic?: boolean
  /** The fish the player has enabled in Settings (none by default). Unlike
   * the AIC kinds there's no separate "disregard" choice: an enabled fish is
   * simply one more technique easier than 3D Medusa (and harder than Simple
   * Colouring), so a checkpoint where one applies is rejected for the 'medusa'
   * and 'dragon' targets (it would be the easier move), and the solvability
   * grind may use it (the player can too). */
  enabledFish?: readonly FishTechnique[]
  /** ALS-xz enabled in Settings (off by default) - handled like an enabled
   * fish, except that it ranks above 3D Medusa and Generic AIC (just below
   * Dragon), so it only ever rejects a 'dragon' checkpoint. */
  alsXzEnabled?: boolean
}

/**
 * Generates a puzzle state where, the moment it's loaded and candidates are
 * freshly autofilled, Dragon Colouring is the only technique this app
 * implements that can make progress - naked/hidden singles, naked pairs/
 * triples/quads, hidden pairs, Unique Rectangle Type 1, Simple Colouring,
 * Short AIC, and 3D Medusa's own rules all come up empty. Short AIC comes
 * in two kinds (single-digit and general) that the caller can each choose
 * to disregard - by default both are, so the state may still have one
 * available next to the Dragon technique.
 *
 * That "the moment candidates are freshly autofilled" part is the subtlety:
 * naked pairs, Unique Rectangle Type 1's eliminations, and Medusa's rules
 * 3-5 only ever *eliminate* candidates, they never solve a cell, so their
 * effect isn't recorded anywhere a plain legality-based autofill would
 * preserve - re-autofilling would silently make them look newly available
 * again even though nothing about the board changed. So the board this
 * hands back is built using *only* naked/hidden singles (the one technique
 * that's inherently robust to that reset, since it never depends on
 * anything beyond which digits are already placed), and every other
 * technique is verified to fail against candidates that were themselves
 * just freshly autofilled - exactly the state the app is in right after
 * the puzzle loads and "Autofill all" is clicked.
 *
 * Reduction otherwise works like SudokuGenerator: clues are removed one at
 * a time (checking uniqueness via SudokuSolver after each), continuing
 * until a removal produces a board with that property, while confirming
 * end-to-end solvability by alternating Dragon Colouring with a full
 * (singles+pairs+UR1+colouring+medusa) grind - a removal that instead
 * demands something harder than Dragon Colouring is rejected and the clue
 * restored.
 */
export class SudokuDragonPuzzleGenerator {
  private readonly solver = new SudokuSolver()
  private readonly singleFinder = new SudokuSingleFinder()
  private readonly lockedCandidateFinder = new SudokuLockedCandidateFinder()
  private readonly pairFinder = new SudokuPairFinder()
  private readonly nakedSubsetFinder = new SudokuNakedSubsetFinder()
  private readonly hiddenPairFinder = new SudokuHiddenPairFinder()
  private readonly fishFinder = new SudokuFishFinder()
  private readonly uniqueRectangleFinder = new SudokuUniqueRectangleFinder()
  private readonly bugPlusOneFinder = new SudokuBugPlusOneFinder()
  private readonly bivalueOddagonFinder = new SudokuBivalueOddagonFinder()
  private readonly colorFinder = new SudokuColorFinder()
  private readonly shortAicFinder = new SudokuShortAicFinder()
  private readonly genericAicFinder = new SudokuGenericAicFinder()
  private readonly alsXzFinder = new SudokuAlsXzFinder()
  private readonly medusaFinder = new SudokuMedusaFinder()
  private readonly dragonFinder = new SudokuDragonFinder()

  /** Returns null if no qualifying puzzle turned up within the time budget
   * - rare, but this is a much narrower target than an ordinary generated
   * puzzle (a Dynamic-Dragon-only one especially so).
   *
   * async purely to yield periodically (see YIELD_INTERVAL_MS/
   * yieldToEventLoop) - the search itself is still ordinary synchronous
   * work between those yield points. This is the main-thread fallback
   * only: the app normally runs several `generateBlocking` searches in
   * parallel Web Workers instead (see ParallelDragonPuzzleGenerator). */
  async generate(options: DragonPuzzleGenerateOptions = {}): Promise<GeneratedDragonPuzzle | null> {
    const deadline = Date.now() + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS)
    let lastYield = Date.now()
    for (let attempt = 0; attempt < MAX_GRID_ATTEMPTS; attempt++) {
      const result = this.reduceUntilDragonNeeded(this.generateSolvedGrid(), options)
      if (result) {
        return result
      }
      if (Date.now() >= deadline) {
        return null
      }
      if (Date.now() - lastYield >= YIELD_INTERVAL_MS) {
        await yieldToEventLoop()
        lastYield = Date.now()
      }
    }
    return null
  }

  /** Same search as `generate`, but never yields - for a Web Worker, where
   * blocking is harmless (nothing else runs on that thread) and yielding
   * would actually cost throughput: every yield is a setTimeout chained
   * from inside another timer callback, which browsers clamp to >= 4ms once
   * nested deeply enough, i.e. ~8% of a 50ms slice lost to idling. The
   * worker is cancelled with `terminate()`, not by a message it would need
   * to yield in order to receive. */
  generateBlocking(options: DragonPuzzleGenerateOptions = {}): GeneratedDragonPuzzle | null {
    const deadline = Date.now() + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS)
    for (let attempt = 0; attempt < MAX_GRID_ATTEMPTS; attempt++) {
      const result = this.reduceUntilDragonNeeded(this.generateSolvedGrid(), options)
      if (result) {
        return result
      }
      if (Date.now() >= deadline) {
        return null
      }
    }
    return null
  }

  /** Re-checks an existing position against the same target
   * `generate` searches for (with the same options): returns it with
   * freshly autofilled candidates if it qualifies, else null. Used to
   * validate a pre-generated stock puzzle after a random symmetry
   * transform (see dynamicDragonPuzzleStock.ts) - the board must already be
   * solved as far as naked/hidden singles go, as every generated one is. */
  checkPuzzleState(board: Board, options: DragonPuzzleGenerateOptions = {}): GeneratedDragonPuzzle | null {
    const target = this.checkpointTarget(options)
    if (this.solver.solve(board).status !== 'solved') {
      return null
    }
    const checkpoint = this.buildRobustCheckpoint(board, target)
    if (!checkpoint || !this.isSolvableFromCheckpoint(checkpoint.board, checkpoint.candidates, this.solveWithDynamic(target), target)) {
      return null
    }
    return { board: checkpoint.board, givens: computeGivenMask(checkpoint.board), candidates: checkpoint.candidates }
  }

  private checkpointTarget(options: DragonPuzzleGenerateOptions): CheckpointTarget {
    return {
      technique: options.target ?? 'dragon',
      requireDynamic: options.requireDynamic ?? false,
      forbidPlainDragon: options.forbidPlainDragon ?? false,
      disregardKinds: {
        singleDigit: options.disregardSingleDigitAic ?? true,
        general: options.disregardAic ?? true,
        generic: options.disregardGenericAic ?? true,
      },
      enabledFish: new Set(options.enabledFish ?? []),
      alsXzEnabled: options.alsXzEnabled ?? false,
    }
  }

  /** Whether the "rest of the puzzle is solvable" check may use Dynamic
   * Dragon rounds. A Dragon target keeps its original meaning (plain-only
   * unless requireDynamic). The colouring targets only constrain the
   * *first* move, so the rest may use anything the app implements, up to
   * Dynamic Dragon - otherwise Medusa/Simple Colouring puzzles that later
   * need a Dragon would be thrown away for no reason. */
  private solveWithDynamic(target: CheckpointTarget): boolean {
    return target.technique !== 'dragon' || target.requireDynamic
  }

  private reduceUntilDragonNeeded(solved: Board, options: DragonPuzzleGenerateOptions): GeneratedDragonPuzzle | null {
    const puzzle = cloneBoard(solved)
    const target = this.checkpointTarget(options)
    let clueCount = BOARD_SIZE * BOARD_SIZE

    for (const [row, col] of this.shuffled(this.allCoordinates())) {
      const removedValue = puzzle[row][col]
      if (removedValue === 0) {
        continue
      }
      puzzle[row][col] = 0

      if (this.solver.solve(puzzle).status !== 'solved') {
        puzzle[row][col] = removedValue
        continue
      }
      clueCount--

      // Above PHASE1_CLUE_THRESHOLD, buildRobustCheckpoint is guaranteed
      // (per its own calibration comment) to reject as "still too easy" -
      // exactly the same outcome as this `continue` produces, minus the
      // cost of actually computing it. See PHASE1_CLUE_THRESHOLD's comment
      // for why this is safe, not just a probabilistic shortcut.
      if (clueCount > PHASE1_CLUE_THRESHOLD) {
        continue
      }

      const checkpoint = this.buildRobustCheckpoint(puzzle, target)
      if (!checkpoint) {
        // Still too easy (something short of the target technique still
        // works once candidates are freshly autofilled), or a dead end
        // where nothing at all applies - either way, keep reducing.
        continue
      }

      if (this.isSolvableFromCheckpoint(checkpoint.board, checkpoint.candidates, this.solveWithDynamic(target), target)) {
        // The first, sparsest point where the target technique becomes
        // necessary - and robustly so, surviving a fresh "Autofill all" -
        // while the puzzle is still solvable start to finish with what
        // this app implements. Exactly the target.
        //
        // givens comes from checkpoint.board, not puzzle: buildRobustCheckpoint
        // solved checkpoint.board further than puzzle via naked/hidden singles
        // (see solveWithSinglesOnly), so it has strictly more filled cells.
        // Those singles-derived cells are just as pre-filled as puzzle's own
        // clues from the player's perspective - nobody typed them in - so
        // marking only puzzle's cells as "given" would wrongly show some
        // pre-filled cells in the user-entry colour and (worse) leave them
        // editable/erasable despite never having been the player's own move.
        return { board: checkpoint.board, givens: computeGivenMask(checkpoint.board), candidates: checkpoint.candidates }
      }
      // This removal demands something harder than the target technique -
      // too far, put the clue back and try removing a different one.
      puzzle[row][col] = removedValue
      clueCount++
    }

    return null
  }

  /** Solves as far as naked/hidden singles alone can go. Candidates start
   * as a single fresh autofill from board legality, then are maintained
   * incrementally (`SudokuRules.eliminatePeerCandidates` after each
   * placement) rather than re-autofilled from scratch every round - the two
   * are provably equivalent here (verified against the old full-reautofill
   * version across ~900k comparisons, 0 mismatches, before this change):
   * autofilling is a pure function of board legality, and placing a digit
   * only ever changes *its own* peers' legality for *that* digit, so
   * incrementally clearing exactly those candidates always lands on the
   * same grid a full re-autofill would - it just skips redoing the
   * untouched 99% of the board every round. This was the single largest
   * cost in the whole generator (buildRobustCheckpoint calls this first,
   * on every clue removal it's asked to check) - see PHASE1_CLUE_THRESHOLD
   * for the other, bigger optimization this enabled. Singles are still the
   * only technique built this way (not naked pairs, UR, Medusa rules 3-5,
   * ...) because they're the only one whose result is inherently robust to
   * a legality-based reset in the first place - this incremental form
   * reaches the identical fixed point, it doesn't change what's robust.
   *
   * Implemented on row/column/box "digit used" bitmasks rather than via
   * SudokuSingleFinder + a CandidateGrid: even after the incremental change
   * above, this was ~57% of a worker's time in the requireDynamic + no-AIC-
   * disregarded case (SudokuSingleFinder.findHiddenSingles alone ~35%, from
   * allocating a filtered array per unit per digit per pass). Placing each
   * single immediately instead of in finder-sized batches can't change the
   * result: this is only ever called on a uniquely solvable clue set (the
   * caller has just checked), so every single is that cell's true digit,
   * and both kinds of single stay applicable (or get placed) as other true
   * digits land - a monotone closure with exactly one fixed point, whatever
   * the order. Verified equal to the SudokuSingleFinder version (board and
   * candidates) on 200k+ reduction states before switching. */
  private solveWithSinglesOnly(clueBoard: Board): { board: Board; candidates: CandidateGrid } {
    const board = cloneBoard(clueBoard)
    const rowUsed = new Array<number>(BOARD_SIZE).fill(0)
    const colUsed = new Array<number>(BOARD_SIZE).fill(0)
    const boxUsed = new Array<number>(BOARD_SIZE).fill(0)
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const value = board[r][c]
        if (value !== 0) {
          const bit = 1 << (value - 1)
          rowUsed[r] |= bit
          colUsed[c] |= bit
          boxUsed[BOX_OF[r * BOARD_SIZE + c]] |= bit
        }
      }
    }
    const available = (cell: number) =>
      FULL_DIGIT_MASK & ~(rowUsed[(cell / BOARD_SIZE) | 0] | colUsed[cell % BOARD_SIZE] | boxUsed[BOX_OF[cell]])
    const place = (cell: number, bit: number) => {
      const r = (cell / BOARD_SIZE) | 0
      const c = cell % BOARD_SIZE
      board[r][c] = 31 - Math.clz32(bit) + 1
      rowUsed[r] |= bit
      colUsed[c] |= bit
      boxUsed[BOX_OF[cell]] |= bit
    }

    for (let progress = true; progress; ) {
      progress = false
      for (let cell = 0; cell < BOARD_SIZE * BOARD_SIZE; cell++) {
        if (board[(cell / BOARD_SIZE) | 0][cell % BOARD_SIZE] !== 0) {
          continue
        }
        const mask = available(cell)
        if (mask !== 0 && (mask & (mask - 1)) === 0) {
          place(cell, mask)
          progress = true
        }
      }
      for (const unit of UNIT_CELLS) {
        // seenOnce/seenTwice: digits available in at least one / at least
        // two of this unit's empty cells - a hidden single is seenOnce &
        // ~seenTwice, then located with a second pass over the unit.
        let seenOnce = 0
        let seenTwice = 0
        for (const cell of unit) {
          if (board[(cell / BOARD_SIZE) | 0][cell % BOARD_SIZE] === 0) {
            const mask = available(cell)
            seenTwice |= seenOnce & mask
            seenOnce |= mask
          }
        }
        let hidden = seenOnce & ~seenTwice
        while (hidden !== 0) {
          const bit = hidden & -hidden
          hidden &= hidden - 1
          for (const cell of unit) {
            if (board[(cell / BOARD_SIZE) | 0][cell % BOARD_SIZE] === 0 && (available(cell) & bit) !== 0) {
              place(cell, bit)
              progress = true
              break
            }
          }
        }
      }
    }

    const candidates = createEmptyCandidates()
    for (let cell = 0; cell < BOARD_SIZE * BOARD_SIZE; cell++) {
      const r = (cell / BOARD_SIZE) | 0
      const c = cell % BOARD_SIZE
      if (board[r][c] === 0) {
        const mask = available(cell)
        candidates[r][c] = DIGITS.map((d) => (mask & (1 << (d - 1))) !== 0)
      }
    }
    return { board, candidates }
  }

  /** Builds the board+candidates state to hand back, or null if this clue
   * set doesn't (yet) have the property described on the class - checked
   * entirely against a freshly-autofilled candidate grid, matching what
   * the app itself will show right after the puzzle loads. */
  private buildRobustCheckpoint(
    clueBoard: Board,
    { technique, requireDynamic, forbidPlainDragon, disregardKinds, enabledFish, alsXzEnabled }: CheckpointTarget,
  ): { board: Board; candidates: CandidateGrid } | null {
    const { board, candidates } = this.solveWithSinglesOnly(clueBoard)

    if (this.isFullySolved(board)) {
      return null
    }
    if (this.lockedCandidateFinder.findEliminations(board, candidates).length > 0) {
      return null
    }
    if (this.pairFinder.findNakedPairEliminations(board, candidates).length > 0) {
      return null
    }
    if (this.nakedSubsetFinder.findNakedTripleEliminations(board, candidates).length > 0) {
      return null
    }
    if (this.nakedSubsetFinder.findNakedQuadEliminations(board, candidates).length > 0) {
      return null
    }
    if (this.hiddenPairFinder.findHiddenPairEliminations(board, candidates).length > 0) {
      return null
    }
    if (this.uniqueRectangleFinder.find(board, candidates).length > 0) {
      return null
    }
    if (this.bugPlusOneFinder.find(board, candidates)) {
      return null
    }
    if (this.bivalueOddagonFinder.find(board, candidates).length > 0) {
      return null
    }
    const simpleColouringApplies = this.anySimpleColoringApplies(board, candidates)
    if (technique === 'simple-colouring') {
      // No AIC check - see DragonPuzzleGenerateOptions.target.
      return simpleColouringApplies ? { board, candidates } : null
    }
    if (simpleColouringApplies) {
      return null
    }
    // Every fish ranks above Simple Colouring but below 3D Medusa.
    if (this.anyEnabledFish(board, candidates, enabledFish)) {
      return null
    }
    if (technique !== 'medusa' && this.anyBlockingShortAic(board, candidates, disregardKinds)) {
      return null
    }

    const chains = this.medusaFinder.findChains(board, candidates)
    const medusaApplies = chains.some((chain) => !this.isMedusaStuck(chain, board, candidates))
    if (technique === 'medusa') {
      return medusaApplies ? { board, candidates } : null
    }
    if (medusaApplies) {
      return null
    }
    // ALS-xz ranks between 3D Medusa (and Generic AIC) and Dragon.
    if (alsXzEnabled && this.alsXzFinder.find(board, candidates).length > 0) {
      return null
    }

    if (requireDynamic && forbidPlainDragon) {
      // Dynamic Dragon must be the *only* way forward: plain Dragon
      // Colouring fails on every stuck chain (all chains are stuck by this
      // point), and the dynamic extension (Extension Rule 3) succeeds on at
      // least one. A state where plain Dragon works on some other chain is
      // rejected even if another chain needs Dynamic - the player could
      // just take the plain move instead. Every plain check runs before any
      // dynamic one, since plain `extend` is far cheaper and rejects most
      // candidates on its own.
      if (chains.some((chain) => this.dragonFinder.extend(chain, board, candidates) !== null)) {
        return null
      }
      const someChainNeedsDynamic = chains.some(
        (chain) => this.dragonFinder.extend(chain, board, candidates, { dynamic: true }) !== null,
      )
      if (!someChainNeedsDynamic) {
        return null
      }
    } else if (requireDynamic) {
      // At least one stuck chain must specifically need the dynamic
      // extension - plain Dragon Colouring fails for that chain, but the
      // dynamic one (Extension Rule 3) succeeds. Other chains elsewhere on
      // the same board are free to be resolvable by plain Dragon; only this
      // one move, right at the start, has to require the dynamic extension
      // (see forbidPlainDragon for the stricter version).
      const someChainNeedsDynamic = chains.some((chain) => {
        if (this.dragonFinder.extend(chain, board, candidates) !== null) {
          return false
        }
        return this.dragonFinder.extend(chain, board, candidates, { dynamic: true }) !== null
      })
      if (!someChainNeedsDynamic) {
        return null
      }
    } else {
      const dragonCanProgress = chains.some((chain) => this.dragonFinder.extend(chain, board, candidates) !== null)
      if (!dragonCanProgress) {
        return null
      }
    }

    return { board, candidates }
  }

  private isMedusaStuck(chain: MedusaChain, board: Board, candidates: CandidateGrid): boolean {
    return (
      this.medusaFinder.findMassElimination(chain, board, candidates) === null &&
      this.medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
      this.medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
      this.medusaFinder.findRule5Eliminations(chain, candidates).length === 0
    )
  }

  /** True when an AIC of a kind the caller does *not* disregard has
   * eliminations. Uses the same finders and single-digit/general split the
   * app's Techniques panel does, so "a single-digit AIC exists" means the
   * same thing here as what the player would see listed. Skips each search
   * entirely when its kinds are disregarded, which is the default. */
  private anyBlockingShortAic(board: Board, candidates: CandidateGrid, disregarded: DisregardedAicKinds): boolean {
    if (!(disregarded.singleDigit && disregarded.general)) {
      const blockedByShort = this.shortAicFinder.findShortAics(board, candidates).some((aic) => {
        const singleDigit = classifyShortAic(aic) === 'single-digit'
        return singleDigit ? !disregarded.singleDigit : !disregarded.general
      })
      if (blockedByShort) {
        return true
      }
    }
    return !disregarded.generic && this.genericAicFinder.findGenericAics(board, candidates).length > 0
  }

  private anySimpleColoringApplies(board: Board, candidates: CandidateGrid): boolean {
    for (const digit of DIGITS) {
      for (const chain of this.colorFinder.findChains(board, candidates, digit)) {
        if (this.colorFinder.findRule1(chain) || this.colorFinder.findRule2(chain, board, candidates)) {
          return true
        }
      }
    }
    return false
  }

  /** From the checkpoint state, alternates a full easier-technique grind
   * with one round of Dragon Colouring - now that the checkpoint itself
   * is settled, using pairs/colouring/medusa for the *rest* of the solve
   * is completely fine, this is purely a check that nothing beyond Dragon
   * Colouring is ever needed on the way to a full solve. */
  private isSolvableFromCheckpoint(
    checkpointBoard: Board,
    checkpointCandidates: CandidateGrid,
    useDynamic: boolean,
    easierTechniques: Pick<CheckpointTarget, 'enabledFish' | 'alsXzEnabled'>,
  ): boolean {
    const board = cloneBoard(checkpointBoard)
    const candidates = cloneCandidates(checkpointCandidates)
    for (;;) {
      this.grindEasyTechniques(board, candidates, easierTechniques)
      if (this.isFullySolved(board)) {
        return true
      }
      if (!this.applyOneDragonRound(board, candidates, useDynamic)) {
        return false
      }
    }
  }

  private grindEasyTechniques(
    board: Board,
    candidates: CandidateGrid,
    { enabledFish, alsXzEnabled }: Pick<CheckpointTarget, 'enabledFish' | 'alsXzEnabled'>,
  ) {
    for (;;) {
      if (this.applySingles(board, candidates)) continue
      if (this.applyLockedCandidates(board, candidates)) continue
      if (this.applyNakedPairs(board, candidates)) continue
      if (this.applyNakedTriples(board, candidates)) continue
      if (this.applyNakedQuads(board, candidates)) continue
      if (this.applyHiddenPairs(board, candidates)) continue
      if (this.applyUniqueRectangleType1(board, candidates)) continue
      if (this.applyBugPlusOne(board, candidates)) continue
      if (this.applyBivalueOddagon(board, candidates)) continue
      if (this.applySimpleColoring(board, candidates)) continue
      if (this.applyFish(board, candidates, enabledFish)) continue
      if (this.applyShortAic(board, candidates)) continue
      if (this.applyMedusa(board, candidates)) continue
      if (alsXzEnabled && this.applyAlsXz(board, candidates)) continue
      break
    }
  }

  private applySingles(board: Board, candidates: CandidateGrid): boolean {
    const assignments = this.singleFinder.findNakedAndHiddenSingles(board, candidates)
    if (assignments.length === 0) {
      return false
    }
    for (const { row, col, digit } of assignments) {
      board[row][col] = digit
      candidates[row][col] = Array(9).fill(false)
      SudokuRules.eliminatePeerCandidates(candidates, board, row, col, digit)
    }
    return true
  }

  private applyLockedCandidates(board: Board, candidates: CandidateGrid): boolean {
    const eliminations = this.lockedCandidateFinder.findEliminations(board, candidates)
    if (eliminations.length === 0) {
      return false
    }
    for (const { row, col, digit } of eliminations) {
      candidates[row][col][digit - 1] = false
    }
    return true
  }

  private applyNakedPairs(board: Board, candidates: CandidateGrid): boolean {
    const eliminations = this.pairFinder.findNakedPairEliminations(board, candidates)
    if (eliminations.length === 0) {
      return false
    }
    for (const { row, col, digit } of eliminations) {
      candidates[row][col][digit - 1] = false
    }
    return true
  }

  private applyNakedTriples(board: Board, candidates: CandidateGrid): boolean {
    const eliminations = this.nakedSubsetFinder.findNakedTripleEliminations(board, candidates)
    if (eliminations.length === 0) {
      return false
    }
    for (const { row, col, digit } of eliminations) {
      candidates[row][col][digit - 1] = false
    }
    return true
  }

  private applyNakedQuads(board: Board, candidates: CandidateGrid): boolean {
    const eliminations = this.nakedSubsetFinder.findNakedQuadEliminations(board, candidates)
    if (eliminations.length === 0) {
      return false
    }
    for (const { row, col, digit } of eliminations) {
      candidates[row][col][digit - 1] = false
    }
    return true
  }

  private applyHiddenPairs(board: Board, candidates: CandidateGrid): boolean {
    const eliminations = this.hiddenPairFinder.findHiddenPairEliminations(board, candidates)
    if (eliminations.length === 0) {
      return false
    }
    for (const { row, col, digit } of eliminations) {
      candidates[row][col][digit - 1] = false
    }
    return true
  }

  private anyEnabledFish(board: Board, candidates: CandidateGrid, enabledFish: ReadonlySet<FishTechnique>): boolean {
    return enabledFish.size > 0 && this.fishFinder.find(board, candidates).some((fish) => enabledFish.has(fish.technique))
  }

  private applyFish(board: Board, candidates: CandidateGrid, enabledFish: ReadonlySet<FishTechnique>): boolean {
    if (enabledFish.size === 0) {
      return false
    }
    let changed = false
    for (const fish of this.fishFinder.find(board, candidates)) {
      if (!enabledFish.has(fish.technique)) {
        continue
      }
      for (const { row, col, digit } of fish.eliminations) {
        if (candidates[row][col][digit - 1]) {
          candidates[row][col][digit - 1] = false
          changed = true
        }
      }
    }
    return changed
  }

  private applyAlsXz(board: Board, candidates: CandidateGrid): boolean {
    let changed = false
    for (const als of this.alsXzFinder.find(board, candidates)) {
      for (const { row, col, digit } of als.eliminations) {
        if (candidates[row][col][digit - 1]) {
          candidates[row][col][digit - 1] = false
          changed = true
        }
      }
    }
    return changed
  }

  private applyUniqueRectangleType1(board: Board, candidates: CandidateGrid): boolean {
    let changed = false
    for (const ur of this.uniqueRectangleFinder.find(board, candidates)) {
      for (const { row, col, digit } of ur.solvedCandidates) {
        if (board[row][col] === 0) {
          board[row][col] = digit
          candidates[row][col] = Array(9).fill(false)
          SudokuRules.eliminatePeerCandidates(candidates, board, row, col, digit)
          changed = true
        }
      }
      for (const { row, col, digit } of ur.eliminatedCandidates) {
        if (board[row][col] === 0 && candidates[row][col][digit - 1]) {
          candidates[row][col][digit - 1] = false
          changed = true
        }
      }
    }
    return changed
  }

  private applyBugPlusOne(board: Board, candidates: CandidateGrid): boolean {
    const bugPlusOne = this.bugPlusOneFinder.find(board, candidates)
    if (!bugPlusOne) {
      return false
    }
    const [row, col] = bugPlusOne.cell
    board[row][col] = bugPlusOne.solvedDigit
    candidates[row][col] = Array(9).fill(false)
    SudokuRules.eliminatePeerCandidates(candidates, board, row, col, bugPlusOne.solvedDigit)
    return true
  }

  private applyBivalueOddagon(board: Board, candidates: CandidateGrid): boolean {
    let changed = false
    for (const oddagon of this.bivalueOddagonFinder.find(board, candidates)) {
      if (oddagon.solvedCell) {
        const [row, col] = oddagon.solvedCell
        if (board[row][col] === 0) {
          board[row][col] = oddagon.guardianDigit
          candidates[row][col] = Array(9).fill(false)
          SudokuRules.eliminatePeerCandidates(candidates, board, row, col, oddagon.guardianDigit)
          changed = true
        }
      }
      for (const { row, col, digit } of oddagon.eliminations) {
        if (board[row][col] === 0 && candidates[row][col][digit - 1]) {
          candidates[row][col][digit - 1] = false
          changed = true
        }
      }
    }
    return changed
  }

  private applySimpleColoring(board: Board, candidates: CandidateGrid): boolean {
    let changed = false
    for (const digit of DIGITS) {
      for (const chain of this.colorFinder.findChains(board, candidates, digit)) {
        const rule1 = this.colorFinder.findRule1(chain)
        if (rule1) {
          for (const [row, col] of rule1.solvedCells) {
            board[row][col] = digit
            candidates[row][col] = Array(9).fill(false)
            SudokuRules.eliminatePeerCandidates(candidates, board, row, col, digit)
            changed = true
          }
        }
        const rule2 = this.colorFinder.findRule2(chain, board, candidates)
        if (rule2) {
          for (const [row, col] of rule2.eliminatedCells) {
            if (candidates[row][col][digit - 1]) {
              candidates[row][col][digit - 1] = false
              changed = true
            }
          }
        }
      }
    }
    return changed
  }

  private applyShortAic(board: Board, candidates: CandidateGrid): boolean {
    const eliminations = this.shortAicFinder.findShortAicEliminations(board, candidates)
    if (eliminations.length === 0) {
      return false
    }
    for (const { row, col, digit } of eliminations) {
      candidates[row][col][digit - 1] = false
    }
    return true
  }

  private applyMedusa(board: Board, candidates: CandidateGrid): boolean {
    let changed = false
    for (const chain of this.medusaFinder.findChains(board, candidates)) {
      const mass = this.medusaFinder.findMassElimination(chain, board, candidates)
      if (mass) {
        for (const { row, col, digit } of mass.solvedCells) {
          if (board[row][col] === 0) {
            board[row][col] = digit
            candidates[row][col] = Array(9).fill(false)
            SudokuRules.eliminatePeerCandidates(candidates, board, row, col, digit)
            changed = true
          }
        }
        for (const { row, col, digit } of mass.eliminatedCandidates) {
          if (board[row][col] === 0 && candidates[row][col][digit - 1]) {
            candidates[row][col][digit - 1] = false
            changed = true
          }
        }
      }
      for (const r3 of this.medusaFinder.findRule3Eliminations(chain, board, candidates)) {
        if (candidates[r3.row][r3.col][r3.digit - 1]) {
          candidates[r3.row][r3.col][r3.digit - 1] = false
          changed = true
        }
      }
      for (const r4 of this.medusaFinder.findRule4Eliminations(chain, candidates)) {
        for (const digit of r4.eliminatedDigits) {
          if (candidates[r4.row][r4.col][digit - 1]) {
            candidates[r4.row][r4.col][digit - 1] = false
            changed = true
          }
        }
      }
      for (const r5 of this.medusaFinder.findRule5Eliminations(chain, candidates)) {
        if (candidates[r5.row][r5.col][r5.eliminatedDigit - 1]) {
          candidates[r5.row][r5.col][r5.eliminatedDigit - 1] = false
          changed = true
        }
      }
    }
    return changed
  }

  /** One round: every stuck Medusa chain Dragon Colouring can extend into
   * something actionable, all applied at once - mirrors the app's own
   * Dragon Colouring auto-solve button so "needs Dragon Colouring" means
   * the same thing here as it does there. */
  private applyOneDragonRound(board: Board, candidates: CandidateGrid, useDynamic: boolean): boolean {
    const solvedByCell = new Map<string, { row: number; col: number; digit: number }>()
    const eliminatedByCell = new Map<string, { row: number; col: number; digit: number }>()

    for (const chain of this.medusaFinder.findChains(board, candidates)) {
      const stuck =
        this.medusaFinder.findMassElimination(chain, board, candidates) === null &&
        this.medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
        this.medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
        this.medusaFinder.findRule5Eliminations(chain, candidates).length === 0
      if (!stuck) {
        continue
      }
      const result =
        this.dragonFinder.extend(chain, board, candidates) ??
        (useDynamic ? this.dragonFinder.extend(chain, board, candidates, { dynamic: true }) : null)
      if (!result) {
        continue
      }
      for (const move of result.moves) {
        for (const { row, col, digit } of move.solved) {
          solvedByCell.set(`${row},${col}`, { row, col, digit })
        }
        for (const { row, col, digit } of move.eliminated) {
          eliminatedByCell.set(`${row},${col},${digit}`, { row, col, digit })
        }
      }
    }

    if (solvedByCell.size === 0 && eliminatedByCell.size === 0) {
      return false
    }

    for (const { row, col, digit } of solvedByCell.values()) {
      board[row][col] = digit
      candidates[row][col] = Array(9).fill(false)
      SudokuRules.eliminatePeerCandidates(candidates, board, row, col, digit)
    }
    for (const { row, col, digit } of eliminatedByCell.values()) {
      if (board[row][col] === 0) {
        candidates[row][col][digit - 1] = false
      }
    }
    return true
  }

  private isFullySolved(board: Board): boolean {
    return board.every((row) => row.every((value) => value !== 0))
  }

  private generateSolvedGrid(): Board {
    const grid: Board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0))
    this.fillCell(grid, 0)
    return grid
  }

  private fillCell(grid: Board, position: number): boolean {
    if (position === BOARD_SIZE * BOARD_SIZE) {
      return true
    }
    const row = Math.floor(position / BOARD_SIZE)
    const col = position % BOARD_SIZE
    for (const value of this.shuffled(DIGITS)) {
      if (!SudokuRules.isSafe(grid, row, col, value)) {
        continue
      }
      grid[row][col] = value
      if (this.fillCell(grid, position + 1)) {
        return true
      }
      grid[row][col] = 0
    }
    return false
  }

  private allCoordinates(): CellCoordinate[] {
    const coordinates: CellCoordinate[] = []
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        coordinates.push([r, c])
      }
    }
    return coordinates
  }

  private shuffled<T>(items: T[]): T[] {
    const result = [...items]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }
}
