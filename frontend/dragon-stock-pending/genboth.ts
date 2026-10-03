// Fills both stocks to their TARGET: strict Dynamic-only (no plain/double Dragon, AIC, fish, ALS-xz) and Double Dragon.
import fs from 'fs'
import { Worker, isMainThread, parentPort } from 'worker_threads'
import { SudokuDragonPuzzleGenerator } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonPuzzleGenerator'
import { classify, STRICT } from './classify'

const DIR = 'C:/Git/sudoku-solver/frontend/dragon-stock-pending/'
const FILES = { 'dynamic-only': DIR + 'stock-dynamic-only.txt', double: DIR + 'stock-double.txt' } as const
// Per stock: Dynamic-only is full at 42; Double Dragon raised to 69 (2026-10-01, by request).
const TARGET = { 'dynamic-only': 42, double: Number(process.env.DOUBLE_TARGET ?? 69) } as const
const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\s+/).filter((s) => s.length === 81) : [])

if (isMainThread) {
  const have = { 'dynamic-only': new Set(read(FILES['dynamic-only'])), double: new Set(read(FILES.double)) }
  const status = () => `dynamic-only ${have['dynamic-only'].size}/${TARGET['dynamic-only']}, double ${have.double.size}/${TARGET.double}`
  const accept = (p: string) => {
    if (have['dynamic-only'].has(p) || have.double.has(p)) return
    const kind = classify(p)
    console.log(new Date().toISOString(), p, kind ?? 'rejected')
    if (kind && have[kind].size < TARGET[kind]) {
      have[kind].add(p)
      fs.appendFileSync(FILES[kind], p + '\n')
    }
    console.log('  ', status())
    if (have['dynamic-only'].size >= TARGET['dynamic-only'] && have.double.size >= TARGET.double) {
      console.log('done')
      process.exit(0)
    }
  }
  for (const p of process.argv.slice(2)) accept(p)
  console.log(new Date().toISOString(), 'start:', status())
  for (let i = 0; i < Number(process.env.WORKERS ?? 14); i++) new Worker(new URL(import.meta.url)).on('message', accept)
} else {
  const g = new SudokuDragonPuzzleGenerator()
  for (;;) {
    const r = g.generateBlocking({ ...STRICT, requireDynamic: true, forbidPlainDragon: true, timeBudgetMs: 60000 })
    if (r) parentPort!.postMessage(r.board.flat().join(''))
  }
}
