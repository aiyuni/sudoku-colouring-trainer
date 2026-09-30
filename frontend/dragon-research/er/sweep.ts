// Empty Rectangle / named single-digit AIC verification sweep.
// Build: npx rolldown dragon-research/er/sweep.ts --format esm --platform node -o dragon-research/er/.out/sweep.mjs
// Run:   node dragon-research/er/.out/sweep.mjs [puzzleCount] [statesPerPuzzle]
//
// States: every puzzle of all-hard.txt, autofilled, then random candidates
// removed that are not the puzzle's solution digit (so every state stays
// consistent with the one true solution, like a real mid-solve grid).
// Per state it checks:
//  1. soundness - no single-digit AIC / Empty Rectangle eliminates a solution digit
//  2. Empty Rectangle (findEmptyRectangles) and Rectangle Elimination
//     (findRectangleEliminations) find exactly the same eliminations, for
//     boxes of 3+ and of 2+ candidates
//  3. naming - our Skyscraper/Kite/Crane name for every chain equals the first
//     of Sudoku.Coach's own three algorithms (ported below) that finds it
// (A one-off before/after run against the pre-Empty-Rectangle finder, 2026-09-30,
// 19,218 states: no elimination set lost, the only new sets Empty Rectangles,
// and the only single-digit/general changes old Short AIC sets now reached by
// a shorter Empty Rectangle.)
import fs from 'fs'
import { SudokuSolver } from '../../src/sudoku/SudokuSolver'
import {
  SudokuShortAicFinder,
  classifyShortAic,
  findEmptyRectangles,
  findRectangleEliminations,
  nameSingleDigitChain,
  type AicCandidate,
  type ShortAicInstance,
} from '../../src/sudoku/SudokuShortAicFinder'

const puzzleCount = Number(process.argv[2] ?? 400)
const statesPerPuzzle = Number(process.argv[3] ?? 6)
const puzzles = fs.readFileSync('dragon-research/data/all-hard.txt', 'utf8').trim().split(/\s+/).filter((l) => l.length === 81).slice(0, puzzleCount)

let seed = 12345
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

type Cell = readonly [number, number]
const box = (r: number, c: number) => Math.floor(r / 3) * 3 + Math.floor(c / 3)
const key = (e: { row: number; col: number; digit: number }) => `${e.digit}r${e.row + 1}c${e.col + 1}`

// ---- Sudoku.Coach's Skyscraper / Two-String Kite / Crane, ported from its
// solver code: each returns chains [A, B, C, D] (A = B - C = D). -------------
function coachChains(board: number[][], cand: boolean[][][], d: number) {
  const has = (r: number, c: number) => board[r][c] === 0 && cand[r][c][d - 1]
  const lineCells = (kind: 'row' | 'col', i: number): Cell[] =>
    Array.from({ length: 9 }, (_, j) => (kind === 'row' ? [i, j] : [j, i]) as Cell).filter(([r, c]) => has(r, c))
  const boxCells = (b: number): Cell[] => {
    const out: Cell[] = []
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (box(r, c) === b && has(r, c)) out.push([r, c])
    return out
  }
  const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1]
  const sky: Cell[][] = [], kite: Cell[][] = [], crane: Cell[][] = []
  // Skyscraper: base line (rows, then columns), two of its cells, each the
  // end of a pair in its perpendicular line, neither pair within one box.
  for (const [baseKind, perp] of [['row', 'col'], ['col', 'row']] as const) {
    for (let i = 0; i < 9; i++) {
      const base = lineCells(baseKind, i)
      for (let x = 0; x < base.length; x++) for (let y = x + 1; y < base.length; y++) {
        const p0 = base[x], p1 = base[y]
        const o0 = lineCells(perp, perp === 'col' ? p0[1] : p0[0]).filter((c) => !same(c, p0))
        const o1 = lineCells(perp, perp === 'col' ? p1[1] : p1[0]).filter((c) => !same(c, p1))
        if (o0.length !== 1 || o1.length !== 1) continue
        if (box(...p0) === box(...o0[0]) || box(...p1) === box(...o1[0])) continue
        sky.push([o0[0], p0, p1, o1[0]])
      }
    }
  }
  // Two-String Kite: a column pair and a row pair meeting in one box.
  for (let ci = 0; ci < 9; ci++) {
    const col = lineCells('col', ci)
    if (col.length !== 2) continue
    for (let ri = 0; ri < 9; ri++) {
      const row = lineCells('row', ri)
      if (row.length !== 2) continue
      for (const ov of col) {
        const b = box(...ov)
        const inBoxRow = row.filter((c) => box(...c) === b)
        if (inBoxRow.length !== 1) continue
        const ow = inBoxRow[0]
        if (same(ov, ow) || col.filter((c) => box(...c) === b).length === 2) continue
        const ox = col.find((c) => !same(c, ov))!, oy = row.find((c) => !same(c, ow))!
        kite.push([ox, ov, ow, oy])
      }
    }
  }
  // Crane: a column and a row crossing on a candidate; one is a pair (the
  // strong line), along the other (the weak line) a cell whose box has the
  // digit twice and meets the weak line only there.
  for (let ci = 0; ci < 9; ci++) for (let ri = 0; ri < 9; ri++) {
    const col = lineCells('col', ci), row = lineCells('row', ri)
    const inter = col.filter((c) => row.some((r) => same(r, c)))
    if (inter.length !== 1) continue
    const X = inter[0]
    for (const [strong, weak] of [[col, row], [row, col]]) {
      if (strong.length !== 2) continue
      for (const Y of weak.filter((c) => !same(c, X))) {
        const b = box(...Y)
        if (weak.filter((c) => box(...c) === b).length !== 1) continue
        const bc = boxCells(b)
        if (bc.length !== 2) continue
        const p1 = strong.find((c) => !same(c, X))!, p2 = bc.find((c) => !same(c, Y))!
        crane.push([p1, X, Y, p2])
      }
    }
  }
  return { sky, kite, crane }
}

