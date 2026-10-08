import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE } from './SudokuRules'
import { GENERIC_AIC_MAX_LENGTH } from './SudokuGenericAicFinder'
import {
  aicNodeCells,
  aicNodeText,
  buildLinkGraphs,
  candidateKey,
  pickBestPerEliminationSet,
  type AicAlsBasis,
  type AicCandidate,
  type AicLink,
  type LinkGraphs,
  type ShortAicInstance,
} from './SudokuShortAicFinder'
import { boxOf as boxOfCell, sudokuUnits, sharesHouseOrLink } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

type Cell = readonly [number, number]

/** The longest ALS-AIC looked for, in links - the same limit as Generic AIC
 * (change it there). The search is breadth-first like Generic AIC's, so the
 * limit barely affects speed. */
export const ALS_AIC_MAX_LENGTH = GENERIC_AIC_MAX_LENGTH

/** The biggest ALS used, in cells - the one number to change. SudokuWiki's
 * definition (and solver) uses 2-cell ALS only, "although bigger ALS groups
 * are possible"; bigger ones find more, but every extra cell multiplies the
 * ALS on a sparse grid and so the search graph. Measured 2026-10-03 over
 * 4.4k solve states of 60 top1465 puzzles (dragon-research/als-aic/sweep.ts):
 * up to 2 cells 2.9 ms per find (max 17), up to 3 cells 5.5 ms (max 33), up
 * to 4 cells 8.9 ms (max 51) - and inside Dynamic Dragon it can run once per
 * simulated grid. */
export const ALS_AIC_MAX_ALS_CELLS = 2

/** One Almost Locked Set fact an ALS-AIC rests on - see SudokuAlsAicFinder. */
export interface AlsAicAlsUse {
  als: AicAlsBasis
  /** 'link': one of the chain's own strong links, between `ends` - the ALS's
   * cells holding one of its digits and those holding another. 'closure':
   * each end of the chain rules digits out of the ALS (`ruledOut`, per end),
   * so `locked` - its other digits - are all in it. */
  kind: 'link' | 'closure'
  /** 'link' only. */
  ends?: readonly [AicCandidate, AicCandidate]
  /** 'closure' only: the digits the chain's first and last node rule out. */
  ruledOut?: readonly [readonly number[], readonly number[]]
  /** 'closure' only: the digits locked into the ALS. */
  locked?: readonly number[]
}

/** An ALS-AIC: an AIC whose own links or eliminations need at least one
 * Almost Locked Set (the links carrying it have `als`). Same shape as any
 * AIC, so the panel, the grid overlay and Dynamic Dragon treat it like one. */
export interface AlsAicInstance extends ShortAicInstance {
  alsUses: AlsAicAlsUse[]
}

function cellRef([row, col]: Cell): string {
  return `r${row + 1}c${col + 1}`
}

/** "9r8c6 =ALS= 7(r7c6, r8c6) - ...": an AIC written out, an ALS link
 * marked as one. */
export function alsAicChainText(aic: ShortAicInstance): string {
  return aic.nodes
    .map((node, i) => {
      if (i === 0) {
        return aicNodeText(node)
      }
      const link = aic.links[i - 1]
      const symbol = link.kind === 'strong' ? '=' : '-'
      return ` ${link.als ? `${symbol}ALS${symbol}` : symbol} ${aicNodeText(node)}`
    })
    .join('')
}

/** "ALS {5,7,9} in r7c6, r8c6" */
export function alsBasisText(als: AicAlsBasis): string {
  return `ALS {${als.digits.join(',')}} in ${als.cells.map(cellRef).join(', ')}`
}

function digitList(digits: readonly number[]): string {
  return digits.length === 1 ? `${digits[0]}` : `${digits.slice(0, -1).join(', ')} and ${digits[digits.length - 1]}`
}

/** One ALS fact in words, ready to follow "where" or start a clause. */
export function alsAicAlsUseText(use: AlsAicAlsUse, aic: ShortAicInstance): string {
  const size = `${use.als.cells.length} cells hold all but one of its ${use.als.digits.length} digits`
  if (use.kind === 'link') {
    const [p, q] = use.ends!
    return `the ${alsBasisText(use.als)} must hold ${p.digit} or ${q.digit} (its ${size})`
  }
  const [x, y] = [aic.nodes[0], aic.nodes[aic.nodes.length - 1]].map(aicNodeText)
  const [fromX, fromY] = use.ruledOut!
  return (
    `${x} would rule ${digitList(fromX)} out of the ${alsBasisText(use.als)} and ${y} would rule out ${digitList(fromY)}; ` +
    `one of them is true and its ${size}, so ${digitList(use.locked!)} must be in it`
  )
}

