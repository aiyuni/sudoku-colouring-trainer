import { createEmptyBoard, createEmptyCandidateColors, createEmptyCandidates } from './boardUtils'
import { describeConstraintProblem, normalizeConstraints, type Cell, type KillerCage, type SudokuConstraints } from './SudokuConstraints'
import { SUDOKUWIKI_CUSTOM_SHAPE, SUDOKUWIKI_JIGSAW_SHAPES } from './sudokuWikiJigsawShapes'
import { CANDIDATE_COLOR_ORDER, type Board, type CandidateColorGrid, type CandidateGrid, type CandidatePaintShape } from './types'

/**
 * The Variant solver's own puzzle string: JSON, so it can be read, written
 * by hand and extended (a Thermo's lines would be one more key).
 *
 * {
 *   "variantSudoku": 1,
 *   "givens":  "81 digits, row by row, 0 = empty",
 *   "regions": "81 digits 1-9, the Jigsaw region of each cell" (left out for 3x3 boxes),
 *   "cages":   [[15, "r1c1", "r1c2"], [7, "r1c3", "r2c3"], ...]   (left out when there are none),
 *   -- "Copy Puzzle As-Is" only, the progress on top of the puzzle: --
 *   "board":      "81 digits" (givens and solved cells),
 *   "candidates": "81 comma-separated groups of digits",
 *   "paint":      { "r,c,d": [[paletteIndex, "circle"], ...] }
 * }
 *
 * A Classic puzzle string (81 characters, a Sudoku.Coach state...) is not
 * this format: the Variant page hands those to PuzzleImporter, and loads
 * them with no cages on the 3x3 boxes.
 */
export const VARIANT_FORMAT_VERSION = 1

/** Soft tints for the nine regions while a Jigsaw's layout is being drawn -
 * on the grid and on the region buttons, so the two can be matched by eye. */
export const REGION_TINTS: readonly string[] = ['#fca5a5', '#fdba74', '#fde047', '#86efac', '#67e8f9', '#93c5fd', '#c4b5fd', '#f9a8d4', '#cbd5e1']

/** A region draft's cell that belongs to no region yet. */
export const NO_REGION = -1

/** A draft with nothing drawn - where "draw the regions first" starts. */
export function blankRegionDraft(): number[][] {
  return Array.from({ length: 9 }, () => new Array<number>(9).fill(NO_REGION))
}

/** How many cells each of the nine regions has in a draft. */
export function regionSizes(draft: readonly (readonly number[])[]): number[] {
  const sizes = new Array<number>(9).fill(0)
  for (const row of draft) {
    for (const region of row) {
      if (region >= 0) {
        sizes[region]++
      }
    }
  }
  return sizes
}

/**
 * One cell of a drawing stroke on a region draft. 'paint' moves the cell
 * into `region` (nothing once the region has its nine cells); 'erase' takes
 * it out again, if it is in that region. Returns the new draft and the
 * region to go on with - the next one still short of nine cells when this
 * cell completed `region`, so nine regions can be drawn one after the other
 * without touching the buttons - or null when the cell changes nothing.
 */
export function drawRegionCell(
  draft: readonly (readonly number[])[],
  region: number,
  row: number,
  col: number,
  stroke: 'paint' | 'erase',
): { draft: number[][]; region: number; completed: boolean } | null {
  const here = draft[row][col]
  if (stroke === 'erase' ? here !== region : here === region) {
    return null
  }
  const sizes = regionSizes(draft)
  if (stroke === 'paint' && sizes[region] >= 9) {
    return null
  }
  const next = draft.map((cells) => [...cells])
  next[row][col] = stroke === 'erase' ? NO_REGION : region
  if (stroke === 'erase' || sizes[region] + 1 < 9) {
    return { draft: next, region, completed: false }
  }
  const after = regionSizes(next)
  let following = region
  for (let step = 1; step <= 9; step++) {
    const candidate = (region + step) % 9
    if (after[candidate] < 9) {
      following = candidate
      break
    }
  }
  return { draft: next, region: following, completed: true }
}

/** The 3x3 boxes written out as regions - what a Jigsaw's regions are
 * edited from, and compared with to tell a standard grid. */
export const STANDARD_REGIONS: number[][] = Array.from({ length: 9 }, (_, row) =>
  Array.from({ length: 9 }, (_, col) => Math.floor(row / 3) * 3 + Math.floor(col / 3)),
)

