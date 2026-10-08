/**
 * Tests for the Variant solver's X-Sudoku and Anti-Knight rules (and the
 * shared constraint model they sit in):
 *
 *   npm run test:variants            everything
 *   npm run test:variants -- solving only sections whose name contains "solving"
 *
 * Sections: constraint validation, candidate elimination, solving,
 * uniqueness, generation, import/export, rating requests, and the edge
 * cases where the extra rule changes the answer. The ratings themselves
 * (the numbers) are `npm run test:variant-rating`.
 *
 * Nothing here trusts the code under test to check itself: `independentlyValid`
 * below re-states the three rule sets from scratch (no SudokuConstraints
 * tables), and every solution, generated puzzle and technique row is checked
 * against that or against a solution checked by it.
 *
 * The example puzzles come from SudokuWiki's X-Sudoku solver and
 * sudokutodo.com's Anti-Knight sheets (see variantExamplePuzzles.ts).
 * Exits non-zero on any failure.
 */
import { createEmptyBoard, createEmptyCandidateColors } from '../src/sudoku/boardUtils'
import {
  CLASSIC_CONSTRAINTS,
  ENTROPY_SQUARES,
  cannotRepeat,
  describeConstraintProblem,
  entropySquareSupport,
  knightCellsOf,
  normalizeConstraints,
  onActiveDiagonal,
  ruleCellsOf,
  seesCell,
  setActiveConstraints,
  sharesHouseOrLink,
  sudokuUnits,
  uniquenessHolds,
  unitLabel,
  withConstraints,
  type SudokuConstraints,
} from '../src/sudoku/SudokuConstraints'
import { ALL_RULE3_TECHNIQUES, DEFAULT_RULE3_TECHNIQUES } from '../src/sudoku/SudokuDragonFinder'
import { SudokuRules } from '../src/sudoku/SudokuRules'
import { SudokuSolver } from '../src/sudoku/SudokuSolver'
import { SudokuUniqueRectangleFinder, spansTwoBoxes } from '../src/sudoku/SudokuUniqueRectangleFinder'
import { SudokuVariantLockedFinder } from '../src/sudoku/SudokuVariantLockedFinder'
import { SudokuEntropyFinder } from '../src/sudoku/SudokuEntropyFinder'
import { techniqueUnavailableReason } from '../src/sudoku/variantApplicability'
import { exampleBoard, exampleConstraints, pickVariantExample, VARIANT_EXAMPLE_PUZZLES } from '../src/sudoku/variantExamplePuzzles'
import {
  looksLikeSudokuWikiVariant,
  looksLikeVariantPuzzle,
  parseSudokuWikiVariant,
  parseVariantPuzzle,
  serializeSudokuWikiPuzzle,
  serializeSudokuWikiState,
  serializeVariantPuzzle,
  serializeVariantState,
  sudokuCoachStateRules,
  variantName,
} from '../src/sudoku/VariantPuzzle'
import { generateVariantPuzzle } from '../src/sudoku/VariantPuzzleGenerator'
import type { Board, CandidateGrid } from '../src/sudoku/types'
import { applyTechniqueEffect, buildTechniqueInstances, fullTechniqueEffect, pickEasiestInstance, type TechniqueInstance } from '../src/techniqueEngine'
import { variantRatingRequest } from '../src/variantRating'

const X: SudokuConstraints = { regions: null, cages: [], diagonals: true }
const KNIGHT: SudokuConstraints = { regions: null, cages: [], antiKnight: true }
const BOTH: SudokuConstraints = { regions: null, cages: [], diagonals: true, antiKnight: true }

const only = process.argv.slice(2)
let failed = 0
let passed = 0
let section = ''
let sectionOn = true
function begin(name: string): boolean {
  section = name
  sectionOn = only.length === 0 || only.some((word) => name.includes(word))
  if (sectionOn) console.log(`\n== ${name}`)
  return sectionOn
}
function check(what: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++
  } else {
    failed++
    console.log(`FAIL [${section}] ${what}${detail ? `: ${detail}` : ''}`)
  }
}
function equal<T>(what: string, got: T, expected: T): void {
  check(what, JSON.stringify(got) === JSON.stringify(expected), `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`)
}

const toBoard = (text: string): Board => Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])))
const flat = (board: Board) => board.map((row) => row.join('')).join('')
const givensOf = (board: Board) => board.map((row) => row.map((value) => value !== 0))

/** The rules, written out again with no help from the code under test. */
function independentlyValid(board: Board, rules: { diagonals?: boolean; antiKnight?: boolean }): string | null {
  const full = (cells: Array<[number, number]>, name: string) => {
    const digits = cells.map(([r, c]) => board[r][c]).sort()
    return digits.join('') === '123456789' ? null : `${name} holds ${digits.join('')}`
  }
  for (let i = 0; i < 9; i++) {
    const problem =
      full(Array.from({ length: 9 }, (_, j) => [i, j] as [number, number]), `row ${i + 1}`) ??
      full(Array.from({ length: 9 }, (_, j) => [j, i] as [number, number]), `column ${i + 1}`) ??
      full(Array.from({ length: 9 }, (_, j) => [3 * Math.floor(i / 3) + Math.floor(j / 3), 3 * (i % 3) + (j % 3)] as [number, number]), `box ${i + 1}`)
    if (problem) return problem
  }
  if (rules.diagonals) {
    const problem =
      full(Array.from({ length: 9 }, (_, j) => [j, j] as [number, number]), 'the \\ diagonal') ??
      full(Array.from({ length: 9 }, (_, j) => [j, 8 - j] as [number, number]), 'the / diagonal')
    if (problem) return problem
  }
  if (rules.antiKnight) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        for (const [dr, dc] of [[1, 2], [2, 1], [1, -2], [2, -1]]) {
          const r2 = r + dr
          const c2 = c + dc
          if (r2 < 9 && c2 >= 0 && c2 < 9 && board[r][c] === board[r2][c2]) {
            return `r${r + 1}c${c + 1} and r${r2 + 1}c${c2 + 1} are a knight's move apart and both ${board[r][c]}`
          }
        }
      }
    }
  }
  return null
}

