// Mine example positions whose next move is a Reverse BUG and that have no single.
// Build: npx rolldown dragon-research/reverse-bug/examples.ts --format esm --platform node -o dragon-research/reverse-bug/.out/examples.mjs
// Run:   node dragon-research/reverse-bug/.out/examples.mjs [maxExamples]
//
// Walks Easy-Solve paths over top1465 and all-hard. A path state qualifies when
// a proper (n <= 7) Reverse BUG applies and there is no naked/hidden single.
// The position (every placed digit) is then re-checked as a stand-alone
// 81-char puzzle with fresh autofilled candidates - what importing the string
// gives - where every placed digit is a given, so the Sudopedia form applies.
import fs from 'fs'
import { buildTechniqueInstances, fullTechniqueEffect, pickEasiestInstance, singleFinder } from '../../src/techniqueEngine'
import { SudokuReverseBugFinder } from '../../src/sudoku/SudokuReverseBugFinder'
import { SudokuSolver } from '../../src/sudoku/SudokuSolver'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
import type { Board, CandidateGrid } from '../../src/sudoku/types'

const maxExamples = Number(process.argv[2] ?? 40)
const solver = new SudokuSolver()
const rb = new SudokuReverseBugFinder()
const cellName = ([r, c]: readonly [number, number]) => `r${r + 1}c${c + 1}`

const parse = (line: string): Board => Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(line[r * 9 + c]) || 0))
const autofill = (board: Board): CandidateGrid =>
  board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
const hasSingle = (board: Board, cands: CandidateGrid) => singleFinder.findNakedAndHiddenSingles(board, cands).length > 0

const lines = ['top1465.txt', 'all-hard.txt'].flatMap((f) =>
  fs.readFileSync(`dragon-research/data/${f}`, 'utf8').trim().split(/\s+/).filter((l) => l.length === 81),
)
const out: object[] = []
for (const line of lines) {
  if (out.length >= maxExamples) break
  const puzzle = parse(line)
  const solution = solver.solve(puzzle).board
  if (!solution) continue
  const board = puzzle.map((row) => [...row])
  const cands = autofill(board)
  for (let step = 0; step < 250; step++) {
    const instances = buildTechniqueInstances(board, cands, 0, undefined, true, true, true, false, false, false, false, false)
    if (instances.length === 0) break
    if (!hasSingle(board, cands) && rb.findReverseBug(board, cands, null, 'solved').some((h) => h.size < 8)) {
      // Re-check as an imported string.
      const position = board.flat().join('')
      const fresh = autofill(board)
      const hits = rb.findReverseBug(board, fresh, null, 'solved').filter((h) => h.size < 8)
      if (!hasSingle(board, fresh) && hits.length > 0 && solver.solve(board).solved) {
        const freshInstances = buildTechniqueInstances(board, fresh, 0, undefined, true, true, true, false, false, false, false, false)
        const easiest = pickEasiestInstance(freshInstances)
        out.push({
          position,
          from: line,
          placed: board.flat().filter((v) => v).length,
          easiestOther: easiest ? `${easiest.name} (rank ${easiest.techniqueRank}): ${easiest.notation}` : 'none',
          hits: hits.map((h) => ({
            eliminate: `r${h.eliminated.row + 1}c${h.eliminated.col + 1} is not ${h.eliminated.digit}`,
            digits: h.digits,
            n: h.size,
            pattern: h.patternCells.map((c) => `${cellName(c)}=${c[0] === h.eliminated.row && c[1] === h.eliminated.col ? h.eliminated.digit : board[c[0]][c[1]]}`).join(' '),
            candidatesInCell: fresh[h.eliminated.row][h.eliminated.col].flatMap((on, d) => (on ? [d + 1] : [])).join(''),
            sound: solution[h.eliminated.row][h.eliminated.col] !== h.eliminated.digit,
          })),
        })
        break // one per puzzle
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
}
console.log(JSON.stringify(out, null, 1))
