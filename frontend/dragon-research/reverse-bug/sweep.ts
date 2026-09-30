// Reverse BUG / Reverse BUG Lite frequency, compared with BUG+1.
// Build: npx rolldown dragon-research/reverse-bug/sweep.ts --format esm --platform node -o dragon-research/reverse-bug/.out/sweep.mjs
// Run:   node dragon-research/reverse-bug/.out/sweep.mjs <random|top1465|hard> [count] [offset]
//
// Each puzzle is solved Easy-Solve style (app default techniques, no Dynamic
// Dragon, no fish/ALS/Generic AIC), from a fresh autofill. At every state on
// the path it records whether BUG+1, Reverse BUG and Reverse BUG Lite apply
// (the Sudopedia "every solved cell" form and the "givens only" form), whether
// their eliminations are new (made by no technique the panel lists at that
// state), and checks every elimination against the true solution. A stuck
// state gets Reverse BUG's eliminations applied, to see if it rescues the path.
import fs from 'fs'
import { buildTechniqueInstances, bugPlusNFinder, fullTechniqueEffect, pickEasiestInstance, RANK_BUG_PLUS_N, RANK_SINGLE, RANK_SUBSET, type TechniqueInstance } from '../../src/techniqueEngine'
import { SudokuReverseBugFinder, type ReverseBugInstance } from '../../src/sudoku/SudokuReverseBugFinder'
import { SudokuSolver } from '../../src/sudoku/SudokuSolver'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
import type { Board, CandidateGrid } from '../../src/sudoku/types'

const corpus = process.argv[2] ?? 'random'
const count = Number(process.argv[3] ?? 100)
const offset = Number(process.argv[4] ?? 0)

let seed = 987654 + offset
// Math.imul: a plain `seed * 1103515245` loses precision past 2^53 and cycles after ~13.6k draws.
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)
const solver = new SudokuSolver()
const rb = new SudokuReverseBugFinder()

type Ref = { row: number; col: number; digit: number }
const key = (e: Ref) => `${e.digit}r${e.row + 1}c${e.col + 1}`

function parse(line: string): Board {
  return Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(line[r * 9 + c]) || 0))
}
function autofill(board: Board): CandidateGrid {
  return board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
}
function randomFullGrid(): Board {
  const g: Board = Array.from({ length: 9 }, () => Array(9).fill(0))
  const fill = (i: number): boolean => {
    if (i === 81) return true
    const r = Math.floor(i / 9), c = i % 9
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => rand() - 0.5)
    for (const d of digits) {
      if (SudokuRules.isSafe(g, r, c, d)) {
        g[r][c] = d
        if (fill(i + 1)) return true
        g[r][c] = 0
      }
    }
    return false
  }
  fill(0)
  return g
}
/** A random minimal puzzle: clues removed in random order while unique. */
function randomPuzzle(): Board {
  const g = randomFullGrid()
  const order = Array.from({ length: 81 }, (_, i) => i).sort(() => rand() - 0.5)
  for (const i of order) {
    const r = Math.floor(i / 9), c = i % 9
    const v = g[r][c]
    g[r][c] = 0
    if (!solver.solve(g).solved) g[r][c] = v
  }
  return g
}

function puzzles(): Board[] {
  if (corpus === 'random') return Array.from({ length: count }, randomPuzzle)
  const file = corpus === 'top1465' ? 'top1465.txt' : 'all-hard.txt'
  return fs.readFileSync(`dragon-research/data/${file}`, 'utf8').trim().split(/\s+/).filter((l) => l.length === 81).slice(offset, offset + count).map(parse)
}

const VARIANTS = ['rb-solved', 'rb-givens', 'lite-solved', 'lite-givens'] as const
type Variant = (typeof VARIANTS)[number]
const stat = () => ({ states: 0, puzzles: 0, degenerateStates: 0, newElims: 0, statesNew: 0, noSingles: 0, noSinglesNew: 0, basicsStuck: 0, basicsStuckNew: 0, puzzlesBasicsStuck: 0, bugTierStuck: 0, stuck: 0, rescued: 0, unsound: 0, sizes: {} as Record<number, number> })
const S: Record<Variant | 'bug+1', ReturnType<typeof stat>> = { 'bug+1': stat(), 'rb-solved': stat(), 'rb-givens': stat(), 'lite-solved': stat(), 'lite-givens': stat() }
let totalStates = 0, totalStuck = 0, solvedPuzzles = 0
const examples: string[] = []

function run(board: Board, givens: boolean[][], cands: CandidateGrid): Record<Variant, ReverseBugInstance[]> {
  return {
    'rb-solved': rb.findReverseBug(board, cands, givens, 'solved'),
    'rb-givens': rb.findReverseBug(board, cands, givens, 'givens'),
    'lite-solved': rb.findReverseBugLite(board, cands, givens, 'solved'),
    'lite-givens': rb.findReverseBugLite(board, cands, givens, 'givens'),
  }
}