const solver = new SudokuSolver()
const autofill = (board: Board): CandidateGrid =>
  board.map((row, r) => row.map((value, c) => Array.from({ length: 9 }, (_, d) => value === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
const fullMarks = (): CandidateGrid => Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Array<boolean>(9).fill(true)))
const seeded = (start: number) => {
  let seed = start
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A valid Classic grid that is also a valid X-Sudoku (found by the solver
// below and checked independently before it is used), and Classic's most
// famous full grid, which is neither X nor Anti-Knight.
const PLAIN_SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179'

// ---------------------------------------------------------------------------
if (begin('constraint validation')) {
  equal('no extra rule normalizes to the Classic constraints', normalizeConstraints({ regions: null, cages: [], diagonals: false, antiKnight: false }) === CLASSIC_CONSTRAINTS, true)
  equal('a diagonal flag is kept', normalizeConstraints({ regions: null, cages: [], diagonals: true }), { regions: null, cages: [], diagonals: true })
  equal('an off flag is left out', normalizeConstraints({ regions: null, cages: [], diagonals: false, antiKnight: true }), { regions: null, cages: [], antiKnight: true })
  equal('flags alone are a well-formed layout', [describeConstraintProblem(X), describeConstraintProblem(KNIGHT), describeConstraintProblem(BOTH)], [null, null, null])
  equal('names', [variantName(X), variantName(KNIGHT), variantName(BOTH), variantName(CLASSIC_CONSTRAINTS)], ['X-Sudoku', 'Anti-Knight', 'Anti-Knight X-Sudoku', 'Classic'])

  equal('Classic: 27 units', sudokuUnits().length, 27)
  withConstraints(X, () => {
    const units = sudokuUnits()
    equal('X: 29 units', units.length, 29)
    equal('X: unit 27 is the \\ diagonal', units[27].map(([r, c]) => `${r}${c}`).join(' '), '00 11 22 33 44 55 66 77 88')
    equal('X: unit 28 is the / diagonal', units[28].map(([r, c]) => `${r}${c}`).join(' '), '08 17 26 35 44 53 62 71 80')
    equal('X: unit names', [unitLabel(0), unitLabel(9), unitLabel(18), unitLabel(27), unitLabel(28)], ['row 1', 'column 1', 'box 1', 'the \\ diagonal', 'the / diagonal'])
    check('X: r1c1 sees r9c9', seesCell(0, 0, 8, 8))
    check('X: r1c9 sees r9c1', seesCell(0, 8, 8, 0))
    check('X: r2c3 (off both diagonals) does not see r9c9', !seesCell(1, 2, 8, 8))
    check('X: cells of different diagonals do not see each other through them', !seesCell(1, 1, 2, 6) && !seesCell(0, 0, 6, 2))
    check('X: r5c5 is on both and sees all of both', seesCell(4, 4, 0, 0) && seesCell(4, 4, 0, 8) && seesCell(4, 4, 8, 0) && seesCell(4, 4, 8, 8))
    equal('X: a corner has 20 + 6 peers (+ itself)', ruleCellsOf(0, 0).length, 27)
    equal('X: the centre has 20 + 12 peers (+ itself)', ruleCellsOf(4, 4).length, 33)
    equal('X: an off-diagonal cell keeps 20 peers (+ itself)', ruleCellsOf(0, 1).length, 21)
    check('X: onActiveDiagonal', onActiveDiagonal(3, 3) && onActiveDiagonal(3, 5) && !onActiveDiagonal(3, 4))
    check('X: uniqueness arguments still hold (off the diagonals)', uniquenessHolds())
  })
  check('Classic: no cell is on an active diagonal', !onActiveDiagonal(4, 4))
  check('Classic: r1c1 does not see r9c9', !seesCell(0, 0, 8, 8) && !cannotRepeat(0, 0, 8, 8))

  withConstraints(KNIGHT, () => {
    equal('Anti-Knight: still 27 units (the rule adds none)', sudokuUnits().length, 27)
    equal('Anti-Knight: a corner has 2 knight cells', knightCellsOf(0, 0).map(([r, c]) => `${r}${c}`).sort().join(' '), '12 21')
    equal('Anti-Knight: the centre has 8', knightCellsOf(4, 4).length, 8)
    equal('Anti-Knight: an edge cell has 4', knightCellsOf(0, 4).length, 4)
    // Every knight cell of a cell is outside its row and column; in the centre
    // box none is inside the box, in a corner both are.
    equal('Anti-Knight: centre peers = 20 + 8 (+ itself)', ruleCellsOf(4, 4).length, 29)
    equal('Anti-Knight: corner peers = 20 + 0 new (both knight cells are in its box)', ruleCellsOf(0, 0).length, 21)
    check('Anti-Knight: r5c5 and r3c4 cannot repeat', cannotRepeat(4, 4, 2, 3))
    check('Anti-Knight: ...but share no unit', !seesCell(4, 4, 2, 3))
    check('Anti-Knight: a 2x2 step is not a knight move', !cannotRepeat(4, 4, 2, 2))
    check('Anti-Knight: the link is symmetric', cannotRepeat(2, 3, 4, 4) && sharesHouseOrLink(2, 3, 4, 4) && sharesHouseOrLink(4, 4, 2, 3))
    check('Anti-Knight: no deadly patterns', !uniquenessHolds())
    let asymmetric = 0
    let total = 0
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        for (const [r2, c2] of knightCellsOf(r, c)) {
          total++
          if (!knightCellsOf(r2, c2).some(([r3, c3]) => r3 === r && c3 === c)) asymmetric++
          if (Math.abs(r - r2) * Math.abs(c - c2) !== 2) asymmetric++
        }
      }
    }
    equal('Anti-Knight: 448 directed knight links on a 9x9 board, all mutual', [total, asymmetric], [448, 0])
  })
  equal('Classic: no knight cells', knightCellsOf(4, 4).length, 0)

  // isSafe / the solver's own consistency check.
  const one = createEmptyBoard()
  one[0][0] = 5
  check('Classic: 5 at r9c9 beside a 5 at r1c1 is fine', SudokuRules.isSafe(one, 8, 8, 5))
  check('X: it is not', withConstraints(X, () => !SudokuRules.isSafe(one, 8, 8, 5)))
  check('X: a 5 off the diagonal is still fine', withConstraints(X, () => SudokuRules.isSafe(one, 8, 7, 5)))
  const two = createEmptyBoard()
  two[4][4] = 7
  check('Classic: 7 at r3c4 beside a 7 at r5c5 is fine', SudokuRules.isSafe(two, 2, 3, 7))
  check('Anti-Knight: it is not', withConstraints(KNIGHT, () => !SudokuRules.isSafe(two, 2, 3, 7)))
  two[2][3] = 7
  equal('Anti-Knight: givens that break the rule are refused', withConstraints(KNIGHT, () => solver.solve(two).status), 'invalid')
  check('Classic: the same givens are accepted', solver.solve(two).status !== 'invalid')
  const diagonalClash = createEmptyBoard()
  diagonalClash[1][7] = 3
  diagonalClash[7][1] = 3
  equal('X: two 3s on the / diagonal are refused', withConstraints(X, () => solver.solve(diagonalClash).status), 'invalid')

  const plain = toBoard(PLAIN_SOLUTION)
  equal('the well-known Classic grid is a valid Classic solution', independentlyValid(plain, {}), null)
  check('...but breaks the diagonals', independentlyValid(plain, { diagonals: true }) !== null)
  equal('X: the solver refuses it as a full grid', withConstraints(X, () => solver.solve(plain).status), 'invalid')
  check('...and the knight rule', independentlyValid(plain, { antiKnight: true }) !== null)
  equal('Anti-Knight: the solver refuses it too', withConstraints(KNIGHT, () => solver.solve(plain).status), 'invalid')
  equal('Classic: the solver accepts it', solver.solve(plain).status, 'solved')

  equal('applicability: UR off on Anti-Knight', techniqueUnavailableReason('unique rectangle', KNIGHT) !== null, true)
  equal('applicability: UR on on X-Sudoku', techniqueUnavailableReason('unique rectangle', X), null)
  equal('applicability: Extended UR off on X-Sudoku', techniqueUnavailableReason('extended ur', X) !== null, true)
  equal('applicability: chains on on both', [techniqueUnavailableReason('generic aic', X), techniqueUnavailableReason('generic aic', KNIGHT)], [null, null])
  equal('applicability: nothing off on a Classic grid', techniqueUnavailableReason('unique rectangle', CLASSIC_CONSTRAINTS), null)
}

// ---------------------------------------------------------------------------
if (begin('candidate elimination')) {
  const place = (constraints: SudokuConstraints, row: number, col: number): string[] =>
    withConstraints(constraints, () => {
      const board = createEmptyBoard()
      const marks = fullMarks()
      board[row][col] = 5
      SudokuRules.eliminatePeerCandidates(marks, board, row, col, 5)
      const lost: string[] = []
      marks.forEach((cells, r) => cells.forEach((cell, c) => !cell[4] && !(r === row && c === col) && lost.push(`r${r + 1}c${c + 1}`)))
      // Only the placed digit may go.
      check('only the placed digit leaves the peers', marks.every((cells) => cells.every((cell) => cell.every((on, d) => on || d === 4))))
      return lost
    })
  const classic = place(CLASSIC_CONSTRAINTS, 4, 4)
  equal('Classic: a 5 at r5c5 removes 5 from 20 cells', classic.length, 20)
  const x = place(X, 4, 4)
  equal('X: from 20 + 12 diagonal cells', x.length, 32)
  equal(
    'X: the extra ones are exactly the rest of both diagonals',
    x.filter((cell) => !classic.includes(cell)).sort(),
    ['r1c1', 'r1c9', 'r2c2', 'r2c8', 'r3c3', 'r3c7', 'r7c3', 'r7c7', 'r8c2', 'r8c8', 'r9c1', 'r9c9'].sort(),
  )
  equal('X: a 5 off the diagonals removes only the Classic 20', place(X, 0, 1).length, 20)
  equal('X: a 5 at r1c1 removes 5 down the \\ diagonal only', place(X, 0, 0).filter((cell) => !place(CLASSIC_CONSTRAINTS, 0, 0).includes(cell)).sort(), ['r4c4', 'r5c5', 'r6c6', 'r7c7', 'r8c8', 'r9c9'])
  const knight = place(KNIGHT, 4, 4)
  equal('Anti-Knight: from 20 + 8 knight cells', knight.length, 28)
  equal(
    'Anti-Knight: the extra ones are exactly the knight cells',
    knight.filter((cell) => !classic.includes(cell)).sort(),
    ['r3c4', 'r3c6', 'r4c3', 'r4c7', 'r6c3', 'r6c7', 'r7c4', 'r7c6'].sort(),
  )
  equal('Anti-Knight: in a corner the knight cells are in the box already', place(KNIGHT, 0, 0).length, 20)
  equal('Anti-Knight: at r1c2 one of the three knight cells is outside its box', place(KNIGHT, 0, 1).filter((cell) => !place(CLASSIC_CONSTRAINTS, 0, 1).includes(cell)), ['r2c4'])
  equal('both rules: 20 + 12 + 8', place(BOTH, 4, 4).length, 40)

  // Autofill on a real puzzle: never loses the true digit, and is strictly
  // tighter than the Classic autofill on the same givens.
  for (const example of VARIANT_EXAMPLE_PUZZLES) {
    const board = exampleBoard(example)
    const constraints = exampleConstraints(example.kind)
    const solution = withConstraints(constraints, () => solver.solve(board).board!)
    const marks = withConstraints(constraints, () => autofill(board))
    const classicMarks = autofill(board)
    let lostTruth = 0
    let extra = 0
    let fewer = 0
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] !== 0) continue
        if (!marks[r][c][solution[r][c] - 1]) lostTruth++
        for (let d = 0; d < 9; d++) {
          if (marks[r][c][d] && !classicMarks[r][c][d]) extra++
          if (!marks[r][c][d] && classicMarks[r][c][d]) fewer++
        }
      }
    }
    check(`${example.label}: autofill keeps every true digit`, lostTruth === 0)
    check(`${example.label}: autofill never adds to the Classic marks`, extra === 0)
    check(`${example.label}: the rule removes marks the Classic autofill leaves`, fewer > 0, `${fewer}`)
  }
}

