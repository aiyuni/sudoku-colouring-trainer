// Mines Avoidable Rectangle Type 2 lesson positions: solve paths over top1465 and
// all-hard; a state qualifies when Type 2 applies and nothing below Avoidable
// Rectangle (Singles .. BUG+1) does. Prints the position, the clues and the
// "removed marks" string decodePuzzleState needs to reproduce the candidates.
// Build: npx rolldown dragon-research/avoidable-rectangle/type2-lessons.ts --format esm --platform node -o dragon-research/avoidable-rectangle/.out/type2-lessons.mjs
// Run:   node dragon-research/avoidable-rectangle/.out/type2-lessons.mjs [max]
import fs from 'fs'
import { avoidableRectangleFinder, buildTechniqueInstances, fullTechniqueEffect, pickEasiestInstance, RANK_AVOIDABLE_RECTANGLE } from '../../src/techniqueEngine'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
import type { Board, CandidateGrid } from '../../src/sudoku/types'

const max = Number(process.argv[2] ?? 5)
const parse = (line: string): Board => Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(line[r * 9 + c]) || 0))
const autofill = (board: Board): CandidateGrid =>
  board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))
const lines = ['top1465.txt', 'all-hard.txt'].flatMap((f) => fs.readFileSync(`dragon-research/data/${f}`, 'utf8').trim().split(/\s+/).filter((l) => l.length === 81))

let found = 0
for (const line of lines) {
  if (found >= max) break
  const puzzle = parse(line)
  const givens = puzzle.map((row) => row.map((v) => v !== 0))
  const board = puzzle.map((row) => [...row])
  const cands = autofill(board)
  for (let step = 0; step < 250 && found < max; step++) {
    const instances = buildTechniqueInstances(board, cands, 0, undefined, true, true, true, false, false, false, false, false, undefined, false, Infinity, false, false, givens)
    if (instances.length === 0) break
    const type2 = avoidableRectangleFinder.find(board, cands, givens).filter((ar) => ar.type === 2)
    const minOther = Math.min(...instances.filter((i) => !i.id.startsWith('avoidable-rectangle-')).map((i) => i.techniqueRank))
    if (type2.length > 0 && minOther > RANK_AVOIDABLE_RECTANGLE) {
      const fresh = autofill(board)
      const removed: string[] = []
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let d = 0; d < 9; d++) if (fresh[r][c][d] && !cands[r][c][d]) removed.push(`r${r + 1}c${c + 1}-${d + 1}`)
      for (const ar of type2) {
        console.log(JSON.stringify({
          position: board.flat().join(''),
          clues: line,
          removed: removed.join(' '),
          removedCount: removed.length,
          cells: ar.cells.map(([r, c]) => `r${r + 1}c${c + 1}`).join(' '),
          eliminations: ar.eliminations.map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`).join(' '),
          reason: ar.reasonText,
        }))
      }
      found++
      break
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
