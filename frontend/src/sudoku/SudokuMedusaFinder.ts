import { markedCandidateDigits } from './boardUtils'
import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import { sudokuUnits, type Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export type ChainColor = 'blue' | 'yellow'

export interface ColoredCandidate {
  row: number
  col: number
  digit: number
  color: ChainColor
}

export interface MedusaChain {
  candidates: ColoredCandidate[]
  /** Whether this chain's strong-link graph includes at least one bivalue
   * cell edge (two candidates sharing a cell), as opposed to being built
   * entirely from bilocal edges (a digit conjugate pair within a unit).
   * A chain spanning more than one cell always needs a bilocal edge to
   * cross cells, so a chain with none is a pure conjugate-pair network -
   * this flags the ones that actually use a bivalue cell as a link. */
  hasBivalueCellLink: boolean
}

export type MassConflict =
  | { kind: 'cell'; color: ChainColor; row: number; col: number; digitA: number; digitB: number }
  | { kind: 'unit'; color: ChainColor; digit: number; a: Cell; b: Cell }
  | { kind: 'emptied'; color: ChainColor; row: number; col: number; digits: number[] }

export interface MassEliminationInstance {
  chain: MedusaChain
  conflict: MassConflict
  falseColor: ChainColor
  trueColor: ChainColor
  /** Every trueColor candidate becomes the solution for its cell. */
  solvedCells: ColoredCandidate[]
  /** Every falseColor candidate is proven impossible. */
  eliminatedCandidates: ColoredCandidate[]
}

export interface Rule3Instance {
  chain: MedusaChain
  row: number
  col: number
  digit: number
  blueSeen: Cell
  yellowSeen: Cell
}

export interface Rule4Instance {
  chain: MedusaChain
  row: number
  col: number
  coloredCandidates: ColoredCandidate[]
  eliminatedDigits: number[]
}

export interface Rule5Instance {
  chain: MedusaChain
  row: number
  col: number
  coloredDigit: number
  coloredColor: ChainColor
  eliminatedDigit: number
  opponent: Cell
}

function candidateKey(row: number, col: number, digit: number): string {
  return `${row},${col},${digit}`
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`
}

function sameUnit(a: readonly [number, number], b: readonly [number, number]): boolean {
  const [ar, ac] = a
  const [br, bc] = b
  if (ar === br || ac === bc) {
    return true
  }
  return Math.floor(ar / BOX_SIZE) === Math.floor(br / BOX_SIZE) && Math.floor(ac / BOX_SIZE) === Math.floor(bc / BOX_SIZE)
}

function opposite(color: ChainColor): ChainColor {
  return color === 'blue' ? 'yellow' : 'blue'
}

/**
 * 3D Medusa: Simple Coloring extended across every digit at once. Its
 * strong-link graph has one node per (cell, digit) candidate and two kinds
 * of edge - a conjugate pair, exactly as Simple Coloring uses (a digit is a
 * candidate of only two cells in some unit, so it's true in one of them),
 * and a bivalue cell's own two candidates (a cell with only two candidates
 * left must hold one of them, so they're never both true or both false).
 * Chasing both kinds of edge across the whole board links up candidates of
 * different digits into a single chain, which is what lets Medusa's rules
 * reach conclusions Simple Coloring's single-digit chains can't.
 */
export interface StrongLinkGraph {
  adjacency: Map<string, string[]>
  nodeByKey: Map<string, { row: number; col: number; digit: number }>
  bivalueEdgeKeys: Set<string>
}

export class SudokuMedusaFinder {
  /** Builds the strong-link graph shared by findChains and growChainFrom:
   * one node per (cell, digit) candidate, with a bilocal edge for every
   * digit conjugate pair and a bivalue edge for every two-candidate cell.
   * Public so a caller making several growChainFromGraph calls against the
   * same board/candidates (e.g. one per promotion within a single Dragon
   * Colouring extension) can build it once and reuse it, rather than
   * paying this O(board) cost again for every single call. */
  buildStrongLinkGraph(board: Board, candidates: CandidateGrid): StrongLinkGraph {
    const adjacency = new Map<string, string[]>()
    const nodeByKey = new Map<string, { row: number; col: number; digit: number }>()
    const edgeKeys = new Set<string>()
    const bivalueEdgeKeys = new Set<string>()

    const addEdge = (
      aKey: string,
      a: { row: number; col: number; digit: number },
      bKey: string,
      b: { row: number; col: number; digit: number },
      kind: 'bilocal' | 'bivalue',
    ) => {
      const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
      if (edgeKeys.has(edgeKey)) {
        return
      }
      edgeKeys.add(edgeKey)
      if (kind === 'bivalue') {
        bivalueEdgeKeys.add(edgeKey)
      }

      nodeByKey.set(aKey, a)
      nodeByKey.set(bKey, b)
      if (!adjacency.has(aKey)) {
        adjacency.set(aKey, [])
      }
      if (!adjacency.has(bKey)) {
        adjacency.set(bKey, [])
      }
      adjacency.get(aKey)!.push(bKey)
      adjacency.get(bKey)!.push(aKey)
    }

    for (let digit = 1; digit <= 9; digit++) {
      for (const unit of sudokuUnits()) {
        const withCandidate = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1])
        if (withCandidate.length === 2) {
          const [[r1, c1], [r2, c2]] = withCandidate
          addEdge(
            candidateKey(r1, c1, digit),
            { row: r1, col: c1, digit },
            candidateKey(r2, c2, digit),
            { row: r2, col: c2, digit },
            'bilocal',
          )
        }
      }
    }

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        const digits = markedCandidateDigits(candidates[row][col])
        if (digits.length === 2) {
          const [d1, d2] = digits
          addEdge(
            candidateKey(row, col, d1),
            { row, col, digit: d1 },
            candidateKey(row, col, d2),
            { row, col, digit: d2 },
            'bivalue',
          )
        }
      }
    }

    return { adjacency, nodeByKey, bivalueEdgeKeys }
  }

  /** Convenience one-shot form of growChainFromGraph for a single call -
   * builds the graph itself, at the cost of rebuilding it from scratch
   * every time. A caller making more than one call against the same
   * board/candidates (see buildStrongLinkGraph) should build the graph
   * once and use growChainFromGraph directly instead. */
  growChainFrom(
    board: Board,
    candidates: CandidateGrid,
    start: { row: number; col: number; digit: number },
    startColor: ChainColor,
    known: ReadonlySet<string>,
  ): { added: ColoredCandidate[]; hasBivalueCellLink: boolean } {
    return this.growChainFromGraph(this.buildStrongLinkGraph(board, candidates), start, startColor, known)
  }

  /** Re-runs the same strong-link propagation findChains uses, but seeded
   * from one already-known-true candidate (e.g. one Dragon Colouring just
   * promoted to its primary Medusa colour) instead of picking an arbitrary
   * starting point - so a promotion can discover genuinely new Medusa
   * candidates it just made reachable, without re-deriving every chain on
   * the board from scratch. `known` is the set of "row,col,digit" keys
   * already accounted for (already coloured, by any means) - traversal
   * stops at an already-known node rather than trying to recolour it, so a
   * node whose Dragon-derived colour happens to disagree with what strong-
   * link propagation would assign here is left alone rather than
   * overridden or flagged; that disagreement would only matter for a
   * contradiction this method isn't responsible for finding. */
  growChainFromGraph(
    graph: StrongLinkGraph,
    start: { row: number; col: number; digit: number },
    startColor: ChainColor,
    known: ReadonlySet<string>,
  ): { added: ColoredCandidate[]; hasBivalueCellLink: boolean } {
    const { adjacency, nodeByKey, bivalueEdgeKeys } = graph
    const startKey = candidateKey(start.row, start.col, start.digit)
    const added: ColoredCandidate[] = []
    if (!adjacency.has(startKey)) {
      return { added, hasBivalueCellLink: false }
    }

    const colorMap = new Map<string, ChainColor>([[startKey, startColor]])
    const visited = new Set<string>([startKey])
    const queue = [startKey]
    let hasBivalueCellLink = false

    while (queue.length > 0) {
      const currentKey = queue.shift()!
      const currentColor = colorMap.get(currentKey)!
      const nextColor = opposite(currentColor)

      for (const neighborKey of adjacency.get(currentKey) ?? []) {
        const edgeKey = currentKey < neighborKey ? `${currentKey}|${neighborKey}` : `${neighborKey}|${currentKey}`
        if (bivalueEdgeKeys.has(edgeKey)) {
          hasBivalueCellLink = true
        }
        if (visited.has(neighborKey)) {
          continue
        }
        visited.add(neighborKey)
        colorMap.set(neighborKey, nextColor)
        queue.push(neighborKey)
        if (!known.has(neighborKey)) {
          added.push({ ...nodeByKey.get(neighborKey)!, color: nextColor })
        }
      }
    }

    return { added, hasBivalueCellLink }
  }

  findChains(board: Board, candidates: CandidateGrid): MedusaChain[] {
    const { adjacency, nodeByKey, bivalueEdgeKeys } = this.buildStrongLinkGraph(board, candidates)

    const visited = new Set<string>()
    const chains: MedusaChain[] = []

    for (const startKey of adjacency.keys()) {
      if (visited.has(startKey)) {
        continue
      }

      const colorMap = new Map<string, ChainColor>()
      const componentKeys: string[] = [startKey]
      const queue: string[] = [startKey]
      colorMap.set(startKey, 'blue')
      visited.add(startKey)
      let consistent = true
      let hasBivalueCellLink = false

      while (queue.length > 0) {
        const currentKey = queue.shift()!
        const currentColor = colorMap.get(currentKey)!
        const nextColor = opposite(currentColor)

        for (const neighborKey of adjacency.get(currentKey) ?? []) {
          const edgeKey = currentKey < neighborKey ? `${currentKey}|${neighborKey}` : `${neighborKey}|${currentKey}`
          if (bivalueEdgeKeys.has(edgeKey)) {
            hasBivalueCellLink = true
          }
          if (!colorMap.has(neighborKey)) {
            colorMap.set(neighborKey, nextColor)
            visited.add(neighborKey)
            componentKeys.push(neighborKey)
            queue.push(neighborKey)
          } else if (colorMap.get(neighborKey) !== nextColor) {
            // An odd cycle - this chain can't be consistently 2-colored.
            consistent = false
          }
        }
      }

      if (!consistent || componentKeys.length < 2) {
        continue
      }

      const candidatesList: ColoredCandidate[] = componentKeys.map((key) => {
        const node = nodeByKey.get(key)!
        return { ...node, color: colorMap.get(key)! }
      })

      chains.push({ candidates: candidatesList, hasBivalueCellLink })
    }

    return chains
  }

  /**
   * Mass eliminations (rules 1-2): a single contradiction that pins down
   * which color must be false for the WHOLE chain, so every candidate of
   * the other color becomes the solution for its cell.
   */
  findMassElimination(chain: MedusaChain, board: Board, candidates: CandidateGrid): MassEliminationInstance | null {
    const byCell = new Map<string, ColoredCandidate[]>()
    for (const node of chain.candidates) {
      const key = cellKey(node.row, node.col)
      const list = byCell.get(key) ?? []
      list.push(node)
      byCell.set(key, list)
    }

    // Rule 1, same-cell case: two colored candidates of the same colour in
    // one cell - a cell can only hold one digit, so that colour is false.
    for (const nodes of byCell.values()) {
      if (nodes.length < 2) {
        continue
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (nodes[i].color === nodes[j].color) {
            return this.buildMassInstance(chain, {
              kind: 'cell',
              color: nodes[i].color,
              row: nodes[i].row,
              col: nodes[i].col,
              digitA: nodes[i].digit,
              digitB: nodes[j].digit,
            })
          }
        }
      }
    }

    // Rule 1, same-unit case: two colored candidates of the same digit and
    // colour sharing a unit - just like Simple Coloring's own Rule 1.
    for (const color of ['blue', 'yellow'] as const) {
      const nodesOfColor = chain.candidates.filter((n) => n.color === color)
      for (let i = 0; i < nodesOfColor.length; i++) {
        for (let j = i + 1; j < nodesOfColor.length; j++) {
          const a = nodesOfColor[i]
          const b = nodesOfColor[j]
          if (a.digit === b.digit && sameUnit([a.row, a.col], [b.row, b.col])) {
            return this.buildMassInstance(chain, {
              kind: 'unit',
              color,
              digit: a.digit,
              a: [a.row, a.col],
              b: [b.row, b.col],
            })
          }
        }
      }
    }

    // Rule 2: an uncolored cell whose every remaining candidate sees a
    // colored candidate of the same digit and the same colour - if that
    // colour were true, this cell would be left with no candidate at all.
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        const digits = markedCandidateDigits(candidates[row][col])
        if (digits.length === 0 || byCell.has(cellKey(row, col))) {
          continue
        }

        for (const color of ['blue', 'yellow'] as const) {
          const seesColorForEveryDigit = digits.every((digit) =>
            chain.candidates.some(
              (n) => n.color === color && n.digit === digit && sameUnit([row, col], [n.row, n.col]),
            ),
          )
          if (seesColorForEveryDigit) {
            return this.buildMassInstance(chain, { kind: 'emptied', color, row, col, digits })
          }
        }
      }
    }

    return null
  }

  private buildMassInstance(chain: MedusaChain, conflict: MassConflict): MassEliminationInstance {
    const falseColor = conflict.color
    const trueColor = opposite(falseColor)
    return {
      chain,
      conflict,
      falseColor,
      trueColor,
      solvedCells: chain.candidates.filter((n) => n.color === trueColor),
      eliminatedCandidates: chain.candidates.filter((n) => n.color === falseColor),
    }
  }

  /** Rule 3: a candidate that isn't itself part of the chain, but sees both
   * colours of the same digit - whichever colour turns out true, one of
   * those two sightings eliminates it. */
  findRule3Eliminations(chain: MedusaChain, board: Board, candidates: CandidateGrid): Rule3Instance[] {
    const coloredKeys = new Set(chain.candidates.map((n) => candidateKey(n.row, n.col, n.digit)))
    const byColorDigit = new Map<string, ColoredCandidate[]>()
    for (const node of chain.candidates) {
      const key = `${node.color}:${node.digit}`
      const list = byColorDigit.get(key) ?? []
      list.push(node)
      byColorDigit.set(key, list)
    }

    const results: Rule3Instance[] = []
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0) {
          continue
        }
        for (const digit of markedCandidateDigits(candidates[row][col])) {
          if (coloredKeys.has(candidateKey(row, col, digit))) {
            continue
          }
          const blueNode = (byColorDigit.get(`blue:${digit}`) ?? []).find((n) =>
            sameUnit([row, col], [n.row, n.col]),
          )
          const yellowNode = (byColorDigit.get(`yellow:${digit}`) ?? []).find((n) =>
            sameUnit([row, col], [n.row, n.col]),
          )
          if (blueNode && yellowNode) {
            results.push({
              chain,
              row,
              col,
              digit,
              blueSeen: [blueNode.row, blueNode.col],
              yellowSeen: [yellowNode.row, yellowNode.col],
            })
          }
        }
      }
    }
    return results
  }

  /** Rule 4: a cell with a colored candidate of each colour - one of those
   * two colours must be true, so whichever digit lands there, it's one of
   * those two, and every other candidate in the cell is eliminated. */
  findRule4Eliminations(chain: MedusaChain, candidates: CandidateGrid): Rule4Instance[] {
    const byCell = new Map<string, ColoredCandidate[]>()
    for (const node of chain.candidates) {
      const key = cellKey(node.row, node.col)
      const list = byCell.get(key) ?? []
      list.push(node)
      byCell.set(key, list)
    }

    const results: Rule4Instance[] = []
    for (const [key, nodes] of byCell) {
      const hasBlue = nodes.some((n) => n.color === 'blue')
      const hasYellow = nodes.some((n) => n.color === 'yellow')
      if (!hasBlue || !hasYellow) {
        continue
      }
      const [row, col] = key.split(',').map(Number)
      const coloredDigits = new Set(nodes.map((n) => n.digit))
      const eliminatedDigits = markedCandidateDigits(candidates[row][col]).filter(
        (digit) => !coloredDigits.has(digit),
      )
      if (eliminatedDigits.length > 0) {
        results.push({ chain, row, col, coloredCandidates: nodes, eliminatedDigits })
      }
    }
    return results
  }

  /** Rule 5: a cell with exactly one colored candidate - if one of its
   * other, uncolored candidates has the same digit colored the opposite
   * colour somewhere else it can see, that candidate can't survive either
   * colour turning out true, so it's eliminated. */
  findRule5Eliminations(chain: MedusaChain, candidates: CandidateGrid): Rule5Instance[] {
    const byCell = new Map<string, ColoredCandidate[]>()
    for (const node of chain.candidates) {
      const key = cellKey(node.row, node.col)
      const list = byCell.get(key) ?? []
      list.push(node)
      byCell.set(key, list)
    }
    const byColorDigit = new Map<string, ColoredCandidate[]>()
    for (const node of chain.candidates) {
      const key = `${node.color}:${node.digit}`
      const list = byColorDigit.get(key) ?? []
      list.push(node)
      byColorDigit.set(key, list)
    }

    const results: Rule5Instance[] = []
    for (const [key, nodes] of byCell) {
      if (nodes.length !== 1) {
        continue
      }
      const [row, col] = key.split(',').map(Number)
      const coloredNode = nodes[0]
      const otherColor = opposite(coloredNode.color)

      for (const digit of markedCandidateDigits(candidates[row][col])) {
        if (digit === coloredNode.digit) {
          continue
        }
        const opponent = (byColorDigit.get(`${otherColor}:${digit}`) ?? []).find(
          (n) => !(n.row === row && n.col === col) && sameUnit([row, col], [n.row, n.col]),
        )
        if (opponent) {
          results.push({
            chain,
            row,
            col,
            coloredDigit: coloredNode.digit,
            coloredColor: coloredNode.color,
            eliminatedDigit: digit,
            opponent: [opponent.row, opponent.col],
          })
        }
      }
    }
    return results
  }
}
