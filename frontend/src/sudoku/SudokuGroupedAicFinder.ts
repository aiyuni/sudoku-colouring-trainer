import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import { GENERIC_AIC_MAX_LENGTH } from './SudokuGenericAicFinder'
import {
  aicNodeCells,
  buildLinkGraphs,
  candidateKey,
  pickBestPerEliminationSet,
  type AicCandidate,
  type AicLink,
  type LinkGraphs,
  type ShortAicInstance,
} from './SudokuShortAicFinder'
import { sudokuUnits } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

type Cell = readonly [number, number]

/** The longest Grouped AIC looked for, in links - the same limit as Generic
 * AIC (change it there). The search is breadth-first like Generic AIC's, so
 * the limit barely affects speed. */
export const GROUPED_AIC_MAX_LENGTH = GENERIC_AIC_MAX_LENGTH

function cellRef([row, col]: Cell): string {
  return `r${row + 1}c${col + 1}`
}

function boxOf([row, col]: Cell): number {
  return Math.floor(row / BOX_SIZE) * BOX_SIZE + Math.floor(col / BOX_SIZE)
}

function sees(a: Cell, b: Cell): boolean {
  if (a[0] === b[0] && a[1] === b[1]) {
    return false
  }
  return a[0] === b[0] || a[1] === b[1] || boxOf(a) === boxOf(b)
}

/**
 * Grouped AIC: a Generic AIC (any odd length up to GROUPED_AIC_MAX_LENGTH)
 * whose nodes may be groups - a digit's 2-3 candidates in one box and one row
 * (or column), read as "the digit is in one of these cells". The grouped
 * links are the ones SudokuAlsAicFinder's graph already has (kept in step
 * with it by hand - that finder mixes them with its ALS links):
 *
 * - strong: a row, column or box whose candidates of a digit fall into
 *   exactly two box/line parts (a part may be a single cell) - one of the two
 *   parts holds the digit;
 * - weak: a group and any candidate or group of the same digit seeing every
 *   cell of it - they can't both be true.
 *
 * Only a chain with at least one group node is reported, and only when no
 * plain chain of single candidates joins the same two ends within the length
 * limit: that one makes the very same eliminations and is a Generic (or
 * Short) AIC, the easier technique. (Decided from the search's own reach, so
 * in the rare case the only plain chain revisits a candidate - which Generic
 * AIC doesn't report - the grouped one is left out too; a miss, never an
 * unsound elimination.)
 *
 * Eliminations: anything weakly linked to both ends, as for any AIC - a
 * candidate seeing every cell of a grouped end.
 *
 * Search: Generic AIC's breadth-first search over (node, passed a group yet)
 * states, so each start/end pair is found by its shortest grouped chain.
 * Open chains only, like every AIC here.
 */
