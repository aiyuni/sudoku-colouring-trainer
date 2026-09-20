import { markedCandidateDigits } from './boardUtils'
import type { CandidateElimination } from './SudokuPairFinder'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import { sudokuUnits } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export type AicLinkKind = 'strong' | 'weak'

export interface AicCandidate {
  row: number
  col: number
  digit: number
}

export interface AicLink {
  from: AicCandidate
  to: AicCandidate
  kind: AicLinkKind
}

/** Chain length 3 (4 nodes, strong-weak-strong) or chain length 5 (6 nodes,
 * strong-weak-strong-weak-strong) - "short" AIC is capped at 5, not an
 * unbounded search. */
export type ShortAicLength = 3 | 5

export interface ShortAicInstance {
  /** The chain's candidates in order: X, the interior nodes, Y - 4 entries
   * for a length-3 chain, 6 for a length-5 chain. */
  nodes: AicCandidate[]
  /** The links joining consecutive nodes - always alternating strong, weak,
   * strong[, weak, strong], one fewer entry than `nodes`. */
  links: AicLink[]
  length: ShortAicLength
  /** Every node shares one digit - only possible at length 3 (a pure
   * X-chain built entirely from bilocal strong links and same-digit weak
   * links); a length-5 chain always crosses digits at least once, and even
   * some length-3 chains switch digits via a same-cell link. Drives the
   * "Short Single-Digit AIC" vs "Short AIC" split - see classifyShortAic. */
  isSingleDigit: boolean
  /** Type 1: nodes[0] and nodes[3] are the same digit - any other cell that
   * sees both of their cells can't be that digit either. Type 2: different
   * digits, whose cells see each other - each end's own cell can't hold the
   * other end's digit. */
  eliminationType: 1 | 2
  eliminations: CandidateElimination[]
}

/** "Short Single-Digit AIC" (length 3, one digit throughout - the classic
 * X-chain) is treated as its own, easier technique, ranked below the
 * general "Short AIC" and above Simple Colouring; everything else found by
 * this finder (length 5, or a rare length-3 chain that switches digits via
 * a same-cell link) stays "Short AIC". */
export type ShortAicKind = 'single-digit' | 'general'

export function classifyShortAic(instance: ShortAicInstance): ShortAicKind {
  return instance.length === 3 && instance.isSingleDigit ? 'single-digit' : 'general'
}

function candidateKey(row: number, col: number, digit: number): string {
  return `${row},${col},${digit}`
}

function sameUnit(a: readonly [number, number], b: readonly [number, number]): boolean {
  const [ar, ac] = a
  const [br, bc] = b
  if (ar === br || ac === bc) {
    return true
  }
  return Math.floor(ar / BOX_SIZE) === Math.floor(br / BOX_SIZE) && Math.floor(ac / BOX_SIZE) === Math.floor(bc / BOX_SIZE)
}

interface LinkGraphs {
  /** Conjugate-pair edges only: a digit candidate to exactly one other
   * candidate of the same digit in a shared unit, or a cell's own two
   * candidates when it has exactly two. */
  strongAdjacency: Map<string, string[]>
  /** Every same-digit-same-unit pair and every same-cell-different-digit
   * pair, regardless of how many candidates share that unit/cell - a
   * strong edge (above) is always also a weak one, but most weak edges
   * aren't strong. */
  weakAdjacency: Map<string, string[]>
  nodeByKey: Map<string, AicCandidate>
}