function boxOf([row, col]: Cell): number {
  return boxOfCell(row, col)
}

function sees(a: Cell, b: Cell): boolean {
  if (a[0] === b[0] && a[1] === b[1]) {
    return false
  }
  return sharesHouseOrLink(a[0], a[1], b[0], b[1])
}

/** A strong link of the search graph; `als` is the ALS behind an ALS link,
 * null for an ordinary (or grouped) one. */
interface Edge {
  to: number
  als: AicAlsBasis | null
}

/**
 * ALS-AIC (sudokuwiki.org/AIC_with_ALSs): an Alternating Inference Chain
 * that may also link through an Almost Locked Set - N unsolved cells of one
 * house holding N+1 digits between them. N cells hold N different digits, so
 * exactly one of the ALS's digits ends up missing from it: whichever digit x
 * a chain rules out of the ALS, every other digit y is then locked in it (a
 * naked set formed on the fly - SudokuWiki's "pseudo Naked Pair"). That is a
 * strong link between the node "x is in the ALS's x-cells" and "y is in its
 * y-cells", for any two of its digits. A node like that is a group when the
 * digit is in more than one ALS cell (SudokuWiki's 7{H6|G6}); the chain
 * enters it by a weak link from a candidate seeing every one of those cells,
 * and leaves it the same way - "both cracks of the whip".
 *
 * ALS of 2 to ALS_AIC_MAX_ALS_CELLS cells (a 1-cell ALS is a bivalue cell,
 * whose link every AIC already has). SudokuWiki also chains through
 * ordinary groups ("w.Groups" - its third example needs 5[G1|G2]), so the
 * graph has them too: a digit's cells in one box and row (or column), linked
 * strongly when it and one other such part are the digit's only places in a
 * row, column or box, and weakly to every candidate or group of the digit
 * seeing all of it. Only an ALS link makes a chain an ALS-AIC, though - a
 * chain that is merely grouped is not reported.
 *
 * Eliminations: anything weakly linked to both ends (a candidate seeing every
 * cell of a grouped end), as for any AIC - a chain ending in one cell clears
 * the cell's other candidates. Plus the ALS closure, SudokuWiki's December
 * 2025 "extra off-chain eliminations": its loop P - x{A} = y{A} - Q = ... = P
 * is, cut open, a chain Q = ... = P whose ends each rule a digit out of the
 * same ALS A. One end is true, and only one digit can be missing from A, so
 * A's other digits are all in it and go from every cell seeing all of their
 * A cells (the loop's normal eliminations are the open chains through the
 * ALS link, found anyway). In general the missing digit is one of those the
 * ends rule out, so every other digit is locked. A closure counts as using
 * the ALS, so the chain itself may be plain. Only when the two ends rule out
 * different digits, though: a digit both rule out is the chain's own
 * elimination, after which the ALS is just a locked set (see closures()).
 *
 * Search: Generic AIC's breadth-first search over (node, used an ALS yet)
 * states, any odd length from 1 to ALS_AIC_MAX_LENGTH, so each start/end
 * pair is found by its shortest ALS-using chain. Like UR-AIC, open chains
 * only - the app has no continuous loops; each of a loop's eliminations is
 * also an open chain's (cut the loop at that weak link).
 */
