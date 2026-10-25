/**
 * Tests for technique share links (src/techniqueShareLink.ts):
 *
 *   npm run test:technique-share
 *
 * Runs in Node on real Dragon rows - Plain, Dynamic, Double and Double
 * Dynamic - found by the app's own engine on stock positions (collect.ts).
 * Each comes back from its link exactly as it went in (grid, row, every
 * move, every intermediate state of the step player, the final deductions),
 * opens without any technique search and whatever settings would list now,
 * keeps its recording intact while the working grid is edited, and anything
 * that isn't a whole, valid link is refused with a reason, never thrown.
 * Exits non-zero on any failure.
 */
import { collectDragons, techniqueList, TEST_SETTINGS, type FoundDragon } from './collect'
import {
  decodeTechniqueReplay,
  encodeTechniqueReplay,
  gridMatchesReplay,
  MAX_REPLAY_PAYLOAD_LENGTH,
  replayLinkUrl,
  replayPayloadOf,
  replayStartGrid,
  shareableDragonKind,
  type SharedDragonKind,
  type TechniqueReplay,
} from '../src/techniqueShareLink'
import { encodeShareState, sharePayloadOf } from '../src/shareLink'
import { fullTechniqueEffect, type TechniqueInstance } from '../src/techniqueEngine'
import { foldDragonMoves } from '../src/sudoku/dragonReplay'
import { ALL_RULE3_TECHNIQUES, SudokuDragonFinder } from '../src/sudoku/SudokuDragonFinder'
import { SudokuMedusaFinder } from '../src/sudoku/SudokuMedusaFinder'
import { SudokuSingleFinder } from '../src/sudoku/SudokuSingleFinder'
import { SudokuSolver } from '../src/sudoku/SudokuSolver'
import { createEmptyCandidateColors } from '../src/sudoku/boardUtils'
import { CLASSIC_CONSTRAINTS, normalizeConstraints } from '../src/sudoku/SudokuConstraints'
import type { SavedGrid } from '../src/persistedState'
import type { CandidateColorGrid } from '../src/sudoku/types'

const SITE = 'https://aiyuni.github.io/sudoku-colouring-trainer/'
const KINDS: SharedDragonKind[] = ['dragon', 'dynamic-dragon', 'double-dragon', 'double-dynamic-dragon']

