/**
 * The constraint model every finder, the rules and the brute-force solver
 * read: which nine cells make up each "box" (the 3x3 boxes of a Classic
 * Sudoku, or the irregular regions of a Jigsaw), and which Killer cages lie
 * over the grid. A variant is the Classic rules plus these, not a separate
 * solving system - so the Classic techniques run unchanged on a variant
 * wherever their logic still holds (see variantApplicability.ts for which
 * do, and why).
 *
 * One set of constraints is *active* at a time, module-wide. The Classic app
 * never changes it (it stays CLASSIC_CONSTRAINTS, and every table below is
 * the same arithmetic the finders used to do inline); the Variant page sets
 * it to the puzzle on the grid (App's render, and the solve-path worker's
 * request). A parameter threaded through every finder call would say the
 * same thing far more noisily: the finders are called from hundreds of
 * sites, the hottest of them inside Dynamic Dragon's simulation.
 *
 * What each variant adds, rule-wise - and how much of the Classic machinery
 * it touches (the less, the better; nothing below is a separate solver):
 *  - Jigsaw: other boxes. Same 27 units, different cells in nine of them.
 *  - X-Sudoku (`diagonals`): two more *units* - each long diagonal holds
 *    1-9 once - so `sudokuUnits()` has 29 entries, and everything that walks
 *    the units (singles, subsets, the strong links of colouring and chains)
 *    gets the diagonals for free. The finders' own "do these two cells see
 *    each other" tests stay row/column/box: sound, they only miss the
 *    diagonal's weak links (SudokuVariantLockedFinder covers the commonest
 *    use of those).
 *  - Anti-Knight (`antiKnight`): no new unit at all, only more cells that
 *    can't hold the same digit - the up-to-eight cells a chess knight's move
 *    away. They are peers when a digit is placed and in the solver; the
 *    Classic finders don't use them (sound again).
 *  - Entropy (`entropy`): no unit and no "can't repeat" pair either, but a
 *    rule on every 2x2 square of cells: it must hold a low (1-3), a middle
 *    (4-6) and a high (7-9) digit. The helpers for it are at the end of this
 *    file; SudokuEntropyFinder is its technique. The Classic finders know
 *    nothing of it (sound: they only miss what the squares would add).
 *  - Killer: see below.
 *
 * What a cage adds, rule-wise: its digits sum to `sum`, and no digit repeats
 * in it - so cage-mates are peers when a digit is placed
 * (SudokuRules.eliminatePeerCandidates) and in the solver. The Classic
 * finders' own "sees" stays row/column/box: sound in a Killer (they just
 * miss the cage's extra weak links), and the cage logic itself is the Killer
 * finders' job (variant/SudokuKillerCageFinder.ts, SudokuKillerRule45Finder.ts).
 */

export type Cell = readonly [row: number, col: number]

const SIZE = 9
const BOX = 3

export interface KillerCage {
  /** What the cage's digits add up to. */
  sum: number
  /** Its cells, in reading order. No digit repeats among them. */
  cells: Cell[]
}

export interface SudokuConstraints {
  /** regions[row][col] = 0..8, the Jigsaw region the cell belongs to (nine
   * regions of nine cells); null = the standard 3x3 boxes. */
  regions: number[][] | null
  cages: readonly KillerCage[]
  /** X-Sudoku: each of the two long diagonals also holds 1-9 once. */
  diagonals?: boolean
  /** Anti-Knight: two cells a chess knight's move apart can't hold the same
   * digit. */
  antiKnight?: boolean
  /** Entropy Sudoku: every 2x2 square of cells (all 64, overlapping, across
   * box borders) holds at least one low (1-3), one middle (4-6) and one high
   * (7-9) digit. */
  entropy?: boolean
}

export const CLASSIC_CONSTRAINTS: SudokuConstraints = { regions: null, cages: [] }

/** Constraints with nothing a Classic Sudoku doesn't have are *the* Classic
 * constraints: the one shared object, which is what "is this a Classic
 * grid?" is tested by (`=== CLASSIC_CONSTRAINTS`) all over the app. Every
 * place that builds constraints from parts goes through this. */