export interface VariantPuzzleState {
  board: Board
  givens: boolean[][]
  candidates: CandidateGrid
  candidateColors: CandidateColorGrid
  constraints: SudokuConstraints
}

export type VariantParseResult = ({ ok: true } & VariantPuzzleState) | { ok: false; error: string }

const cellName = ([row, col]: Cell) => `r${row + 1}c${col + 1}`

function parseCell(text: unknown): Cell | null {
  const match = typeof text === 'string' ? /^r([1-9])c([1-9])$/i.exec(text.trim()) : null
  return match ? [Number(match[1]) - 1, Number(match[2]) - 1] : null
}

const flat = (board: Board) => board.map((row) => row.join('')).join('')

/** The puzzle itself - its givens, regions and cages - with nothing of the
 * solver's progress ("Copy Original"). */
export function serializeVariantPuzzle(board: Board, givens: boolean[][], constraints: SudokuConstraints): string {
  const hasGivens = givens.some((row) => row.some(Boolean))
  // A grid typed in by hand has no givens: the digits on it are the puzzle.
  const givenBoard = board.map((row, r) => row.map((value, c) => (value !== 0 && (!hasGivens || givens[r][c]) ? value : 0)))
  return JSON.stringify(puzzleObject(givenBoard, constraints))
}

function puzzleObject(givenBoard: Board, constraints: SudokuConstraints): Record<string, unknown> {
  const out: Record<string, unknown> = { variantSudoku: VARIANT_FORMAT_VERSION, givens: flat(givenBoard) }
  if (constraints.regions) {
    out.regions = constraints.regions.map((row) => row.map((region) => region + 1).join('')).join('')
  }
  if (constraints.cages.length > 0) {
    out.cages = constraints.cages.map((cage) => [cage.sum, ...cage.cells.map(cellName)])
  }
  if (constraints.diagonals) {
    out.diagonals = true
  }
  if (constraints.antiKnight) {
    out.antiKnight = true
  }
  if (constraints.entropy) {
    out.entropy = true
  }
  return out
}

/** The puzzle and everything done to it so far ("Copy Puzzle As-Is"). */
export function serializeVariantState(state: VariantPuzzleState): string {
  const givenBoard = state.board.map((row, r) => row.map((value, c) => (state.givens[r][c] ? value : 0)))
  const out = puzzleObject(givenBoard, state.constraints)
  out.board = flat(state.board)
  out.candidates = state.candidates
    .flatMap((row) => row.map((cell) => cell.map((on, d) => (on ? d + 1 : '')).join('')))
    .join(',')
  const paint: Record<string, Array<[number, CandidatePaintShape]>> = {}
  state.candidateColors.forEach((row, r) =>
    row.forEach((cell, c) =>
      cell.forEach((layers, d) => {
        if (layers) {
          paint[`${r},${c},${d + 1}`] = layers.map((layer) => [CANDIDATE_COLOR_ORDER.indexOf(layer.color), layer.shape])
        }
      }),
    ),
  )
  if (Object.keys(paint).length > 0) {
    out.paint = paint
  }
  return JSON.stringify(out)
}

function parseDigits(text: unknown, low: number): number[][] | null {
  if (typeof text !== 'string') {
    return null
  }
  const cleaned = text.replace(/\s+/g, '').replace(/\./g, '0')
  if (cleaned.length !== 81 || [...cleaned].some((ch) => ch < String(low) || ch > '9')) {
    return null
  }
  return Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(cleaned[r * 9 + c])))
}

/** Whether `text` looks like this format at all - so a Classic string can go
 * to PuzzleImporter without first failing here with a confusing message. */
