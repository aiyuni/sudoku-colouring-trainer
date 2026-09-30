// Prototype of "Double Dragon" for analysis. Uses the app's own Dragon internals.
import { SudokuDragonFinder, type DragonNode, type DragonMove } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonFinder'
import { SudokuMedusaFinder, type MedusaChain } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuMedusaFinder'
import { SudokuSolver } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuSolver'
import { SudokuRules } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuRules'
import { createEmptyCandidates } from 'C:/Git/sudoku-solver/frontend/src/sudoku/boardUtils'
import type { Board, CandidateGrid } from 'C:/Git/sudoku-solver/frontend/src/sudoku/types'

export const finder = new SudokuDragonFinder()
export const F = finder as any
export const medusa = new SudokuMedusaFinder()
export const solver = new SudokuSolver()

type Side = 'A' | 'B'
export const sideOf = (c: string): Side => (c === 'blue' || c === 'darkBlue' ? 'A' : 'B')
export const isPrimary = (c: string) => c === 'blue' || c === 'yellow'
const other = (s: Side): Side => (s === 'A' ? 'B' : 'A')
const secondary = (s: Side) => (s === 'A' ? 'darkBlue' : 'orange')
export const key = (n: { row: number; col: number; digit: number }) => `${n.row},${n.col},${n.digit}`
export const nm = (n: { row: number; col: number; digit: number }) => `${n.digit}r${n.row + 1}c${n.col + 1}`

export function autofill(board: Board): CandidateGrid {
  const c = createEmptyCandidates()
  for (let r = 0; r < 9; r++) for (let col = 0; col < 9; col++) if (board[r][col] === 0)
    for (let d = 1; d <= 9; d++) c[r][col][d - 1] = SudokuRules.isSafe(board, r, col, d)
  return c
}

export function isStuckMedusa(chain: MedusaChain, board: Board, cands: CandidateGrid) {
  return medusa.findMassElimination(chain, board, cands) === null &&
    medusa.findRule3Eliminations(chain, board, cands).length === 0 &&
    medusa.findRule4Eliminations(chain, cands).length === 0 &&
    medusa.findRule5Eliminations(chain, cands).length === 0
}

/** Plain dragon from the chain: returns {resolved:true} or the stuck colouring. */
export function plainDragon(chain: MedusaChain, board: Board, cands: CandidateGrid):
  { resolved: true; moves: DragonMove[] } | { resolved: false; nodeMap: Map<string, DragonNode> } {
  const nodeMap = new Map<string, DragonNode>()
  const seed = chain.candidates.map((c) => ({ row: c.row, col: c.col, digit: c.digit, color: c.color as any }))
  for (const n of seed) nodeMap.set(key(n), n)
  const res = F.extendFromState(nodeMap, [F.buildMedusaMove(seed)], board, cands, {})
  return res ? { resolved: true, moves: res.moves } : { resolved: false, nodeMap }
}

function sees(a: DragonNode, b: { row: number; col: number }) {
  return a.row === b.row || a.col === b.col ||
    (Math.floor(a.row / 3) === Math.floor(b.row / 3) && Math.floor(a.col / 3) === Math.floor(b.col / 3))
}
/** a and b can't both be true (and are different candidates). */
export function weakLink(a: DragonNode, b: DragonNode) {
  if (a.row === b.row && a.col === b.col) return a.digit !== b.digit
  return a.digit === b.digit && sees(a, b)
}

export interface DDResult {
  moves: string[]
  final: DragonMove[] | null
  nodeMap: Map<string, DragonNode>
  links: string[]
  contradiction?: string
  bothSidesTrue?: DragonNode[]
}

/**
 * Double dragon: D1 = stuck colouring (A/B). D2 grows from chain2 (C=blue side 'A', D=yellow side 'B' in D2's own colours).
 * Extra extension rule "link": if a node on D2 side X can't be true together with a D1 node on side S, then X => not S => S',
 * so every D1 S' node becomes an X dragon colour. Also if an X node IS a D1 primary node of side S, X => S.
 */
