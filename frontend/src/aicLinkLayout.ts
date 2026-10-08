/**
 * Where each AIC chain link is drawn on the grid overlay (the 900x900 space
 * of App's `aic-links` SVG, 100 per cell): a straight line when that reads
 * cleanly, otherwise a curve bent just enough, on whichever side, to keep
 * the chain readable as a whole. Pure geometry - App supplies the points.
 *
 * Every link used to be the same fixed-height curve, bowed to the same side
 * relative to its direction - so a link along a row with chain candidates in
 * between ran straight through them, and two links between the same cells
 * often lay on top of each other. The rules now, much as HoDoKu draws its
 * chains:
 *
 * - Straight, unless the straight line would pass over a "hard" obstacle (a
 *   candidate of the chain itself or one the chain eliminates - the ones the
 *   user must be able to read) or run along a link already placed.
 * - Otherwise each candidate curve - both sides, several heights - is ranked,
 *   most important first: never over a hard obstacle, staying on the board,
 *   then the gentlest bend (by request, this outranks everything below it),
 *   then fewest crossings of / runs along links already placed, then fewest
 *   other candidates covered (any candidate outside the link's own end
 *   cells; by request, only this low - a tie-break between curves, never a
 *   reason to bend more or to curve a line that could be straight), then
 *   leaning away from the chain's middle, so a loop-shaped chain bulges
 *   outward instead of folding in on itself.
 * - Straight links are placed first (they can't move), then the curved ones
 *   in chain order, each avoiding everything placed before it.
 * - Each line stops at the edge of its candidate instead of its centre, so
 *   the digits at both ends stay readable; a link into a grouped node
 *   (Empty Rectangle, W-Wing) still meets the group's middle.
 *
 * Colours, widths and the solid/dotted pattern are App.css's and untouched.
 */

import type { AicLinkKind, AicLinkRef } from './sudoku/SudokuShortAicFinder'
import type { Board, CandidateGrid } from './sudoku/types'

export interface Point {
  x: number
  y: number
}

const CELL_SIZE = 100

/** How far a Killer grid keeps its pencil marks from the cell's edges, in
 * drawing units out of 100: a band at the top for the cage sums, and a
 * margin on the other three sides so no pip sits on a cage's dashed outline.
 * App.css says the same thing to the cells themselves (.grid-killer
 * .candidates) - change the two together. */
export const KILLER_PIP_INSETS = { top: 22, side: 8, bottom: 8 } as const
const NO_PIP_INSETS = { top: 0, side: 0, bottom: 0 } as const

let pipInsets: { top: number; side: number; bottom: number } = NO_PIP_INSETS

/** Whether the grid shows cages. App sets it (during render, from the puzzle
 * on the grid) before anything that draws on the pips. */
export function setKillerPipLayout(killer: boolean): void {
  pipInsets = killer ? KILLER_PIP_INSETS : NO_PIP_INSETS
}

/** A candidate's pip centre in drawing units (a 900x900 board, 100 per
 * cell): the 3x3 pip layout of a cell, squeezed below the cage-sum band on a
 * Killer grid. Shared by every overlay drawn on the pips (strong links, AIC
 * chains). */
export function pipCenter(row: number, col: number, digit: number): Point {
  return {
    x: col * CELL_SIZE + pipInsets.side + (((digit - 1) % 3) + 0.5) * ((CELL_SIZE - 2 * pipInsets.side) / 3),
    y: row * CELL_SIZE + pipInsets.top + (Math.floor((digit - 1) / 3) + 0.5) * ((CELL_SIZE - pipInsets.top - pipInsets.bottom) / 3),
  }
}

export interface AicOverlay {
  /** Grouped nodes to outline, keyed for React. */
  groups: Array<[string, { digit: number; cells: ReadonlyArray<readonly [number, number]> }]>
  /** One path per link, in the links' order. */
  paths: Array<{ kind: AicLinkKind; d: string }>
}

/**
 * The whole AIC overlay for a set of chain links (one chain, or several in a
 * Dynamic Dragon step): grouped nodes to outline and each link's path. The
 * obstacles lines keep clear of are the chain's own candidates and
 * `eliminations`; the board's other candidates only break ties between
 * curves.
 */
