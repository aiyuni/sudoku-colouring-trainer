import type { SavedGrid } from './persistedState'
import {
  CLASSIC_CONSTRAINTS,
  describeConstraintProblem,
  normalizeConstraints,
  type Cell,
  type KillerCage,
  type SudokuConstraints,
} from './sudoku/SudokuConstraints'
import {
  CANDIDATE_COLOR_ORDER,
  type CandidateColorGrid,
  type CandidatePaint,
  type CandidatePaintLayer,
  type CandidatePaintShape,
} from './sudoku/types'

/** Share links: the whole position - givens, entered digits, pencil marks,
 * candidate colours and, on the Variant page, the puzzle's constraints (what
 * a Saved Puzzles entry holds) - written into the URL itself:
 *
 *   https://<site>/#p=1<base64url>            Classic solver
 *   https://<site>/variants/#p=1<base64url>   Variant solver
 *
 * Nothing is stored anywhere (the site is static, and a link must still open
 * years later on someone else's device), so the link *is* the state. It sits
 * in the fragment, which never reaches a server: no route to add, no 404 on
 * GitHub Pages, and no length limit but the browser's own.
 *
 * The character after `p=` is the format version; the rest is a bit stream
 * (most significant bit first, zero-padded to a byte) in base64url:
 *
 *   3 bits   rules: diagonals, anti-knight, entropy
 *   1 bit    has Jigsaw regions        1 bit   has Killer cages
 *   81 cells, row by row:
 *     4 bits digit (0 = empty); if not 0: 1 bit "is a given"
 *     1 bit  has pencil marks;  if so:   9 bits, digit 1 first
 *   10 bits  number of coloured candidates, then each, in ascending order:
 *     10 bits cell * 9 + digit - 1, 1 bit "two colours", and per colour
 *     4 bits position in CANDIDATE_COLOR_ORDER + 2 bits shape
 *   regions: 81 x 4 bits               cages: 7 bits count, then each
 *     6 bits sum, 4 bits cell count, 7 bits per cell (row * 9 + col)
 *
 * A typical mid-solve Classic position is ~150 characters; a plain JSON
 * GridState would be ~12,000.
 *
 * **Version 1's layout is permanent**: links are out in the world for good.
 * A change of format is a new version character with its own reader beside
 * this one, never an edit to this one. The same goes for what it leans on:
 * CANDIDATE_COLOR_ORDER and SHAPES are append-only. Nothing else outside this
 * file decides what a link means - no setting, default or generator.
 *
 * The same state always gives the same link (one encoding per state, and the
 * reader refuses any other spelling of it), and every read is validated all
 * the way: a link that is cut short, mistyped or from a newer version is
 * refused whole, with a reason, and the grid is left alone. */

const VERSION = '1'
const SHAPES: readonly CandidatePaintShape[] = ['circle', 'square', 'diamond']
const HASH_KEY = '#p='

export type ShareDecodeResult = { ok: true; grid: Required<SavedGrid> } | { ok: false; error: string }

class BitWriter {
  private readonly bytes: number[] = []
  private used = 0

  write(value: number, bits: number): void {
    for (let bit = bits - 1; bit >= 0; bit--) {
      if (this.used % 8 === 0) {
        this.bytes.push(0)
      }
      if ((value >> bit) & 1) {
        this.bytes[this.bytes.length - 1] |= 0x80 >> this.used % 8
      }
      this.used++
    }
  }