export class SudokuGroupedAicFinder {
  find(board: Board, candidates: CandidateGrid, graphs?: LinkGraphs, maxLength: number = GROUPED_AIC_MAX_LENGTH): ShortAicInstance[] {
    const limit = maxLength % 2 === 0 ? maxLength - 1 : maxLength
    const base = graphs ?? buildLinkGraphs(board, candidates)

    const nodes: AicCandidate[] = []
    const idOf = new Map<string, number>()
    const strong: number[][] = []
    const weak: number[][] = []
    const weakSet: Array<Set<number>> = []
    const strongSet: Array<Set<number>> = []
    const register = (key: string, node: AicCandidate): number => {
      let id = idOf.get(key)
      if (id === undefined) {
        id = nodes.length
        idOf.set(key, id)
        nodes.push(node)
        strong.push([])
        weak.push([])
        weakSet.push(new Set())
        strongSet.push(new Set())
      }
      return id
    }
    const addWeak = (a: number, b: number) => {
      if (a === b || weakSet[a].has(b)) {
        return
      }
      weakSet[a].add(b)
      weakSet[b].add(a)
      weak[a].push(b)
      weak[b].push(a)
    }
    const addStrong = (a: number, b: number) => {
      if (a === b || strongSet[a].has(b)) {
        return
      }
      strongSet[a].add(b)
      strongSet[b].add(a)
      strong[a].push(b)
      strong[b].push(a)
    }

    for (const [key, node] of base.nodeByKey) {
      register(key, node)
    }
    for (const [key, neighbours] of base.strongAdjacency) {
      for (const other of neighbours) {
        addStrong(idOf.get(key)!, idOf.get(other)!)
      }
    }
    for (const [key, neighbours] of base.weakAdjacency) {
      for (const other of neighbours) {
        addWeak(idOf.get(key)!, idOf.get(other)!)
      }
    }

    const has = (row: number, col: number, digit: number) => board[row][col] === 0 && candidates[row][col][digit - 1]
    // `digit` in one of `cells` (row-major): a single candidate's node, or a
    // group's (whose weak links are added once every node exists).
    const groupIds: number[] = []
    const nodeFor = (digit: number, cells: readonly Cell[]): number => {
      if (cells.length === 1) {
        return register(candidateKey(cells[0][0], cells[0][1], digit), { row: cells[0][0], col: cells[0][1], digit })
      }
      const key = `g${digit}:${cells.map(cellRef).join('')}`
      const known = idOf.get(key)
      if (known !== undefined) {
        return known
      }
      const id = register(key, { row: cells[0][0], col: cells[0][1], digit, cells })
      groupIds.push(id)
      return id
    }

    // Grouped strong links: a unit whose candidates of a digit split into
    // exactly two box/line parts (two single cells are the conjugate pair
    // already linked above).
    const units = sudokuUnits()
    for (let digit = 1; digit <= BOARD_SIZE; digit++) {
      units.forEach((unit, u) => {
        const cells = unit.filter(([r, c]) => has(r, c, digit)).sort((p, q) => p[0] - q[0] || p[1] - q[1])
        if (cells.length < 3) {
          return
        }
        // Units are rows 0-8, columns 9-17, boxes 18-26 (SudokuUnits).
        const splits: Array<(cell: Cell) => number> = u < 18 ? [boxOf] : [([r]) => r, ([, c]) => c]
        for (const partOf of splits) {
          const parts = new Map<number, Cell[]>()
          for (const cell of cells) {
            parts.set(partOf(cell), [...(parts.get(partOf(cell)) ?? []), cell])
          }
          if (parts.size === 2) {
            const [p, q] = [...parts.values()]
            addStrong(nodeFor(digit, p), nodeFor(digit, q))
          }
        }
      })
    }
    if (groupIds.length === 0) {
      return []
    }

    // Groups' weak links: every other node of the digit seeing all of the
    // group (so disjoint from it - a cell never sees itself).
    const byDigit: number[][] = Array.from({ length: BOARD_SIZE + 1 }, () => [])
    nodes.forEach((node, id) => byDigit[node.digit].push(id))
    for (const g of groupIds) {
      const gCells = nodes[g].cells!
      for (const other of byDigit[nodes[g].digit]) {
        if (other !== g && aicNodeCells(nodes[other]).every((cell) => gCells.every((gc) => sees(cell, gc)))) {
          addWeak(g, other)
        }
      }
    }

    return this.search(nodes, strong, weak, weakSet, limit)
  }