export function doubleDragon(n1: Map<string, DragonNode>, chain2: MedusaChain, board: Board, cands: CandidateGrid,
  opts: { linkFirst?: boolean } = {}): DDResult {
  const nodeMap = new Map<string, DragonNode>()
  for (const c of chain2.candidates) nodeMap.set(key(c), { row: c.row, col: c.col, digit: c.digit, color: c.color as any })
  const log: string[] = []
  const links: string[] = []
  const absorbed: Record<Side, boolean> = { A: false, B: false }
  const d1 = Array.from(n1.values())
  let graph: any = null
  let turn: Side = 'A'

  const tryLink = (X: Side): string | null | { contradiction: string } => {
    if (absorbed[X]) return null
    const xs = Array.from(nodeMap.values()).filter((n) => sideOf(n.color) === X)
    for (const S of ['A', 'B'] as Side[]) {
      const ss = d1.filter((n) => sideOf(n.color) === S)
      let reason: string | null = null
      let implied: Side | null = null
      for (const x of xs) {
        for (const s of ss) {
          if (weakLink(x, s)) { reason = `${nm(x)} (D2 ${x.color}) and ${nm(s)} (D1 ${s.color}) can't both be true`; implied = other(S); break }
          if (key(x) === key(s) && isPrimary(s.color)) { reason = `${nm(x)} (D2 ${x.color}) is D1 primary ${s.color}`; implied = S; break }
        }
        if (reason) break
      }
      if (!reason || !implied) continue
      absorbed[X] = true
      const added: DragonNode[] = []
      for (const t of d1.filter((n) => sideOf(n.color) === implied)) {
        const existing = nodeMap.get(key(t))
        if (existing) {
          if (sideOf(existing.color) !== X && isPrimary(existing.color))
            return { contradiction: `absorbing ${nm(t)} into D2 side ${X} but it is D2 primary of the other side` }
          continue
        }
        const node = { row: t.row, col: t.col, digit: t.digit, color: secondary(X) as any }
        nodeMap.set(key(node), node)
        added.push(node)
      }
      links.push(`${X}: ${reason} => D2 ${X} implies D1 ${implied}; absorbed ${added.length}`)
      return `link ${X} absorbs ${added.map(nm).join(',')}`
    }
    return null
  }

  for (let iter = 0; iter < 2000; iter++) {
    const nodes = Array.from(nodeMap.values())
    const elims: DragonMove[] = F.findEliminationMoves(nodes, board, cands)
    if (elims.length) return { moves: log, final: elims, nodeMap, links }
    const sol = F.findColouringSolutionMove(nodeMap, board)
    if (sol) return { moves: log, final: [sol], nodeMap, links }
    const promo: DragonMove | null = F.findPromotionMove(nodeMap)
    if (promo) {
      for (const n of promo.colored) nodeMap.set(key(n), n)
      log.push('promotion ' + promo.colored.map(nm).join(','))
      graph ??= medusa.buildStrongLinkGraph(board, cands)
      const g = F.findMedusaGrowthMove(nodeMap, graph, promo.colored)
      if (g) { for (const n of g.colored) nodeMap.set(key(n), n); log.push('growth ' + g.colored.map(nm).join(',')) }
      continue
    }
    let moved = false
    for (const X of [turn, other(turn)]) {
      const prim = X === 'A' ? 'blue' : 'yellow'
      if (opts.linkFirst) {
        const l = tryLink(X)
        if (l && typeof l === 'object') return { moves: log, final: null, nodeMap, links, contradiction: l.contradiction }
        if (l) { log.push(l); moved = true; turn = other(X); break }
      }
      const m: DragonMove | null = F.findExtensionRule1Move(nodeMap, board, cands, prim) ??
        F.findExtensionRule2Move(nodeMap, board, cands, prim) ?? F.findExtensionHiddenSingleMove(nodeMap, board, cands, prim)
      if (m) { for (const n of m.colored) nodeMap.set(key(n), n); log.push(`${m.kind} ${m.colored.map(nm)}`); moved = true; turn = other(X); break }
      const l = tryLink(X)
      if (l && typeof l === 'object') return { moves: log, final: null, nodeMap, links, contradiction: l.contradiction }
      if (l) { log.push(l); moved = true; turn = other(X); break }
    }
    if (!moved) return { moves: log, final: null, nodeMap, links }
  }
  return { moves: log, final: null, nodeMap, links }
}

/** Every node of the side that is actually true must be true in the solution. */
export function checkColouring(nodeMap: Map<string, DragonNode>, sol: Board): string | null {
  const nodes = Array.from(nodeMap.values())
  const primA = nodes.find((n) => n.color === 'blue')!
  const trueSide: Side = sol[primA.row][primA.col] === primA.digit ? 'A' : 'B'
  for (const n of nodes) {
    if (isPrimary(n.color)) {
      const t = sol[n.row][n.col] === n.digit
      if (t !== (sideOf(n.color) === trueSide)) return `primary ${nm(n)} ${n.color} wrong (true side ${trueSide})`
    } else if (sideOf(n.color) === trueSide && sol[n.row][n.col] !== n.digit) return `secondary ${nm(n)} ${n.color} of true side is false`
  }
  return null
}

export function checkMoves(moves: DragonMove[], sol: Board): string | null {
  for (const m of moves) {
    for (const e of m.eliminated) if (sol[e.row][e.col] === e.digit) return `eliminated true ${nm(e)}`
    for (const s of m.solved) if (sol[s.row][s.col] !== s.digit) return `solved wrong ${nm(s)}`
  }
  return null
}
