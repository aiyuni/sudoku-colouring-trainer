import { markedCandidateDigits } from './boardUtils'
import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import { GENERIC_AIC_MAX_LENGTH } from './SudokuGenericAicFinder'
import {
  aicNodeCells,
  aicNodeText,
  buildLinkGraphs,
  candidateKey,
  pickBestPerEliminationSet,
  type AicCandidate,
  type AicLink,
  type AicUrBasis,
  type LinkGraphs,
  type ShortAicInstance,
} from './SudokuShortAicFinder'
import { hasStrongLink, sameUnit } from './SudokuUniqueRectangleFinder'
import type { Board, CandidateGrid } from './types'

type Cell = readonly [number, number]

/** The longest UR-AIC looked for, in links - the same limit as Generic AIC
 * (change it there). The search is breadth-first like Generic AIC's, so the
 * limit barely affects speed. */
export const UR_AIC_MAX_LENGTH = GENERIC_AIC_MAX_LENGTH

/** One Unique Rectangle fact a UR-AIC rests on - see SudokuUrAicFinder. */
export interface UrAicRectangleUse {
  ur: AicUrBasis
  /** 'extras': the rectangle's extra candidates (everything besides its two
   * digits) are exactly the two nodes in `ends`, so one of them is true - a
   * strong link. 'deadly pair': the two candidates in `ends` can't both be
   * true, since together they force `forced` and so the deadly pattern - a
   * weak link. */
  kind: 'extras' | 'deadly pair'
  ends: readonly [AicCandidate, AicCandidate]
  /** 'deadly pair' only: the rectangle's other two cells' pattern digits,
   * which the pair forces. */
  forced?: readonly [AicCandidate, AicCandidate]
  /** True when the fact is one of the chain's own links; false when it only
   * shows that an eliminated candidate can't be true alongside a chain end. */
  inChain: boolean
}

/** A UR-AIC: an AIC whose own links or eliminations need at least one Unique
 * Rectangle (the links carrying it have `ur`). Same shape as any AIC, so the
 * panel, the grid overlay and Dynamic Dragon treat it like one. */
export interface UrAicInstance extends ShortAicInstance {
  rectangleUses: UrAicRectangleUse[]
}

/** "6r1c4 =UR= 2r4c8 - ...": an AIC written out, a UR link marked as one. */
export function urAicChainText(aic: ShortAicInstance): string {
  return aic.nodes
    .map((node, i) => {
      if (i === 0) {
        return aicNodeText(node)
      }
      const link = aic.links[i - 1]
      const symbol = link.kind === 'strong' ? '=' : '-'
      return ` ${link.ur ? `${symbol}UR${symbol}` : symbol} ${aicNodeText(node)}`
    })
    .join('')
}

function cellRef([row, col]: Cell): string {
  return `r${row + 1}c${col + 1}`
}

/** "UR {6,7} at r4c2, r4c8, r6c2, r6c8" */
export function urBasisText(ur: AicUrBasis): string {
  return `UR {${ur.digits[0]},${ur.digits[1]}} at ${ur.cells.map(cellRef).join(', ')}`
}

/** One rectangle fact in words, ready to follow "where" or start a clause. */
export function urAicRectangleUseText(use: UrAicRectangleUse): string {
  const [p, q] = use.ends.map(aicNodeText)
  if (use.kind === 'extras') {
    return `the only candidates of ${urBasisText(use.ur)} besides ${use.ur.digits[0]} and ${use.ur.digits[1]} are ${p} and ${q}, so one of them is true`
  }
  const [f, g] = use.forced!.map(aicNodeText)
  return `${p} and ${q} can't both be true: they would force ${f} and ${g}, the deadly pattern of ${urBasisText(use.ur)}`
}

function boxOf([row, col]: Cell): number {
  return Math.floor(row / BOX_SIZE) * BOX_SIZE + Math.floor(col / BOX_SIZE)
}

/** A link of the search graph; `ur` is the rectangle fact behind a UR link,
 * null for an ordinary one. */
interface Edge {
  to: number
  ur: Omit<UrAicRectangleUse, 'inChain'> | null
}

