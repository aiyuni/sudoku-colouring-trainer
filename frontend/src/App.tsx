import { useMemo, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import {
  cloneBoard,
  cloneCandidateColors,
  cloneCandidates,
  computeGivenMask,
  createEmptyBoard,
  createEmptyCandidateColors,
  createEmptyCandidates,
  markedCandidateDigits,
  sanitizeCandidateColors,
} from './sudoku/boardUtils'
import { CanvasGridImage } from './sudoku/CanvasGridImage'
import { recognizeDigit } from './sudoku/OcrDigitRecognizer'
import { PuzzleImporter } from './sudoku/PuzzleImporter'
import { SudokuColorFinder } from './sudoku/SudokuColorFinder'
import { SudokuDragonFinder, type DragonMove } from './sudoku/SudokuDragonFinder'
import { SudokuDragonPuzzleGenerator } from './sudoku/SudokuDragonPuzzleGenerator'
import { SudokuGenerator } from './sudoku/SudokuGenerator'
import { ocrGrid } from './sudoku/SudokuGridOcr'
import { SudokuMedusaFinder } from './sudoku/SudokuMedusaFinder'
import { SudokuPairFinder } from './sudoku/SudokuPairFinder'
import { SudokuRules } from './sudoku/SudokuRules'
import { SudokuSingleFinder, type SingleAssignment } from './sudoku/SudokuSingleFinder'
import { SudokuSolver } from './sudoku/SudokuSolver'
import { SAMPLE_PUZZLE, type Board, type CandidateColor, type CandidateColorGrid, type CandidateGrid } from './sudoku/types'
import './App.css'

const solver = new SudokuSolver()
const generator = new SudokuGenerator()
const dragonPuzzleGenerator = new SudokuDragonPuzzleGenerator()
const importer = new PuzzleImporter()
const singleFinder = new SudokuSingleFinder()
const pairFinder = new SudokuPairFinder()
const colorFinder = new SudokuColorFinder()
const medusaFinder = new SudokuMedusaFinder()
const dragonFinder = new SudokuDragonFinder()

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
  /** Manual highlight colours the user painted onto candidates - a pure
   * annotation, never touched by any solving technique or auto-solve. */
  candidateColors: CandidateColorGrid
}

function createInitialGrid(): GridState {
  return {
    board: cloneBoard(SAMPLE_PUZZLE),
    givens: computeGivenMask(SAMPLE_PUZZLE),
    candidates: createEmptyCandidates(),
    candidateColors: createEmptyCandidateColors(),
  }
}

/** The nine manual candidate-highlight colours, in palette layout order. */
// The four Dragon Colouring hues (light blue/dark blue for one side, light
// yellow/orange for the other) use the exact hex values .candidate.
// technique-blue/-darkblue/-yellow/-orange paint in App.css, so a candidate
// painted this colour and a Dragon Colouring highlight are the same colour,
// not just similar ones.
const CANDIDATE_COLOR_SWATCHES: Array<{ id: CandidateColor; label: string; hex: string }> = [
  { id: 'skyBlue', label: 'Light blue', hex: '#38bdf8' },
  { id: 'paleYellow', label: 'Light yellow', hex: '#fde047' },
  { id: 'lightPink', label: 'Light pink', hex: '#e6a3e6' },
  { id: 'blue', label: 'Dark blue', hex: '#2563eb' },
  { id: 'rust', label: 'Orange', hex: '#fb923c' },
  { id: 'limeGreen', label: 'Lime green', hex: '#7bc82c' },
  { id: 'purple', label: 'Purple', hex: '#9313b5' },
  { id: 'darkGreen', label: 'Dark green', hex: '#3d5c0e' },
  { id: 'tan', label: 'Tan', hex: '#f2c48a' },
]

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
  /** Simple Coloring/3D Medusa only: which candidates are which color, for
   * the click-to-highlight view. */
  blueCandidates?: TechniqueCandidateRef[]
  yellowCandidates?: TechniqueCandidateRef[]
  /** Dragon Colouring only: the ordered move log driving the move-by-move
   * player. When present, the panel row opens a stepper instead of
   * highlighting statically - the colors/eliminations/solves shown come
   * from folding moves[0..step] together, not from the fields above. */
  moves?: DragonMove[]
}