  toBase64Url(): string {
    return btoa(String.fromCharCode(...this.bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }
}

/** Thrown by the reader for anything that isn't a well-formed version 1
 * stream; decodeShareState turns it into the one "damaged link" message. */
class Malformed extends Error {}

class BitReader {
  private position = 0
  private readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  read(bits: number): number {
    let value = 0
    for (let bit = 0; bit < bits; bit++) {
      if (this.position >= this.bytes.length * 8) {
        throw new Malformed()
      }
      value = (value << 1) | ((this.bytes[this.position >> 3] >> (7 - (this.position % 8))) & 1)
      this.position++
    }
    return value
  }

  /** What's left must be the zero padding of the last byte and nothing else. */
  finish(): void {
    const left = this.bytes.length * 8 - this.position
    if (left >= 8 || this.read(left) !== 0) {
      throw new Malformed()
    }
  }
}

function need(ok: boolean): asserts ok {
  if (!ok) {
    throw new Malformed()
  }
}

/** The text after `#p=` for this position. */
export function encodeShareState(grid: SavedGrid): string {
  const constraints = normalizeConstraints(grid.constraints ?? CLASSIC_CONSTRAINTS)
  const out = new BitWriter()
  out.write(constraints.diagonals ? 1 : 0, 1)
  out.write(constraints.antiKnight ? 1 : 0, 1)
  out.write(constraints.entropy ? 1 : 0, 1)
  out.write(constraints.regions ? 1 : 0, 1)
  out.write(constraints.cages.length > 0 ? 1 : 0, 1)
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const digit = grid.board[r][c]
      out.write(digit, 4)
      if (digit !== 0) {
        out.write(grid.givens[r][c] ? 1 : 0, 1)
      }
      const marks = grid.candidates[r][c].reduce((mask, on, d) => (on ? mask | (0x100 >> d) : mask), 0)
      out.write(marks === 0 ? 0 : 1, 1)
      if (marks !== 0) {
        out.write(marks, 9)
      }
    }
  }
  const colours: Array<[number, CandidatePaint]> = []
  grid.candidateColors.forEach((row, r) =>
    row.forEach((cell, c) =>
      cell.forEach((paint, d) => {
        if (paint) {
          colours.push([(r * 9 + c) * 9 + d, paint])
        }
      }),
    ),
  )
  out.write(colours.length, 10)
  for (const [index, paint] of colours) {
    out.write(index, 10)
    out.write(paint.length - 1, 1)
    for (const layer of paint) {
      out.write(CANDIDATE_COLOR_ORDER.indexOf(layer.color), 4)
      out.write(SHAPES.indexOf(layer.shape), 2)
    }
  }
  if (constraints.regions) {
    for (const region of constraints.regions.flat()) {
      out.write(region, 4)
    }
  }
  if (constraints.cages.length > 0) {
    out.write(constraints.cages.length, 7)
    for (const cage of constraints.cages) {
      out.write(cage.sum, 6)
      out.write(cage.cells.length, 4)
      for (const [row, col] of cage.cells) {
        out.write(row * 9 + col, 7)
      }
    }
  }
  return VERSION + out.toBase64Url()
}

