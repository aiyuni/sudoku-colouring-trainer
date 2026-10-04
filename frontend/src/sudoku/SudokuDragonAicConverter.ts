import { alsBasisText } from './SudokuAlsAicFinder'
import { buildComplexLinkGraph, COMPLEX_KIND_BIT, type ComplexLinkGraph, type ComplexLinkKind, type ComplexStrongEdge } from './SudokuComplexAicGraph'
import type { DragonColor, DragonMove } from './SudokuDragonFinder'
import { aicNodeCells, aicNodeText, candidateKey, type AicCandidate, type AicLink, type ShortAicInstance } from './SudokuShortAicFinder'
import type { CandidateElimination } from './SudokuPairFinder'
import { urBasisText } from './SudokuUrAicFinder'
import type { Board, CandidateGrid } from './types'

type Side = 'A' | 'B'

function sideOf(color: DragonColor): Side {
  return color === 'blue' || color === 'darkBlue' ? 'A' : 'B'
}

/**
 * A single Dragon Colouring's elimination step read as an AIC that runs
 * through the Dragon's own coloured candidates - a plain Dragon's, or a
 * Dynamic Dragon's.
 *
 * Why this is possible at all: a side's node means "true if the side is
 * true", and every plain extension derives a new node from earlier ones. When
 * a node rests on just ONE earlier node - that node rules out a candidate or
 * box/line group which is strongly linked to the new one - the step is the
 * two AIC links `earlier - ruled out = new`. The Medusa's own links are
 * strong, so they carry the chain from one side to the other. A Rule 3/4/5
 * elimination (a candidate that can't be true together with a node `a` of one
 * side nor with a node `b` of the other) is then the AIC
 *
 *   a = . - A = . - A = B - . = B - . = b
 *
 * whose every second candidate is a side-A node up to one strong link that
 * crosses to side B, and a side-B node from there on. A mass elimination (two
 * nodes of one side that can't both be true) is the same thing closed into a
 * loop on one candidate of that side's Medusa colour: assume it, follow the
 * side to the clash, come back to it being false.
 *
 * **What "through the colouring" means** (the user's choice, 2026-10-04,
 * over "same two ends" and "same eliminations", which convert far more but
 * needn't have anything to do with how the Dragon got there): read from the
 * crossing link outwards, every node the chain takes as TRUE must be a
 * coloured candidate of that side, except where a colour can't exist:
 *
 * - a group node (a colour marks one candidate, never "one of these cells");
 * - a candidate the chain reaches through a UR or ALS strong link - the
 *   Dragon's own rules know no such link, so it never colours through one;
 * - in a Dynamic Dragon, an uncoloured candidate in a cell one of that side's
 *   Extension Rule 3 steps rested on (their substeps' basis cells) - what
 *   those techniques prove along the way is never coloured.
 *
 * The nodes the chain takes as false are free, as before. The two ends are
 * always coloured (they are the elimination's own witnesses), and so are the
 * two ends of the crossing link.
 *
 * **Complex AICs** (SudokuComplexAicGraph): the chain may use grouped, UR and
 * ALS links, in any mix. The easiest form wins: every set of complex kinds is
 * tried easiest first (none, grouped, UR, grouped+UR, ALS, ...), and within
 * the first set that has a chain, the shortest one. Several equally short
 * ones: a random one (`random`), with how many there were in `alternatives`.
 * So a Dragon with a plain AIC equivalent always gets that one, and a complex
 * one is only looked for when there is none.
 *
 * When it is not possible: a step that needs SEVERAL earlier nodes at once (a
 * 3-candidate cell emptied by two different nodes, a unit cleared by nodes in
 * two boxes) is a branch, and a chain has none - that Dragon is a forcing
 * net there. A Dynamic step can also rest on a technique no link here stands
 * for (a hidden pair, a fish, a BUG), or on links that only exist on its
 * hypothetical grid. The search doesn't replay the move log: it looks for any
 * such chain in the colouring as it stands at that step, so a node the Dragon
 * happened to derive from two nodes but that one node also justifies still
 * converts.
 *
 * Everything found is a real AIC of the grid (every link is one a Grouped
 * AIC, UR-AIC or ALS-AIC could use), so it is sound regardless of the Dragon.
 */
