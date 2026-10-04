import { markedCandidateDigits } from './boardUtils'
import { ALS_AIC_MAX_ALS_CELLS, findAls } from './SudokuAlsAicFinder'
import { buildGroupedLinkGraph } from './SudokuGroupedAicFinder'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import { aicNodeCells, candidateKey, type AicAlsBasis, type AicCandidate, type AicUrBasis } from './SudokuShortAicFinder'
import { SudokuUrAicFinder, type UrAicRectangleUse } from './SudokuUrAicFinder'
import type { Board, CandidateGrid } from './types'

type Cell = readonly [number, number]

/**
 * A "complex AIC" is an AIC that may use strong links other than the two
 * ordinary ones (bilocal: a digit's two places in a unit; bivalue: a cell's
 * two candidates). The app has three kinds of them, each its own technique
 * when used alone, and a chain may mix them (a "Grouped-UR-ALS-AIC"):
 *
 * - 'grouped': a unit's candidates of a digit split into two box/line parts
 *   (Grouped AIC);
 * - 'ur': a Unique Rectangle's two extra nodes, plus the deadly-pair weak
 *   link (UR-AIC);
 * - 'als': two digits of one Almost Locked Set (ALS-AIC).
 *
 * In the app's difficulty order: plain < grouped < ur < als.
 */
export type ComplexLinkKind = 'plain' | 'grouped' | 'ur' | 'als'

/** Bit per complex kind, so a set of them is a number 0-7 whose numeric order
 * is "easiest first": by the hardest kind in the set, then by what else is in
 * it (a chain needing only UR links is easier than one needing an ALS link,
 * whatever else the ALS chain avoids). */
export const COMPLEX_KIND_BIT: Record<ComplexLinkKind, number> = { plain: 0, grouped: 1, ur: 2, als: 4 }

export interface ComplexStrongEdge {
  to: number
  kind: ComplexLinkKind
  ur?: AicUrBasis
  als?: AicAlsBasis
}

export interface ComplexWeakEdge {
  to: number
  /** Present on a deadly-pair link, the only weak link that isn't two
   * candidates of one cell or of one digit in a unit. */
  ur?: AicUrBasis
}

/** One graph holding every link any of the app's AIC techniques can use, each
 * tagged with the kind that gives it. A link several kinds give keeps the
 * easiest one (they are added easiest first). */
export interface ComplexLinkGraph {
  nodes: AicCandidate[]
  /** candidateKey(row, col, digit) for a single candidate. */
  idOf: Map<string, number>
  strong: ComplexStrongEdge[][]
  weak: ComplexWeakEdge[][]
  /** Ordinary weak links only (no deadly pairs): "these two see each other". */
  weakSet: Array<Set<number>>
  /** Bits of the complex kinds that have at least one link here. */
  available: number
}

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

const urFinder = new SudokuUrAicFinder()

/**
 * Grouped AIC's graph (buildGroupedLinkGraph) plus UR-AIC's and ALS-AIC's
 * links, built by those finders' own code where it could be shared
 * (addExtrasLink, addDeadlyPairLinks, findAls); the rectangle loop below is
 * UR-AIC's, copied - keep it in step.
 *
 * Used by SudokuDragonAicConverter only. It is not a finder: nothing here
 * decides which chains are worth reporting, and ALS-AIC's closure
 * eliminations (which aren't links) have no place in it.
 */
