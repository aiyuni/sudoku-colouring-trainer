// Fills both stocks to TARGET: strict Dynamic-only (no plain/double Dragon, AIC, fish, ALS-xz) and Double Dragon.
import fs from 'fs'
import { Worker, isMainThread, parentPort } from 'worker_threads'
import { SudokuDragonPuzzleGenerator } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonPuzzleGenerator'
import { classify, STRICT } from './classify'

const DIR = 'C:/Git/sudoku-solver/frontend/dragon-stock-pending/'
const FILES = { 'dynamic-only': DIR + 'stock-dynamic-only.txt', double: DIR + 'stock-double.txt' } as const
const TARGET = 42
const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\s+/).filter((s) => s.length === 81) : [])

if (isMainThread) {
  const have = { 'dynamic-only': new Set(read(FILES['dynamic-only'])), double: new Set(read(FILES.double)) }
  const status = () => `dynamic-only ${have['dynamic-only'].size}/${TARGET}, double ${have.double.size}/${TARGET}`
  const accept = (p: string) => {
    if (have['dynamic-only'].has(p) || have.double.has(p)) return
    const kind = classify(p)
    console.log(new Date().toISOString(), p, kind ?? 'rejected')
    if (kind && have[kind].size < TARGET) {
      have[kind].add(p)
      fs.appendFileSync(FILES[kind], p + '\n')
    }
    console.log('  ', status())
    if (have['dynamic-only'].size >= TARGET && have.double.size >= TARGET) {
      console.log('done')
      process.exit(0)
    }
  }
  for (const p of process.argv.slice(2)) accept(p)
  console.log(new Date().toISOString(), 'start:', status())
  for (let i = 0; i < 14; i++) new Worker(new URL(import.meta.url)).on('message', accept)
} else {
  const g = new SudokuDragonPuzzleGenerator()
  for (;;) {
    const r = g.generateBlocking({ ...STRICT, requireDynamic: true, forbidPlainDragon: true, timeBudgetMs: 60000 })
    if (r) parentPort!.postMessage(r.board.flat().join(''))
  }
}