// ---------------------------------------------------------------------------
if (begin('solving')) {
  for (const example of VARIANT_EXAMPLE_PUZZLES) {
    const board = exampleBoard(example)
    const rules = example.kind === 'x-sudoku' ? { diagonals: true } : { antiKnight: true }
    const result = withConstraints(exampleConstraints(example.kind), () => solver.solve(board))
    equal(`${example.label}: solved`, result.status, 'solved')
    if (result.board) {
      equal(`${example.label}: the solution obeys every rule`, independentlyValid(result.board, rules), null)
      check(`${example.label}: the solution keeps the givens`, board.every((row, r) => row.every((value, c) => value === 0 || value === result.board![r][c])))
    }
  }
  // An empty grid has solutions under each rule set, and they obey it.
  for (const [name, constraints, rules] of [
    ['X', X, { diagonals: true }],
    ['Anti-Knight', KNIGHT, { antiKnight: true }],
    ['both rules', BOTH, { diagonals: true, antiKnight: true }],
  ] as const) {
    const found = withConstraints(constraints, () => solver.findSolutions(createEmptyBoard(), 2))
    equal(`${name}: an empty grid has more than one solution`, found.length, 2)
    equal(`${name}: and they obey the rules`, found.map((board) => independentlyValid(board, rules)), [null, null])
  }
}

// ---------------------------------------------------------------------------
if (begin('uniqueness')) {
  for (const example of VARIANT_EXAMPLE_PUZZLES) {
    const board = exampleBoard(example)
    equal(`${example.label}: exactly one solution under its rule`, withConstraints(exampleConstraints(example.kind), () => solver.findSolutions(board, 2).length), 1)
    equal(`${example.label}: ${example.classicSolutions === 1 ? 'one solution' : 'several solutions'} as a Classic puzzle`, solver.findSolutions(board, 2).length, example.classicSolutions)
  }
  equal('17 X-Sudoku and 10 Anti-Knight examples', [VARIANT_EXAMPLE_PUZZLES.filter((e) => e.kind === 'x-sudoku').length, VARIANT_EXAMPLE_PUZZLES.filter((e) => e.kind === 'anti-knight').length], [17, 10])
  equal('no example is listed twice', new Set(VARIANT_EXAMPLE_PUZZLES.map((e) => e.givens)).size, VARIANT_EXAMPLE_PUZZLES.length)
  // Taking a given away from a puzzle the generator made minimal must lose
  // uniqueness (that is what minimal means) - under the rule.
  const random = seeded(7)
  for (const kind of ['x-sudoku', 'anti-knight'] as const) {
    const puzzle = generateVariantPuzzle(kind, { random, hard: true, timeBudgetMs: 60000 })!
    withConstraints(puzzle.constraints, () => {
      equal(`${kind}: a minimal generated puzzle has one solution`, solver.solve(puzzle.board).status, 'solved')
      let stillUnique = 0
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (puzzle.board[r][c] === 0) continue
          const without = puzzle.board.map((row) => [...row])
          without[r][c] = 0
          if (solver.solve(without).status === 'solved') stillUnique++
        }
      }
      equal(`${kind}: ...and loses it when any given is removed`, stillUnique, 0)
    })
    equal(`${kind}: the same givens have several solutions without the rule`, solver.solve(puzzle.board).status, 'multiple')
  }
}

