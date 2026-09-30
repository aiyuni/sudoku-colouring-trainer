// Verifies Double Dynamic stock candidates through the app's own engine, all settings maxed out.
import fs from 'fs'
import { Worker, isMainThread, parentPort } from 'worker_threads'
import { buildTechniqueInstances, type TechniqueInstance } from 'C:/Git/sudoku-solver/frontend/src/techniqueEngine'
import { ALL_RULE3_TECHNIQUES } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonFinder'
import { ALL_FISH_TECHNIQUES } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuFishFinder'
import { SudokuSolver } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuSolver'
import { SudokuRules } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuRules'
import { PuzzleImporter } from 'C:/Git/sudoku-solver/frontend/src/sudoku/PuzzleImporter'
import type { Board, CandidateGrid } from 'C:/Git/sudoku-solver/frontend/src/sudoku/types'

const DIR = (process.env.DRAGON_RESEARCH_DIR ?? 'C:/Git/sudoku-solver/frontend/dragon-research/data/')
type Ref = { row: number; col: number; digit: number }
// Dynamic Dragon limits to verify under (default: none).
const AIC_LIMIT = process.env.AIC_LIMIT === '1'
const MAX_TECH = process.env.MAX_TECH ? Number(process.env.MAX_TECH) : Infinity
const OUT_FILE = process.env.OUT_FILE ?? 'ddd-verified.jsonl'

const techniques = (board: Board, cands: CandidateGrid, ddd: boolean): TechniqueInstance[] =>
  // everything on: all AIC kinds, AIC limit off, exhaustive, every fish, ALS-xz, no technique cap,
  // Double Dragon on; Double Dynamic as asked
  buildTechniqueInstances(board, cands, 0, new Set(ALL_RULE3_TECHNIQUES), true, true, AIC_LIMIT, true, true, false, false, true,
    new Set(ALL_FISH_TECHNIQUES), true, MAX_TECH, true, ddd)

function apply(board: Board, cands: CandidateGrid, elim: Ref[], solved: Ref[]) {
  for (const e of elim) cands[e.row][e.col][e.digit - 1] = false
  for (const s of solved) {
    if (board[s.row][s.col] !== 0) continue
    board[s.row][s.col] = s.digit
    cands[s.row][s.col] = Array(9).fill(false)
    SudokuRules.eliminatePeerCandidates(cands, board, s.row, s.col, s.digit)
  }
}

export async function verify(p: string) {
  const board: Board = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(p[r * 9 + c])))
  const givens = board.map((row) => row.map((v) => v !== 0))
  const sol = new SudokuSolver().solve(board).board!
  const cands: CandidateGrid = board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
  let firstStuckKey = '', firstStuck: string | null = null, firstStuckRows: string[] = [], dddSteps = 0, dddApplied = 0, steps = 0, unsound = 0
  for (; steps < 3000; steps++) {
    if (board.every((row) => row.every((v) => v !== 0))) break
    let inst = techniques(board, cands, false)
    if (!inst.length) {
      inst = techniques(board, cands, true)
      if (!inst.length) return { puzzle: p, ok: false, reason: 'stuck even with Double Dynamic', steps }
      if (inst.some((i) => !i.id.startsWith('double-dynamic-dragon'))) return { puzzle: p, ok: false, reason: 'non-DDD row appeared only with DDD on?!' }
      if (!firstStuck) {
        firstStuck = await new PuzzleImporter().exportToSudokuCoachState(board, givens, cands)
        // The position itself (not the givens, which the state also carries),
        // so clue variants that get stuck in the same place dedupe.
        firstStuckKey = board.flat().join('') + cands.flat().map((c) => c.map((x) => (x ? 1 : 0)).join('')).join('')
        firstStuckRows = inst.map((i) => `${i.name}: ${i.notation}`)
      }
      dddSteps++
    }
    // Simplest row whose application changes the grid (a Simple Colouring
    // Rule 1 row currently carries no effect at all - an app bug, skipped).
    const ordered = [...inst].sort((a, b) => a.techniqueRank - b.techniqueRank)
    let applied = false
    for (const chosen of ordered) {
      const before = JSON.stringify([board, cands])
      const b2 = board.map((r) => [...r]), c2 = cands.map((r) => r.map((x) => [...x]))
      apply(b2, c2, chosen.eliminatedCandidates, chosen.solvedCandidates)
      if (JSON.stringify([b2, c2]) === before) continue
      for (const e of chosen.eliminatedCandidates) if (sol[e.row][e.col] === e.digit) unsound++
      for (const x of chosen.solvedCandidates) if (sol[x.row][x.col] !== x.digit) unsound++
      apply(board, cands, chosen.eliminatedCandidates, chosen.solvedCandidates)
      if (chosen.id.startsWith('double-dynamic-dragon')) dddApplied++
      applied = true
      break
    }
    if (!applied) return { puzzle: p, ok: false, reason: 'only no-op rows left', steps }
  }
  const solved = board.every((row, r) => row.every((v, c) => v === sol[r][c]))
  return { puzzle: p, ok: solved && unsound === 0 && dddSteps > 0, solved, unsound, steps, dddSteps, dddApplied, firstStuck, firstStuckKey, firstStuckRows }
}

// Only when started as verify-ddd.mjs, so other harnesses can import verify().
const VERIFY_MAIN = /verify-ddd.mjs$/.test(process.argv[1] ?? '')
if (isMainThread && VERIFY_MAIN) {
  const puzzles = fs.readFileSync(DIR + (process.argv[2] ?? 'ddd-full.txt'), 'utf8').split(/\s+/).filter((s) => s.length === 81)
  let next = 0, done = 0
  const n = Math.min(Number(process.argv[3] ?? 5), puzzles.length)
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL(import.meta.url))
    const feed = () => (next < puzzles.length ? w.postMessage(puzzles[next++]) : w.terminate())
    w.on('message', (r: any) => {
      fs.appendFileSync(DIR + OUT_FILE, JSON.stringify(r) + '\n')
      console.log(new Date().toISOString(), ++done + '/' + puzzles.length, r.ok ? 'OK' : 'FAIL', r.puzzle, r.reason ?? `solved=${r.solved} unsound=${r.unsound} steps=${r.steps} stuckWithoutDDD=${r.dddSteps} dddApplied=${r.dddApplied}`)
      if (r.firstStuckRows) for (const row of r.firstStuckRows.slice(0, 3)) console.log('    ', row)
      feed()
    })
    feed()
  }
} else if (VERIFY_MAIN) {
  parentPort!.on('message', async (p: string) => parentPort!.postMessage(await verify(p)))
}
