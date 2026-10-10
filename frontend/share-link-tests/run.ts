/**
 * Tests for share links (src/shareLink.ts):
 *
 *   npm run test:share-link
 *
 * Runs in Node. A position comes back from its link exactly as it went in
 * (digits, givens, candidates, colours, Variant constraints), the same
 * position always gives the same link, version 1's bytes are pinned to links
 * written down here (a link is for good - see GOLDEN), and anything that
 * isn't a whole, unaltered link is refused without throwing. Exits non-zero
 * on any failure.
 */
import { createEmptyBoard, createEmptyCandidateColors, createEmptyCandidates } from '../src/sudoku/boardUtils'
import { CLASSIC_CONSTRAINTS, normalizeConstraints, type SudokuConstraints } from '../src/sudoku/SudokuConstraints'
import { DEFAULT_VARIANT_PUZZLE, parseVariantPuzzle } from '../src/sudoku/VariantPuzzle'
import type { SavedGrid } from '../src/persistedState'
import { CANDIDATE_COLOR_ORDER, type CandidateColorGrid, type CandidatePaintShape } from '../src/sudoku/types'
import { decodeShareState, encodeShareState, shareLinkUrl, sharePayloadOf } from '../src/shareLink'

const SITE = 'https://aiyuni.github.io/sudoku-colouring-trainer/'
const SHAPES: CandidatePaintShape[] = ['circle', 'square', 'diamond']

