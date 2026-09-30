// Avoidable Rectangle (Types 1 and 2): soundness, frequency, lesson positions,
// and the Double Dynamic Dragon stock.
// Build: npx rolldown dragon-research/avoidable-rectangle/sweep.ts --format esm --platform node -o dragon-research/avoidable-rectangle/.out/sweep.mjs
// Run:   node dragon-research/avoidable-rectangle/.out/sweep.mjs <random|top1465|hard|stock> [count] [offset]
//
// Each puzzle is solved Easy-Solve style with the app's engine (default
// techniques, the real givens passed in, so Avoidable Rectangles are on the
// path; Dynamic Dragon off for speed). At every state it checks every
// Avoidable Rectangle elimination against the true solution and counts how
// often each type applies - and applies with nothing easier available. Where
// nothing below Dragon applies it also runs Dynamic Dragon with Avoidable
// Rectangle allowed (plus the defaults), checking every elimination/placement.
// Lesson candidates: positions where, on a fresh autofill (what a tutorial
// board string gives), an Avoidable Rectangle is the easiest technique.
// 'stock': whether one applies at any DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK
// entry (the only stock with solved non-given cells).
import fs from 'fs'
import {
  avoidableRectangleFinder,
  buildTechniqueInstances,
  computeStuckDynamicDragonExtensions,
  fullTechniqueEffect,
  pickEasiestInstance,
  RANK_AVOIDABLE_RECTANGLE,
  RANK_DRAGON,
  RANK_SUBSET,
} from '../../src/techniqueEngine'
import { DEFAULT_RULE3_TECHNIQUES, type Rule3Technique } from '../../src/sudoku/SudokuDragonFinder'
import { foldDragonMoves } from '../../src/sudoku/dragonReplay'
import { DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK } from '../../src/sudoku/doubleDynamicDragonPuzzleStockData'
import { PuzzleImporter } from '../../src/sudoku/PuzzleImporter'
import { SudokuSolver } from '../../src/sudoku/SudokuSolver'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
import type { Board, CandidateGrid } from '../../src/sudoku/types'

const corpus = process.argv[2] ?? 'random'
const count = Number(process.argv[3] ?? 100)
const offset = Number(process.argv[4] ?? 0)

let seed = 424242 + offset
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)
const solver = new SudokuSolver()
const key = (e: { row: number; col: number; digit: number }) => `${e.digit}r${e.row + 1}c${e.col + 1}`
const parse = (line: string): Board => Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(line[r * 9 + c]) || 0))
const autofill = (board: Board): CandidateGrid =>
  board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
const WITH_AR = new Set<Rule3Technique>([...DEFAULT_RULE3_TECHNIQUES, 'avoidable rectangle'])

function randomPuzzle(): Board {
  const g: Board = Array.from({ length: 9 }, () => Array(9).fill(0))
  const fill = (i: number): boolean => {
    if (i === 81) return true
    const r = Math.floor(i / 9), c = i % 9
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => rand() - 0.5)) {
      if (SudokuRules.isSafe(g, r, c, d)) {
        g[r][c] = d
        if (fill(i + 1)) return true
        g[r][c] = 0
      }
    }
    return false
  }
  fill(0)
  for (const i of Array.from({ length: 81 }, (_, i) => i).sort(() => rand() - 0.5)) {
    const r = Math.floor(i / 9), c = i % 9
    const v = g[r][c]
    g[r][c] = 0
    if (!solver.solve(g).solved) g[r][c] = v
  }
  return g
}

async function stockCheck() {
  const importer = new PuzzleImporter()
  let hits = 0
  for (const [i, entry] of DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK.entries()) {
    const imported = await importer.import(entry)
    if (!imported.ok) {
      console.log(`entry ${i}: import failed`)
      continue
    }
    const found = avoidableRectangleFinder.find(imported.board, imported.candidates, imported.givens)
    const solvedNonGiven = imported.board.flat().filter((v, k) => v !== 0 && !imported.givens[Math.floor(k / 9)][k % 9]).length
    if (found.length > 0) hits++
    console.log(`entry ${i}: ${solvedNonGiven} solved non-givens, ${found.length} avoidable rectangles ${found.map((f) => `T${f.type} ${f.eliminations.map(key)}`).join('; ')}`)
  }
  console.log(`stock entries with an Avoidable Rectangle: ${hits}/${DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK.length}`)
}

