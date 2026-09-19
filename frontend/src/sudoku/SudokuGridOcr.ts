import { SudokuRules } from './SudokuRules'
import type { Board, CandidateGrid } from './types'

const BOARD_SIZE = 9

/**
 * A minimal abstraction over "some raster image" that both the browser
 * (Canvas) and a Node test harness (Jimp) can implement identically, so the
 * grid-reading algorithm below is exactly what ships, not a proxy for it.
 */
export interface GridImage {
  width: number
  height: number
  /** Luminance (0-255, 0=black) at (x, y), ignoring hue - colour is never
   * part of this app's reading of a screenshot, only how dark a pixel is
   * against its own cell's background. */
  getGray(x: number, y: number): number
  /** Crops [x, y, w, h) out of the image, scales it up by `scale`, and
   * returns a PNG data URL - the only representation handed to the digit
   * recognizer, so it never needs to know about GridImage itself. */
  toCroppedDataUrl(x: number, y: number, w: number, h: number, scale: number): Promise<string>
}

export type DigitRecognizer = (pngDataUrl: string) => Promise<number | null>

export interface OcrCellResult {
  row: number
  col: number
  digit: number | null
  /** True if a large single glyph was found but the recognizer couldn't
   * turn it into a confident 1-9 digit - surfaced so the UI can flag the
   * cell instead of silently leaving it blank. */
  unrecognizedSolvedDigit: boolean
}

export interface OcrResult {
  board: Board
  candidates: CandidateGrid
  /** Per-cell diagnostics, mainly for surfacing unrecognized solved digits. */
  cells: OcrCellResult[]
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Otsu's method: the grayscale threshold that best splits a histogram into
 * two classes (ink vs background), used per-cell since background shade
 * varies between screenshots (plain white, pale blue, etc). */
function otsuThreshold(histogram: number[]): number {
  const total = histogram.reduce((a, b) => a + b, 0)
  if (total === 0) {
    return 128
  }
  let sumAll = 0
  for (let i = 0; i < 256; i++) {
    sumAll += i * histogram[i]
  }

  let sumBackground = 0
  let weightBackground = 0
  let best = 0
  let bestVariance = -1

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t]
    if (weightBackground === 0) {
      continue
    }
    const weightForeground = total - weightBackground
    if (weightForeground === 0) {
      break
    }
    sumBackground += t * histogram[t]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sumAll - sumBackground) / weightForeground
    const betweenVariance =
      weightBackground * weightForeground * (meanBackground - meanForeground) * (meanBackground - meanForeground)
    if (betweenVariance > bestVariance) {
      bestVariance = betweenVariance
      best = t
    }
  }
  return best
}

function grayHistogram(image: GridImage, rect: Rect): number[] {
  const histogram = new Array<number>(256).fill(0)
  for (let y = Math.floor(rect.y); y < Math.floor(rect.y + rect.h); y++) {
    for (let x = Math.floor(rect.x); x < Math.floor(rect.x + rect.w); x++) {
      histogram[image.getGray(x, y)]++
    }
  }
  return histogram
}

/** Ink is darker than its own cell's background in every one of this app's
 * supported screenshot styles (plain white, pale blue, colour-highlighted
 * cells) - so "below the cell's own Otsu threshold" is a reliable,
 * colour-blind definition of "something is drawn here". */
function isInk(image: GridImage, x: number, y: number, threshold: number): boolean {
  return x >= 0 && y >= 0 && x < image.width && y < image.height && image.getGray(x, y) < threshold
}

/** Finds the tightest rectangle containing every ink pixel in `rect`, or
 * null if there is none - used both to find the whole grid inside a
 * screenshot that may carry a little padding, and to find a solved digit's
 * glyph inside its cell. */