// ---------------------------------------------------------------------------
if (begin('generation')) {
  for (const kind of ['x-sudoku', 'anti-knight'] as const) {
    const rules = kind === 'x-sudoku' ? { diagonals: true } : { antiKnight: true }
    for (const hard of [false, true]) {
      const random = seeded(hard ? 11 : 3)
      const seen = new Set<string>()
      for (let n = 0; n < 15; n++) {
        const puzzle = generateVariantPuzzle(kind, { random, hard, timeBudgetMs: 60000 })
        const name = `${hard ? 'hard' : 'easy'} ${kind} #${n + 1}`
        if (!puzzle) {
          check(`${name}: generated`, false)
          continue
        }
        seen.add(flat(puzzle.board))
        equal(`${name}: carries its rule and nothing else`, puzzle.constraints, kind === 'x-sudoku' ? X : KNIGHT)
        const solutions = withConstraints(puzzle.constraints, () => solver.findSolutions(puzzle.board, 2))
        equal(`${name}: one solution`, solutions.length, 1)
        if (solutions.length === 1) {
          equal(`${name}: which obeys the rules`, independentlyValid(solutions[0], rules), null)
        }
        const count = puzzle.board.flat().filter(Boolean).length
        check(`${name}: givens (${count})`, hard ? count <= 24 : count === 24)
      }
      equal(`${hard ? 'hard' : 'easy'} ${kind}: 15 different puzzles`, seen.size, 15)
    }
    // The same seed gives the same puzzle.
    const first = generateVariantPuzzle(kind, { random: seeded(99) })!
    const second = generateVariantPuzzle(kind, { random: seeded(99) })!
    equal(`${kind}: deterministic for a seed`, flat(first.board), flat(second.board))
  }
  equal('an example is picked from its own kind', [pickVariantExample('x-sudoku').kind, pickVariantExample('anti-knight').kind], ['x-sudoku', 'anti-knight'])
  const firstX = VARIANT_EXAMPLE_PUZZLES[0]
  let repeated = 0
  for (let n = 0; n < 50; n++) {
    if (pickVariantExample('x-sudoku', firstX.givens).givens === firstX.givens) repeated++
  }
  equal('asking again never returns the puzzle already on the grid', repeated, 0)
}

// ---------------------------------------------------------------------------
if (begin('import/export')) {
  for (const example of VARIANT_EXAMPLE_PUZZLES) {
    const board = exampleBoard(example)
    const constraints = exampleConstraints(example.kind)
    const text = serializeVariantPuzzle(board, givensOf(board), constraints)
    check(`${example.label}: Copy Original is recognised`, looksLikeVariantPuzzle(text))
    const parsed = parseVariantPuzzle(text)
    check(`${example.label}: ...and reads back`, parsed.ok)
    if (parsed.ok) {
      equal(`${example.label}: same givens`, flat(parsed.board), example.givens)
      equal(`${example.label}: same rules`, parsed.constraints, constraints)
      equal(`${example.label}: every digit a given`, parsed.givens, givensOf(board))
      equal(`${example.label}: and it solves`, withConstraints(parsed.constraints, () => solver.solve(parsed.board).status), 'solved')
    }
    equal(`${example.label}: no SudokuWiki string (that format has no place for the rule)`, serializeSudokuWikiPuzzle(board, givensOf(board), constraints), null)
  }
  // Copy Puzzle As-Is: progress and marks survive, with the rule.
  const example = VARIANT_EXAMPLE_PUZZLES.find((e) => e.kind === 'anti-knight')!
  const board = exampleBoard(example)
  const givens = givensOf(board)
  const state = withConstraints(KNIGHT, () => {
    const solution = solver.solve(board).board!
    const progressed = board.map((row) => [...row])
    const empty = progressed.flatMap((row, r) => row.map((value, c) => (value === 0 ? ([r, c] as const) : null))).filter((cell) => cell !== null)
    const [r0, c0] = empty[0]
    progressed[r0][c0] = solution[r0][c0]
    return { board: progressed, givens, candidates: autofill(progressed), candidateColors: createEmptyCandidateColors(), constraints: KNIGHT }
  })
  const asIs = parseVariantPuzzle(serializeVariantState(state))
  check('As-Is reads back', asIs.ok)
  if (asIs.ok) {
    equal('As-Is: board', flat(asIs.board), flat(state.board))
    equal('As-Is: givens (the solved cell is not one)', asIs.givens, givens)
    equal('As-Is: candidates', asIs.candidates, state.candidates)
    equal('As-Is: rules', asIs.constraints, KNIGHT)
  }
  equal('As-Is: no SudokuWiki string either', serializeSudokuWikiState(state), null)

  const both = parseVariantPuzzle('{"variantSudoku":1,"givens":"' + '0'.repeat(81) + '","diagonals":true,"antiKnight":true}')
  check('both rules in one puzzle', both.ok && both.constraints.diagonals === true && both.constraints.antiKnight === true)
  const neither = parseVariantPuzzle('{"variantSudoku":1,"givens":"' + '0'.repeat(81) + '","diagonals":false}')
  check('"diagonals": false is a Classic puzzle', neither.ok && neither.constraints === CLASSIC_CONSTRAINTS)
  const notBoolean = parseVariantPuzzle('{"variantSudoku":1,"givens":"' + '0'.repeat(81) + '","antiKnight":"yes"}')
  check('a flag that is not true is ignored', notBoolean.ok && notBoolean.constraints === CLASSIC_CONSTRAINTS)
  const jigsawX = parseVariantPuzzle(
    '{"variantSudoku":1,"givens":"' + '0'.repeat(81) + '","regions":"111222333111222333111222333444555666444555666444555666777888999777888999777888991","diagonals":true}',
  )
  check('a malformed layout is still refused with a flag set', !jigsawX.ok)

  // A link to SudokuWiki's X-Sudoku solver.
  const wiki = VARIANT_EXAMPLE_PUZZLES[0]
  const url = `https://www.sudokuwiki.org/sudokux.aspx?bd=${wiki.givens}`
  check('SudokuWiki X-Sudoku link is recognised', looksLikeSudokuWikiVariant(url))
  const fromUrl = parseSudokuWikiVariant(url)
  check('...and read', fromUrl.ok)
  if (fromUrl.ok) {
    equal('SudokuWiki X link: givens', flat(fromUrl.board), wiki.givens)
    equal('SudokuWiki X link: the diagonal rule', fromUrl.constraints, X)
  }
  check('a bare 81-digit string is not taken for a variant', !looksLikeSudokuWikiVariant(wiki.givens) && !looksLikeVariantPuzzle(wiki.givens))
  check('a Classic SudokuWiki link is not taken for X', !looksLikeSudokuWikiVariant(`https://www.sudokuwiki.org/sudoku.htm?bd=${wiki.givens}`))
}

