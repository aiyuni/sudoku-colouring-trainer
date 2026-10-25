import type { SavedGrid } from './persistedState'
import { decodeShareState, encodeShareState } from './shareLink'
import { ALL_RULE3_TECHNIQUES, type DragonCandidateRef, type DragonColor, type DragonMove, type DragonMoveKind, type DragonNode, type DragonRule3Substep, type PrimaryColor } from './sudoku/SudokuDragonFinder'
import type { AicLinkRef, ShortAicPattern } from './sudoku/SudokuShortAicFinder'
import {
  RANK_DOUBLE_DRAGON,
  RANK_DOUBLE_DYNAMIC_DRAGON,
  RANK_DRAGON,
  RANK_DYNAMIC_DRAGON,
  type TechniqueInstance,
} from './techniqueEngine'

/** Technique share links: one Dragon Colouring row of the Techniques list -
 * Plain, Dynamic, Double or Double Dynamic - together with the grid it was
 * found on, so whoever opens the link sees that exact Dragon played move by
 * move, whatever their own settings are:
 *
 *   https://<site>/#d=1<base64url>            Classic solver
 *   https://<site>/variants/#d=1<base64url>   Variant solver
 *
 * The Dragon is *recorded*, not found again: its move log (every colouring,
 * elimination, description, Dynamic substep and AIC drawing - see DragonMove)
 * goes into the link as it was on the sharer's screen, and the replay page
 * draws it with no technique search at all. Re-running the search on the
 * receiving end could give another Dragon (or none) under other settings, or
 * after any change to the finder.
 *
 * Like the position links of shareLink.ts it lives in the fragment (static
 * hosting, nothing stored anywhere, never sent to a server). The position is
 * that module's version 1 string, unchanged, so the two can't disagree on
 * what a grid is. The move log is JSON, deflated (CompressionStream - a
 * Dynamic Dragon's log is mostly English, which compresses ~5-10x) and
 * base64url'd behind a version character:
 *
 *   1 + base64url(deflate-raw(JSON { grid, kind, id, name, notation, moves }))
 *
 * **Version 1's meaning is permanent**, as for position links: a change to
 * the JSON's shape is a new version character with its own reader. The JSON
 * is a copy of the DragonMove fields, so a *new optional* DragonMove field
 * is simply not carried by version 1 (the reader below rebuilds every object
 * from the fields it knows and drops the rest); a changed or removed one
 * needs version 2.
 *
 * Everything read is checked before use - the reader builds fresh objects
 * from known fields only, with every coordinate, digit, enum and length in
 * range, every coloured or eliminated candidate a pencil mark of the shared
 * grid - and nothing in a link is ever executed or used as markup (the
 * descriptions are shown as text). Size is capped both ways, before and
 * while inflating, so a crafted link can't stall the page. */

const VERSION = '1'
const HASH_KEY = '#d='

/** The longest payload read, in characters. The largest Dynamic Dragon in
 * the test sweep is ~6k; a URL this long still works in every current
 * browser, but is past what some chat apps keep. */
export const MAX_REPLAY_PAYLOAD_LENGTH = 200_000
/** The most JSON a payload may inflate to - a deflate bomb stops here. */
const MAX_INFLATED_BYTES = 4_000_000
const MAX_MOVES = 1000
const MAX_TEXT = 10_000
const MAX_LIST = 729

export type SharedDragonKind = 'dragon' | 'dynamic-dragon' | 'double-dragon' | 'double-dynamic-dragon'

const KIND_RANKS: Record<SharedDragonKind, number> = {
  dragon: RANK_DRAGON,
  'dynamic-dragon': RANK_DYNAMIC_DRAGON,
  'double-dragon': RANK_DOUBLE_DRAGON,
  'double-dynamic-dragon': RANK_DOUBLE_DYNAMIC_DRAGON,
}

export interface TechniqueReplay {
  /** The position the Dragon was found on (shareLink.ts's grid). */
  grid: Required<SavedGrid>
  kind: SharedDragonKind
  /** A Techniques-list row, rebuilt from the recorded fields exactly as
   * buildDragonInstance builds it - what the stepper and grid draw. */
  instance: TechniqueInstance
}