export interface DragonAicEquivalent {
  /** 'chain': an open AIC between a node of each side. 'loop': the AIC whose
   * two ends both see `pivot`, a Medusa-coloured candidate of the side a mass
   * elimination proves false - the chain proves that one candidate false, and
   * the rest of the mass elimination follows from the Medusa. */
  kind: 'chain' | 'loop'
  aic: ShortAicInstance
  pivot?: { row: number; col: number; digit: number }
  /** The AIC's eliminations are exactly the move's (always false for a
   * loop, whose mass elimination also places the true side). */
  exact: boolean
  /** The complex link kinds the chain uses; all false = a plain AIC. */
  complex: ComplexKindsUsed
  /** "AIC", "Grouped AIC", "UR-AIC", "ALS-AIC", "Grouped-UR-ALS-AIC", ... */
  name: string
  /** How many equally easy chains there were (same kinds, same length; this
   * is one of them, picked at random). Counted up to MAX_ALTERNATIVES. */
  alternatives: number
}

export interface ComplexKindsUsed {
  grouped: boolean
  ur: boolean
  als: boolean
}

export interface DragonAicOptions {
  /** Picks among equally easy chains; Math.random by default. */
  random?: () => number
  /** Link graphs already built, by grid: the steps of one Dragon are mostly
   * found on the same grid (all of them with Exhaustive off), and building
   * the graph is most of a conversion. dragonAicSummary passes one. */
  graphs?: Map<string, ComplexLinkGraph>
}

/** Whether a whole single Dragon has an AIC equivalent: at 'every' one of its
 * elimination steps, at 'some' of them, or at 'none'. */
export type DragonAicStatus = 'every' | 'some' | 'none'

export interface DragonAicSummary {
  status: DragonAicStatus
  /** Per elimination step (index into the move log): its chain, or null. */
  byStep: Map<number, DragonAicEquivalent | null>
}

/** Equally short chains are listed up to this many before one is picked. */
export const MAX_ALTERNATIVES = 50
/** ... and the listing gives up after this many steps back through the
 * search (a long chain through a dense colouring has very many routes). */
const MAX_ENUMERATION_STEPS = 20000

const PHASES = 5

/** Breadth-first search over (node, phase) states; `expand` lists a state's
 * successors and `isEnd` accepts a state. Returns the node paths of the
 * accepted states at the first depth that has one `valid` path repeating no
 * node (a chain may not) - every shortest path, up to MAX_ALTERNATIVES. */
function searchPaths(
  nodeCount: number,
  starts: readonly number[],
  expand: (node: number, phase: number, push: (node: number, phase: number) => void) => void,
  isEnd: (node: number, phase: number) => boolean,
  valid: (path: readonly number[]) => boolean,
): number[][] {
  const depth = new Int32Array(nodeCount * PHASES).fill(-1)
  // Every predecessor one level up, not just the first: they are the other
  // equally short chains.
  const parents = new Map<number, number[]>()
  let frontier: number[] = []
  for (const state of starts) {
    if (depth[state] === -1) {
      depth[state] = 0
      frontier.push(state)
    }
  }
  for (let level = 0; frontier.length > 0; level++) {
    const next: number[] = []
    const accepted: number[] = []
    for (const state of frontier) {
      const node = Math.floor(state / PHASES)
      const phase = state % PHASES
      if (isEnd(node, phase)) {
        accepted.push(state)
        continue
      }
      expand(node, phase, (toNode, toPhase) => {
        const to = toNode * PHASES + toPhase
        if (depth[to] === -1) {
          depth[to] = level + 1
          parents.set(to, [state])
          next.push(to)
        } else if (depth[to] === level + 1) {
          parents.get(to)!.push(state)
        }
      })
    }
    if (accepted.length > 0) {
      const paths = new Map<string, number[]>()
      let steps = 0
      const onPath = new Set<number>()
      const trail: number[] = []
      const walk = (state: number) => {
        const node = Math.floor(state / PHASES)
        if (onPath.has(node) || paths.size >= MAX_ALTERNATIVES || steps++ > MAX_ENUMERATION_STEPS) {
          return
        }
        onPath.add(node)
        trail.push(node)
        const before = parents.get(state)
        if (!before) {
          const path = [...trail].reverse()
          if (valid(path)) {
            paths.set(path.join(','), path)
          }
        } else {
          for (const parent of before) {
            walk(parent)
          }
        }
        trail.pop()
        onPath.delete(node)
      }
      for (const state of accepted) {
        walk(state)
      }
      if (paths.size > 0) {
        return [...paths.values()]
      }
    }
    frontier = next
  }
  return []
}

