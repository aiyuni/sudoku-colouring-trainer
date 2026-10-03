// Hunts for puzzles single Dynamic Dragon can't solve but Double Dynamic Dragon can, at a fixed settings
// profile (MODE env):
//   defaults - app defaults: Dynamic Dragon techniques = DEFAULT_RULE3_TECHNIQUES (no AICs), "Limit to 1 AIC per
//              step" ON, no technique cap, Exhaustive ON, Optimize OFF; standalone AICs, fish, ALS-xz, Double
//              (plain) Dragon and exotics all OFF - plus Double Dynamic Dragon ON for the "can" half.
//   tech1    - the same with "Max techniques per step" = 1 (per Dragon step).
//   allon3   - (2026-10-02, the user's profile) every standalone technique ON except Sue-de-Coq: Short AIC, Short
//              Single-Digit AIC, Generic AIC, every fish, ALS-xz, Double (plain) Dragon; Dynamic Dragon techniques
//              still DEFAULT_RULE3_TECHNIQUES, "Max techniques per step" = 3, the rest at defaults. The other
//              profiles' hits are queued first (they are stuck with default Dynamic Dragon techniques already).
//
// A puzzle qualifies when, solving it through the app's own engine (buildTechniqueInstances) by always applying
// the simplest row that changes the grid, it gets stuck at least once with Double Dynamic OFF, every such point is
// passed by Double Dynamic rows alone, and the whole puzzle is solved with no guessing, every step checked against
// the real solution. One puzzle per distinct first stuck position (clue variants often get stuck in the same place),
// and at most MAX_PER_ROOT per original seed puzzle.
//
// Seeds: data/all-hard.txt plus the S5 puzzles of double-dynamic-dragon-examples.txt (level 0); puzzles whose
// single Dynamic gets stuck have their one-extra-correct-clue variants queued (up to maxLevel). Output:
// data/ddd-<mode>-hunt.jsonl (every puzzle tried, for resuming), data/ddd-<mode>-hits.jsonl, and the readable
// list frontend/double-dynamic-dragon-<mode>.txt (rewritten on every hit). Stops at TARGET hits.
//   npx rolldown dragon-research/ddd-settings-hunt.ts --format esm --platform node -o <tmp>/ddd-settings-hunt.mjs
//   MODE=defaults node <tmp>/ddd-settings-hunt.mjs <workers> <maxLevel>
import fs from 'fs'
import { Worker, isMainThread, parentPort } from 'worker_threads'
import { buildTechniqueInstances, type TechniqueInstance } from 'C:/Git/sudoku-solver/frontend/src/techniqueEngine'
import { DEFAULT_RULE3_TECHNIQUES } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonFinder'
import { ALL_FISH_TECHNIQUES, type FishTechnique } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuFishFinder'
import { SudokuSolver } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuSolver'
import { SudokuRules } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuRules'
import { PuzzleImporter } from 'C:/Git/sudoku-solver/frontend/src/sudoku/PuzzleImporter'
import type { Board, CandidateGrid } from 'C:/Git/sudoku-solver/frontend/src/sudoku/types'
import { isIndependentDoubleDragon } from './independent'

