import { useMemo, useState, type KeyboardEvent } from 'react'
import {
  cloneBoard,
  cloneCandidates,
  computeGivenMask,
  createEmptyBoard,
  createEmptyCandidates,
  markedCandidateDigits,
} from './sudoku/boardUtils'
import { PuzzleImporter } from './sudoku/PuzzleImporter'
import { SudokuColorFinder } from './sudoku/SudokuColorFinder'
import { SudokuGenerator } from './sudoku/SudokuGenerator'
import { SudokuMedusaFinder } from './sudoku/SudokuMedusaFinder'
import { SudokuPairFinder } from './sudoku/SudokuPairFinder'
import { SudokuRules } from './sudoku/SudokuRules'
import { SudokuSingleFinder, type SingleAssignment } from './sudoku/SudokuSingleFinder'
import { SudokuSolver } from './sudoku/SudokuSolver'
import { SAMPLE_PUZZLE, type Board, type CandidateGrid } from './sudoku/types'
import './App.css'

const solver = new SudokuSolver()
const generator = new SudokuGenerator()
const importer = new PuzzleImporter()
const singleFinder = new SudokuSingleFinder()
const pairFinder = new SudokuPairFinder()
const colorFinder = new SudokuColorFinder()
const medusaFinder = new SudokuMedusaFinder()

// A 3x3 grid of 3x3 boxes; reused for both the box index and the cell
// index within a box, since both range over the same nine values.
const NINE = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/** The board, its locked clues, and pencil marks - the part of the app's
 * state that Undo/Redo travels through. Everything else (selection, the
 * highlighted digit, UI toggles) is view state, not grid state. */
interface GridState {
  board: Board
  givens: boolean[][]
  candidates: CandidateGrid
}

function createInitialGrid(): GridState {
  return {
    board: cloneBoard(SAMPLE_PUZZLE),
    givens: computeGivenMask(SAMPLE_PUZZLE),
    candidates: createEmptyCandidates(),
  }
}

interface StrongLink {
  digit: number
  a: readonly [number, number]
  b: readonly [number, number]
}

const CELL_SIZE = 100
const PIP_SIZE = CELL_SIZE / 3

/** Center of a digit's candidate pip within cell (row, col), in the 0-900
 * board coordinate space the strong-link SVG overlay is drawn in. */
function pipCenter(row: number, col: number, digit: number) {
  const pipRow = Math.floor((digit - 1) / 3)
  const pipCol = (digit - 1) % 3
  return {
    x: col * CELL_SIZE + (pipCol + 0.5) * PIP_SIZE,
    y: row * CELL_SIZE + (pipRow + 0.5) * PIP_SIZE,
  }
}

/** Cell groups (units) a strong link can form within: each row, column, and box. */
function unitCells(unitIndex: number, kind: 'row' | 'column' | 'box'): Array<readonly [number, number]> {
  if (kind === 'row') {
    return NINE.map((c) => [unitIndex, c] as const)
  }
  if (kind === 'column') {
    return NINE.map((r) => [r, unitIndex] as const)
  }
  const boxRow = Math.floor(unitIndex / 3) * 3
  const boxCol = (unitIndex % 3) * 3
  const cells: Array<readonly [number, number]> = []
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      cells.push([boxRow + dr, boxCol + dc])
    }
  }
  return cells
}

/**
 * Conjugate pairs: for a digit, a strong link joins the two cells of a unit
 * (row/column/box) when that digit is a candidate in exactly two of its
 * cells - the digit can't be false in both, since the unit needs it placed
 * somewhere. Pairs shared by two units (e.g. same row and same box) are
 * only reported once.
 */
function findStrongLinks(candidates: CandidateGrid): StrongLink[] {
  const links: StrongLink[] = []
  const seen = new Set<string>()

  for (const digit of DIGITS) {
    for (const kind of ['row', 'column', 'box'] as const) {
      for (const unitIndex of NINE) {
        const withCandidate = unitCells(unitIndex, kind).filter(
          ([r, c]) => candidates[r][c][digit - 1],
        )
        if (withCandidate.length !== 2) {
          continue
        }

        const [a, b] = withCandidate
        const key = `${digit}:${a[0]}${a[1]}-${b[0]}${b[1]}`
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        links.push({ digit, a, b })
      }
    }
  }

  return links
}

interface TechniqueCandidateRef {
  row: number
  col: number
  digit: number
}

/**
 * One instance of a technique currently applicable to the board, ready for
 * the Techniques panel: its notation, and which cells/candidates a click
 * on it should highlight (yellow = the technique's basis, red = what it
 * eliminates, green = the solution it places).
 */
interface TechniqueInstance {
  id: string
  name: string
  notation: string
  usedCells: Array<readonly [number, number]>
  usedCandidates: TechniqueCandidateRef[]
  eliminatedCandidates: TechniqueCandidateRef[]
  solvedCandidates: TechniqueCandidateRef[]
  /** Simple Coloring only: which candidates are which color, for the
   * click-to-highlight view. */
  blueCandidates?: TechniqueCandidateRef[]
  yellowCandidates?: TechniqueCandidateRef[]
}

