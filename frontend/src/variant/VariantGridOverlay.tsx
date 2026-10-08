import type { ReactNode } from 'react'
import type { Cell, SudokuConstraints } from '../sudoku/SudokuConstraints'
import { REGION_TINTS } from '../sudoku/VariantPuzzle'
import type { Board, CandidateGrid } from '../sudoku/types'

/** The grid's drawing space, shared with the strong-link and AIC overlays:
 * 9 cells x 100 units. */
const CELL = 100
/** How far inside its cells a cage's dashed outline runs. */
const CAGE_INSET = 7

const standardBox = (row: number, col: number) => Math.floor(row / 3) * 3 + Math.floor(col / 3)


interface VariantGridOverlayProps {
  constraints: SudokuConstraints
  /** The Jigsaw regions being drawn in the layout editor (shown tinted and
   * numbered, in place of the puzzle's own), or null. */
  regionDraft: number[][] | null
  /** Cells picked for a new cage in the layout editor ("row,col" keys). */
  selectedCells: ReadonlySet<string>
  /** The cell the cursor is on, or null. On an Anti-Knight puzzle the cells
   * a knight's move from it are marked: unlike a row or a box, nothing on
   * the grid shows which they are. */
  focusCell: { row: number; col: number } | null
  /** Settings -> "Entropy: colour cells by group", on an Entropy puzzle: the
   * grid to read each cell's possible groups from. Null = not drawn. */
  entropyGroups: { board: Board; candidates: CandidateGrid } | null
}

/** The Entropy groups a cell can still hold, as bits (1 = low 1-3, 2 =
 * middle 4-6, 4 = high 7-9): its digit's group, or its pencil marks'. A
 * cell with no marks says nothing, so it is 0 like a cell with no group. */
function entropyGroupMask(board: Board, candidates: CandidateGrid, row: number, col: number): number {
  const digit = board[row][col]
  if (digit !== 0) {
    return 1 << Math.floor((digit - 1) / 3)
  }
  let mask = 0
  for (let index = 0; index < 9; index++) {
    if (candidates[row][col][index]) {
      mask |= 1 << Math.floor(index / 3)
    }
  }
  return mask
}

const ENTROPY_GROUP_CLASSES = ['entropy-low', 'entropy-middle', 'entropy-high']

const KNIGHT_MOVES: ReadonlyArray<readonly [number, number]> = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
]

/** One side of a cage's outline along cell (row, col): where it starts and
 * ends depends on what the cage does at each corner - it turns away (convex:
 * stop short by the inset), runs straight on into the next cell (stop at the
 * cell's edge), or turns back around a neighbour (concave: run on by the
 * inset to meet the outline coming the other way). */
function cageSegments(cells: readonly Cell[]): Array<[number, number, number, number]> {
  const inCage = new Set(cells.map(([row, col]) => row * 9 + col))
  const has = (row: number, col: number) => row >= 0 && row < 9 && col >= 0 && col < 9 && inCage.has(row * 9 + col)
  const segments: Array<[number, number, number, number]> = []
  // How far an outline end is pulled back from (+) or pushed past (-) the
  // cell's own corner. `along` is the neighbour in the outline's direction,
  // `diagonal` the cell beyond it on the outside.
  const reach = (along: boolean, diagonal: boolean) => (!along ? CAGE_INSET : diagonal ? -CAGE_INSET : 0)
  for (const [row, col] of cells) {
    const x0 = col * CELL
    const y0 = row * CELL
    const x1 = x0 + CELL
    const y1 = y0 + CELL
    if (!has(row - 1, col)) {
      const y = y0 + CAGE_INSET
      segments.push([x0 + reach(has(row, col - 1), has(row - 1, col - 1)), y, x1 - reach(has(row, col + 1), has(row - 1, col + 1)), y])
    }
    if (!has(row + 1, col)) {
      const y = y1 - CAGE_INSET
      segments.push([x0 + reach(has(row, col - 1), has(row + 1, col - 1)), y, x1 - reach(has(row, col + 1), has(row + 1, col + 1)), y])
    }
    if (!has(row, col - 1)) {
      const x = x0 + CAGE_INSET
      segments.push([x, y0 + reach(has(row - 1, col), has(row - 1, col - 1)), x, y1 - reach(has(row + 1, col), has(row + 1, col - 1))])
    }
    if (!has(row, col + 1)) {
      const x = x1 - CAGE_INSET
      segments.push([x, y0 + reach(has(row - 1, col), has(row - 1, col + 1)), x, y1 - reach(has(row + 1, col), has(row + 1, col + 1))])
    }
  }
  return segments
}

/**
 * What a variant adds to the board, drawn over the ordinary grid (which
 * stays exactly the Classic one underneath): a Jigsaw's region borders, a
 * Killer's cages - dashed outlines with the sum in the corner of each
 * cage's first cell - an X-Sudoku's two diagonals (a tint on their cells),
 * on an Anti-Knight puzzle a small knight mark on the cells a knight's
 * move from the cursor, and on an Entropy puzzle (only with its setting on)
 * a tint on the cells down to one or two of the low / middle / high groups. Pointer events pass through to the cells.
 */