// ---------------------------------------------------------------------------
if (begin('rating requests')) {
  const board = exampleBoard(VARIANT_EXAMPLE_PUZZLES[0])
  const givens = givensOf(board)
  equal('Classic: nothing for the variant rating', variantRatingRequest(board, givens, CLASSIC_CONSTRAINTS), null)
  const x = variantRatingRequest(board, givens, X)!
  equal('X: SukakuExplainer as it is, rules "x"', [x.system, x.rules, x.regions, x.cages, x.givens], ['sukaku-explainer-x', 'x', '', '', VARIANT_EXAMPLE_PUZZLES[0].givens])
  const knight = variantRatingRequest(board, givens, KNIGHT)!
  equal('Anti-Knight: the adaptation, rules "k"', [knight.system, knight.rules], ['explainer-anti-knight-adaptation', 'k'])
  equal('both: the less established system names it', [variantRatingRequest(board, givens, BOTH)!.system, variantRatingRequest(board, givens, BOTH)!.rules], ['explainer-anti-knight-adaptation', 'xk'])
  const cage: SudokuConstraints = { regions: null, cages: [{ sum: 3, cells: [[0, 0], [0, 1]] }], antiKnight: true }
  equal('cages outrank it', variantRatingRequest(createEmptyBoard(), givensOf(createEmptyBoard()), cage)!.system, 'explainer-killer-extension')
  // Solved digits that are not givens are left out of what is rated.
  const progressed = board.map((row) => [...row])
  const [r, c] = progressed.flatMap((row, i) => row.map((value, j) => (value === 0 ? [i, j] : null))).find((cell) => cell !== null)!
  progressed[r][c] = 1
  equal('only the givens are rated', variantRatingRequest(progressed, givens, X)!.givens, VARIANT_EXAMPLE_PUZZLES[0].givens)
}

