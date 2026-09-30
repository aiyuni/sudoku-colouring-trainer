// Decodes a puzzle string and prints its non-bivalue cells and per-unit digit counts.
// Build: npx rolldown dragon-research/bug-n/decode.ts --format esm --platform node -o dragon-research/bug-n/.out/decode.mjs
import { PuzzleImporter } from '../../src/sudoku/PuzzleImporter'
const text = process.argv[2]
const result = await new PuzzleImporter().import(text)
if (!result.ok) throw new Error(result.error)
const { board, candidates, givens } = result
console.log(board.map((r) => r.join('')).join(''))
console.log(givens.map((r) => r.map((g) => (g ? '1' : '0')).join('')).join(''))
for (let r = 0; r < 9; r++) {
  const cells = []
  for (let c = 0; c < 9; c++) {
    cells.push(board[r][c] ? `[${board[r][c]}]` : candidates[r][c].map((m, d) => (m ? d + 1 : '')).join(''))
  }
  console.log(cells.map((s) => s.padEnd(6)).join(''))
}