export function normalizeConstraints(constraints: SudokuConstraints): SudokuConstraints {
  if (constraints.regions === null && constraints.cages.length === 0 && !constraints.diagonals && !constraints.antiKnight && !constraints.entropy) {
    return CLASSIC_CONSTRAINTS
  }
  // Flags that are off are left out, so two descriptions of one puzzle
  // serialize (and compare) the same.
  return {
    regions: constraints.regions,
    cages: constraints.cages,
    ...(constraints.diagonals ? { diagonals: true } : {}),
    ...(constraints.antiKnight ? { antiKnight: true } : {}),
    ...(constraints.entropy ? { entropy: true } : {}),
  }
}

/** The eight knight's moves. */
const KNIGHT_MOVES: ReadonlyArray<readonly [number, number]> = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
]

interface ConstraintTables {
  constraints: SudokuConstraints
  standardLayout: boolean
  /** boxIndex[row * 9 + col] = the box/region of the cell. */
  boxIndex: number[]
  /** The nine cells of each box/region, in reading order. */
  boxes: Cell[][]
  /** Rows, then columns, then boxes/regions - 27 units of nine cells - then,
   * on an X-Sudoku, the two diagonals (\\ first, then /). */
  units: Cell[][]
  /** diagonalMask[row * 9 + col]: bit 1 = on the \\ diagonal, bit 2 = on the /
   * diagonal - only while the diagonals are units (X-Sudoku), else 0. */
  diagonalMask: number[]
  /** knightCells[row * 9 + col]: the cells a knight's move away - only on an
   * Anti-Knight puzzle, else empty. */
  knightCells: Cell[][]
  /** cageIndex[row * 9 + col] = index into constraints.cages, -1 for none. */
  cageIndex: number[]
  /** For each cell: its row, its column and its box (itself included, once),
   * then any cage-mates not already among them - every cell that can't hold
   * the same digit. */
  ruleCells: Cell[][]
  /** The same without the cell itself and without cage-mates: the cells it
   * "sees" in the Classic sense (20 on a standard grid). */
  housePeers: Cell[][]
}

function buildTables(constraints: SudokuConstraints): ConstraintTables {
  const boxIndex: number[] = []
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      boxIndex.push(constraints.regions ? constraints.regions[row][col] : Math.floor(row / BOX) * BOX + Math.floor(col / BOX))
    }
  }
  const boxes: Cell[][] = Array.from({ length: SIZE }, () => [])
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      boxes[boxIndex[row * SIZE + col]].push([row, col])
    }
  }

  const units: Cell[][] = []
  for (let row = 0; row < SIZE; row++) {
    units.push(Array.from({ length: SIZE }, (_, col) => [row, col] as Cell))
  }
  for (let col = 0; col < SIZE; col++) {
    units.push(Array.from({ length: SIZE }, (_, row) => [row, col] as Cell))
  }
  units.push(...boxes)
  const diagonalMask = new Array<number>(SIZE * SIZE).fill(0)
  if (constraints.diagonals) {
    units.push(Array.from({ length: SIZE }, (_, i) => [i, i] as Cell))
    units.push(Array.from({ length: SIZE }, (_, i) => [i, SIZE - 1 - i] as Cell))
    for (let i = 0; i < SIZE; i++) {
      diagonalMask[i * SIZE + i] |= 1
      diagonalMask[i * SIZE + (SIZE - 1 - i)] |= 2
    }
  }
  const knightCells: Cell[][] = []
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      knightCells.push(
        constraints.antiKnight
          ? KNIGHT_MOVES.map(([dr, dc]) => [row + dr, col + dc] as Cell).filter(([r, c]) => r >= 0 && r < SIZE && c >= 0 && c < SIZE)
          : [],
      )
    }
  }

  const cageIndex = new Array<number>(SIZE * SIZE).fill(-1)
  constraints.cages.forEach((cage, index) => {
    for (const [row, col] of cage.cells) {
      cageIndex[row * SIZE + col] = index
    }
  })

  const ruleCells: Cell[][] = []
  const housePeers: Cell[][] = []
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const seen = new Set<number>()
      const cells: Cell[] = []
      const add = ([r, c]: Cell) => {
        if (!seen.has(r * SIZE + c)) {
          seen.add(r * SIZE + c)
          cells.push([r, c])
        }
      }
      units[row].forEach(add)
      units[SIZE + col].forEach(add)
      boxes[boxIndex[row * SIZE + col]].forEach(add)
      // The diagonals it lies on are units of it too (X-Sudoku).
      if (diagonalMask[row * SIZE + col] & 1) units[3 * SIZE].forEach(add)
      if (diagonalMask[row * SIZE + col] & 2) units[3 * SIZE + 1].forEach(add)
      housePeers.push(cells.filter(([r, c]) => r !== row || c !== col))
      const cage = cageIndex[row * SIZE + col]
      if (cage >= 0) {
        constraints.cages[cage].cells.forEach(add)
      }
      knightCells[row * SIZE + col].forEach(add)
      ruleCells.push(cells)
    }
  }

  return {
    constraints,
    standardLayout: constraints.regions === null,
    boxIndex,
    boxes,
    units,
    diagonalMask,
    knightCells,
    cageIndex,
    ruleCells,
    housePeers,
  }
}

