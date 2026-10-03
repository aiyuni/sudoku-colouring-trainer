// Turns the allon3 hunt's hits (ddd-settings-hunt.ts, MODE=allon3) into 81-char *position* strings - the user's
// request (2026-10-03): the string itself must satisfy the criteria, not the puzzle's starting clues. A plain
// digit string carries no removed candidates, so importing it autofills them: the stuck position itself usually
// gets easier rows back. So every board along the hit's own solve path (one per placed digit) is tried, read as
// a fresh puzzle (every filled cell a clue): it qualifies when, right away, nothing but Double Dynamic rows apply
// (independent ones, with INDEPENDENT=1), and solving on from there - same rules as the hunt - finishes with no
// guessing, every step checked against the solution. The qualifying board with the fewest digits is kept.
//   npx rolldown dragon-research/ddd-stuck-strings.ts --format esm --platform node -o <tmp>/ddd-stuck-strings.mjs
//   INDEPENDENT=1 node <tmp>/ddd-stuck-strings.mjs <workers>
// Output: data/ddd-allon3-positions<-independent>.jsonl (one record per hit, resumable) and the readable list
// frontend/double-dynamic-dragon-allon3<-independent>-positions.txt.
import fs from 'fs'
import { Worker, isMainThread, parentPort } from 'worker_threads'
import { buildTechniqueInstances, type TechniqueInstance } from 'C:/Git/sudoku-solver/frontend/src/techniqueEngine'
import { DEFAULT_RULE3_TECHNIQUES } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonFinder'
import { ALL_FISH_TECHNIQUES } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuFishFinder'
import { SudokuSolver } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuSolver'
import { SudokuRules } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuRules'
import type { Board, CandidateGrid } from 'C:/Git/sudoku-solver/frontend/src/sudoku/types'
import { isIndependentDoubleDragon } from './independent'

const ROOT = 'C:/Git/sudoku-solver/frontend/'
const DIR = ROOT + 'dragon-research/data/'
const INDEPENDENT = process.env.INDEPENDENT === '1'
const SUFFIX = INDEPENDENT ? '-independent' : ''
const HITS = DIR + `ddd-allon3-hits${SUFFIX}.jsonl`
const OUT = DIR + `ddd-allon3-positions${SUFFIX}.jsonl`
const LIST = ROOT + `double-dynamic-dragon-allon3${SUFFIX}-positions.txt`

type Ref = { row: number; col: number; digit: number }
type Stage = 'easy' | 'dynamic' | 'ddd'
const RULE3 = new Set(DEFAULT_RULE3_TECHNIQUES)
const FISH = new Set(ALL_FISH_TECHNIQUES)

// The allon3 profile: every standalone technique on except Sue-de-Coq, default Dynamic Dragon techniques, AIC limit
// on, Exhaustive on, Optimize off, max 3 techniques per Dragon step.
const techniques = (board: Board, cands: CandidateGrid, givens: boolean[][], stage: Stage): TechniqueInstance[] =>
  buildTechniqueInstances(board, cands, 0, RULE3, true, true, true, true, true, false, false,
    stage !== 'easy', FISH, true, 3, true, stage === 'ddd', givens)

const parse = (p: string): Board => Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(p[r * 9 + c])))
const autofill = (board: Board): CandidateGrid =>
  board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))

function apply(board: Board, cands: CandidateGrid, elim: Ref[], solved: Ref[]) {
  for (const e of elim) cands[e.row][e.col][e.digit - 1] = false
  for (const s of solved) {
    if (board[s.row][s.col] !== 0) continue
    board[s.row][s.col] = s.digit
    cands[s.row][s.col] = Array(9).fill(false)
    SudokuRules.eliminatePeerCandidates(cands, board, s.row, s.col, s.digit)
  }
}

// Solves p the hunt's way. requireStuckAtStart: fail as soon as the first position isn't a Double-Dynamic-only one.
// Returns the board after every placement too (the candidate positions).
function solve(p: string, requireStuckAtStart: boolean) {
  const board = parse(p)
  const givens = board.map((row) => row.map((v) => v !== 0))
  const sol = new SudokuSolver().solve(board.map((r) => [...r])).board!
  const cands = autofill(board)
  const boards: string[] = []
  let stuck = 0, unsound = 0, steps = 0, firstRows: string[] = []
  for (; steps < 3000; steps++) {
    if (board.every((row) => row.every((v) => v !== 0))) break
    let inst = techniques(board, cands, givens, 'easy')
    if (!inst.length) inst = techniques(board, cands, givens, 'dynamic')
    if (inst.length && requireStuckAtStart && steps === 0) return { ok: false, reason: 'not stuck at the start' }
    if (!inst.length) {
      inst = techniques(board, cands, givens, 'ddd')
      if (!inst.length) return { ok: false, reason: 'stuck even with Double Dynamic' }
      if (inst.some((i) => !i.id.startsWith('double-dynamic-dragon'))) return { ok: false, reason: 'non-DDD row appeared only with DDD on' }
      if (INDEPENDENT) {
        inst = inst.filter((i) => i.moves && isIndependentDoubleDragon(i.moves))
        if (!inst.length) return { ok: false, reason: 'no independent Double Dynamic' }
      }
      if (!stuck) firstRows = inst.map((i) => `${i.name}: ${i.notation}`)
      stuck++
    }
    const ordered = [...inst].sort((a, b) => a.techniqueRank - b.techniqueRank)
    let applied = false
    for (const chosen of ordered) {
      const before = JSON.stringify([board, cands])
      const b2 = board.map((r) => [...r]), c2 = cands.map((r) => r.map((x) => [...x]))
      apply(b2, c2, chosen.eliminatedCandidates, chosen.solvedCandidates)
      if (JSON.stringify([b2, c2]) === before) continue
      for (const e of chosen.eliminatedCandidates) if (sol[e.row][e.col] === e.digit) unsound++
      for (const x of chosen.solvedCandidates) if (sol[x.row][x.col] !== x.digit) unsound++
      const placed = chosen.solvedCandidates.length > 0
      apply(board, cands, chosen.eliminatedCandidates, chosen.solvedCandidates)
      if (placed) boards.push(board.flat().join(''))
      applied = true
      break
    }
    if (!applied) return { ok: false, reason: 'only no-op rows left' }
  }
  const solved = board.every((row, r) => row.every((v, c) => v === sol[r][c]))
  return { ok: solved && unsound === 0 && stuck > 0, reason: solved ? (unsound ? 'unsound' : undefined) : 'not solved', steps, stuck, firstRows, boards }
}

