// Turns a puzzle string (any format the app imports) into the board + removed-marks
// strings a tutorialExamples.ts lesson needs, and shows what BUG+N finds there.
// Build: npx rolldown dragon-research/bug-n/to-lesson.ts --format esm --platform node -o dragon-research/bug-n/.out/to-lesson.mjs
import { PuzzleImporter } from '../../src/sudoku/PuzzleImporter'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
import { SudokuBugPlusNFinder } from '../../src/sudoku/SudokuBugPlusNFinder'
const result = await new PuzzleImporter().import(process.argv[2])
if (!result.ok) throw new Error(result.error)
const { board, candidates } = result
const removed: string[] = []
for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let d = 1; d <= 9; d++) {
  if (board[r][c] === 0 && SudokuRules.isSafe(board, r, c, d) && !candidates[r][c][d - 1]) removed.push(`r${r + 1}c${c + 1}-${d}`)
  if (board[r][c] === 0 && !SudokuRules.isSafe(board, r, c, d) && candidates[r][c][d - 1]) console.log(`extra mark ${d}r${r + 1}c${c + 1}`)
}
console.log(board.flat().join(''))
console.log(JSON.stringify(removed.join(' ')))
console.log(JSON.stringify(new SudokuBugPlusNFinder().find(board, candidates)))
