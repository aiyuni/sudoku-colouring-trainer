// Double Dynamic Dragon research: how often does it progress where single Dynamic Dragon is stuck?
import fs from 'fs'
import os from 'os'
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads'
import { buildTechniqueInstances } from 'C:/Git/sudoku-solver/frontend/src/techniqueEngine'
import { ALL_RULE3_TECHNIQUES, DEFAULT_RULE3_TECHNIQUES, SudokuDragonFinder, type DragonMove, type DragonNode, type DynamicDragonLimits } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonFinder'
import { SudokuMedusaFinder } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuMedusaFinder'
import { ALL_FISH_TECHNIQUES } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuFishFinder'
import { SudokuSolver } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuSolver'
import { SudokuRules } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuRules'
import { PuzzleImporter } from 'C:/Git/sudoku-solver/frontend/src/sudoku/PuzzleImporter'
import type { Board, CandidateGrid } from 'C:/Git/sudoku-solver/frontend/src/sudoku/types'

const DIR = (process.env.DRAGON_RESEARCH_DIR ?? 'C:/Git/sudoku-solver/frontend/dragon-research/data/')

interface Scenario {
  name: string
  limits: DynamicDragonLimits
  allTechniques: boolean // standalone AICs, fish and ALS-xz on (else app defaults)
}
const ALL = new Set(ALL_RULE3_TECHNIQUES)
export const SCENARIOS: Scenario[] = [
  { name: 'S1 aic=inf tech=inf', limits: { allowedRule3Techniques: ALL, aicLimitPerStep: false, maxTechniquesPerStep: Infinity }, allTechniques: true },
  { name: 'S2 aic=1 tech=1', limits: { allowedRule3Techniques: ALL, aicLimitPerStep: true, maxTechniquesPerStep: 1 }, allTechniques: true },
  { name: 'S3 aic=1 tech=2', limits: { allowedRule3Techniques: ALL, aicLimitPerStep: true, maxTechniquesPerStep: 2 }, allTechniques: true },
  { name: 'S4 aic=1 tech=inf', limits: { allowedRule3Techniques: ALL, aicLimitPerStep: true, maxTechniquesPerStep: Infinity }, allTechniques: true },
  { name: 'S5 app defaults', limits: { allowedRule3Techniques: new Set(DEFAULT_RULE3_TECHNIQUES), aicLimitPerStep: true, maxTechniquesPerStep: Infinity }, allTechniques: false },
  { name: 'S6 aic=1 tech=3', limits: { allowedRule3Techniques: ALL, aicLimitPerStep: true, maxTechniquesPerStep: 3 }, allTechniques: true },
]

type Ref = { row: number; col: number; digit: number }
const key = (n: Ref) => `${n.row},${n.col},${n.digit}`
const nm = (n: Ref) => `${n.digit}r${n.row + 1}c${n.col + 1}`

function autofill(board: Board): CandidateGrid {
  return board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
}
function apply(board: Board, cands: CandidateGrid, elim: Ref[], solved: Ref[]) {
  for (const e of elim) cands[e.row][e.col][e.digit - 1] = false
  for (const s of solved) {
    if (board[s.row][s.col] !== 0) continue
    board[s.row][s.col] = s.digit
    cands[s.row][s.col] = Array(9).fill(false)
    SudokuRules.eliminatePeerCandidates(cands, board, s.row, s.col, s.digit)
  }
}
function checkMoves(moves: DragonMove[], sol: Board): string | null {
  for (const m of moves) {
    for (const e of m.eliminated) if (sol[e.row][e.col] === e.digit) return `eliminated true ${nm(e)}`
    for (const s of m.solved) if (sol[s.row][s.col] !== s.digit) return `solved wrong ${nm(s)}`
  }
  return null
}
/** The second Dragon's actually-true side: every node must be true. */
function checkSecondColouring(moves: DragonMove[], sol: Board): string | null {
  const m = new Map<string, DragonNode>()
  for (const mv of moves) if (mv.secondDragon) for (const n of mv.colored) m.set(key(n), n)
  const nodes = [...m.values()]
  const a = nodes.find((n) => n.color === 'blue')
  if (!a) return null
  const trueSide = sol[a.row][a.col] === a.digit ? 'A' : 'B'
  for (const n of nodes) {
    const side = n.color === 'blue' || n.color === 'darkBlue' ? 'A' : 'B'
    const prim = n.color === 'blue' || n.color === 'yellow'
    const t = sol[n.row][n.col] === n.digit
    if (prim && t !== (side === trueSide)) return `primary ${nm(n)} wrong`
    if (!prim && side === trueSide && !t) return `secondary ${nm(n)} of true side false`
  }
  return null
}

