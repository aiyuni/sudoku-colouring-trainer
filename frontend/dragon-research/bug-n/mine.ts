// Mines BUG+2 / BUG+3 lesson positions from random generated puzzles.
// Build: npx rolldown dragon-research/bug-n/mine.ts --format esm --platform node -o dragon-research/bug-n/.out/mine.mjs
// Run:   node dragon-research/bug-n/.out/mine.mjs [puzzles]
//
// Real solve paths almost never stop in a BUG state (see sweep.ts), so this
// walks random *true* states instead: singles are applied, and whenever
// they run out a random false candidate (per the solution) is removed from a
// cell with 3+ candidates - every state stays consistent with the solution.
// Each state is checked for BUG+N (and its eliminations against the
// solution); a hit is kept when nothing easier than BUG+N applies there,
// printed with the removed-marks string decodePuzzleState needs.
import fs from 'fs'
import { buildTechniqueInstances, bugPlusNFinder, RANK_BUG_PLUS_N } from '../../src/techniqueEngine'
import { SudokuGenerator } from '../../src/sudoku/SudokuGenerator'
import { SudokuSolver } from '../../src/sudoku/SudokuSolver'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
import type { Board, CandidateGrid } from '../../src/sudoku/types'

const puzzles = Number(process.argv[2] ?? 200)
const autofill = (board: Board): CandidateGrid =>
  board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