/** The graph cut down to one set of complex kinds (`mask`, COMPLEX_KIND_BIT
 * bits): plain links plus the links of those kinds. */
interface TierGraph {
  strong: ComplexStrongEdge[][]
  weak: number[][]
  /** Can't both be true, by a weak link this tier has. */
  weakHas: (a: number, b: number) => boolean
}

function tierOf(graph: ComplexLinkGraph, mask: number): TierGraph {
  const allowed = (kind: ComplexLinkKind) => (COMPLEX_KIND_BIT[kind] & ~mask) === 0
  const withUr = (mask & COMPLEX_KIND_BIT.ur) !== 0
  const strong = graph.strong.map((edges) => edges.filter((edge) => allowed(edge.kind)))
  const weak = graph.weak.map((edges) => edges.filter((edge) => withUr || !edge.ur).map((edge) => edge.to))
  const urWeak = withUr ? graph.weak.map((edges) => new Set(edges.filter((edge) => edge.ur).map((edge) => edge.to))) : null
  return { strong, weak, weakHas: (a, b) => graph.weakSet[a].has(b) || (urWeak !== null && urWeak[a].has(b)) }
}

/** The sets of complex kinds worth trying on `graph`, easiest first: by the
 * hardest kind in the set (the techniques' own ranks: Grouped AIC, UR-AIC,
 * ALS-AIC), then by what else is in it - which is the masks' numeric order.
 * A set naming a kind the grid has no link of would only repeat a smaller
 * set. A chain found with a set uses every kind in it: one that didn't would
 * have been found with a smaller set, tried earlier. */
function tierMasks(graph: ComplexLinkGraph): number[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].filter((mask) => (mask & ~graph.available) === 0)
}

function buildInstance(graph: ComplexLinkGraph, path: readonly number[]): { aic: ShortAicInstance; complex: ComplexKindsUsed } {
  const chain: AicCandidate[] = path.map((id) => graph.nodes[id])
  const complex: ComplexKindsUsed = { grouped: false, ur: false, als: false }
  const links: AicLink[] = chain.slice(1).map((to, i) => {
    if (i % 2 === 0) {
      const edge = graph.strong[path[i]].find((e) => e.to === path[i + 1])!
      if (edge.kind !== 'plain') {
        complex[edge.kind] = true
      }
      return { from: chain[i], to, kind: 'strong', ...(edge.ur ? { ur: edge.ur } : {}), ...(edge.als ? { als: edge.als } : {}) }
    }
    const edge = graph.weak[path[i]].find((e) => e.to === path[i + 1])!
    if (edge.ur) {
      complex.ur = true
    }
    return { from: chain[i], to, kind: 'weak', ...(edge.ur ? { ur: edge.ur } : {}) }
  })
  const first = path[0]
  const last = path[path.length - 1]
  const eliminations: CandidateElimination[] = []
  for (const z of graph.weakSet[first]) {
    if (!graph.nodes[z].cells && graph.weakSet[last].has(z) && !path.includes(z)) {
      eliminations.push({ row: graph.nodes[z].row, col: graph.nodes[z].col, digit: graph.nodes[z].digit })
    }
  }
  eliminations.sort((p, q) => p.row - q.row || p.col - q.col || p.digit - q.digit)
  return {
    aic: {
      nodes: chain,
      links,
      length: links.length,
      isSingleDigit: chain.every((n) => n.digit === chain[0].digit),
      eliminationType: chain[0].digit === chain[chain.length - 1].digit ? 1 : 2,
      eliminations,
    },
    complex,
  }
}

