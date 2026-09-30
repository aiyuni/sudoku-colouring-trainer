// Hunts for a position where everything existing (incl. unlimited single Dynamic Dragon and Double Plain Dragon)
// is stuck but unlimited Double Dynamic Dragon progresses. Seeds: puzzles S1 gets stuck on; variants add correct
// clues (level 1: every single extra clue; level 2: pairs of extra clues around variants that stay stuck).
import fs from 'fs'
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads'
import { runPuzzle, SCENARIOS } from './research'
import { SudokuSolver } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuSolver'

const DIR = (process.env.DRAGON_RESEARCH_DIR ?? 'C:/Git/sudoku-solver/frontend/dragon-research/data/')
const SC = Number(process.env.SCENARIO ?? 0)
const TAG = process.env.TAG ?? ''
const OUT = DIR + `ddd-hunt${TAG}.jsonl`
const HITS = DIR + `ddd-hits${TAG}.jsonl`

if (isMainThread) {
  const seeds = fs.readFileSync(DIR + (process.env.SEEDS ?? 'ddd-seeds.txt'), 'utf8').split(/\s+/).filter((s) => s.length === 81)
  const nWorkers = Number(process.argv[2] ?? 8)
  const maxLevel = Number(process.argv[3] ?? 2)
  const solver = new SudokuSolver()
  const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).puzzle) : [])
  const queue: { p: string; level: number }[] = []
  const variants = (p: string) => {
    const sol = solver.solve(p.split('').map(Number).reduce((b: number[][], v, i) => ((b[Math.floor(i / 9)] ??= []).push(v), b), [])).board!.flat()
    return [...p].flatMap((ch, i) => (ch === '0' ? [p.slice(0, i) + sol[i] + p.slice(i + 1)] : []))
  }
  // Level 0: the seeds themselves (only with SEEDS_TOO); their variants are queued when they get stuck.
  if (process.env.SEEDS_TOO) for (const s of seeds) queue.push({ p: s, level: 0 })
  else for (const s of seeds) for (const v of variants(s)) queue.push({ p: v, level: 1 })
  let next = 0, finished = 0, hits = 0
  const stats = { stuckVariants: 0 }
  console.log(new Date().toISOString(), 'seeds', seeds.length, 'level-1 variants', queue.length)
  const workers: Worker[] = []
  let inFlight = 0
  const feed = (w: Worker) => {
    while (next < queue.length && done.has(queue[next].p)) next++
    if (next < queue.length) { inFlight++; w.postMessage(queue[next++]); return }
    if (inFlight === 0) { console.log(new Date().toISOString(), 'queue empty - done', `finished ${finished}, hits ${hits}`); process.exit(0) }
    w.postMessage(null)
  }
  for (let i = 0; i < nWorkers; i++) {
    const w = new Worker(new URL(import.meta.url), { workerData: {} })
    workers.push(w)
    w.on('message', (m: any) => {
      if (m.idle) { setTimeout(() => feed(w), 5000); return }
      finished++
      inFlight--
      done.add(m.puzzle)
      fs.appendFileSync(OUT, JSON.stringify({ puzzle: m.puzzle, level: m.level, stuck: m.stuckStates.length, ddd: m.stuckStates.filter((s: any) => s.doubleDynamic && !s.doublePlain).length }) + '\n')
      if (m.stuckStates.length) {
        stats.stuckVariants++
        if (m.level < maxLevel) for (const v of variants(m.puzzle)) if (!done.has(v)) queue.push({ p: v, level: m.level + 1 })
      }
      for (const s of m.stuckStates) if (s.doubleDynamic && !s.doublePlain) {
        hits++
        fs.appendFileSync(HITS, JSON.stringify({ puzzle: m.puzzle, level: m.level, ...s }) + '\n')
        console.log(new Date().toISOString(), 'HIT', m.puzzle, JSON.stringify(s.example))
      }
      if (finished % 50 === 0) console.log(new Date().toISOString(), `finished ${finished}, queued ${queue.length}, stuck variants ${stats.stuckVariants}, hits ${hits}`)
      feed(w)
    })
    feed(w)
  }
} else {
  parentPort!.on('message', async (task: { p: string; level: number } | null) => {
    if (!task) { parentPort!.postMessage({ idle: true }); return }
    const r: any = await runPuzzle(task.p, SCENARIOS[SC])
    parentPort!.postMessage({ ...r, level: task.level })
  })
}
void workerData