/**
 * UR-AIC (sudokuwiki.org/Using_Unique_Rectangles_as_Links_in_Chains): an
 * Alternating Inference Chain that may also link through a Unique Rectangle.
 * A UR's four cells (two rows, two columns, two boxes, all unsolved, all
 * holding digits a and b) can never all end up as only a and b - that is the
 * deadly pattern, a second solution - and every UR type is some way of using
 * that. Here it supplies two kinds of link:
 *
 * - Extras (strong) - SudokuWiki's link, the logic of Types 1, 2 and 5: if
 *   the rectangle's extra candidates (every candidate of its cells besides a
 *   and b) form exactly two chain nodes, one of them is true. A node may be a
 *   group: one extra digit in two corners sharing a row or column ("one of
 *   these cells is 9"). One extra digit in exactly two corners is also two
 *   single nodes. SudokuWiki's own examples are all this kind.
 *
 * - Deadly pair (weak) - the logic of Types 4 and 7a-7d. The deadly pattern
 *   comes in two orientations; each is four candidates (a, b, b, a around the
 *   rectangle) that can't all be true. One of them often forces another
 *   inside the rectangle: a corner holding only {a,b} is forced by either
 *   neighbouring corner's pattern digit, and a corner whose pattern digit d
 *   is strongly linked (a conjugate pair) to a neighbouring corner is forced
 *   by that neighbour's pattern digit or the opposite corner's (either rules
 *   d out of the neighbour). If two of the four candidates force the other
 *   two, they can't both be true - a weak link no row, column or box gives.
 *   (When one candidate forces all three others, it is false outright: that
 *   is Types 4 and 7a-7d themselves, which the UR finder already reports, so
 *   such a candidate gets no links here.)
 *
 *   Mostly a deadly pair ends a chain, as the reason for an elimination
 *   ("1r4c7 = ... = 6r8c4, so 6r4c4 goes: it sees 6r8c4, and with 1r4c7 it
 *   would force the deadly pattern" - the chain standing in for the
 *   conjugate pair Type 4/7 would need). Inside a chain it needs a strong
 *   link at both ends, and no ordinary one will do: every row, column and
 *   box through a corner holds another corner with the same digit, so a
 *   pattern candidate's only ordinary strong links are inside the rectangle
 *   (its bivalue cell, or a conjugate pair with a neighbouring corner) - and
 *   either one lets a single candidate force the whole pattern, the
 *   false-outright case above. What does work is another rectangle's extras
 *   link, the pattern candidate being that rectangle's extra:
 *   "1r9c4 =UR= 3r9c6 -UR- 7r9c9 =UR= 1r9c8" runs through three rectangles.
 *   Rare (a 2026-10-03 sweep of 21k solve states: 77 such links, against
 *   800 deadly-pair eliminations and 78k extras links), but sound.
 *
 * Weak links count for eliminations too: a candidate is eliminated when it
 * can't be true alongside either end of the chain (sharing a cell, sharing a
 * unit with the same digit, or a deadly pair). That covers Type 1 and Type 2
 * AIC eliminations, and a chain ending in one cell clears that cell's other
 * candidates (a discontinuous loop, as in SudokuWiki's first example).
 *
 * Every chain must use a UR, either as a link or for one of its eliminations
 * (then only those eliminations are kept). Search: Generic AIC's
 * breadth-first search over (candidate, used a UR yet) states, any odd
 * length from 1 to UR_AIC_MAX_LENGTH, so each start/end pair is found by its
 * shortest UR-using chain. Grouped nodes only link through their UR (and
 * weakly to the digit's candidates seeing the whole group) - the app has no
 * general grouped AIC.
 */
export class SudokuUrAicFinder {
  find(board: Board, candidates: CandidateGrid, graphs?: LinkGraphs, maxLength: number = UR_AIC_MAX_LENGTH): UrAicInstance[] {
    const limit = maxLength % 2 === 0 ? maxLength - 1 : maxLength
    const base = graphs ?? buildLinkGraphs(board, candidates)

    const keys: string[] = []
    const nodes: AicCandidate[] = []
    const idOf = new Map<string, number>()
    const strong: Edge[][] = []
    const weak: Edge[][] = []
    // Per node, every node it can't be true together with -> how (null =
    // an ordinary weak link, which wins over a UR one when both hold).
    const weakTo: Array<Map<number, Edge['ur']>> = []
    const strongTo: Array<Set<number>> = []
    const register = (key: string, node: AicCandidate): number => {
      let id = idOf.get(key)
      if (id === undefined) {
        id = keys.length
        idOf.set(key, id)
        keys.push(key)
        nodes.push(node)
        strong.push([])
        weak.push([])
        weakTo.push(new Map())
        strongTo.push(new Set())
      }
      return id
    }
    const single = (row: number, col: number, digit: number) => register(candidateKey(row, col, digit), { row, col, digit })
    const addWeak = (a: number, b: number, ur: Edge['ur']) => {
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        const known = weakTo[x].get(y)
        if (known === undefined) {
          weak[x].push({ to: y, ur })
          weakTo[x].set(y, ur)
        } else if (known !== null && ur === null) {
          weakTo[x].set(y, null)
          weak[x] = weak[x].map((edge) => (edge.to === y ? { to: y, ur: null } : edge))
        }
      }
    }
    const addStrong = (a: number, b: number, ur: Edge['ur']) => {
      if (strongTo[a].has(b)) {
        return
      }
      strongTo[a].add(b)
      strongTo[b].add(a)
      strong[a].push({ to: b, ur })
      strong[b].push({ to: a, ur })
    }