function readVersion1(bytes: Uint8Array): Required<SavedGrid> {
  const input = new BitReader(bytes)
  const diagonals = input.read(1) === 1
  const antiKnight = input.read(1) === 1
  const entropy = input.read(1) === 1
  const hasRegions = input.read(1) === 1
  const hasCages = input.read(1) === 1
  const cells = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0))
  const board = cells.map((row) => [...row])
  const givens = cells.map((row) => row.map(() => false))
  const candidates = cells.map((row) => row.map(() => Array.from({ length: 9 }, () => false)))
  const candidateColors: CandidateColorGrid = cells.map((row) => row.map(() => Array.from({ length: 9 }, () => null)))
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const digit = input.read(4)
      need(digit <= 9)
      board[r][c] = digit
      givens[r][c] = digit !== 0 && input.read(1) === 1
      if (input.read(1) === 1) {
        const marks = input.read(9)
        // "Has marks" with none set is a second spelling of "no marks".
        need(marks !== 0)
        candidates[r][c] = candidates[r][c].map((_, d) => (marks & (0x100 >> d)) !== 0)
      }
    }
  }
  const colourCount = input.read(10)
  let previous = -1
  for (let i = 0; i < colourCount; i++) {
    const index = input.read(10)
    need(index > previous && index < 729)
    previous = index
    const layers: CandidatePaintLayer[] = []
    for (let layer = input.read(1); layer >= 0; layer--) {
      const color = CANDIDATE_COLOR_ORDER[input.read(4)]
      const shape = SHAPES[input.read(2)]
      need(color !== undefined && shape !== undefined)
      layers.push({ color, shape })
    }
    candidateColors[Math.floor(index / 81)][Math.floor(index / 9) % 9][index % 9] =
      layers.length === 1 ? [layers[0]] : [layers[0], layers[1]]
  }
  let regions: number[][] | null = null
  if (hasRegions) {
    regions = cells.map((row) => row.map(() => input.read(4)))
  }
  const cages: KillerCage[] = []
  if (hasCages) {
    const cageCount = input.read(7)
    need(cageCount >= 1 && cageCount <= 81)
    for (let i = 0; i < cageCount; i++) {
      const sum = input.read(6)
      const size = input.read(4)
      const cageCells: Cell[] = []
      for (let k = 0; k < size; k++) {
        const cell = input.read(7)
        need(cell < 81)
        cageCells.push([Math.floor(cell / 9), cell % 9])
      }
      cages.push({ sum, cells: cageCells })
    }
  }
  input.finish()
  const constraints: SudokuConstraints = normalizeConstraints({ regions, cages, diagonals, antiKnight, entropy })
  // Region numbers, cage sizes and sums, a cell in two cages: the same check
  // an imported or hand-edited layout has to pass.
  need(constraints === CLASSIC_CONSTRAINTS || describeConstraintProblem(constraints) === null)
  return { board, givens, candidates, candidateColors, constraints }
}

const DAMAGED = "This shared link is incomplete or damaged, so its puzzle couldn't be opened. Ask for the link again, copied whole."

/** The position a link's payload (the text after `#p=`) holds, or why it
 * can't be opened. `variantPage` is the page it was opened on: the Classic
 * page never loads anything but a standard grid. Never throws. */
export function decodeShareState(payload: string, variantPage: boolean): ShareDecodeResult {
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(payload)) {
      return { ok: false, error: DAMAGED }
    }
    if (payload[0] !== VERSION) {
      return {
        ok: false,
        error: "This shared link was made by a newer version of this app, which this page can't read yet. Reload the page and open the link again.",
      }
    }
    const text = atob(payload.slice(1).replace(/-/g, '+').replace(/_/g, '/'))
    const grid = readVersion1(Uint8Array.from(text, (char) => char.charCodeAt(0)))
    if (!variantPage && grid.constraints !== CLASSIC_CONSTRAINTS) {
      return { ok: false, error: 'This shared link is for the Variant solver - open it with /variants/ in its address, as it was copied.' }
    }
    // One state, one link: a payload that reads but isn't how this state is
    // written (stray bits in the base64 tail, say) has been altered.
    if (encodeShareState(grid) !== payload) {
      return { ok: false, error: DAMAGED }
    }
    return { ok: true, grid }
  } catch {
    return { ok: false, error: DAMAGED }
  }
}

/** The payload of a share link, given its fragment (`location.hash`) or the
 * whole link as text (pasted into the import box); null when it isn't one -
 * any other fragment or text is none of this module's business. */
export function sharePayloadOf(text: string): string | null {
  const trimmed = text.trim()
  const at = trimmed.indexOf(HASH_KEY)
  if (at < 0 || (at > 0 && !/^https?:\/\/\S+$/.test(trimmed))) {
    return null
  }
  return trimmed.slice(at + HASH_KEY.length)
}

/** The link for a payload. `siteUrl` is the deployed site's root, ending in
 * a slash; the Variant solver lives at `variants/` under it. */
export function shareLinkUrl(payload: string, variantPage: boolean, siteUrl: string): string {
  return `${siteUrl}${variantPage ? 'variants/' : ''}${HASH_KEY}${payload}`
}
