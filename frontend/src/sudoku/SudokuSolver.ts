import { SolveResponse } from './SolveResponse'
import {
  CLASSIC_CONSTRAINTS,
  ENTROPY_GROUP_MASKS,
  ENTROPY_SQUARES,
  activeConstraints,
  boxOf,
  cageFillings,
  entropyGroupsOfMask,
  entropySquareSupport,
  ruleCellsOf,
  sudokuUnits,
} from './SudokuConstraints'
import { BOARD_SIZE as SIZE, SudokuRules } from './SudokuRules'
import type { Board } from './types'

type CopyResult = { ok: true; grid: Board } | { ok: false; error: string }

interface SolutionSearchState {
  count: number
  solution: Board | null
  /** Set by findSolutions only: every solution found, not just the first. */
  all?: Board[]
}

/** (row, col, digit-bitmask of still-available digits) for the cell the
 * MRV heuristic picked next - the mask is returned alongside the
 * coordinates so the recursion doesn't have to recompute it a second time
 * just to know which digits to try. */
type BestCell = [row: number, col: number, available: number]

const FULL_MASK = (1 << SIZE) - 1

/** Number of set bits in every possible 9-bit mask, indexed by the mask
 * itself - turns "how many digits are still available here" into a single
 * array lookup instead of testing each of the 9 bits in a loop. */
const POPCOUNT9: number[] = Array.from({ length: FULL_MASK + 1 }, (_, mask) => {
  let count = 0
  for (let m = mask; m !== 0; m &= m - 1) {
    count++
  }
  return count
})

/** The fixed shape of a Killer puzzle, as the cage search wants it: cells by
 * index (row * 9 + col), each one's peers, the 27 units, and the cages. Read
 * once per solve from the active constraints. */
interface CageLayout {
  /** Every other cell that can't hold the same digit (row, column, box, cage). */
  peers: number[][]
  units: number[][]
  /** Every group of cells with different digits and a known total: the
   * puzzle's cages, and each unit's "rest" (see buildCageLayout). */
  sumCells: number[][]
  sums: number[]
  /** For each cell, the sum groups it belongs to. */
  sumsOfCell: number[][]
  /** On an Entropy puzzle the 64 2x2 squares, four cell indexes each; else
   * empty. */
  entropySquares: number[][]
}

/**
 * Backtracking Sudoku solver with minimum-remaining-values cell selection.
 * Counts up to two solutions so callers can tell a unique solution apart
 * from an unsolvable or ambiguous puzzle.
 *
 * It solves under the active constraints (SudokuConstraints.ts), so the same
 * class is the Variant solver's brute force. A Jigsaw only changes which
 * cells share a "box" mask, and runs the search below unchanged. Killer
 * cages get a search of their own (`countSolutionsWithCages`): a Killer has
 * no givens, and plain backtracking - even with each cage's sum checked as
 * digits go in - took 40 seconds on a sparse one, on a page that solves the
 * grid again on every edit.
 *
 * The recursive search tracks which digits are already used in each row/
 * column/box as bitmasks (updated incrementally as a digit is placed or
 * backtracked out), rather than rescanning the 27 peer cells with
 * `SudokuRules.isSafe` on every candidate digit at every node - this is
 * the dominant cost during puzzle generation, where `solve` runs tens of
 * thousands of times to check uniqueness after each candidate clue
 * removal. The search order (MRV cell choice, ties broken by row-major
 * position, digits tried 1-9) is unchanged, so results are identical to
 * the previous cell-rescanning version - only the per-node bookkeeping is
 * cheaper. `SudokuRules.isSafe` itself is untouched and still used by
 * every other technique finder.
 */
export class SudokuSolver {
  solve(board: Board | null | undefined): SolveResponse {
    const copy = this.tryCopyBoard(board)
    if (!copy.ok) {
      return SolveResponse.invalid(copy.error)
    }

    const grid = copy.grid
    if (!this.isConsistent(grid)) {
      return SolveResponse.invalid('The given digits conflict with Sudoku rules.')
    }

    // Stop as soon as a second solution is found; we only need to know
    // whether the solution is unique, not enumerate every solution.
    const search: SolutionSearchState = { count: 0, solution: null }
    this.search(grid, 2, search)

    switch (search.count) {
      case 0:
        return SolveResponse.unsolvable()
      case 1:
        return SolveResponse.ok(search.solution!)
      default:
        return SolveResponse.multiple()
    }
  }