/** "AIC", "Grouped AIC", "UR-AIC", "ALS-AIC", or the kinds joined
 * ("Grouped-UR-ALS-AIC") for a chain mixing them. */
export function complexAicName(complex: ComplexKindsUsed): string {
  const kinds = [complex.grouped ? 'Grouped' : '', complex.ur ? 'UR' : '', complex.als ? 'ALS' : ''].filter((k) => k !== '')
  if (kinds.length === 0) {
    return 'AIC'
  }
  return kinds.length === 1 && complex.grouped ? 'Grouped AIC' : `${kinds.join('-')}-AIC`
}

/** The colouring and candidates a move of a Dragon log was found on: every
 * colour up to it, the grid minus the eliminations of earlier elimination
 * groups (Exhaustive Dragon Colouring applies each group before carrying on;
 * the moves of one group are all found on the same grid), and per side the
 * cells its Extension Rule 3 steps (Dynamic Dragon) rested on, as
 * row * 9 + col. */
function stateAtMove(moves: readonly DragonMove[], index: number, candidates: CandidateGrid) {
  const isElimination = (m: DragonMove) => m.eliminated.length > 0 || m.solved.length > 0
  let groupStart = index
  while (groupStart > 0 && isElimination(moves[groupStart - 1])) {
    groupStart--
  }
  const working = candidates.map((row) => row.map((cell) => [...cell]))
  const colours = new Map<string, DragonColor>()
  const techniqueCells: Record<Side, Set<number>> = { A: new Set(), B: new Set() }
  for (let i = 0; i < index; i++) {
    for (const n of moves[i].colored) {
      colours.set(candidateKey(n.row, n.col, n.digit), n.color)
    }
    if (moves[i].kind === 'extension-rule3' && moves[i].colored.length > 0) {
      const cells = techniqueCells[sideOf(moves[i].colored[0].color)]
      for (const substep of moves[i].substeps ?? []) {
        for (const [row, col] of substep.basisCells) {
          cells.add(row * 9 + col)
        }
      }
    }
    if (i < groupStart) {
      for (const e of moves[i].eliminated) {
        working[e.row][e.col][e.digit - 1] = false
      }
    }
  }
  return { working, colours, techniqueCells }
}

/**
 * The AIC equivalent of `moves[index]`, an elimination move (rule3/rule4/
 * rule5/mass-elimination) of a single plain or Dynamic Dragon's log on
 * (board, candidates) - or null when the step has none (a forcing net, a
 * Dynamic technique no link stands for), isn't an elimination move, or is a
 * 'solution'.
 */