let checks = 0
let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks++
  if (!ok) {
    failures++
    console.error(`FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Everything a link has to carry, with the constraints spelled out so two
 * descriptions of one puzzle compare equal. */
function stateOf(grid: SavedGrid) {
  const c = grid.constraints ?? CLASSIC_CONSTRAINTS
  return {
    board: grid.board,
    givens: grid.givens,
    candidates: grid.candidates,
    candidateColors: grid.candidateColors,
    regions: c.regions,
    cages: c.cages,
    diagonals: !!c.diagonals,
    antiKnight: !!c.antiKnight,
    entropy: !!c.entropy,
  }
}

const SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179'

/** A mid-solve Classic position: some givens, some entered digits, pencil
 * marks on the rest, colours in one- and two-layer form. */
function classicGrid(seed: number): SavedGrid {
  const board = createEmptyBoard()
  const givens = board.map((row) => row.map(() => false))
  const candidates = createEmptyCandidates()
  const candidateColors: CandidateColorGrid = createEmptyCandidateColors()
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9)
    const c = i % 9
    const roll = (i * 7 + seed * 13) % 10
    if (roll < 3) {
      board[r][c] = Number(SOLUTION[i])
      givens[r][c] = true
    } else if (roll < 5) {
      board[r][c] = Number(SOLUTION[i])
    } else {
      for (let d = 0; d < 9; d++) {
        candidates[r][c][d] = d + 1 === Number(SOLUTION[i]) || (d + i + seed) % 3 === 0
      }
      const d = Number(SOLUTION[i]) - 1
      if (roll === 5) {
        candidateColors[r][c][d] = [{ color: CANDIDATE_COLOR_ORDER[(i + seed) % 9], shape: SHAPES[i % 3] }]
      } else if (roll === 6) {
        candidateColors[r][c][d] = [
          { color: CANDIDATE_COLOR_ORDER[i % 9], shape: 'square' },
          { color: CANDIDATE_COLOR_ORDER[(i + 4) % 9], shape: 'diamond' },
        ]
      }
    }
  }
  return { board, givens, candidates, candidateColors }
}

function givensOnly(puzzle: string): SavedGrid {
  const board = createEmptyBoard()
  const givens = board.map((row) => row.map(() => false))
  for (let i = 0; i < 81; i++) {
    board[Math.floor(i / 9)][i % 9] = Number(puzzle[i])
    givens[Math.floor(i / 9)][i % 9] = puzzle[i] !== '0'
  }
  return { board, givens, candidates: createEmptyCandidates(), candidateColors: createEmptyCandidateColors() }
}

/** The heaviest grid there is: nothing placed, every candidate marked and
 * every one of them in two colours. */
function heaviestGrid(): SavedGrid {
  const grid = givensOnly('0'.repeat(81))
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      for (let d = 0; d < 9; d++) {
        grid.candidates[r][c][d] = true
        grid.candidateColors[r][c][d] = [
          { color: CANDIDATE_COLOR_ORDER[d], shape: SHAPES[d % 3] },
          { color: CANDIDATE_COLOR_ORDER[8 - d], shape: SHAPES[(d + 1) % 3] },
        ]
      }
    }
  }
  return grid
}

/** Nine staggered 9-cell regions (each row's regions slide along by its row
 * number) - a legal layout that is nothing like the 3x3 boxes. */
const JIGSAW_REGIONS = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => (c + r) % 9))

function variantGrids(): Array<[string, SavedGrid]> {
  const parsed = parseVariantPuzzle(DEFAULT_VARIANT_PUZZLE)
  if (!parsed.ok) {
    throw new Error('the default Variant puzzle no longer parses')
  }
  const progress = classicGrid(3)
  const with_ = (constraints: SudokuConstraints, base: SavedGrid = progress): SavedGrid => ({ ...base, constraints: normalizeConstraints(constraints) })
  const killerBase: SavedGrid = { board: parsed.board, givens: parsed.givens, candidates: progress.candidates, candidateColors: progress.candidateColors }
  return [
    ['Killer', with_(parsed.constraints, killerBase)],
    ['Killer, every rule', with_({ ...parsed.constraints, regions: JIGSAW_REGIONS, diagonals: true, antiKnight: true, entropy: true }, killerBase)],
    ['Jigsaw', with_({ regions: JIGSAW_REGIONS, cages: [] })],
    ['X-Sudoku', with_({ regions: null, cages: [], diagonals: true })],
    ['Anti-Knight', with_({ regions: null, cages: [], antiKnight: true })],
    ['Entropy', with_({ regions: null, cages: [], entropy: true })],
    ['Variant page, Classic puzzle', with_({ regions: null, cages: [] })],
    ['81 one-cell cages', with_({ regions: null, cages: Array.from({ length: 81 }, (_, i) => ({ sum: Number(SOLUTION[i]), cells: [[Math.floor(i / 9), i % 9]] as [number, number][] })) }, givensOnly('0'.repeat(81)))],
  ]
}

/** Version 1 links written down when the format was made. They must open as
 * these positions for good: if one of these checks fails, the format was
 * changed in place, and every link already shared has been broken with it.
 * (A new format is a new version character with its own reader.) */
const GOLDEN: Array<[name: string, grid: () => SavedGrid, payload: string]> = [
  ['empty grid', () => givensOnly('0'.repeat(81)), '1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
  ['mid-solve Classic', () => classicGrid(1), '1AocGSMPBkwSSMHSBJLhQaTIsEkhWUQaSFJwHBWRCwU0GSRBSQZK40GSIFBsgTSUGWBJahwSbIMEmhyRwSSFJIRBSTEwU0GSLBaQZIREGSERBkgTSMGShJJiwSSgsFkhSTQaSFLSAgHxwVoKRJoSzirHgCQ2S0o4RZprzPCW6oxPwOhmqFKpCcrI1ZlbNulA'],
  ['Killer, every rule', () => variantGrids()[1][1], '1-GaBJIABJoABpIUkAJNCkgACkgACkgyQAUkGyAAGaAAGTBLIAyQJJAALJAALJCmgBLIWkAAckAAWkGSgCsgyYAAyUAAzQJJAHSBJYABJYABpIUmAJJCkgACkgACmgyQAUmCAFxVhJFDJJaKIYX815ACKOUYlbLLnVCbgw6VkaDDsWXSpsRUHhOr4AAkaKzwJGis8ARorPACaKzwAkis8AJGrPACRozwAkaK8AJGitACRorOfNQAJFCzSAgllBjBpUsWQQKgYYcPNMOQMhiIJEiyhImUOIoXQIUQ4mDCNIy0NpEq5Qzp5MGJ8QU8CqF7Bi4URSqZvCyVtBRWLItbN35RMnaBtXr403LqG4sCDIkyiihSyBiGpFjTp4QxyimTRhoA'],
]

function roundTrip(name: string, grid: SavedGrid, variantPage: boolean): string {
  const payload = encodeShareState(grid)
  check(`${name}: URL-safe`, /^[A-Za-z0-9_-]+$/.test(payload), payload)
  check(`${name}: same state, same link`, encodeShareState(structuredClone(grid)) === payload)
  const decoded = decodeShareState(payload, variantPage)
  check(`${name}: opens`, decoded.ok, decoded.ok ? '' : decoded.error)
  if (decoded.ok) {
    check(`${name}: comes back exactly`, same(stateOf(decoded.grid), stateOf(grid)))
    check(`${name}: Classic constraints are the shared object`, (decoded.grid.constraints === CLASSIC_CONSTRAINTS) === (normalizeConstraints(grid.constraints ?? CLASSIC_CONSTRAINTS) === CLASSIC_CONSTRAINTS))
    check(`${name}: link of the restored grid is the same link`, encodeShareState(decoded.grid) === payload)
  }
  // The link as a browser would see it: through a real URL and its fragment.
  const url = shareLinkUrl(payload, variantPage, SITE)
  const parsedUrl = new URL(url)
  check(`${name}: page of the link`, parsedUrl.pathname === (variantPage ? '/sudoku-colouring-trainer/variants/' : '/sudoku-colouring-trainer/'))
  check(`${name}: payload survives the URL`, sharePayloadOf(parsedUrl.hash) === payload && sharePayloadOf(`  ${url}\n`) === payload)
  check(`${name}: nothing needs escaping`, encodeURI(url) === url && parsedUrl.href === url)
  return payload
}

function main() {
  // ---- Round trips --------------------------------------------------------
  const lengths: string[] = []
  const classic: Array<[string, SavedGrid]> = [
    ['empty grid', givensOnly('0'.repeat(81))],
    ['givens only', givensOnly('003020600900305001001806400008102900700000008006708200002609500800203009005010300')],
    ['solved grid', givensOnly(SOLUTION)],
    ['heaviest grid', heaviestGrid()],
  ]
  for (let seed = 0; seed < 40; seed++) {
    classic.push([`mid-solve ${seed}`, classicGrid(seed)])
  }
  // Digits typed in and not locked, marks left under a placed digit, a
  // colour on a candidate that isn't marked: states the app itself tidies
  // away, which a link must still not alter.
  const odd = classicGrid(2)
  odd.givens = odd.givens.map((row) => row.map(() => false))
  odd.candidates[0][0] = [true, true, false, false, true, false, false, false, true]
  odd.candidateColors[8][8][0] = [{ color: 'tan', shape: 'diamond' }]
  classic.push(['untidy state', odd])
  for (const [name, grid] of classic) {
    const payload = roundTrip(name, grid, false)
    // A Classic position opens on the Variant page too (as a Classic puzzle).
    check(`${name}: also opens on the Variant page`, decodeShareState(payload, true).ok)
    if (!name.startsWith('mid-solve') || name === 'mid-solve 1') {
      lengths.push(`${name} ${shareLinkUrl(payload, false, SITE).length}`)
    }
  }
  const variants = variantGrids()
  for (const [name, grid] of variants) {
    const payload = roundTrip(name, grid, true)
    lengths.push(`${name} ${shareLinkUrl(payload, true, SITE).length}`)
    const onClassic = decodeShareState(payload, false)
    if (normalizeConstraints(grid.constraints ?? CLASSIC_CONSTRAINTS) === CLASSIC_CONSTRAINTS) {
      check(`${name}: opens on the Classic page`, onClassic.ok)
    } else {
      check(`${name}: refused by the Classic page, with a reason`, !onClassic.ok && /Variant solver/.test(onClassic.error))
    }
  }
  // Two descriptions of one puzzle - flags absent or false, keys in another
  // order - are one link.
  const killer = variants[0][1]
  const k = killer.constraints!
  check(
    'same puzzle described differently: same link',
    encodeShareState({ ...killer, constraints: { entropy: false, cages: k.cages, antiKnight: false, regions: null, diagonals: false } }) === encodeShareState(killer),
  )
  check('no constraints = Classic constraints', encodeShareState({ ...classicGrid(1), constraints: CLASSIC_CONSTRAINTS }) === encodeShareState(classicGrid(1)))
  const distinct = new Set(classic.map(([, grid]) => encodeShareState(grid)))
  check('different states, different links', distinct.size === classic.length)

  // ---- Version 1 is pinned ------------------------------------------------
  for (const [name, grid, payload] of GOLDEN) {
    const written = encodeShareState(grid())
    check(`golden ${name}: still written the same`, written === payload, written)
    const decoded = decodeShareState(payload, true)
    check(`golden ${name}: still opens as the same position`, decoded.ok && same(stateOf(decoded.grid), stateOf(grid())))
  }

  // ---- What isn't a link --------------------------------------------------
  check('other fragments are not share links', ['', '#', '#top', '#p', '#q=1abc', 'p=1abc'].every((hash) => sharePayloadOf(hash) === null))
  check('puzzle strings are not share links', sharePayloadOf(SOLUTION) === null && sharePayloadOf('SCv7_32_abc#p=1AAA') === null)
  check('an empty payload is one, and is refused', sharePayloadOf('#p=') === '' && !decodeShareState('', false).ok)

  const good = encodeShareState(classicGrid(1))
  const goodVariant = encodeShareState(variants[1][1])
  const refused = (payload: string, variantPage = true): boolean => {
    const result = decodeShareState(payload, variantPage)
    return !result.ok && result.error.length > 20
  }
  for (const [name, payload] of [
    ['only a version', '1'],
    ['not base64url', '1ab$cd'],
    ['percent-escaped', `1${encodeURIComponent('ab+/=')}`],
    ['spaces', `1${good.slice(1, 20)} ${good.slice(20)}`],
    ['a trailing "="', `${good}=`],
    ['text', 'hello-world'],
    ['a puzzle string', SOLUTION],
    ['no version', good.slice(1)],
    ['extra characters', `${good}AAAA`],
    ['doubled', good + good.slice(1)],
  ] as const) {
    check(`refused: ${name}`, refused(payload))
  }
  const newer = decodeShareState(`2${good.slice(1)}`, false)
  check('a newer version says so', !newer.ok && /newer version/.test(newer.error))

  // Cut short anywhere: never a puzzle, never an exception.
  for (const payload of [good, goodVariant]) {
    let cutRefused = 0
    for (let length = 0; length < payload.length; length++) {
      cutRefused += refused(payload.slice(0, length)) ? 1 : 0
    }
    check('every truncation is refused', cutRefused === payload.length, `${cutRefused} of ${payload.length}`)
  }

  // One character changed anywhere: refused, or a different whole position -
  // never the original passed off under another spelling, never a throw,
  // never a state that doesn't write back as the very link it came from.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let mutations = 0
  let mutationsOpened = 0
  for (const payload of [good, goodVariant]) {
    for (let at = 1; at < payload.length; at++) {
      for (const char of alphabet) {
        if (char === payload[at]) {
          continue
        }
        const mutated = payload.slice(0, at) + char + payload.slice(at + 1)
        const result = decodeShareState(mutated, true)
        mutations++
        if (result.ok) {
          mutationsOpened++
          if (encodeShareState(result.grid) !== mutated || same(stateOf(result.grid), stateOf(decodeStateOf(payload)))) {
            check(`mutation at ${at} -> ${char}`, false, 'opened as a non-canonical or unchanged state')
          }
        }
      }
    }
  }
  check('mutations tried', mutations > 10000)

  // Random noise, with and without a valid version in front.
  let seed = 12345
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  let noiseOpened = 0
  for (let i = 0; i < 20000; i++) {
    const length = Math.floor(random() * 400)
    let payload = i % 2 ? '1' : ''
    for (let n = 0; n < length; n++) {
      payload += alphabet[Math.floor(random() * 64)]
    }
    const result = decodeShareState(payload, i % 3 === 0)
    if (result.ok) {
      noiseOpened++
      check('noise that opens is a whole canonical state', encodeShareState(result.grid) === payload)
    }
  }

  console.log(`link lengths (characters, whole URL): ${lengths.join(' · ')}`)
  console.log(`${mutations} one-character mutations: ${mutationsOpened} are other valid positions, the rest refused; random noise opened ${noiseOpened} of 20000`)
  console.log(failures === 0 ? `share links: all ${checks} checks passed` : `share links: ${failures} of ${checks} checks FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

function decodeStateOf(payload: string): SavedGrid {
  const result = decodeShareState(payload, true)
  if (!result.ok) {
    throw new Error('a known good link no longer opens')
  }
  return result.grid
}

main()