export function looksLikeVariantPuzzle(text: string): boolean {
  return /^\s*\{[\s\S]*"variantSudoku"/.test(text)
}

export function parseVariantPuzzle(text: string): VariantParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: "That isn't a readable variant puzzle (it should be the text Copy Original / Copy Puzzle As-Is gives)." }
  }
  if (!data || typeof data !== 'object' || !('variantSudoku' in data)) {
    return { ok: false, error: "That isn't a variant puzzle." }
  }
  const source = data as Record<string, unknown>

  const givenBoard = source.givens === undefined ? createEmptyBoard() : parseDigits(source.givens, 0)
  if (!givenBoard) {
    return { ok: false, error: 'The givens must be 81 digits (0 for an empty cell).' }
  }

  let regions: number[][] | null = null
  if (source.regions !== undefined && source.regions !== null) {
    const parsed = parseDigits(source.regions, 1)
    if (!parsed) {
      return { ok: false, error: 'The regions must be 81 digits from 1 to 9, one per cell.' }
    }
    regions = parsed.map((row) => row.map((region) => region - 1))
    // Regions that are just the 3x3 boxes are a standard grid.
    if (regions.every((row, r) => row.every((region, c) => region === Math.floor(r / 3) * 3 + Math.floor(c / 3)))) {
      regions = null
    }
  }

  const cages: KillerCage[] = []
  if (source.cages !== undefined && source.cages !== null) {
    if (!Array.isArray(source.cages)) {
      return { ok: false, error: 'The cages must be a list like [[15, "r1c1", "r1c2"], ...].' }
    }
    for (const entry of source.cages) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'number') {
        return { ok: false, error: 'Each cage must be its sum followed by its cells, like [15, "r1c1", "r1c2"].' }
      }
      const cells: Cell[] = []
      for (const cellText of entry.slice(1)) {
        const cell = parseCell(cellText)
        if (!cell) {
          return { ok: false, error: `"${String(cellText)}" isn't a cell (they are written r1c1 to r9c9).` }
        }
        cells.push(cell)
      }
      cages.push({ sum: entry[0], cells: cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]) })
    }
  }

  const constraints = normalizeConstraints({
    regions,
    cages,
    diagonals: source.diagonals === true,
    antiKnight: source.antiKnight === true,
    entropy: source.entropy === true,
  })
  const problem = describeConstraintProblem(constraints)
  if (problem) {
    return { ok: false, error: problem }
  }

  // Progress, when the string carries it. Anything unreadable in it is
  // dropped rather than refused: the puzzle itself is what matters.
  const progressBoard = parseDigits(source.board, 0)
  const board = progressBoard && givenBoard.every((row, r) => row.every((value, c) => value === 0 || progressBoard[r][c] === value)) ? progressBoard : givenBoard
  const givens = givenBoard.map((row) => row.map((value) => value !== 0))

  const candidates = createEmptyCandidates()
  if (typeof source.candidates === 'string') {
    const groups = source.candidates.split(',')
    if (groups.length === 81) {
      groups.forEach((group, index) => {
        const r = Math.floor(index / 9)
        const c = index % 9
        if (board[r][c] === 0) {
          for (const ch of group) {
            if (ch >= '1' && ch <= '9') {
              candidates[r][c][Number(ch) - 1] = true
            }
          }
        }
      })
    }
  }

  const candidateColors = createEmptyCandidateColors()
  if (source.paint && typeof source.paint === 'object') {
    for (const [key, layers] of Object.entries(source.paint as Record<string, unknown>)) {
      const [r, c, d] = key.split(',').map(Number)
      if (!(r >= 0 && r < 9 && c >= 0 && c < 9 && d >= 1 && d <= 9) || !candidates[r][c][d - 1] || !Array.isArray(layers)) {
        continue
      }
      const parsed = layers
        .slice(0, 2)
        .map((layer) =>
          Array.isArray(layer) && CANDIDATE_COLOR_ORDER[layer[0] as number] && ['circle', 'square', 'diamond'].includes(layer[1] as string)
            ? { color: CANDIDATE_COLOR_ORDER[layer[0] as number], shape: layer[1] as CandidatePaintShape }
            : null,
        )
        .filter((layer) => layer !== null)
      if (parsed.length === 1) {
        candidateColors[r][c][d - 1] = [parsed[0]]
      } else if (parsed.length === 2) {
        candidateColors[r][c][d - 1] = [parsed[0], parsed[1]]
      }
    }
  }

  return { ok: true, board, givens, candidates, candidateColors, constraints }
}

/**
 * The rules a Sudoku.Coach state string ("SCv7_32_...") says its puzzle has,
 * as far as this solver knows them: Sudoku.Coach lists a variant's rules
 * under `givenConstraints`, and an Entropy Sudoku carries
 * `{ "type": "globalEntropy" }` there. The digits themselves are read by the
 * Classic PuzzleImporter, untouched; this only looks for the rule, so the
 * import dialog can offer it already ticked. Empty for a Classic state, for
 * anything unreadable, and in a browser without DecompressionStream.
 */