export function dragonMoveAic(
  board: Board,
  candidates: CandidateGrid,
  moves: readonly DragonMove[],
  index: number,
  options: DragonAicOptions = {},
): DragonAicEquivalent | null {
  const move = moves[index]
  if (!move || move.secondDragon || !isDragonEliminationMove(move)) {
    return null
  }
  const { working, colours, techniqueCells } = stateAtMove(moves, index, candidates)
  const graphKey = options.graphs ? working.map((row) => row.map((cell) => cell.map((mark) => (mark ? '1' : '0')).join('')).join('')).join('') : ''
  const graph = options.graphs?.get(graphKey) ?? buildComplexLinkGraph(board, working)
  options.graphs?.set(graphKey, graph)
  const n = graph.nodes.length
  const side: Array<Side | null> = new Array(n).fill(null)
  const primary: boolean[] = new Array(n).fill(false)
  for (const [key, color] of colours) {
    const id = graph.idOf.get(key)
    if (id !== undefined) {
      side[id] = sideOf(color)
      primary[id] = color === 'blue' || color === 'yellow'
    }
  }
  // May the chain take `id` as true for side `s`, having derived it by a
  // strong link of `kind`? See "through the colouring" above.
  const trueOk = (id: number, s: Side, kind: ComplexLinkKind): boolean => {
    if (side[id] !== null) {
      return side[id] === s
    }
    const node = graph.nodes[id]
    return kind === 'ur' || kind === 'als' || !!node.cells || techniqueCells[s].has(node.row * 9 + node.col)
  }
  // A chain may not hold the same candidate twice either - as itself and
  // inside a group ("6r4c6 =UR= 6r8c6 - 6(r4c6, r6c6) = ..." is a sound
  // inference, but not a chain anyone would write).
  const disjoint = (path: readonly number[]): boolean => {
    const seen = new Set<string>()
    for (const id of path) {
      const node = graph.nodes[id]
      for (const [row, col] of aicNodeCells(node)) {
        const key = candidateKey(row, col, node.digit)
        if (seen.has(key)) {
          return false
        }
        seen.add(key)
      }
    }
    return true
  }
  const idsOf = (refs: ReadonlyArray<{ row: number; col: number; digit: number }>) =>
    refs.map((e) => graph.idOf.get(candidateKey(e.row, e.col, e.digit))).filter((id): id is number => id !== undefined)
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor((options.random ?? Math.random)() * list.length))]
  const found = (kind: 'chain' | 'loop', paths: number[][]) => {
    const { aic, complex } = buildInstance(graph, pick(paths))
    return { kind, aic, complex, name: complexAicName(complex), alternatives: paths.length }
  }

  if (move.kind === 'mass-elimination') {
    const falsePrimaries = idsOf(move.eliminated)
    for (const mask of tierMasks(graph)) {
      const loops = findLoops(n, tierOf(graph, mask), side, primary, trueOk, disjoint, falsePrimaries)
      if (loops.length > 0) {
        // The path starts at the pivot; the chain is the rest.
        const chosen = pick(loops)
        const p = graph.nodes[chosen[0]]
        return { ...found('loop', [chosen.slice(1)]), alternatives: loops.length, pivot: { row: p.row, col: p.col, digit: p.digit }, exact: false }
      }
    }
    return null
  }

  const targets = idsOf(move.eliminated)
  if (targets.length !== move.eliminated.length) {
    return null
  }
  const seesAll = (id: number) => targets.every((t) => graph.weakSet[id].has(t))
  const targetSet = new Set(targets)
  const starts: number[] = []
  const ends = new Set<number>()
  for (let id = 0; id < n; id++) {
    if (side[id] === 'A' && seesAll(id)) starts.push(id * PHASES)
    if (side[id] === 'B' && seesAll(id)) ends.add(id)
  }
  if (starts.length === 0 || ends.size === 0) {
    return null
  }
  const moveKeys = new Set(move.eliminated.map((e) => candidateKey(e.row, e.col, e.digit)))
  for (const mask of tierMasks(graph)) {
    const tier = tierOf(graph, mask)
    // Phases: 0 = a node true if side A is (walking back down its reasons),
    // 1 = the candidate/group it leaves standing (strong link), 2 = a node
    // true if side B is, 3 = what it rules out (weak link).
    const paths = searchPaths(
      n,
      starts,
      (node, phase, push) => {
        if (phase === 0) {
          for (const edge of tier.strong[node]) {
            if (targetSet.has(edge.to) || !trueOk(node, 'A', edge.kind)) continue
            push(edge.to, 1)
            // The crossing: both of its ends are coloured.
            if (side[node] === 'A' && side[edge.to] === 'B') push(edge.to, 2)
          }
        } else if (phase === 1) {
          for (const to of tier.weak[node]) {
            // Whether an uncoloured `to` may be true depends on the link it
            // leaves by, checked when it is expanded.
            if (side[to] !== 'B' && !targetSet.has(to)) push(to, 0)
          }
        } else if (phase === 2) {
          for (const to of tier.weak[node]) {
            if (!targetSet.has(to)) push(to, 3)
          }
        } else {
          for (const edge of tier.strong[node]) {
            if (!targetSet.has(edge.to) && trueOk(edge.to, 'B', edge.kind)) push(edge.to, 2)
          }
        }
      },
      (node, phase) => phase === 2 && ends.has(node),
      disjoint,
    )
    if (paths.length > 0) {
      const result = found('chain', paths)
      const { eliminations } = result.aic
      return { ...result, exact: eliminations.length === moveKeys.size && eliminations.every((e) => moveKeys.has(candidateKey(e.row, e.col, e.digit))) }
    }
  }
  return null
}