export class SudokuAlsAicFinder {
  find(
    board: Board,
    candidates: CandidateGrid,
    graphs?: LinkGraphs,
    maxLength: number = ALS_AIC_MAX_LENGTH,
    maxAlsCells: number = ALS_AIC_MAX_ALS_CELLS,
  ): AlsAicInstance[] {
    const limit = maxLength % 2 === 0 ? maxLength - 1 : maxLength
    const base = graphs ?? buildLinkGraphs(board, candidates)

    const nodes: AicCandidate[] = []
    const idOf = new Map<string, number>()
    const strong: Edge[][] = []
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
    // The first reason given for a link is kept: ordinary links are added
    // before ALS ones, so a link a row/column/box/cell already gives is
    // never shown as an ALS link.
    const addStrong = (a: number, b: number, als: AicAlsBasis | null) => {
      if (a === b || strongSet[a].has(b)) {
        return
      }
      strongSet[a].add(b)
      strongSet[b].add(a)
      strong[a].push({ to: b, als })
      strong[b].push({ to: a, als })
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

    // Ordinary grouped links: a unit whose candidates of a digit split into
    // exactly two box/line parts (a single cell is a part too; two singles
    // are the conjugate pair already linked above).
    const units = sudokuUnits()
    for (let digit = 1; digit <= BOARD_SIZE; digit++) {
      units.forEach((unit, u) => {
        const cells = unit.filter(([r, c]) => has(r, c, digit)).sort((p, q) => p[0] - q[0] || p[1] - q[1])
        if (cells.length < 3) {
          return
        }
        // Units are rows 0-8, columns 9-17, boxes 18-26 (SudokuUnits).
        // An X-Sudoku's diagonals (27, 28) make no groups: three diagonal
        // cells of one box share no line.
        if (u >= 27) {
          return
        }
        const splits: Array<(cell: Cell) => number> = u < 18 ? [boxOf] : [([r]) => r, ([, c]) => c]
        for (const partOf of splits) {
          const parts = new Map<number, Cell[]>()
          for (const cell of cells) {
            parts.set(partOf(cell), [...(parts.get(partOf(cell)) ?? []), cell])
          }
          if (parts.size === 2) {
            const [p, q] = [...parts.values()]
            addStrong(nodeFor(digit, p), nodeFor(digit, q), null)
          }
        }
      })
    }

    // ALS links, and per ALS digit its node (for the closure below).
    const allAls = findAls(board, candidates, maxAlsCells)
    const alsNodes: Array<Map<number, number>> = []
    for (const als of allAls) {
      const byDigit = new Map<number, number>()
      for (const digit of als.digits) {
        byDigit.set(
          digit,
          nodeFor(
            digit,
            als.cells.filter(([r, c]) => candidates[r][c][digit - 1]),
          ),
        )
      }
      const ids = [...byDigit.values()]
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addStrong(ids[i], ids[j], als)
        }
      }
      alsNodes.push(byDigit)
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

    // Per node, per ALS (index) it rules digits out of: those digits, as a
    // bit mask (digit d = bit d).
    const ruledOut: Array<Map<number, number>> = nodes.map(() => new Map())
    alsNodes.forEach((digitNodes, k) => {
      for (const [digit, id] of digitNodes) {
        for (const w of weak[id]) {
          ruledOut[w].set(k, (ruledOut[w].get(k) ?? 0) | (1 << digit))
        }
      }
    })

    return this.search(nodes, strong, weak, weakSet, ruledOut, allAls, alsNodes, limit)
  }