export async function sudokuCoachStateRules(text: string): Promise<{ entropy: boolean }> {
  const none = { entropy: false }
  const match = /^SCv7_32_([0-9a-v]+)$/.exec(text.trim())
  if (!match || typeof DecompressionStream === 'undefined') {
    return none
  }
  try {
    // Base 32, five bits a character, most significant first.
    const alphabet = '0123456789abcdefghijklmnopqrstuv'
    const bytes: number[] = []
    let bits = 0
    let count = 0
    for (const ch of match[1]) {
      bits = ((bits << 5) | alphabet.indexOf(ch)) & 0xffff
      count += 5
      if (count >= 8) {
        count -= 8
        bytes.push((bits >> count) & 0xff)
      }
    }
    const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'))
    const state: unknown = JSON.parse(new TextDecoder().decode(await new Response(stream).arrayBuffer()))
    const given = state && typeof state === 'object' ? (state as Record<string, unknown>).givenConstraints : null
    if (!Array.isArray(given)) {
      return none
    }
    return { entropy: given.some((constraint) => constraint && typeof constraint === 'object' && (constraint as Record<string, unknown>).type === 'globalEntropy') }
  } catch {
    return none
  }
}

/** "Killer", "Jigsaw", "Killer Jigsaw", "X-Sudoku", "Anti-Knight" (or any
 * mix, e.g. "Anti-Knight X-Sudoku") or "Classic" - what the constraints make
 * the puzzle. */
export function variantName(constraints: SudokuConstraints): string {
  const parts = [
    constraints.antiKnight ? 'Anti-Knight' : '',
    constraints.entropy ? 'Entropy' : '',
    constraints.cages.length > 0 ? 'Killer' : '',
    constraints.regions !== null ? 'Jigsaw' : '',
    constraints.diagonals ? 'X-Sudoku' : '',
  ].filter((part) => part !== '')
  return parts.length > 0 ? parts.join(' ') : 'Classic'
}

/** The puzzle a first visit to the Variant page opens on: a gentle Killer
 * (made with VariantPuzzleGenerator), so the cages, their sums and the
 * Killer techniques are on screen straight away. */
export const DEFAULT_VARIANT_PUZZLE =
  '{"variantSudoku":1,"givens":"000000000000000000000000000000000000000000000000000000000000000000000000000000000","cages":[[13,"r1c1","r2c1","r2c2","r2c3"],[13,"r1c2","r1c3"],[22,"r1c4","r2c4","r2c5","r3c4","r3c5"],[11,"r1c5","r1c6"],[16,"r1c7","r2c6","r2c7"],[13,"r1c8","r2c8","r3c8"],[3,"r1c9"],[9,"r2c9"],[25,"r3c1","r3c2","r3c3","r4c2"],[17,"r3c6","r4c6","r4c7","r4c8"],[7,"r3c7"],[12,"r3c9","r4c9"],[11,"r4c1","r5c1","r5c2","r6c2"],[20,"r4c3","r4c4","r5c3"],[3,"r4c5"],[4,"r5c4"],[32,"r5c5","r6c3","r6c4","r6c5","r7c3"],[20,"r5c6","r5c7","r6c7","r7c7"],[11,"r5c8","r6c8"],[5,"r5c9"],[22,"r6c1","r7c1","r7c2","r8c1"],[10,"r6c6","r7c6"],[16,"r6c9","r7c8","r7c9"],[13,"r7c4","r7c5","r8c5"],[28,"r8c2","r8c3","r9c1","r9c2","r9c3"],[10,"r8c4","r9c4"],[8,"r8c6"],[13,"r8c7","r8c8","r9c7","r9c8"],[2,"r8c9"],[10,"r9c5","r9c6"],[6,"r9c9"]]}'

// ---- SudokuWiki strings ---------------------------------------------------