// ---------------------------------------------------------------------------
if (begin('edge cases')) {
  const finder = new SudokuVariantLockedFinder()
  const empty = createEmptyBoard()

  // X: box 1's 5s all on the \ diagonal -> no 5 on the rest of it.
  {
    const marks = fullMarks()
    for (const [r, c] of [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]]) marks[r][c][4] = false
    equal('Classic: nothing to find', finder.find(empty, marks), [])
    // Under the knight rule the same marks give something else: r1c4 sees
    // r1c1 along the row and is a knight's move from both r2c2 and r3c3
    // (and r4c1 likewise down the column).
    const knightFound = withConstraints(KNIGHT, () => finder.find(empty, marks)).find((instance) => instance.digit === 5 && instance.unitName === 'box 1')
    equal('Anti-Knight: the same marks remove 5 from r1c4 and r4c1', knightFound?.eliminations.map((e) => `r${e.row + 1}c${e.col + 1}`), ['r1c4', 'r4c1'])
    const found = withConstraints(X, () => finder.find(empty, marks))
    const row = found.find((instance) => instance.digit === 5 && instance.unitName === 'box 1')
    check('X: box 1 claims 5 for the diagonal', row !== undefined && row.kind === 'diagonal')
    equal('X: ...removing it from r4c4-r9c9', row?.eliminations.map((e) => `r${e.row + 1}c${e.col + 1}`), ['r4c4', 'r5c5', 'r6c6', 'r7c7', 'r8c8', 'r9c9'])
  }
  // X: the / diagonal's 7s all in box 5 -> no other 7 in box 5.
  {
    const marks = fullMarks()
    for (const [r, c] of [[0, 8], [1, 7], [2, 6], [6, 2], [7, 1], [8, 0]]) marks[r][c][6] = false
    const found = withConstraints(X, () => finder.find(empty, marks))
    const row = found.find((instance) => instance.digit === 7 && instance.unitName === 'the / diagonal')
    equal('X: the / diagonal points 7 into box 5', row?.eliminations.map((e) => `r${e.row + 1}c${e.col + 1}`), ['r4c4', 'r4c5', 'r5c4', 'r5c6', 'r6c5', 'r6c6'])
    equal('Classic: the same marks give nothing', finder.find(empty, marks), [])
  }
  // Anti-Knight: box 5's 5s only at r4c4 and r4c6. r2c5 is a knight's move
  // from both; r3c4 shares column 4 with one and is a knight's move from the
  // other, and r3c6 likewise. (Row 4's other cells see both too, but that is
  // plain Pointing, which the Classic finder reports.)
  {
    const marks = fullMarks()
    for (let r = 3; r < 6; r++) for (let c = 3; c < 6; c++) if (!(r === 3 && c !== 4)) marks[r][c][4] = false
    const found = withConstraints(KNIGHT, () => finder.find(empty, marks))
    const row = found.find((instance) => instance.digit === 5 && instance.unitName === 'box 5')
    check('Anti-Knight: a knight locked candidate', row !== undefined && row.kind === 'knight')
    equal('Anti-Knight: ...removes 5 from r2c5, r3c4 and r3c6', row?.eliminations.map((e) => `r${e.row + 1}c${e.col + 1}`), ['r2c5', 'r3c4', 'r3c6'])
    equal('Classic and X: nothing', [finder.find(empty, marks).length, withConstraints(X, () => finder.find(empty, marks)).length], [0, 0])
    // In the technique list: named, badged, ranked right after Locked Candidates.
    const rows = withConstraints(KNIGHT, () =>
      buildTechniqueInstances(empty, marks, 0, new Set(DEFAULT_RULE3_TECHNIQUES), false, true, true, true, false, false, false, true, new Set(), false, Infinity, false, false, givensOf(empty)),
    )
    const listed = rows.find((instance) => instance.id.startsWith('variant-locked-knight'))
    check('Anti-Knight: listed as "Locked Candidate (Knight\'s Move)" with its badge', listed?.name === "Locked Candidate (Knight's Move)" && listed.variantConstraint === 'anti-knight')
    check('Classic: the list has no variant row', !buildTechniqueInstances(empty, marks, 0, new Set(DEFAULT_RULE3_TECHNIQUES), false, true, true, true, false, false, false, true, new Set(), false, Infinity, false, false, givensOf(empty)).some((instance) => instance.variantConstraint))
  }

  // Uniqueness: a Unique Rectangle that is one on a Classic grid is none
  // under the knight rule, nor on a diagonal.
  {
    check('Classic: r1c1/r1c4/r2c1/r2c4 is a rectangle over two boxes', spansTwoBoxes(0, 1, 0, 3))
    check('X: not with a corner on a diagonal', withConstraints(X, () => !spansTwoBoxes(0, 1, 0, 3)))
    check('X: r1c2/r1c5/r3c2/r3c5 touches no diagonal and still is one', withConstraints(X, () => spansTwoBoxes(0, 2, 1, 4)))
    // A Type 1 on the second rectangle: three corners {1,2}, the fourth {1,2,3}.
    const marks = fullMarks()
    for (const [r, c] of [[0, 1], [0, 4], [2, 1]]) marks[r][c] = marks[r][c].map((_, d) => d < 2)
    marks[2][4] = marks[2][4].map((_, d) => d < 3)
    const urFinder = new SudokuUniqueRectangleFinder()
    check('Classic: Unique Rectangle found', urFinder.find(empty, marks).length > 0)
    check('X: found too (no corner on a diagonal)', withConstraints(X, () => urFinder.find(empty, marks).length > 0))
    equal('Anti-Knight: not found', withConstraints(KNIGHT, () => urFinder.find(empty, marks).length), 0)
    // The same Type 1 moved onto the diagonal: r1c1/r1c4/r2c1/r2c4.
    const onDiagonal = fullMarks()
    for (const [r, c] of [[0, 0], [0, 3], [1, 0]]) onDiagonal[r][c] = onDiagonal[r][c].map((_, d) => d < 2)
    onDiagonal[1][3] = onDiagonal[1][3].map((_, d) => d < 3)
    check('Classic: that one is found', urFinder.find(empty, onDiagonal).length > 0)
    equal('X: but not with r1c1 on the diagonal', withConstraints(X, () => urFinder.find(empty, onDiagonal).length), 0)
  }

  // The whole technique list, walked down real puzzles: every row of every
  // state must agree with the solution. Run on the published examples (most
  // of which have several Classic solutions, so a technique that ignored the
  // rule could not finish them) and on generated ones.
  const allFish = new Set(['x-wing', 'finned x-wing', 'swordfish', 'finned swordfish'] as never[])
  const allExotic = new Set(['sue de coq', 'extended ur'] as never[])
  // Every standalone technique on (fish, Generic / Grouped AIC, ALS-xz,
  // UR-AIC, ALS-AIC, the exotics, "All Possible Techniques" so no row is
  // hidden). Dynamic Dragon gets every helper except the four "Unfair" ones:
  // with those inside it a single list build on a sparse grid takes 30-75 s
  // (they are off by default and carry a warning in the menu for that), and
  // they are tested here as standalone rows anyway.
  const unfair = new Set<string>(['grouped aic', 'als-xz', 'ur-aic', 'als-aic'])
  const dragonHelpers = new Set(ALL_RULE3_TECHNIQUES.filter((technique) => !unfair.has(technique)))
  const everything = (board: Board, candidates: CandidateGrid, givens: boolean[][]): TechniqueInstance[] =>
    buildTechniqueInstances(board, candidates, 0, dragonHelpers, true, true, true, true, true, false, false, true, allFish, true, 2, false, false, givens, allExotic, true, true, true, true)
  const walk = (label: string, start: Board, constraints: SudokuConstraints, seconds: number) => {
    setActiveConstraints(constraints)
    const solution = solver.solve(start).board!
    const givens = givensOf(start)
    let board = start.map((row) => [...row])
    let candidates = autofill(board)
    let wrong = 0
    let rows = 0
    let variantRows = 0
    const names = new Set<string>()
    const started = Date.now()
    for (let step = 0; step < 400 && Date.now() - started < seconds * 1000; step++) {
      const instances = everything(board, candidates, givens)
      for (const instance of instances) {
        rows++
        if (instance.variantConstraint) variantRows++
        const effect = fullTechniqueEffect(instance)
        if (
          effect.eliminatedCandidates.some((e) => solution[e.row][e.col] === e.digit && !effect.solvedCandidates.some((s) => s.row === e.row && s.col === e.col)) ||
          effect.solvedCandidates.some((s) => solution[s.row][s.col] !== s.digit)
        ) {
          wrong++
          console.log(`   WRONG ${instance.name}: ${instance.notation} (board ${flat(board)})`)
        }
        if (/^(Unique Rectangle|Avoidable Rectangle|BUG\+|UR-AIC|Extended UR)/.test(instance.name)) names.add(instance.name.replace(/\s*\(.*$/, ''))
      }
      const chosen = pickEasiestInstance(instances)
      if (!chosen) break
      const next = applyTechniqueEffect(board, candidates, fullTechniqueEffect(chosen))
      board = next.board
      candidates = next.candidates
    }
    setActiveConstraints(CLASSIC_CONSTRAINTS)
    const solved = board.every((row, r) => row.every((value, c) => value === solution[r][c]))
    check(`${label}: every listed row agrees with the solution (${rows} rows)`, wrong === 0, `${wrong} wrong`)
    return { solved, variantRows, uniquenessNames: [...names] }
  }
  let solvedExamples = 0
  let variantRows = 0
  const knightUniqueness = new Set<string>()
  for (const example of VARIANT_EXAMPLE_PUZZLES) {
    const result = walk(example.label, exampleBoard(example), exampleConstraints(example.kind), 20)
    if (result.solved) solvedExamples++
    variantRows += result.variantRows
    if (example.kind === 'anti-knight') result.uniquenessNames.forEach((name) => knightUniqueness.add(name))
  }
  console.log(`   examples solved by techniques alone: ${solvedExamples}/${VARIANT_EXAMPLE_PUZZLES.length}; rows using a diagonal or knight link: ${variantRows}`)
  check('the examples use the variant technique somewhere', variantRows > 0)
  equal('no uniqueness technique is ever listed on an Anti-Knight puzzle', [...knightUniqueness], [])
  const random = seeded(5)
  for (const kind of ['x-sudoku', 'anti-knight'] as const) {
    for (let n = 1; n <= 4; n++) {
      const puzzle = generateVariantPuzzle(kind, { random, hard: true, timeBudgetMs: 60000 })!
      walk(`generated hard ${kind} #${n}`, puzzle.board, puzzle.constraints, 15)
    }
  }
  // Both rules at once, to be sure they compose.
  const bothPuzzle = withConstraints(BOTH, () => {
    const full = solver.findSolutions(createEmptyBoard(), 1)[0]
    const board = full.map((row) => [...row])
    const order = Array.from({ length: 81 }, (_, i) => i)
    const shuffle = seeded(21)
    for (let i = 80; i > 0; i--) {
      const j = Math.floor(shuffle() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (const cell of order) {
      const r = Math.floor(cell / 9)
      const c = cell % 9
      const value = board[r][c]
      board[r][c] = 0
      if (solver.solve(board).status !== 'solved') board[r][c] = value
    }
    return { board, full }
  })
  equal('both rules: the full grid obeys both', independentlyValid(bothPuzzle.full, { diagonals: true, antiKnight: true }), null)
  walk(`Anti-Knight X-Sudoku (${bothPuzzle.board.flat().filter(Boolean).length} givens)`, bothPuzzle.board, BOTH, 20)
}

// ---- Entropy Sudoku ---------------------------------------------------------
// Every 2x2 square holds a low (1-3), a middle (4-6) and a high (7-9) digit.
// The five reference puzzles are Sudoku.Coach's (given by the user with its
// difficulty grades); their solutions are checked by the rule written out
// again below, not by the code under test.
const ENTROPY: SudokuConstraints = { regions: null, cages: [], entropy: true }
const ENTROPY_REFERENCES: Array<[label: string, givens: string]> = [
  ['Easy', '961003800070000102502018390080470619090001030007369508000002951859134200026900000'],
  ['Moderately Easy', '800000000002000000096080000060840520008007100170290683630408275000000001040000060'],
  ['Moderate', '090701480406009010000050060000002900024006050000000102000240008003017000000600071'],
  ['Moderately Hard', '000703000000100000060040000030079010000000000040001050000000000000000020090000100'],
  ['Hard', '000400000040005000000000300000916700000000209000000000000300000906000504000200030'],
]
const ENTROPY_SC_STATE =
  'SCv7_32_f2e2r3hh1q1j0325tvh9jo9744gmcrbrga71a0ola4a8i1g4a4iole3r2fdc3gtjjvqvujju171jqv0smle923rf2uns31tka95mo1505i02c3o4ki389c4a065rl08h1gv2vai8pao4dk81p5d5hja2qmp91obj9fvo9iokquqf88cmj33ksod0aqga5d6dn43visbqurhir9j5jarvpcpqvtp3vdpbih98gfmjfoedrs85dr1je28'
/** The Entropy rule on a full grid, written out again. */
function entropyBroken(board: Board): string | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const digits = [board[r][c], board[r][c + 1], board[r + 1][c], board[r + 1][c + 1]]
      for (const [name, low, high] of [['low', 1, 3], ['middle', 4, 6], ['high', 7, 9]] as const) {
        if (!digits.some((digit) => digit >= low && digit <= high)) {
          return `the square at r${r + 1}c${c + 1} has no ${name} digit (${digits.join('')})`
        }
      }
    }
  }
  return null
}

