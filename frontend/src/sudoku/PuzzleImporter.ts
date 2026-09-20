import { createEmptyCandidates, markedCandidateDigits } from './boardUtils'
import type { Board, CandidateGrid } from './types'

const BOARD_SIZE = 9
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE
const STATE_PREFIX = 'SCv7_'
const SUPPORTED_ENCODING_TAG = '32'
const BASE32_ALPHABET = '0123456789abcdefghijklmnopqrstuv'

export type ImportResult =
  | { ok: true; board: Board; givens: boolean[][]; candidates: CandidateGrid }
  | { ok: false; error: string }

interface SudokuCoachState {
  gridSize?: number
  givenDigits?: string
  userDigits?: string
  userCellCandidates?: string
}

/**
 * Parses puzzle strings from the sources people paste in:
 *  - A plain 81-character givens string (row-major, '0' or '.' empty,
 *    '1'-'9' a given digit) - the format Sudoku.Coach and most other sites
 *    use for a bare puzzle string
 *  - Sudoku.Coach's full "SCv7_32_<payload>" state string, which is
 *    base32(deflate(json)) of a state object also carrying the user's
 *    entered digits and pencil marks (each candidate digit d is bit d,
 *    1-9, of a per-cell integer)
 *  - SudokuWiki.org's "text version of the board": an ASCII grid with one
 *    or more digits per cell (a single digit is a solved cell, several are
 *    its candidates)
 */
export class PuzzleImporter {
  async import(raw: string): Promise<ImportResult> {
    const trimmed = raw.trim()
    if (trimmed.startsWith(STATE_PREFIX)) {
      return this.importSudokuCoachState(trimmed)
    }
    if (trimmed.includes('|') && trimmed.includes('\n')) {
      return this.importSudokuWikiBoard(trimmed)
    }
    return this.importGivensOnly(trimmed)
  }

  private importGivensOnly(raw: string): ImportResult {
    const digits = raw.replace(/\s+/g, '')

    if (digits.length !== CELL_COUNT) {
      return {
        ok: false,
        error: `Expected an 81-character puzzle string, got ${digits.length}.`,
      }
    }
    if (!/^[0-9.]{81}$/.test(digits)) {
      return { ok: false, error: 'The puzzle string must contain only digits 0-9 or "." for empty cells.' }
    }

    // '.' is the other common stand-in for an empty cell (alongside '0');
    // normalize it before splitting into given digits.
    const normalized = digits.replace(/\./g, '0')
    return this.buildResultFromDigitStrings(normalized, '0'.repeat(CELL_COUNT), '')
  }

  private async importSudokuCoachState(raw: string): Promise<ImportResult> {
    if (typeof DecompressionStream === 'undefined') {
      return {
        ok: false,
        error: 'This browser cannot decompress Sudoku.Coach puzzle links; try a recent Chrome, Edge, or Firefox.',
      }
    }

    const parts = raw.split('_')
    if (parts.length < 3) {
      return { ok: false, error: 'That Sudoku.Coach string looks incomplete.' }
    }

    const [, tag, ...payloadParts] = parts
    if (tag !== SUPPORTED_ENCODING_TAG) {
      return {
        ok: false,
        error: `Unsupported Sudoku.Coach puzzle encoding "${tag}_" (only "32_" is supported).`,
      }
    }

    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = this.decodeBase32(payloadParts.join('_'))
    } catch {
      return { ok: false, error: 'Could not decode the Sudoku.Coach puzzle data.' }
    }

    let json: string
    try {
      json = await this.inflate(bytes)
    } catch {
      return { ok: false, error: 'Could not decompress the Sudoku.Coach puzzle data.' }
    }

    let state: SudokuCoachState
    try {
      state = JSON.parse(json)
    } catch {
      return { ok: false, error: 'The Sudoku.Coach puzzle data was not valid.' }
    }

