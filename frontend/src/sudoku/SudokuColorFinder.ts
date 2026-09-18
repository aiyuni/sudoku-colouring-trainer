import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'
import { sudokuUnits, type Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export type ChainColor = 'blue' | 'yellow'

export interface ColoredCell {
  row: number
  col: number
  color: ChainColor
}

export interface ColoringChain {
  digit: number
  cells: ColoredCell[]
}

export interface Rule1Instance {
  digit: number
  chain: ColoringChain
  falseColor: ChainColor
  trueColor: ChainColor
  solvedCells: Cell[]
}

export interface Rule2Instance {
  digit: number
  chain: ColoringChain
  eliminatedCells: Cell[]
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`
}

function sameUnit(a: Cell, b: Cell): boolean {
  const [ar, ac] = a
  const [br, bc] = b
  if (ar === br || ac === bc) {
    return true
  }
  return Math.floor(ar / BOX_SIZE) === Math.floor(br / BOX_SIZE) && Math.floor(ac / BOX_SIZE) === Math.floor(bc / BOX_SIZE)
}

/**
 * Simple Coloring: for one digit, builds the graph of strong links
 * (conjugate pairs) between its candidate cells, splits it into connected
 * chains, and 2-colors each chain - adjacent cells always take opposite
 * colors, since a strong link between two candidate cells in a unit is a
 * biconditional (the unit needs the digit placed somewhere, and only these
 * two cells can hold it, so exactly one of them is true).
 */
export class SudokuColorFinder {
  findChains(board: Board, candidates: CandidateGrid, digit: number): ColoringChain[] {
    const adjacency = new Map<string, Cell[]>()
    const cellByKey = new Map<string, Cell>()
    const edgeKeys = new Set<string>()

    const addEdge = (a: Cell, b: Cell) => {
      const ka = cellKey(a[0], a[1])
      const kb = cellKey(b[0], b[1])
      const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      if (edgeKeys.has(edgeKey)) {
        return
      }
      edgeKeys.add(edgeKey)

      cellByKey.set(ka, a)
      cellByKey.set(kb, b)
      if (!adjacency.has(ka)) {
        adjacency.set(ka, [])
      }
      if (!adjacency.has(kb)) {
        adjacency.set(kb, [])
      }
      adjacency.get(ka)!.push(b)
      adjacency.get(kb)!.push(a)
    }

    for (const unit of sudokuUnits()) {
      const withCandidate = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1])
      if (withCandidate.length === 2) {
        addEdge(withCandidate[0], withCandidate[1])
      }
    }

    const visited = new Set<string>()
    const chains: ColoringChain[] = []

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

      while (queue.length > 0) {
        const currentKey = queue.shift()!
        const currentColor = colorMap.get(currentKey)!
        const nextColor: ChainColor = currentColor === 'blue' ? 'yellow' : 'blue'

        for (const neighbor of adjacency.get(currentKey) ?? []) {
          const neighborKey = cellKey(neighbor[0], neighbor[1])
          if (!colorMap.has(neighborKey)) {
            colorMap.set(neighborKey, nextColor)
            visited.add(neighborKey)
            componentKeys.push(neighborKey)
            queue.push(neighborKey)
          } else if (colorMap.get(neighborKey) !== nextColor) {
            // An odd cycle - this digit's strong links can't be consistently
            // 2-colored, so simple coloring doesn't apply to this chain.
            consistent = false
          }
        }
      }

      if (!consistent || componentKeys.length < 2) {
        continue
      }

      const cells: ColoredCell[] = componentKeys.map((key) => {
        const [row, col] = cellByKey.get(key)!
        return { row, col, color: colorMap.get(key)! }
      })

      chains.push({ digit, cells })
    }

    return chains
  }

  /** Rule 1: two same-colored cells sharing a unit means that color can't be
   * true everywhere (the digit would repeat in that unit), so it's false
   * throughout the chain and the other color is true throughout. */
  findRule1(chain: ColoringChain): Rule1Instance | null {
    for (const color of ['blue', 'yellow'] as const) {
      const cellsOfColor = chain.cells.filter((c) => c.color === color)
      const hasConflict = cellsOfColor.some((cellA, i) =>
        cellsOfColor
          .slice(i + 1)
          .some((cellB) => sameUnit([cellA.row, cellA.col], [cellB.row, cellB.col])),
      )
      if (hasConflict) {
        const trueColor: ChainColor = color === 'blue' ? 'yellow' : 'blue'
        return {
          digit: chain.digit,
          chain,
          falseColor: color,
          trueColor,
          solvedCells: chain.cells
            .filter((c) => c.color === trueColor)
            .map((c): Cell => [c.row, c.col]),
        }
      }
    }
    return null
  }

  /** Rule 2: an uncolored cell that can see a cell of both colors can't be
   * the digit either way - whichever color turns out true, it's eliminated
   * by a cell it shares a unit with. */
  findRule2(chain: ColoringChain, board: Board, candidates: CandidateGrid): Rule2Instance | null {
    const digit = chain.digit
    const chainKeys = new Set(chain.cells.map((c) => cellKey(c.row, c.col)))
    const blueCells = chain.cells.filter((c) => c.color === 'blue')
    const yellowCells = chain.cells.filter((c) => c.color === 'yellow')

    const eliminated: Cell[] = []
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== 0 || !candidates[row][col][digit - 1]) {
          continue
        }
        if (chainKeys.has(cellKey(row, col))) {
          continue
        }
        const seesBlue = blueCells.some((b) => sameUnit([row, col], [b.row, b.col]))
        const seesYellow = yellowCells.some((y) => sameUnit([row, col], [y.row, y.col]))
        if (seesBlue && seesYellow) {
          eliminated.push([row, col])
        }
      }
    }

    return eliminated.length > 0 ? { digit, chain, eliminatedCells: eliminated } : null
  }
}