export type ReplayDecodeResult = { ok: true; replay: TechniqueReplay } | { ok: false; error: string }

/** Which kind of Dragon a Techniques-list row is, if it can be shared: a
 * row built by buildDragonInstance (its id prefix says which), with a move
 * log. Anything else - a chain, a fish, a Medusa - is null. */
export function shareableDragonKind(instance: TechniqueInstance): SharedDragonKind | null {
  if (!instance.moves || instance.moves.length === 0) {
    return null
  }
  // Longest prefix first: 'double-dynamic-dragon-...' also starts 'double-'.
  for (const kind of ['double-dynamic-dragon', 'double-dragon', 'dynamic-dragon', 'dragon'] as const) {
    if (instance.id.startsWith(`${kind}-`)) {
      return kind
    }
  }
  return null
}

function toBase64Url(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Inflates, giving up (null) past `limit` bytes - read chunk by chunk so a
 * bomb never gets the chance to fill memory. */
async function inflate(bytes: Uint8Array, limit: number): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.length
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** The text after `#d=` for this Dragon on this grid. `grid` must be the
 * position the row was found on. */
export async function encodeTechniqueReplay(grid: SavedGrid, instance: TechniqueInstance): Promise<string> {
  const kind = shareableDragonKind(instance)
  if (!kind) {
    throw new Error('Only Dragon Colouring rows can be shared.')
  }
  const json = JSON.stringify({
    grid: encodeShareState(grid),
    kind,
    id: instance.id,
    name: instance.name,
    notation: instance.notation,
    moves: instance.moves,
  })
  return VERSION + toBase64Url(await deflate(json))
}

/** Thrown for anything in the JSON that isn't a well-formed version 1 log. */
class Malformed extends Error {}

function need(ok: boolean): asserts ok {
  if (!ok) {
    throw new Malformed()
  }
}

type Json = Record<string, unknown>

function obj(value: unknown): Json {
  need(typeof value === 'object' && value !== null && !Array.isArray(value))
  return value as Json
}

function list(value: unknown, max = MAX_LIST): unknown[] {
  need(Array.isArray(value) && value.length <= max)
  return value as unknown[]
}

function text(value: unknown): string {
  need(typeof value === 'string' && value.length <= MAX_TEXT)
  return value as string
}

function index(value: unknown, max: number): number {
  need(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max)
  return value as number
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  need(typeof value === 'string' && (options as readonly string[]).includes(value))
  return value as T
}

const DRAGON_COLORS: readonly DragonColor[] = ['blue', 'yellow', 'darkBlue', 'orange']
const PRIMARY_COLORS: readonly PrimaryColor[] = ['blue', 'yellow']
const MOVE_KINDS: readonly DragonMoveKind[] = [
  'medusa',
  'extension-rule1',
  'extension-rule2',
  'extension-hidden-single',
  'extension-rule3',
  'promotion',
  'medusa-growth',
  'mass-elimination',
  'rule3',
  'rule4',
  'rule5',
  'solution',
  'dragon-link',
  'two-sided-colour',
  'two-sided',
]
const SUBSTEP_TECHNIQUES = [...ALL_RULE3_TECHNIQUES.filter((t) => t !== 'hidden single'), 'dragon colour extension'] as const
const AIC_PATTERNS: readonly ShortAicPattern[] = ['Skyscraper', 'Two-String Kite', 'Crane', 'Empty Rectangle', 'W-Wing', 'Y-Wing']

/** Reads a candidate on the shared grid. `marked`: it must be one of the
 * grid's pencil marks - every candidate a Dragon colours, eliminates or
 * places was one where it was found, so one that isn't means the log and the
 * grid don't belong together. */
function candidate(value: unknown, grid: Required<SavedGrid>, marked: boolean): DragonCandidateRef {
  const o = obj(value)
  const row = index(o.row, 8)
  const col = index(o.col, 8)
  const digit = index(o.digit, 9)
  need(digit >= 1)
  need(!marked || (grid.board[row][col] === 0 && grid.candidates[row][col][digit - 1]))
  return { row, col, digit }
}

function node(value: unknown, grid: Required<SavedGrid>): DragonNode {
  return { ...candidate(value, grid, true), color: oneOf(obj(value).color, DRAGON_COLORS) }
}

function cell(value: unknown): readonly [number, number] {
  const pair = list(value, 2)
  need(pair.length === 2)
  return [index(pair[0], 8), index(pair[1], 8)] as const
}

function aicLink(value: unknown, grid: Required<SavedGrid>): AicLinkRef {
  const o = obj(value)
  const link: AicLinkRef = {
    from: candidate(o.from, grid, false),
    to: candidate(o.to, grid, false),
    kind: oneOf(o.kind, ['strong', 'weak'] as const),
  }
  if (o.fromCells !== undefined) link.fromCells = list(o.fromCells, 81).map(cell)
  if (o.toCells !== undefined) link.toCells = list(o.toCells, 81).map(cell)
  return link
}

function aicChain(value: unknown, grid: Required<SavedGrid>) {
  const o = obj(value)
  return {
    candidates: list(o.candidates).map((c) => candidate(c, grid, false)),
    links: list(o.links).map((l) => aicLink(l, grid)),
  }
}

function substep(value: unknown, grid: Required<SavedGrid>): DragonRule3Substep {
  const o = obj(value)
  const step: DragonRule3Substep = {
    technique: oneOf(o.technique, SUBSTEP_TECHNIQUES),
    clause: text(o.clause),
    basisCells: list(o.basisCells).map(cell),
    eliminatedCandidates: list(o.eliminatedCandidates).map((c) => candidate(c, grid, true)),
  }
  if (o.aic !== undefined) {
    const aic = obj(o.aic)
    step.aic = {
      ...aicChain(aic, grid),
      ...(aic.pattern !== undefined ? { pattern: oneOf(aic.pattern, AIC_PATTERNS) } : {}),
    }
  }
  if (o.displayName !== undefined) step.displayName = text(o.displayName)
  return step
}

function move(value: unknown, grid: Required<SavedGrid>): DragonMove {
  const o = obj(value)
  const m: DragonMove = {
    id: text(o.id),
    kind: oneOf(o.kind, MOVE_KINDS),
    description: text(o.description),
    colored: list(o.colored).map((n) => node(n, grid)),
    eliminated: list(o.eliminated).map((c) => candidate(c, grid, true)),
    solved: list(o.solved).map((c) => candidate(c, grid, true)),
  }
  if (o.bothSides !== undefined) {
    const pair = list(o.bothSides, 2)
    need(pair.length === 2)
    m.bothSides = [node(pair[0], grid), node(pair[1], grid)]
  }
  if (o.provenTrueColor !== undefined) m.provenTrueColor = oneOf(o.provenTrueColor, PRIMARY_COLORS)
  if (o.dynamicTechniques !== undefined) {
    m.dynamicTechniques = list(o.dynamicTechniques, 64).map((t) => oneOf(t, SUBSTEP_TECHNIQUES.filter((s) => s !== 'dragon colour extension')))
  }
  if (o.dynamicTechniqueCells !== undefined) m.dynamicTechniqueCells = list(o.dynamicTechniqueCells).map(cell)
  if (o.aicChains !== undefined) {
    m.aicChains = list(o.aicChains, 64).map((chain) => ({
      ...aicChain(chain, grid),
      hypotheticalEliminations: list(obj(chain).hypotheticalEliminations).map((c) => candidate(c, grid, true)),
    }))
  }
  if (o.substeps !== undefined) m.substeps = list(o.substeps, 64).map((s) => substep(s, grid))
  if (o.emptiedCell !== undefined) m.emptiedCell = cell(o.emptiedCell)
  if (o.secondDragon !== undefined) {
    need(typeof o.secondDragon === 'boolean')
    m.secondDragon = o.secondDragon as boolean
  }
  return m
}

const DAMAGED = "This shared technique link is incomplete or damaged, so it couldn't be opened. Ask for the link again, copied whole."

/** The Dragon and position a link's payload (the text after `#d=`) holds,
 * or why it can't be opened. `variantPage`: the page it was opened on, as
 * for decodeShareState. Never throws. */
export async function decodeTechniqueReplay(payload: string, variantPage: boolean): Promise<ReplayDecodeResult> {
  try {
    if (payload.length > MAX_REPLAY_PAYLOAD_LENGTH) {
      return { ok: false, error: "This shared technique link is too long to open. Ask for the link again, copied whole." }
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(payload)) {
      return { ok: false, error: DAMAGED }
    }
    if (payload[0] !== VERSION) {
      return {
        ok: false,
        error: "This shared technique link was made by a newer version of this app, which this page can't read yet. Reload the page and open the link again.",
      }
    }
    if (typeof DecompressionStream === 'undefined') {
      return { ok: false, error: "This browser can't open shared technique links. Try the link in an up-to-date browser." }
    }
    const bytes = Uint8Array.from(atob(payload.slice(1).replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
    const inflated = await inflate(bytes, MAX_INFLATED_BYTES)
    if (!inflated) {
      return { ok: false, error: "This shared technique link is too large to open." }
    }
    const data = obj(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated)))
    const position = decodeShareState(text(data.grid), variantPage)
    if (!position.ok) {
      return position
    }
    const grid = position.grid
    const kind = oneOf(data.kind, Object.keys(KIND_RANKS) as SharedDragonKind[])
    const id = text(data.id)
    need(id.startsWith(`${kind}-`))
    const moves = list(data.moves, MAX_MOVES).map((m) => move(m, grid))
    need(moves.length > 0)
    // Exactly the row buildDragonInstance made: its eliminations and
    // placements are its moves', and its rank is its kind's.
    const instance: TechniqueInstance = {
      id,
      name: text(data.name),
      notation: text(data.notation),
      usedCells: [],
      usedCandidates: [],
      eliminatedCandidates: moves.flatMap((m) => m.eliminated),
      solvedCandidates: moves.flatMap((m) => m.solved),
      moves,
      techniqueRank: KIND_RANKS[kind],
    }
    return { ok: true, replay: { grid, kind, instance } }
  } catch {
    return { ok: false, error: DAMAGED }
  }
}

/** The payload of a technique link, given its fragment (`location.hash`) or
 * the whole link as text; null when it isn't one. */
export function replayPayloadOf(text: string): string | null {
  const trimmed = text.trim()
  const at = trimmed.indexOf(HASH_KEY)
  if (at < 0 || (at > 0 && !/^https?:\/\/\S+$/.test(trimmed))) {
    return null
  }
  return trimmed.slice(at + HASH_KEY.length)
}

/** The link for a payload - see shareLinkUrl. */
export function replayLinkUrl(payload: string, variantPage: boolean, siteUrl: string): string {
  return `${siteUrl}${variantPage ? 'variants/' : ''}${HASH_KEY}${payload}`
}

/** The viewer's working grid at the start of a replay: a deep copy of the
 * recorded position, so nothing done on the grid can reach the recording
 * (the step player always draws the recorded log, whatever the grid holds). */
export function replayStartGrid(replay: TechniqueReplay): Required<SavedGrid> {
  const { board, givens, candidates, candidateColors, constraints } = replay.grid
  return {
    board: board.map((row) => [...row]),
    givens: givens.map((row) => [...row]),
    candidates: candidates.map((row) => row.map((cell) => [...cell])),
    candidateColors: candidateColors.map((row) => row.map((cell) => [...cell])),
    constraints,
  }
}

/** Whether the working grid still holds the recorded position's digits and
 * pencil marks (colours aside - they don't change what a step shows). The
 * steps are drawn over the working grid, so once it differs a step may show
 * less than it did for the sharer: a mark the viewer removed can't be lit. */
export function gridMatchesReplay(grid: Pick<SavedGrid, 'board' | 'candidates'>, replay: TechniqueReplay): boolean {
  const start = replay.grid
  return grid.board.every((row, r) =>
    row.every(
      (value, c) => value === start.board[r][c] && grid.candidates[r][c].every((marked, d) => marked === start.candidates[r][c][d]),
    ),
  )
}

/** The technique link in the page's own address, read (null when there is
 * none) - what main.tsx waits for before rendering. Never rejects. */
export async function readReplayFromAddress(variantPage: boolean): Promise<ReplayDecodeResult | null> {
  const payload = replayPayloadOf(window.location.hash)
  return payload === null ? null : decodeTechniqueReplay(payload, variantPage)
}
