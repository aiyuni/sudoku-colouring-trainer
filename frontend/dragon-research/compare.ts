// A: at every state where S4 Double Dynamic progresses, does S1 single Dynamic progress (and cover the same eliminations)?
//    Per puzzle: S4 + Double Dynamic solves without guessing  vs  S1 single Dynamic solves without guessing.
// B: S1 Double Dynamic vs S1 single Dynamic, per state and per puzzle.
import fs from 'fs'
import { PuzzleImporter } from 'C:/Git/sudoku-solver/frontend/src/sudoku/PuzzleImporter'
import { ALL_RULE3_TECHNIQUES, SudokuDragonFinder } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonFinder'
import { SudokuMedusaFinder } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuMedusaFinder'

const DIR = (process.env.DRAGON_RESEARCH_DIR ?? 'C:/Git/sudoku-solver/frontend/dragon-research/data/')
const files = ['research-results.jsonl', 'top1465-results.jsonl', 'newhard-results.jsonl'].filter((f) => fs.existsSync(DIR + f))
const rs: any[] = files.flatMap((f) => fs.readFileSync(DIR + f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)))
const S1 = 'S1 aic=inf tech=inf', S4 = 'S4 aic=1 tech=inf'
const byScenario = (sc: string) => new Map(rs.filter((r) => r.scenario === sc && !r.invalid).map((r) => [r.puzzle, r]))
const r1 = byScenario(S1), r4 = byScenario(S4)
const nm = (n: any) => `${n.digit}r${n.row + 1}c${n.col + 1}`

// Puzzle outcome under a scenario's grind (which applies Double Dynamic at stuck states):
//  - singleSolves: never stuck at all (single Dynamic + everything else solves it, no guessing)
//  - doubleSolves: solved without any guessed digit (Double Dynamic got past every stuck state)
const outcome = (r: any) => ({ singleSolves: (r.stuckStates ?? []).length === 0, doubleSolves: r.placements === 0 || (r.stuckStates ?? []).length === 0 })

const f = new SudokuDragonFinder(), m = new SudokuMedusaFinder()
const s1Limits = { allowedRule3Techniques: new Set(ALL_RULE3_TECHNIQUES), aicLimitPerStep: false, maxTechniquesPerStep: Infinity }

console.log(`Puzzles with both S1 and S4 results: ${[...r4.keys()].filter((p) => r1.has(p)).length}\n`)

// ---------- A: state level ----------
console.log('=== A1: every state where S4 Double Dynamic progresses - does S1 single Dynamic progress there? ===')
const stateRows: any[] = []
for (const [p, r] of r4) {
  for (const s of r.stuckStates ?? []) {
    if (!s.doubleDynamic) continue
    const imp = await new PuzzleImporter().import(s.sc)
    if (!imp.ok) throw new Error(imp.error)
    const { board, candidates } = imp
    const chains = m.findChains(board, candidates).filter((ch) =>
      m.findMassElimination(ch, board, candidates) === null && m.findRule3Eliminations(ch, board, candidates).length === 0 &&
      m.findRule4Eliminations(ch, candidates).length === 0 && m.findRule5Eliminations(ch, candidates).length === 0)
    const singleElims = new Set<string>(), singleSolves = new Set<string>()
    let progressingChains = 0
    for (const ch of chains) {
      const res = f.extend(ch, board, candidates, { ...s1Limits, dynamic: true, exhaustive: true })
      if (!res) continue
      progressingChains++
      for (const mv of res.moves) { mv.eliminated.forEach((e) => singleElims.add(nm(e))); mv.solved.forEach((x) => singleSolves.add(nm(x))) }
    }
    const ddEffect: string[] = s.example.effect.split(' ').filter(Boolean)
    const covered = ddEffect.filter((e) => (e[0] === '-' ? singleElims.has(e.slice(1)) : singleSolves.has(e.slice(1)) || /* placing also eliminates */ false))
    stateRows.push({ puzzle: p.slice(0, 18) + '…', empty: s.empty, s1SingleProgresses: progressingChains > 0, s1ChainsProgressing: `${progressingChains}/${chains.length}`, ddEffect: s.example.effect, coveredBySingleS1: `${covered.length}/${ddEffect.length}` })
  }
}
console.table(stateRows)

// ---------- A: puzzle level ----------
console.log('\n=== A2: puzzles S4 Double Dynamic helped - does S1 single Dynamic solve them without guessing? ===')
const aRows: any[] = []
for (const [p, r] of r4) {
  if (!(r.stuckStates ?? []).some((s: any) => s.doubleDynamic)) continue
  const s1 = r1.get(p)
  aRows.push({ puzzle: p, s4StuckStates: r.stuckStates.length, s4WithDoubleSolves: outcome(r).doubleSolves, s1SingleSolves: s1 ? outcome(s1).singleSolves : 'no S1 run' })
}
console.table(aRows)
// Broader: every puzzle S4 + Double Dynamic solves without guessing, but S4 single doesn't
let aHelped = 0, aAlsoS1 = 0
const aExceptions: string[] = []
for (const [p, r] of r4) {
  const o = outcome(r)
  if (o.singleSolves || !o.doubleSolves) continue
  aHelped++
  if (r1.get(p) && outcome(r1.get(p)).singleSolves) aAlsoS1++
  else aExceptions.push(p)
}
console.log(`Puzzles S4 single Dynamic gets stuck on but S4 + Double Dynamic solves without guessing: ${aHelped}; S1 single Dynamic also solves: ${aAlsoS1}; exceptions: ${aExceptions.length ? aExceptions.join(', ') : 'none'}`)
// Cross-check the other direction: S1 single stuck but S4 + Double solves?
let s1StuckS4DoubleSolves = 0
for (const [p, r] of r1) if (!outcome(r).singleSolves && r4.get(p) && outcome(r4.get(p)).doubleSolves) s1StuckS4DoubleSolves++
console.log(`Puzzles S1 single Dynamic gets stuck on but S4 + Double Dynamic solves without guessing: ${s1StuckS4DoubleSolves}`)

// ---------- B ----------
console.log('\n=== B: S1 Double Dynamic vs S1 single Dynamic ===')
let bStates = 0, bDD = 0, bDP = 0, bPuzzlesStuck = 0, bRescued = 0
const bRows: any[] = []
for (const [p, r] of r1) {
  const st = r.stuckStates ?? []
  if (!st.length) continue
  bPuzzlesStuck++
  bStates += st.length
  bDD += st.filter((s: any) => s.doubleDynamic).length
  bDP += st.filter((s: any) => s.doublePlain).length
  if (r.placements === 0) bRescued++
  bRows.push({ puzzle: p, stuckStates: st.length, emptyAtStuck: st.map((s: any) => s.empty).join(','), chains: st.map((s: any) => s.chains).join(','), doubleDynamic: st.filter((s: any) => s.doubleDynamic).length, maxDoubleMs: Math.max(...st.map((s: any) => s.dynMs)) })
}
console.table(bRows)
console.log(`S1: ${bPuzzlesStuck} puzzles stuck, ${bStates} stuck states; Double Dynamic progresses in ${bDD}, Double Plain in ${bDP}; puzzles then solved without guessing: ${bRescued}`)