let tables = buildTables(CLASSIC_CONSTRAINTS)
let version = 0
const changeListeners: Array<() => void> = []

export function activeConstraints(): SudokuConstraints {
  return tables.constraints
}

/** Makes `constraints` the ones every finder reads (null = Classic). The same
 * object again is a no-op, so this is cheap to call before every use; a
 * different one rebuilds the tables and tells every cache keyed on the grid
 * alone (onConstraintsChange) that it is stale. */
export function setActiveConstraints(constraints: SudokuConstraints | null): void {
  const next = constraints ?? CLASSIC_CONSTRAINTS
  if (next === tables.constraints) {
    return
  }
  tables = buildTables(next)
  version++
  for (const listener of changeListeners) {
    listener()
  }
}

/** Runs `work` with `constraints` active, then puts the previous ones back -
 * for work on a grid that isn't the one on screen (the Techniques list reads
 * a grid one painted frame behind the live one). */
export function withConstraints<T>(constraints: SudokuConstraints | null, work: () => T): T {
  const previous = tables.constraints
  setActiveConstraints(constraints)
  try {
    return work()
  } finally {
    setActiveConstraints(previous)
  }
}

/** Goes up every time the active constraints change - for a cache that would
 * rather compare a number than subscribe. */
export function constraintsVersion(): number {
  return version
}

/** A module-level cache keyed on the board/candidates alone must be dropped
 * when the constraints change: the same marks under different regions or
 * cages have different answers. */
export function onConstraintsChange(listener: () => void): void {
  changeListeners.push(listener)
}

/** True for the standard 3x3 boxes (a Classic or a Killer), false for a
 * Jigsaw. Code that relies on the boxes being aligned 3x3 blocks (bands and
 * stacks, box/line intersections of three cells) must check it. */
export function hasDiagonals(): boolean {
  return tables.constraints.diagonals === true
}

export function isAntiKnight(): boolean {
  return tables.constraints.antiKnight === true
}

export function isEntropy(): boolean {
  return tables.constraints.entropy === true
}

export function isStandardLayout(): boolean {
  return tables.standardLayout
}

export function hasCages(): boolean {
  return tables.constraints.cages.length > 0
}

/** Whether a uniqueness argument is valid: "these cells could swap two digits
 * and still be a solution, so the puzzle would have two - which it doesn't".
 * The swap keeps every row, column and box (region) as it was, so it holds
 * on a Classic grid and on a Jigsaw (where the pattern is checked against the
 * regions themselves, see spansTwoBoxes). A Killer cage breaks it: the swap
 * changes the sum of any cage holding one of the swapped cells without its
 * partner, so the "second solution" isn't one, and every technique resting
 * on a deadly pattern - Unique Rectangle (all types), BUG+N, Avoidable
 * Rectangle, Extended UR, UR-AIC - finds nothing while there are cages.
 * Anti-Knight breaks it the same way: a swapped digit can land a knight's
 * move from another copy of itself that the original digit was nowhere near.
 * So does Entropy: swapping a low digit with a high one changes which groups
 * every 2x2 square over the swapped cells holds. (A pattern of two digits of
 * one group would survive, but that case isn't told apart: all off.)
 * (Bivalue Oddagon is not one of them: an odd loop of one pair is a plain
 * contradiction, with or without uniqueness.)
 *
 * X-Sudoku is in between: the swap is fine as long as none of the swapped
 * cells is on a diagonal (it would change what that diagonal holds), so the
 * rectangle-shaped patterns also ask `onActiveDiagonal`; BUG+N holds as it
 * is, since it already demands "every digit twice in every unit" and the
 * diagonals are units. */
