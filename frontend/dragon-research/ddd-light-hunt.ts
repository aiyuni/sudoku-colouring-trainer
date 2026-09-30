// Hunts for a *light* Double Dynamic Dragon teaching position: single Dynamic Dragon at the strongest
// settings (every technique, no AIC limit, no technique cap) is stuck, but Double Dynamic progresses using
// only easy helper techniques. Same clue-variant search as ddd-hunt.ts (seeds + correct extra clues, S1).
//
// Two separate outcomes per puzzle:
//  - stock: verified through the app's own engine (verify-ddd.ts: everything maxed, AIC limit off; the puzzle
//    must then solve with no guessing) - qualifies for DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK, light or not;
//  - teaching: every stuck position where Double Dynamic (and not Double plain) progresses is graded by the
//    smallest Rule 3 technique set with which Double Dynamic still progresses there (GRADES, simplest first).
//    A teaching position doesn't need the rest of the puzzle to solve, only its own stuck point to be right,
//    so a light one is also checked against the lesson's claim: exhaustive single Dynamic at the strongest
//    settings is stuck on every Medusa. The hunt stops at the first light one that passes.
//
// Output (data dir): ddd-light-hunt.jsonl (every variant tried, for resuming), ddd-light-hits.jsonl (every new
// graded position; `stock` = verified for the stock). Build/run from frontend/ like the other harnesses (output outside
// the repo):
//   npx rolldown dragon-research/ddd-light-hunt.ts --format esm --platform node -o <tmp>/ddd-light-hunt.mjs
//   node <tmp>/ddd-light-hunt.mjs <workers> <maxLevel>
import fs from 'fs'
import { Worker, isMainThread, parentPort } from 'worker_threads'
import { runPuzzle, SCENARIOS } from './research'
import { verify } from './verify-ddd'
import { SudokuSolver } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuSolver'
import { SudokuMedusaFinder } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuMedusaFinder'
import { ALL_RULE3_TECHNIQUES, SudokuDragonFinder, type Rule3Technique } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonFinder'
import { PuzzleImporter } from 'C:/Git/sudoku-solver/frontend/src/sudoku/PuzzleImporter'
import { DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK } from 'C:/Git/sudoku-solver/frontend/src/sudoku/doubleDynamicDragonPuzzleStockData'
import type { Board, CandidateGrid } from 'C:/Git/sudoku-solver/frontend/src/sudoku/types'

const DIR = process.env.DRAGON_RESEARCH_DIR ?? 'C:/Git/sudoku-solver/frontend/dragon-research/data/'
const OUT = DIR + 'ddd-light-hunt.jsonl'
const HITS = DIR + 'ddd-light-hits.jsonl'

// Technique sets, simplest first; 'hidden single' and 'naked pair' are always on in a Dynamic Dragon.
const T = (...t: Rule3Technique[]) => new Set<Rule3Technique>(['hidden single', 'naked pair', ...t])
const BASIC: Rule3Technique[] = ['locked candidate', 'hidden pair']
const SUBSETS: Rule3Technique[] = [...BASIC, 'naked triple', 'naked quad']
const GRADES: Array<{ name: string; light: boolean; set: Set<Rule3Technique> }> = [
  { name: 'basic', light: true, set: T(...BASIC) },
  { name: 'subsets', light: true, set: T(...SUBSETS) },
  { name: '+x-wing', light: true, set: T(...SUBSETS, 'x-wing') },
  { name: '+single-digit aic', light: true, set: T(...SUBSETS, 'x-wing', 'short single-digit aic') },
  { name: '+uniqueness', light: false, set: T(...SUBSETS, 'x-wing', 'short single-digit aic', 'UR', 'BUG+N', 'bivalue oddagon') },
  { name: 'all', light: false, set: new Set(ALL_RULE3_TECHNIQUES) },
]

const nm = (n: { row: number; col: number; digit: number }) => `${n.digit}r${n.row + 1}c${n.col + 1}`
const positionKey = (board: Board, cands: CandidateGrid) =>
  board.flat().join('') + cands.flat().map((c) => c.map((x) => (x ? 1 : 0)).join('')).join('')

async function importState(state: string) {
  const imp = (await new PuzzleImporter().import(state)) as unknown as { ok: boolean; board: Board; candidates: CandidateGrid }
  return imp.ok ? imp : null
}

/** The simplest grade with which Double Dynamic progresses at `state`, and its shortest log. */
async function grade(state: string) {
  const imp = await importState(state)
  if (!imp) return null
  const { board, candidates } = imp
  const medusa = new SudokuMedusaFinder()
  const finder = new SudokuDragonFinder()
  const chains = medusa.findChains(board, candidates).filter((ch) =>
    medusa.findMassElimination(ch, board, candidates) === null && medusa.findRule3Eliminations(ch, board, candidates).length === 0 &&
    medusa.findRule4Eliminations(ch, candidates).length === 0 && medusa.findRule5Eliminations(ch, candidates).length === 0)
  for (const g of GRADES) {
    const found = finder
      .findDoubleDragons(chains, board, candidates, { optimize: true, optimizeDynamic: true, dynamic: { allowedRule3Techniques: g.set, aicLimitPerStep: false } })
      .filter((x) => x.moves.some((m) => m.kind === 'extension-rule3'))
      .sort((a, b) => a.moves.length - b.moves.length)
    if (found.length) {
      const best = found[0]
      // The lesson says every single Dynamic Dragon is stuck: check it at the strongest settings, with
      // Exhaustive too (the search itself only ran non-exhaustive single Dragons).
      const strongestStuck = g.light
        ? chains.every(
            (ch) =>
              !finder.extend(ch, board, candidates, {
                dynamic: true,
                exhaustive: true,
                allowedRule3Techniques: new Set(ALL_RULE3_TECHNIQUES),
                aicLimitPerStep: false,
              }),
          )
        : undefined
      return {
        grade: g.name,
        light: g.light,
        strongestStuck,
        moves: best.moves.length,
        firstMoves: best.moves.findIndex((m) => m.secondDragon),
        techniques: [...new Set(best.moves.flatMap((m) => m.dynamicTechniques ?? []))],
        firstSeed: nm(best.first.candidates[0]),
        secondSeed: nm(best.second.candidates[0]),
      }
    }
  }
  return { grade: 'none (exhaustive only?)', light: false }
}