/** A mass elimination's loops: from a Medusa-coloured candidate P of the
 * false side, follow the side's own nodes forward (P - x = node - y = node
 * ...) to a node that can't be true together with another node of the side,
 * then back down that one's reasons (node = x - node = y ...) to something P
 * rules out. P is the only candidate that sees both ends for certain. Every
 * shortest loop over every such P, as node paths starting at P. */
function findLoops(
  n: number,
  tier: TierGraph,
  side: ReadonlyArray<Side | null>,
  primary: readonly boolean[],
  trueOk: (id: number, s: Side, kind: ComplexLinkKind) => boolean,
  disjoint: (path: readonly number[]) => boolean,
  falsePrimaries: readonly number[],
): number[][] {
  let best: number[][] = []
  for (const pivot of falsePrimaries) {
    const s = side[pivot]
    if (s === null || !primary[pivot]) {
      continue
    }
    // Phases: 0 = a node true if the side is (read forward from P), 1 = what
    // it rules out, 2 = a node true if the side is, but known false here (the
    // way back: read from P's other end, it is true too), 3 = what that
    // leaves true, 4 = a candidate left true that isn't the side's (the two
    // sides of a bivalue cell whose candidates both see the side, say) and
    // rules a side node out.
    const paths = searchPaths(
      n,
      [pivot * PHASES],
      (node, phase, push) => {
        if (phase === 0) {
          for (const to of tier.weak[node]) {
            if (to === pivot) continue
            push(to, 1)
            // An uncoloured `to` is checked when expanded, by its link.
            if (side[to] === s || side[to] === null) push(to, 2)
          }
        } else if (phase === 1) {
          for (const edge of tier.strong[node]) {
            if (edge.to === pivot) continue
            if (trueOk(edge.to, s, edge.kind)) push(edge.to, 0)
            if (side[edge.to] !== s) push(edge.to, 4)
          }
        } else if (phase === 2) {
          for (const edge of tier.strong[node]) {
            if (edge.to !== pivot && trueOk(node, s, edge.kind)) push(edge.to, 3)
          }
        } else {
          for (const to of tier.weak[node]) {
            if (to !== pivot && (side[to] === s || side[to] === null)) push(to, 2)
          }
        }
      },
      // Closed once something left true (or a clashing side node right next
      // to the pivot's own consequences) is ruled out by the pivot itself.
      (node, phase) => (phase === 3 || phase === 4) && tier.weakHas(node, pivot),
      disjoint,
    ).filter((path) => path.length > 2)
    if (paths.length > 0 && (best.length === 0 || paths[0].length < best[0].length)) {
      best = paths
    } else if (paths.length > 0 && paths[0].length === best[0].length) {
      best = [...best, ...paths]
    }
  }
  return best
}

/** Every elimination step of a single plain or Dynamic Dragon's log
 * converted (a 'solution' step has no chain form and isn't counted), and
 * what that says about the Dragon as a whole. A log with no such step is
 * 'none'. */
export function dragonAicSummary(board: Board, candidates: CandidateGrid, moves: readonly DragonMove[], options: DragonAicOptions = {}): DragonAicSummary {
  const graphs = options.graphs ?? new Map<string, ComplexLinkGraph>()
  const byStep = new Map<number, DragonAicEquivalent | null>()
  moves.forEach((move, index) => {
    if (isDragonEliminationMove(move)) {
      byStep.set(index, dragonMoveAic(board, candidates, moves, index, { ...options, graphs }))
    }
  })
  const found = [...byStep.values()].filter((equivalent) => equivalent !== null).length
  return { status: found === 0 ? 'none' : found === byStep.size ? 'every' : 'some', byStep }
}

/** One AIC that makes every elimination of a whole (non-mass, single)
 * Dragon log at once, with exactly those eliminations - the strict sense in
 * which a Dragon "is" an AIC. Null when its eliminations need several chains
 * (or a net). Only meaningful when all of the log's eliminations come from
 * one group, i.e. were found on the same grid. */