export function uniquenessHolds(): boolean {
  return tables.constraints.cages.length === 0 && !tables.constraints.antiKnight && !tables.constraints.entropy
}

/** Whether (row, col) lies on a diagonal that is a unit (X-Sudoku) - a cell
 * a deadly pattern can't include. Always false without diagonals. */
export function onActiveDiagonal(row: number, col: number): boolean {
  return tables.diagonalMask[row * SIZE + col] !== 0
}

/** Whether two different cells lie on one diagonal that is a unit. */
export function sameActiveDiagonal(rowA: number, colA: number, rowB: number, colB: number): boolean {
  return (tables.diagonalMask[rowA * SIZE + colA] & tables.diagonalMask[rowB * SIZE + colB]) !== 0 && (rowA !== rowB || colA !== colB)
}

/** Whether two cells are a knight's move apart on an Anti-Knight puzzle. */
export function knightLinked(rowA: number, colA: number, rowB: number, colB: number): boolean {
  if (!tables.constraints.antiKnight) {
    return false
  }
  const dr = Math.abs(rowA - rowB)
  const dc = Math.abs(colA - colB)
  return (dr === 1 && dc === 2) || (dr === 2 && dc === 1)
}

/** The cells a knight's move from (row, col) on an Anti-Knight puzzle (none
 * otherwise). Shared - don't mutate. */
export function knightCellsOf(row: number, col: number): Cell[] {
  return tables.knightCells[row * SIZE + col]
}

/** "row 3" / "column 7" / "box 5" (or "region 5") / "the \\ diagonal" for one
 * of sudokuUnits()'s entries, by its index. */
export function unitLabel(index: number): string {
  if (index < SIZE) return `row ${index + 1}`
  if (index < 2 * SIZE) return `column ${index - SIZE + 1}`
  if (index < 3 * SIZE) return `${boxWord()} ${index - 2 * SIZE + 1}`
  return index === 3 * SIZE ? 'the \\ diagonal' : 'the / diagonal'
}

/** "box" on a standard grid, "region" on a Jigsaw - for technique text. */
export function boxWord(): 'box' | 'region' {
  return tables.standardLayout ? 'box' : 'region'
}

/** Technique text is written with the word "box" throughout; on a Jigsaw the
 * same sentence is about a region, so it is reworded where it is shown
 * (rather than in every finder's own wording). */
export function regionWording(text: string): string {
  if (tables.standardLayout) {
    return text
  }
  return text.replace(/boxes/g, 'regions').replace(/box/g, 'region').replace(/Boxes/g, 'Regions').replace(/Box/g, 'Region')
}

/** The box (or Jigsaw region) of a cell, 0..8. */
export function boxOf(row: number, col: number): number {
  return tables.boxIndex[row * SIZE + col]
}

export function sameBox(rowA: number, colA: number, rowB: number, colB: number): boolean {
  return tables.boxIndex[rowA * SIZE + colA] === tables.boxIndex[rowB * SIZE + colB]
}

/** The nine cells of a box/region, in reading order. Shared - don't mutate. */
export function boxCells(box: number): Cell[] {
  return tables.boxes[box]
}

/** Every row, column, and box (region) - and on an X-Sudoku the two
 * diagonals after them - each as a list of its nine cells.
 * Built once per set of constraints and shared: Dynamic Dragon's simulation
 * calls this inside its hottest loops (every simulated step, every finder),
 * where rebuilding 27 arrays of tuples each time was a tenth of the whole
 * solve-path search. Callers only read it - don't mutate what comes back. */
export function sudokuUnits(): Cell[][] {
  return tables.units
}

/** The cage a cell is in (index into activeConstraints().cages), -1 for none. */
export function cageOf(row: number, col: number): number {
  return tables.cageIndex[row * SIZE + col]
}

/** Every cell that can't hold the same digit as (row, col) - its row, column,
 * box, diagonals (X-Sudoku), cage, and the cells a knight's move away
 * (Anti-Knight) - with the cell itself among them (the callers' own loops
 * always included it). Shared - don't mutate. */