function sweep() {
  const list =
    corpus === 'random'
      ? Array.from({ length: count }, randomPuzzle)
      : fs.readFileSync(`dragon-research/data/${corpus === 'top1465' ? 'top1465.txt' : 'all-hard.txt'}`, 'utf8').trim().split(/\s+/).filter((l) => l.length === 81).slice(offset, offset + count).map(parse)
  const stat = () => ({ states: 0, puzzles: 0, basicsStuck: 0, easiest: 0, elims: 0, unsound: 0 })
  const S = { 1: stat(), 2: stat() }
  const dyn = { runs: 0, chainsWithAr: 0, unsound: 0 }
  let totalStates = 0, solved = 0
  const lessons: object[] = []
  const started = Date.now()
  for (const [pi, puzzle] of list.entries()) {
    const solution = solver.solve(puzzle).board
    if (!solution) continue
    const givens = puzzle.map((row) => row.map((v) => v !== 0))
    const clues = puzzle.flat().join('')
    const board = puzzle.map((row) => [...row])
    const cands = autofill(board)
    const seen = new Set<number>()
    for (let step = 0; step < 250; step++) {
      if (board.every((row) => row.every((v) => v !== 0))) {
        solved++
        break
      }
      totalStates++
      const instances = buildTechniqueInstances(board, cands, 0, undefined, true, true, true, false, false, false, false, false, undefined, false, Infinity, false, false, givens)
      if (instances.length === 0) break
      const nonAr = instances.filter((i) => !i.id.startsWith('avoidable-rectangle-'))
      const minOther = Math.min(...nonAr.map((i) => i.techniqueRank))
      for (const ar of avoidableRectangleFinder.find(board, cands, givens)) {
        const s = S[ar.type]
        s.elims += ar.eliminations.length
        for (const e of ar.eliminations) if (solution[e.row][e.col] === e.digit) s.unsound++
      }
      for (const type of [1, 2] as const) {
        if (!instances.some((i) => i.id.startsWith(`avoidable-rectangle-${type}-`))) continue
        const s = S[type]
        s.states++
        seen.add(type)
        if (minOther > RANK_SUBSET) s.basicsStuck++
        if (minOther > RANK_AVOIDABLE_RECTANGLE) s.easiest++
      }
      // Lesson candidates: an Avoidable Rectangle is the easiest technique on
      // a fresh autofill of this position.
      if (lessons.length < 40) {
        const fresh = autofill(board)
        const found = avoidableRectangleFinder.find(board, fresh, givens)
        if (found.length > 0) {
          const freshInstances = buildTechniqueInstances(board, fresh, 0, undefined, true, true, true, false, false, false, false, false, undefined, false, Infinity, false, false, givens)
          const easiest = pickEasiestInstance(freshInstances)
          if (easiest && easiest.techniqueRank === RANK_AVOIDABLE_RECTANGLE) {
            for (const ar of found) {
              lessons.push({
                type: ar.type,
                position: board.flat().join(''),
                clues,
                solvedNonGivens: board.flat().filter((v, k) => v !== 0 && !givens[Math.floor(k / 9)][k % 9]).length,
                cells: ar.cells.map(([r, c]) => `r${r + 1}c${c + 1}`).join(' '),
                eliminations: ar.eliminations.map(key).join(' '),
                reason: ar.reasonText,
              })
            }
          }
        }
      }
      // Dynamic Dragon with Avoidable Rectangle allowed, where only Dragon is left.
      if (minOther >= RANK_DRAGON && dyn.runs < 400) {
        dyn.runs++
        for (const { moves } of computeStuckDynamicDragonExtensions(board, cands, 'any', 0, WITH_AR, true, false, false, false, Infinity, givens)) {
          if (moves.some((m) => (m.substeps ?? []).some((s) => s.technique === 'avoidable rectangle'))) dyn.chainsWithAr++
          const fold = foldDragonMoves(moves, moves.length - 1)
          if (fold.eliminatedCandidates.some((e) => solution[e.row][e.col] === e.digit) || fold.solvedCandidates.some((s) => solution[s.row][s.col] !== s.digit)) dyn.unsound++
        }
      }
      const effect = fullTechniqueEffect(pickEasiestInstance(instances)!)
      for (const e of effect.eliminatedCandidates) cands[e.row][e.col][e.digit - 1] = false
      for (const s of effect.solvedCandidates) {
        if (board[s.row][s.col] !== 0) continue
        board[s.row][s.col] = s.digit
        cands[s.row][s.col] = Array(9).fill(false)
        SudokuRules.eliminatePeerCandidates(cands, board, s.row, s.col, s.digit)
      }
    }
    for (const t of seen) S[t as 1 | 2].puzzles++
    if ((pi + 1) % 25 === 0) console.error(`${corpus} ${pi + 1}/${list.length} ${((Date.now() - started) / 1000).toFixed(0)}s`)
  }
  console.log(JSON.stringify({ corpus, count: list.length, offset, solved, totalStates, types: S, dynamic: dyn, lessons }, null, 1))
}

if (corpus === 'stock') {
  await stockCheck()
} else {
  sweep()
}
