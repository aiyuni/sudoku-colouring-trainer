import { cloneBoard, cloneCandidates, computeGivenMask, createEmptyCandidates } from './boardUtils'
import { SudokuColorFinder } from './SudokuColorFinder'
import { SudokuDragonFinder } from './SudokuDragonFinder'
import { SudokuLockedCandidateFinder } from './SudokuLockedCandidateFinder'
import { SudokuMedusaFinder } from './SudokuMedusaFinder'
import { SudokuNakedSubsetFinder } from './SudokuNakedSubsetFinder'
import { SudokuPairFinder } from './SudokuPairFinder'
import { BOARD_SIZE, SudokuRules } from './SudokuRules'
import { SudokuSingleFinder } from './SudokuSingleFinder'
import { SudokuSolver } from './SudokuSolver'
import { SudokuUniqueRectangleFinder } from './SudokuUniqueRectangleFinder'
import type { Board, CandidateGrid } from './types'

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const MAX_GRID_ATTEMPTS = 600

type CellCoordinate = [row: number, col: number]

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
}

/**
 * Generates a puzzle state where, the moment it's loaded and candidates are
 * freshly autofilled, Dragon Colouring is the only technique this app
 * implements that can make progress - naked/hidden singles, naked pairs,
 * Unique Rectangle Type 1, Simple Colouring, and 3D Medusa's own rules all
 * come up empty.
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
  private readonly uniqueRectangleFinder = new SudokuUniqueRectangleFinder()
  private readonly colorFinder = new SudokuColorFinder()
  private readonly medusaFinder = new SudokuMedusaFinder()
  private readonly dragonFinder = new SudokuDragonFinder()

  /** Returns null if no qualifying puzzle turned up within the attempt
   * budget - rare, but this is a much narrower target than an ordinary
   * generated puzzle. */
  generate(options: DragonPuzzleGenerateOptions = {}): GeneratedDragonPuzzle | null {
    for (let attempt = 0; attempt < MAX_GRID_ATTEMPTS; attempt++) {
      const result = this.reduceUntilDragonNeeded(this.generateSolvedGrid(), options)
      if (result) {
        return result
      }
    }
    return null
  }

  private reduceUntilDragonNeeded(solved: Board, options: DragonPuzzleGenerateOptions): GeneratedDragonPuzzle | null {
    const puzzle = cloneBoard(solved)
    const requireDynamic = options.requireDynamic ?? false

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

      const checkpoint = this.buildRobustCheckpoint(puzzle, requireDynamic)
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
        return { board: checkpoint.board, givens: computeGivenMask(puzzle), candidates: checkpoint.candidates }
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
    if (this.uniqueRectangleFinder.findType1Instances(board, candidates).length > 0) {
      return null
    }
    if (this.anySimpleColoringApplies(board, candidates)) {
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
      if (this.applyUniqueRectangleType1(board, candidates)) continue
      if (this.applySimpleColoring(board, candidates)) continue
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