export function ruleCellsOf(row: number, col: number): Cell[] {
  return tables.ruleCells[row * SIZE + col]
}

/** The cells (row, col) sees through its units - row, column, box and, on an
 * X-Sudoku, its diagonals - not itself, not its cage-mates or knight cells. Shared - don't mutate. */
export function housePeersOf(row: number, col: number): Cell[] {
  return tables.housePeers[row * SIZE + col]
}

/** Whether two different cells share a unit: a row, a column, a box/region
 * or (X-Sudoku) a diagonal. */
export function seesCell(rowA: number, colA: number, rowB: number, colB: number): boolean {
  return (
    (rowA !== rowB || colA !== colB) &&
    (rowA === rowB ||
      colA === colB ||
      tables.boxIndex[rowA * SIZE + colA] === tables.boxIndex[rowB * SIZE + colB] ||
      (tables.diagonalMask[rowA * SIZE + colA] & tables.diagonalMask[rowB * SIZE + colB]) !== 0)
  )
}

/** What the finders' own "do these two cells share a unit" helpers ask
 * (sameUnit / sees in the colouring, chain, fish, ALS and BUG finders): the
 * same row, column or box - a cell counts as sharing with itself, as it
 * always did there - and, on the variants, the same diagonal (X-Sudoku) or a
 * knight's move apart (Anti-Knight). Every one of those helpers uses the
 * answer for one thing only, "a digit can't be in both cells", so the extra
 * links are sound there; on a Classic grid this is exactly the old
 * row/column/box test. Cage-mates are deliberately not included (the Killer
 * finders handle cages, and the Classic ones were verified without them). */
export function sharesHouseOrLink(rowA: number, colA: number, rowB: number, colB: number): boolean {
  if (rowA === rowB || colA === colB) {
    return true
  }
  const a = rowA * SIZE + colA
  const b = rowB * SIZE + colB
  if (tables.boxIndex[a] === tables.boxIndex[b] || (tables.diagonalMask[a] & tables.diagonalMask[b]) !== 0) {
    return true
  }
  return knightLinked(rowA, colA, rowB, colB)
}

/** Whether two different cells can't hold the same digit: they see each
 * other, share a Killer cage, or (Anti-Knight) are a knight's move apart. */
export function cannotRepeat(rowA: number, colA: number, rowB: number, colB: number): boolean {
  if (seesCell(rowA, colA, rowB, colB) || knightLinked(rowA, colA, rowB, colB)) {
    return true
  }
  const cage = tables.cageIndex[rowA * SIZE + colA]
  return cage >= 0 && cage === tables.cageIndex[rowB * SIZE + colB] && (rowA !== rowB || colA !== colB)
}

/** The smallest and largest total `count` different digits can make without
 * using any digit in `usedMask` (bit digit-1) - null when there aren't that
 * many digits left. What a cage's remaining cells can still add up to. */
export function sumBounds(count: number, usedMask: number): { min: number; max: number } | null {
  let min = 0
  let max = 0
  let taken = 0
  for (let digit = 1; digit <= SIZE && taken < count; digit++) {
    if ((usedMask & (1 << (digit - 1))) === 0) {
      min += digit
      taken++
    }
  }
  if (taken < count) {
    return null
  }
  taken = 0
  for (let digit = SIZE; digit >= 1 && taken < count; digit--) {
    if ((usedMask & (1 << (digit - 1))) === 0) {
      max += digit
      taken++
    }
  }
  return { min, max }
}

/** Whether `value` can go in (row, col) as far as its cage's sum goes, given
 * the digits already placed in the cage on `grid` (the cell itself taken as
 * empty): the cage must still be able to reach its sum exactly with
 * different digits in its other empty cells. True for a cell in no cage.
 * Repeats within the cage are the peer check's job (ruleCellsOf). */
export function cageAllows(grid: readonly (readonly number[])[], row: number, col: number, value: number): boolean {
  const index = tables.cageIndex[row * SIZE + col]
  if (index < 0) {
    return true
  }
  const cage = tables.constraints.cages[index]
  let placed = value
  let used = 1 << (value - 1)
  let empty = 0
  for (const [r, c] of cage.cells) {
    if (r === row && c === col) {
      continue
    }
    const digit = grid[r][c]
    if (digit === 0) {
      empty++
    } else {
      placed += digit
      used |= 1 << (digit - 1)
    }
  }
  const bounds = sumBounds(empty, used)
  return bounds !== null && placed + bounds.min <= cage.sum && cage.sum <= placed + bounds.max
}

