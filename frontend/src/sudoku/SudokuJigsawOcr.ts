import { findGridBounds, readableImage, type GridImage } from './SudokuGridOcr'

/**
 * Reads a Jigsaw's regions out of a screenshot (Variant page only - the
 * Classic reader, ocrGrid, never looks at this): the digits are read exactly
 * as on a Classic grid, and the regions come from the one thing every Jigsaw
 * drawing has in common - the border between two regions is drawn heavier
 * than the line between two cells of one region. Colour is not used: region
 * tints differ from site to site and many (SudokuWiki, Sudoku.Coach) have
 * none.
 *
 * So each of the 144 edges between neighbouring cells gets one number, how
 * much ink its line carries (`edgeWeight`), and the edges are split into
 * "thin" and "thick". Where to split is not guessed from the numbers alone:
 * a Jigsaw's borders must cut the grid into exactly nine regions of nine
 * cells, so every possible split point is tried, widest gap in the weights
 * first, and the first one whose thin edges join the cells up that way is
 * the answer. A screenshot with no such split (not a Jigsaw, a Killer, a
 * photo too blurred to tell the lines apart) returns null.
 */
export interface JigsawOcrResult {
  /** regions[row][col] = 0..8, numbered in reading order of their first
   * cell. Null when the lines don't describe nine regions of nine cells. */
  regions: number[][] | null
  /** True when the regions found are just the ordinary 3x3 boxes. */
  standard: boolean
}

const SIZE = 9

/** How much ink the line between two neighbouring cells carries: across the
 * line, the total darkness below the cells' own background, i.e. roughly
 * thickness x contrast. Measured on several cuts along the middle of the
 * edge (the ends are crossings, where a neighbouring thick border would
 * bleed in) and the lower-middle value kept, so a pencil mark or the tip of
 * an arrow sitting next to the line on one cut can't make a thin line look
 * thick. */
function edgeWeight(image: GridImage, along: 'x' | 'y', lineAt: number, from: number, length: number, reach: number): number {
  const gray = (across: number, position: number) =>
    along === 'x' ? image.getGray(Math.round(position), Math.round(across)) : image.getGray(Math.round(across), Math.round(position))
  const weights: number[] = []
  for (const fraction of [0.3, 0.38, 0.46, 0.54, 0.62, 0.7]) {
    const position = from + length * fraction
    // The cells' background on this cut: the lightest thing near the line.
    let background = 0
    for (let d = -reach; d <= reach; d++) {
      background = Math.max(background, gray(lineAt + d, position))
    }
    let ink = 0
    for (let d = -reach; d <= reach; d++) {
      ink += Math.max(0, background - gray(lineAt + d, position))
    }
    weights.push(ink)
  }
  weights.sort((a, b) => a - b)
  return weights[1]
}

/** The cells joined up across every edge lighter than `threshold`: region
 * numbers in reading order, or null unless that makes nine regions of nine. */
function regionsBelow(threshold: number, right: number[][], down: number[][]): number[][] | null {
  const regions = Array.from({ length: SIZE }, () => new Array<number>(SIZE).fill(-1))
  let count = 0
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (regions[row][col] >= 0) {
        continue
      }
      if (count === SIZE) {
        return null
      }
      let size = 0
      const queue: Array<[number, number]> = [[row, col]]
      regions[row][col] = count
      while (queue.length > 0) {
        const [r, c] = queue.pop()!
        size++
        const steps: Array<[number, number, number]> = []
        if (c < SIZE - 1) steps.push([r, c + 1, right[r][c]])
        if (c > 0) steps.push([r, c - 1, right[r][c - 1]])
        if (r < SIZE - 1) steps.push([r + 1, c, down[r][c]])
        if (r > 0) steps.push([r - 1, c, down[r - 1][c]])
        for (const [nr, nc, weight] of steps) {
          if (weight < threshold && regions[nr][nc] < 0) {
            regions[nr][nc] = count
            queue.push([nr, nc])
          }
        }
      }
      if (size !== SIZE) {
        return null
      }
      count++
    }
  }
  return count === SIZE ? regions : null
}

export function detectJigsawRegions(sourceImage: GridImage): JigsawOcrResult {
  const image = readableImage(sourceImage)
  const bounds = findGridBounds(image)
  const cellW = bounds.w / SIZE
  const cellH = bounds.h / SIZE
  // Far enough either side of a line to take in a heavy border even when
  // the grid lines sit a few pixels off the fitted lattice, never so far as
  // to reach a digit.
  const reachX = Math.max(2, Math.round(cellW * 0.16))
  const reachY = Math.max(2, Math.round(cellH * 0.16))

  // right[row][col]: the edge between (row, col) and (row, col + 1);
  // down[row][col]: between (row, col) and (row + 1, col).
  const right = Array.from({ length: SIZE }, (_, row) =>
    Array.from({ length: SIZE - 1 }, (_, col) => edgeWeight(image, 'y', bounds.x + (col + 1) * cellW, bounds.y + row * cellH, cellH, reachX)),
  )
  const down = Array.from({ length: SIZE - 1 }, (_, row) =>
    Array.from({ length: SIZE }, (_, col) => edgeWeight(image, 'x', bounds.y + (row + 1) * cellH, bounds.x + col * cellW, cellW, reachY)),
  )

  // Every place the sorted weights could be cut in two, widest gap first:
  // thin and thick lines differ by a clear step, and the nine-by-nine check
  // rules out a cut that only looks plausible.
  const weights = [...right.flat(), ...down.flat()].sort((a, b) => a - b)
  const cuts: Array<{ threshold: number; gap: number }> = []
  for (let i = 1; i < weights.length; i++) {
    if (weights[i] > weights[i - 1]) {
      cuts.push({ threshold: (weights[i] + weights[i - 1]) / 2, gap: weights[i] - weights[i - 1] })
    }
  }
  cuts.sort((a, b) => b.gap - a.gap)
  for (const { threshold } of cuts) {
    const regions = regionsBelow(threshold, right, down)
    if (regions) {
      const standard = regions.every((cells, row) => cells.every((region, col) => region === Math.floor(row / 3) * 3 + Math.floor(col / 3)))
      return { regions, standard }
    }
  }
  return { regions: null, standard: false }
}