  private search(
    nodes: readonly AicCandidate[],
    strong: readonly number[][],
    weak: readonly number[][],
    weakSet: ReadonlyArray<Set<number>>,
    limit: number,
  ): ShortAicInstance[] {
    const n = nodes.length
    const groupBit = nodes.map((node) => (node.cells ? 1 : 0))
    // States: node * 2 + (1 once the chain has a group node).
    const seenStrong = new Int32Array(2 * n)
    const seenWeak = new Int32Array(2 * n)
    const fromStrong = new Int32Array(2 * n)
    const fromWeak = new Int32Array(2 * n)
    let stamp = 0
    const reported = new Set<number>()
    const instances: ShortAicInstance[] = []

    const consider = (startState: number, end: number, length: number) => {
      const start = startState >> 1
      const y = end >> 1
      // A plain chain reaches the same end: a Generic AIC's eliminations.
      if (y === start || seenStrong[y * 2] === stamp) {
        return
      }
      const pairKey = start < y ? start * n + y : y * n + start
      if (reported.has(pairKey)) {
        return
      }
      const eliminations: CandidateElimination[] = []
      const [small, large] = weak[start].length <= weak[y].length ? [start, y] : [y, start]
      for (const z of weak[small]) {
        if (!nodes[z].cells && weakSet[large].has(z)) {
          eliminations.push({ row: nodes[z].row, col: nodes[z].col, digit: nodes[z].digit })
        }
      }
      if (eliminations.length === 0) {
        return
      }

      // Walk back: end <- weak-reached <- strong-reached <- ... <- start.
      const states: number[] = [end]
      for (let at = end; states.length <= length; ) {
        at = states.length % 2 === 1 ? fromStrong[at] : fromWeak[at]
        states.push(at)
      }
      states.reverse()
      const path = states.map((s) => s >> 1)
      if (new Set(path).size !== path.length) {
        return
      }
      reported.add(pairKey)
      eliminations.sort((p, q) => p.row - q.row || p.col - q.col || p.digit - q.digit)

      const chain = path.map((id) => nodes[id])
      const links: AicLink[] = chain.slice(1).map((to, i) => ({ from: chain[i], to, kind: i % 2 === 0 ? 'strong' : 'weak' }))
      const x = chain[0]
      const last = chain[chain.length - 1]
      instances.push({
        nodes: chain,
        links,
        length,
        isSingleDigit: chain.every((node) => node.digit === x.digit),
        eliminationType: x.digit === last.digit ? 1 : 2,
        eliminations,
      })
    }

    for (let start = 0; start < n; start++) {
      if (strong[start].length === 0) {
        continue
      }
      stamp++
      const startState = start * 2 + groupBit[start]
      seenStrong[startState] = stamp
      seenWeak[startState] = stamp
      // Grouped ends reached, checked once the whole search from `start` is
      // done - only then is it known whether a plain chain reaches them too.
      const ends: Array<{ state: number; length: number }> = []
      let frontier: number[] = []
      for (const to of strong[start]) {
        const state = to * 2 + (groupBit[start] | groupBit[to])
        if (seenStrong[state] !== stamp) {
          seenStrong[state] = stamp
          fromStrong[state] = startState
          frontier.push(state)
          if (state & 1) {
            ends.push({ state, length: 1 })
          }
        }
      }
      for (let length = 1; length < limit && frontier.length > 0; length += 2) {
        const reachedWeak: number[] = []
        for (const state of frontier) {
          for (const to of weak[state >> 1]) {
            const next = to * 2 + ((state & 1) | groupBit[to])
            if (seenWeak[next] !== stamp) {
              seenWeak[next] = stamp
              fromWeak[next] = state
              reachedWeak.push(next)
            }
          }
        }
        const nextFrontier: number[] = []
        for (const state of reachedWeak) {
          for (const to of strong[state >> 1]) {
            const next = to * 2 + ((state & 1) | groupBit[to])
            if (seenStrong[next] === stamp) {
              continue
            }
            seenStrong[next] = stamp
            fromStrong[next] = state
            nextFrontier.push(next)
            if (next & 1) {
              ends.push({ state: next, length: length + 2 })
            }
          }
        }
        frontier = nextFrontier
      }
      for (const end of ends) {
        consider(startState, end.state, end.length)
      }
    }

    // Shortest chain per elimination set, then shortest first (ties: most
    // eliminations), and - as in ALS-AIC - a chain is dropped when one kept,
    // at-most-as-long chain already makes all its eliminations. Only against
    // a single chain, never the union of several.
    const sorted = pickBestPerEliminationSet(instances).sort((p, q) => p.length - q.length || q.eliminations.length - p.eliminations.length)
    const kept: Array<{ instance: ShortAicInstance; keys: Set<string> }> = []
    for (const instance of sorted) {
      const keys = instance.eliminations.map((e) => candidateKey(e.row, e.col, e.digit))
      if (!kept.some((k) => keys.every((key) => k.keys.has(key)))) {
        kept.push({ instance, keys: new Set(keys) })
      }
    }
    return kept.map((k) => k.instance)
  }
}