const MODE = (process.env.MODE ?? 'defaults') as 'defaults' | 'tech1' | 'allon3'
const MAX_TECH = MODE === 'tech1' ? 1 : MODE === 'allon3' ? 3 : Infinity
const ALL_ON = MODE === 'allon3'
const FISH: ReadonlySet<FishTechnique> = new Set(ALL_ON ? ALL_FISH_TECHNIQUES : [])
const TARGET = Number(process.env.TARGET ?? 42)
// At most this many hits per original seed puzzle, so the list isn't one puzzle's clue variants.
const MAX_PER_ROOT = Number(process.env.MAX_PER_ROOT ?? 3)
const PUZZLE_BUDGET_MS = Number(process.env.PUZZLE_BUDGET_MS ?? 15 * 60_000)
const ROOT = 'C:/Git/sudoku-solver/frontend/'
const DIR = process.env.DRAGON_RESEARCH_DIR ?? ROOT + 'dragon-research/data/'
// INDEPENDENT=1 (2026-10-02, the user's rule): at every stuck point at least one Double Dynamic row must be
// independent - its second Medusa shares no candidate with the first Dragon's colouring (independent.ts) - and an
// independent one is what gets applied. Own files (suffix -independent); the plain run's records serve as a cache,
// since independence only matters where Double Dynamic is needed: a puzzle single Dynamic solved, or one stuck even
// with Double Dynamic, ends the same way now and isn't recomputed.
const INDEPENDENT = process.env.INDEPENDENT === '1'
// START=1 (2026-10-03, the user's rule): the 81-char string itself must be the stuck position - read as a puzzle
// (candidates autofilled), its very first move must already need Double Dynamic. A hunt hit's stuck position
// usually isn't such a string: the marks removed on the way there come back on import, and with them easier rows.
// So besides clue variants, every board along a stuck puzzle's solve path (after each placement, up to its first
// stuck point) is queued as a candidate string of its own ('pos' tasks, checked strictly, never expanded).
const START = process.env.START === '1'
const SUFFIX = (INDEPENDENT ? '-independent' : '') + (START ? '-start' : '')
const OUT = DIR + `ddd-${MODE}-hunt${SUFFIX}.jsonl`
const HITS = DIR + `ddd-${MODE}-hits${SUFFIX}.jsonl`
const PLAIN_OUT = DIR + `ddd-${MODE}-hunt${START && INDEPENDENT ? '-independent' : ''}.jsonl`
const LIST = ROOT + `double-dynamic-dragon-${MODE}${SUFFIX}.txt`
const PROFILE =
  MODE === 'tech1'
    ? 'app defaults, except "Max techniques per step" = 1'
    : ALL_ON
      ? 'every technique ON except Sue-de-Coq, Dynamic Dragon techniques = defaults, "Max techniques per step" = 3'
      : 'app defaults'

type Ref = { row: number; col: number; digit: number }
type Stage = 'easy' | 'dynamic' | 'ddd'
const RULE3 = new Set(DEFAULT_RULE3_TECHNIQUES)

function techniques(board: Board, cands: CandidateGrid, givens: boolean[][], stage: Stage): TechniqueInstance[] {
  // Same argument order as App: minBase 0, Rule 3 set, short AIC, single-digit AIC, AIC limit on, Exhaustive on,
  // generic AIC, optimize off/off, Dynamic, fish, ALS-xz, technique cap, Double plain, Double Dynamic, givens, no
  // exotics (Sue-de-Coq is the only one). The standalone techniques are all off except in allon3, where all are on.
  return buildTechniqueInstances(board, cands, 0, RULE3, ALL_ON, ALL_ON, true, true, ALL_ON, false, false,
    stage !== 'easy', FISH, ALL_ON, MAX_TECH, ALL_ON, stage === 'ddd', givens)
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

async function verify(p: string, strict = false) {
  const t0 = Date.now()
  // START: the boards after each placement before the first stuck point (candidate position strings).
  const pathBoards: string[] = []
  const withBoards = <T extends object>(o: T) => (START ? { ...o, boards: pathBoards } : o)
  const board: Board = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(p[r * 9 + c])))
  const givens = board.map((row) => row.map((v) => v !== 0))
  const res = new SudokuSolver().solve(board)
  if (res.status !== 'solved') return { puzzle: p, ok: false, stuck: 0, reason: 'not uniquely solvable' }
  const sol = res.board!
  const cands: CandidateGrid = board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
  let stuckAtStart = false, firstStuck: string | null = null, firstStuckKey = '', firstStuckRows: string[] = [], stuck = 0, unsound = 0, steps = 0
  for (; steps < 3000; steps++) {
    if (board.every((row) => row.every((v) => v !== 0))) break
    if (Date.now() - t0 > PUZZLE_BUDGET_MS) return withBoards({ puzzle: p, ok: false, stuck, reason: 'time budget' })
    // Cheapest first: Dynamic Dragon is only computed when nothing else applies, Double Dynamic only when
    // single Dynamic is stuck too.
    let inst = techniques(board, cands, givens, 'easy')
    if (!inst.length) inst = techniques(board, cands, givens, 'dynamic')
    if (strict && steps === 0 && inst.length) return { puzzle: p, ok: false, stuck: 0, reason: 'not stuck at the start' }
    if (!inst.length) {
      inst = techniques(board, cands, givens, 'ddd')
      if (!inst.length) return withBoards({ puzzle: p, ok: false, stuck: stuck + 1, reason: 'stuck even with Double Dynamic', steps })
      if (inst.some((i) => !i.id.startsWith('double-dynamic-dragon'))) return withBoards({ puzzle: p, ok: false, stuck: stuck + 1, reason: 'non-DDD row appeared only with DDD on' })
      if (INDEPENDENT) {
        inst = inst.filter((i) => i.moves && isIndependentDoubleDragon(i.moves))
        if (!inst.length) return withBoards({ puzzle: p, ok: false, stuck: stuck + 1, reason: 'no independent Double Dynamic', steps })
      }
      if (!firstStuck) {
        firstStuck = await new PuzzleImporter().exportToSudokuCoachState(board, givens, cands)
        firstStuckKey = board.flat().join('') + cands.flat().map((c) => c.map((x) => (x ? 1 : 0)).join('')).join('')
        firstStuckRows = inst.map((i) => `${i.name}: ${i.notation}`)
        stuckAtStart = steps === 0
      }
      stuck++
    }
    // Simplest row whose application changes the grid (some rows can carry no effect - skipped).
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
      if (START && !stuck && chosen.solvedCandidates.length) pathBoards.push(board.flat().join(''))
      applied = true
      break
    }
    if (!applied) return withBoards({ puzzle: p, ok: false, stuck, reason: 'only no-op rows left', steps })
  }
  const solved = board.every((row, r) => row.every((v, c) => v === sol[r][c]))
  const ok = solved && unsound === 0 && stuck > 0 && (!START || stuckAtStart)
  return withBoards({ puzzle: p, ok, reason: ok || !START || !solved || unsound ? undefined : 'not stuck at the start', solved, unsound, steps, stuck, ms: Date.now() - t0, firstStuck, firstStuckKey, firstStuckRows })
}

