import { cloneBoard, cloneCandidates, computeGivenMask, createEmptyCandidates } from './boardUtils'
import { SudokuColorFinder } from './SudokuColorFinder'
import { SudokuDragonFinder } from './SudokuDragonFinder'
import { SudokuHiddenPairFinder } from './SudokuHiddenPairFinder'
import { SudokuLockedCandidateFinder } from './SudokuLockedCandidateFinder'
import { SudokuMedusaFinder } from './SudokuMedusaFinder'
import { SudokuNakedSubsetFinder } from './SudokuNakedSubsetFinder'
import { SudokuPairFinder } from './SudokuPairFinder'
import { BOARD_SIZE, SudokuRules } from './SudokuRules'
import { classifyShortAic, SudokuShortAicFinder } from './SudokuShortAicFinder'
import { SudokuSingleFinder } from './SudokuSingleFinder'
import { SudokuSolver } from './SudokuSolver'
import { SudokuUniqueRectangleFinder } from './SudokuUniqueRectangleFinder'
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
}

export interface GeneratedDragonPuzzle {
  board: Board
  givens: boolean[][]
  candidates: CandidateGrid
}

export interface DragonPuzzleGenerateOptions {
  /** When true, generates a puzzle where plain Dragon Colouring (Rules 1-2
   * and Promotion alone) is *not* enough - Dynamic Dragon Colouring's
   * Extension Rule 3 (naked pairs / Unique Rectangle Type 1 propagated
   * through a side's assumption) is what's actually needed. */
  requireDynamic?: boolean
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
  private readonly uniqueRectangleFinder = new SudokuUniqueRectangleFinder()
  private readonly colorFinder = new SudokuColorFinder()
  private readonly shortAicFinder = new SudokuShortAicFinder()
  private readonly medusaFinder = new SudokuMedusaFinder()
  private readonly dragonFinder = new SudokuDragonFinder()

  /** Returns null if no qualifying puzzle turned up within the time budget
   * - rare, but this is a much narrower target than an ordinary generated
   * puzzle (a Dynamic-Dragon-only one especially so).
   *
   * async purely to yield periodically (see YIELD_INTERVAL_MS/
   * yieldToEventLoop) - the search itself is still ordinary synchronous
   * work between those yield points, not offloaded to a worker. */
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

  private reduceUntilDragonNeeded(solved: Board, options: DragonPuzzleGenerateOptions): GeneratedDragonPuzzle | null {
    const puzzle = cloneBoard(solved)
    const requireDynamic = options.requireDynamic ?? false
    const disregardKinds: DisregardedAicKinds = {
      singleDigit: options.disregardSingleDigitAic ?? true,
      general: options.disregardAic ?? true,
    }

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

      const checkpoint = this.buildRobustCheckpoint(puzzle, requireDynamic, disregardKinds)
      if (!checkpoint) {
        // Still too easy (something short of the target technique still
        // works once candidates are freshly autofilled), or a dead end
        // where nothing at all applies - either way, keep reducing.
        continue
      }

      if (this.isSolvableFromCheckpoint(checkpoint.board, checkpoint.candidates, requireDynamic)) {
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
    }

    return null
  }

  /** Solves as far as naked/hidden singles alone can go, recomputing
   * candidates fresh from board legality before every search - the only
   * technique whose progress is inherently robust to a legality-only
   * reset, since a single's own applicability never depends on anything
   * beyond which digits are already placed on the board. */
  private solveWithSinglesOnly(clueBoard: Board): { board: Board; candidates: CandidateGrid } {
    const board = cloneBoard(clueBoard)
    let candidates = createEmptyCandidates()
    for (;;) {
      candidates = createEmptyCandidates()
      this.autofillCandidates(board, candidates)
      const assignments = this.singleFinder.findNakedAndHiddenSingles(board, candidates)
      if (assignments.length === 0) {
        break
      }
      for (const { row, col, digit } of assignments) {
        board[row][col] = digit
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
    requireDynamic: boolean,
    disregardKinds: DisregardedAicKinds,
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
    if (this.uniqueRectangleFinder.findType1Instances(board, candidates).length > 0) {
      return null
    }
    if (this.anySimpleColoringApplies(board, candidates)) {
      return null
    }
    if (this.anyBlockingShortAic(board, candidates, disregardKinds)) {
      return null
    }

    const chains = this.medusaFinder.findChains(board, candidates)
    for (const chain of chains) {
      const stuck =
        this.medusaFinder.findMassElimination(chain, board, candidates) === null &&
        this.medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
        this.medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
        this.medusaFinder.findRule5Eliminations(chain, candidates).length === 0
      if (!stuck) {
        return null
      }
    }

    if (requireDynamic) {
      // At least one stuck chain must specifically need the dynamic
      // extension - plain Dragon Colouring fails for that chain, but the
      // dynamic one (Extension Rule 3) succeeds. Other chains elsewhere on
      // the same board are free to be resolvable some easier way; only
      // this one move, right at the start, has to require the dynamic
      // extension.
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

  /** True when a short AIC of a kind the caller does *not* disregard has
   * eliminations. Uses the same findShortAics + classifyShortAic split the
   * app's Techniques panel does, so "a single-digit AIC exists" means the
   * same thing here as what the player would see listed. Skips the (fairly
   * costly) chain search entirely when both kinds are disregarded, which
   * is the default. */
  private anyBlockingShortAic(board: Board, candidates: CandidateGrid, disregarded: DisregardedAicKinds): boolean {
    if (disregarded.singleDigit && disregarded.general) {
      return false
    }
    return this.shortAicFinder.findShortAics(board, candidates).some((aic) => {
      const singleDigit = classifyShortAic(aic) === 'single-digit'
      return singleDigit ? !disregarded.singleDigit : !disregarded.general
    })
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
  ): boolean {
    const board = cloneBoard(checkpointBoard)
    const candidates = cloneCandidates(checkpointCandidates)
    for (;;) {
      this.grindEasyTechniques(board, candidates)
      if (this.isFullySolved(board)) {
        return true
      }
      if (!this.applyOneDragonRound(board, candidates, useDynamic)) {
        return false
      }
    }
  }

  private autofillCandidates(board: Board, candidates: CandidateGrid) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === 0) {
          candidates[r][c] = DIGITS.map((d) => SudokuRules.isSafe(board, r, c, d))
        }
      }
    }
  }

  private grindEasyTechniques(board: Board, candidates: CandidateGrid) {
    for (;;) {
      if (this.applySingles(board, candidates)) continue
      if (this.applyLockedCandidates(board, candidates)) continue
      if (this.applyNakedPairs(board, candidates)) continue
      if (this.applyNakedTriples(board, candidates)) continue
      if (this.applyNakedQuads(board, candidates)) continue
      if (this.applyHiddenPairs(board, candidates)) continue
      if (this.applyUniqueRectangleType1(board, candidates)) continue
      if (this.applySimpleColoring(board, candidates)) continue
      if (this.applyShortAic(board, candidates)) continue
      if (this.applyMedusa(board, candidates)) continue
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

  private applyUniqueRectangleType1(board: Board, candidates: CandidateGrid): boolean {
    let changed = false
    for (const ur of this.uniqueRectangleFinder.findType1Instances(board, candidates)) {
      const [row, col] = ur.extraCell
      if (ur.solvedDigit !== null) {
        board[row][col] = ur.solvedDigit
        candidates[row][col] = Array(9).fill(false)
        SudokuRules.eliminatePeerCandidates(candidates, board, row, col, ur.solvedDigit)
        changed = true
      }
      for (const digit of ur.eliminatedDigits) {
        if (candidates[row][col][digit - 1]) {
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