function inkBoundingBox(image: GridImage, rect: Rect, threshold: number): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const x0 = Math.floor(rect.x)
  const y0 = Math.floor(rect.y)
  const x1 = Math.floor(rect.x + rect.w)
  const y1 = Math.floor(rect.y + rect.h)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (isInk(image, x, y, threshold)) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX) {
    return null
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Connected ink components within `rect`, each as a bounding box - two ink
 * pixels are linked if within `radius` of each other (not just touching),
 * so a font whose glyph has a small gap (an antialiased "4", a serif
 * break) still comes back as one component instead of several. Distinct
 * candidate pips, drawn with real whitespace between them, stay separate.
 * This is what actually tells a single solved digit apart from several
 * small candidates - a bounding box over *all* ink in a cell can't, since
 * candidates scattered across the cell's rows can union into something
 * just as tall as one big digit. */
function inkComponents(image: GridImage, rect: Rect, threshold: number, radius = 2): Rect[] {
  const x0 = Math.floor(rect.x)
  const y0 = Math.floor(rect.y)
  const w = Math.ceil(rect.w)
  const h = Math.ceil(rect.h)
  const ink = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isInk(image, x0 + x, y0 + y, threshold)) {
        ink[y * w + x] = 1
      }
    }
  }

  const visited = new Uint8Array(w * h)
  const components: Rect[] = []
  const stack: number[] = []

  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || visited[start]) {
      continue
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    stack.push(start)
    visited[start] = 1
    while (stack.length > 0) {
      const idx = stack.pop()!
      const px = idx % w
      const py = (idx - px) / w
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = py + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = px + dx
          if (nx < 0 || nx >= w) continue
          const nIdx = ny * w + nx
          if (ink[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1
            stack.push(nIdx)
          }
        }
      }
    }
    components.push({ x: x0 + minX, y: y0 + minY, w: maxX - minX + 1, h: maxY - minY + 1 })
  }
  return components
}

/** Trims any uniform padding around the actual 9x9 grid by projecting ink
 * onto each axis and keeping the span between the first and last row/column
 * that has any - a screenshot that's already tightly cropped just gets its
 * own full bounds back. */
function findGridBounds(image: GridImage): Rect {
  const whole: Rect = { x: 0, y: 0, w: image.width, h: image.height }
  const threshold = otsuThreshold(grayHistogram(image, whole))
  const box = inkBoundingBox(image, whole, threshold)
  if (!box || box.w < image.width * 0.3 || box.h < image.height * 0.3) {
    return whole
  }
  return box
}

function digitPosition(digit: number): { row: number; col: number } {
  return { row: Math.floor((digit - 1) / 3), col: (digit - 1) % 3 }
}

/** Reads a 9x9 Sudoku grid (givens, solved cells, and pencil-mark
 * candidates) out of a screenshot. Assumes this app's own positional
 * candidate layout - a candidate digit's position within its cell's 3x3
 * sub-grid equals the digit itself - which is what every one of this
 * feature's target screenshot sources actually render. Colour (digit
 * colour, highlighted cell backgrounds, highlight boxes around a
 * candidate) and overlaid lines/arrows are ignored by construction: only
 * "is this pixel darker than its own cell's background" is ever asked. */