/**
 * SudokuWiki's Jigsaw and Killer puzzle strings (sudokuwiki.org/Jigsaw.aspx,
 * KillerSudoku.aspx - what its "Email This Board" gives, with or without the
 * page address in front):
 *
 *  - Jigsaw: `shape=1&bd=<81 digits>` - the givens, on one of the site's
 *    numbered layouts (sudokuWikiJigsawShapes.ts). A layout of the user's
 *    own is `shape=33&bd=...&jigmap=<81 digits 1-9>`. `bd` may also be 162
 *    characters: two base-32 characters per cell holding its candidates and
 *    whether it is a clue (the site's "with candidates" link).
 *  - Killer: `bd=<81 digits>,<162 digits>` - first a colour (1-4) per cell,
 *    where touching cells of one colour are one cage; then two digits per
 *    cell, the cage's sum in the one cell of each cage that shows it and 00
 *    everywhere else. A Killer Jigsaw adds `shape=` or `jigmap=`. With
 *    progress it is `bd=<162>,<162>` instead, two base-32 characters per
 *    cell: (cage sum << 3) | (colour - 1), then the candidates as in a Jigsaw.
 *
 * The site's newer packed strings (bd=J9B..., L9B..., M9B...) are a
 * compressed format of its own and are not read.
 */
export function looksLikeSudokuWikiVariant(text: string): boolean {
  const trimmed = text.trim()
  return (
    /(^|[?&\s])(shape|jigmap)=/i.test(trimmed) ||
    /sudokux[^?\s]*\?(.*&)?bd=[0-9.]{81}/i.test(trimmed) ||
    /(^|[?&=\s])[1-9]{81},\d{162}(\s|&|$)/.test(trimmed) ||
    /(^|[?&=\s])[0-9a-v]{162},[0-9a-v]{162}(\s|&|$)/i.test(trimmed)
  )
}

function sudokuWikiParams(text: string): Map<string, string> {
  const params = new Map<string, string>()
  const query = text.trim().replace(/^[^?]*\?/, '')
  for (const part of query.split(/[&\s]+/)) {
    const at = part.indexOf('=')
    if (at > 0) {
      params.set(part.slice(0, at).toLowerCase(), part.slice(at + 1))
    } else if (part !== '' && !params.has('bd')) {
      // The puzzle by itself, without its "bd=".
      params.set('bd', part)
    }
  }
  return params
}

function bitCount(mask: number): number {
  let count = 0
  for (let m = mask; m !== 0; m &= m - 1) {
    count++
  }
  return count
}

