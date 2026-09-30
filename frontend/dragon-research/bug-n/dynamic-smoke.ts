// Smoke test: the full engine with Dynamic Dragon on over mined positions -
// no crash, every Dynamic Dragon elimination/placement true, and which rows
// lean on BUG+N.
// Build: npx rolldown dragon-research/bug-n/dynamic-smoke.ts --format esm --platform node -o dragon-research/bug-n/.out/dynamic-smoke.mjs
import fs from 'fs'
import { buildTechniqueInstances, fullTechniqueEffect } from '../../src/techniqueEngine'
import { decodePuzzleState } from '../../src/tutorial/puzzleState'
import { SudokuSolver } from '../../src/sudoku/SudokuSolver'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
const rows = fs.readFileSync('dragon-research/bug-n/.out/mined.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))
let checked = 0, wrong = 0, bugRows = 0
for (const row of rows) {
  const base = decodePuzzleState(row.position, row.removed)
  const solution = (new SudokuSolver().solve(base.board) as { board: number[][] }).board
  // Variants: one legal false candidate added to a bivalue cell, so BUG no
  // longer applies directly - Dynamic Dragon may find it under an assumption.
  const variants = [base.candidates]
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (base.board[r][c] !== 0 || base.candidates[r][c].filter(Boolean).length !== 2) continue
    for (let d = 1; d <= 9 && variants.length < 12; d++) {
      if (base.candidates[r][c][d - 1] || d === solution[r][c]) continue
      if (!SudokuRules.isSafe(base.board, r, c, d)) continue
      const v = base.candidates.map((x) => x.map((y) => [...y]))
      v[r][c][d - 1] = true
      variants.push(v)
    }
  }
  for (const cands of variants) {
  const instances = buildTechniqueInstances(base.board, cands, 0, undefined, true, true, true, true, false, false, false, true)
  for (const inst of instances) {
    const effect = fullTechniqueEffect(inst)
    let bad = 0
    for (const e of effect.eliminatedCandidates) if (solution[e.row][e.col] === e.digit) bad++
    for (const s of effect.solvedCandidates) if (solution[s.row][s.col] !== s.digit) bad++
    if (bad) { wrong += bad; console.log('WRONG', inst.name) }
    if (/BUG\+\d/.test(inst.name) && inst.name.startsWith('Dynamic')) { bugRows++; console.log(inst.name) }
  }
  checked++
  }
}
console.log(JSON.stringify({ checked, wrong, bugRows }))