export function buildComplexLinkGraph(board: Board, candidates: CandidateGrid, maxAlsCells: number = ALS_AIC_MAX_ALS_CELLS): ComplexLinkGraph {
  const grouped = buildGroupedLinkGraph(board, candidates)
  const nodes = grouped.nodes
  const idOf = grouped.idOf
  const weakSet = grouped.weakSet
  const strongSet = grouped.strongSet
  const strong: ComplexStrongEdge[][] = grouped.strong.map((list, from) =>
    list.map((to) => ({ to, kind: nodes[from].cells || nodes[to].cells ? 'grouped' : 'plain' })),
  )
  const weak: ComplexWeakEdge[][] = grouped.weak.map((list) => list.map((to) => ({ to })))
  const urWeakSet: Array<Set<number>> = nodes.map(() => new Set())
  let available = grouped.groupCount > 0 ? COMPLEX_KIND_BIT.grouped : 0

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
      urWeakSet.push(new Set())
    }
    return id
  }
  const single = (row: number, col: number, digit: number) => register(candidateKey(row, col, digit), { row, col, digit })
  // Groups the grouped graph doesn't have: two UR corners in different boxes,
  // an ALS digit's cells across a house. Their weak links are added last.
  const newGroups: number[] = []
  const nodeFor = (digit: number, cells: readonly Cell[]): number => {
    if (cells.length === 1) {
      return single(cells[0][0], cells[0][1], digit)
    }
    const sorted = [...cells].sort((p, q) => p[0] - q[0] || p[1] - q[1])
    const key = `g${digit}:${sorted.map(cellRef).join('')}`
    const known = idOf.get(key)
    if (known !== undefined) {
      return known
    }
    const id = register(key, { row: sorted[0][0], col: sorted[0][1], digit, cells: sorted })
    newGroups.push(id)
    return id
  }
  const addStrong = (a: number, b: number, kind: ComplexLinkKind, basis: { ur?: AicUrBasis; als?: AicAlsBasis }) => {
    if (a === b || strongSet[a].has(b)) {
      return
    }
    strongSet[a].add(b)
    strongSet[b].add(a)
    strong[a].push({ to: b, kind, ...basis })
    strong[b].push({ to: a, kind, ...basis })
    available |= COMPLEX_KIND_BIT[kind]
  }

  // UR links (the loop is SudokuUrAicFinder.find's).
  const addUrStrong = (a: number, b: number, use: Omit<UrAicRectangleUse, 'inChain'> | null) => addStrong(a, b, 'ur', { ur: use!.ur })
  const addUrWeak = (a: number, b: number, use: Omit<UrAicRectangleUse, 'inChain'> | null) => {
    if (a === b || weakSet[a].has(b) || urWeakSet[a].has(b)) {
      return
    }
    urWeakSet[a].add(b)
    urWeakSet[b].add(a)
    weak[a].push({ to: b, ur: use!.ur })
    weak[b].push({ to: a, ur: use!.ur })
    available |= COMPLEX_KIND_BIT.ur
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
          if (new Set(cells.map(boxOf)).size !== 2 || cells.some(([r, c]) => board[r][c] !== 0)) {
            continue
          }
          const digitsOf = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]))
          for (let a = 1; a <= 9; a++) {
            for (let b = a + 1; b <= 9; b++) {
              if (digitsOf.every((digits) => digits.includes(a) && digits.includes(b))) {
                const ur: AicUrBasis = { cells, digits: [a, b] }
                urFinder.addExtrasLink(ur, digitsOf, single, nodeFor, nodes, addUrStrong)
                urFinder.addDeadlyPairLinks(board, candidates, ur, digitsOf, single, nodes, addUrWeak)
              }
            }
          }
        }
      }
    }
  }

  // ALS links: any two digits of one ALS, each as "it is in its cells".
  for (const als of findAls(board, candidates, maxAlsCells)) {
    const ids = als.digits.map((digit) =>
      nodeFor(
        digit,
        als.cells.filter(([r, c]) => candidates[r][c][digit - 1]),
      ),
    )
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        addStrong(ids[i], ids[j], 'als', { als })
      }
    }
  }

  // The new groups' weak links: every other node of the digit seeing all of
  // the group (so disjoint from it - a cell never sees itself).
  const byDigit: number[][] = Array.from({ length: BOARD_SIZE + 1 }, () => [])
  nodes.forEach((node, id) => byDigit[node.digit].push(id))
  for (const g of newGroups) {
    const gCells = nodes[g].cells!
    for (const other of byDigit[nodes[g].digit]) {
      if (other !== g && !weakSet[g].has(other) && aicNodeCells(nodes[other]).every((cell) => gCells.every((gc) => sees(cell, gc)))) {
        weakSet[g].add(other)
        weakSet[other].add(g)
        weak[g].push({ to: other })
        weak[other].push({ to: g })
      }
    }
  }

  return { nodes, idOf, strong, weak, weakSet, available }
}