if (begin('Entropy: the rule')) {
  equal('normalized with its flag', normalizeConstraints({ regions: null, cages: [], entropy: true }), { regions: null, cages: [], entropy: true })
  equal('off = Classic', normalizeConstraints({ regions: null, cages: [], entropy: false }) === CLASSIC_CONSTRAINTS, true)
  equal('names', [variantName(ENTROPY), variantName({ ...ENTROPY, diagonals: true })], ['Entropy', 'Entropy X-Sudoku'])
  withConstraints(ENTROPY, () => {
    equal('still 27 units, and a cell still has 20 peers (+ itself)', [sudokuUnits().length, ruleCellsOf(4, 4).length], [27, 21])
    check('no deadly patterns', !uniquenessHolds())
  })
  equal('64 squares', ENTROPY_SQUARES.length, 64)
  equal('applicability: UR off on Entropy', techniqueUnavailableReason('unique rectangle', ENTROPY) !== null, true)
  equal('applicability: singles still on', techniqueUnavailableReason('singles', ENTROPY), null)

  // The support table against a plain enumeration, for every combination of
  // what four cells can still hold.
  let tableMismatch = 0
  for (let key = 0; key < 4096; key++) {
    const sets = [key & 7, (key >> 3) & 7, (key >> 6) & 7, (key >> 9) & 7]
    const supported = [0, 0, 0, 0]
    let any = false
    for (let fill = 0; fill < 81; fill++) {
      const groups = [fill % 3, Math.floor(fill / 3) % 3, Math.floor(fill / 9) % 3, Math.floor(fill / 27)]
      if (groups.some((group, i) => !(sets[i] & (1 << group))) || new Set(groups).size !== 3) continue
      any = true
      groups.forEach((group, i) => (supported[i] |= 1 << group))
    }
    const expected = any ? supported[0] | (supported[1] << 3) | (supported[2] << 6) | (supported[3] << 9) : -1
    if (entropySquareSupport(sets[0], sets[1], sets[2], sets[3]) !== expected) tableMismatch++
  }
  equal('the support table agrees with a plain enumeration (4096 cases)', tableMismatch, 0)

  // r1c1 = 1 and r1c2 = 2 are low, r2c1 = 4 middle: r2c2 must be high.
  const three = createEmptyBoard()
  three[0][0] = 1
  three[0][1] = 2
  three[1][0] = 4
  equal('Classic: r2c2 may be 5 or 7', [SudokuRules.isSafe(three, 1, 1, 5), SudokuRules.isSafe(three, 1, 1, 7)], [true, true])
  equal('Entropy: only a high digit', withConstraints(ENTROPY, () => [5, 6, 7, 8, 9].map((digit) => SudokuRules.isSafe(three, 1, 1, digit))), [false, false, true, true, true])
  // Two lows placed: the other two must be one middle, one high - neither low.
  const two = createEmptyBoard()
  two[3][3] = 1
  two[4][4] = 2
  equal('Entropy: two lows on a diagonal bar a third', withConstraints(ENTROPY, () => [3, 4, 7].map((digit) => SudokuRules.isSafe(two, 3, 4, digit))), [false, true, true])
  equal('Autofill follows', withConstraints(ENTROPY, () => autofill(two)[4][3].map((on, d) => (on ? d + 1 : 0)).filter(Boolean)), [4, 5, 6, 7, 8, 9])
  // A placement keeps the same bookkeeping: r4c4 = 1 on the grid, then r5c5 = 2.
  const beforeSecond = createEmptyBoard()
  beforeSecond[3][3] = 1
  const live = withConstraints(ENTROPY, () => autofill(beforeSecond))
  equal('before the second low, r5c4 may still be low', live[4][3][2], true)
  withConstraints(ENTROPY, () => SudokuRules.eliminatePeerCandidates(live, two, 4, 4, 2))
  equal('...and after it, not', live[4][3].map((on, d) => (on ? d + 1 : 0)).filter(Boolean), [4, 5, 6, 7, 8, 9])
  const classicLive = autofill(beforeSecond)
  SudokuRules.eliminatePeerCandidates(classicLive, two, 4, 4, 2)
  equal('Classic: a placement clears the digit only', classicLive[4][3].map((on, d) => (on ? d + 1 : 0)).filter(Boolean), [3, 4, 5, 6, 7, 8, 9])
}

if (begin('Entropy: solving')) {
  let classicUnique = 0
  for (const [label, givens] of ENTROPY_REFERENCES) {
    const board = toBoard(givens)
    const result = withConstraints(ENTROPY, () => solver.solve(board))
    equal(`${label}: one solution under the rule`, result.status, 'solved')
    if (result.board) {
      equal(`${label}: ...which is a valid Sudoku`, independentlyValid(result.board, {}), null)
      equal(`${label}: ...and obeys the Entropy rule`, entropyBroken(result.board), null)
      check(`${label}: ...and keeps the givens`, board.every((row, r) => row.every((value, c) => value === 0 || value === result.board![r][c])))
    }
    if (solver.solve(board).status === 'solved') classicUnique++
  }
  equal('only the Easy one is a Classic puzzle too (the rule does the rest)', classicUnique, 1)
  // A Classic solution that breaks the rule is refused.
  const classicFull = solver.solve(toBoard(ENTROPY_REFERENCES[0][1])).board!
  const swapped = classicFull.map((row) => row.map((digit) => (digit === 1 ? 7 : digit === 7 ? 1 : digit)))
  equal('a relabelled grid is still a Sudoku', independentlyValid(swapped, {}), null)
  check('...but breaks the Entropy rule', entropyBroken(swapped) !== null)
  equal('...and the solver refuses it', withConstraints(ENTROPY, () => solver.solve(swapped).status), 'invalid')
}