/** The total of the digits in a mask (bit digit-1), for all 512 masks. */
const MASK_SUM: readonly number[] = Array.from({ length: 512 }, (_, mask) => {
  let sum = 0
  for (let d = 0; d < SIZE; d++) {
    if (mask & (1 << d)) {
      sum += d + 1
    }
  }
  return sum
})

// Scratch tables for cageFillings (10 levels of 512 flags each): it runs
// thousands of times per brute-force solve, so they are reused, not
// allocated per call.
const fillForward = new Uint8Array(10 * 512)
const fillBackward = new Uint8Array(10 * 512)

/**
 * The ways a Killer cage can still be filled. `marks` is, per cell of the
 * cage, the digits still possible there (a bitmask, bit digit-1; a placed
 * digit is its single bit); `sum` is the cage's sum. Returns, per cell, the
 * digits that take part in at least one filling - different digits in every
 * cell, each from its own cell's marks, adding up to the sum - and the digit
 * set of every filling; null when there is none.
 *
 * The digits are all different, so a partial filling is fully described by
 * the *set* of digits used so far (its total follows from the set): at most
 * 512 states per cell, however the cells are ordered. A nine-cell cage costs
 * the same few thousand steps as a two-cell one, where trying the fillings
 * one by one would be 9! of them. Shared by the Killer cage finder (which
 * explains the result) and the brute-force solver (which just prunes by it).
 */
export function cageFillings(marks: readonly number[], sum: number): { supported: number[]; finalMasks: number[] } | null {
  const count = marks.length
  // forward[i][mask]: `mask` can be exactly the digits of the first i cells.
  // backward[i][mask]: from there, cells i.. can still finish on the sum.
  fillForward.fill(0, 0, (count + 1) * 512)
  fillBackward.fill(0, 0, (count + 1) * 512)
  fillForward[0] = 1
  for (let i = 0; i < count; i++) {
    const from = i * 512
    const to = from + 512
    for (let mask = 0; mask < 512; mask++) {
      if (!fillForward[from + mask]) {
        continue
      }
      for (let free = marks[i] & ~mask; free !== 0; free &= free - 1) {
        fillForward[to + (mask | (free & -free))] = 1
      }
    }
  }
  const last = count * 512
  const finalMasks: number[] = []
  for (let mask = 0; mask < 512; mask++) {
    if (MASK_SUM[mask] === sum) {
      fillBackward[last + mask] = 1
      if (fillForward[last + mask]) {
        finalMasks.push(mask)
      }
    }
  }
  if (finalMasks.length === 0) {
    return null
  }
  for (let i = count - 1; i >= 0; i--) {
    const at = i * 512
    const next = at + 512
    for (let mask = 0; mask < 512; mask++) {
      for (let free = marks[i] & ~mask; free !== 0; free &= free - 1) {
        if (fillBackward[next + (mask | (free & -free))]) {
          fillBackward[at + mask] = 1
          break
        }
      }
    }
  }
  const supported = new Array<number>(count).fill(0)
  for (let i = 0; i < count; i++) {
    const at = i * 512
    const next = at + 512
    for (let mask = 0; mask < 512; mask++) {
      if (!fillForward[at + mask]) {
        continue
      }
      for (let free = marks[i] & ~mask; free !== 0; free &= free - 1) {
        const bit = free & -free
        if (fillBackward[next + (mask | bit)]) {
          supported[i] |= bit
        }
      }
    }
  }
  return { supported, finalMasks }
}

// ---- Entropy ---------------------------------------------------------------

/** The three digit groups of an Entropy Sudoku, as digit masks (bit digit-1):
 * low 1-3, middle 4-6, high 7-9. */
export const ENTROPY_GROUP_MASKS: readonly number[] = [0b000000111, 0b000111000, 0b111000000]
export const ENTROPY_GROUP_NAMES: readonly string[] = ['low', 'middle', 'high']
export const ENTROPY_GROUP_DIGITS: readonly string[] = ['1-3', '4-6', '7-9']

