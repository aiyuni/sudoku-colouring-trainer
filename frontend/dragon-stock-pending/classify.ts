// Classifies positions into the two stocks under the strictest settings.
import fs from 'fs'
import { SudokuDragonPuzzleGenerator, type DragonPuzzleGenerateOptions } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonPuzzleGenerator'
import { ALL_FISH_TECHNIQUES } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuFishFinder'
import { DYNAMIC_DRAGON_PUZZLE_STOCK } from 'C:/Git/sudoku-solver/frontend/src/sudoku/dynamicDragonPuzzleStockData'
import { DOUBLE_DRAGON_PUZZLE_STOCK } from 'C:/Git/sudoku-solver/frontend/src/sudoku/doubleDragonPuzzleStockData'

export const STRICT: DragonPuzzleGenerateOptions = {
  disregardSingleDigitAic: false, disregardAic: false, disregardGenericAic: false,
  enabledFish: [...ALL_FISH_TECHNIQUES], alsXzEnabled: true,
}
const g = new SudokuDragonPuzzleGenerator()
export function classify(p: string): 'dynamic-only' | 'double' | null {
  const b = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(p[r * 9 + c])))
  if (g.checkPuzzleState(b, { ...STRICT, requireDynamic: true, forbidPlainDragon: true, forbidDoubleDragon: true })) return 'dynamic-only'
  if (g.checkPuzzleState(b, { ...STRICT, requireDoubleDragon: true })) return 'double'
  return null
}
if (process.argv[2] === 'existing') {
  const out: Record<string, string[]> = { 'dynamic-only': [], double: [], null: [] }
  for (const p of new Set([...DYNAMIC_DRAGON_PUZZLE_STOCK, ...DOUBLE_DRAGON_PUZZLE_STOCK])) out[String(classify(p))].push(p)
  for (const k of Object.keys(out)) console.log(k, out[k].length)
  fs.writeFileSync('C:/Git/sudoku-solver/frontend/dragon-stock-pending/stock-dynamic-only.txt', out['dynamic-only'].join('\n') + '\n')
  fs.writeFileSync('C:/Git/sudoku-solver/frontend/dragon-stock-pending/stock-double.txt', out.double.join('\n') + '\n')
  console.log('rejected:', out.null)
}
