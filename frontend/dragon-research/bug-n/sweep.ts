// BUG+N (BUG+1/2/3): soundness, frequency and lesson positions.
// Build: npx rolldown dragon-research/bug-n/sweep.ts --format esm --platform node -o dragon-research/bug-n/.out/sweep.mjs
// Run:   node dragon-research/bug-n/.out/sweep.mjs [maxPuzzles]
//
// Solves top1465 + all-hard Easy-Solve style (app engine, Dynamic Dragon off
// for speed). At every state it runs the BUG+N finder and checks every
// placement/elimination against the true solution. It also checks the
// looser rule "any digit ALL the tri-value cells share goes from cells that
// see them all" (shared candidate, not the BUG digit) to show whether that
// shortcut is sound. Lesson candidates: states where a BUG+2/BUG+3 is the
// easiest technique, printed with the removed-marks string decodePuzzleState
// needs (fewest removed marks first is best for a lesson).
import fs from 'fs'
import { buildTechniqueInstances, bugPlusNFinder, fullTechniqueEffect, pickEasiestInstance, RANK_BUG_PLUS_N } from '../../src/techniqueEngine'
import { SudokuSolver } from '../../src/sudoku/SudokuSolver'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
import type { Board, CandidateGrid } from '../../src/sudoku/types'

const max = Number(process.argv[2] ?? 100000)
const parse = (line: string): Board => Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(line[r * 9 + c]) || 0))
const autofill = (board: Board): CandidateGrid =>
  board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
const sees = (a: number[], b: number[]) => a[0] === b[0] || a[1] === b[1] || (Math.floor(a[0] / 3) === Math.floor(b[0] / 3) && Math.floor(a[1] / 3) === Math.floor(b[1] / 3))
const lines = ['top1465.txt', 'all-hard.txt'].flatMap((f) => fs.readFileSync(`dragon-research/data/${f}`, 'utf8').trim().split(/\s+/).filter((l) => l.length === 81)).slice(0, max)

const stats = { puzzles: 0, states: 0, n1: 0, n2: 0, n3: 0, wrong1: 0, wrong2: 0, wrong3: 0, easiest2: 0, easiest3: 0, looseRuleWrong: 0, looseRuleExtra: 0, noElimTri: 0 }
const lessons: string[] = []
const solver = new SudokuSolver()
for (const line of lines) {
  stats.puzzles++
  const puzzle = parse(line)
  const solved = solver.solve(puzzle)
  if (solved.status !== 'solved') continue
  const solution = solved.board
  const givens = puzzle.map((row) => row.map((v) => v !== 0))
  const board = puzzle.map((row) => [...row])
  const cands = autofill(board)
  for (let step = 0; step < 250; step++) {
    stats.states++
    const bug = bugPlusNFinder.find(board, cands)
    if (bug) {
      stats[`n${bug.n}` as 'n1'] += 1
      const wrongKey = `wrong${bug.n}` as 'wrong1'
      if (bug.solved && solution[bug.solved.row][bug.solved.col] !== bug.solved.digit) stats[wrongKey]++
      for (const e of bug.eliminations) if (solution[e.row][e.col] === e.digit) stats[wrongKey]++
      if (bug.n >= 2) {
        // The loose rule: digits in every tri-value cell, eliminated from cells seeing them all.
        const shared = bug.cells[0].candidates.filter((d) => bug.cells.every((c) => c.candidates.includes(d)))
        for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
          if (board[r][c] !== 0 || bug.cells.some(({ cell }) => cell[0] === r && cell[1] === c)) continue
          if (!bug.cells.every(({ cell }) => sees([r, c], [...cell]))) continue
          for (const d of shared) {
            if (!cands[r][c][d - 1]) continue
            if (!bug.eliminations.some((e) => e.row === r && e.col === c && e.digit === d)) stats.looseRuleExtra++
            if (solution[r][c] === d) stats.looseRuleWrong++
          }
        }
      }
    }
    const instances = buildTechniqueInstances(board, cands, 0, undefined, true, true, true, false, false, false, false, false, undefined, false, Infinity, false, false, givens)
    if (instances.length === 0) break
    if (bug && bug.n >= 2) {
      const minOther = Math.min(...instances.filter((i) => !i.id.startsWith('bug-plus-n-')).map((i) => i.techniqueRank))
      if (minOther > RANK_BUG_PLUS_N) {
        stats[bug.n === 2 ? 'easiest2' : 'easiest3']++
        const fresh = autofill(board)
        const removed: string[] = []
        for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let d = 0; d < 9; d++) if (fresh[r][c][d] && !cands[r][c][d]) removed.push(`r${r + 1}c${c + 1}-${d + 1}`)
        lessons.push(JSON.stringify({
          n: bug.n,
          removedCount: removed.length,
          position: board.flat().join(''),
          removed: removed.join(' '),
          cells: bug.cells.map(({ cell: [r, c], candidates, bugDigit }) => `r${r + 1}c${c + 1}{${candidates.join('')}}:${bugDigit}`).join(' '),
          eliminations: bug.eliminations.map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`).join(' '),
        }))
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
  if (stats.puzzles % 200 === 0) console.error(JSON.stringify(stats))
}
fs.mkdirSync('dragon-research/bug-n/.out', { recursive: true })
fs.writeFileSync('dragon-research/bug-n/.out/lessons.jsonl', lessons.join('\n'))
console.log(JSON.stringify(stats))