/** The group (0 low, 1 middle, 2 high) of a digit 1-9. */
export function entropyGroupOf(digit: number): number {
  return Math.floor((digit - 1) / BOX)
}

/** Which groups a set of digits (bit digit-1) reaches: bit 0 low, bit 1
 * middle, bit 2 high. */
export function entropyGroupsOfMask(digits: number): number {
  return (digits & 0b000000111 ? 1 : 0) | (digits & 0b000111000 ? 2 : 0) | (digits & 0b111000000 ? 4 : 0)
}

/** The 64 2x2 squares, each as its four cells: top-left, top-right,
 * bottom-left, bottom-right. */
export const ENTROPY_SQUARES: readonly (readonly Cell[])[] = (() => {
  const squares: Cell[][] = []
  for (let row = 0; row < SIZE - 1; row++) {
    for (let col = 0; col < SIZE - 1; col++) {
      squares.push([
        [row, col],
        [row, col + 1],
        [row + 1, col],
        [row + 1, col + 1],
      ])
    }
  }
  return squares
})()

/**
 * What one 2x2 square allows, group-wise. Each of its four cells can still
 * hold some of the three groups (a 3-bit set per cell, see
 * entropyGroupsOfMask); the square needs all three, so its cells must be
 * given groups - one each, from their own sets - that cover low, middle and
 * high. ENTROPY_SUPPORT[g0 | g1 << 3 | g2 << 6 | g3 << 9] is, packed the same
 * way, the groups each cell holds in at least one such covering - or -1 when
 * there is none (the square is broken). 4096 entries, built once: all 81
 * coverings tried per entry.
 *
 * This is exact for the square taken alone. (Why a group drops out of a
 * cell: one of the *other* groups has no holder left but this cell, or two
 * of them share their only other holder - see SudokuEntropyFinder, which
 * says so in words.)
 */
const ENTROPY_SUPPORT: Int16Array = (() => {
  const table = new Int16Array(4096).fill(-1)
  for (let key = 0; key < 4096; key++) {
    const sets = [key & 7, (key >> 3) & 7, (key >> 6) & 7, (key >> 9) & 7]
    let supported = 0
    let any = false
    for (let a = 0; a < 3; a++) {
      if (!(sets[0] & (1 << a))) continue
      for (let b = 0; b < 3; b++) {
        if (!(sets[1] & (1 << b))) continue
        for (let c = 0; c < 3; c++) {
          if (!(sets[2] & (1 << c))) continue
          for (let d = 0; d < 3; d++) {
            if (!(sets[3] & (1 << d))) continue
            if (((1 << a) | (1 << b) | (1 << c) | (1 << d)) !== 7) continue
            any = true
            supported |= (1 << a) | (1 << (b + 3)) | (1 << (c + 6)) | (1 << (d + 9))
          }
        }
      }
    }
    if (any) {
      table[key] = supported
    }
  }
  return table
})()

/** See ENTROPY_SUPPORT: the four cells' group sets in, the groups each can
 * really hold out (same packing), -1 for a square that can't be filled. */
export function entropySquareSupport(g0: number, g1: number, g2: number, g3: number): number {
  return ENTROPY_SUPPORT[g0 | (g1 << 3) | (g2 << 6) | (g3 << 9)]
}

/** Whether `value` can go in (row, col) as far as the Entropy rule goes,
 * looking only at the digits placed on `grid` (the cell itself taken as
 * empty; an empty cell could still be anything): no 2x2 square over the cell
 * may be left unable to hold all three groups. True off an Entropy puzzle.
 * This is the "bound" Autofill uses, as cageAllows is a Killer's; what
 * follows from the *candidates* of a square is the technique's job. */
export function entropyAllows(grid: readonly (readonly number[])[], row: number, col: number, value: number): boolean {
  if (!tables.constraints.entropy) {
    return true
  }
  for (let top = row - 1; top <= row; top++) {
    if (top < 0 || top >= SIZE - 1) continue
    for (let left = col - 1; left <= col; left++) {
      if (left < 0 || left >= SIZE - 1) continue
      let key = 0
      let shift = 0
      for (let r = top; r <= top + 1; r++) {
        for (let c = left; c <= left + 1; c++) {
          const digit = r === row && c === col ? value : grid[r][c]
          key |= (digit === 0 ? 7 : 1 << entropyGroupOf(digit)) << shift
          shift += 3
        }
      }
      if (ENTROPY_SUPPORT[key] < 0) {
        return false
      }
    }
  }
  return true
}