/** Every candidate's color as of `moves[0..stepIndex]` - a promotion move
 * overwrites an earlier color for the same candidate rather than adding a
 * second one, so each candidate shows only its latest color at that step. */
function foldDragonMoves(moves: DragonMove[], stepIndex: number) {
  const colorByKey = new Map<string, { row: number; col: number; digit: number; color: DragonMove['colored'][number]['color'] }>()
  const eliminatedCandidates: TechniqueCandidateRef[] = []
  const solvedCandidates: TechniqueCandidateRef[] = []

  const lastIndex = Math.min(stepIndex, moves.length - 1)
  for (let i = 0; i <= lastIndex; i++) {
    const move = moves[i]
    for (const n of move.colored) {
      colorByKey.set(`${n.row},${n.col},${n.digit}`, n)
    }
    eliminatedCandidates.push(...move.eliminated)
    solvedCandidates.push(...move.solved)
  }

  const blueCandidates: TechniqueCandidateRef[] = []
  const yellowCandidates: TechniqueCandidateRef[] = []
  const darkBlueCandidates: TechniqueCandidateRef[] = []
  const orangeCandidates: TechniqueCandidateRef[] = []
  for (const n of colorByKey.values()) {
    const ref = { row: n.row, col: n.col, digit: n.digit }
    if (n.color === 'blue') blueCandidates.push(ref)
    else if (n.color === 'yellow') yellowCandidates.push(ref)
    else if (n.color === 'darkBlue') darkBlueCandidates.push(ref)
    else orangeCandidates.push(ref)
  }

  return { blueCandidates, yellowCandidates, darkBlueCandidates, orangeCandidates, eliminatedCandidates, solvedCandidates }
}

