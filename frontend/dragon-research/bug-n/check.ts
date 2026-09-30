// Checks a lesson position: what BUG+N finds, whether it is sound, and the
// easiest other techniques there.
// Build: npx rolldown dragon-research/bug-n/check.ts --format esm --platform node -o dragon-research/bug-n/.out/check.mjs
// Run:   node dragon-research/bug-n/.out/check.mjs <board81> "<removed marks>"
import { decodePuzzleState } from '../../src/tutorial/puzzleState'
import { buildTechniqueInstances, bugPlusNFinder } from '../../src/techniqueEngine'
import { SudokuSolver } from '../../src/sudoku/SudokuSolver'
const state = decodePuzzleState(process.argv[2], process.argv[3] ?? '')
const bug = bugPlusNFinder.find(state.board, state.candidates)
console.log(JSON.stringify({ n: bug?.n, cells: bug?.cells.map((c) => [c.cell, c.candidates.join(''), c.bugDigit, c.unitKind]), solved: bug?.solved, elims: bug?.eliminations }))
const solution = (new SudokuSolver().solve(state.board) as { board: number[][] }).board
for (const e of bug?.eliminations ?? []) if (solution[e.row][e.col] === e.digit) console.log('WRONG', e)
const instances = buildTechniqueInstances(state.board, state.candidates, 0, undefined, true, true, true, false, false, false, false, false, undefined, false, Infinity, false, false, null)
for (const i of [...instances].sort((a, b) => a.techniqueRank - b.techniqueRank).slice(0, 6)) console.log(i.techniqueRank, i.name, '|', i.notation)