/** After `digit` is placed in (row, col) on an Entropy puzzle: the 2x2
 * squares over the cell now leave their empty cells fewer groups, as far as
 * their *placed* digits go (two lows and a middle placed: the fourth cell
 * loses everything but 7-9), and those candidates are cleared in place - the
 * Entropy half of SudokuRules.eliminatePeerCandidates, and the same
 * bookkeeping Autofill does through entropyAllows. Nothing off an Entropy
 * puzzle. (row, col) is read as holding `digit` whether or not `board`
 * already says so. */
export function entropyCancelAround(candidates: boolean[][][], board: readonly (readonly number[])[], row: number, col: number, digit: number): void {
  if (!tables.constraints.entropy) {
    return
  }
  for (let top = row - 1; top <= row; top++) {
    if (top < 0 || top >= SIZE - 1) continue
    for (let left = col - 1; left <= col; left++) {
      if (left < 0 || left >= SIZE - 1) continue
      let key = 0
      let shift = 0
      for (let r = top; r <= top + 1; r++) {
        for (let c = left; c <= left + 1; c++) {
          const placed = r === row && c === col ? digit : board[r][c]
          key |= (placed === 0 ? 7 : 1 << entropyGroupOf(placed)) << shift
          shift += 3
        }
      }
      const supported = ENTROPY_SUPPORT[key]
      if (supported < 0 || supported === key) {
        continue
      }
      shift = 0
      for (let r = top; r <= top + 1; r++) {
        for (let c = left; c <= left + 1; c++) {
          const groups = (supported >> shift) & 7
          shift += 3
          if (groups === 7 || board[r][c] !== 0 || (r === row && c === col)) continue
          for (let d = 0; d < SIZE; d++) {
            if (!(groups & (1 << Math.floor(d / BOX)))) {
              candidates[r][c][d] = false
            }
          }
        }
      }
    }
  }
}

/** A problem with a set of constraints as a puzzle definition, in plain
 * words - null when it is well formed. Checked when a variant puzzle is
 * imported or its layout edited; the finders assume it has passed. */
export function describeConstraintProblem(constraints: SudokuConstraints): string | null {
  if (constraints.regions) {
    if (constraints.regions.length !== SIZE || constraints.regions.some((row) => row.length !== SIZE)) {
      return 'The regions must cover a 9x9 grid.'
    }
    const sizes = new Array<number>(SIZE).fill(0)
    for (const row of constraints.regions) {
      for (const region of row) {
        if (!Number.isInteger(region) || region < 0 || region >= SIZE) {
          return 'Every cell must belong to one of nine regions.'
        }
        sizes[region]++
      }
    }
    const wrong = sizes.findIndex((size) => size !== SIZE)
    if (wrong >= 0) {
      return `Region ${wrong + 1} has ${sizes[wrong]} cells - every region needs exactly 9.`
    }
  }
  const covered = new Set<number>()
  for (const cage of constraints.cages) {
    if (cage.cells.length === 0 || cage.cells.length > SIZE) {
      return 'A cage needs between 1 and 9 cells.'
    }
    for (const [row, col] of cage.cells) {
      if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) {
        return 'A cage has a cell outside the grid.'
      }
      if (covered.has(row * SIZE + col)) {
        return `r${row + 1}c${col + 1} is in two cages.`
      }
      covered.add(row * SIZE + col)
    }
    const bounds = sumBounds(cage.cells.length, 0)!
    if (!Number.isInteger(cage.sum) || cage.sum < bounds.min || cage.sum > bounds.max) {
      const [row, col] = cage.cells[0]
      return cage.cells.length === 1
        ? `A one-cell cage (r${row + 1}c${col + 1}) must sum to a digit from 1 to 9, not ${cage.sum}.`
        : `The cage at r${row + 1}c${col + 1} can't sum to ${cage.sum} with ${cage.cells.length} different digits (they add up to between ${bounds.min} and ${bounds.max}).`
    }
  }
  return null
}