const chainId = (cells: readonly Cell[]) => {
  const f = cells.map(([r, c]) => `${r}${c}`).join('-'), b = [...cells].reverse().map(([r, c]) => `${r}${c}`).join('-')
  return f < b ? f : b
}

const solver = new SudokuSolver()
const now = new SudokuShortAicFinder()
const stats = { states: 0, unsound: 0, erReMismatch: 0, erReMismatch2: 0, nameMismatch: 0, erCount: 0, reCount: 0 }
const named: Record<string, number> = {}
const coachFound: Record<string, number> = {}
let shown = 0
const t0 = Date.now()
let erMs = 0, newMs = 0

for (const p of puzzles) {
  const board = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(p[r * 9 + c])))
  const res = solver.solve(board) as any
  const solution: number[][] | undefined = res.solution ?? res.board
  if (!solution) continue
  for (let s = 0; s < statesPerPuzzle; s++) {
    // Autofill, then drop a random share of the non-solution candidates.
    const dropRate = 0.15 + 0.6 * rand()
    const cand = board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, i) => {
      if (v !== 0) return false
      const d = i + 1
      for (let j = 0; j < 9; j++) if (board[r][j] === d || board[j][c] === d) return false
      const br = r - (r % 3), bc = c - (c % 3)
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (board[br + a][bc + b] === d) return false
      return d === solution[r][c] || rand() > dropRate
    })))
    stats.states++

    let t = performance.now()
    const aics: ShortAicInstance[] = now.findShortAics(board, cand)
    newMs += performance.now() - t

    // 1. soundness
    for (const a of aics) if (classifyShortAic(a) === 'single-digit') for (const e of a.eliminations) if (solution[e.row][e.col] === e.digit) {
      stats.unsound++
      if (shown++ < 5) console.log('UNSOUND', a.pattern, a.nodes.map(key).join(' '), key(e))
    }

    // 2. ER vs RE
    for (const minBox of [3, 2]) {
      t = performance.now()
      const er = findEmptyRectangles(board, cand, undefined, minBox)
      if (minBox === 3) erMs += performance.now() - t
      const re = findRectangleEliminations(board, cand, minBox)
      const erSet = new Set(er.flatMap((a) => a.eliminations.map(key))), reSet = new Set(re.map((x) => key(x.elimination)))
      if (minBox === 3) { stats.erCount += er.length; stats.reCount += re.length }
      if (erSet.size !== reSet.size || [...erSet].some((k) => !reSet.has(k))) {
        if (minBox === 3) stats.erReMismatch++; else stats.erReMismatch2++
        if (shown++ < 5) console.log('ER/RE MISMATCH', minBox, [...erSet].sort().join(','), '|', [...reSet].sort().join(','))
      }
      if (minBox === 3) for (const e of er.flatMap((a) => a.eliminations)) if (solution[e.row][e.col] === e.digit) stats.unsound++
    }

    // 3. naming vs Sudoku.Coach
    for (let d = 1; d <= 9; d++) {
      const coach = coachChains(board, cand, d)
      const coachName = new Map<string, string>()
      for (const [name, list] of [['Skyscraper', coach.sky], ['Two-String Kite', coach.kite], ['Crane', coach.crane]] as const)
        for (const cells of list) if (!coachName.has(chainId(cells))) coachName.set(chainId(cells), name)
      for (const [id, name] of coachName) {
        const cells = id.split('-').map((x) => [Number(x[0]), Number(x[1])] as Cell)
        const nodes: AicCandidate[] = cells.map(([row, col]) => ({ row, col, digit: d }))
        const ours = nameSingleDigitChain(board, cand, nodes)
        coachFound[name] = (coachFound[name] ?? 0) + 1
        if (ours !== name) { stats.nameMismatch++; if (shown++ < 10) console.log('NAME coach', name, 'ours', ours, cells.map(([r, c]) => `r${r + 1}c${c + 1}`).join(' ')) }
      }
      for (const a of aics) {
        if (classifyShortAic(a) !== 'single-digit' || a.nodes[0].digit !== d || a.pattern === 'Empty Rectangle') continue
        const cn = coachName.get(chainId(a.nodes.map((n) => [n.row, n.col] as Cell))) ?? null
        if ((a.pattern ?? null) !== cn) { stats.nameMismatch++; if (shown++ < 10) console.log('NAME ours', a.pattern, 'coach', cn, a.nodes.map(key).join(' ')) }
      }
    }
    for (const a of aics) if (classifyShortAic(a) === 'single-digit') named[a.pattern ?? '(unnamed)'] = (named[a.pattern ?? '(unnamed)'] ?? 0) + 1

  }
}
console.log(stats)
console.log('named single-digit rows:', named)
console.log('coach chains checked:', coachFound)
console.log(`findShortAics ${newMs.toFixed(0)}ms; findEmptyRectangles alone ${erMs.toFixed(0)}ms; total ${((Date.now() - t0) / 1000).toFixed(1)}s`)
