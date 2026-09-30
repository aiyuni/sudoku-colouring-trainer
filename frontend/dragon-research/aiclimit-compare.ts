// Old vs new Extension Rule 3 AIC limit: equivalence with the limit off, soundness/coverage/cost with it on.
import fs from 'fs'
import { Worker, isMainThread, parentPort } from 'worker_threads'
import { SudokuDragonFinder as NewFinder, ALL_RULE3_TECHNIQUES } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonFinder'
import { SudokuDragonFinder as OldFinder } from 'C:/Git/sudoku-solver/frontend/dragon-research/src-before/sudoku/SudokuDragonFinder'
import { SudokuMedusaFinder } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuMedusaFinder'
import { SudokuSolver } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuSolver'
import { PuzzleImporter } from 'C:/Git/sudoku-solver/frontend/src/sudoku/PuzzleImporter'

const DIR = (process.env.DRAGON_RESEARCH_DIR ?? 'C:/Git/sudoku-solver/frontend/dragon-research/data/')
const ALL = new Set(ALL_RULE3_TECHNIQUES)
const combos = [
  { exhaustive: false, optimize: false, optimizeDynamic: false },
  { exhaustive: true, optimize: false, optimizeDynamic: false },
  { exhaustive: false, optimize: true, optimizeDynamic: false },
  { exhaustive: true, optimize: true, optimizeDynamic: true },
]
const sig = (r: any) => (r ? r.moves.map((m: any) => `${m.kind}|${m.description}|${m.colored.map((n: any) => `${n.row}${n.col}${n.digit}${n.color}`).join(',')}|${m.eliminated.length}|${m.solved.length}`).join('\n') : 'null')
const nm = (n: any) => `${n.digit}r${n.row + 1}c${n.col + 1}`

async function check(sc: string) {
  const imp = await new PuzzleImporter().import(sc)
  if (!imp.ok) return { error: imp.error }
  const { board, candidates } = imp
  const sol = new SudokuSolver().solve(board).board
  const m = new SudokuMedusaFinder()
  const chains = m.findChains(board, candidates).filter((ch) => m.findMassElimination(ch, board, candidates) === null && m.findRule3Eliminations(ch, board, candidates).length === 0 && m.findRule4Eliminations(ch, candidates).length === 0 && m.findRule5Eliminations(ch, candidates).length === 0)
  const out = { offCompared: 0, offMismatch: 0, onChains: 0, onOld: 0, onNew: 0, onLost: 0, onGained: 0, onUnsound: 0, onMaxAicsPerStep: 0, oldMs: 0, newMs: 0, mismatches: [] as string[], lost: [] as string[] }
  for (const ch of chains) {
    for (const maxTechniquesPerStep of [Infinity, 3]) {
      for (const combo of combos) {
        // Limit OFF: must be identical.
        const opts = { dynamic: true, allowedRule3Techniques: ALL, aicLimitPerStep: false, maxTechniquesPerStep, ...combo }
        const a = sig(new OldFinder().extend(ch, board, candidates, opts)), b = sig(new NewFinder().extend(ch, board, candidates, opts))
        out.offCompared++
        if (a !== b) { out.offMismatch++; if (out.mismatches.length < 3) out.mismatches.push(`${ch.candidates.map(nm).join(' ')} ${JSON.stringify(combo)} tech=${maxTechniquesPerStep}`) }
      }
      // Limit ON (default loop, exhaustive off): old vs new.
      const on = { dynamic: true, allowedRule3Techniques: ALL, aicLimitPerStep: true, maxTechniquesPerStep }
      let t = Date.now(); const ro = new OldFinder().extend(ch, board, candidates, on); out.oldMs += Date.now() - t
      t = Date.now(); const rn = new NewFinder().extend(ch, board, candidates, on); out.newMs += Date.now() - t
      out.onChains++
      if (ro) out.onOld++
      if (rn) out.onNew++
      if (ro && !rn) { out.onLost++; if (out.lost.length < 3) out.lost.push(`${ch.candidates.map(nm).join(' ')} tech=${maxTechniquesPerStep}`) }
      if (!ro && rn) out.onGained++
      if (rn) {
        for (const mv of rn.moves) {
          for (const e of mv.eliminated) if (sol && sol[e.row][e.col] === e.digit) out.onUnsound++
          for (const s of mv.solved) if (sol && sol[s.row][s.col] !== s.digit) out.onUnsound++
          const aics = (mv.substeps ?? []).filter((x: any) => String(x.technique).includes('aic')).length
          out.onMaxAicsPerStep = Math.max(out.onMaxAicsPerStep, aics)
        }
      }
    }
  }
  return out
}

if (isMainThread) {
  const states = fs.readFileSync(DIR + 'aiclimit-states.txt', 'utf8').split(/\s+/).filter((s) => s.startsWith('SCv7'))
  const n = Number(process.argv[2] ?? 8)
  let next = 0, done = 0
  const total: any = {}
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL(import.meta.url))
    const feed = () => (next < states.length ? w.postMessage(states[next++]) : w.terminate())
    w.on('message', (r: any) => {
      done++
      for (const [k, v] of Object.entries(r)) {
        if (Array.isArray(v)) (total[k] ??= []).push(...v)
        else if (k === 'onMaxAicsPerStep') total[k] = Math.max(total[k] ?? 0, v as number)
        else total[k] = (total[k] ?? 0) + (v as number)
      }
      if (done % 20 === 0 || done === states.length) console.log(new Date().toISOString(), `${done}/${states.length}`, JSON.stringify({ ...total, mismatches: total.mismatches?.slice(0, 3), lost: total.lost?.slice(0, 3) }))
      feed()
    })
    feed()
  }
} else {
  parentPort!.on('message', async (sc: string) => parentPort!.postMessage(await check(sc)))
}
