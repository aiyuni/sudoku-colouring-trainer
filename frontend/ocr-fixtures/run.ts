/**
 * OCR regression run: every screenshot in manifest.json through the real
 * ocrGrid (SudokuGridOcr.ts) with the real Tesseract recognizer settings,
 * compared cell by cell - givens, solved digits and pencil marks - against
 * the puzzle string the screenshot was taken from.
 *
 *   npm run test:ocr              every fixture
 *   npm run test:ocr -- 10 11     only fixtures whose file name starts so
 *
 * Exits non-zero if any cell anywhere is wrong. Run it before and after any
 * OCR change: a fix for one screenshot style must not break another.
 *
 * Adding a fixture: drop the PNG here and add { file, puzzle, note } to
 * manifest.json, `puzzle` being the Sudoku.Coach "SCv7_32_..." string (or
 * anything else PuzzleImporter reads) of exactly the position shown.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorker, PSM } from 'tesseract.js'
import { PuzzleImporter } from '../src/sudoku/PuzzleImporter'
import { ocrGrid } from '../src/sudoku/SudokuGridOcr'
import type { Board, CandidateGrid } from '../src/sudoku/types'
import { NodeGridImage } from './NodeGridImage'

interface Fixture {
  file: string
  puzzle: string
  note: string
  /** Cells where the screenshot itself differs from `puzzle` (the string was
   * saved a step apart from the screenshot), as "r3c1" -> what the image
   * shows: "14678" for pencil marks, "[5]" for a solved digit. */
  imageOverrides?: Record<string, string>
}

// The bundle is written to ocr-fixtures/.out/, so the fixtures are one up.
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest: Fixture[] = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'))
const only = process.argv.slice(2)
const fixtures = only.length > 0 ? manifest.filter((f) => only.some((prefix) => f.file.startsWith(prefix))) : manifest

// Mirrors OcrDigitRecognizer.ts (which imports tesseract.js the browser way).
const worker = await createWorker('eng')
const PSM_FALLBACKS = [PSM.SINGLE_WORD, PSM.SINGLE_BLOCK, PSM.SINGLE_CHAR]
async function recognizeDigit(pngDataUrl: string): Promise<number | null> {
  const png = Buffer.from(pngDataUrl.slice(pngDataUrl.indexOf(',') + 1), 'base64')
  for (const psm of PSM_FALLBACKS) {
    await worker.setParameters({ tessedit_char_whitelist: '123456789', tessedit_pageseg_mode: psm })
    const { data } = await worker.recognize(png)
    const digits = data.text.replace(/[^1-9]/g, '')
    if (digits.length > 0) {
      return Number(digits[0])
    }
  }
  return null
}

function cellText(board: Board, candidates: CandidateGrid, row: number, col: number): string {
  if (board[row][col]) {
    return `[${board[row][col]}]`
  }
  return candidates[row][col].map((on, i) => (on ? i + 1 : '')).join('') || '.'
}

let failed = 0
for (const fixture of fixtures) {
  const truth = await new PuzzleImporter().import(fixture.puzzle)
  if (!truth.ok) {
    throw new Error(`${fixture.file}: puzzle string doesn't import: ${truth.error}`)
  }
  const started = Date.now()
  const result = await ocrGrid(new NodeGridImage(join(fixtureDir, fixture.file)), recognizeDigit)
  const wrong: string[] = []
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const expected =
        fixture.imageOverrides?.[`r${row + 1}c${col + 1}`] ?? cellText(truth.board, truth.candidates, row, col)
      const actual = cellText(result.board, result.candidates, row, col)
      if (expected !== actual) {
        wrong.push(`r${row + 1}c${col + 1}: expected ${expected}, got ${actual}`)
      }
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`${wrong.length === 0 ? 'PASS' : 'FAIL'} ${fixture.file} (${seconds}s) - ${fixture.note}`)
  wrong.forEach((line) => console.log(`       ${line}`))
  if (wrong.length > 0) {
    failed++
  }
}
await worker.terminate()
console.log(`\n${fixtures.length - failed}/${fixtures.length} fixtures read exactly.`)
process.exitCode = failed > 0 ? 1 : 0
