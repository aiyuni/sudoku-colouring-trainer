import { createEmptyBoard } from './boardUtils'
import { CLASSIC_CONSTRAINTS, boxOf, entropyAllows, ruleCellsOf, withConstraints, type Cell, type KillerCage, type SudokuConstraints } from './SudokuConstraints'
import { SudokuSolver } from './SudokuSolver'
import type { Board } from './types'

/**
 * Practice puzzles for the Variant solver: a random Jigsaw (irregular
 * regions, givens), a random Killer (cages, no givens), or both at once -
 * and a random X-Sudoku or Anti-Knight puzzle (3x3 boxes, givens, the extra
 * rule), which reuse the Jigsaw's path: a random full grid under the rules,
 * then givens taken away while the solution stays the only one.
 * Every one has exactly one solution, checked with the same brute-force
 * solver the page uses (SudokuSolver, which solves under the active
 * constraints). Nothing here promises a difficulty - unlike the Classic
 * page's Dragon generator, these are just valid puzzles to try the
 * techniques on.
 */
export interface GeneratedVariantPuzzle {
  /** The givens (0 = empty). All zeros for a Killer. */
  board: Board
  constraints: SudokuConstraints
}

export type VariantKind = 'jigsaw' | 'killer' | 'killer-jigsaw' | 'x-sudoku' | 'anti-knight' | 'entropy'

const solver = new SudokuSolver()

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

function neighboursOf(row: number, col: number): Cell[] {
  return NEIGHBOURS.map(([dr, dc]) => [row + dr, col + dc] as Cell).filter(([r, c]) => r >= 0 && r < 9 && c >= 0 && c < 9)
}

/** Whether a region's cells are still one orthogonally connected piece. */
function isConnected(regions: number[][], region: number): boolean {
  const cells: Cell[] = []
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (regions[row][col] === region) {
        cells.push([row, col])
      }
    }
  }
  if (cells.length === 0) {
    return false
  }
  const seen = new Set<number>([cells[0][0] * 9 + cells[0][1]])
  const queue: Cell[] = [cells[0]]
  while (queue.length > 0) {
    const [row, col] = queue.pop()!
    for (const [r, c] of neighboursOf(row, col)) {
      if (regions[r][c] === region && !seen.has(r * 9 + c)) {
        seen.add(r * 9 + c)
        queue.push([r, c])
      }
    }
  }
  return seen.size === cells.length
}

/** Nine connected regions of nine cells, by bending the 3x3 boxes: again and
 * again two neighbouring regions trade one border cell each, kept only when
 * both are still in one piece. More trades = wilder shapes. */
export function randomJigsawRegions(random: () => number = Math.random, trades = 40): number[][] {
  const regions = Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => Math.floor(row / 3) * 3 + Math.floor(col / 3)))
  let done = 0
  for (let attempt = 0; attempt < trades * 60 && done < trades; attempt++) {
    const row = Math.floor(random() * 9)
    const col = Math.floor(random() * 9)
    const a = regions[row][col]
    const foreign = neighboursOf(row, col).filter(([r, c]) => regions[r][c] !== a)
    if (foreign.length === 0) {
      continue
    }
    const [nr, nc] = foreign[Math.floor(random() * foreign.length)]
    const b = regions[nr][nc]
    // (row, col) goes from a to b; some cell of b touching a comes back.
    const returning: Cell[] = []
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (regions[r][c] === b && neighboursOf(r, c).some(([ar, ac]) => regions[ar][ac] === a && (ar !== row || ac !== col))) {
          returning.push([r, c])
        }
      }
    }
    if (returning.length === 0) {
      continue
    }
    const [br, bc] = returning[Math.floor(random() * returning.length)]
    regions[row][col] = b
    regions[br][bc] = a
    if (isConnected(regions, a) && isConnected(regions, b)) {
      done++
    } else {
      regions[row][col] = a
      regions[br][bc] = b
    }
  }
  return regions
}

/** A random full grid under the active constraints' regions (cages are not
 * looked at - a Killer's cages are cut out of the solution afterwards). Null
 * if the search gives up, which a freak region layout can cause. */