export async function runPuzzle(p: string, sc: Scenario) {
  const finder = new SudokuDragonFinder()
  const medusa = new SudokuMedusaFinder()
  const board: Board = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(p[r * 9 + c])))
  const res = new SudokuSolver().solve(board)
  if (res.status !== 'solved') return { puzzle: p, scenario: sc.name, invalid: true, stuckStates: [] as unknown[] }
  const sol = res.board!
  const cands = autofill(board)
  const fish = new Set(sc.allTechniques ? ALL_FISH_TECHNIQUES : [])
  const stuckStates: unknown[] = []
  let placements = 0
  const t0 = Date.now()
  for (let step = 0; step < 400; step++) {
    if (board.every((row) => row.every((v) => v !== 0))) break
    // Everything the app has, except Dynamic Dragon (checked below with the scenario's limits).
    const inst = buildTechniqueInstances(board, cands, 0, sc.limits.allowedRule3Techniques, sc.allTechniques, sc.allTechniques, true, false,
      sc.allTechniques, false, false, false, fish, sc.allTechniques, Infinity, false)
    if (inst.length) {
      const rank = Math.min(...inst.map((i) => i.techniqueRank))
      for (const i of inst.filter((x) => x.techniqueRank === rank)) apply(board, cands, i.eliminatedCandidates, i.solvedCandidates)
      continue
    }
    const chains = medusa.findChains(board, cands).filter((ch) =>
      medusa.findMassElimination(ch, board, cands) === null && medusa.findRule3Eliminations(ch, board, cands).length === 0 &&
      medusa.findRule4Eliminations(ch, cands).length === 0 && medusa.findRule5Eliminations(ch, cands).length === 0)
    let single: DragonMove[] | null = null
    for (const ch of chains) {
      const r = finder.extend(ch, board, cands, { ...sc.limits, dynamic: true })
      if (r) { single = r.moves; break }
    }
    if (single) { apply(board, cands, single.flatMap((m) => m.eliminated), single.flatMap((m) => m.solved)); continue }
    // Single Dynamic Dragon is stuck: nothing in the app applies.
    const sc0 = await new PuzzleImporter().exportToSudokuCoachState(board, board.map((row) => row.map(() => false)), cands)
    const plain0 = Date.now()
    const plain = finder.findDoubleDragons(chains, board, cands, { limit: 1 })
    const plainMs = Date.now() - plain0
    const dyn0 = Date.now()
    const dyn = finder.findDoubleDragons(chains, board, cands, { dynamic: sc.limits })
    const dynMs = Date.now() - dyn0
    const problems = dyn.flatMap((d) => [checkMoves(d.moves, sol), checkSecondColouring(d.moves, sol)].filter(Boolean))
    const best = dyn.sort((a, b) => a.moves.length - b.moves.length)[0]
    stuckStates.push({
      empty: board.flat().filter((v) => v === 0).length, chains: chains.length, sc: sc0,
      doublePlain: plain.length > 0, doubleDynamic: dyn.length, plainMs, dynMs, problems,
      example: best ? {
        first: best.first.candidates.map(nm).join(' '), second: best.second.candidates.map(nm).join(' '), moves: best.moves.length,
        effect: best.moves.flatMap((m) => [...m.eliminated.map((e) => '-' + nm(e)), ...m.solved.map((s) => '+' + nm(s))]).join(' '),
        link: best.moves.find((m) => m.kind === 'dragon-link')?.description,
        rule3InSecond: best.moves.filter((m) => m.secondDragon && m.kind === 'extension-rule3').length,
        rule3InFirst: best.moves.filter((m) => !m.secondDragon && m.kind === 'extension-rule3').length,
      } : null,
    })
    if (best) apply(board, cands, best.moves.flatMap((m) => m.eliminated), best.moves.flatMap((m) => m.solved))
    else {
      placements++
      outer: for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (board[r][c] === 0) { apply(board, cands, [], [{ row: r, col: c, digit: sol[r][c] }]); break outer }
    }
  }
  return { puzzle: p, scenario: sc.name, placements, ms: Date.now() - t0, stuckStates }
}

const RESEARCH_MAIN = /research.mjs$/.test(process.argv[1] ?? '')
if (isMainThread && RESEARCH_MAIN) {
  const puzzles = fs.readFileSync(DIR + (process.env.PUZZLES ?? 'research-puzzles.txt'), 'utf8').split(/\s+/).filter((s) => s.length === 81)
  const scenarios = (process.argv[2] ?? '0,1,2,3,4').split(',').map(Number)
  const nWorkers = Number(process.argv[3] ?? Math.max(1, os.cpus().length / 2))
  const out = DIR + (process.argv[4] ?? 'research-results.jsonl')
  const tasks = scenarios.flatMap((s) => puzzles.map((p) => ({ p, s })))
  let next = 0, done = 0
  console.log(new Date().toISOString(), tasks.length, 'tasks,', nWorkers, 'workers')
  for (let i = 0; i < nWorkers; i++) {
    const w = new Worker(new URL(import.meta.url), { workerData: {} })
    const feed = () => { if (next < tasks.length) w.postMessage(tasks[next++]); else w.terminate() }
    w.on('message', (r: any) => {
      fs.appendFileSync(out, JSON.stringify(r) + '\n')
      done++
      const st = r.stuckStates ?? []
      console.log(new Date().toISOString(), `${done}/${tasks.length}`, r.scenario, r.puzzle.slice(0, 12), `stuck=${st.length} doubleDyn=${st.filter((x: any) => x.doubleDynamic).length} doublePlain=${st.filter((x: any) => x.doublePlain).length} ${((r.ms ?? 0) / 1000).toFixed(0)}s`)
      feed()
    })
    feed()
  }
} else if (!isMainThread && RESEARCH_MAIN) {
  parentPort!.on('message', async ({ p, s }: { p: string; s: number }) => {
    parentPort!.postMessage(await runPuzzle(p, SCENARIOS[s]))
  })
}
void workerData