function buildLinkGraphs(board: Board, candidates: CandidateGrid): LinkGraphs {
  const strongAdjacency = new Map<string, string[]>()
  const weakAdjacency = new Map<string, string[]>()
  const nodeByKey = new Map<string, AicCandidate>()

  const addEdge = (map: Map<string, string[]>, aKey: string, bKey: string) => {
    if (!map.has(aKey)) {
      map.set(aKey, [])
    }
    if (!map.has(bKey)) {
      map.set(bKey, [])
    }
    map.get(aKey)!.push(bKey)
    map.get(bKey)!.push(aKey)
  }

  const registerNode = (row: number, col: number, digit: number): string => {
    const key = candidateKey(row, col, digit)
    if (!nodeByKey.has(key)) {
      nodeByKey.set(key, { row, col, digit })
    }
    return key
  }

  // Same-digit-same-unit links: weak for every pair sharing the unit,
  // additionally strong when the unit has exactly two such cells.
  for (let digit = 1; digit <= 9; digit++) {
    for (const unit of sudokuUnits()) {
      const withCandidate = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1])
      for (let i = 0; i < withCandidate.length; i++) {
        for (let j = i + 1; j < withCandidate.length; j++) {
          const [r1, c1] = withCandidate[i]
          const [r2, c2] = withCandidate[j]
          const key1 = registerNode(r1, c1, digit)
          const key2 = registerNode(r2, c2, digit)
          addEdge(weakAdjacency, key1, key2)
          if (withCandidate.length === 2) {
            addEdge(strongAdjacency, key1, key2)
          }
        }
      }
    }
  }

  // Same-cell-different-digit links: weak for every pair of candidates the
  // cell holds, additionally strong when the cell has exactly two.
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] !== 0) {
        continue
      }
      const digits = markedCandidateDigits(candidates[row][col])
      for (let i = 0; i < digits.length; i++) {
        for (let j = i + 1; j < digits.length; j++) {
          const key1 = registerNode(row, col, digits[i])
          const key2 = registerNode(row, col, digits[j])
          addEdge(weakAdjacency, key1, key2)
          if (digits.length === 2) {
            addEdge(strongAdjacency, key1, key2)
          }
        }
      }
    }
  }

  return { strongAdjacency, weakAdjacency, nodeByKey }
}

/** What a chain ending in candidates x and y (in that order) can eliminate -
 * null if x/y don't yield anything (or are degenerate, e.g. the same cell). */
function computeEliminations(
  board: Board,
  candidates: CandidateGrid,
  x: AicCandidate,
  y: AicCandidate,
): { type: 1 | 2; eliminations: CandidateElimination[] } | null {
  if (x.row === y.row && x.col === y.col) {
    // The two ends share a cell - already a direct link on its own, not a
    // chain conclusion worth surfacing.
    return null
  }

  if (x.digit === y.digit) {
    const eliminations: CandidateElimination[] = []
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if ((row === x.row && col === x.col) || (row === y.row && col === y.col)) {
          continue
        }
        if (board[row][col] !== 0 || !candidates[row][col][x.digit - 1]) {
          continue
        }
        if (sameUnit([row, col], [x.row, x.col]) && sameUnit([row, col], [y.row, y.col])) {
          eliminations.push({ row, col, digit: x.digit })
        }
      }
    }
    if (eliminations.length === 0) {
      return null
    }
    return { type: 1, eliminations }
  }

  if (!sameUnit([x.row, x.col], [y.row, y.col])) {
    return null
  }

  const eliminations: CandidateElimination[] = []
  if (candidates[x.row][x.col][y.digit - 1]) {
    eliminations.push({ row: x.row, col: x.col, digit: y.digit })
  }
  if (candidates[y.row][y.col][x.digit - 1]) {
    eliminations.push({ row: y.row, col: y.col, digit: x.digit })
  }
  if (eliminations.length === 0) {
    return null
  }
  return { type: 2, eliminations }
}

/** Forward and reverse traversal of the same underlying chain describe the
 * identical 3 links - canonicalize to whichever direction sorts first so
 * the two are recognized as one finding, not two. */
function chainDedupeKey(nodes: readonly AicCandidate[]): string {
  const forward = nodes.map((n) => candidateKey(n.row, n.col, n.digit)).join('-')
  const backward = [...nodes].reverse().map((n) => candidateKey(n.row, n.col, n.digit)).join('-')
  return forward < backward ? forward : backward
}

/** A strong link is "bilocal" when its two candidates share a digit (a
 * conjugate pair - the digit can go in exactly two cells of some row,
 * column, or box); the other kind of strong link ("bivalue") instead
 * shares a cell, with two candidate digits. Only strong links can be
 * bilocal - a same-digit weak link never has the "exactly two cells"
 * property (see buildLinkGraphs). */
function isBilocalStrongLink(link: AicLink): boolean {
  return link.kind === 'strong' && link.from.digit === link.to.digit
}

function bilocalStrongLinkCount(links: readonly AicLink[]): number {
  return links.filter(isBilocalStrongLink).length
}

/** Order-independent identity for a set of eliminations - two chains that
 * eliminate the exact same candidate(s) are competing explanations for the
 * same conclusion, not two distinct findings. */
function eliminationSetKey(eliminations: readonly CandidateElimination[]): string {
  return eliminations
    .map((e) => `${e.row}.${e.col}.${e.digit}`)
    .sort()
    .join('|')
}

/** When several chains reach the exact same elimination(s), keep only the
 * most "elegant" explanation: the shortest chain, and among equally short
 * ones, whichever leans on more bilocal (conjugate-pair) strong links
 * rather than bivalue (same-cell) ones. */