function writeList(hits: any[]) {
  const lines = [
    `# Double Dynamic Dragon puzzles - ${PROFILE} (reference list; nothing in the app loads this file)`,
    '#',
    `# Settings: ${PROFILE}. That is: Dynamic Dragon techniques = the default set (no AICs of any kind, no fish,`,
    `# no ALS-xz, no Avoidable Rectangle), "Limit to 1 AIC per step" ON, "Max techniques per step" = ${MAX_TECH === Infinity ? 'unlimited' : MAX_TECH},`,
    ...(ALL_ON
      ? [
          '# Exhaustive Dragon Colouring ON, Optimize OFF; standalone Short AIC, Short Single-Digit AIC, Generic AIC,',
          '# every fish, ALS-xz and Double (plain) Dragon ON; Sue-de-Coq (the only exotic technique) OFF.',
        ]
      : [
          '# Exhaustive Dragon Colouring ON, Optimize OFF; standalone AICs, fish, ALS-xz, Double (plain) Dragon and exotic',
          '# techniques OFF.',
        ]),
    '#',
    "# Each puzzle was verified through the app's own engine (buildTechniqueInstances), always applying the simplest row:",
    ...(START
      ? [
          '#  - the string is itself the stuck position: imported as a puzzle (candidates autofilled), nothing applies right',
          '#    away with Double Dynamic Dragon OFF (single Dynamic Dragon is stuck on every chain, nothing else applies);',
        ]
      : ['#  - with Double Dynamic Dragon OFF it gets stuck (single Dynamic Dragon is stuck on every chain, nothing else applies);']),
    '#  - with Double Dynamic Dragon ON, only Double Dynamic rows appear at each such point, and the whole puzzle is',
    '#    solved with no guessing, every step checked against the real solution.',
    ...(INDEPENDENT
      ? [
          '#  - independent second Dragon: at every such point at least one Double Dynamic row starts its second Medusa on',
          '#    no candidate the first Dragon coloured (a cell may be shared, with a different digit), and one of those is',
          '#    what was applied. Rows listed below are those independent ones.',
        ]
      : []),
    '#',
    // START lists: the string is the stuck position itself, so no separate state is needed.
    ...(START
      ? ['# "puzzle" = the stuck position itself (81 chars, 0 = empty) - import it into the app with the settings above.']
      : [
          '# "puzzle" = the clues (81 chars, 0 = empty). "stuck at" = the first stuck position as a Sudoku.Coach state',
          '# (board, givens and candidates) - import it into the app, or import the puzzle string and solve up to it.',
        ]),
    '#',
    `# Count: ${hits.length}`,
    '',
  ]
  hits.forEach((h, i) => {
    lines.push(`${i + 1}. puzzle: ${h.puzzle}`)
    lines.push(`   Double Dynamic needed ${h.stuck} time${h.stuck === 1 ? '' : 's'}; solved in ${h.steps} steps with no guessing`)
    lines.push(`   at the first stuck position: ${h.firstStuckRows[0]}${h.firstStuckRows.length > 1 ? ` (+${h.firstStuckRows.length - 1} more Double Dynamic rows)` : ''}`)
    if (!START) lines.push(`   stuck at: ${h.firstStuck}`)
    lines.push('')
  })
  fs.writeFileSync(LIST, lines.join('\n'))
}