let checks = 0
let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks++
  if (!ok) {
    failures++
    console.error(`FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}
/** Deep equality as JSON sees it, whatever order an object's keys are in
 * (the reader rebuilds every object in its own order). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

/** The position a row was found on, with a couple of candidate colours (a
 * sharer's own annotations travel with the link). */
function positionOf(found: FoundDragon): Required<SavedGrid> {
  const candidateColors: CandidateColorGrid = createEmptyCandidateColors()
  let painted = 0
  found.candidates.forEach((row, r) =>
    row.forEach((cell, c) =>
      cell.forEach((marked, d) => {
        if (marked && painted < 3 && (r + c + d) % 7 === 0) {
          candidateColors[r][c][d] = [{ color: 'lightPink', shape: 'circle' }]
          painted++
        }
      }),
    ),
  )
  return { board: found.board, givens: found.givens, candidates: found.candidates, candidateColors, constraints: CLASSIC_CONSTRAINTS }
}

/** A payload with any JSON in it, as the encoder would write it. */
async function pack(value: unknown, version = '1'): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return version + Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function unpack(payload: string): Promise<Record<string, unknown>> {
  const bytes = Buffer.from(payload.slice(1).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return JSON.parse(await new Response(stream).text()) as Record<string, unknown>
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

/** Every finder entry point the tests can reach made to count calls - a
 * replay must never search for a technique. */
function watchFinders(): { calls: () => number; restore: () => void } {
  let calls = 0
  const restores: Array<() => void> = []
  for (const cls of [SudokuDragonFinder, SudokuMedusaFinder, SudokuSingleFinder, SudokuSolver]) {
    const proto = cls.prototype as unknown as Record<string, unknown>
    for (const name of Object.getOwnPropertyNames(proto)) {
      const original = proto[name]
      if (name === 'constructor' || typeof original !== 'function') continue
      proto[name] = function (this: unknown, ...args: unknown[]) {
        calls++
        return (original as (...a: unknown[]) => unknown).apply(this, args)
      }
      restores.push(() => {
        proto[name] = original
      })
    }
  }
  return { calls: () => calls, restore: () => restores.forEach((r) => r()) }
}

const started = Date.now()
// The app's defaults, then every Dynamic Dragon technique allowed and the
// AIC limit off: AIC substeps carry their own chain drawings (aicChains,
// grouped links), which the reader has to take apart too.
const found = [
  ...collectDragons(3, 8),
  ...collectDragons(3, 10, { ...TEST_SETTINGS, allowed: new Set(ALL_RULE3_TECHNIQUES), exhaustive: false }),
]
console.log(`collected ${found.length} Dragon rows in ${((Date.now() - started) / 1000).toFixed(1)}s`)
check(
  'some recorded step carries an AIC drawing',
  found.some((f) => f.instance.moves!.some((m) => (m.aicChains?.length ?? 0) > 0 && m.substeps?.some((sub) => sub.aic))),
)

// --- Every kind can be shared, and only Dragon rows can --------------------
for (const kind of KINDS) {
  check(`found ${kind} rows to test`, found.some((f) => f.kind === kind))
}
{
  const nonDragon = techniqueList(found[0].board, found[0].candidates, found[0].givens, TEST_SETTINGS).find((i) => !i.moves)
  check('a non-Dragon row is not shareable', nonDragon === undefined || shareableDragonKind(nonDragon) === null)
  let threw = false
  try {
    if (nonDragon) await encodeTechniqueReplay(positionOf(found[0]), nonDragon)
    else threw = true
  } catch {
    threw = true
  }
  check('encoding a non-Dragon row throws', threw)
}

// --- Round trips: grid, row, every intermediate step, final deductions -----
const payloads: Array<{ found: FoundDragon; payload: string; replay: TechniqueReplay }> = []
for (const f of found) {
  const label = `${f.kind} ${f.instance.id}`
  check(`${label}: kind`, shareableDragonKind(f.instance) === f.kind)
  const position = positionOf(f)
  const payload = await encodeTechniqueReplay(position, f.instance)
  check(`${label}: payload is URL-safe`, /^1[A-Za-z0-9_-]+$/.test(payload))
  check(`${label}: payload is a practical size`, payload.length < 20_000, `${payload.length} chars`)
  check(`${label}: deterministic`, payload === (await encodeTechniqueReplay(position, f.instance)))
  const decoded = await decodeTechniqueReplay(payload, false)
  if (!decoded.ok) {
    check(`${label}: decodes`, false, decoded.error)
    continue
  }
  const { replay } = decoded
  payloads.push({ found: f, payload, replay })
  const original: TechniqueInstance = f.instance
  const back = replay.instance
  check(`${label}: grid`, same(replay.grid, position))
  check(`${label}: kind back`, replay.kind === f.kind)
  check(`${label}: id/name/notation/rank`, back.id === original.id && back.name === original.name && back.notation === original.notation && back.techniqueRank === original.techniqueRank)
  check(`${label}: moves`, same(back.moves, original.moves))
  check(`${label}: eliminations and placements`, same(back.eliminatedCandidates, original.eliminatedCandidates) && same(back.solvedCandidates, original.solvedCandidates))
  // Everything but the Techniques list's own ordering flag, which a replay
  // (one row, no list) has no use for.
  const { easierThanSingleDynamicDragon: _ordering, ...rowFields } = original
  void _ordering
  check(`${label}: whole row`, same(back, rowFields))
  const moves = original.moves!
  let stepsOk = true
  for (let i = 0; i < moves.length; i++) {
    if (!same(foldDragonMoves(back.moves!, i), foldDragonMoves(moves, i)) || !same(foldDragonMoves(back.moves!, i, false), foldDragonMoves(moves, i, false))) {
      stepsOk = false
    }
  }
  check(`${label}: every intermediate step (${moves.length})`, stepsOk)
  check(`${label}: final deductions`, same(fullTechniqueEffect(back), fullTechniqueEffect(original)))
  check(`${label}: still a ${f.kind} row`, shareableDragonKind(back) === f.kind)
}

// --- Independent of the viewer's settings ----------------------------------
{
  // Rows found with Double / Double Dynamic on aren't listed with every
  // Dragon option off - and the replay doesn't care.
  const offSettings = { ...TEST_SETTINGS, doubleDragon: false, doubleDynamic: false }
  for (const kind of ['double-dragon', 'double-dynamic-dragon'] as const) {
    const sample = payloads.find((p) => p.found.kind === kind)
    if (!sample) continue
    const listed = techniqueList(sample.found.board, sample.found.candidates, sample.found.givens, offSettings)
    check(`${kind}: not listed under conflicting settings`, !listed.some((i) => i.id === sample.found.instance.id))
    const decoded = await decodeTechniqueReplay(sample.payload, false)
    check(`${kind}: replays under conflicting settings`, decoded.ok && same(decoded.replay.instance.moves, sample.found.instance.moves))
  }
  const dynamic = payloads.find((p) => p.found.kind === 'dynamic-dragon')
  if (dynamic) {
    const decoded = await decodeTechniqueReplay(dynamic.payload, false)
    check('dynamic-dragon: replays the recorded row regardless', decoded.ok && same(decoded.replay.instance.moves, dynamic.found.instance.moves))
  }
}

// --- No technique search while opening or stepping -------------------------
{
  const watch = watchFinders()
  try {
    for (const { payload } of payloads) {
      const decoded = await decodeTechniqueReplay(payload, false)
      if (decoded.ok) {
        const grid = replayStartGrid(decoded.replay)
        gridMatchesReplay(grid, decoded.replay)
        const moves = decoded.replay.instance.moves!
        for (let i = 0; i < moves.length; i++) foldDragonMoves(moves, i)
      }
    }
  } finally {
    watch.restore()
  }
  check('opening and stepping through every replay calls no finder or solver', watch.calls() === 0, `${watch.calls()} calls`)
}

// --- Working grid edits never touch the recording ---------------------------
for (const { found: f, replay } of payloads.slice(0, 4)) {
  const label = `${f.kind} edits`
  const snapshot = JSON.stringify(replay)
  deepFreeze(replay)
  const grid = replayStartGrid(replay)
  check(`${label}: starts on the shared position`, gridMatchesReplay(grid, replay) && same(grid, replay.grid))
  const folds = replay.instance.moves!.map((_, i) => JSON.stringify(foldDragonMoves(replay.instance.moves!, i)))
  let editable = true
  try {
    // A digit entered, a candidate removed, a colour painted - the kinds of
    // edit the page makes (on copies, but the start grid must allow it too).
    const empty = grid.board.flatMap((row, r) => row.map((v, c) => [r, c, v] as const)).find(([, , v]) => v === 0)!
    const [r, c] = empty
    const digit = grid.candidates[r][c].indexOf(true) + 1
    grid.board[r][c] = digit
    grid.candidates[r][c] = grid.candidates[r][c].map(() => false)
    const other = grid.board.flatMap((row, rr) => row.map((v, cc) => [rr, cc, v] as const)).find(([rr, cc, v]) => v === 0 && grid.candidates[rr][cc].filter(Boolean).length > 1)!
    grid.candidates[other[0]][other[1]][grid.candidates[other[0]][other[1]].indexOf(true)] = false
    grid.candidateColors[r][c][0] = [{ color: 'blue', shape: 'square' }]
  } catch {
    editable = false
  }
  check(`${label}: working grid is editable`, editable)
  check(`${label}: an edited grid no longer matches`, !gridMatchesReplay(grid, replay))
  check(`${label}: recording unchanged`, JSON.stringify(replay) === snapshot)
  check(`${label}: every step still the same`, replay.instance.moves!.every((_, i) => JSON.stringify(foldDragonMoves(replay.instance.moves!, i)) === folds[i]))
  const reset = replayStartGrid(replay)
  check(`${label}: reset brings back the shared position`, same(reset, replay.grid) && gridMatchesReplay(reset, replay))
  const recoloured = replayStartGrid(replay)
  recoloured.candidateColors[0][0][0] = [{ color: 'paleYellow', shape: 'diamond' }]
  check(`${label}: colours alone don't count as a different position`, gridMatchesReplay(recoloured, replay))
}

// --- Variant page ------------------------------------------------------------
if (payloads.length > 0) {
  const { found: f } = payloads[0]
  const position = { ...positionOf(f), constraints: normalizeConstraints({ regions: null, cages: [], diagonals: true }) }
  const payload = await encodeTechniqueReplay(position, f.instance)
  const onVariant = await decodeTechniqueReplay(payload, true)
  check('variant: constraints come back on the Variant page', onVariant.ok && onVariant.replay.grid.constraints.diagonals === true)
  const onClassic = await decodeTechniqueReplay(payload, false)
  check('variant: refused on the Classic page', !onClassic.ok && /Variant solver/.test(onClassic.error))
  const classicOnVariant = await decodeTechniqueReplay(payloads[0].payload, true)
  check('classic link opens on the Variant page too', classicOnVariant.ok)
}

// --- Malformed, unsupported and oversized links ----------------------------
if (payloads.length > 0) {
  const good = payloads.find((p) => p.found.kind === 'dynamic-dragon') ?? payloads[0]
  const data = await unpack(good.payload)
  const firstMove = () => (data.moves as Array<Record<string, unknown>>)[0]
  const withMove = (patch: Record<string, unknown>) => ({ ...data, moves: [{ ...firstMove(), ...patch }, ...(data.moves as unknown[]).slice(1)] })
  const markedCell = (() => {
    const g = good.found
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let d = 0; d < 9; d++) if (g.board[r][c] === 0 && !g.candidates[r][c][d]) return { row: r, col: c, digit: d + 1 }
    return null
  })()
  const cases: Array<[string, string | Promise<string>, RegExp?]> = [
    ['empty', ''],
    ['not base64url', '1abc$def'],
    ['newer version', `2${good.payload.slice(1)}`, /newer version/],
    ['truncated', good.payload.slice(0, Math.floor(good.payload.length / 2))],
    ['one character changed', good.payload.slice(0, 40) + (good.payload[40] === 'A' ? 'B' : 'A') + good.payload.slice(41)],
    ['too long', `1${'A'.repeat(MAX_REPLAY_PAYLOAD_LENGTH)}`, /too long/],
    ['inflates too far', pack(' '.repeat(6_000_000)), /too large/],
    ['not JSON', pack('this is not json')],
    ['JSON array', pack([1, 2, 3])],
    ['no moves', pack({ ...data, moves: [] })],
    ['moves missing', pack({ ...data, moves: undefined })],
    ['unknown kind', pack({ ...data, kind: 'triple-dragon' })],
    ['kind and id disagree', pack({ ...data, kind: 'dragon', id: 'dynamic-dragon-x' })],
    ['row out of range', pack(withMove({ colored: [{ row: 9, col: 0, digit: 1, color: 'blue' }] }))],
    ['digit 0', pack(withMove({ eliminated: [{ row: 0, col: 0, digit: 0 }] }))],
    ['fractional coordinate', pack(withMove({ eliminated: [{ row: 0.5, col: 0, digit: 1 }] }))],
    ['unknown move kind', pack(withMove({ kind: 'rule99' }))],
    ['unknown colour', pack(withMove({ colored: [{ ...((firstMove().colored as unknown[])[0] as object), color: 'black' }] }))],
    ['description not text', pack(withMove({ description: { html: '<b>x</b>' } }))],
    ['description too long', pack(withMove({ description: 'x'.repeat(20_000) }))],
    ['unknown substep technique', pack(withMove({ substeps: [{ technique: 'magic', clause: 'x', basisCells: [], eliminatedCandidates: [] }] }))],
    ['candidate not on the grid', markedCell ? pack(withMove({ eliminated: [markedCell] })) : ''],
    ['grid damaged', pack({ ...data, grid: `${String(data.grid).slice(0, 20)}` })],
    ['grid of another version', pack({ ...data, grid: `9${String(data.grid).slice(1)}` }), /newer version/],
  ]
  for (const [name, payloadOrPromise, message] of cases) {
    let result
    try {
      result = await decodeTechniqueReplay(await payloadOrPromise, false)
    } catch (error) {
      check(`malformed (${name}): never throws`, false, String(error))
      continue
    }
    check(`malformed (${name}): refused`, !result.ok)
    if (!result.ok) {
      check(`malformed (${name}): says why`, result.error.length > 10 && (!message || message.test(result.error)), result.error)
    }
  }
  // Fields a link shouldn't carry are dropped, not trusted.
  const extra = await decodeTechniqueReplay(
    await pack({ ...withMove({ onclick: 'alert(1)', __proto__: { polluted: true } }), extra: 'ignored' }),
    false,
  )
  check('unknown fields: still opens', extra.ok)
  if (extra.ok) {
    const move = extra.replay.instance.moves![0] as unknown as Record<string, unknown>
    check('unknown fields: dropped', !('onclick' in move) && !('extra' in extra.replay.instance))
    check('unknown fields: no prototype pollution', ({} as Record<string, unknown>).polluted === undefined)
  }
}

// --- URLs ---------------------------------------------------------------------
{
  const url = replayLinkUrl('1abc', false, SITE)
  check('url: Classic', url === `${SITE}#d=1abc`)
  check('url: Variant', replayLinkUrl('1abc', true, SITE) === `${SITE}variants/#d=1abc`)
  check('payload from fragment', replayPayloadOf('#d=1abc') === '1abc')
  check('payload from whole link', replayPayloadOf(url) === '1abc')
  check('payload from link with spaces', replayPayloadOf(`  ${url}\n`) === '1abc')
  check('not from a position link', replayPayloadOf(`${SITE}#p=1abc`) === null)
  check('not from other text', replayPayloadOf('hello #d=1abc') === null && replayPayloadOf('') === null)
  check('position links unaffected', sharePayloadOf(url) === null && sharePayloadOf(`${SITE}#p=1abc`) === '1abc')
  if (payloads.length > 0) {
    // The position inside is the ordinary position link's own payload.
    const data = await unpack(payloads[0].payload)
    check('position is a version 1 position link', data.grid === encodeShareState(positionOf(payloads[0].found)))
  }
}

console.log(`${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  process.exit(1)
}