export function layoutAicOverlay(
  links: readonly AicLinkRef[],
  eliminations: ReadonlyArray<{ row: number; col: number; digit: number }>,
  board: Board,
  candidates: CandidateGrid,
): AicOverlay {
  // A grouped end (Empty Rectangle, W-Wing: "the digit is in one of these
  // cells") is outlined, and its links meet the group's middle.
  const end = (ref: { row: number; col: number; digit: number }, cells?: ReadonlyArray<readonly [number, number]>): LinkEnd => {
    if (!cells) {
      return pipCenter(ref.row, ref.col, ref.digit)
    }
    const points = cells.map(([r, c]) => pipCenter(r, c, ref.digit))
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
      group: true,
    }
  }
  const groups = new Map<string, { digit: number; cells: ReadonlyArray<readonly [number, number]> }>()
  const chainPoints: Point[] = []
  const toLayout = links.map((link) => {
    const excluded: Point[] = []
    for (const [ref, cells] of [
      [link.from, link.fromCells],
      [link.to, link.toCells],
    ] as const) {
      if (cells) {
        groups.set(`${ref.digit}:${cells.map(([r, c]) => `${r}.${c}`).join('|')}`, { digit: ref.digit, cells })
        excluded.push(...cells.map(([r, c]) => pipCenter(r, c, ref.digit)))
      } else {
        excluded.push(pipCenter(ref.row, ref.col, ref.digit))
      }
    }
    chainPoints.push(...excluded)
    let from = end(link.from, link.fromCells)
    let to = end(link.to, link.toCells)
    // A group whose cells aren't side by side (an ALS-AIC's ALS node) is
    // outlined cell by cell, so its middle can be an empty cell between
    // them: the link meets the group's cell nearest the other end instead,
    // trimmed like a single candidate.
    const nearest = (ref: { digit: number }, cells: ReadonlyArray<readonly [number, number]>, towards: Point): LinkEnd => {
      const points = cells.map(([r, c]) => pipCenter(r, c, ref.digit))
      return points.reduce((best, p) => (Math.hypot(p.x - towards.x, p.y - towards.y) < Math.hypot(best.x - towards.x, best.y - towards.y) ? p : best))
    }
    if (link.fromCells && !isContiguousGroup(link.fromCells)) {
      from = nearest(link.from, link.fromCells, to)
    }
    if (link.toCells && !isContiguousGroup(link.toCells)) {
      to = nearest(link.to, link.toCells, from)
    }
    return { from, to, excluded }
  })
  const hard = [...chainPoints, ...eliminations.map((e) => pipCenter(e.row, e.col, e.digit))]
  const others: Point[] = []
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 0) {
        for (let d = 1; d <= 9; d++) {
          if (candidates[r][c][d - 1]) {
            others.push(pipCenter(r, c, d))
          }
        }
      }
    }
  }
  const laidOut = layoutAicLinks(toLayout, hard, others)
  return {
    groups: [...groups.entries()],
    paths: links.map((link, index) => ({ kind: link.kind, d: laidOut[index].d })),
  }
}

/** Whether a grouped node's cells sit side by side in one row or column -
 * outlined as one group, its links meeting its middle - or not (an ALS-AIC's
 * ALS spread over a line or across a box's lines, a UR-AIC's corners apart),
 * outlined cell by cell. */
export function isContiguousGroup(cells: ReadonlyArray<readonly [number, number]>): boolean {
  const sorted = [...cells].sort((p, q) => p[0] - q[0] || p[1] - q[1])
  return sorted.every(
    ([r, c], i) =>
      i === 0 || (r === sorted[i - 1][0] && c === sorted[i - 1][1] + 1) || (c === sorted[i - 1][1] && r === sorted[i - 1][0] + 1),
  )
}

export interface LinkEnd extends Point {
  /** A grouped node's centre - not trimmed, and its cells are `excluded`. */
  group?: boolean
}

export interface LinkToLayout {
  from: LinkEnd
  to: LinkEnd
  /** Pip centres belonging to this link's own ends (a group's every cell),
   * which never count as obstacles for it. */
  excluded: readonly Point[]
}

export interface LaidOutLink {
  /** An SVG path: `M ... L ...` or `M ... Q ...`. */
  d: string
}

/** Board edge in drawing units. */
const BOARD = 900
/** A pip is PIP_SIZE (33.3) across; a line closer than this to a hard
 * obstacle's centre covers its digit. */
