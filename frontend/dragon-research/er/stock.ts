import { DYNAMIC_DRAGON_PUZZLE_STOCK } from '../../src/sudoku/dynamicDragonPuzzleStockData'
import { DOUBLE_DRAGON_PUZZLE_STOCK } from '../../src/sudoku/doubleDragonPuzzleStockData'
import { DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK } from '../../src/sudoku/doubleDynamicDragonPuzzleStockData'
import { PuzzleImporter } from '../../src/sudoku/PuzzleImporter'
import { findEmptyRectangles } from '../../src/sudoku/SudokuShortAicFinder'
import { SudokuRules } from '../../src/sudoku/SudokuRules'
const imp = new PuzzleImporter()
for (const [name, stock] of [['dynamic', DYNAMIC_DRAGON_PUZZLE_STOCK], ['double', DOUBLE_DRAGON_PUZZLE_STOCK], ['double dynamic', DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK]] as const) {
  let hits = 0
  for (const s of stock) {
    const r = await imp.import(s)
    if (!r.ok) { console.log('bad', s); continue }
    let cand = r.candidates
    if (!s.startsWith('SCv7')) cand = r.board.map((row, i) => row.map((v, j) => Array.from({ length: 9 }, (_, k) => v === 0 && SudokuRules.isSafe(r.board, i, j, k + 1))))
    if (findEmptyRectangles(r.board, cand).length > 0) hits++
  }
  console.log(name, stock.length, 'with an Empty Rectangle at the start:', hits)
}