    if (state.gridSize !== undefined && state.gridSize !== BOARD_SIZE) {
      return {
        ok: false,
        error: `Only 9x9 puzzles are supported (this one is ${state.gridSize}x${state.gridSize}).`,
      }
    }

    const givenDigits = state.givenDigits ?? '0'.repeat(CELL_COUNT)
    const userDigits = state.userDigits ?? '0'.repeat(CELL_COUNT)
    if (!/^[0-9]{81}$/.test(givenDigits) || !/^[0-9]{81}$/.test(userDigits)) {
      return { ok: false, error: "The puzzle's digits were not in the expected format." }
    }

    return this.buildResultFromDigitStrings(givenDigits, userDigits, state.userCellCandidates ?? '')
  }

  /**
   * SudokuWiki's text board has no concept of "given" vs "solved by you" -
   * every solved cell is just shown as its digit - so none of them come in
   * locked; only Sudoku.Coach's own given/user distinction does that.
   */
  private importSudokuWikiBoard(raw: string): ImportResult {
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('+'))

    if (lines.length !== BOARD_SIZE) {
      return {
        ok: false,
        error: `Expected 9 rows in the SudokuWiki board, found ${lines.length}.`,
      }
    }

    const board: Board = []
    const givens: boolean[][] = []
    const candidates = createEmptyCandidates()

    for (let row = 0; row < BOARD_SIZE; row++) {
      const tokens = lines[row]
        .replace(/\|/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0)

      if (tokens.length !== BOARD_SIZE) {
        return {
          ok: false,
          error: `Row ${row + 1} of the SudokuWiki board has ${tokens.length} cells instead of 9.`,
        }
      }

      const rowDigits: number[] = []
      const rowGivens: boolean[] = []
      for (let col = 0; col < BOARD_SIZE; col++) {
        const token = tokens[col]
        if (!/^[1-9]+$/.test(token)) {
          return {
            ok: false,
            error: `Cell at row ${row + 1}, column ${col + 1} ("${token}") isn't a valid digit or candidate list.`,
          }
        }

        if (token.length === 1) {
          rowDigits.push(Number(token))
        } else {
          rowDigits.push(0)
          for (const char of token) {
            candidates[row][col][Number(char) - 1] = true
          }
        }
        rowGivens.push(false)
      }
      board.push(rowDigits)
      givens.push(rowGivens)
    }

    return { ok: true, board, givens, candidates }
  }

  private buildResultFromDigitStrings(
    givenDigits: string,
    userDigits: string,
    cellCandidates: string,
  ): ImportResult {
    const board: Board = []
    const givens: boolean[][] = []
    for (let row = 0; row < BOARD_SIZE; row++) {
      const rowDigits: number[] = []
      const rowGivens: boolean[] = []
      for (let col = 0; col < BOARD_SIZE; col++) {
        const i = row * BOARD_SIZE + col
        const given = Number(givenDigits[i])
        rowDigits.push(given !== 0 ? given : Number(userDigits[i]))
        rowGivens.push(given !== 0)
      }
      board.push(rowDigits)
      givens.push(rowGivens)
    }

    const candidates = this.parseCoachCandidates(cellCandidates, board)

    return { ok: true, board, givens, candidates }
  }

  private parseCoachCandidates(cellCandidates: string, board: Board): CandidateGrid {
    const candidates = createEmptyCandidates()
    if (cellCandidates.length === 0) {
      return candidates
    }

    const values = cellCandidates.split('-').map(Number)
    if (values.length !== CELL_COUNT) {
      return candidates
    }

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0) {
          // A solved cell keeps no pencil marks.
          continue
        }
        const value = values[row * BOARD_SIZE + col]
        for (let digit = 1; digit <= 9; digit++) {
          candidates[row][col][digit - 1] = (value & (1 << digit)) !== 0
        }
      }
    }

    return candidates
  }

  /**
   * Builds a Sudoku.Coach "SCv7_32_<payload>" state string for the current
   * grid - the exact reverse of importSudokuCoachState: the same
   * given/user digit strings and bit-per-digit candidate encoding, JSON-
   * stringified, deflated, and base32-encoded.
   */
  async exportToSudokuCoachState(board: Board, givens: boolean[][], candidates: CandidateGrid): Promise<string> {
    let givenDigits = ''
    let userDigits = ''
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const value = board[row][col]
        givenDigits += givens[row][col] ? String(value) : '0'
        userDigits += !givens[row][col] && value !== 0 ? String(value) : '0'
      }
    }

    const cellValues: number[] = []
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        let value = 0
        if (board[row][col] === 0) {
          for (const digit of markedCandidateDigits(candidates[row][col])) {
            value |= 1 << digit
          }
        }
        cellValues.push(value)
      }
    }

    const json = JSON.stringify({
      gridSize: BOARD_SIZE,
      givenDigits,
      userDigits,
      userCellCandidates: cellValues.join('-'),
    })
    const compressed = await this.deflateCompress(json)
    return `${STATE_PREFIX}${SUPPORTED_ENCODING_TAG}_${this.encodeBase32(compressed)}`
  }

  private async deflateCompress(text: string): Promise<Uint8Array> {
    const bytes = new TextEncoder().encode(text)
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }

  /** The exact reverse of decodeBase32 below - same unpadded base32hex
   * bit-packing (5 bytes -> 8 characters), with the same shortened final
   * group (4/3/2/1 leftover bytes -> 7/5/4/2 characters, no padding). */
  private encodeBase32(bytes: Uint8Array): string {
    let result = ''
    for (let i = 0; i < bytes.length; i += 5) {
      const b0 = bytes[i] ?? 0
      const b1 = bytes[i + 1] ?? 0
      const b2 = bytes[i + 2] ?? 0
      const b3 = bytes[i + 3] ?? 0
      const b4 = bytes[i + 4] ?? 0
      const remaining = bytes.length - i

      const c = [
        b0 >> 3,
        ((b0 & 7) << 2) | (b1 >> 6),
        (b1 >> 1) & 0x1f,
        ((b1 & 1) << 4) | (b2 >> 4),
        ((b2 & 0xf) << 1) | (b3 >> 7),
        (b3 >> 2) & 0x1f,
        ((b3 & 3) << 3) | (b4 >> 5),
        b4 & 0x1f,
      ]

      const charCount = remaining >= 5 ? 8 : [0, 2, 4, 5, 7][remaining]
      for (let k = 0; k < charCount; k++) {
        result += BASE32_ALPHABET[c[k]]
      }
    }
    return result
  }

  private decodeBase32(text: string): Uint8Array<ArrayBuffer> {
    const reverse = new Uint8Array(256)
    for (let i = 0; i < BASE32_ALPHABET.length; i++) {
      reverse[BASE32_ALPHABET.charCodeAt(i)] = i
    }

    const byteLength = Math.floor(text.length * 0.625)
    const bytes = new Uint8Array(byteLength)
    let p = 0
    for (let i = 0; i < text.length; i += 8) {
      const c: number[] = []
      for (let k = 0; k < 8; k++) {
        c.push(reverse[text.charCodeAt(i + k)] ?? 0)
      }
      bytes[p++] = (c[0] << 3) | (c[1] >> 2)
      bytes[p++] = ((c[1] & 3) << 6) | (c[2] << 1) | (c[3] >> 4)
      bytes[p++] = ((c[3] & 15) << 4) | (c[4] >> 1)
      bytes[p++] = ((c[4] & 1) << 7) | (c[5] << 2) | (c[6] >> 3)
      bytes[p++] = ((c[6] & 7) << 5) | c[7]
    }
    return bytes
  }

  private async inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
    const buffer = await new Response(stream).arrayBuffer()
    return new TextDecoder().decode(buffer)
  }
}