const HARD_CLEARANCE = 15
/** How far short of a pip centre a line stops (a pip's radius, less a bit so
 * short same-cell links stay visible). */
const END_TRIM = 13
/** Two paths closer than this are "running along" each other. */
const OVERLAP_DISTANCE = 7
const SAMPLES = 24
/** Curve heights tried, as a fraction of the link's length, per side. */
const HEIGHT_FRACTIONS = [0.12, 0.2, 0.3, 0.42]
const MIN_HEIGHT = 10
/** How far a curve's apex may stand off the straight line between its ends:
 * never more than 2/3 of a cell, by request. A long link's taller options
 * all clamp to this. */
const MAX_HEIGHT = (2 / 3) * CELL_SIZE

/** Weights for a curve's score, each tier dwarfing everything below it:
 * hard obstacles, then leaving the board, then the bend (the index into
 * HEIGHT_FRACTIONS), then crossings and overlaps, then other candidates
 * covered, then the inward lean. Each tier's total is capped below one unit
 * of the tier above. */
const COST = {
  hard: 1e12,
  offBoard: 1e10,
  bendStep: 1e8,
  crossing: 20_000,
  overlap: 8000,
  linksCap: 1e8 - 1,
  otherCandidate: 2,
  othersCap: 999,
  inward: 1,
}

function quadPoint(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y }
}

function samplePath(p0: Point, c: Point | null, p1: Point): Point[] {
  const points: Point[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    points.push(c ? quadPoint(p0, c, p1, t) : { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t })
  }
  return points
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function distanceToPolyline(p: Point, line: readonly Point[]): number {
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    best = Math.min(best, distanceToSegment(p, line[i], line[i + 1]))
  }
  return best
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}

function near(a: Point, b: Point, distance: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < distance
}

interface Placed {
  samples: Point[]
  ends: readonly Point[]
}

/** The "interior" samples of a path - away from both ends, where it meets
 * its own candidates (and, often, the links sharing them). */
function interior(samples: readonly Point[], ends: readonly Point[], margin: number): Point[] {
  return samples.filter((p) => ends.every((end) => !near(p, end, margin)))
}

/**
 * Lays out every link. `hardObstacles`: candidates the lines must not cover
 * (the chain's own, and what it eliminates).
 */