function cellRef(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

/** Builds the live list of technique instances the current board/candidates
 * support - recomputed from scratch whenever either changes, so it always
 * reflects exactly what's happening on the grid right now.
 * When a new technique is added to the app, add its instances here too, so
 * the Techniques panel stays a complete list of everything implemented. */
function buildTechniqueInstances(board: Board, candidates: CandidateGrid): TechniqueInstance[] {
  const instances: TechniqueInstance[] = []

  for (const { row, col, digit } of singleFinder.findNakedSingles(board, candidates)) {
    instances.push({
      id: `naked-single-${row}-${col}`,
      name: 'Naked Single',
      notation: `${cellRef(row, col)} is ${digit}`,
      usedCells: [[row, col]],
      usedCandidates: [],
      eliminatedCandidates: [],
      solvedCandidates: [{ row, col, digit }],
    })
  }

  const seenHiddenSingles = new Set<string>()
  for (const { row, col, digit } of singleFinder.findHiddenSingles(board, candidates)) {
    const key = `${row},${col},${digit}`
    if (seenHiddenSingles.has(key)) {
      continue
    }
    seenHiddenSingles.add(key)
    instances.push({
      id: `hidden-single-${row}-${col}-${digit}`,
      name: 'Hidden Single',
      notation: `${cellRef(row, col)} is ${digit}`,
      usedCells: [[row, col]],
      usedCandidates: [],
      eliminatedCandidates: [],
      solvedCandidates: [{ row, col, digit }],
    })
  }

  for (const pair of pairFinder.findNakedPairs(board, candidates)) {
    const [[rowA, colA], [rowB, colB]] = pair.cells
    const [digitA, digitB] = pair.digits

    // Group eliminations by cell - a cell might only have had one of the
    // pair's two digits as a candidate, so each cell states exactly which
    // digit(s) it loses rather than assuming both.
    const byCell = new Map<string, { row: number; col: number; digits: number[] }>()
    for (const elimination of pair.eliminations) {
      const key = `${elimination.row},${elimination.col}`
      const entry = byCell.get(key) ?? { row: elimination.row, col: elimination.col, digits: [] }
      entry.digits.push(elimination.digit)
      byCell.set(key, entry)
    }
    const results = Array.from(byCell.values())
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map(({ row, col, digits }) => {
        const sorted = [...digits].sort((a, b) => a - b)
        const value = sorted.length === 1 ? `${sorted[0]}` : `[${sorted.join(',')}]`
        return `${cellRef(row, col)} is not ${value}`
      })

    instances.push({
      id: `naked-pair-${rowA}-${colA}-${rowB}-${colB}`,
      name: 'Naked Pair',
      notation: `${cellRef(rowA, colA)}, ${cellRef(rowB, colB)} => ${results.join(', ')}`,
      usedCells: [
        [rowA, colA],
        [rowB, colB],
      ],
      usedCandidates: [
        { row: rowA, col: colA, digit: digitA },
        { row: rowA, col: colA, digit: digitB },
        { row: rowB, col: colB, digit: digitA },
        { row: rowB, col: colB, digit: digitB },
      ],
      eliminatedCandidates: pair.eliminations,
      solvedCandidates: [],
    })
  }

  // Simple Coloring: two passes so every Rule 1 instance is listed before
  // any Rule 2 instance, even though the underlying scan is per-digit.
  const rule1Instances: TechniqueInstance[] = []
  const rule2Instances: TechniqueInstance[] = []

  for (const digit of DIGITS) {
    for (const chain of colorFinder.findChains(board, candidates, digit)) {
      const chainKey = chain.cells
        .map((c) => `${c.row}.${c.col}.${c.color[0]}`)
        .sort()
        .join('-')
      const usedCells: Array<readonly [number, number]> = chain.cells.map((c) => [c.row, c.col])
      const blueCandidates = chain.cells
        .filter((c) => c.color === 'blue')
        .map((c) => ({ row: c.row, col: c.col, digit }))
      const yellowCandidates = chain.cells
        .filter((c) => c.color === 'yellow')
        .map((c) => ({ row: c.row, col: c.col, digit }))

      const rule1 = colorFinder.findRule1(chain)
      if (rule1) {
        rule1Instances.push({
          id: `simple-color-rule1-${digit}-${chainKey}`,
          name: `Simple Colouring Rule 1 (${digit})`,
          notation: `Light ${rule1.falseColor} is false, so light ${rule1.trueColor} is true.`,
          usedCells,
          usedCandidates: [],
          eliminatedCandidates: [],
          solvedCandidates: [],
          blueCandidates,
          yellowCandidates,
        })
      }

      const rule2 = colorFinder.findRule2(chain, board, candidates)
      if (rule2) {
        const sortedEliminated = [...rule2.eliminatedCells].sort(
          (a, b) => a[0] - b[0] || a[1] - b[1],
        )
        rule2Instances.push({
          id: `simple-color-rule2-${digit}-${chainKey}`,
          name: `Simple Colouring Rule 2 (${digit})`,
          notation: `${sortedEliminated.map(([row, col]) => cellRef(row, col)).join(', ')} cannot be ${digit}.`,
          usedCells,
          usedCandidates: [],
          eliminatedCandidates: rule2.eliminatedCells.map(([row, col]) => ({ row, col, digit })),
          solvedCandidates: [],
          blueCandidates,
          yellowCandidates,
        })
      }
    }
  }

  instances.push(...rule1Instances, ...rule2Instances)

  // 3D Medusa: massInstances (rules 1-2) before the per-candidate
  // eliminations (rules 3-5), matching the order the user's rules were
  // numbered in. usedCells is left empty throughout - a chain can span most
  // of the board, so outlining every cell in it would be too noisy; the
  // blue/yellow candidate coloring alone marks the chain instead.
  const massInstances: TechniqueInstance[] = []
  const medusaRule3Instances: TechniqueInstance[] = []
  const medusaRule4Instances: TechniqueInstance[] = []
  const medusaRule5Instances: TechniqueInstance[] = []

  for (const chain of medusaFinder.findChains(board, candidates)) {
    const chainKey = chain.candidates
      .map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`)
      .sort()
      .join('-')
    const blueCandidates = chain.candidates
      .filter((c) => c.color === 'blue')
      .map((c) => ({ row: c.row, col: c.col, digit: c.digit }))
    const yellowCandidates = chain.candidates
      .filter((c) => c.color === 'yellow')
      .map((c) => ({ row: c.row, col: c.col, digit: c.digit }))

    const mass = medusaFinder.findMassElimination(chain, board, candidates)
    if (mass) {
      let name: string
      let notation: string
      if (mass.conflict.kind === 'cell') {
        name = '3D Medusa Rule 1'
        notation = `In ${cellRef(mass.conflict.row, mass.conflict.col)}, ${mass.conflict.digitA} and ${mass.conflict.digitB} are both light ${mass.conflict.color}, so light ${mass.conflict.color} is false and light ${mass.trueColor} is true.`
      } else if (mass.conflict.kind === 'unit') {
        name = '3D Medusa Rule 1'
        notation = `${mass.conflict.digit} in ${cellRef(...mass.conflict.a)}, ${cellRef(...mass.conflict.b)} are both light ${mass.conflict.color}, so light ${mass.conflict.color} is false and light ${mass.trueColor} is true.`
      } else {
        name = '3D Medusa Rule 2'
        notation = `${cellRef(mass.conflict.row, mass.conflict.col)} has no coloured candidates, but ${mass.conflict.digits.join(', ')} all see light ${mass.conflict.color}, so light ${mass.conflict.color} is false and light ${mass.trueColor} is true.`
      }
      massInstances.push({
        id: `medusa-mass-${chainKey}`,
        name,
        notation,
        usedCells: [],
        usedCandidates: [],
        eliminatedCandidates: mass.eliminatedCandidates.map((c) => ({ row: c.row, col: c.col, digit: c.digit })),
        solvedCandidates: mass.solvedCells.map((c) => ({ row: c.row, col: c.col, digit: c.digit })),
        blueCandidates,
        yellowCandidates,
      })
    }

    for (const r3 of medusaFinder.findRule3Eliminations(chain, board, candidates)) {
      medusaRule3Instances.push({
        id: `medusa-rule3-${chainKey}-${r3.row}-${r3.col}-${r3.digit}`,
        name: '3D Medusa Rule 3',
        notation: `${cellRef(r3.row, r3.col)} cannot be ${r3.digit} (sees it coloured both ways: ${cellRef(...r3.blueSeen)}, ${cellRef(...r3.yellowSeen)}).`,
        usedCells: [],
        usedCandidates: [],
        eliminatedCandidates: [{ row: r3.row, col: r3.col, digit: r3.digit }],
        solvedCandidates: [],
        blueCandidates,
        yellowCandidates,
      })
    }

    for (const r4 of medusaFinder.findRule4Eliminations(chain, candidates)) {
      const sortedDigits = [...r4.eliminatedDigits].sort((a, b) => a - b)
      const value = sortedDigits.length === 1 ? `${sortedDigits[0]}` : `[${sortedDigits.join(',')}]`
      medusaRule4Instances.push({
        id: `medusa-rule4-${chainKey}-${r4.row}-${r4.col}`,
        name: '3D Medusa Rule 4',
        notation: `${cellRef(r4.row, r4.col)} is not ${value}`,
        usedCells: [],
        usedCandidates: r4.coloredCandidates.map((c) => ({ row: c.row, col: c.col, digit: c.digit })),
        eliminatedCandidates: r4.eliminatedDigits.map((digit) => ({ row: r4.row, col: r4.col, digit })),
        solvedCandidates: [],
        blueCandidates,
        yellowCandidates,
      })
    }

    for (const r5 of medusaFinder.findRule5Eliminations(chain, candidates)) {
      const opponentColor = r5.coloredColor === 'blue' ? 'yellow' : 'blue'
      medusaRule5Instances.push({
        id: `medusa-rule5-${chainKey}-${r5.row}-${r5.col}-${r5.eliminatedDigit}`,
        name: '3D Medusa Rule 5',
        notation: `${cellRef(r5.row, r5.col)} is not ${r5.eliminatedDigit} (sees it light ${opponentColor} at ${cellRef(...r5.opponent)}).`,
        usedCells: [],
        usedCandidates: [{ row: r5.row, col: r5.col, digit: r5.coloredDigit }],
        eliminatedCandidates: [{ row: r5.row, col: r5.col, digit: r5.eliminatedDigit }],
        solvedCandidates: [],
        blueCandidates,
        yellowCandidates,
      })
    }
  }

  instances.push(...massInstances, ...medusaRule3Instances, ...medusaRule4Instances, ...medusaRule5Instances)

  return instances
}

interface TechniquePanelProps {
  instances: TechniqueInstance[]
  activeId: string | null
  onSelect: (id: string) => void
}

/** The panel to the left of the grid listing every technique instance the
 * current candidates support, in Sudoku notation. Clicking a row highlights
 * what it uses/eliminates/solves on the grid; it doesn't change the board. */
function TechniquePanel({ instances, activeId, onSelect }: TechniquePanelProps) {
  return (
    <div className="technique-panel">
      <h2 className="control-label">Techniques</h2>
      {instances.length === 0 ? (
        <p className="technique-empty">
          None currently apply. Try Autofill all, then Naked/Hidden singles or Naked pairs.
        </p>
      ) : (
        <ul className="technique-list">
          {instances.map((instance) => (
            <li key={instance.id}>
              <button
                type="button"
                className={['technique-item', activeId === instance.id ? 'active' : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={activeId === instance.id}
                onClick={() => onSelect(instance.id)}
              >
                <span className="technique-name">{instance.name}</span>
                <span className="technique-notation">{instance.notation}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface DigitPadProps {
  variant: 'solution' | 'candidate' | 'highlight'
  isActive?: (digit: number) => boolean
  isDisabled?: (digit: number) => boolean
  onSelect: (digit: number) => void
}

/** A 3x3 pad of digit buttons, laid out the same way candidates are (1-3
 * top, 4-6 middle, 7-9 bottom) so its position matches the in-cell marks. */
function DigitPad({ variant, isActive, isDisabled, onSelect }: DigitPadProps) {
  return (
    <div className="control-pad">
      {DIGITS.map((digit) => (
        <button
          key={digit}
          type="button"
          className={['pad-button', `${variant}-button`, isActive?.(digit) ? 'active' : '']
            .filter(Boolean)
            .join(' ')}
          disabled={isDisabled?.(digit) ?? false}
          onClick={() => onSelect(digit)}
        >
          {digit}
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const [grid, setGrid] = useState<GridState>(createInitialGrid)
  const [historyEntries, setHistoryEntries] = useState<GridState[]>(() => [createInitialGrid()])
  const [historyIndex, setHistoryIndex] = useState(0)
  const { board, givens, candidates } = grid

  const [selected, setSelected] = useState<{ row: number; col: number } | null>({
    row: 0,
    col: 2,
  })
  const [highlightedDigit, setHighlightedDigit] = useState<number | null>(null)
  const [activeTechniqueId, setActiveTechniqueId] = useState<string | null>(null)
  const [keyboardMode, setKeyboardMode] = useState<'solution' | 'candidate'>('solution')
  const [showStrongLinks, setShowStrongLinks] = useState(false)
  const [showBivalueCells, setShowBivalueCells] = useState(false)
  const [importText, setImportText] = useState('')
  const [solving, setSolving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const busy = solving || generating
  const [status, setStatus] = useState('Enter digits, then click Solve.')

  const filled = useMemo(
    () => board.flat().filter((value) => value !== 0).length,
    [board],
  )

  const hasAnyCandidates = useMemo(
    () => candidates.some((row) => row.some((cell) => cell.some(Boolean))),
    [candidates],
  )

  const strongLinks = useMemo(
    () => (showStrongLinks ? findStrongLinks(candidates) : []),
    [candidates, showStrongLinks],
  )

  const bivalueCells = useMemo(() => {
    const set = new Set<string>()
    if (!showBivalueCells) {
      return set
    }
    for (const r of NINE) {
      for (const c of NINE) {
        if (board[r][c] === 0 && markedCandidateDigits(candidates[r][c]).length === 2) {
          set.add(`${r},${c}`)
        }
      }
    }
    return set
  }, [board, candidates, showBivalueCells])

  const techniqueInstances = useMemo(
    () => buildTechniqueInstances(board, candidates),
    [board, candidates],
  )
  // Looked up by id (rather than kept as its own state) so that if the
  // board changes underneath an active selection, it silently reflects the
  // fresh instance, or disappears if it no longer applies.
  const activeTechnique = techniqueInstances.find((t) => t.id === activeTechniqueId) ?? null

  const selectedIsLocked = selected !== null && givens[selected.row][selected.col]
  const selectedIsSolved = selected !== null && board[selected.row][selected.col] !== 0
  const canUndo = historyIndex > 0
  const canRedo = historyIndex < historyEntries.length - 1

  /** Records one grid change as a single undoable step; anything "in the
   * future" from a prior undo is discarded, same as any other editor. */
  function commitGrid(next: GridState) {
    const truncated = historyEntries.slice(0, historyIndex + 1)
    setGrid(next)
    setHistoryEntries([...truncated, next])
    setHistoryIndex(truncated.length)
  }

  function undo() {
    if (!canUndo) {
      setStatus('Nothing to undo.')
      return
    }
    const nextIndex = historyIndex - 1
    setGrid(historyEntries[nextIndex])
    setHistoryIndex(nextIndex)
    setStatus('Undid last action.')
  }

  function redo() {
    if (!canRedo) {
      setStatus('Nothing to redo.')
      return
    }
    const nextIndex = historyIndex + 1
    setGrid(historyEntries[nextIndex])
    setHistoryIndex(nextIndex)
    setStatus('Redid last action.')
  }

  function setCellValue(row: number, col: number, value: number) {
    if (givens[row][col] || board[row][col] === value) {
      // Puzzle clues are locked; only your own entries can be edited. Same
      // value as already there is a no-op - don't spend an undo step on it.
      return
    }

    const nextBoard = cloneBoard(board)
    nextBoard[row][col] = value
    const nextCandidates = cloneCandidates(candidates)
    // A solved cell doesn't need pencil marks any more.
    nextCandidates[row][col] = Array(9).fill(false)
    // Nor do its row/column/box peers, now that this digit is taken here.
    SudokuRules.eliminatePeerCandidates(nextCandidates, nextBoard, row, col, value)

    commitGrid({ board: nextBoard, givens, candidates: nextCandidates })
  }

  function clearCell(row: number, col: number) {
    const alreadyClear = board[row][col] === 0 && candidates[row][col].every((c) => !c)
    if (givens[row][col] || alreadyClear) {
      return
    }

    const nextBoard = cloneBoard(board)
    nextBoard[row][col] = 0
    const nextCandidates = cloneCandidates(candidates)
    nextCandidates[row][col] = Array(9).fill(false)

    commitGrid({ board: nextBoard, givens, candidates: nextCandidates })
  }

  function toggleCandidate(row: number, col: number, digit: number) {
    if (givens[row][col] || board[row][col] !== 0) {
      // Candidates only make sense on a cell that isn't solved yet.
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    const cell = [...nextCandidates[row][col]]
    cell[digit - 1] = !cell[digit - 1]
    nextCandidates[row][col] = cell

    commitGrid({ board, givens, candidates: nextCandidates })
  }

  function clearCandidates(row: number, col: number) {
    if (givens[row][col] || candidates[row][col].every((c) => !c)) {
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    nextCandidates[row][col] = Array(9).fill(false)

    commitGrid({ board, givens, candidates: nextCandidates })
  }

  function onAutofillCandidates() {
    const nextCandidates = cloneCandidates(candidates)
    for (const r of NINE) {
      for (const c of NINE) {
        if (board[r][c] !== 0) {
          continue
        }
        nextCandidates[r][c] = DIGITS.map((digit) => SudokuRules.isSafe(board, r, c, digit))
      }
    }
    commitGrid({ board, givens, candidates: nextCandidates })
  }

  function onClearAllCandidates() {
    if (!hasAnyCandidates) {
      return
    }
    const nextCandidates = candidates.map((row, r) =>
      row.map((cell, c) => (board[r][c] === 0 ? Array(9).fill(false) : cell)),
    )
    commitGrid({ board, givens, candidates: nextCandidates })
  }

  function applySingles(assignments: SingleAssignment[], singularLabel: string, pluralLabel: string) {
    if (assignments.length === 0) {
      setStatus(`No ${pluralLabel} to fill.`)
      return
    }

    const nextBoard = cloneBoard(board)
    for (const { row, col, digit } of assignments) {
      nextBoard[row][col] = digit
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of assignments) {
      nextCandidates[row][col] = Array(9).fill(false)
      SudokuRules.eliminatePeerCandidates(nextCandidates, nextBoard, row, col, digit)
    }

    commitGrid({ board: nextBoard, givens, candidates: nextCandidates })
    setStatus(`Filled ${assignments.length} ${assignments.length === 1 ? singularLabel : pluralLabel}.`)
  }

  function onNakedPairs() {
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus(
        'Naked pairs needs every empty cell to have its candidates marked first — try Autofill all.',
      )
      return
    }

    const eliminations = pairFinder.findNakedPairEliminations(board, candidates)
    if (eliminations.length === 0) {
      setStatus('No naked pairs to eliminate.')
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of eliminations) {
      nextCandidates[row][col][digit - 1] = false
    }

    commitGrid({ board, givens, candidates: nextCandidates })
    setStatus(
      `Eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'} via naked pairs.`,
    )
  }

  function onSimpleColoring() {
    const solvedByCell = new Map<string, { row: number; col: number; digit: number }>()
    const eliminatedByCell = new Map<string, { row: number; col: number; digit: number }>()

    for (const digit of DIGITS) {
      for (const chain of colorFinder.findChains(board, candidates, digit)) {
        const rule1 = colorFinder.findRule1(chain)
        if (rule1) {
          for (const [row, col] of rule1.solvedCells) {
            solvedByCell.set(`${row},${col}`, { row, col, digit })
          }
        }
        const rule2 = colorFinder.findRule2(chain, board, candidates)
        if (rule2) {
          for (const [row, col] of rule2.eliminatedCells) {
            eliminatedByCell.set(`${row},${col},${digit}`, { row, col, digit })
          }
        }
      }
    }

    const solvedAssignments = Array.from(solvedByCell.values())
    const eliminations = Array.from(eliminatedByCell.values())
    if (solvedAssignments.length === 0 && eliminations.length === 0) {
      setStatus('No simple colouring deductions to apply.')
      return
    }

    const nextBoard = cloneBoard(board)
    for (const { row, col, digit } of solvedAssignments) {
      nextBoard[row][col] = digit
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of solvedAssignments) {
      nextCandidates[row][col] = Array(9).fill(false)
      SudokuRules.eliminatePeerCandidates(nextCandidates, nextBoard, row, col, digit)
    }
    for (const { row, col, digit } of eliminations) {
      nextCandidates[row][col][digit - 1] = false
    }

    commitGrid({ board: nextBoard, givens, candidates: nextCandidates })

    const parts: string[] = []
    if (solvedAssignments.length > 0) {
      parts.push(`solved ${solvedAssignments.length} cell${solvedAssignments.length === 1 ? '' : 's'}`)
    }
    if (eliminations.length > 0) {
      parts.push(
        `eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'}`,
      )
    }
    setStatus(`Simple colouring ${parts.join(' and ')}.`)
  }

  function onMedusa() {
    const solvedByCell = new Map<string, { row: number; col: number; digit: number }>()
    const eliminatedByCell = new Map<string, { row: number; col: number; digit: number }>()

    for (const chain of medusaFinder.findChains(board, candidates)) {
      const mass = medusaFinder.findMassElimination(chain, board, candidates)
      if (mass) {
        for (const { row, col, digit } of mass.solvedCells) {
          solvedByCell.set(`${row},${col}`, { row, col, digit })
        }
        for (const { row, col, digit } of mass.eliminatedCandidates) {
          eliminatedByCell.set(`${row},${col},${digit}`, { row, col, digit })
        }
      }
      for (const r3 of medusaFinder.findRule3Eliminations(chain, board, candidates)) {
        eliminatedByCell.set(`${r3.row},${r3.col},${r3.digit}`, { row: r3.row, col: r3.col, digit: r3.digit })
      }
      for (const r4 of medusaFinder.findRule4Eliminations(chain, candidates)) {
        for (const digit of r4.eliminatedDigits) {
          eliminatedByCell.set(`${r4.row},${r4.col},${digit}`, { row: r4.row, col: r4.col, digit })
        }
      }
      for (const r5 of medusaFinder.findRule5Eliminations(chain, candidates)) {
        eliminatedByCell.set(`${r5.row},${r5.col},${r5.eliminatedDigit}`, {
          row: r5.row,
          col: r5.col,
          digit: r5.eliminatedDigit,
        })
      }
    }

    const solvedAssignments = Array.from(solvedByCell.values())
    const eliminations = Array.from(eliminatedByCell.values())
    if (solvedAssignments.length === 0 && eliminations.length === 0) {
      setStatus('No 3D Medusa deductions to apply.')
      return
    }

    const nextBoard = cloneBoard(board)
    for (const { row, col, digit } of solvedAssignments) {
      nextBoard[row][col] = digit
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of solvedAssignments) {
      nextCandidates[row][col] = Array(9).fill(false)
      SudokuRules.eliminatePeerCandidates(nextCandidates, nextBoard, row, col, digit)
    }
    for (const { row, col, digit } of eliminations) {
      // A candidate whose cell got solved above already lost every mark.
      if (nextBoard[row][col] === 0) {
        nextCandidates[row][col][digit - 1] = false
      }
    }

    commitGrid({ board: nextBoard, givens, candidates: nextCandidates })

    const parts: string[] = []
    if (solvedAssignments.length > 0) {
      parts.push(`solved ${solvedAssignments.length} cell${solvedAssignments.length === 1 ? '' : 's'}`)
    }
    if (eliminations.length > 0) {
      parts.push(`eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'}`)
    }
    setStatus(`3D Medusa ${parts.join(' and ')}.`)
  }

  function onAutoNakedSingles() {
    applySingles(singleFinder.findNakedSingles(board, candidates), 'naked single', 'naked singles')
  }

  function onAutoNakedAndHiddenSingles() {
    applySingles(
      singleFinder.findNakedAndHiddenSingles(board, candidates),
      'naked or hidden single',
      'naked and hidden singles',
    )
  }

  function toggleKeyboardMode() {
    setKeyboardMode((current) => (current === 'solution' ? 'candidate' : 'solution'))
  }

  function toggleStrongLinks() {
    setShowStrongLinks((current) => !current)
  }

  function toggleBivalueCells() {
    setShowBivalueCells((current) => !current)
  }

  function onSelectTechnique(id: string) {
    setActiveTechniqueId((current) => (current === id ? null : id))
  }

  function onCellClick(row: number, col: number) {
    setSelected({ row, col })
    const value = board[row][col]
    if (value !== 0) {
      setHighlightedDigit(value)
    }
  }

  function onHighlightDigit(digit: number) {
    setHighlightedDigit((current) => (current === digit ? null : digit))
  }

  function cellAriaLabel(row: number, col: number, value: number): string {
    const position = `row ${row + 1}, column ${col + 1}`
    if (value !== 0) {
      return `${value}, ${position}${givens[row][col] ? ', given' : ''}`
    }
    const marks = candidates[row][col]
      .map((active, i) => (active ? i + 1 : null))
      .filter((digit): digit is number => digit !== null)
    return marks.length > 0
      ? `Empty, ${position}, candidates ${marks.join(', ')}`
      : `Empty, ${position}`
  }

  async function onImport() {
    const result = await importer.import(importText)
    if (!result.ok) {
      setStatus(result.error)
      return
    }
    commitGrid({ board: result.board, givens: result.givens, candidates: result.candidates })
    setHighlightedDigit(null)
    setImportText('')
    setStatus('Puzzle imported. Click Solve to check it.')
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      // Let the import box handle its own typing instead of routing digits
      // and arrow keys to the grid.
      return
    }
    if (!selected) {
      return
    }

    const { row, col } = selected
    if (event.key >= '1' && event.key <= '9') {
      const digit = Number(event.key)
      if (keyboardMode === 'candidate') {
        toggleCandidate(row, col, digit)
      } else {
        setCellValue(row, col, digit)
      }
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
      if (keyboardMode === 'candidate') {
        clearCandidates(row, col)
      } else {
        clearCell(row, col)
      }
      return
    }

    const move: Record<string, [number, number]> = {
      ArrowUp: [row - 1, col],
      ArrowDown: [row + 1, col],
      ArrowLeft: [row, col - 1],
      ArrowRight: [row, col + 1],
    }
    const next = move[event.key]
    if (!next) {
      return
    }
    event.preventDefault()
    setSelected({
      row: Math.min(8, Math.max(0, next[0])),
      col: Math.min(8, Math.max(0, next[1])),
    })
  }

  function onSolve() {
    setSolving(true)
    setStatus('Solving…')

    // Defer to the next tick so the "Solving…" status paints before the
    // (synchronous) solve runs.
    window.setTimeout(() => {
      const response = solver.solve(board)
      if (response.solved && response.board) {
        commitGrid({ board: response.board, givens, candidates: createEmptyCandidates() })
      }
      setStatus(response.message)
      setSolving(false)
    }, 0)
  }

  function onClear() {
    const empty = createEmptyBoard()
    commitGrid({ board: empty, givens: computeGivenMask(empty), candidates: createEmptyCandidates() })
    setHighlightedDigit(null)
    setStatus('Board cleared.')
  }

  function onNewPuzzle() {
    setGenerating(true)
    setStatus('Generating a new puzzle…')

    // Defer to the next tick so the status paints before the (synchronous,
    // and heavier than solving) generation work runs.
    window.setTimeout(() => {
      const puzzle = generator.generate()
      commitGrid({ board: puzzle, givens: computeGivenMask(puzzle), candidates: createEmptyCandidates() })
      setHighlightedDigit(null)
      setStatus('New puzzle loaded. Click Solve to check it.')
      setGenerating(false)
    }, 0)
  }

  return (
    <main className="page" onKeyDown={onKeyDown}>
      <header className="header">
        <h1>Sudoku Slayer</h1>
        <p>
          Next level sudoku solver in the works.  
        </p>
        <div className="toggle-row">
          <button
            type="button"
            className={['mode-toggle', keyboardMode].join(' ')}
            aria-pressed={keyboardMode === 'candidate'}
            onClick={toggleKeyboardMode}
          >
            Keyboard enters: <strong>{keyboardMode === 'solution' ? 'Solution' : 'Candidates'}</strong>
          </button>
          <button
            type="button"
            className={['mode-toggle', 'strong-link-toggle', showStrongLinks ? 'active' : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={showStrongLinks}
            onClick={toggleStrongLinks}
          >
            Strong links: <strong>{showStrongLinks ? 'On' : 'Off'}</strong>
          </button>
          <button
            type="button"
            className={['mode-toggle', 'bivalue-toggle', showBivalueCells ? 'active' : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={showBivalueCells}
            onClick={toggleBivalueCells}
          >
            Bivalue cells: <strong>{showBivalueCells ? 'On' : 'Off'}</strong>
          </button>
        </div>
      </header>

      <div className="board-area">
        <TechniquePanel
          instances={techniqueInstances}
          activeId={activeTechniqueId}
          onSelect={onSelectTechnique}
        />

        <div className="grid" role="grid" aria-label="Sudoku board" tabIndex={0}>
          {NINE.map((boxIndex) => {
            const boxRow = Math.floor(boxIndex / 3)
            const boxCol = boxIndex % 3

            return (
              <div key={boxIndex} className="box" role="rowgroup">
                {NINE.map((cellIndex) => {
                  const r = boxRow * 3 + Math.floor(cellIndex / 3)
                  const c = boxCol * 3 + (cellIndex % 3)
                  const value = board[r][c]
                  const isSelected = selected?.row === r && selected?.col === c
                  const isDigitHighlighted = value !== 0 && highlightedDigit === value
                  const cellHasCandidates = candidates[r][c].some(Boolean)
                  const isTechniqueCell =
                    activeTechnique?.usedCells.some(([ur, uc]) => ur === r && uc === c) ?? false
                  const isBivalueCell = bivalueCells.has(`${r},${c}`)
                  const classes = [
                    'cell',
                    givens[r][c] ? 'given' : value ? 'filled' : '',
                    isSelected ? 'selected' : '',
                    isDigitHighlighted ? 'digit-highlighted' : '',
                    isBivalueCell ? 'bivalue-highlighted' : '',
                    isTechniqueCell ? 'technique-used' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')

                  return (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      role="gridcell"
                      aria-selected={isSelected}
                      aria-readonly={givens[r][c]}
                      aria-label={cellAriaLabel(r, c, value)}
                      className={classes}
                      onClick={() => onCellClick(r, c)}
                    >
                      {value !== 0 ? (
                        value
                      ) : cellHasCandidates ? (
                        <span className="candidates" aria-hidden="true">
                          {DIGITS.map((digit) => {
                            const active = candidates[r][c][digit - 1]
                            const isHighlighted = active && highlightedDigit === digit
                            const isTechniqueUsed =
                              active &&
                              (activeTechnique?.usedCandidates.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            const isTechniqueEliminated =
                              active &&
                              (activeTechnique?.eliminatedCandidates.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            const isTechniqueSolved =
                              active &&
                              (activeTechnique?.solvedCandidates.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            const isTechniqueBlue =
                              active &&
                              (activeTechnique?.blueCandidates?.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            const isTechniqueYellow =
                              active &&
                              (activeTechnique?.yellowCandidates?.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            return (
                              <span
                                key={digit}
                                className={[
                                  'candidate',
                                  active ? 'active' : '',
                                  isHighlighted ? 'highlighted' : '',
                                  isTechniqueUsed ? 'technique-used' : '',
                                  isTechniqueEliminated ? 'technique-eliminated' : '',
                                  isTechniqueSolved ? 'technique-solved' : '',
                                  isTechniqueBlue ? 'technique-blue' : '',
                                  isTechniqueYellow ? 'technique-yellow' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                {active ? digit : ''}
                              </span>
                            )
                          })}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )
          })}

          {strongLinks.length > 0 && (
            <svg className="strong-links" viewBox="0 0 900 900" aria-hidden="true">
              {strongLinks.map((link, index) => {
                const p1 = pipCenter(link.a[0], link.a[1], link.digit)
                const p2 = pipCenter(link.b[0], link.b[1], link.digit)
                return (
                  <line
                    key={index}
                    className="strong-link-line"
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                  />
                )
              })}
            </svg>
          )}

        </div>

        <div className="controls">
          <section className="control-group solution-group">
            <h2 className="control-label">Solution</h2>
            <DigitPad
              variant="solution"
              isDisabled={() => !selected || selectedIsLocked}
              onSelect={(digit) => selected && setCellValue(selected.row, selected.col, digit)}
            />
            <button
              type="button"
              className="pad-button erase-button"
              disabled={!selected || selectedIsLocked}
              onClick={() => selected && clearCell(selected.row, selected.col)}
            >
              Erase
            </button>
          </section>

          <section className="control-group candidate-group">
            <h2 className="control-label">Candidates</h2>
            <DigitPad
              variant="candidate"
              isDisabled={() => !selected || selectedIsLocked || selectedIsSolved}
              onSelect={(digit) => selected && toggleCandidate(selected.row, selected.col, digit)}
            />
            <button
              type="button"
              className="pad-button erase-button"
              disabled={!selected || selectedIsLocked || selectedIsSolved}
              onClick={() => selected && clearCandidates(selected.row, selected.col)}
            >
              Clear marks
            </button>
            <div className="candidate-bulk-actions">
              <button
                type="button"
                className="pad-button"
                disabled={busy || filled === 81}
                onClick={onAutofillCandidates}
              >
                Autofill all
              </button>
              <button
                type="button"
                className="pad-button"
                disabled={busy || !hasAnyCandidates}
                onClick={onClearAllCandidates}
              >
                Clear all
              </button>
            </div>
          </section>

          <section className="control-group autosolve-group">
            <h2 className="control-label">Auto-solve</h2>
            <button
              type="button"
              className="pad-button autosolve-button"
              disabled={busy || !hasAnyCandidates || filled === 81}
              onClick={onAutoNakedSingles}
            >
              Naked singles
            </button>
            <button
              type="button"
              className="pad-button autosolve-button"
              disabled={busy || !hasAnyCandidates || filled === 81}
              onClick={onAutoNakedAndHiddenSingles}
            >
              Naked + hidden singles
            </button>
            <button
              type="button"
              className="pad-button autosolve-button"
              disabled={busy || filled === 81}
              onClick={onNakedPairs}
            >
              Naked pairs
            </button>
            <button
              type="button"
              className="pad-button autosolve-button"
              disabled={busy || !hasAnyCandidates || filled === 81}
              onClick={onSimpleColoring}
            >
              Simple colouring
            </button>
            <button
              type="button"
              className="pad-button autosolve-button"
              disabled={busy || !hasAnyCandidates || filled === 81}
              onClick={onMedusa}
            >
              3D Medusa
            </button>
          </section>

          <section className="control-group highlight-group">
            <h2 className="control-label">Highlight digit</h2>
            <DigitPad
              variant="highlight"
              isActive={(digit) => highlightedDigit === digit}
              onSelect={onHighlightDigit}
            />
            <button
              type="button"
              className="pad-button erase-button"
              disabled={highlightedDigit === null}
              onClick={() => setHighlightedDigit(null)}
            >
              Clear highlight
            </button>
          </section>
        </div>
      </div>

      <div className="import-row">
        <textarea
          className="import-input"
          placeholder="Paste a Sudoku.Coach puzzle string, or a SudokuWiki.org text board…"
          rows={1}
          value={importText}
          disabled={busy}
          onChange={(event) => setImportText(event.target.value)}
        />
        <button type="button" onClick={onImport} disabled={busy || importText.trim().length === 0}>
          Import
        </button>
      </div>

      <div className="actions">
        <button type="button" onClick={undo} disabled={busy || !canUndo}>
          Undo
        </button>
        <button type="button" onClick={redo} disabled={busy || !canRedo}>
          Redo
        </button>
        <button type="button" className="primary" onClick={onSolve} disabled={busy}>
          {solving ? 'Solving…' : 'Solve'}
        </button>
        <button type="button" onClick={onNewPuzzle} disabled={busy}>
          {generating ? 'Generating…' : 'New puzzle'}
        </button>
        <button type="button" onClick={onClear} disabled={busy}>
          Clear
        </button>
      </div>

      <p className="status" role="status">
        {status} <span className="muted">({filled}/81 filled)</span>
      </p>
    </main>
  )
}
