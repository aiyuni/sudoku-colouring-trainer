// W-Wing: soundness and naming.
// Build: npx rolldown dragon-research/w-wing/sweep.ts --format esm --platform node -o dragon-research/w-wing/.out/sweep.mjs
// Run:   node dragon-research/w-wing/.out/sweep.mjs <top1465|hard> [count] [offset]
//
// Each puzzle is solved Easy-Solve style with the app's engine. At every
// state every W-Wing elimination is checked against the true solution, also
// on a random candidate grid that keeps every true candidate. It also counts
// unnamed Short AICs that have a W-Wing's shape (E(A) = L(A) - L(P) = L(Q) -
// L(B) = E(B), A and B holding only {L,E}) - there should be none - and
// W-Wing rows shown in the Techniques list.
import fs from 'fs'
import { buildTechniqueInstances, fullTechniqueEffect, pickEasiestInstance, shortAicFinder } from '../../src/techniqueEngine'
import { findWWings, type ShortAicInstance } from '../../src/sudoku/SudokuShortAicFinder'
import type { FishTechnique } from '../../src/sudoku/SudokuFishFinder'
import { SudokuSolver } from '../../src/sudoku/SudokuSolver'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
import type { Board, CandidateGrid } from '../../src/sudoku/types'

const corpus = process.argv[2] ?? 'top1465'
const count = Number(process.argv[3] ?? 100)
const offset = Number(process.argv[4] ?? 0)
let seed = 4242 + offset
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)
const solver = new SudokuSolver()
const parse = (line: string): Board => Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(line[r * 9 + c]) || 0))
const autofill = (board: Board): CandidateGrid =>
  board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
const FISH = new Set<FishTechnique>()
const isWWingShaped = (a: ShortAicInstance, cands: CandidateGrid) => {
  if (a.length !== 5 || a.nodes.some((n) => n.cells)) return false
  const [n0, n1, n2, n3, n4, n5] = a.nodes
  const pair = (n: typeof n0) => cands[n.row][n.col].filter(Boolean).length === 2
  return n0.row === n1.row && n0.col === n1.col && n4.row === n5.row && n4.col === n5.col && n0.digit === n5.digit &&
    n1.digit === n2.digit && n2.digit === n3.digit && n3.digit === n4.digit && pair(n0) && pair(n5)
}

const list = fs.readFileSync(`dragon-research/data/${corpus === 'top1465' ? 'top1465.txt' : 'all-hard.txt'}`, 'utf8').trim().split(/\s+/).filter((l) => l.length === 81).slice(offset, offset + count).map(parse)
const S = { states: 0, found: 0, grouped: 0, elims: 0, unsound: 0, randomFound: 0, randomElims: 0, randomUnsound: 0, unnamedWWingShaped: 0, shown: 0, easiest: 0, solved: 0 }
const examples: object[] = []
for (const puzzle of list) {
  const solution = solver.solve(puzzle).board
  if (!solution) continue
  const board = puzzle.map((row) => [...row])
  const cands = autofill(board)
  for (let step = 0; step < 250; step++) {
    if (board.every((row) => row.every((v) => v !== 0))) { S.solved++; break }
    S.states++
    for (const w of findWWings(board, cands)) {
      S.found++
      if (w.nodes.some((n) => n.cells)) S.grouped++
      S.elims += w.eliminations.length
      for (const e of w.eliminations) if (solution[e.row][e.col] === e.digit) S.unsound++
    }
    const randomCands = cands.map((row, r) => row.map((cell, c) => cell.map((on, d) => on && (solution[r][c] === d + 1 || rand() < 0.6))))
    for (const w of findWWings(board, randomCands)) {
      S.randomFound++
      S.randomElims += w.eliminations.length
      for (const e of w.eliminations) if (solution[e.row][e.col] === e.digit) S.randomUnsound++
    }
    for (const a of shortAicFinder.findShortAics(board, cands)) if (!a.pattern && isWWingShaped(a, cands)) S.unnamedWWingShaped++
    const instances = buildTechniqueInstances(board, cands, 0, undefined, true, true, true, false, true, false, false, false, FISH, true, Infinity, true, false, null, new Set())
    if (instances.length === 0) break
    const ww = instances.filter((i) => i.aicPattern === 'W-Wing')
    if (ww.length > 0) {
      S.shown++
      if (examples.length < 3) examples.push({ position: board.flat().join(''), name: ww[0].name, notation: ww[0].notation })
    }
    const easiest = pickEasiestInstance(instances)!
    if (easiest.aicPattern === 'W-Wing') S.easiest++
    const effect = fullTechniqueEffect(easiest)
    for (const e of effect.eliminatedCandidates) cands[e.row][e.col][e.digit - 1] = false
    for (const s of effect.solvedCandidates) {
      if (board[s.row][s.col] !== 0) continue
      board[s.row][s.col] = s.digit
      cands[s.row][s.col] = Array(9).fill(false)
      SudokuRules.eliminatePeerCandidates(cands, board, s.row, s.col, s.digit)
    }
  }
}
console.log(JSON.stringify({ corpus, count: list.length, offset, ...S, examples }, null, 1))