const list = puzzles()
const started = Date.now()
for (const [pi, puzzle] of list.entries()) {
  const solution = solver.solve(puzzle).board
  if (!solution) continue
  const givens = puzzle.map((row) => row.map((v) => v !== 0))
  const board = puzzle.map((row) => [...row])
  const cands = autofill(board)
  const seen = new Set<string>()
  for (let step = 0; step < 250; step++) {
    if (board.every((row) => row.every((v) => v !== 0))) {
      solvedPuzzles++
      break
    }
    totalStates++
    const instances: TechniqueInstance[] = buildTechniqueInstances(board, cands, 0, undefined, true, true, true, false, false, false, false, false)
    const known = new Set<string>()
    for (const inst of instances) for (const e of fullTechniqueEffect(inst).eliminatedCandidates) known.add(key(e))
    const minRank = Math.min(...instances.map((i) => i.techniqueRank))
    const stuck = instances.length === 0
    if (stuck) totalStuck++

    // BUG+1 only (the finder is BUG+N now).
    const bug = bugPlusNFinder.find(board, cands)?.n === 1
    if (bug) {
      S['bug+1'].states++
      seen.add('bug+1')
      if (minRank > RANK_SINGLE) S['bug+1'].noSingles++
      if (minRank > RANK_SUBSET) S['bug+1'].basicsStuck++
      if (minRank > RANK_SUBSET) seen.add('bug+1@basics')
    }
    const found = run(board, givens, cands)
    for (const v of VARIANTS) {
      // Size 8 (Lite: 8 positions) is degenerate: the complement would be one
      // row+column+box holding two cells, which no grid has - pure counting
      // logic, no uniqueness. Counted apart, left out of everything else.
      const hits = found[v].filter((h) => h.size < 8)
      const s = S[v]
      if (found[v].length > hits.length) s.degenerateStates++
      if (hits.length === 0) continue
      s.states++
      seen.add(v)
      const newOnes = new Set(hits.map((h) => key(h.eliminated)).filter((k) => !known.has(k)))
      s.newElims += newOnes.size
      if (newOnes.size > 0) s.statesNew++
      if (minRank > RANK_SINGLE) s.noSingles++
      if (minRank > RANK_SINGLE && newOnes.size > 0) s.noSinglesNew++
      if (minRank > RANK_SUBSET) s.basicsStuck++
      if (minRank > RANK_SUBSET && newOnes.size > 0) s.basicsStuckNew++
      if (minRank > RANK_SUBSET) seen.add(v + '@basics')
      if (minRank > RANK_BUG_PLUS_N) s.bugTierStuck++
      if (stuck) s.stuck++
      for (const h of hits) {
        s.sizes[h.size] = (s.sizes[h.size] ?? 0) + 1
        if (solution[h.eliminated.row][h.eliminated.col] === h.eliminated.digit) s.unsound++
      }
      if (examples.length < 12 && (v === 'rb-solved' || v === 'rb-givens') && newOnes.size > 0 && minRank > RANK_SUBSET) {
        examples.push(`${v} ${puzzle.flat().join('')} step ${step}: ${hits.map((h) => `${key(h.eliminated)} [${h.digits}] n=${h.size}`).join(', ')}`)
      }
    }

    if (stuck) {
      // Would Reverse BUG (givens form, the stronger one) get the path going?
      const rescue = [...found['rb-givens'], ...found['lite-givens']].filter((h) => h.size < 8)
      if (rescue.length === 0) break
      for (const h of rescue) cands[h.eliminated.row][h.eliminated.col][h.eliminated.digit - 1] = false
      if (found['rb-givens'].some((h) => h.size < 8)) S['rb-givens'].rescued++
      else S['lite-givens'].rescued++
      continue
    }
    const pick = pickEasiestInstance(instances)!
    const effect = fullTechniqueEffect(pick)
    for (const e of effect.eliminatedCandidates) cands[e.row][e.col][e.digit - 1] = false
    for (const s of effect.solvedCandidates) {
      if (board[s.row][s.col] !== 0) continue
      board[s.row][s.col] = s.digit
      cands[s.row][s.col] = Array(9).fill(false)
      SudokuRules.eliminatePeerCandidates(cands, board, s.row, s.col, s.digit)
    }
  }
  for (const v of seen) {
    if (v.endsWith('@basics')) S[v.slice(0, -7) as Variant].puzzlesBasicsStuck++
    else S[v as Variant].puzzles++
  }
  if ((pi + 1) % 25 === 0) console.error(`${corpus} ${pi + 1}/${list.length} ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

console.log(JSON.stringify({ corpus, count: list.length, offset, solvedPuzzles, totalStates, totalStuck, stats: S, examples }, null, 1))