function pickBestPerEliminationSet(instances: readonly ShortAicInstance[]): ShortAicInstance[] {
  const bestBySet = new Map<string, ShortAicInstance>()
  for (const instance of instances) {
    const key = eliminationSetKey(instance.eliminations)
    const current = bestBySet.get(key)
    if (!current) {
      bestBySet.set(key, instance)
      continue
    }
    if (instance.links.length < current.links.length) {
      bestBySet.set(key, instance)
    } else if (
      instance.links.length === current.links.length &&
      bilocalStrongLinkCount(instance.links) > bilocalStrongLinkCount(current.links)
    ) {
      bestBySet.set(key, instance)
    }
  }
  return Array.from(bestBySet.values())
}

/**
 * Short AIC (Alternating Inference Chain): a strong link, a weak link, and
 * another strong link joining four candidates X-A-B-Y in a row. Whichever
 * of X or Y is false forces the other true (if X is false, the first
 * strong link forces A true, the weak link then forces B false, and the
 * second strong link forces Y true) - so X and Y behave exactly like a
 * strong link themselves, even though no single link connects them
 * directly. Two eliminations follow depending on whether X and Y are the
 * same digit (Type 1: any other cell seeing both of their cells can't be
 * that digit) or different digits whose cells see each other (Type 2:
 * neither end's cell can hold the other end's digit).
 */
export class SudokuShortAicFinder {
  findShortAics(board: Board, candidates: CandidateGrid): ShortAicInstance[] {
    const { strongAdjacency, weakAdjacency, nodeByKey } = buildLinkGraphs(board, candidates)
    const seen = new Set<string>()
    const instances: ShortAicInstance[] = []

    const emit = (keys: string[]) => {
      const nodes = keys.map((k) => nodeByKey.get(k)!)
      const x = nodes[0]
      const y = nodes[nodes.length - 1]

      const outcome = computeEliminations(board, candidates, x, y)
      if (!outcome) {
        return
      }

      const key = chainDedupeKey(nodes)
      if (seen.has(key)) {
        return
      }
      seen.add(key)

      const links: AicLink[] = []
      for (let i = 0; i < nodes.length - 1; i++) {
        links.push({ from: nodes[i], to: nodes[i + 1], kind: i % 2 === 0 ? 'strong' : 'weak' })
      }

      instances.push({
        nodes,
        links,
        length: (nodes.length - 1) as ShortAicLength,
        isSingleDigit: nodes.every((n) => n.digit === nodes[0].digit),
        eliminationType: outcome.type,
        eliminations: outcome.eliminations,
      })
    }

    for (const [aKey, aStrongNeighbors] of strongAdjacency) {
      for (const bKey of aStrongNeighbors) {
        const bWeakNeighbors = weakAdjacency.get(bKey) ?? []
        for (const cKey of bWeakNeighbors) {
          if (cKey === aKey || cKey === bKey) {
            continue
          }
          const cStrongNeighbors = strongAdjacency.get(cKey) ?? []
          for (const dKey of cStrongNeighbors) {
            if (dKey === aKey || dKey === bKey || dKey === cKey) {
              continue
            }

            // Chain length 3: X=a, ..., Y=d.
            emit([aKey, bKey, cKey, dKey])

            // Extend one more strong-weak round for chain length 5.
            const dWeakNeighbors = weakAdjacency.get(dKey) ?? []
            for (const eKey of dWeakNeighbors) {
              if (eKey === aKey || eKey === bKey || eKey === cKey || eKey === dKey) {
                continue
              }
              const eStrongNeighbors = strongAdjacency.get(eKey) ?? []
              for (const fKey of eStrongNeighbors) {
                if (fKey === aKey || fKey === bKey || fKey === cKey || fKey === dKey || fKey === eKey) {
                  continue
                }

                // Chain length 5: X=a, ..., Y=f.
                emit([aKey, bKey, cKey, dKey, eKey, fKey])
              }
            }
          }
        }
      }
    }

    // Bidirectional traversal already collapsed forward/backward duplicates
    // of the *same* chain (see chainDedupeKey); this collapses *different*
    // chains that happen to reach the same conclusion, keeping only the
    // most elegant one per elimination set.
    return pickBestPerEliminationSet(instances)
  }

  findShortAicEliminations(board: Board, candidates: CandidateGrid): CandidateElimination[] {
    const eliminations = new Map<string, CandidateElimination>()
    for (const instance of this.findShortAics(board, candidates)) {
      for (const elimination of instance.eliminations) {
        eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination)
      }
    }
    return Array.from(eliminations.values())
  }
}