  /** Up to `limit` solutions of a board whose digits don't already break a
   * rule (none if they do). The Variant puzzle generator uses the second
   * solution of an ambiguous Killer to see which cage to cut. */
  findSolutions(board: Board, limit: number): Board[] {
    const copy = this.tryCopyBoard(board)
    if (!copy.ok || !this.isConsistent(copy.grid)) {
      return []
    }
    const search: SolutionSearchState = { count: 0, solution: null, all: [] }
    this.search(copy.grid, limit, search)
    return search.all!
  }

  private search(grid: Board, limit: number, search: SolutionSearchState): void {
    // Any variant goes to the propagating search: it is what cages need, and a
    // sparse Jigsaw (15-17 givens) took the plain search below seconds too.
    // A Classic grid keeps the plain search, exactly as it always was.
    if (activeConstraints() !== CLASSIC_CONSTRAINTS) {
      this.countSolutionsWithCages(grid, limit, search)
    } else {
      // boxIndex[row][col] - precomputed so the hot recursive path never
      // computes it (the 3x3 box, or a Jigsaw's region).
      const boxIndex = Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) => boxOf(r, c)))
      const { rowMask, colMask, boxMask } = this.buildMasks(grid, boxIndex)
      this.countSolutions(grid, rowMask, colMask, boxMask, boxIndex, limit, search)
    }
  }

  private tryCopyBoard(board: Board | null | undefined): CopyResult {
    if (!board || board.length !== SIZE || board.some((row) => row.length !== SIZE)) {
      return { ok: false, error: 'Board must be a 9x9 grid.' }
    }

    const grid: Board = []
    for (let r = 0; r < SIZE; r++) {
      const row: number[] = []
      for (let c = 0; c < SIZE; c++) {
        const value = board[r][c]
        if (!Number.isInteger(value) || value < 0 || value > 9) {
          return { ok: false, error: 'Each cell must be 0 (empty) or 1-9.' }
        }
        row.push(value)
      }
      grid.push(row)
    }

    return { ok: true, grid }
  }

  private isConsistent(grid: Board): boolean {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const value = grid[r][c]
        if (value === 0) {
          continue
        }

        grid[r][c] = 0
        const safe = SudokuRules.isSafe(grid, r, c, value)
        grid[r][c] = value
        if (!safe) {
          return false
        }
      }
    }

    return true
  }

  /** rowMask[r]/colMask[c]/boxMask[b] - bit (digit-1) set means that digit
   * is already placed somewhere in that row/column/box (3x3 box, or Jigsaw
   * region). Built once from the (already-validated) starting grid;
   * `countSolutions` keeps them in sync as it places and backtracks digits. */
  private buildMasks(grid: Board, boxIndex: number[][]): { rowMask: number[]; colMask: number[]; boxMask: number[] } {
    const rowMask = new Array<number>(SIZE).fill(0)
    const colMask = new Array<number>(SIZE).fill(0)
    const boxMask = new Array<number>(SIZE).fill(0)

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const value = grid[r][c]
        if (value === 0) {
          continue
        }
        const bit = 1 << (value - 1)
        rowMask[r] |= bit
        colMask[c] |= bit
        boxMask[boxIndex[r][c]] |= bit
      }
    }

    return { rowMask, colMask, boxMask }
  }

  private countSolutions(
    grid: Board,
    rowMask: number[],
    colMask: number[],
    boxMask: number[],
    boxIndex: number[][],
    limit: number,
    search: SolutionSearchState,
  ): void {
    if (search.count >= limit) {
      return
    }

    const empty = this.findBestEmptyCell(grid, rowMask, colMask, boxMask, boxIndex)
    if (!empty) {
      search.count++
      search.solution ??= this.copyGrid(grid)
      search.all?.push(this.copyGrid(grid))
      return
    }

    const [row, col, available] = empty
    const box = boxIndex[row][col]
    for (let value = 1; value <= SIZE; value++) {
      if (search.count >= limit) {
        return
      }
      const bit = 1 << (value - 1)
      if ((available & bit) === 0) {
        continue
      }

      grid[row][col] = value
      rowMask[row] |= bit
      colMask[col] |= bit
      boxMask[box] |= bit

      this.countSolutions(grid, rowMask, colMask, boxMask, boxIndex, limit, search)

      grid[row][col] = 0
      rowMask[row] &= ~bit
      colMask[col] &= ~bit
      boxMask[box] &= ~bit
    }
  }

  private findBestEmptyCell(grid: Board, rowMask: number[], colMask: number[], boxMask: number[], boxIndex: number[][]): BestCell | null {
    let best: BestCell | null = null
    let bestCandidateCount = SIZE + 1

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] !== 0) {
          continue
        }

        const available = FULL_MASK & ~(rowMask[r] | colMask[c] | boxMask[boxIndex[r][c]])
        const candidateCount = POPCOUNT9[available]

        if (candidateCount < bestCandidateCount) {
          bestCandidateCount = candidateCount
          best = [r, c, available]
          if (candidateCount === 0) {
            return best
          }
        }
      }
    }

    return best
  }

  private copyGrid(grid: Board): Board {
    return grid.map((row) => [...row])
  }

  // ---- Killer cages ------------------------------------------------------

  /**
   * The search for a puzzle with Killer cages. Still brute force - it tries
   * digits and backs out - but each try is followed by cheap, exhaustive
   * bookkeeping of what the rules now forbid (`reduce`), on a set of possible
   * digits kept per cell, so a wrong try dies within a few cells instead of
   * dozens. That is what a cage needs: its sum says nothing while its cells
   * are simply "empty", and a great deal once each cell is known to be, say,
   * one of {1,2,4}. No human technique is involved or implied; nothing here
   * explains anything.
   */
  private countSolutionsWithCages(grid: Board, limit: number, search: SolutionSearchState): void {
    const layout = this.buildCageLayout()
    const domains = new Uint16Array(SIZE * SIZE).fill(FULL_MASK)
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] !== 0) {
          domains[r * SIZE + c] = 1 << (grid[r][c] - 1)
        }
      }
    }
    this.searchCages(domains, layout, limit, search)
  }

  private buildCageLayout(): CageLayout {
    const cages = activeConstraints().cages
    const units = sudokuUnits().map((unit) => unit.map(([r, c]) => r * SIZE + c))
    const sumCells = cages.map((cage) => cage.cells.map(([r, c]) => r * SIZE + c))
    const sums = cages.map((cage) => cage.sum)
    // A unit holds 1-9, so 45: take away the cages lying wholly inside it and
    // the unit's other cells have a total of their own - and, being in one
    // unit, different digits. So they are one more cage as far as the search
    // goes, tying each cage that sticks out of a unit to that unit's sum.
    // Without them the cages only meet through single cells, and a sparse
    // Killer (few, large cages) took seconds.
    for (const unit of units) {
      const inUnit = new Set(unit)
      let insideTotal = 0
      const inside = new Set<number>()
      cages.forEach((cage, index) => {
        if (sumCells[index].every((cell) => inUnit.has(cell))) {
          insideTotal += cage.sum
          sumCells[index].forEach((cell) => inside.add(cell))
        }
      })
      const rest = unit.filter((cell) => !inside.has(cell))
      if (rest.length > 0 && rest.length < SIZE) {
        sumCells.push(rest)
        sums.push(45 - insideTotal)
      }
    }
    const sumsOfCell: number[][] = Array.from({ length: SIZE * SIZE }, () => [])
    sumCells.forEach((cells, index) => cells.forEach((cell) => sumsOfCell[cell].push(index)))
    const peers: number[][] = []
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        peers.push(
          ruleCellsOf(r, c)
            .filter(([pr, pc]) => pr !== r || pc !== c)
            .map(([pr, pc]) => pr * SIZE + pc),
        )
      }
    }
    const entropySquares = activeConstraints().entropy ? ENTROPY_SQUARES.map((square) => square.map(([r, c]) => r * SIZE + c)) : []
    return { peers, units, sumCells, sums, sumsOfCell, entropySquares }
  }

  /** Narrows every cell's possible digits to what the rules still allow,
   * until nothing more follows: a settled cell's digit leaves its peers; a
   * cage keeps only digits that are part of some way of filling it
   * (cageFillings - exact, not just a bound on the sum); a digit with one
   * place left in a row, column or box goes there. False on a contradiction
   * (a cell or a cage with nothing left, a unit with no place for a digit). */
  private reduce(domains: Uint16Array, layout: CageLayout): boolean {
    const settled = new Uint8Array(SIZE * SIZE)
    const cageDirty = new Uint8Array(layout.sumCells.length).fill(1)
    const marks: number[] = []
    let changed = true
    while (changed) {
      changed = false
      for (let cell = 0; cell < SIZE * SIZE; cell++) {
        const domain = domains[cell]
        if (domain === 0) {
          return false
        }
        if (settled[cell] || POPCOUNT9[domain] !== 1) {
          continue
        }
        settled[cell] = 1
        for (const peer of layout.peers[cell]) {
          if (domains[peer] & domain) {
            domains[peer] &= ~domain
            if (domains[peer] === 0) {
              return false
            }
            for (const group of layout.sumsOfCell[peer]) {
              cageDirty[group] = 1
            }
            changed = true
          }
        }
      }
      for (let cage = 0; cage < layout.sumCells.length; cage++) {
        if (!cageDirty[cage]) {
          continue
        }
        cageDirty[cage] = 0
        const cells = layout.sumCells[cage]
        marks.length = 0
        for (const cell of cells) {
          marks.push(domains[cell])
        }
        const fillings = cageFillings(marks, layout.sums[cage])
        if (!fillings) {
          return false
        }
        for (let i = 0; i < cells.length; i++) {
          if (fillings.supported[i] !== domains[cells[i]]) {
            domains[cells[i]] = fillings.supported[i]
            // Its other sum groups (a cage and a unit's rest overlap).
            for (const group of layout.sumsOfCell[cells[i]]) {
              if (group !== cage) {
                cageDirty[group] = 1
              }
            }
            changed = true
          }
        }
      }
      // Entropy: each 2x2 square keeps, per cell, only the groups (low /
      // middle / high) that cell holds in some way of giving the square all
      // three. A fully settled square that lacks a group has no such way, so
      // this is also what rejects a filled grid breaking the rule.
      for (const square of layout.entropySquares) {
        const g0 = entropyGroupsOfMask(domains[square[0]])
        const g1 = entropyGroupsOfMask(domains[square[1]])
        const g2 = entropyGroupsOfMask(domains[square[2]])
        const g3 = entropyGroupsOfMask(domains[square[3]])
        const supported = entropySquareSupport(g0, g1, g2, g3)
        if (supported < 0) {
          return false
        }
        if (supported === (g0 | (g1 << 3) | (g2 << 6) | (g3 << 9))) {
          continue
        }
        for (let i = 0; i < 4; i++) {
          const groups = (supported >> (3 * i)) & 7
          const keep = (groups & 1 ? ENTROPY_GROUP_MASKS[0] : 0) | (groups & 2 ? ENTROPY_GROUP_MASKS[1] : 0) | (groups & 4 ? ENTROPY_GROUP_MASKS[2] : 0)
          const cell = square[i]
          if (domains[cell] & ~keep) {
            domains[cell] &= keep
            for (const group of layout.sumsOfCell[cell]) {
              cageDirty[group] = 1
            }
            changed = true
          }
        }
      }
      for (const unit of layout.units) {
        for (let bit = 1; bit <= FULL_MASK; bit <<= 1) {
          let place = -1
          let places = 0
          for (const cell of unit) {
            if (domains[cell] & bit) {
              place = cell
              places++
            }
          }
          if (places === 0) {
            return false
          }
          if (places === 1 && domains[place] !== bit) {
            domains[place] = bit
            for (const group of layout.sumsOfCell[place]) {
              cageDirty[group] = 1
            }
            changed = true
          }
        }
      }
    }
    return true
  }

  private searchCages(domains: Uint16Array, layout: CageLayout, limit: number, search: SolutionSearchState): void {
    if (search.count >= limit || !this.reduce(domains, layout)) {
      return
    }
    // The cell with the fewest digits left, first in reading order on a tie.
    let best = -1
    let bestCount = SIZE + 1
    for (let cell = 0; cell < SIZE * SIZE; cell++) {
      const count = POPCOUNT9[domains[cell]]
      if (count > 1 && count < bestCount) {
        best = cell
        bestCount = count
      }
    }
    if (best < 0) {
      // Every cell settled, and reduce() found nothing wrong: a solution.
      search.count++
      const solution = Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) => 32 - Math.clz32(domains[r * SIZE + c])))
      search.solution ??= solution
      search.all?.push(solution)
      return
    }
    for (let bit = 1; bit <= FULL_MASK; bit <<= 1) {
      if (search.count >= limit) {
        return
      }
      if (domains[best] & bit) {
        const next = domains.slice()
        next[best] = bit
        this.searchCages(next, layout, limit, search)
      }
    }
  }
}