if (begin('Entropy: the Entropy Square technique')) {
  const finder = new SudokuEntropyFinder()
  const marksFor = (cells: Array<[number, number, number[]]>): CandidateGrid => {
    const marks: CandidateGrid = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Array<boolean>(9).fill(false)))
    for (const [row, col, digits] of cells) digits.forEach((digit) => (marks[row][col][digit - 1] = true))
    return marks
  }
  const empty = createEmptyBoard()
  // Only r2c2 can be high.
  const single = marksFor([[0, 0, [1, 2, 4]], [0, 1, [2, 5]], [1, 0, [3, 6]], [1, 1, [2, 5, 8, 9]]])
  equal('Classic: nothing', finder.find(empty, single), [])
  const singleFound = withConstraints(ENTROPY, () => finder.find(empty, single))
  equal('one group, one cell: found once', singleFound.map((row) => [row.kind, row.groups, row.holders]), [['single', [2], [[1, 1]]]])
  equal('...r2c2 loses 2 and 5', singleFound[0]?.eliminations, [{ row: 1, col: 1, digit: 2 }, { row: 1, col: 1, digit: 5 }])
  // Low and middle only in r1c1 and r2c2 (both can be either); the others are high.
  const pair = marksFor([[0, 0, [1, 4, 7]], [0, 1, [8, 9]], [1, 0, [7, 9]], [1, 1, [2, 5, 9]]])
  const pairFound = withConstraints(ENTROPY, () => finder.find(empty, pair))
  equal('two groups, two cells: found once', pairFound.map((row) => [row.kind, row.groups, row.holders]), [['pair', [0, 1], [[0, 0], [1, 1]]]])
  equal('...they lose their high digits', pairFound[0]?.eliminations, [{ row: 0, col: 0, digit: 7 }, { row: 1, col: 1, digit: 9 }])
  // A placed digit counts as its own group.
  const placed = createEmptyBoard()
  placed[0][0] = 1
  placed[0][1] = 2
  const withPlaced = marksFor([[1, 0, [4, 5, 9]], [1, 1, [3, 6, 7]]])
  const placedFound = withConstraints(ENTROPY, () => finder.find(placed, withPlaced))
  equal('with two lows placed, the other two share middle and high', placedFound.map((row) => row.kind), ['pair'])
  equal('...so r2c2 is not 3', placedFound[0]?.eliminations, [{ row: 1, col: 1, digit: 3 }])
  // Everything the table says, the technique reaches (applied until nothing
  // is left), and nothing more - on every pattern of four cells' groups.
  let unreached = 0
  let unsound = 0
  const digitsOf = (groups: number) => [1, 2, 3].filter(() => groups & 1).concat([4, 5, 6].filter(() => groups & 2), [7, 8, 9].filter(() => groups & 4))
  withConstraints(ENTROPY, () => {
    for (let key = 0; key < 4096; key++) {
      const sets = [key & 7, (key >> 3) & 7, (key >> 6) & 7, (key >> 9) & 7]
      const supported = entropySquareSupport(sets[0], sets[1], sets[2], sets[3])
      if (sets.includes(0) || supported < 0) continue
      const marks = marksFor(sets.map((groups, i) => [Math.floor(i / 2), i % 2, digitsOf(groups)] as [number, number, number[]]))
      for (let round = 0; round < 6; round++) {
        const rows = finder.find(empty, marks)
        if (rows.length === 0) break
        for (const row of rows) row.eliminations.forEach((e) => (marks[e.row][e.col][e.digit - 1] = false))
      }
      sets.forEach((_, i) => {
        const left = [0, 1, 2].reduce((groups, group) => groups | (marks[Math.floor(i / 2)][i % 2].slice(group * 3, group * 3 + 3).some(Boolean) ? 1 << group : 0), 0)
        const allowed = (supported >> (3 * i)) & 7
        if (left & ~allowed) unreached++
        if (allowed & ~left) unsound++
      })
    }
  })
  equal('the technique removes exactly what the table rules out', [unreached, unsound], [0, 0])
  const listed = withConstraints(ENTROPY, () =>
    buildTechniqueInstances(empty, single, 0, new Set(DEFAULT_RULE3_TECHNIQUES), false, true, true, true, false, false, false, true, new Set(), false, Infinity, false, false, givensOf(empty)),
  ).find((row) => row.id.startsWith('entropy-square'))
  check('listed as "Entropy Square" with its badge', listed?.name === 'Entropy Square' && listed.variantConstraint === 'entropy')
}

if (begin('Entropy: walking the reference puzzles')) {
  for (const [label, givens] of ENTROPY_REFERENCES) {
    setActiveConstraints(ENTROPY)
    const start = toBoard(givens)
    const solution = solver.solve(start).board!
    let board = start.map((row) => [...row])
    let candidates = autofill(board)
    let wrong = 0
    let rows = 0
    const uniqueness = new Set<string>()
    for (let step = 0; step < 400; step++) {
      const instances = buildTechniqueInstances(board, candidates, 0, new Set(DEFAULT_RULE3_TECHNIQUES), false, true, true, true, false, false, false, true, new Set(), false, Infinity, false, false, givensOf(start))
      for (const instance of instances) {
        rows++
        const effect = fullTechniqueEffect(instance)
        if (effect.eliminatedCandidates.some((e) => solution[e.row][e.col] === e.digit) || effect.solvedCandidates.some((s) => solution[s.row][s.col] !== s.digit)) wrong++
        if (/^(Unique Rectangle|Avoidable Rectangle|BUG\+|UR-AIC|Extended UR)/.test(instance.name)) uniqueness.add(instance.name)
      }
      const chosen = pickEasiestInstance(instances)
      if (!chosen) break
      const next = applyTechniqueEffect(board, candidates, fullTechniqueEffect(chosen))
      board = next.board
      candidates = next.candidates
    }
    setActiveConstraints(CLASSIC_CONSTRAINTS)
    check(`${label}: every listed row agrees with the solution (${rows} rows)`, wrong === 0, `${wrong} wrong`)
    check(`${label}: solved by the techniques`, flat(board) === flat(solution))
    equal(`${label}: no uniqueness technique listed`, [...uniqueness], [])
  }
}

if (begin('Entropy: generation, import and rating request')) {
  const random = seeded(77)
  for (let i = 0; i < 3; i++) {
    const puzzle = generateVariantPuzzle('entropy', { random })
    check(`generated puzzle ${i + 1}: made, with the rule`, puzzle !== null && puzzle.constraints.entropy === true)
    if (!puzzle) continue
    const result = withConstraints(puzzle.constraints, () => solver.solve(puzzle.board))
    equal(`generated puzzle ${i + 1}: one solution`, result.status, 'solved')
    if (result.board) equal(`generated puzzle ${i + 1}: ...valid under both checks`, [independentlyValid(result.board, {}), entropyBroken(result.board)], [null, null])
  }
  const board = toBoard(ENTROPY_REFERENCES[1][1])
  const text = serializeVariantPuzzle(board, givensOf(board), ENTROPY)
  check('Copy Original writes the rule', text.includes('"entropy":true'))
  const back = parseVariantPuzzle(text)
  check('...and reads it back', back.ok && back.constraints.entropy === true && flat(back.board) === flat(board))
  equal('no SudokuWiki string for it', serializeSudokuWikiPuzzle(board, givensOf(board), ENTROPY), null)
  equal('a Sudoku.Coach Entropy state says so', await sudokuCoachStateRules(ENTROPY_SC_STATE), { entropy: true })
  equal('plain digits say nothing', await sudokuCoachStateRules(ENTROPY_REFERENCES[0][1]), { entropy: false })
  equal('nor does a damaged state', await sudokuCoachStateRules('SCv7_32_zzzz'), { entropy: false })
  const request = variantRatingRequest(board, givensOf(board), ENTROPY)!
  equal('rating request: the Entropy adaptation, rules "e"', [request.system, request.rules], ['explainer-entropy-adaptation', 'e'])
  equal('with diagonals too', variantRatingRequest(board, givensOf(board), { ...ENTROPY, diagonals: true })!.rules, 'xe')
}

console.log(`\n${passed} checks passed, ${failed} failed.`)
process.exitCode = failed > 0 ? 1 : 0