if (isMainThread) {
  const seeds = fs.readFileSync(DIR + (process.env.SEEDS ?? 'ddd-seeds.txt'), 'utf8').split(/\s+/).filter((s) => s.length === 81)
  const nWorkers = Number(process.argv[2] ?? 14)
  const maxLevel = Number(process.argv[3] ?? 3)
  const solver = new SudokuSolver()
  const lines = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const done = new Set<string>(lines(OUT).map((l) => l.puzzle))
  // Positions already in the stock or already found: a clue variant often gets stuck in the same place.
  const known = new Set<string>(lines(HITS).map((l) => l.key))
  for (const state of DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK) {
    const imp = await importState(state)
    if (imp) known.add(positionKey(imp.board, imp.candidates))
  }
  const variants = (p: string) => {
    const sol = solver.solve(Array.from({ length: 9 }, (_, r) => [...p.slice(r * 9, r * 9 + 9)].map(Number))).board!.flat()
    return [...p].flatMap((ch, i) => (ch === '0' ? [p.slice(0, i) + sol[i] + p.slice(i + 1)] : []))
  }
  const queue: { p: string; level: number }[] = []
  for (const s of seeds) for (const v of variants(s)) queue.push({ p: v, level: 1 })
  // Resuming: re-expand the stuck variants found last time.
  for (const l of lines(OUT)) if (l.stuck && l.level < maxLevel) for (const v of variants(l.puzzle)) queue.push({ p: v, level: l.level + 1 })
  let next = 0, finished = 0, inFlight = 0, stock = 0
  console.log(new Date().toISOString(), `seeds ${seeds.length}, queued ${queue.length}, already done ${done.size}, known positions ${known.size}`)
  const workers: Worker[] = []
  const stop = (why: string) => {
    console.log(new Date().toISOString(), why)
    for (const w of workers) void w.terminate()
    process.exit(0)
  }
  const feed = (w: Worker) => {
    while (next < queue.length && done.has(queue[next].p)) next++
    if (next < queue.length) {
      done.add(queue[next].p)
      inFlight++
      w.postMessage(queue[next++])
    } else if (inFlight === 0) stop(`queue empty - finished ${finished}, new stock positions ${stock}, no light one`)
    else setTimeout(() => feed(w), 5000)
  }
  for (let i = 0; i < nWorkers; i++) {
    const w = new Worker(new URL(import.meta.url))
    workers.push(w)
    w.on('message', (m: any) => {
      finished++
      inFlight--
      fs.appendFileSync(OUT, JSON.stringify({ puzzle: m.puzzle, level: m.level, stuck: m.stuck, ddd: m.ddd }) + '\n')
      if (m.stuck && m.level < maxLevel) for (const v of variants(m.puzzle)) if (!done.has(v)) queue.push({ p: v, level: m.level + 1 })
      for (const hit of m.hits) {
        if (known.has(hit.key)) continue
        known.add(hit.key)
        if (hit.stock) stock++
        fs.appendFileSync(HITS, JSON.stringify(hit) + '\n')
        console.log(new Date().toISOString(), hit.stock ? 'NEW STOCK POSITION' : 'NEW POSITION (not stock)', m.puzzle, JSON.stringify(hit.grade))
        if (hit.grade?.light && hit.grade.strongestStuck) stop(`LIGHT position found: ${m.puzzle}`)
      }
      if (finished % 25 === 0) console.log(new Date().toISOString(), `finished ${finished}, queued ${queue.length - next}, new stock positions ${stock}`)
      feed(w)
    })
    feed(w)
  }
} else {
  parentPort!.on('message', async (task: { p: string; level: number }) => {
    const r: any = await runPuzzle(task.p, SCENARIOS[0])
    const stuck = (r.stuckStates ?? []).length
    const ddd = (r.stuckStates ?? []).filter((s: any) => s.doubleDynamic && !s.doublePlain).length
    const hits: unknown[] = []
    if (ddd) {
      const v: any = await verify(task.p)
      if (v.ok) {
        hits.push({ puzzle: task.p, level: task.level, stock: true, key: v.firstStuckKey, state: v.firstStuck, rows: v.firstStuckRows, grade: await grade(v.firstStuck) })
      }
      for (const s of r.stuckStates.filter((x: any) => x.doubleDynamic && !x.doublePlain)) {
        const imp = await importState(s.sc)
        if (!imp) continue
        const key = positionKey(imp.board, imp.candidates)
        if (v.ok && key === v.firstStuckKey) continue
        hits.push({ puzzle: task.p, level: task.level, stock: false, key, state: s.sc, grade: await grade(s.sc) })
      }
    }
    parentPort!.postMessage({ puzzle: task.p, level: task.level, stuck, ddd, hits })
  })
}
