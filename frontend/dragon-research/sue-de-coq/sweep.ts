// Sue-de-Coq (basic variant): soundness and frequency.
// Build: npx rolldown dragon-research/sue-de-coq/sweep.ts --format esm --platform node -o dragon-research/sue-de-coq/.out/sweep.mjs
// Run:   node dragon-research/sue-de-coq/.out/sweep.mjs <top1465|hard> [count] [offset]
//
// Each puzzle is solved Easy-Solve style with the app's engine (every fish,
// all AICs and ALS-xz on, Sue-de-Coq on, Dynamic Dragon off for speed). At
// every state every Sue-de-Coq elimination is checked against the true
// solution, and also on a random candidate grid that keeps every true
// candidate (the finder's logic only needs the solution's digits to be
// candidates). It counts states where a Sue-de-Coq row survives the panel's
// "covered by easier" filter, and where nothing below Sue-de-Coq applies.
import fs from 'fs'
import { buildTechniqueInstances, fullTechniqueEffect, pickEasiestInstance, RANK_SUE_DE_COQ, sueDeCoqFinder } from '../../src/techniqueEngine'
import type { FishTechnique } from '../../src/sudoku/SudokuFishFinder'
import { SudokuSolver } from '../../src/sudoku/SudokuSolver'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
import type { Board, CandidateGrid } from '../../src/sudoku/types'

const corpus = process.argv[2] ?? 'top1465'
const count = Number(process.argv[3] ?? 100)
const offset = Number(process.argv[4] ?? 0)
let seed = 777 + offset
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)
const solver = new SudokuSolver()
const parse = (line: string): Board => Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(line[r * 9 + c]) || 0))
const autofill = (board: Board): CandidateGrid =>
  board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
const FISH = new Set<FishTechnique>(['x-wing', 'finned x-wing', 'swordfish', 'finned swordfish'])
const EXOTIC = new Set(['sue de coq'] as const)

const list = fs.readFileSync(`dragon-research/data/${corpus === 'top1465' ? 'top1465.txt' : 'all-hard.txt'}`, 'utf8').trim().split(/\s+/).filter((l) => l.length === 81).slice(offset, offset + count).map(parse)
const S = { states: 0, found: 0, elims: 0, unsound: 0, randomFound: 0, randomElims: 0, randomUnsound: 0, shown: 0, easiest: 0, puzzlesShown: 0, solved: 0 }
const examples: object[] = []
const started = Date.now()
for (const [pi, puzzle] of list.entries()) {
  const solution = solver.solve(puzzle).board
  if (!solution) continue
  const board = puzzle.map((row) => [...row])
  const cands = autofill(board)
  let shownHere = false
  for (let step = 0; step < 250; step++) {
    if (board.every((row) => row.every((v) => v !== 0))) { S.solved++; break }
    S.states++
    for (const s of sueDeCoqFinder.find(board, cands)) {
      S.found++
      S.elims += s.eliminations.length
      for (const e of s.eliminations) if (solution[e.row][e.col] === e.digit) S.unsound++
    }
    const randomCands = cands.map((row, r) => row.map((cell, c) => cell.map((on, d) => on && (solution[r][c] === d + 1 || rand() < 0.6))))
    for (const s of sueDeCoqFinder.find(board, randomCands)) {
      S.randomFound++
      S.randomElims += s.eliminations.length
      for (const e of s.eliminations) if (solution[e.row][e.col] === e.digit) S.randomUnsound++
    }
    const instances = buildTechniqueInstances(board, cands, 0, undefined, true, true, true, false, true, false, false, false, FISH, true, Infinity, true, false, null, EXOTIC)
    if (instances.length === 0) break
    const sdc = instances.filter((i) => i.techniqueRank === RANK_SUE_DE_COQ)
    if (sdc.length > 0) {
      S.shown++
      shownHere = true
      const easiest = pickEasiestInstance(instances)!
      if (examples.length < 4) examples.push({ position: board.flat().join(""), notation: sdc[0].notation })
      if (easiest.techniqueRank === RANK_SUE_DE_COQ) {
        S.easiest++
        if (examples.length < 10) examples.push({ position: board.flat().join(''), notation: easiest.notation })
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
  if (shownHere) S.puzzlesShown++
  if ((pi + 1) % 25 === 0) console.error(`${corpus} ${pi + 1}/${list.length} ${((Date.now() - started) / 1000).toFixed(0)}s`)
}
console.log(JSON.stringify({ corpus, count: list.length, offset, ...S, examples }, null, 1))