if (isMainThread) {
  const nWorkers = Number(process.argv[2] ?? 4)
  const maxLevel = Number(process.argv[3] ?? 2)
  const solver = new SudokuSolver()
  const jsonl = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const tried = jsonl(OUT)
  const done = new Set<string>(tried.map((l) => l.puzzle))
  const hits: any[] = jsonl(HITS)
  const known = new Set<string>(hits.map((h) => h.firstStuckKey))
  const perRoot = new Map<string, number>()
  for (const h of hits) perRoot.set(h.root, (perRoot.get(h.root) ?? 0) + 1)
  const rootFull = (root: string) => (perRoot.get(root) ?? 0) >= MAX_PER_ROOT
  const variants = (p: string) => {
    const sol = solver.solve(Array.from({ length: 9 }, (_, r) => [...p.slice(r * 9, r * 9 + 9)].map(Number))).board!.flat()
    return [...p].flatMap((ch, i) => (ch === '0' ? [p.slice(0, i) + sol[i] + p.slice(i + 1)] : []))
  }
  const examples = fs.readFileSync(ROOT + 'double-dynamic-dragon-examples.txt', 'utf8').split('## S4')[0]
  // allon3: the other profiles' hits first - puzzles already known to need Double Dynamic with default techniques.
  // They keep their original seed as root, so MAX_PER_ROOT still spreads the hits over different puzzles.
  const priorHits = ALL_ON
    ? [...(INDEPENDENT ? jsonl(DIR + 'ddd-allon3-hits.jsonl') : []), ...['defaults', 'tech1', 'light'].flatMap((m) => [...jsonl(DIR + `ddd-${m}-hits.jsonl`), ...jsonl(DIR + `ddd-${m}-hits-independent.jsonl`)])]
    : []
  const priorRoot = new Map<string, string>(priorHits.map((h) => [h.puzzle, h.root ?? h.puzzle]))
  const priorSeeds = priorHits.map((h) => h.puzzle)
  const seeds = [
    ...new Set([
      ...priorSeeds,
      ...[...examples.matchAll(/puzzle: (\d{81})/g)].map((m) => m[1]),
      ...fs.readFileSync(DIR + 'all-hard.txt', 'utf8').split(/\s+/).filter((s) => s.length === 81),
      // EXTRA_SEEDS: an absolute path to a further corpus (e.g. the forum hardest lists), screened after these.
      ...(process.env.EXTRA_SEEDS ? fs.readFileSync(process.env.EXTRA_SEEDS, 'utf8').split(/\s+/).filter((s) => s.length === 81) : []),
    ]),
  ]
  const queue: { p: string; level: number; root: string; pos?: boolean }[] = seeds.map((p) => ({ p, level: 0, root: priorRoot.get(p) ?? p }))
  // Resuming: re-expand the stuck puzzles found last time (variants go to the front - they're far likelier).
  const resumed: { p: string; level: number; root: string }[] = []
  for (const l of tried) if (l.stuck && l.level < maxLevel && !rootFull(l.root)) for (const v of variants(l.puzzle)) resumed.push({ p: v, level: l.level + 1, root: l.root })
  queue.unshift(...resumed)
  let next = 0, finished = 0, inFlight = 0, stuckCount = 0
  console.log(new Date().toISOString(), `${MODE}: hits ${hits.length}/${TARGET}, seeds ${seeds.length}, queued ${queue.length}, already done ${done.size}`)
  if (hits.length) writeList(hits)
  if (hits.length >= TARGET) process.exit(0)
  const workers: Worker[] = []
  const stop = (why: string) => {
    console.log(new Date().toISOString(), why)
    for (const w of workers) void w.terminate()
    process.exit(0)
  }
  // INDEPENDENT: outcomes the plain run already settled for good (see PLAIN_OUT above).
  const cache = new Map<string, any>()
  if (START) {
    // Only what can't yield a candidate string either: never stuck (no board on its path needs Double Dynamic) or
    // not uniquely solvable.
    for (const l of jsonl(PLAIN_OUT)) if (!l.ok && (!l.stuck || l.reason === 'not uniquely solvable')) cache.set(l.puzzle, l)
  } else if (INDEPENDENT) {
    for (const l of jsonl(PLAIN_OUT)) {
      if (!l.ok && (!l.stuck || ['stuck even with Double Dynamic', 'non-DDD row appeared only with DDD on', 'not uniquely solvable'].includes(l.reason))) cache.set(l.puzzle, l)
    }
  }
  const feed = (w: Worker) => {
    for (;;) {
      while (next < queue.length && (done.has(queue[next].p) || rootFull(queue[next].root))) next++
      const c = next < queue.length ? cache.get(queue[next].p) : undefined
      if (!c) break
      const t = queue[next++]
      done.add(t.p)
      handle({ ...c, puzzle: t.p, level: t.level, root: t.root })
    }
    if (next < queue.length) {
      done.add(queue[next].p)
      inFlight++
      w.postMessage(queue[next++])
    } else if (inFlight === 0) stop(`queue empty - finished ${finished}, hits ${hits.length}/${TARGET}`)
    else setTimeout(() => feed(w), 5000)
  }
  for (let i = 0; i < nWorkers; i++) {
    const w = new Worker(new URL(import.meta.url), { env: { ...process.env } })
    workers.push(w)
    w.on('message', (m: any) => {
      inFlight--
      handle(m)
      feed(w)
    })
    feed(w)
  }
  function handle(m: any) {
      finished++
      fs.appendFileSync(OUT, JSON.stringify({ puzzle: m.puzzle, level: m.level, root: m.root, pos: m.pos || undefined, stuck: m.stuck ?? 0, ok: m.ok, reason: m.reason, ms: m.ms }) + '\n')
      if (m.stuck && !m.pos) {
        stuckCount++
        // START: this puzzle's boards up to its first stuck point, nearest it first, go straight to the front.
        if (START && m.boards && !rootFull(m.root)) {
          const fresh = [...new Set<string>(m.boards)].reverse().filter((b) => !done.has(b))
          queue.splice(next, 0, ...fresh.map((b) => ({ p: b, level: m.level, root: m.root, pos: true })))
        }
        // Variants of a stuck puzzle go to the front of the queue, depth-first-ish.
        if (m.level < maxLevel && !rootFull(m.root)) queue.splice(next, 0, ...variants(m.puzzle).filter((v) => !done.has(v)).map((v) => ({ p: v, level: m.level + 1, root: m.root })))
      }
      if (m.ok && !known.has(m.firstStuckKey) && !rootFull(m.root)) {
        known.add(m.firstStuckKey)
        perRoot.set(m.root, (perRoot.get(m.root) ?? 0) + 1)
        hits.push(m)
        fs.appendFileSync(HITS, JSON.stringify(m) + '\n')
        writeList(hits)
        console.log(new Date().toISOString(), `HIT ${hits.length}/${TARGET}`, m.puzzle, m.firstStuckRows[0])
        if (hits.length >= TARGET) stop('target reached')
      }
      if (finished % 25 === 0) console.log(new Date().toISOString(), `finished ${finished}, stuck ${stuckCount}, queued ${queue.length - next}, hits ${hits.length}/${TARGET}`)
  }
} else {
  parentPort!.on('message', async (task: { p: string; level: number; root: string; pos?: boolean }) => {
    let r: any
    try {
      r = await verify(task.p, START && !!task.pos)
    } catch (e) {
      r = { puzzle: task.p, ok: false, stuck: 0, reason: 'error: ' + String(e) }
    }
    parentPort!.postMessage({ ...r, boards: task.pos ? undefined : r.boards, level: task.level, root: task.root, pos: task.pos })
  })
}