export async function ocrGrid(image: GridImage, recognizeDigit: DigitRecognizer): Promise<OcrResult> {
  const bounds = findGridBounds(image)
  const cellW = bounds.w / BOARD_SIZE
  const cellH = bounds.h / BOARD_SIZE
  // Shrink inward from each cell's outer edge so grid/box border lines
  // never get counted as ink.
  const marginX = cellW * 0.1
  const marginY = cellH * 0.1

  const board: Board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0))
  const candidates: CandidateGrid = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false)),
  )
  const cells: OcrCellResult[] = []

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const outer: Rect = {
        x: bounds.x + col * cellW,
        y: bounds.y + row * cellH,
        w: cellW,
        h: cellH,
      }
      const interior: Rect = {
        x: outer.x + marginX,
        y: outer.y + marginY,
        w: outer.w - 2 * marginX,
        h: outer.h - 2 * marginY,
      }
      const threshold = otsuThreshold(grayHistogram(image, interior))
      const allComponents = inkComponents(image, interior, threshold)
      // A cell on the grid's outer edge can have a hairline sliver of the
      // thick outer border leak into its interior as its own tiny
      // component - drop anything too thin to be a real glyph stroke
      // before judging solved-vs-candidates by component count.
      const components = allComponents.filter((c) => c.w > interior.w * 0.06 && c.h > interior.h * 0.06)

      if (components.length === 0) {
        cells.push({ row, col, digit: null, unrecognizedSolvedDigit: false })
        continue
      }

      // A single solved digit is one component roughly as tall as the
      // cell's interior; several candidates are always multiple smaller,
      // separated components (or one component too short to be a solved
      // digit) - never one component that happens to span the full
      // height, since candidate pips have real gaps between them and a
      // merge radius of only 2px.
      const largest = components.reduce((a, b) => (b.h > a.h ? b : a))
      const isSolvedDigit = components.length === 1 && largest.h > interior.h * 0.38

      if (isSolvedDigit) {
        // Tesseract needs real breathing room around an isolated glyph -
        // one that nearly touches the crop's edge reads far less reliably
        // than the same glyph with margin - but exactly how much margin
        // is best is font-sensitive (observed empirically to vary from
        // ~25% to ~90% of the glyph's own size for different fonts in
        // this feature's target screenshots), so several ratios are tried
        // in turn rather than betting on one.
        let digit: number | null = null
        for (const padRatio of [0.6, 0.25, 1.2]) {
          const padX = largest.w * padRatio
          const padY = largest.h * padRatio
          const cropX = Math.max(outer.x, largest.x - padX)
          const cropY = Math.max(outer.y, largest.y - padY)
          const cropW = Math.min(outer.x + outer.w, largest.x + largest.w + padX) - cropX
          const cropH = Math.min(outer.y + outer.h, largest.y + largest.h + padY) - cropY
          const scale = Math.max(1, Math.round(160 / cropH))
          const dataUrl = await image.toCroppedDataUrl(cropX, cropY, cropW, cropH, scale)
          digit = await recognizeDigit(dataUrl)
          if (digit && digit >= 1 && digit <= 9) {
            break
          }
          digit = null
        }
        if (digit) {
          board[row][col] = digit
          cells.push({ row, col, digit, unrecognizedSolvedDigit: false })
        } else {
          cells.push({ row, col, digit: null, unrecognizedSolvedDigit: true })
        }
        continue
      }

      // Candidates: this app's positional layout means each digit's own
      // fixed 3x3 sub-cell is checked for ink presence only - no character
      // recognition needed here at all. Each pip gets its own inward
      // margin first, since a neighbouring pip's glyph can antialias a
      // few stray pixels across the boundary between them otherwise.
      const pipW = interior.w / 3
      const pipH = interior.h / 3
      const pipMarginX = pipW * 0.15
      const pipMarginY = pipH * 0.15
      let anyCandidate = false
      for (let digit = 1; digit <= 9; digit++) {
        const { row: pr, col: pc } = digitPosition(digit)
        const pip: Rect = {
          x: interior.x + pc * pipW + pipMarginX,
          y: interior.y + pr * pipH + pipMarginY,
          w: pipW - 2 * pipMarginX,
          h: pipH - 2 * pipMarginY,
        }
        const pipInk = inkBoundingBox(image, pip, threshold)
        const pipInkArea = pipInk ? pipInk.w * pipInk.h : 0
        if (pipInkArea > pip.w * pip.h * 0.15) {
          candidates[row][col][digit - 1] = true
          anyCandidate = true
        }
      }
      cells.push({ row, col, digit: null, unrecognizedSolvedDigit: false })
      if (!anyCandidate) {
        // A stray ink speck too small to be a digit but big enough to
        // dodge the "no ink at all" branch - leave the cell empty.
      }
    }
  }

  // A candidate that shares a row, column, or box with an already-solved
  // copy of the same digit could never legitimately be drawn as a
  // pencil mark - no real Sudoku app renders that. Any such candidate the
  // pixel-level detection above turned up is provably noise (most often a
  // stray fragment of an overlaid arrow or highlight box in a technique
  // screenshot), never a real pencil mark misread as something else, so
  // it's safe to drop automatically rather than surface it as an error.
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] !== 0) {
        continue
      }
      for (let digit = 1; digit <= 9; digit++) {
        if (candidates[row][col][digit - 1] && !SudokuRules.isSafe(board, row, col, digit)) {
          candidates[row][col][digit - 1] = false
        }
      }
    }
  }

  return { board, candidates, cells }
}