export function parseSudokuWikiVariant(text: string): VariantParseResult {
  const params = sudokuWikiParams(text)
  const bd = params.get('bd')
  if (!bd) {
    return { ok: false, error: 'A SudokuWiki puzzle needs its "bd=" part (the clues).' }
  }
  if (/^[JKLM]\d[A-Z]/.test(bd)) {
    return {
      ok: false,
      error: 'SudokuWiki packed strings (bd=J9B..., L9B...) are not readable here - use the string that starts with shape=, or the one with the colour and clue numbers.',
    }
  }

  // The layout: a numbered shape, or a map of the user's own.
  let regions: number[][] | null = null
  const jigmap = params.get('jigmap')
  const shape = params.get('shape')
  let regionText: string | null = null
  if (jigmap !== undefined) {
    regionText = jigmap
  } else if (shape !== undefined) {
    const number = Number(shape)
    if (!Number.isInteger(number) || number < 0 || number > SUDOKUWIKI_CUSTOM_SHAPE) {
      return { ok: false, error: `SudokuWiki has no Jigsaw shape ${shape} (they run from 1 to ${SUDOKUWIKI_CUSTOM_SHAPE - 1}).` }
    }
    if (number === SUDOKUWIKI_CUSTOM_SHAPE) {
      return {
        ok: false,
        error: `Shape ${SUDOKUWIKI_CUSTOM_SHAPE} is the "Custom" shape on SudokuWiki: the string must also carry the layout, as jigmap=<81 digits>.`,
      }
    }
    regionText = SUDOKUWIKI_JIGSAW_SHAPES[number].regions
  }
  if (regionText !== null) {
    const parsed = parseDigits(regionText, 1)
    if (!parsed) {
      return { ok: false, error: 'The jigmap must be 81 digits from 1 to 9, one per cell.' }
    }
    regions = parsed.map((row) => row.map((region) => region - 1))
    if (regions.every((row, r) => row.every((region, c) => region === STANDARD_REGIONS[r][c]))) {
      regions = null
    }
  }

  let board = createEmptyBoard()
  let givens = board.map((row) => row.map(() => false))
  const candidates = createEmptyCandidates()
  const cages: KillerCage[] = []

  /** Candidates and solved cells from 81 base-32 pairs: per cell,
   * (candidate bits << 1) | is-a-clue. */
  const readPackedCells = (packed: string) => {
    for (let index = 0; index < 81; index++) {
      const value = parseInt(packed.slice(index * 2, index * 2 + 2), 32)
      const mask = value >> 1
      const row = Math.floor(index / 9)
      const col = index % 9
      if (bitCount(mask) === 1) {
        board[row][col] = 32 - Math.clz32(mask)
        givens[row][col] = (value & 1) === 1
      } else {
        for (let digit = 1; digit <= 9; digit++) {
          candidates[row][col][digit - 1] = (mask & (1 << (digit - 1))) !== 0
        }
      }
    }
    // Every empty cell showing all nine digits is a grid nobody has marked:
    // that site writes "no marks yet" that way.
    if (board.every((row, r) => row.every((value, c) => value !== 0 || candidates[r][c].every(Boolean)))) {
      candidates.forEach((row) => row.forEach((cell) => cell.fill(false)))
    }
  }

  const packedKiller = /^([0-9a-v]{162}),([0-9a-v]{162})$/i.exec(bd)
  const plainKiller = /^([1-9]{81}),(\d{162})$/.exec(bd)
  if (plainKiller || packedKiller) {
    // Per cell: its colour (as a string) and the sum shown in it (0 = none).
    const cellInfo = Array.from({ length: 81 }, (_, index) => {
      if (plainKiller) {
        return { colour: plainKiller[1][index], clue: Number(plainKiller[2].slice(index * 2, index * 2 + 2)) }
      }
      const value = parseInt(packedKiller![1].slice(index * 2, index * 2 + 2), 32)
      return { colour: String(value & 7), clue: value >> 3 }
    })
    if (packedKiller) {
      readPackedCells(packedKiller[2])
    }
    const colourAt = (row: number, col: number) => cellInfo[row * 9 + col].colour
    const seen = new Set<number>()
    for (let start = 0; start < 81; start++) {
      if (seen.has(start)) {
        continue
      }
      // One cage: the cells of this colour reachable from here.
      const cells: Cell[] = []
      const queue = [start]
      seen.add(start)
      while (queue.length > 0) {
        const index = queue.pop()!
        const row = Math.floor(index / 9)
        const col = index % 9
        cells.push([row, col])
        for (const [r, c] of [
          [row - 1, col],
          [row + 1, col],
          [row, col - 1],
          [row, col + 1],
        ]) {
          if (r >= 0 && r < 9 && c >= 0 && c < 9 && !seen.has(r * 9 + c) && colourAt(r, c) === colourAt(row, col)) {
            seen.add(r * 9 + c)
            queue.push(r * 9 + c)
          }
        }
      }
      cells.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      const sums = cells.map(([row, col]) => cellInfo[row * 9 + col].clue).filter((sum) => sum > 0)
      const [row, col] = cells[0]
      if (sums.length !== 1) {
        return {
          ok: false,
          error:
            sums.length === 0
              ? `The cage at r${row + 1}c${col + 1} has no sum in the clue numbers.`
              : `The cage at r${row + 1}c${col + 1} has ${sums.length} sums in the clue numbers - two cages of one colour may be touching.`,
        }
      }
      cages.push({ sum: sums[0], cells })
    }
  } else if (/^[0-9a-v]{162}$/i.test(bd)) {
    readPackedCells(bd)
  } else {
    const parsed = parseDigits(bd, 0)
    if (!parsed) {
      return {
        ok: false,
        error: 'The "bd=" part must be 81 digits (the clues of a Jigsaw), or 81 colour digits, a comma and 162 clue digits (a Killer).',
      }
    }
    board = parsed
    givens = board.map((row) => row.map((value) => value !== 0))
  }

  // A link to the site's X-Sudoku solver (sudokux.aspx?bd=...) is the same
  // 81 clues with the two diagonals as extra units.
  const constraints = normalizeConstraints({ regions, cages, diagonals: /sudokux/i.test(text) })
  const problem = describeConstraintProblem(constraints)
  if (problem) {
    return { ok: false, error: problem }
  }
  return { ok: true, board, givens, candidates, candidateColors: createEmptyCandidateColors(), constraints }
}

