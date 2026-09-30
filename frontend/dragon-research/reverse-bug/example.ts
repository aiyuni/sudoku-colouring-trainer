// Sudopedia's Reverse BUG example: expects 1 eliminated from r1c3 (digits 1, 2).
import { SudokuReverseBugFinder } from '../../src/sudoku/SudokuReverseBugFinder'
const text = `189 7 18 2 4 5 3 19 6
6 3 2 1 8 9 4 5 7
19 5 4 3 7 6 129 129 8
1238 1289 1378 5 6 12 129 78 4
124 1249 6 8 12 7 5 1239 39
5 128 178 9 3 4 6 78 12
7 128 138 6 5 12 1289 4 39
123 6 9 4 12 8 7 123 5
1248 1248 5 7 9 3 128 6 12`
const cells = text.split('\n').map((l) => l.trim().split(/\s+/))
const board = cells.map((row) => row.map((s) => (s.length === 1 ? Number(s) : 0)))
const cands = cells.map((row) => row.map((s) => Array.from({ length: 9 }, (_, d) => s.length > 1 && s.includes(String(d + 1)))))
const f = new SudokuReverseBugFinder()
for (const h of f.find(board, cands, null, 'solved')) console.log(h.kind, `${h.eliminated.digit}r${h.eliminated.row + 1}c${h.eliminated.col + 1}`, h.digits, h.patternCells.map(([r, c]) => `r${r + 1}c${c + 1}`).join(' '))
// Lite example: rows 1-2 "1..|2..|3.." / "3..|1..|..." -> r2c7 is not 2.
const lb = Array.from({ length: 9 }, () => Array(9).fill(0)); lb[0][0] = 1; lb[0][3] = 2; lb[0][6] = 3; lb[1][0] = 3; lb[1][3] = 1
const lc = lb.map((row) => row.map((v) => Array.from({ length: 9 }, () => v === 0)))
for (const h of f.findReverseBugLite(lb, lc, null, 'solved')) console.log(h.kind, `${h.eliminated.digit}r${h.eliminated.row + 1}c${h.eliminated.col + 1}`, h.digits)