export function layoutAicLinks(
  links: readonly LinkToLayout[],
  hardObstacles: readonly Point[],
  otherCandidates: readonly Point[] = [],
): LaidOutLink[] {
  const centre =
    links.length > 0
      ? {
          x: links.reduce((sum, l) => sum + l.from.x + l.to.x, 0) / (2 * links.length),
          y: links.reduce((sum, l) => sum + l.from.y + l.to.y, 0) / (2 * links.length),
        }
      : { x: BOARD / 2, y: BOARD / 2 }

  const isOwn = (link: LinkToLayout, p: Point) =>
    near(p, link.from, 1) || near(p, link.to, 1) || link.excluded.some((own) => near(p, own, 1))

  // The cell a pip centre lies in, and the cells a link's own ends occupy -
  // their candidates are never "other" candidates for it.
  const cellOf = (p: Point) => Math.floor(p.y / CELL_SIZE) * 9 + Math.floor(p.x / CELL_SIZE)
  const ownCells = links.map((link) => new Set(link.excluded.map(cellOf)))
  const otherHits = (index: number, samples: readonly Point[]) => {
    let count = 0
    for (const candidate of otherCandidates) {
      if (!ownCells[index].has(cellOf(candidate)) && distanceToPolyline(candidate, samples) < HARD_CLEARANCE) {
        count++
      }
    }
    return count
  }

  const hits = (link: LinkToLayout, samples: readonly Point[], obstacles: readonly Point[], clearance: number) => {
    let count = 0
    for (const obstacle of obstacles) {
      if (isOwn(link, obstacle)) {
        continue
      }
      if (distanceToPolyline(obstacle, samples) < clearance) {
        count++
      }
    }
    return count
  }

  const placed: Placed[] = []
  const ends = (link: LinkToLayout) => [link.from, link.to]

  const overlapCount = (link: LinkToLayout, samples: readonly Point[]) => {
    let count = 0
    for (const other of placed) {
      // Near a shared end two links naturally meet; only the stretch away
      // from every end counts.
      for (const p of interior(samples, [...ends(link), ...other.ends], 20)) {
        if (distanceToPolyline(p, other.samples) < OVERLAP_DISTANCE) {
          count++
        }
      }
    }
    return count
  }

  const crossingCount = (link: LinkToLayout, samples: readonly Point[]) => {
    let count = 0
    for (const other of placed) {
      const allEnds = [...ends(link), ...other.ends]
      for (let i = 0; i < samples.length - 1; i++) {
        if (allEnds.some((end) => near(samples[i], end, 14) || near(samples[i + 1], end, 14))) {
          continue
        }
        for (let j = 0; j < other.samples.length - 1; j++) {
          if (segmentsCross(samples[i], samples[i + 1], other.samples[j], other.samples[j + 1])) {
            count++
          }
        }
      }
    }
    return count
  }

  // Pass 1: straight wherever it reads cleanly - except a link between two
  // candidates of one cell (a bivalue strong link, or a weak one), which is
  // always curved, by request.
  const control: Array<Point | null | undefined> = links.map(() => undefined)
  links.forEach((link, index) => {
    if (!link.from.group && !link.to.group && cellOf(link.from) === cellOf(link.to)) {
      return
    }
    const samples = samplePath(link.from, null, link.to)
    if (hits(link, samples, hardObstacles, HARD_CLEARANCE) === 0 && overlapCount(link, samples) === 0) {
      control[index] = null
      placed.push({ samples, ends: ends(link) })
    }
  })

  // Pass 2: the rest, each as the cheapest curve given everything so far.
  links.forEach((link, index) => {
    if (control[index] !== undefined) {
      return
    }
    const dx = link.to.x - link.from.x
    const dy = link.to.y - link.from.y
    const length = Math.hypot(dx, dy) || 1
    const normal = { x: -dy / length, y: dx / length }
    const mid = { x: (link.from.x + link.to.x) / 2, y: (link.from.y + link.to.y) / 2 }
    const outward = (normal.x * (mid.x - centre.x) + normal.y * (mid.y - centre.y)) >= 0 ? 1 : -1

    let best: { cost: number; c: Point; samples: Point[] } | null = null
    for (const side of [outward, -outward]) {
      for (const [bendStep, fraction] of HEIGHT_FRACTIONS.entries()) {
        const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, length * fraction))
        // A quadratic's peak is half its control point's offset.
        const c = { x: mid.x + normal.x * side * height * 2, y: mid.y + normal.y * side * height * 2 }
        const samples = samplePath(link.from, c, link.to)
        const offBoard = samples.filter((p) => p.x < 4 || p.y < 4 || p.x > BOARD - 4 || p.y > BOARD - 4).length
        const cost =
          COST.hard * hits(link, samples, hardObstacles, HARD_CLEARANCE) +
          COST.offBoard * offBoard +
          COST.bendStep * bendStep +
          Math.min(COST.linksCap, COST.crossing * crossingCount(link, samples) + COST.overlap * overlapCount(link, samples)) +
          Math.min(COST.othersCap, COST.otherCandidate * otherHits(index, samples)) +
          (side === outward ? 0 : COST.inward)
        if (!best || cost < best.cost) {
          best = { cost, c, samples }
        }
      }
    }
    control[index] = best!.c
    placed.push({ samples: best!.samples, ends: ends(link) })
  })

  return links.map((link, index) => {
    const c = control[index] ?? null
    const trim = (end: LinkEnd, towards: Point) => {
      if (end.group) {
        return end
      }
      const dx = towards.x - end.x
      const dy = towards.y - end.y
      const distance = Math.hypot(dx, dy) || 1
      const amount = Math.min(END_TRIM, distance * 0.3)
      return { x: end.x + (dx / distance) * amount, y: end.y + (dy / distance) * amount }
    }
    // Trimmed along the path's own direction at each end: towards the other
    // end for a line, towards the control point for a curve (its tangent).
    const start = trim(link.from, c ?? link.to)
    const end = trim(link.to, c ?? link.from)
    const f = (n: number) => Math.round(n * 10) / 10
    return {
      d: c
        ? `M ${f(start.x)} ${f(start.y)} Q ${f(c.x)} ${f(c.y)} ${f(end.x)} ${f(end.y)}`
        : `M ${f(start.x)} ${f(start.y)} L ${f(end.x)} ${f(end.y)}`,
    }
  })
}