function randomSolution(random: () => number): Board | null {
  const grid = createEmptyBoard()
  const rowMask = new Array<number>(9).fill(0)
  const colMask = new Array<number>(9).fill(0)
  const boxMask = new Array<number>(9).fill(0)
  let steps = 0
  const fill = (): boolean => {
    if (++steps > 200_000) {
      return false
    }
    let best: Cell | null = null
    let bestOptions = 0
    let bestCount = 10
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (grid[row][col] !== 0) {
          continue
        }
        const options = 511 & ~(rowMask[row] | colMask[col] | boxMask[boxOf(row, col)])
        let count = 0
        for (let m = options; m !== 0; m &= m - 1) {
          count++
        }
        if (count < bestCount) {
          bestCount = count
          best = [row, col]
          bestOptions = options
        }
      }
    }
    if (!best) {
      return true
    }
    const [row, col] = best
    const box = boxOf(row, col)
    for (const digit of shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], random)) {
      const bit = 1 << (digit - 1)
      if ((bestOptions & bit) === 0) {
        continue
      }
      grid[row][col] = digit
      rowMask[row] |= bit
      colMask[col] |= bit
      boxMask[box] |= bit
      if (fill()) {
        return true
      }
      grid[row][col] = 0
      rowMask[row] &= ~bit
      colMask[col] &= ~bit
      boxMask[box] &= ~bit
    }
    return false
  }
  return fill() ? grid : null
}

/** A random full grid under *every* rule of the active constraints that
 * says "these two cells differ" (ruleCellsOf: rows, columns, boxes, an
 * X-Sudoku's diagonals, an Anti-Knight's knight moves) - what randomSolution
 * above does with three bit masks for the plain layouts, done from the peer
 * lists so the extra rules need no code of their own. Null when the search
 * gives up (Anti-Knight grids are rare: most random starts dead-end, and the
 * caller simply tries again). */
function randomSolutionUnderRules(random: () => number): Board | null {
  const grid = createEmptyBoard()
  // taken[cell][digit]: how many placed peers hold the digit.
  const taken = Array.from({ length: 81 }, () => new Uint8Array(10))
  let steps = 0
  const place = (row: number, col: number, digit: number, by: 1 | -1) => {
    grid[row][col] = by === 1 ? digit : 0
    for (const [r, c] of ruleCellsOf(row, col)) {
      taken[r * 9 + c][digit] += by
    }
  }
  const fill = (): boolean => {
    if (++steps > 20_000) {
      return false
    }
    let best: Cell | null = null
    let bestCount = 10
    for (let row = 0; row < 9 && bestCount > 1; row++) {
      for (let col = 0; col < 9; col++) {
        if (grid[row][col] !== 0) {
          continue
        }
        let count = 0
        for (let digit = 1; digit <= 9; digit++) {
          if (taken[row * 9 + col][digit] === 0) {
            count++
          }
        }
        if (count < bestCount) {
          bestCount = count
          best = [row, col]
        }
      }
    }
    if (!best) {
      return true
    }
    const [row, col] = best
    for (const digit of shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], random)) {
      // Entropy is not a "these two cells differ" rule, so it isn't in the
      // peer lists: the 2x2 squares over the cell are asked directly.
      if (taken[row * 9 + col][digit] !== 0 || !entropyAllows(grid, row, col, digit)) {
        continue
      }
      place(row, col, digit, 1)
      if (fill()) {
        return true
      }
      place(row, col, digit, -1)
    }
    return false
  }
  return fill() ? grid : null
}

/** Cuts a solved grid into cages: each grows from a free cell along free
 * neighbours whose digit it doesn't hold yet (a cage never repeats a digit),
 * up to a size picked mostly from 2-4. Leftover cells become one-cell cages,
 * which read as givens. */