function cellRef(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

/** Which base Medusa chains a Dragon Colouring pass is allowed to extend:
 * 'any' is every stuck chain Medusa found, exactly like the Medusa
 * auto-solve button uses, including chains built entirely from bilocal
 * (same-digit conjugate pair) links; 'bivalue-seeded' narrows that to
 * chains that also used at least one bivalue cell link, i.e. chains that
 * couldn't have been found by single-digit Simple Coloring alone. */
export type DragonChainFilter = 'any' | 'bivalue-seeded'

/** Dragon Colouring only applies once Medusa's own rules 1-5 find nothing
 * for a chain ("colour the medusa until it gets stuck"); this finds every
 * such stuck chain and extends each one, skipping chains where nothing
 * actionable comes out of the extension. Shared by the Techniques panel and
 * the Dragon colouring auto-solve buttons so the two can't drift apart. */
function computeStuckDragonExtensions(board: Board, candidates: CandidateGrid, filter: DragonChainFilter = 'any') {
  const results: Array<{ chainKey: string; moves: DragonMove[]; hasBivalueCellLink: boolean }> = []
  for (const chain of medusaFinder.findChains(board, candidates)) {
    if (filter === 'bivalue-seeded' && !chain.hasBivalueCellLink) {
      continue
    }
    const stuck =
      medusaFinder.findMassElimination(chain, board, candidates) === null &&
      medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
      medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
      medusaFinder.findRule5Eliminations(chain, candidates).length === 0
    if (!stuck) {
      continue
    }
    const result = dragonFinder.extend(chain, board, candidates)
    if (!result) {
      continue
    }
    const chainKey = chain.candidates
      .map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`)
      .sort()
      .join('-')
    results.push({ chainKey, moves: result.moves, hasBivalueCellLink: chain.hasBivalueCellLink })
  }
  return results
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

  // Dragon Colouring: one instance per stuck Medusa chain that the
  // extension turned into something actionable, each carrying its own move
  // log for the Techniques panel's step-by-step player.
  for (const { chainKey, moves } of computeStuckDragonExtensions(board, candidates)) {
    const lastMove = moves[moves.length - 1]
    // A mass elimination's solves/eliminates are both just consequences of
    // one fact - a side proved false, so the other side is proved true -
    // so that's the fact worth showing, not the tally of what followed
    // from it.
    const summaryText =
      lastMove.kind === 'mass-elimination' && lastMove.provenTrueColor
        ? `${lastMove.provenTrueColor === 'blue' ? 'light blue' : 'light yellow'} is true`
        : (() => {
            const eliminatedCount = moves.reduce((n, m) => n + m.eliminated.length, 0)
            const solvedCount = moves.reduce((n, m) => n + m.solved.length, 0)
            const summary: string[] = []
            if (solvedCount > 0) {
              summary.push(`solves ${solvedCount} cell${solvedCount === 1 ? '' : 's'}`)
            }
            if (eliminatedCount > 0) {
              summary.push(`eliminates ${eliminatedCount} candidate${eliminatedCount === 1 ? '' : 's'}`)
            }
            return summary.join(', ')
          })()
    instances.push({
      id: `dragon-${chainKey}`,
      name: 'Dragon Colouring',
      notation: `${moves.length} steps - ${summaryText}.`,
      usedCells: [],
      usedCandidates: [],
      eliminatedCandidates: moves.flatMap((m) => m.eliminated),
      solvedCandidates: moves.flatMap((m) => m.solved),
      moves,
    })
  }

  return instances
}

interface TechniquePanelProps {
  instances: TechniqueInstance[]
  activeId: string | null
  onSelect: (id: string) => void
  dragonStepIndex: number
  onDragonStep: (delta: number) => void
}

/** The panel to the left of the grid listing every technique instance the
 * current candidates support, in Sudoku notation. Clicking a row highlights
 * what it uses/eliminates/solves on the grid; it doesn't change the board.
 * A Dragon Colouring row expands in place into a forward/rewind stepper
 * instead, since its reasoning only makes sense played out move by move. */
function TechniquePanel({ instances, activeId, onSelect, dragonStepIndex, onDragonStep }: TechniquePanelProps) {
  return (
    <div className="technique-panel">
      <h2 className="control-label">Techniques</h2>
      {instances.length === 0 ? (
        <p className="technique-empty">
          None currently apply. Try Autofill all, then Naked/Hidden singles or Naked pairs.
        </p>
      ) : (
        <ul className="technique-list">
          {instances.map((instance) => {
            const isActive = activeId === instance.id
            const moves = instance.moves
            const stepIndex = moves ? Math.min(dragonStepIndex, moves.length - 1) : 0
            return (
              <li key={instance.id}>
                <button
                  type="button"
                  className={['technique-item', isActive ? 'active' : ''].filter(Boolean).join(' ')}
                  aria-pressed={isActive}
                  onClick={() => onSelect(instance.id)}
                >
                  <span className="technique-name">{instance.name}</span>
                  <span className="technique-notation">{instance.notation}</span>
                </button>
                {isActive && moves && (
                  <div className="dragon-player">
                    <div className="dragon-player-controls">
                      <button
                        type="button"
                        className="dragon-player-button"
                        disabled={stepIndex <= 0}
                        onClick={() => onDragonStep(-1)}
                      >
                        ◀ Rewind
                      </button>
                      <span className="dragon-player-step">
                        Step {stepIndex + 1} / {moves.length}
                      </span>
                      <button
                        type="button"
                        className="dragon-player-button"
                        disabled={stepIndex >= moves.length - 1}
                        onClick={() => onDragonStep(1)}
                      >
                        Forward ▶
                      </button>
                    </div>
                    <p className="dragon-player-description">{moves[stepIndex].description}</p>
                  </div>
                )}
              </li>
            )
          })}
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
  const { board, givens, candidates, candidateColors } = grid

  const [selected, setSelected] = useState<{ row: number; col: number } | null>({
    row: 0,
    col: 2,
  })
  const [highlightedDigit, setHighlightedDigit] = useState<number | null>(null)
  const [activeTechniqueId, setActiveTechniqueId] = useState<string | null>(null)
  const [dragonStepIndex, setDragonStepIndex] = useState(0)
  const [keyboardMode, setKeyboardMode] = useState<'solution' | 'candidate'>('solution')
  const [paintColor, setPaintColor] = useState<CandidateColor | null>(null)
  const [showStrongLinks, setShowStrongLinks] = useState(false)
  const [showBivalueCells, setShowBivalueCells] = useState(false)
  const [importText, setImportText] = useState('')
  const [solving, setSolving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrDragActive, setOcrDragActive] = useState(false)
  const busy = solving || generating || ocrBusy
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
  // Dragon Colouring's colors/eliminations/solves come from folding its
  // move log up through the current step, not from static fields, since
  // which candidate has which color changes as the playback advances.
  const dragonHighlight = useMemo(
    () => (activeTechnique?.moves ? foldDragonMoves(activeTechnique.moves, dragonStepIndex) : null),
    [activeTechnique, dragonStepIndex],
  )

  const selectedIsLocked = selected !== null && givens[selected.row][selected.col]
  const selectedIsSolved = selected !== null && board[selected.row][selected.col] !== 0
  const canUndo = historyIndex > 0
  const canRedo = historyIndex < historyEntries.length - 1

  /** Records one grid change as a single undoable step; anything "in the
   * future" from a prior undo is discarded, same as any other editor.
   * Callers that don't touch candidate colours (nearly all of them - only
   * the paint action itself does) can omit candidateColors entirely; it
   * carries forward from the current grid and drops any colour left over
   * on a candidate the change just solved or eliminated. */
  function commitGrid(next: Omit<GridState, 'candidateColors'> & { candidateColors?: CandidateColorGrid }) {
    const resolved: GridState = {
      board: next.board,
      givens: next.givens,
      candidates: next.candidates,
      candidateColors: sanitizeCandidateColors(next.candidateColors ?? grid.candidateColors, next.board, next.candidates),
    }
    const truncated = historyEntries.slice(0, historyIndex + 1)
    setGrid(resolved)
    setHistoryEntries([...truncated, resolved])
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

  function runDragonColouring(filter: DragonChainFilter, label: string) {
    const solvedByCell = new Map<string, { row: number; col: number; digit: number }>()
    const eliminatedByCell = new Map<string, { row: number; col: number; digit: number }>()

    for (const { moves } of computeStuckDragonExtensions(board, candidates, filter)) {
      for (const move of moves) {
        for (const { row, col, digit } of move.solved) {
          solvedByCell.set(`${row},${col}`, { row, col, digit })
        }
        for (const { row, col, digit } of move.eliminated) {
          eliminatedByCell.set(`${row},${col},${digit}`, { row, col, digit })
        }
      }
    }

    const solvedAssignments = Array.from(solvedByCell.values())
    const eliminations = Array.from(eliminatedByCell.values())
    if (solvedAssignments.length === 0 && eliminations.length === 0) {
      setStatus(`No ${label} deductions to apply.`)
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
    setStatus(`${label} ${parts.join(' and ')}.`)
  }

  function onDragonColouringBivalueSeeded() {
    runDragonColouring('bivalue-seeded', 'Dragon Colouring (bivalue-seeded)')
  }

  function onDragonColouringAny() {
    runDragonColouring('any', 'Dragon Colouring (any Medusa)')
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
    setDragonStepIndex(0)
  }

  function onDragonStep(delta: number) {
    const maxIndex = (activeTechnique?.moves?.length ?? 1) - 1
    setDragonStepIndex((current) => Math.min(maxIndex, Math.max(0, current + delta)))
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

  function onSelectPaintColor(color: CandidateColor) {
    setPaintColor((current) => (current === color ? null : color))
  }

  /** Paints (or, on a repeat click with the same colour, un-paints) one
   * candidate - a manual annotation only, never touched by any solving
   * technique or auto-solve. Only meaningful with a paint colour selected
   * and an actual candidate under the click. */
  function onCandidatePipClick(row: number, col: number, digit: number) {
    if (!paintColor || !candidates[row][col][digit - 1]) {
      return
    }
    const nextColors = cloneCandidateColors(candidateColors)
    nextColors[row][col][digit - 1] = nextColors[row][col][digit - 1] === paintColor ? null : paintColor
    commitGrid({ board, givens, candidates, candidateColors: nextColors })
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

  /** Reads a screenshot of a Sudoku grid (dropped or pasted) and rebuilds
   * the board from it, colour and any overlaid lines/arrows ignored -
   * only which pixels are darker than their own cell's background is
   * ever asked. Like the SudokuWiki text-board import, a screenshot has
   * no way to tell an original given apart from a cell you'd already
   * solved yourself, so nothing comes back locked. */
  async function onImportImage(file: File) {
    setOcrBusy(true)
    setStatus('Reading screenshot…')
    try {
      const image = await CanvasGridImage.fromBlob(file)
      const result = await ocrGrid(image, recognizeDigit)
      const solvedCount = result.board.flat().filter((v) => v !== 0).length
      const unrecognizedCount = result.cells.filter((c) => c.unrecognizedSolvedDigit).length
      if (solvedCount === 0 && unrecognizedCount === 0) {
        setStatus("Couldn't find a Sudoku grid in that image.")
        return
      }
      commitGrid({
        board: result.board,
        givens: result.board.map((row) => row.map(() => false)),
        candidates: result.candidates,
      })
      setHighlightedDigit(null)
      const parts = [`read ${solvedCount} solved cell${solvedCount === 1 ? '' : 's'}`]
      if (unrecognizedCount > 0) {
        parts.push(`couldn't read ${unrecognizedCount} digit${unrecognizedCount === 1 ? '' : 's'} - check them`)
      }
      setStatus(`Screenshot imported: ${parts.join(', ')}.`)
    } catch {
      setStatus("Couldn't read that screenshot.")
    } finally {
      setOcrBusy(false)
    }
  }

  function onImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setOcrDragActive(false)
    const file = Array.from(event.dataTransfer.files).find((f) => f.type.startsWith('image/'))
    if (file) {
      void onImportImage(file)
    }
  }

  function onImagePaste(event: ClipboardEvent<HTMLDivElement>) {
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith('image/'))
      ?.getAsFile()
    if (file) {
      event.preventDefault()
      void onImportImage(file)
    }
  }

  function onImageFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      void onImportImage(file)
    }
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

  function onNewDragonPuzzle() {
    setGenerating(true)
    setStatus('Generating a puzzle that needs Dragon Colouring…')

    window.setTimeout(() => {
      const result = dragonPuzzleGenerator.generate()
      if (!result) {
        setStatus("Couldn't find one this time - try again.")
        setGenerating(false)
        return
      }
      // Candidates come from the generator itself, already reflecting the
      // point where every easier technique is exhausted - re-autofilling
      // here would just rebuild the same candidates it already checked
      // against, not undo them.
      commitGrid({ board: result.board, givens: result.givens, candidates: result.candidates })
      setHighlightedDigit(null)
      setStatus('New puzzle loaded: every easier technique gets stuck before Dragon Colouring is needed.')
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
          dragonStepIndex={dragonStepIndex}
          onDragonStep={onDragonStep}
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
                            const eliminatedSource = dragonHighlight?.eliminatedCandidates ?? activeTechnique?.eliminatedCandidates
                            const isTechniqueEliminated =
                              active &&
                              (eliminatedSource?.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            const solvedSource = dragonHighlight?.solvedCandidates ?? activeTechnique?.solvedCandidates
                            const isTechniqueSolved =
                              active &&
                              (solvedSource?.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            const blueSource = dragonHighlight?.blueCandidates ?? activeTechnique?.blueCandidates
                            const isTechniqueBlue =
                              active &&
                              (blueSource?.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            const yellowSource = dragonHighlight?.yellowCandidates ?? activeTechnique?.yellowCandidates
                            const isTechniqueYellow =
                              active &&
                              (yellowSource?.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            const isTechniqueDarkBlue =
                              active &&
                              (dragonHighlight?.darkBlueCandidates.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            const isTechniqueOrange =
                              active &&
                              (dragonHighlight?.orangeCandidates.some(
                                (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                              ) ??
                                false)
                            const isTechniqueColored =
                              isTechniqueUsed ||
                              isTechniqueEliminated ||
                              isTechniqueSolved ||
                              isTechniqueBlue ||
                              isTechniqueYellow ||
                              isTechniqueDarkBlue ||
                              isTechniqueOrange
                            // A manually painted colour is a pure user
                            // annotation - it only shows through when no
                            // technique highlight is already claiming this
                            // pip's background, so the two never fight.
                            const paintedColorId = active && !isTechniqueColored ? candidateColors[r][c][digit - 1] : null
                            const paintedHex = paintedColorId
                              ? CANDIDATE_COLOR_SWATCHES.find((s) => s.id === paintedColorId)?.hex
                              : undefined
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
                                  isTechniqueDarkBlue ? 'technique-darkblue' : '',
                                  isTechniqueOrange ? 'technique-orange' : '',
                                  paintedHex ? 'candidate-painted' : '',
                                  active && paintColor ? 'paint-target' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                style={paintedHex ? { backgroundColor: paintedHex } : undefined}
                                onClick={
                                  active && paintColor
                                    ? (event) => {
                                        event.stopPropagation()
                                        onCandidatePipClick(r, c, digit)
                                      }
                                    : undefined
                                }
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

          <section className="control-group paint-group">
            <h2 className="control-label">Candidate Colour</h2>
            <div className="paint-swatches">
              {CANDIDATE_COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  className={['paint-swatch', paintColor === swatch.id ? 'active' : ''].filter(Boolean).join(' ')}
                  style={{ backgroundColor: swatch.hex }}
                  aria-pressed={paintColor === swatch.id}
                  aria-label={swatch.label}
                  title={swatch.label}
                  onClick={() => onSelectPaintColor(swatch.id)}
                />
              ))}
            </div>
            <p className="paint-hint">
              {paintColor
                ? 'Click a candidate to paint or unpaint it.'
                : 'Pick a colour, then click candidates to paint them.'}
            </p>
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
            <button
              type="button"
              className="pad-button autosolve-button"
              disabled={busy || !hasAnyCandidates || filled === 81}
              onClick={onDragonColouringBivalueSeeded}
              title="Only extends Medusa chains that use at least one bivalue cell link"
            >
              Dragon colouring (bivalue)
            </button>
            <button
              type="button"
              className="pad-button autosolve-button"
              disabled={busy || !hasAnyCandidates || filled === 81}
              onClick={onDragonColouringAny}
              title="Extends any stuck Medusa chain, including ones built only from bilocal links"
            >
              Dragon colouring (any Medusa)
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

      <div
        className={['image-import-drop', ocrDragActive ? 'active' : ''].filter(Boolean).join(' ')}
        onDragOver={(event) => {
          event.preventDefault()
          setOcrDragActive(true)
        }}
        onDragLeave={() => setOcrDragActive(false)}
        onDrop={onImageDrop}
        onPaste={onImagePaste}
        tabIndex={0}
        role="button"
        aria-label="Drop or paste a Sudoku grid screenshot to read it"
      >
        <span>
          {ocrBusy
            ? 'Reading screenshot…'
            : 'Drag & drop a Sudoku screenshot here, paste one (Ctrl+V), or '}
        </span>
        {!ocrBusy && (
          <label className="image-import-browse">
            browse a file
            <input type="file" accept="image/*" onChange={onImageFileSelected} disabled={busy} />
          </label>
        )}
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
        <button
          type="button"
          onClick={onNewDragonPuzzle}
          disabled={busy}
          title="Generates a puzzle where every easier technique gets stuck and Dragon Colouring is what's needed to progress"
        >
          {generating ? 'Generating…' : 'New Dragon Colouring puzzle'}
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