export function wholeDragonAic(
  board: Board,
  candidates: CandidateGrid,
  moves: readonly DragonMove[],
  options: DragonAicOptions = {},
): DragonAicEquivalent | null {
  const eliminationMoves = moves.filter((m) => m.eliminated.length > 0 || m.solved.length > 0)
  if (eliminationMoves.length === 0 || eliminationMoves.some((m) => !['rule3', 'rule4', 'rule5'].includes(m.kind))) {
    return null
  }
  const first = moves.indexOf(eliminationMoves[0])
  if (moves.slice(first).some((m) => !eliminationMoves.includes(m))) {
    return null
  }
  const merged: DragonMove = { ...eliminationMoves[0], kind: 'rule3', eliminated: eliminationMoves.flatMap((m) => m.eliminated) }
  const result = dragonMoveAic(board, candidates, [...moves.slice(0, first), merged], first, options)
  return result && result.exact ? result : null
}

/** Whether `move` is a step dragonMoveAic can be asked about at all - one
 * that eliminates (a 'solution' move, a whole side covering the grid, has no
 * chain form). */
export function isDragonEliminationMove(move: DragonMove): boolean {
  return ['rule3', 'rule4', 'rule5', 'mass-elimination'].includes(move.kind)
}

/** "9r8c6 =ALS= 7(r7c6, r8c6) -UR- ...": the chain written out, a UR or ALS
 * link marked as one (as urAicChainText and alsAicChainText do for theirs). */
export function complexAicChainText(aic: ShortAicInstance): string {
  return aic.nodes
    .map((node, i) => {
      if (i === 0) {
        return aicNodeText(node)
      }
      const link = aic.links[i - 1]
      const symbol = link.kind === 'strong' ? '=' : '-'
      const mark = link.als ? 'ALS' : link.ur ? 'UR' : ''
      return ` ${mark ? `${symbol}${mark}${symbol}` : symbol} ${aicNodeText(node)}`
    })
    .join('')
}

/** The step player's line for an elimination step's AIC equivalent (or the
 * lack of one), in the Techniques list's AIC wording. `dynamic`: the Dragon
 * is a Dynamic one, which has one more way of having no chain. */
export function dragonAicText(move: DragonMove, equivalent: DragonAicEquivalent | null, dynamic = false): string {
  if (!equivalent) {
    return (
      'No equivalent AIC, not even a complex one (grouped, UR or ALS links): this step rests on several coloured candidates at once (a forcing net)' +
      (dynamic ? ', or on an Extension Rule 3 technique that no chain link stands for' : '') +
      ', which a single chain cannot express.'
    )
  }
  const { aic } = equivalent
  const ref = (row: number, col: number) => `r${row + 1}c${col + 1}`
  const endText = (n: AicCandidate) => (n.cells ? `${n.digit} in (${n.cells.map(([r, c]) => ref(r, c)).join(', ')})` : aicNodeText(n))
  const name = `${equivalent.name}, ${aic.length} link${aic.length === 1 ? '' : 's'}`
  // Each UR / ALS the chain links through, once.
  const bases = [...new Set(aic.links.flatMap((link) => [...(link.ur ? [urBasisText(link.ur)] : []), ...(link.als ? [alsBasisText(link.als)] : [])]))]
  const using = bases.length > 0 ? ` It links through ${bases.join('; ')}.` : ''
  const others =
    equivalent.alternatives > 1
      ? ` (One of ${equivalent.alternatives >= MAX_ALTERNATIVES ? `${MAX_ALTERNATIVES} or more` : equivalent.alternatives} equally easy chains, picked at random.)`
      : ''
  const either = `${complexAicChainText(aic)} states that either ${endText(aic.nodes[0])} or ${endText(aic.nodes[aic.nodes.length - 1])} must be true`
  if (equivalent.kind === 'loop') {
    const pivot = equivalent.pivot!
    return `Equivalent AIC (${name}): ${either}. ${pivot.digit}${ref(pivot.row, pivot.col)} sees both, so it is false - and it is one of the Medusa's own colours, so that whole colour is false, which is this step.${using}${others}`
  }
  return `Equivalent AIC (${name}): ${either}, so ${move.eliminated.map((e) => `${ref(e.row, e.col)} cannot be ${e.digit}`).join(', ')}.${using}${others}`
}