function randomCages(solution: Board, random: () => number, hard: boolean): KillerCage[] {
  const cageOfCell = Array.from({ length: 9 }, () => new Array<number>(9).fill(-1))
  const cages: KillerCage[] = []
  // Hard: bigger cages and no deliberate one-cell ones - fewer free digits,
  // so the cages' sums have to do more of the work.
  const sizes = hard ? [2, 2, 3, 3, 3, 4, 4, 4, 5, 5] : [1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 5]
  const order = shuffled(
    Array.from({ length: 81 }, (_, i) => [Math.floor(i / 9), i % 9] as Cell),
    random,
  )
  for (const [startRow, startCol] of order) {
    if (cageOfCell[startRow][startCol] >= 0) {
      continue
    }
    const target = sizes[Math.floor(random() * sizes.length)]
    const cells: Cell[] = [[startRow, startCol]]
    const digits = new Set([solution[startRow][startCol]])
    cageOfCell[startRow][startCol] = cages.length
    while (cells.length < target) {
      const growth = cells
        .flatMap(([row, col]) => neighboursOf(row, col))
        .filter(([row, col]) => cageOfCell[row][col] < 0 && !digits.has(solution[row][col]))
      if (growth.length === 0) {
        break
      }
      const [row, col] = growth[Math.floor(random() * growth.length)]
      cells.push([row, col])
      digits.add(solution[row][col])
      cageOfCell[row][col] = cages.length
    }
    cages.push({ sum: 0, cells })
  }
  if (hard) {
    // A cell left stranded on its own joins a neighbouring cage that has
    // room and doesn't hold its digit yet.
    for (let index = 0; index < cages.length; index++) {
      const cage = cages[index]
      if (cage.cells.length !== 1) {
        continue
      }
      const [row, col] = cage.cells[0]
      const host = neighboursOf(row, col)
        .map(([r, c]) => cageOfCell[r][c])
        .find((other) => other !== index && cages[other].cells.length < 5 && !cages[other].cells.some(([r, c]) => solution[r][c] === solution[row][col]))
      if (host !== undefined) {
        cages[host].cells.push([row, col])
        cageOfCell[row][col] = host
        cage.cells.length = 0
      }
    }
  }
  return cages
    .filter((cage) => cage.cells.length > 0)
    .map((cage) => {
      const cells = [...cage.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])
      return { sum: cells.reduce((total, [row, col]) => total + solution[row][col], 0), cells }
    })
    .sort((a, b) => a.cells[0][0] - b.cells[0][0] || a.cells[0][1] - b.cells[0][1])
}

/** Cuts one cage so that `wrong` - another grid the cages allowed - no longer
 * fits: a cage where the two grids differ gives up one such cell, together
 * with a neighbour in the cage when the pair's total tells the grids apart
 * (so the cut makes a two-cell cage rather than a lone cell, which would be
 * a given). The rest of the cage keeps what is left of its sum; if taking
 * the cells out breaks it in two, each piece becomes a cage. */