  private search(
    nodes: readonly AicCandidate[],
    strong: readonly Edge[][],
    weak: readonly number[][],
    weakSet: ReadonlyArray<Set<number>>,
    ruledOut: ReadonlyArray<Map<number, number>>,
    allAls: readonly AicAlsBasis[],
    alsNodes: ReadonlyArray<Map<number, number>>,
    limit: number,
  ): AlsAicInstance[] {
    const n = nodes.length
    // States: node * 2 + (1 once an ALS link is used).
    const seenStrong = new Int32Array(2 * n)
    const seenWeak = new Int32Array(2 * n)
    const fromStrong = new Int32Array(2 * n)
    const fromWeak = new Int32Array(2 * n)
    const viaStrong: Array<AicAlsBasis | null> = new Array(2 * n).fill(null)
    let stamp = 0
    const reported = new Set<number>()
    const instances: AlsAicInstance[] = []

    // The ALS closures a chain from `x` to `y` makes - see the class comment.
    const closures = (x: number, y: number): Array<{ use: AlsAicAlsUse; eliminations: CandidateElimination[] }> => {
      const [small, large] = ruledOut[x].size <= ruledOut[y].size ? [ruledOut[x], ruledOut[y]] : [ruledOut[y], ruledOut[x]]
      const out: Array<{ use: AlsAicAlsUse; eliminations: CandidateElimination[] }> = []
      for (const [k, smallMask] of small) {
        const largeMask = large.get(k)
        if (largeMask === undefined) {
          continue
        }
        // Both ends rule out the same digit: that is an ordinary AIC
        // elimination (each of its ALS cells sees both ends), and with it made
        // the ALS is a plain locked set - a separate, later move (a naked
        // pair/triple), not part of this chain. Only a closure whose ends rule
        // out different digits needs the chain, so only that one is reported
        // (by request, 2026-10-05: 6r3c5 =ALS= 7r3c2 - ... = 6r8c4 used to
        // claim 7r3c2 through {4,6,7} in r3c4, r3c7, which is just "r3c4 is
        // not 6, then the naked pair {4,7}").
        if (smallMask & largeMask) {
          continue
        }
        const als = allAls[k]
        const missing = smallMask | largeMask
        const locked = als.digits.filter((d) => !(missing & (1 << d)))
        const eliminations: CandidateElimination[] = []
        for (const digit of locked) {
          // A one-cell node is also weakly linked to its cell's other
          // digits, which are not targets.
          for (const w of weak[alsNodes[k].get(digit)!]) {
            if (!nodes[w].cells && nodes[w].digit === digit) {
              eliminations.push({ row: nodes[w].row, col: nodes[w].col, digit })
            }
          }
        }
        if (eliminations.length > 0) {
          const maskDigits = (mask: number) => als.digits.filter((d) => mask & (1 << d))
          const xMask = ruledOut[x].get(k)!
          const yMask = ruledOut[y].get(k)!
          out.push({ use: { als, kind: 'closure', ruledOut: [maskDigits(xMask), maskDigits(yMask)], locked }, eliminations })
        }
      }
      return out
    }

    const consider = (start: number, end: number, length: number) => {
      const y = end >> 1
      const usedAls = (end & 1) === 1
      if (y === start || (!usedAls && (ruledOut[start].size === 0 || ruledOut[y].size === 0))) {
        return
      }
      const pairKey = ((start < y ? start * n + y : y * n + start) * 2) + (end & 1)
      if (reported.has(pairKey)) {
        return
      }

      // Eliminate what can't be true alongside either end (a plain chain
      // only through an ALS closure).
      const eliminationKeys = new Set<string>()
      const eliminations: CandidateElimination[] = []
      const push = (e: CandidateElimination) => {
        const key = candidateKey(e.row, e.col, e.digit)
        if (!eliminationKeys.has(key)) {
          eliminationKeys.add(key)
          eliminations.push(e)
        }
      }
      // A plain chain's own eliminations are an ordinary AIC's, so only
      // what a closure adds beyond them makes it an ALS-AIC.
      const [small, large] = weak[start].length <= weak[y].length ? [start, y] : [y, start]
      for (const z of weak[small]) {
        if (!nodes[z].cells && weakSet[large].has(z)) {
          push({ row: nodes[z].row, col: nodes[z].col, digit: nodes[z].digit })
        }
      }
      if (!usedAls) {
        eliminations.length = 0
      }
      const closureUses: AlsAicAlsUse[] = []
      if (ruledOut[start].size > 0 && ruledOut[y].size > 0) {
        for (const closure of closures(start, y)) {
          const before = eliminations.length
          closure.eliminations.forEach(push)
          if (eliminations.length > before) {
            closureUses.push(closure.use)
          }
        }
      }
      if (eliminations.length === 0) {
        return
      }

      // Walk back: end <- weak-reached <- strong-reached <- ... <- start.
      const states: number[] = [end]
      const viaAls: Array<AicAlsBasis | null> = []
      for (let at = end; at !== start * 2; ) {
        const viaStrongLink = states.length % 2 === 1
        viaAls.push(viaStrongLink ? viaStrong[at] : null)
        at = viaStrongLink ? fromStrong[at] : fromWeak[at]
        states.push(at)
      }
      states.reverse()
      viaAls.reverse()
      const path = states.map((s) => s >> 1)
      if (new Set(path).size !== path.length) {
        return
      }
      reported.add(pairKey)
      eliminations.sort((p, q) => p.row - q.row || p.col - q.col || p.digit - q.digit)

      const chain = path.map((id) => nodes[id])
      const links: AicLink[] = chain.slice(1).map((to, i) => ({
        from: chain[i],
        to,
        kind: i % 2 === 0 ? 'strong' : 'weak',
        ...(viaAls[i] ? { als: viaAls[i]! } : {}),
      }))
      const alsUses: AlsAicAlsUse[] = [
        ...links.flatMap((link): AlsAicAlsUse[] => (link.als ? [{ als: link.als, kind: 'link', ends: [link.from, link.to] }] : [])),
        ...closureUses,
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
        alsUses,
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
      for (const { to, als } of strong[start]) {
        const state = to * 2 + (als ? 1 : 0)
        if (seenStrong[state] !== stamp) {
          seenStrong[state] = stamp
          fromStrong[state] = start * 2
          viaStrong[state] = als
          frontier.push(state)
          consider(start, state, 1)
        }
      }
      for (let length = 1; length < limit && frontier.length > 0; length += 2) {
        const reachedWeak: number[] = []
        for (const state of frontier) {
          for (const to of weak[state >> 1]) {
            const next = to * 2 + (state & 1)
            if (seenWeak[next] !== stamp) {
              seenWeak[next] = stamp
              fromWeak[next] = state
              reachedWeak.push(next)
            }
          }
        }
        const nextFrontier: number[] = []
        for (const state of reachedWeak) {
          for (const { to, als } of strong[state >> 1]) {
            const next = to * 2 + ((state & 1) | (als ? 1 : 0))
            if (seenStrong[next] === stamp) {
              continue
            }
            seenStrong[next] = stamp
            fromStrong[next] = state
            viaStrong[next] = als
            nextFrontier.push(next)
            consider(start, next, length + 2)
          }
        }
        frontier = nextFrontier
      }
    }

    // Shortest chain per elimination set (ties: more conjugate pairs), then
    // shortest first (ties: most eliminations). ALS links are everywhere -
    // a 2026-10-03 sweep of 4.4k solve states averaged ~74 distinct
    // elimination sets per state - so, as in ALS-xz, a chain is dropped when
    // one kept, at-most-as-long chain already makes all its eliminations.
    // Only against a single chain, never the union of several: that would
    // hide a chain proving something no one other chain does.
    const sorted = (pickBestPerEliminationSet(instances) as AlsAicInstance[]).sort(
      (p, q) => p.length - q.length || q.eliminations.length - p.eliminations.length,
    )
    const kept: Array<{ instance: AlsAicInstance; keys: Set<string> }> = []
    for (const instance of sorted) {
      const keys = instance.eliminations.map((e) => candidateKey(e.row, e.col, e.digit))
      if (!kept.some((k) => keys.every((key) => k.keys.has(key)))) {
        kept.push({ instance, keys: new Set(keys) })
      }
    }
    return kept.map((k) => k.instance)
  }
}

/** Every ALS of 2 to `maxCells` cells, each distinct cell set once (cells
 * sharing a row or column and a box are found from both houses). Exported
 * for SudokuComplexAicGraph, which puts the same ALS links in its graph. */
export function findAls(board: Board, candidates: CandidateGrid, maxCells: number): AicAlsBasis[] {
  const byKey = new Map<string, AicAlsBasis>()
  for (const unit of sudokuUnits()) {
    const open: Array<{ cell: Cell; mask: number }> = []
    for (const [row, col] of unit) {
      if (board[row][col] !== 0) continue
      let mask = 0
      for (let d = 1; d <= BOARD_SIZE; d++) {
        if (candidates[row][col][d - 1]) mask |= 1 << d
      }
      // An empty cell only exists on a broken grid; leaving it out keeps
      // "N cells, N+1 digits" meaning what it should.
      if (mask !== 0) open.push({ cell: [row, col], mask })
    }
    const subsetCount = 1 << open.length
    for (let subset = 1; subset < subsetCount; subset++) {
      let size = 0
      let mask = 0
      for (let k = 0; k < open.length; k++) {
        if (subset & (1 << k)) {
          size++
          mask |= open[k].mask
        }
      }
      if (size < 2 || size > maxCells || popcount(mask) !== size + 1) continue
      const cells = open.filter((_, k) => subset & (1 << k)).map((o) => o.cell)
      cells.sort((p, q) => p[0] - q[0] || p[1] - q[1])
      const key = cells.map(cellRef).join('')
      if (!byKey.has(key)) {
        const digits: number[] = []
        for (let d = 1; d <= BOARD_SIZE; d++) {
          if (mask & (1 << d)) digits.push(d)
        }
        byKey.set(key, { cells, digits })
      }
    }
  }
  return [...byKey.values()]
}

function popcount(mask: number): number {
  let count = 0
  for (let m = mask; m; m &= m - 1) {
    count++
  }
  return count
}

/** Every cell an ALS-AIC's reasoning rests on: its nodes' cells and every
 * ALS it uses. */
export function alsAicBasisCells(aic: AlsAicInstance): Cell[] {
  const seen = new Map<string, Cell>()
  for (const cell of [...aic.nodes.flatMap((node) => aicNodeCells(node)), ...aic.alsUses.flatMap((use) => use.als.cells)]) {
    seen.set(cellRef(cell), cell)
  }
  return [...seen.values()]
}