// ---- Writing SudokuWiki strings (Copy Original / Copy Puzzle As-Is) --------

/** A layout's regions relabelled in order of first appearance, so two maps of
 * the same shape compare equal whatever numbers they use. */
function canonicalRegions(regionOf: (row: number, col: number) => number | string): string {
  const labels = new Map<number | string, number>()
  let out = ''
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const region = regionOf(row, col)
      if (!labels.has(region)) {
        labels.set(region, labels.size + 1)
      }
      out += labels.get(region)
    }
  }
  return out
}

const layoutJigmap = (regions: number[][]) => regions.map((row) => row.map((region) => region + 1).join('')).join('')

let canonicalShapes: string[] | null = null

/** The `shape=` part of a SudokuWiki string for these regions: the site's own
 * shape number when the layout is one of its numbered ones, else its
 * "Custom" number with the layout spelt out as a jigmap. */
function sudokuWikiShape(regions: number[][]): { shape: number; jigmap: string | null } {
  canonicalShapes ??= SUDOKUWIKI_JIGSAW_SHAPES.map((entry) => canonicalRegions((row, col) => entry.regions[row * 9 + col]))
  const number = canonicalShapes.indexOf(canonicalRegions((row, col) => regions[row][col]))
  return number > 0
    ? { shape: number, jigmap: null }
    : { shape: SUDOKUWIKI_CUSTOM_SHAPE, jigmap: layoutJigmap(regions) }
}

/** A colour 1-4 per cage with no two touching cages alike - what SudokuWiki's
 * Killer string tells cages apart by. Four always suffice for cages in one
 * piece (they are a map); a cage in several pieces can need more, and the
 * digits up to 9 are there for that. Null if even nine don't do. */
function colourCages(cages: readonly KillerCage[]): number[] | null {
  const cageAt = new Array<number>(81).fill(-1)
  cages.forEach((cage, index) => cage.cells.forEach(([row, col]) => (cageAt[row * 9 + col] = index)))
  const touching: Set<number>[] = cages.map(() => new Set<number>())
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const here = cageAt[row * 9 + col]
      for (const [r, c] of [
        [row + 1, col],
        [row, col + 1],
      ]) {
        const there = r < 9 && c < 9 ? cageAt[r * 9 + c] : -1
        if (here >= 0 && there >= 0 && here !== there) {
          touching[here].add(there)
          touching[there].add(here)
        }
      }
    }
  }
  for (let palette = 4; palette <= 9; palette++) {
    const colours = new Array<number>(cages.length).fill(0)
    let steps = 0
    const assign = (index: number): boolean => {
      if (index === cages.length) {
        return true
      }
      if (++steps > 200_000) {
        return false
      }
      for (let colour = 1; colour <= palette; colour++) {
        if ([...touching[index]].every((other) => colours[other] !== colour)) {
          colours[index] = colour
          if (assign(index + 1)) {
            return true
          }
        }
      }
      colours[index] = 0
      return false
    }
    if (assign(0)) {
      return colours
    }
  }
  return null
}

const base32Pair = (value: number) => value.toString(32).padStart(2, '0')

/** A cell's candidates as SudokuWiki packs them: the placed digit's bit, or
 * the marked digits' bits - all nine for a cell with no marks, which is how
 * that site writes a cell nobody has worked on. */
function sudokuWikiMask(value: number, marks: readonly boolean[]): number {
  if (value !== 0) {
    return 1 << (value - 1)
  }
  const mask = marks.reduce((bits, on, d) => (on ? bits | (1 << d) : bits), 0)
  return mask === 0 ? 511 : mask
}

/** Whether a Killer can be written as a SudokuWiki string at all: that
 * format has a colour and a clue for every cell and no givens, so every cell
 * must be in a cage. */
function killerFitsSudokuWiki(constraints: SudokuConstraints): number[] | null {
  const caged = constraints.cages.reduce((total, cage) => total + cage.cells.length, 0)
  return caged === 81 ? colourCages(constraints.cages) : null
}

/** Per cell: its cage's colour, and the cage's sum in the cage's first cell
 * (0 elsewhere). */