function splitWrongCage(cages: KillerCage[], solution: Board, wrong: Board, random: () => number): KillerCage[] {
  const differs = ([row, col]: Cell) => solution[row][col] !== wrong[row][col]
  const candidates = cages.filter((cage) => cage.cells.length > 1 && cage.cells.some(differs))
  if (candidates.length === 0) {
    return cages
  }
  const cage = candidates[Math.floor(random() * candidates.length)]
  const cell = shuffled(cage.cells.filter(differs), random)[0]
  const inCage = (row: number, col: number) => cage.cells.some(([r, c]) => r === row && c === col)
  const partner = shuffled(neighboursOf(cell[0], cell[1]), random).find(
    ([row, col]) =>
      inCage(row, col) &&
      cage.cells.length > 2 &&
      solution[cell[0]][cell[1]] + solution[row][col] !== wrong[cell[0]][cell[1]] + wrong[row][col],
  )
  const taken: Cell[] = partner ? [cell, partner] : [cell]
  const rest = cage.cells.filter(([row, col]) => !taken.some(([r, c]) => r === row && c === col))
  // The rest, as its connected pieces.
  const pieces: Cell[][] = []
  const unvisited = new Set(rest.map(([row, col]) => row * 9 + col))
  while (unvisited.size > 0) {
    const start = unvisited.values().next().value!
    unvisited.delete(start)
    const piece: Cell[] = []
    const queue = [start]
    while (queue.length > 0) {
      const index = queue.pop()!
      const row = Math.floor(index / 9)
      const col = index % 9
      piece.push([row, col])
      for (const [r, c] of neighboursOf(row, col)) {
        if (unvisited.delete(r * 9 + c)) {
          queue.push(r * 9 + c)
        }
      }
    }
    pieces.push(piece)
  }
  const made = [taken, ...pieces].map((cells) => {
    const sorted = [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    return { sum: sorted.reduce((total, [row, col]) => total + solution[row][col], 0), cells: sorted }
  })
  return [...cages.filter((other) => other !== cage), ...made].sort((a, b) => a.cells[0][0] - b.cells[0][0] || a.cells[0][1] - b.cells[0][1])
}

/** Givens for a Jigsaw: the full solution with cells taken away in random
 * order for as long as the puzzle keeps exactly one solution, stopping at
 * `targetGivens` (a fully minimal Jigsaw is usually far harder than is
 * useful for practice). */
function digGivens(solution: Board, targetGivens: number, random: () => number): Board {
  const board = solution.map((row) => [...row])
  let givens = 81
  for (const [row, col] of shuffled(
    Array.from({ length: 81 }, (_, i) => [Math.floor(i / 9), i % 9] as Cell),
    random,
  )) {
    if (givens <= targetGivens) {
      break
    }
    const value = board[row][col]
    board[row][col] = 0
    if (solver.solve(board).status === 'solved') {
      givens--
    } else {
      board[row][col] = value
    }
  }
  return board
}

/**
 * One random puzzle of the given kind, or null if none came out within
 * `timeBudgetMs` (a Killer's random cages don't always pin down one
 * solution; another cut is then tried).
 */
export function generateVariantPuzzle(
  kind: VariantKind,
  {
    random = Math.random,
    timeBudgetMs = 8000,
    hard = false,
  }: {
    random?: () => number
    timeBudgetMs?: number
    /** Jigsaw: givens are removed until none can go (instead of stopping at
     * 30). Killer: bigger cages, almost no one-cell ones. */
    hard?: boolean
  } = {},
): GeneratedVariantPuzzle | null {
  const deadline = Date.now() + timeBudgetMs
  if (kind === 'x-sudoku' || kind === 'anti-knight' || kind === 'entropy') {
    const constraints: SudokuConstraints = {
      regions: null,
      cages: [],
      ...(kind === 'x-sudoku' ? { diagonals: true } : kind === 'anti-knight' ? { antiKnight: true } : { entropy: true }),
    }
    while (Date.now() < deadline) {
      const solution = withConstraints(constraints, () => randomSolutionUnderRules(random))
      if (solution) {
        // The extra rule does part of the givens' work, so these need fewer
        // than a Classic puzzle: 24 keeps them approachable, "harder" takes
        // away every given that can go.
        return { board: withConstraints(constraints, () => digGivens(solution, hard ? 0 : 24, random)), constraints }
      }
    }
    return null
  }
  while (Date.now() < deadline) {
    const regions = kind === 'killer' ? null : randomJigsawRegions(random)
    const layout: SudokuConstraints = regions ? { regions, cages: [] } : CLASSIC_CONSTRAINTS
    const solution = withConstraints(layout, () => randomSolution(random))
    if (!solution) {
      continue
    }
    if (kind === 'jigsaw') {
      return { board: withConstraints(layout, () => digGivens(solution, hard ? 0 : 30, random)), constraints: layout }
    }
    // Random cages don't always pin down one solution. Rather than throw
    // the cut away, each wrong solution found is ruled out by cutting a cage
    // it shares a sum with (splitWrongCage) - a few cuts and it is unique.
    let cages = randomCages(solution, random, hard)
    const empty = createEmptyBoard()
    for (let cut = 0; cut < 40 && Date.now() < deadline; cut++) {
      const constraints: SudokuConstraints = { regions, cages }
      const solutions = withConstraints(constraints, () => solver.findSolutions(empty, 2))
      const wrong = solutions.find((found) => found.some((row, r) => row.some((digit, c) => digit !== solution[r][c])))
      if (!wrong) {
        return { board: empty, constraints }
      }
      cages = splitWrongCage(cages, solution, wrong, random)
    }
  }
  return null
}