function find(puzzle: string) {
  const path = solve(puzzle, false)
  if (!path.ok || !path.boards) return { puzzle, ok: false, reason: 'hit no longer verifies: ' + path.reason }
  // Fewest digits first (most puzzle left), then the original puzzle's last boards.
  const tried = new Set<string>()
  for (const b of path.boards) {
    if (tried.has(b) || !b.includes('0')) continue
    tried.add(b)
    const r = solve(b, true)
    if (r.ok) return { puzzle, ok: true, position: b, clues: [...b].filter((ch) => ch !== '0').length, tried: tried.size, steps: r.steps, stuck: r.stuck, firstRows: r.firstRows }
  }
  return { puzzle, ok: false, reason: 'no position along the solve path qualifies', tried: tried.size }
}

function writeList(recs: any[]) {
  const ok = recs.filter((r) => r.ok)
  const lines = [
    `# Double Dynamic Dragon positions${INDEPENDENT ? ' (independent second Dragon)' : ''} - 81-char strings (reference list; nothing in the app loads this file)`,
    '#',
    '# Settings: every technique ON except Sue-de-Coq (Short AIC, Short Single-Digit AIC, Generic AIC, every fish,',
    '# ALS-xz, Double (plain) Dragon); Dynamic Dragon techniques = the default set, "Limit to 1 AIC per step" ON,',
    '# "Max techniques per step" = 3, Exhaustive Dragon Colouring ON, Optimize OFF.',
    '#',
    '# Each string is a mid-solve position of a hunt hit (every filled cell read as a clue, candidates autofilled):',
    '#  - right away nothing applies except Double Dynamic Dragon rows (with it OFF the Techniques list is empty);',
    ...(INDEPENDENT ? ['#  - at least one of them is independent (its second Medusa starts on no candidate the first Dragon coloured);'] : []),
    "#  - solving on through the app's own engine (simplest row first, Double Dynamic only where nothing else applies",
    `#    - ${INDEPENDENT ? 'an independent one each time' : 'each time'}) finishes with no guessing, every step checked against the solution.`,
    '#',
    `# Count: ${ok.length}`,
    '',
  ]
  ok.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.position}`)
    lines.push(`   ${r.clues} clues; Double Dynamic needed ${r.stuck} time${r.stuck === 1 ? '' : 's'}; from puzzle ${r.puzzle}`)
    lines.push(`   first row: ${r.firstRows[0]}${r.firstRows.length > 1 ? ` (+${r.firstRows.length - 1} more)` : ''}`)
    lines.push('')
  })
  fs.writeFileSync(LIST, lines.join('\n'))
}

if (isMainThread) {
  const jsonl = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const recs = jsonl(OUT)
  const done = new Set(recs.map((r) => r.puzzle))
  const todo = jsonl(HITS).map((h) => h.puzzle).filter((p) => !done.has(p))
  console.log(`${todo.length} hits to convert (${done.size} done)`)
  writeList(recs)
  let next = 0
  const n = Math.min(Number(process.argv[2] ?? 4), todo.length)
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL(import.meta.url))
    const feed = () => (next < todo.length ? w.postMessage(todo[next++]) : void w.terminate())
    w.on('message', (r: any) => {
      recs.push(r)
      fs.appendFileSync(OUT, JSON.stringify(r) + '\n')
      writeList(recs)
      console.log(new Date().toISOString(), r.ok ? `OK ${r.position} (${r.clues} clues, tried ${r.tried})` : `FAIL ${r.puzzle} ${r.reason}`)
      feed()
    })
    feed()
  }
} else {
  parentPort!.on('message', (p: string) => {
    let r: any
    try {
      r = find(p)
    } catch (e) {
      r = { puzzle: p, ok: false, reason: 'error: ' + String(e) }
    }
    parentPort!.postMessage(r)
  })
}