export function VariantGridOverlay({ constraints, regionDraft, selectedCells, focusCell, entropyGroups }: VariantGridOverlayProps) {
  const regions = regionDraft ?? constraints.regions
  const regionOf = (row: number, col: number) => (regions ? regions[row][col] : standardBox(row, col))
  const marks: ReactNode[] = []

  if (constraints.diagonals && !regionDraft) {
    for (let i = 0; i < 9; i++) {
      // The centre cell is on both; one tint is enough.
      for (const col of i === 4 ? [4] : [i, 8 - i]) {
        marks.push(<rect key={`diagonal-${i}-${col}`} className="diagonal-tint" x={col * CELL} y={i * CELL} width={CELL} height={CELL} />)
      }
    }
  }

  if (entropyGroups && !regionDraft) {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const mask = entropyGroupMask(entropyGroups.board, entropyGroups.candidates, row, col)
        const groups = [0, 1, 2].filter((group) => mask & (1 << group))
        const x = col * CELL
        const y = row * CELL
        if (groups.length === 1) {
          marks.push(<rect key={`entropy-${row}-${col}`} className={`entropy-tint ${ENTROPY_GROUP_CLASSES[groups[0]]}`} x={x} y={y} width={CELL} height={CELL} />)
        } else if (groups.length === 2) {
          // Either of two groups: the cell is split along its diagonal, the
          // lower group top-left - the way solvers colour such a cell by hand.
          marks.push(
            <polygon key={`entropy-${row}-${col}-a`} className={`entropy-tint ${ENTROPY_GROUP_CLASSES[groups[0]]}`} points={`${x},${y} ${x + CELL},${y} ${x},${y + CELL}`} />,
            <polygon key={`entropy-${row}-${col}-b`} className={`entropy-tint ${ENTROPY_GROUP_CLASSES[groups[1]]}`} points={`${x + CELL},${y} ${x + CELL},${y + CELL} ${x},${y + CELL}`} />,
          )
        }
      }
    }
  }

  if (constraints.antiKnight && focusCell && !regionDraft) {
    for (const [dr, dc] of KNIGHT_MOVES) {
      const row = focusCell.row + dr
      const col = focusCell.col + dc
      if (row < 0 || row > 8 || col < 0 || col > 8) {
        continue
      }
      marks.push(
        <text key={`knight-${row}-${col}`} className="knight-mark" x={col * CELL + CELL - 6} y={row * CELL + CELL - 8}>
          ♞
        </text>,
      )
    }
  }

  if (regionDraft) {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const region = regionDraft[row][col]
        // Not drawn into a region yet: left as plain grid.
        if (region < 0) {
          continue
        }
        marks.push(
          <rect key={`tint-${row}-${col}`} className="region-draft-tint" x={col * CELL} y={row * CELL} width={CELL} height={CELL} fill={REGION_TINTS[region]} />,
          <text key={`label-${row}-${col}`} className="region-draft-label" x={col * CELL + CELL / 2} y={row * CELL + CELL / 2 + 22}>
            {region + 1}
          </text>,
        )
      }
    }
  }

  // Region borders: only a Jigsaw (or a draft) needs them drawn - the 3x3
  // boxes' thick lines are the grid's own.
  if (regions) {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (col < 8 && regionOf(row, col) !== regionOf(row, col + 1)) {
          const x = (col + 1) * CELL
          marks.push(<line key={`rv-${row}-${col}`} className="region-border" x1={x} y1={row * CELL} x2={x} y2={(row + 1) * CELL} />)
        }
        if (row < 8 && regionOf(row, col) !== regionOf(row + 1, col)) {
          const y = (row + 1) * CELL
          marks.push(<line key={`rh-${row}-${col}`} className="region-border" x1={col * CELL} y1={y} x2={(col + 1) * CELL} y2={y} />)
        }
      }
    }
  }

  for (const key of selectedCells) {
    const [row, col] = key.split(',').map(Number)
    marks.push(<rect key={`pick-${key}`} className="cage-pick" x={col * CELL + 4} y={row * CELL + 4} width={CELL - 8} height={CELL - 8} rx={8} />)
  }

  constraints.cages.forEach((cage, index) => {
    cageSegments(cage.cells).forEach(([x1, y1, x2, y2], segment) => {
      marks.push(<line key={`cage-${index}-${segment}`} className="cage-line" x1={x1} y1={y1} x2={x2} y2={y2} />)
    })
    const [row, col] = cage.cells[0]
    const label = String(cage.sum)
    // The sum sits in the band the Killer grid keeps clear above the pencil
    // marks (PIP_TOP_INSET in aicLinkLayout.ts, --pip-top in App.css).
    const x = col * CELL + CAGE_INSET + 2
    const y = row * CELL + 2
    marks.push(
      // A patch of the cell's own colour behind the sum, so the dashed
      // outline doesn't run through the digits.
      <rect key={`sum-bg-${index}`} className="cage-sum-bg" x={x - 2} y={y} width={label.length * 10 + 5} height={19} />,
      <text key={`sum-${index}`} className="cage-sum" x={x} y={y + 15}>
        {label}
      </text>,
    )
  })

  if (marks.length === 0) {
    return null
  }
  return (
    <svg className="variant-layer" viewBox="0 0 900 900" aria-hidden="true">
      {marks}
    </svg>
  )
}