function killerCells(constraints: SudokuConstraints, colours: readonly number[]): Array<{ colour: number; clue: number }> {
  const cells = Array.from({ length: 81 }, () => ({ colour: 1, clue: 0 }))
  constraints.cages.forEach((cage, index) => {
    cage.cells.forEach(([row, col], position) => {
      cells[row * 9 + col] = { colour: colours[index], clue: position === 0 ? cage.sum : 0 }
    })
  })
  return cells
}

/**
 * "Copy Original" as a SudokuWiki string - the format the import box reads
 * (parseSudokuWikiVariant) and that site's solvers load:
 *  - Jigsaw: `shape=N&bd=<81 clue digits>` (+ `&jigmap=` for a layout that
 *    isn't one of the site's numbered ones);
 *  - Killer: `bd=<81 colours>,<162 clue digits>` (+ `&shape=33&jigmap=` on a
 *    Killer Jigsaw).
 * Null when the puzzle can't be written that way - a Killer with cells in no
 * cage, or with givens (the Killer string has no place for either) - and for
 * a puzzle with neither regions nor cages, which is a Classic string's job.
 */
export function serializeSudokuWikiPuzzle(board: Board, givens: boolean[][], constraints: SudokuConstraints): string | null {
  // Neither string has a place for the diagonals, the Anti-Knight rule or
  // the Entropy rule.
  if (constraints.diagonals || constraints.antiKnight || constraints.entropy) {
    return null
  }
  const hasGivens = givens.some((row) => row.some(Boolean))
  const givenBoard = board.map((row, r) => row.map((value, c) => (value !== 0 && (!hasGivens || givens[r][c]) ? value : 0)))
  const layout = constraints.regions ? sudokuWikiShape(constraints.regions) : null
  if (constraints.cages.length === 0) {
    if (!layout) {
      return null
    }
    return `shape=${layout.shape}&bd=${flat(givenBoard)}${layout.jigmap ? `&jigmap=${layout.jigmap}` : ''}`
  }
  const colours = killerFitsSudokuWiki(constraints)
  if (!colours || givenBoard.some((row) => row.some((value) => value !== 0))) {
    return null
  }
  const cells = killerCells(constraints, colours)
  return (
    `bd=${cells.map((cell) => cell.colour).join('')},${cells.map((cell) => String(cell.clue).padStart(2, '0')).join('')}` +
    (constraints.regions ? `&shape=${SUDOKUWIKI_CUSTOM_SHAPE}&jigmap=${layoutJigmap(constraints.regions)}` : '')
  )
}

/**
 * "Copy Puzzle As-Is" as a SudokuWiki string: the puzzle with the solved
 * cells and candidates, in that site's "with current progress" form - two
 * base-32 characters per cell.
 *  - Jigsaw: `shape=N&bd=<162>`, each cell (candidate bits << 1) | is-a-clue;
 *  - Killer: `bd=<162>,<162>`, first each cell's (cage sum << 3) | (colour -
 *    1) - the sum in the cage's first cell only - then its candidate bits
 *    << 1.
 * The colours painted on candidates are not part of that format and are
 * left out. Null in the same cases as serializeSudokuWikiPuzzle.
 */
export function serializeSudokuWikiState(state: VariantPuzzleState): string | null {
  const { board, givens, candidates, constraints } = state
  if (constraints.diagonals || constraints.antiKnight || constraints.entropy) {
    return null
  }
  const packedCandidates = (clueBit: boolean) =>
    board
      .flatMap((row, r) => row.map((value, c) => base32Pair((sudokuWikiMask(value, candidates[r][c]) << 1) | (clueBit && givens[r][c] ? 1 : 0))))
      .join('')
  if (constraints.cages.length === 0) {
    if (!constraints.regions) {
      return null
    }
    const layout = sudokuWikiShape(constraints.regions)
    return `shape=${layout.shape}&bd=${packedCandidates(true)}${layout.jigmap ? `&jigmap=${layout.jigmap}` : ''}`
  }
  const colours = killerFitsSudokuWiki(constraints)
  if (!colours || givens.some((row) => row.some(Boolean))) {
    return null
  }
  const cells = killerCells(constraints, colours)
  return (
    `bd=${cells.map((cell) => base32Pair((cell.clue << 3) | (cell.colour - 1))).join('')},${packedCandidates(false)}` +
    (constraints.regions ? `&shape=${SUDOKUWIKI_CUSTOM_SHAPE}&jigmap=${layoutJigmap(constraints.regions)}` : '')
  )
}
