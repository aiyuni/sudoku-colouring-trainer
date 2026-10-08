/**
 * Variant rating regression run: every puzzle of fixtures.json through the
 * rating code the app ships (src/variant-rating/, compiled from
 * variant-rating/ at the repo root) - the WebAssembly build and the
 * JavaScript fallback - compared with the rating the same Java gives on a
 * plain JVM (the `expected` values; see variant-rating/README.md for how
 * they are made).
 *
 *   npm run test:variant-rating            the quick fixtures
 *   npm run test:variant-rating -- --all   the slow, very hard ones too
 *   npm run test:variant-rating -- killer  only labels containing "killer"
 *
 * Also checks the ratings against an independent opinion where there is
 * one: SudokuWiki grades the example puzzles of its newer Jigsaw shapes
 * itself (gentle / moderate / tough / extreme), and a rating must fall in
 * that grade's band (PUBLISHER_BANDS). SudokuWiki names some of its X-Sudoku
 * examples after the technique they show: where the puzzle needs nothing
 * harder, the rating must be the Explainer's own difficulty for that
 * technique (`publisherTechnique`, in tenths). SudokuTodo's Anti-Knight
 * sheets are graded easy / medium. The word shown beside each rating
 * (easy / medium / hard / very hard) is only a reading of the number.
 * Exits non-zero on any mismatch.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const built = join(here, '..', 'src', 'variant-rating')
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'))
const args = process.argv.slice(2)
const all = args.includes('--all')
const only = args.filter((arg) => !arg.startsWith('--'))

/** How a rating reads (tenths, inclusive) - a description, nothing is checked against it. */
const BANDS = { easy: [10, 25], medium: [26, 45], hard: [46, 79], 'very hard': [80, 199] }
const describe = (er) => Object.keys(BANDS).find((grade) => er >= BANDS[grade][0] && er <= BANDS[grade][1]) ?? '?'
/** Where SudokuWiki's own grade of a puzzle allows its rating to fall. */
const PUBLISHER_BANDS = {
  gentle: [10, 30],
  moderate: [15, 70],
  tough: [26, 80],
  diabolical: [60, 95],
  extreme: [75, 120],
  'sudokutodo easy': [10, 25],
  'sudokutodo medium': [10, 45],
}

// rateVariantRules(givens, regions, cages, rules): rules '' is exactly
// rateVariant, 'x' adds the X-Sudoku diagonals, 'k' the Anti-Knight rule.
const { rateVariantRules: rateJs } = await import(pathToFileURL(join(built, 'variantRating.js')).href)
let rateWasm = null
try {
  const bytes = readFileSync(join(built, 'variantRating.wasm'))
  globalThis.fetch = async () => new Response(bytes, { headers: { 'content-type': 'application/wasm' } })
  const { load } = await import(pathToFileURL(join(built, 'wasm-gc-module-runtime.min.js')).href)
  rateWasm = (await load('variantRating.wasm')).exports.rateVariantRules
} catch (error) {
  console.log(`(WebAssembly build not run here: ${error.message})`)
}

let failed = 0
let run = 0
const times = { wasm: 0, js: 0 }
for (const fixture of fixtures) {
  if ((fixture.slow && !all) || (only.length > 0 && !only.some((word) => fixture.label.includes(word)))) {
    continue
  }
  run++
  const problems = []
  const er = Number(fixture.expected.split('/')[0])
  let seconds = ''
  for (const [name, rate] of [
    ['wasm', rateWasm],
    ['js', rateJs],
  ]) {
    if (!rate) continue
    const progress = []
    globalThis.variantRatingProgress = (tenths) => progress.push(tenths)
    const started = Date.now()
    const got = rate(fixture.givens, fixture.regions, fixture.cages, fixture.rules ?? '')
    times[name] += Date.now() - started
    seconds += ` ${name} ${((Date.now() - started) / 1000).toFixed(1)}s`
    if (got !== fixture.expected) {
      problems.push(`${name} build: got ${got}, expected ${fixture.expected}`)
    }
    // The rating so far must climb to the rating itself.
    if (progress.length === 0 || progress.some((tenths, i) => i > 0 && tenths <= progress[i - 1]) || progress[progress.length - 1] !== er) {
      problems.push(`${name} build: progress reports ${JSON.stringify(progress)} do not climb to ${er}`)
    }
  }
  if (fixture.publisherGrade) {
    const [low, high] = PUBLISHER_BANDS[fixture.publisherGrade]
    if (er < low || er > high) {
      problems.push(`rated ${er / 10}, but its publisher grades it "${fixture.publisherGrade}" (${low / 10}-${high / 10} expected)`)
    }
  }
  if (fixture.publisherTechnique && er !== fixture.publisherTechnique) {
    problems.push(`rated ${er / 10}, but SudokuWiki shows it for a technique the Explainer rates ${fixture.publisherTechnique / 10}`)
  }
  console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'} ${(er / 10).toFixed(1)} ${describe(er).padEnd(9)} ${fixture.label} (${seconds.trim()})`)
  problems.forEach((line) => console.log(`       ${line}`))
  if (problems.length > 0) failed++
}

console.log(
  `\n${run - failed}/${run} fixtures rated as expected${all ? '' : ' (slow ones skipped: --all runs them)'}. ` +
    `Total: wasm ${(times.wasm / 1000).toFixed(1)}s, js ${(times.js / 1000).toFixed(1)}s.`,
)
process.exitCode = failed > 0 ? 1 : 0