    for (const [key, node] of base.nodeByKey) {
      register(key, node)
    }
    for (const [key, neighbours] of base.strongAdjacency) {
      for (const other of neighbours) {
        addStrong(idOf.get(key)!, idOf.get(other)!, null)
      }
    }
    for (const [key, neighbours] of base.weakAdjacency) {
      for (const other of neighbours) {
        addWeak(idOf.get(key)!, idOf.get(other)!, null)
      }
    }

    const has = (row: number, col: number, digit: number) => board[row][col] === 0 && candidates[row][col][digit - 1]
    // A group: `digit` in one of two cells sharing a row or column (always
    // two UR corners). Weakly linked to every other candidate of the digit
    // that sees both cells.
    const group = (digit: number, cells: readonly [Cell, Cell]): number => {
      const sorted = [...cells].sort((p, q) => p[0] - q[0] || p[1] - q[1])
      const key = `g${digit}:${sorted.map(cellRef).join('')}`
      const known = idOf.get(key)
      if (known !== undefined) {
        return known
      }
      const id = register(key, { row: sorted[0][0], col: sorted[0][1], digit, cells: sorted })
      for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
          if (has(row, col, digit) && !sorted.some(([r, c]) => r === row && c === col) && sorted.every((cell) => sameUnit([row, col], cell))) {
            addWeak(id, single(row, col, digit), null)
          }
        }
      }
      return id
    }

    for (let r1 = 0; r1 < BOARD_SIZE - 1; r1++) {
      for (let r2 = r1 + 1; r2 < BOARD_SIZE; r2++) {
        for (let c1 = 0; c1 < BOARD_SIZE - 1; c1++) {
          for (let c2 = c1 + 1; c2 < BOARD_SIZE; c2++) {
            const cells: readonly [Cell, Cell, Cell, Cell] = [
              [r1, c1],
              [r1, c2],
              [r2, c1],
              [r2, c2],
            ]
            // Exactly two boxes, every corner unsolved.
            if (new Set(cells.map(boxOf)).size !== 2 || cells.some(([r, c]) => board[r][c] !== 0)) {
              continue
            }
            const digitsOf = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))
            for (let a = 1; a <= 9; a++) {
              for (let b = a + 1; b <= 9; b++) {
                if (digitsOf.every((digits) => digits.includes(a) && digits.includes(b))) {
                  const ur: AicUrBasis = { cells, digits: [a, b] }
                  this.addExtrasLink(ur, digitsOf, single, group, nodes, addStrong)
                  this.addDeadlyPairLinks(board, candidates, ur, digitsOf, single, nodes, addWeak)
                }
              }
            }
          }
        }
      }
    }

    return this.search(nodes, strong, weak, weakTo, limit)
  }

  /** The extras link: the rectangle's extra candidates as exactly two nodes. */
  private addExtrasLink(
    ur: AicUrBasis,
    digitsOf: readonly number[][],
    single: (row: number, col: number, digit: number) => number,
    group: (digit: number, cells: readonly [Cell, Cell]) => number,
    nodes: readonly AicCandidate[],
    addStrong: (a: number, b: number, ur: Edge['ur']) => void,
  ): void {
    const cellsByExtra = new Map<number, Cell[]>()
    ur.cells.forEach((cell, i) => {
      for (const d of digitsOf[i]) {
        if (d !== ur.digits[0] && d !== ur.digits[1]) {
          cellsByExtra.set(d, [...(cellsByExtra.get(d) ?? []), cell])
        }
      }
    })
    const extras = [...cellsByExtra]
    let ends: [number, number] | null = null
    if (extras.length === 2) {
      // Each digit must be one node: one corner, or two sharing a line.
      const asNode = ([digit, cells]: [number, Cell[]]) =>
        cells.length === 1 ? single(cells[0][0], cells[0][1], digit) : cells.length === 2 && sameUnit(cells[0], cells[1]) ? group(digit, [cells[0], cells[1]]) : null
      const p = asNode(extras[0])
      const q = asNode(extras[1])
      ends = p !== null && q !== null ? [p, q] : null
    } else if (extras.length === 1 && extras[0][1].length === 2) {
      const [digit, [x, y]] = extras[0]
      ends = [single(x[0], x[1], digit), single(y[0], y[1], digit)]
    }
    if (ends) {
      addStrong(ends[0], ends[1], { ur, kind: 'extras', ends: [nodes[ends[0]], nodes[ends[1]]] })
    }
  }

  /** The deadly-pair links - see the class comment. */
  private addDeadlyPairLinks(
    board: Board,
    candidates: CandidateGrid,
    ur: AicUrBasis,
    digitsOf: readonly number[][],
    single: (row: number, col: number, digit: number) => number,
    nodes: readonly AicCandidate[],
    addWeak: (a: number, b: number, ur: Edge['ur']) => void,
  ): void {
    const [a, b] = ur.digits
    const cells = ur.cells
    // Canonical order (r1c1, r1c2, r2c1, r2c2): each corner's row and
    // column neighbours, and its opposite corner.
    const neighbours = [
      [1, 2],
      [0, 3],
      [3, 0],
      [2, 1],
    ]
    const opposite = [3, 2, 1, 0]
    const bivalue = digitsOf.map((digits) => digits.length === 2)
    for (const pattern of [
      [a, b, b, a],
      [b, a, a, b],
    ]) {
      // forcedBy[i]: the corners whose pattern digit forces corner i's.
      const forcedBy: number[][] = [[], [], [], []]
      for (let i = 0; i < 4; i++) {
        for (const j of neighbours[i]) {
          if (bivalue[i]) {
            forcedBy[i].push(j)
          }
          if (hasStrongLink(board, candidates, cells[i], cells[j], pattern[i])) {
            forcedBy[i].push(j, opposite[i])
          }
        }
      }
      const closes = (start: readonly number[]) => {
        const known = new Set(start)
        for (let grew = true; grew; ) {
          grew = false
          for (let i = 0; i < 4; i++) {
            if (!known.has(i) && forcedBy[i].some((j) => known.has(j))) {
              known.add(i)
              grew = true
            }
          }
        }
        return known.size === 4
      }
      const falseAlone = [0, 1, 2, 3].map((i) => closes([i]))
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          if (falseAlone[i] || falseAlone[j] || !closes([i, j])) {
            continue
          }
          const [k, l] = [0, 1, 2, 3].filter((m) => m !== i && m !== j)
          const p = single(cells[i][0], cells[i][1], pattern[i])
          const q = single(cells[j][0], cells[j][1], pattern[j])
          addWeak(p, q, {
            ur,
            kind: 'deadly pair',
            ends: [nodes[p], nodes[q]],
            forced: [
              { row: cells[k][0], col: cells[k][1], digit: pattern[k] },
              { row: cells[l][0], col: cells[l][1], digit: pattern[l] },
            ],
          })
        }
      }
    }
  }

  private search(
    nodes: readonly AicCandidate[],
    strong: readonly Edge[][],
    weak: readonly Edge[][],
    weakTo: ReadonlyArray<Map<number, Edge['ur']>>,
    limit: number,
  ): UrAicInstance[] {
    const n = nodes.length
    // A plain chain only counts through an elimination a UR gives, so only
    // ends with a deadly-pair link can make one.
    const hasUrWeak = weakTo.map((map) => [...map.values()].some((ur) => ur !== null))
    // States: node * 2 + (1 once a UR link is used).
    const seenStrong = new Int32Array(2 * n)
    const seenWeak = new Int32Array(2 * n)
    const fromStrong = new Int32Array(2 * n)
    const fromWeak = new Int32Array(2 * n)
    const viaStrong: Array<Edge['ur']> = new Array(2 * n).fill(null)
    const viaWeak: Array<Edge['ur']> = new Array(2 * n).fill(null)
    let stamp = 0
    const reported = new Set<number>()
    const instances: UrAicInstance[] = []

    const consider = (start: number, end: number, length: number) => {
      const y = end >> 1
      const usedUr = (end & 1) === 1
      if (y === start || (!usedUr && !hasUrWeak[start] && !hasUrWeak[y])) {
        return
      }
      const pairKey = ((start < y ? start * n + y : y * n + start) << 1) | (end & 1)
      if (reported.has(pairKey)) {
        return
      }
      // Walk back: end <- weak-reached <- strong-reached <- ... <- start.
      const states: number[] = [end]
      const urs: Array<Edge['ur']> = []
      for (let at = end; at !== start * 2; ) {
        const viaStrongLink = states.length % 2 === 1
        urs.push(viaStrongLink ? viaStrong[at] : viaWeak[at])
        at = viaStrongLink ? fromStrong[at] : fromWeak[at]
        states.push(at)
      }
      states.reverse()
      urs.reverse()
      const path = states.map((s) => s >> 1)
      if (new Set(path).size !== path.length) {
        return
      }

      // Eliminate what can't be true alongside either end; a plain chain
      // keeps only what needs a deadly pair to say so.
      const eliminations: CandidateElimination[] = []
      const eliminationUses: UrAicRectangleUse[] = []
      for (const [z, urX] of weakTo[start]) {
        const urY = weakTo[y].get(z)
        if (urY === undefined || nodes[z].cells || (!usedUr && urX === null && urY === null)) {
          continue
        }
        const { row, col, digit } = nodes[z]
        eliminations.push({ row, col, digit })
        for (const ur of [urX, urY]) {
          if (ur) {
            eliminationUses.push({ ...ur, inChain: false })
          }
        }
      }
      if (eliminations.length === 0) {
        return
      }
      reported.add(pairKey)
      eliminations.sort((p, q) => p.row - q.row || p.col - q.col || p.digit - q.digit)

      const chain = path.map((id) => nodes[id])
      const links: AicLink[] = chain.slice(1).map((to, i) => ({
        from: chain[i],
        to,
        kind: i % 2 === 0 ? 'strong' : 'weak',
        ...(urs[i] ? { ur: urs[i]!.ur } : {}),
      }))
      const rectangleUses = [
        ...urs.flatMap((ur) => (ur ? [{ ...ur, inChain: true }] : [])),
        ...eliminationUses.filter(
          (use, i) => eliminationUses.findIndex((other) => other.ends.every((e, k) => aicNodeText(e) === aicNodeText(use.ends[k]))) === i,
        ),
      ]
      const x = chain[0]
      const last = chain[chain.length - 1]
      instances.push({
        nodes: chain,
        links,
        length,
        isSingleDigit: chain.every((node) => node.digit === x.digit),
        eliminationType: x.digit === last.digit ? 1 : 2,
        eliminations,
        rectangleUses,
      })
    }

    for (let start = 0; start < n; start++) {
      if (strong[start].length === 0) {
        continue
      }
      stamp++
      seenStrong[start * 2] = stamp
      seenWeak[start * 2] = stamp
      let frontier: number[] = []
      for (const { to, ur } of strong[start]) {
        const state = to * 2 + (ur ? 1 : 0)
        if (seenStrong[state] !== stamp) {
          seenStrong[state] = stamp
          fromStrong[state] = start * 2
          viaStrong[state] = ur
          frontier.push(state)
          consider(start, state, 1)
        }
      }
      for (let length = 1; length < limit && frontier.length > 0; length += 2) {
        const reachedWeak: number[] = []
        for (const state of frontier) {
          for (const { to, ur } of weak[state >> 1]) {
            const next = to * 2 + ((state & 1) | (ur ? 1 : 0))
            if (seenWeak[next] !== stamp) {
              seenWeak[next] = stamp
              fromWeak[next] = state
              viaWeak[next] = ur
              reachedWeak.push(next)
            }
          }
        }
        const nextFrontier: number[] = []
        for (const state of reachedWeak) {
          for (const { to, ur } of strong[state >> 1]) {
            const next = to * 2 + ((state & 1) | (ur ? 1 : 0))
            if (seenStrong[next] === stamp) {
              continue
            }
            seenStrong[next] = stamp
            fromStrong[next] = state
            viaStrong[next] = ur
            nextFrontier.push(next)
            consider(start, next, length + 2)
          }
        }
        frontier = nextFrontier
      }
    }

    // Shortest chain per elimination set (ties: more conjugate pairs), then
    // shortest first.
    return (pickBestPerEliminationSet(instances) as UrAicInstance[]).sort((p, q) => p.length - q.length)
  }
}

/** Every cell a UR-AIC's reasoning rests on: its nodes' cells and every
 * rectangle it uses. */
export function urAicBasisCells(aic: UrAicInstance): Cell[] {
  const seen = new Map<string, Cell>()
  for (const cell of [...aic.nodes.flatMap((node) => aicNodeCells(node)), ...aic.rectangleUses.flatMap((use) => use.ur.cells)]) {
    seen.set(cellRef(cell), cell)
  }
  return [...seen.values()]
}