const place = (board: Board, cands: CandidateGrid, r: number, c: number, d: number) => {
  board[r][c] = d
  cands[r][c] = Array(9).fill(false)
  SudokuRules.eliminatePeerCandidates(cands, board, r, c, d)
}
function applySingles(board: Board, cands: CandidateGrid): boolean {
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (board[r][c] !== 0) continue
    const ds = cands[r][c].flatMap((m, i) => (m ? [i + 1] : []))
    if (ds.length === 1) { place(board, cands, r, c, ds[0]); return true }
  }
  // Hidden singles too, as a real solver would have.
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (board[r][c] !== 0) continue
    for (let d = 1; d <= 9; d++) {
      if (!cands[r][c][d - 1]) continue
      const inRow = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((x) => board[r][x] === 0 && cands[r][x][d - 1]).length
      const inCol = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((x) => board[x][c] === 0 && cands[x][c][d - 1]).length
      const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3
      const inBox = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((x) => board[br + Math.floor(x / 3)][bc + (x % 3)] === 0 && cands[br + Math.floor(x / 3)][bc + (x % 3)][d - 1]).length
      if (inRow === 1 || inCol === 1 || inBox === 1) { place(board, cands, r, c, d); return true }
    }
  }
  return false
}
const generator = new SudokuGenerator()
const solver = new SudokuSolver()
const stats = { puzzles: 0, states: 0, n1: 0, n2: 0, n3: 0, wrong: 0, hits: 0 }
const hits: string[] = []
for (let p = 0; p < puzzles; p++) {
  stats.puzzles++
  const puzzle = generator.generate()
  const solution = (solver.solve(puzzle) as { board: Board }).board
  const board = puzzle.map((row) => [...row])
  const cands = autofill(board)
  const fresh0 = board.map((row) => [...row])
  for (let guard = 0; guard < 400; guard++) {
    while (applySingles(board, cands)) { /* fill singles */ }
    if (board.every((row) => row.every((v) => v !== 0))) break
    stats.states++
    const bug = bugPlusNFinder.find(board, cands)
    if (bug) {
      stats[`n${bug.n}` as 'n1']++
      if (bug.solved && solution[bug.solved.row][bug.solved.col] !== bug.solved.digit) stats.wrong++
      for (const e of bug.eliminations) if (solution[e.row][e.col] === e.digit) stats.wrong++
      if (bug.n >= 2) {
        const instances = buildTechniqueInstances(board, cands, 0, undefined, true, true, true, false, false, false, false, false, undefined, false, Infinity, false, false, null)
        const minOther = Math.min(...instances.filter((i) => !i.id.startsWith('bug-plus-n-')).map((i) => i.techniqueRank))
        if (minOther > RANK_BUG_PLUS_N) {
          stats.hits++
          const fresh = autofill(board)
          const removed: string[] = []
          for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let d = 0; d < 9; d++) if (fresh[r][c][d] && !cands[r][c][d]) removed.push(`r${r + 1}c${c + 1}-${d + 1}`)
          hits.push(JSON.stringify({
            n: bug.n,
            removedCount: removed.length,
            unsolved: board.flat().filter((v) => v === 0).length,
            classic: new Set(bug.cells.map((c) => c.bugDigit)).size === 1,
            allUnits: bug.cells.every((c) => c.unitKind !== null),
            position: board.flat().join(''),
            clues: fresh0.flat().join(''),
            removed: removed.join(' '),
            cells: bug.cells.map(({ cell: [r, c], candidates, bugDigit }) => `r${r + 1}c${c + 1}{${candidates.join('')}}:${bugDigit}`).join(' '),
            eliminations: bug.eliminations.map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`).join(' '),
          }))
        }
      }
    }
    // From a BUG+1 state, build BUG+2/BUG+3 variants: re-add a legal
    // candidate (one the solver could simply not have eliminated yet) to one
    // or two bivalue cells. Still true states - only false marks are added.
    if (bug?.n === 1) {
      const legal: [number, number, number][] = []
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        if (board[r][c] !== 0 || cands[r][c].filter(Boolean).length !== 2) continue
        for (let d = 1; d <= 9; d++) if (!cands[r][c][d - 1] && SudokuRules.isSafe(board, r, c, d)) legal.push([r, c, d])
      }
      const tryVariant = (adds: [number, number, number][]) => {
        if (new Set(adds.map(([r, c]) => `${r},${c}`)).size !== adds.length) return
        const v = cands.map((row) => row.map((cell) => [...cell]))
        for (const [r, c, d] of adds) v[r][c][d - 1] = true
        const b2 = bugPlusNFinder.find(board, v)
        if (!b2 || b2.n < 2) return
        stats[`n${b2.n}` as 'n2']++
        for (const e of b2.eliminations) if (solution[e.row][e.col] === e.digit) stats.wrong++
        const instances = buildTechniqueInstances(board, v, 0, undefined, true, true, true, false, false, false, false, false, undefined, false, Infinity, false, false, null)
        const minOther = Math.min(...instances.filter((i) => !i.id.startsWith('bug-plus-n-')).map((i) => i.techniqueRank))
        if (minOther <= RANK_BUG_PLUS_N) return
        stats.hits++
        const fresh = autofill(board)
        const removed: string[] = []
        for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let d = 0; d < 9; d++) if (fresh[r][c][d] && !v[r][c][d]) removed.push(`r${r + 1}c${c + 1}-${d + 1}`)
        hits.push(JSON.stringify({
          n: b2.n,
          removedCount: removed.length,
          unsolved: board.flat().filter((x) => x === 0).length,
          classic: new Set(b2.cells.map((c) => c.bugDigit)).size === 1,
          allUnits: b2.cells.every((c) => c.unitKind !== null),
          position: board.flat().join(''),
          removed: removed.join(' '),
          cells: b2.cells.map(({ cell: [r, c], candidates, bugDigit }) => `r${r + 1}c${c + 1}{${candidates.join('')}}:${bugDigit}`).join(' '),
          eliminations: b2.eliminations.map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`).join(' '),
        }))
      }
      for (let i = 0; i < legal.length; i++) {
        tryVariant([legal[i]])
        for (let j = i + 1; j < legal.length; j++) tryVariant([legal[i], legal[j]])
      }
    }
    // Remove one random false candidate from a cell with 3+ candidates.
    const options: [number, number, number][] = []
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (board[r][c] !== 0) continue
      const ds = cands[r][c].flatMap((m, i) => (m ? [i + 1] : []))
      if (ds.length >= 3) for (const d of ds) if (d !== solution[r][c]) options.push([r, c, d])
    }
    if (options.length === 0) {
      // All bivalue already: remove a false candidate anywhere to move on.
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (board[r][c] === 0) for (let d = 1; d <= 9; d++) if (cands[r][c][d - 1] && d !== solution[r][c]) options.push([r, c, d])
    }
    const [r, c, d] = options[Math.floor(Math.random() * options.length)]
    cands[r][c][d - 1] = false
  }
  if (p % 50 === 49) console.error(JSON.stringify(stats))
}
fs.mkdirSync('dragon-research/bug-n/.out', { recursive: true })
fs.appendFileSync('dragon-research/bug-n/.out/mined.jsonl', hits.join('\n') + (hits.length ? '\n' : ''))
console.log(JSON.stringify(stats))
