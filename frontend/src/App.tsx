import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
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
import { SolveResponse, type SolveStatus } from './sudoku/SolveResponse'
import {
  ALL_RULE3_TECHNIQUES,
  type DragonMove,
  type DragonRule3Substep,
  type Rule3Technique,
} from './sudoku/SudokuDragonFinder'
import { ALL_FISH_TECHNIQUES, FISH_TECHNIQUE_NAMES, type FishTechnique } from './sudoku/SudokuFishFinder'
import { foldDragonMoves } from './sudoku/dragonReplay'
import {
  SudokuDragonTargetFinder,
  checkEliminationTargets,
  formatCandidate,
  parseEliminationTargets,
} from './sudoku/SudokuDragonTargetFinder'
import { generateDragonPuzzleInParallel } from './sudoku/ParallelDragonPuzzleGenerator'
import { pickStockDynamicDragonPuzzle } from './sudoku/dynamicDragonPuzzleStock'
import type { DragonPuzzleGenerateOptions, GeneratedDragonPuzzle } from './sudoku/SudokuDragonPuzzleGenerator'
import { SudokuGenerator } from './sudoku/SudokuGenerator'
import { ocrGrid } from './sudoku/SudokuGridOcr'
import { SudokuRules } from './sudoku/SudokuRules'
import { GENERIC_AIC_MAX_LENGTH } from './sudoku/SudokuGenericAicFinder'
import { type SingleAssignment } from './sudoku/SudokuSingleFinder'
import { SudokuSolver } from './sudoku/SudokuSolver'
import { SAMPLE_PUZZLE, type Board, type CandidateColor, type CandidateColorGrid, type CandidateGrid } from './sudoku/types'
import HelpModal from './HelpModal'
import TutorialPage from './tutorial/TutorialPage'
import { useCompactLayout } from './useCompactLayout'
import { BusyIndicator } from './BusyIndicator'
import ConfirmDialog from './ConfirmDialog'
import { afterPaint, useSettledValue, type BusyTask } from './busyTask'
import { solvePathInWorker, type SolvePathOptions } from './solvePathInWorker'
import {
  DEFAULT_SETTINGS,
  DRAGON_GENERATION_TIMEOUT_OPTIONS,
  SOLVE_PATH_TIMEOUT_OPTIONS,
  MIN_BASE_MEDUSA_CANDIDATES,
  RULE3_TECHNIQUE_LABELS,
} from './settingsDefaults'
import {
  singleFinder,
  lockedCandidateFinder,
  pairFinder,
  nakedSubsetFinder,
  hiddenPairFinder,
  uniqueRectangleFinder,
  bugPlusOneFinder,
  bivalueOddagonFinder,
  colorFinder,
  medusaFinder,
  NINE,
  DIGITS,
  type TechniqueInstance,
  describeTargetProblem,
  cellRef,
  type DragonChainFilter,
  computeStuckDragonExtensions,
  computeStuckDynamicDragonExtensions,
  computeShortAicEliminationsByKind,
  computeGenericAicEliminations,
  buildTechniqueInstances,
  buildDragonInstance,
  dynamicDragonLabel,
  fullTechniqueEffect,
  countEffectiveEliminations,
  applyTechniqueEffect,
  type SolvePathResult,
  boardsEqual,
  candidatesEqual,
} from './techniqueEngine'
import './App.css'

const solver = new SudokuSolver()
const generator = new SudokuGenerator()
const dragonTargetFinder = new SudokuDragonTargetFinder()
const importer = new PuzzleImporter()
const APP_VERSION = 'v0.5.0-beta'

/** The proven minimum number of givens a Sudoku needs to have a unique
 * solution - a board with fewer filled cells than this can never be
 * uniquely solvable, so the solvability check below skips running the
 * backtracking solver at all once it sees too few. */
const MIN_UNIQUE_SOLUTION_CLUES = 17

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

/** One undo/redo-able snapshot: the grid *and* whatever the cached Solve
 * Path looked like at that exact point - so undoing an Apply (which
 * changes both together) restores both together, rather than rewinding
 * the grid while leaving the already-reduced step list behind. */
interface HistoryEntry {
  grid: GridState
  solvePath: SolvePathResult | null
}

function createInitialGrid(): GridState {
  return {
    board: cloneBoard(SAMPLE_PUZZLE),
    givens: computeGivenMask(SAMPLE_PUZZLE),
    candidates: createEmptyCandidates(),
    candidateColors: createEmptyCandidateColors(),
  }
}

/** The nine manual candidate-highlight colours, in palette layout order -
 * default hex values only. The user can recolour any of them (see
 * swatchColors state); these defaults are what a fresh browser (or a
 * "reset colours" - see loadCustomSwatchColors) falls back to. */
// The four Dragon Colouring hues (light blue/dark blue for one side, light
// yellow/orange for the other) default to the exact hex values .candidate.
// technique-blue/-darkblue/-yellow/-orange paint in App.css, so a candidate
// painted this colour and a Dragon Colouring highlight start out as the
// same colour, not just similar ones - customizing one of these four no
// longer keeps that link, which is an accepted trade-off of letting the
// user recolour freely.
const DEFAULT_CANDIDATE_COLOR_SWATCHES: Array<{ id: CandidateColor; label: string; hex: string }> = [
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

const CANDIDATE_SWATCH_COLORS_STORAGE_KEY = 'sudoku-solver-candidate-swatch-colors'

function defaultSwatchColors(): Record<CandidateColor, string> {
  return Object.fromEntries(DEFAULT_CANDIDATE_COLOR_SWATCHES.map((s) => [s.id, s.hex])) as Record<
    CandidateColor,
    string
  >
}

/** Reads any user-customized swatch colours from localStorage, falling
 * back to (and filling in any missing/invalid entries with) the defaults
 * above - corrupt or inaccessible storage is treated the same as "nothing
 * saved yet" rather than breaking the page. */
function loadCustomSwatchColors(): Record<CandidateColor, string> {
  const colors = defaultSwatchColors()
  try {
    const raw = localStorage.getItem(CANDIDATE_SWATCH_COLORS_STORAGE_KEY)
    if (!raw) {
      return colors
    }
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      for (const swatch of DEFAULT_CANDIDATE_COLOR_SWATCHES) {
        const value = (parsed as Record<string, unknown>)[swatch.id]
        if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
          colors[swatch.id] = value
        }
      }
    }
  } catch {
    // Corrupt JSON or storage inaccessible (private browsing, etc.) -
    // fall back to defaults silently.
  }
  return colors
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

/** A quadratic-bezier path between two candidate pip centers, bowed out
 * perpendicular to the line between them - Short AIC's chain links are
 * drawn curved (rather than straight, like the strong-link overlay) so
 * overlapping links stay visually distinguishable. */
function curvedPath(p1: { x: number; y: number }, p2: { x: number; y: number }): string {
  const mx = (p1.x + p2.x) / 2
  const my = (p1.y + p2.y) / 2
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const length = Math.hypot(dx, dy) || 1
  const curvature = Math.min(60, length * 0.25)
  const cx = mx + (-dy / length) * curvature
  const cy = my + (dx / length) * curvature
  return `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`
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


export type PuzzleSolvability =
  | { kind: 'solvable' }
  | { kind: 'solvable-brute-force' }
  /** The fresh-autofill search got stuck, but a second search from the
   * user's own (accurate, complete) marks solved it - they eliminated
   * something this app has no technique for (e.g. a Swordfish, done on
   * another site before importing). Without this the verdict said "brute
   * force" while the Solve Path tab, which starts from those same marks,
   * happily solved it. */
  | { kind: 'solvable-from-marks' }
  /** The technique search ran out of time (or steps) while still making
   * progress - it neither finished nor got stuck, so nothing can be claimed
   * about whether brute force is needed. */
  | { kind: 'solvable-unknown' }
  /** The technique search is still running in its Web Worker. */
  | { kind: 'checking' }
  | {
      kind: 'unsolvable'
      reason: 'inaccurate-candidates' | 'multiple-solutions' | 'no-solutions' | 'inaccurate-placements'
    }

/** Whether the puzzle's own givens (not the user's current candidate
 * marks or solving progress) can be solved by this app's known
 * techniques alone, need brute-force guessing despite being a valid
 * unique-solution puzzle, or aren't solvable at all - and if not, why.
 * Candidate accuracy is checked against the marked candidates actually on
 * the board (a cell with nothing marked yet isn't treated as an error),
 * but "solvable"/"solvable with brute force" is decided from a *fresh*
 * autofill, independent of the user's own candidate-marking progress -
 * this is a property of the puzzle, not of how far they've gotten. Takes
 * the pieces as already-computed values (see the component's own memos)
 * rather than doing that work itself, so the expensive fresh-autofill
 * solve-path search can be memoized separately from - and far less often
 * than - this cheap combination step. */
function derivePuzzleSolvability(
  solveStatus: SolveStatus,
  candidatesAccurate: boolean,
  techniqueSearch: SolvePathResult | 'checking' | null,
  marksSearch: SolvePathResult | 'checking' | null,
): PuzzleSolvability {
  if (solveStatus === 'invalid') {
    return { kind: 'unsolvable', reason: 'inaccurate-placements' }
  }
  if (solveStatus === 'unsolvable') {
    return { kind: 'unsolvable', reason: 'no-solutions' }
  }
  if (solveStatus === 'multiple') {
    return { kind: 'unsolvable', reason: 'multiple-solutions' }
  }
  if (!candidatesAccurate) {
    return { kind: 'unsolvable', reason: 'inaccurate-candidates' }
  }
  if (techniqueSearch === 'checking') {
    return { kind: 'checking' }
  }
  if (techniqueSearch?.solvedFully) {
    return { kind: 'solvable' }
  }
  // Only a search that genuinely got stuck proves the techniques aren't enough;
  // one that hit its time/step limit proves nothing either way.
  if (techniqueSearch && (techniqueSearch.stoppedReason === 'time-budget' || techniqueSearch.stoppedReason === 'step-cap')) {
    return { kind: 'solvable-unknown' }
  }
  if (marksSearch === 'checking') {
    return { kind: 'checking' }
  }
  if (marksSearch?.solvedFully) {
    return { kind: 'solvable-from-marks' }
  }
  // A marks search that ran out of time doesn't undo what the fresh search
  // proved: from the puzzle alone, the techniques get stuck.
  return { kind: 'solvable-brute-force' }
}

/** Every legal digit marked in every empty cell of `board` - what "Autofill
 * all" would give, independent of the user's own marks. */
function freshAutofillCandidates(board: Board): CandidateGrid {
  const candidates = createEmptyCandidates()
  for (const r of NINE) {
    for (const c of NINE) {
      if (board[r][c] === 0) {
        candidates[r][c] = DIGITS.map((d) => SudokuRules.isSafe(board, r, c, d))
      }
    }
  }
  return candidates
}

/** Runs one Solve Path search in a Web Worker per distinct `request` object
 * and returns its result once it's back for *that* request (null while it's
 * running, or when there's no request). A newer request aborts (terminates)
 * the search still running for the old one, so at most one runs at a time. */
function useWorkerSolvePath(
  request: { board: Board; candidates: CandidateGrid; options: SolvePathOptions } | null,
): SolvePathResult | null {
  const [search, setSearch] = useState<{ request: NonNullable<typeof request>; result: SolvePathResult } | null>(null)
  useEffect(() => {
    if (!request) {
      return
    }
    const controller = new AbortController()
    solvePathInWorker(request.board, request.candidates, request.options, controller.signal).then(
      (result) => setSearch({ request, result }),
      (error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        // A crashed search proves nothing either way - report it the same
        // as one that ran out of time ("couldn't tell"), not as "needs
        // brute force".
        console.error('Solvability search failed', error)
        setSearch({ request, result: { steps: [], solvedFully: false, stoppedReason: 'time-budget', easySolve: false, log: [] } })
      },
    )
    return () => controller.abort()
  }, [request])
  return request && search?.request === request ? search.result : null
}

const UNSOLVABLE_REASON_TEXT:Record<Extract<PuzzleSolvability, { kind: 'unsolvable' }>['reason'], string> = {
  'inaccurate-candidates': 'inaccurate candidates',
  'multiple-solutions': 'multiple solutions',
  'no-solutions': 'no solutions',
  'inaccurate-placements': 'inaccurate digit placements',
}

function solvabilityText(solvability: PuzzleSolvability): string {
  switch (solvability.kind) {
    case 'solvable':
      return 'Solvable'
    case 'solvable-brute-force':
      return 'Solvable with brute force'
    case 'solvable-from-marks':
      return 'Solvable from your current candidates (a fresh autofill would need brute force)'
    case 'checking':
      return 'Checking whether it can be solved without brute force…'
    case 'solvable-unknown':
      return "Solvable (couldn't tell whether brute force is needed - the technique search timed out)"
    case 'unsolvable':
      return `Unsolvable (${UNSOLVABLE_REASON_TEXT[solvability.reason]})`
  }
}

type TechniquePanelTab = 'techniques' | 'solve-path' | 'find'

/** The Short AIC (length <= 5) Auto-solve button is hidden - Short
 * Single-Digit and Generic cover the useful ends of the AIC range there -
 * but kept behind this flag rather than deleted (along with onShortAic),
 * in case it is wanted back. Short AIC itself is unaffected everywhere
 * else (Techniques panel, solve path, Dynamic Dragon). */
const SHOW_SHORT_AIC_AUTOSOLVE = false

/** The touch layout's dock tabs (see useCompactLayout) - each shows one or
 * two of the desktop layout's side-column blocks under/beside the grid. */
type CompactSection = 'techniques' | 'input' | 'colour' | 'solve' | 'import'

const COMPACT_SECTIONS: Array<{ id: CompactSection; label: string }> = [
  { id: 'techniques', label: 'Techniques' },
  { id: 'input', label: 'Digits' },
  { id: 'colour', label: 'Colour' },
  { id: 'solve', label: 'Solve' },
  { id: 'import', label: 'Import' },
]

/** What the "Find by elims" tab is currently showing. `found` carries the
 * technique itself plus the grid it was found against, so the tab can tell
 * when the grid has since changed and the result no longer applies. */
type FindResult =
  | { kind: 'message'; tone: 'error' | 'info'; title: string; lines: string[] }
  | {
      kind: 'found'
      instance: TechniqueInstance
      /** Candidates the technique removes that the user did not enter: how
       * many, and the first few written out. */
      extraCount: number
      extras: string[]
      note?: string
      boardBefore: Board
      candidatesBefore: CandidateGrid
    }

interface FindPanelData {
  input: string
  onInput: (value: string) => void
  onFind: () => void
  result: FindResult | null
  /** False once the grid has changed since a `found` result was computed. */
  resultIsCurrent: boolean
}

/** Technique substep clauses start lowercase ("a naked pair of ...") since
 * they're written to be read as a list; shown alone they read as a
 * sentence. */
function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The forward/rewind player under a Dragon Colouring row: steps through
 * the move log one move at a time, with that move's own explanation.
 *
 * When the move on screen is a Dynamic Dragon Colouring step, a second,
 * separate forward/rewind control appears underneath it - "Substep 1 / 3"
 * etc.: each chained technique, then the new dragon colour as the last
 * substep. Revealing a technique brings its own basis cells and internal,
 * hypothetical eliminations (the hollow red circle+cross) onto the grid,
 * one at a time, instead of the whole chain's reasoning appearing at once;
 * the colour itself only appears at the last substep.
 * `substepIndex` is the raw, shared piece of state: null means "not
 * navigating - show every substep revealed", which this component resolves
 * against the move currently on screen's own substep count (a different
 * move, reached via the main stepper above, restarts at "fully revealed"
 * without the parent needing to reset anything move-specific itself). */
function DragonStepper({
  moves,
  stepIndex,
  onDragonStep,
  substepIndex,
  onSubstep,
}: {
  moves: DragonMove[]
  stepIndex: number
  onDragonStep: (delta: number) => void
  substepIndex: number | null
  onSubstep: (delta: number) => void
}) {
  const move = moves[stepIndex]
  const substeps = move.substeps
  const resolvedSubstepIndex = substepIndex ?? (substeps ? substeps.length - 1 : 0)
  return (
    <div className="dragon-player">
      <div className="dragon-player-controls">
        <button type="button" className="dragon-player-button" disabled={stepIndex <= 0} onClick={() => onDragonStep(-1)}>
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
      <p className="dragon-player-description">{move.description}</p>
      {substeps && substeps.length > 1 && (
        <div className="dragon-substep-player">
          <div className="dragon-player-controls dragon-substep-controls">
            <button
              type="button"
              className="dragon-player-button"
              disabled={resolvedSubstepIndex <= 0}
              onClick={() => onSubstep(-1)}
            >
              ◀ Rewind
            </button>
            <span className="dragon-player-step">
              Substep {resolvedSubstepIndex + 1} / {substeps.length}
            </span>
            <button
              type="button"
              className="dragon-player-button"
              disabled={resolvedSubstepIndex >= substeps.length - 1}
              onClick={() => onSubstep(1)}
            >
              Forward ▶
            </button>
          </div>
          <p className="dragon-substep-description">{capitalizeFirst(substeps[resolvedSubstepIndex].clause)}.</p>
        </div>
      )}
    </div>
  )
}

/** "Find by elims": type the candidates you want gone (8r2c3, 2r3c4) and get
 * the Dragon or Dynamic Dragon Colouring that eliminates them, shown like a
 * row of the Techniques list - same name, summary and step player - with the
 * grid highlighting it the same way. */
function FindPanel({
  input,
  onInput,
  onFind,
  result,
  resultIsCurrent,
  dragonStepIndex,
  onDragonStep,
  dragonSubstepIndex,
  onDragonSubstep,
}: FindPanelData & {
  dragonStepIndex: number
  onDragonStep: (delta: number) => void
  dragonSubstepIndex: number | null
  onDragonSubstep: (delta: number) => void
}) {
  return (
    <div className="find-panel">
      <p className="technique-empty">
        <span className="experimental-label">experimental</span> A reverse Dragon finder: Enter candidates to eliminate in the format of <b>1r2c3, 2r5r6</b>, and it will find the shortest Dragon that eliminates them.
      </p>
      <form
        className="find-form"
        onSubmit={(event) => {
          event.preventDefault()
          onFind()
        }}
      >
        <input
          type="text"
          className="find-input"
          value={input}
          placeholder="8r2c3, 2r3c4"
          aria-label="Candidates to eliminate"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onInput(event.target.value)}
        />
        <button type="submit" className="find-button">
          Find
        </button>
      </form>

      {result?.kind === 'message' && (
        <div className={`find-message find-message-${result.tone}`} role="status">
          <strong>{result.title}</strong>
          {result.lines.length > 0 && (
            <ul>
              {result.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result?.kind === 'found' &&
        (resultIsCurrent && result.instance.moves ? (
          <div className="find-result">
            <p className="find-summary">
              {result.extraCount === 0
                ? 'Eliminates exactly the candidates you entered.'
                : `Also eliminates ${result.extraCount} other candidate${result.extraCount === 1 ? '' : 's'}: ${result.extras.join(', ')}${result.extraCount > result.extras.length ? ', ...' : ''}.`}
            </p>
            <div className="technique-item active find-item">
              <span className="technique-name">{result.instance.name}</span>
              <span className="technique-notation">{result.instance.notation}</span>
              <DragonStepper
                moves={result.instance.moves}
                stepIndex={Math.min(dragonStepIndex, result.instance.moves.length - 1)}
                onDragonStep={onDragonStep}
                substepIndex={dragonSubstepIndex}
                onSubstep={onDragonSubstep}
              />
            </div>
            {result.note && <p className="technique-empty">{result.note}</p>}
            <p className="technique-empty">Click Apply to make these eliminations.</p>
          </div>
        ) : (
          <p className="solve-path-stale-warning">The grid has changed since this was found - press Find again.</p>
        ))}
    </div>
  )
}

interface TechniquePanelProps {
  tab: TechniquePanelTab
  onTabChange: (tab: TechniquePanelTab) => void
  instances: TechniqueInstance[]
  activeId: string | null
  onSelect: (id: string) => void
  dragonStepIndex: number
  onDragonStep: (delta: number) => void
  dragonSubstepIndex: number | null
  onDragonSubstep: (delta: number) => void
  solvePath: SolvePathResult | null
  activeSolvePathIndex: number | null
  onSelectSolvePathStep: (index: number) => void
  onApply: () => void
  canApply: boolean
  onGenerateSolvePath: () => void
  solvePathStale: boolean
  showSolvePathLog: boolean
  onToggleSolvePathLog: () => void
  solvability: PuzzleSolvability
  find: FindPanelData
  easySolveEnabled: boolean
  onToggleEasySolve: () => void
  solvePathTimeoutMs: number
  onSolvePathTimeoutChange: (event: ChangeEvent<HTMLSelectElement>) => void
}

/** The panel to the left of the grid, with three tabs sharing one "Apply"
 * button:
 *  - Find by elims: type candidates to eliminate (8r2c3, 2r3c4) and get the
 *    Dragon / Dynamic Dragon Colouring that does it - see FindPanel and
 *    SudokuDragonTargetFinder.
 *  - Techniques: every technique instance the current candidates support,
 *    in Sudoku notation. Clicking a row highlights what it uses/
 *    eliminates/solves on the grid; it doesn't change the board. A Dragon
 *    Colouring row expands in place into a forward/rewind stepper instead,
 *    since its reasoning only makes sense played out move by move.
 *  - Solve path: empty until Generate is clicked (its own submenu below
 *    the tabs). The sequence buildSolvePath found is cached, not
 *    recomputed on every grid change - Apply here performs the selected
 *    step directly on the live grid and drops it from the list, without
 *    recalculating the rest. Regenerate re-runs the search from scratch;
 *    "View search log" opens a small scrollable window with how it was
 *    found, step by step. */
function TechniquePanel({
  tab,
  onTabChange,
  instances,
  activeId,
  onSelect,
  dragonStepIndex,
  onDragonStep,
  dragonSubstepIndex,
  onDragonSubstep,
  solvePath,
  activeSolvePathIndex,
  onSelectSolvePathStep,
  onApply,
  canApply,
  onGenerateSolvePath,
  solvePathStale,
  showSolvePathLog,
  //onToggleSolvePathLog,
  solvability,
  find,
  easySolveEnabled,
  onToggleEasySolve,
  solvePathTimeoutMs,
  onSolvePathTimeoutChange,
}: TechniquePanelProps) {
  return (
    <div className="technique-panel">
      <div className="technique-panel-header">
        <div className="technique-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'techniques'}
            className={['technique-tab', tab === 'techniques' ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => onTabChange('techniques')}
          >
            Techniques
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'solve-path'}
            className={['technique-tab', tab === 'solve-path' ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => onTabChange('solve-path')}
          >
            Solve path
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'find'}
            className={['technique-tab', tab === 'find' ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => onTabChange('find')}
            title="Find by eliminations (experimental): find the Dragon that eliminates candidates you choose."
          >
            Find by elims
          </button>
        </div>
        <button type="button" className="technique-apply-button" disabled={!canApply} onClick={onApply}>
          Apply
        </button>
      </div>
      {tab === 'techniques' ? (
        instances.length === 0 ? (
          <p className="technique-empty">
            None currently apply. Either the solver can't find any, or the puzzle doesn't have full candidates (click "Autofill all" under Candidates)
          </p>
        ) : (
        <>
          <p className="technique-empty" style={{ marginBottom: '0.75rem' }}>
            Click on a technique and click on the "Apply" button to execute the technique.
          </p>
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
                    <DragonStepper
                      moves={moves}
                      stepIndex={stepIndex}
                      onDragonStep={onDragonStep}
                      substepIndex={dragonSubstepIndex}
                      onSubstep={onDragonSubstep}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </>
        )
      ) : tab === 'find' ? (
        <FindPanel
          {...find}
          dragonStepIndex={dragonStepIndex}
          onDragonStep={onDragonStep}
          dragonSubstepIndex={dragonSubstepIndex}
          onDragonSubstep={onDragonSubstep}
        />
      ) : (
        <>
          <div className="solve-path-submenu">
            <button type="button" className="solve-path-generate-button" onClick={onGenerateSolvePath}>
              {solvePath ? 'Regenerate' : 'Generate'}
            </button>
            <label
              className="solve-path-easy-solve"
              title={
                easySolveEnabled
                  ? 'Solver currently picks the simplest technique that applies at each state.'
                  : 'Solver currently picks the technique that makes the most progress (most placements or eliminations) at each state.'
              }
            >
              <input type="checkbox" checked={easySolveEnabled} onChange={onToggleEasySolve} />
              Easiest Path (Easy Solve)
            </label>
            <label
              className="solve-path-timeout"
              title="How long Generate keeps searching before it stops and shows the steps found so far. The Solvable check under the grid uses the same limit."
            >
              Timeout
              <select value={solvePathTimeoutMs} onChange={onSolvePathTimeoutChange}>
                {SOLVE_PATH_TIMEOUT_OPTIONS.map(({ label, ms }) => (
                  <option key={ms} value={ms}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {showSolvePathLog && (
            <div className="solve-path-log" role="log">
              {solvePath ? (
                solvePath.log.map((line, i) => <div key={i}>{line}</div>)
              ) : (
                <div>No search has been run yet - click Generate.</div>
              )}
            </div>
          )}
          {solvability.kind === 'unsolvable' ? (
            <p className="technique-empty solve-path-unsolvable">
              Puzzle is not solvable due to {UNSOLVABLE_REASON_TEXT[solvability.reason]}.
            </p>
          ) : !solvePath ? (
            <p className="technique-empty">Click "Generate" to find a solve path from the current grid.   See the Settings or Help section to customize what the solver finds.  <br></br> <b>Note</b>:   "Exhaustive Dragon Colouring" setting (default: ON) and "Easy Solve" will affect the solve path significantly.</p>
          ) : solvePath.steps.length === 0 ? (
            <p className="technique-empty">
              {solvePath.solvedFully ? 'Already solved.' : "Either there are no full candidates (click 'Autofill all'), or the solver doesn't know a technique to solve it - brute force is required from here."}
            </p>
          ) : (
            <>
              <p className="technique-empty" style={{ marginBottom: '0.75rem' }}>
                Click on a step and click on the <b>"Apply"</b> button to execute up to and including the step. <br></br> <b>Note</b>: "Exhaustive Dragon Colouring" settings (default ON) and "Easy Solve" has a huge impact on the solve path.
              </p>
              {solvePathStale && (
                <p className="solve-path-stale-warning">
                  The grid no longer matches this solve path - a Regenerate might be needed.
                </p>
              )}
              {solvePath.easySolve && (() => {
                // Easy Solve always takes the simplest technique available, so
                // the highest-ranked step is the one the puzzle can't be solved
                // without (given the enabled techniques) - its real difficulty.
                // Earliest step wins a tie.
                let hardestIndex = 0
                solvePath.steps.forEach((step, index) => {
                  if (step.instance.techniqueRank > solvePath.steps[hardestIndex].instance.techniqueRank) hardestIndex = index
                })
                return (
                  <p className="solve-path-hardest">
                    Hardest technique: <b>{solvePath.steps[hardestIndex].instance.name}</b> (Step {hardestIndex + 1})
                  </p>
                )
              })()}
              <ul className="technique-list">
                {solvePath.steps.map((step, index) => {
                  const isActive = activeSolvePathIndex === index
                  const moves = step.instance.moves
                  const stepIndex = moves ? Math.min(dragonStepIndex, moves.length - 1) : 0
                  return (
                    <li key={`${step.instance.id}-${index}`}>
                      <button
                        type="button"
                        className={['technique-item', isActive ? 'active' : ''].filter(Boolean).join(' ')}
                        aria-pressed={isActive}
                        onClick={() => onSelectSolvePathStep(index)}
                      >
                        <span className="technique-name">
                          Step {index + 1}: {step.instance.name}
                        </span>
                        <span className="technique-notation">{step.instance.notation}</span>
                      </button>
                      {isActive && moves && (
                        <DragonStepper
                          moves={moves}
                          stepIndex={stepIndex}
                          onDragonStep={onDragonStep}
                          substepIndex={dragonSubstepIndex}
                          onSubstep={onDragonSubstep}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
              {!solvePath.solvedFully && (
                <p className="technique-empty">
                  {solvePath.stoppedReason === 'time-budget'
                    ? 'Stopped early - the search took too long, so this may not reach a full solve.'
                    : solvePath.stoppedReason === 'step-cap'
                      ? 'Stopped after hitting the step safety cap.'
                      : 'Got stuck here - the rest of the puzzle would need brute force.'}
                </p>
              )}
            </>
          )}

        </>
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
/** Where a digit's own pencil mark sits within a cell's 3x3 pip layout
 * (1 top-left, 5 dead center, 9 bottom-right, etc.) - used to align a
 * candidate pad button's digit the same way, instead of centering it like
 * every other pad. */
function candidatePadAlignment(digit: number): { justifyContent: string; alignItems: string } {
  const row = Math.floor((digit - 1) / 3)
  const col = (digit - 1) % 3
  return {
    justifyContent: col === 0 ? 'flex-start' : col === 1 ? 'center' : 'flex-end',
    alignItems: row === 0 ? 'flex-start' : row === 1 ? 'center' : 'flex-end',
  }
}

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
          style={variant === 'candidate' ? candidatePadAlignment(digit) : undefined}
        >
          {digit}
        </button>
      ))}
    </div>
  )
}

interface DropdownMenuProps {
  label: ReactNode
  buttonClassName?: string
  panelClassName?: string
  /** Which edge of the trigger the panel lines up with when there's room. */
  align?: 'left' | 'right'
  /** For a trigger whose label is only an icon. */
  ariaLabel?: string
  /** Close as soon as one of the panel's `.dropdown-item` buttons is used -
   * for a plain action menu, as opposed to a panel of toggles. */
  closeOnItemClick?: boolean
  children: ReactNode
}

/** Gap kept between a dropdown panel and every viewport edge. */
const DROPDOWN_VIEWPORT_MARGIN = 8

/** Positions an open dropdown panel (position: fixed) against its trigger
 * so the whole panel stays inside the viewport: lined up with the trigger's
 * left or right edge when that fits, otherwise slid back in from whichever
 * side it would cross; below the trigger when there's room (or at least
 * more room than above), otherwise flipped above it; and capped to the
 * height actually available on that side, scrolling internally past that.
 * On a desktop-sized window none of the clamps bite, so the panel lands
 * exactly where the old `position: absolute; top: calc(100% + 0.4rem)`
 * rule put it. `cssMaxWidth`/`cssMaxHeight` are the stylesheet's own caps,
 * read once on open, since the inline ones set here mask them afterwards. */
function placeDropdownPanel(
  anchor: HTMLElement,
  panel: HTMLElement,
  align: 'left' | 'right',
  cssMaxWidth: number,
  cssMaxHeight: number,
) {
  const margin = DROPDOWN_VIEWPORT_MARGIN
  const gap = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.4
  const viewportWidth = document.documentElement.clientWidth
  const viewportHeight = window.innerHeight
  const anchorRect = anchor.getBoundingClientRect()

  // Measure the natural width from the left edge, where nothing squeezes it.
  panel.style.left = '0px'
  panel.style.maxWidth = `${Math.min(cssMaxWidth, viewportWidth - 2 * margin)}px`
  const width = panel.getBoundingClientRect().width
  const preferredLeft = align === 'right' ? anchorRect.right - width : anchorRect.left
  const left = Math.max(margin, Math.min(preferredLeft, viewportWidth - margin - width))

  // scrollHeight rather than the rendered height: it doesn't depend on the
  // max-height set by a previous placement, and re-measuring never has to
  // clear that cap (which would reset the panel's own scroll position).
  const panelStyle = getComputedStyle(panel)
  const borderY = parseFloat(panelStyle.borderTopWidth) + parseFloat(panelStyle.borderBottomWidth)
  const desiredHeight = Math.min(panel.scrollHeight + borderY, cssMaxHeight)
  const spaceBelow = viewportHeight - anchorRect.bottom - gap - margin
  const spaceAbove = anchorRect.top - gap - margin
  let top: number
  let maxHeight: number
  if (desiredHeight <= spaceBelow || spaceBelow >= spaceAbove) {
    top = Math.max(margin, anchorRect.bottom + gap)
    maxHeight = viewportHeight - margin - top
  } else {
    maxHeight = spaceAbove
    top = anchorRect.top - gap - Math.min(desiredHeight, spaceAbove)
  }

  panel.style.left = `${left}px`
  panel.style.top = `${top}px`
  panel.style.maxHeight = `${Math.floor(Math.max(0, Math.min(maxHeight, cssMaxHeight)))}px`
}

/** A button that reveals a small floating panel of controls on click -
 * closes on an outside click, on Escape, or after the panel itself calls
 * the close callback its render prop receives. Used to fold a cluster of
 * related buttons/toggles (puzzle generation, view settings) behind one
 * toolbar button instead of spreading them all out at all times. The panel
 * is fixed-positioned and kept inside the viewport by placeDropdownPanel,
 * re-placed on every resize/rotation and scroll, so it can't hang off the
 * right or bottom edge on a phone or tablet (or clip inside the phone
 * toolbar's horizontal scroller). */
function DropdownMenu({
  label,
  buttonClassName,
  panelClassName,
  align = 'left',
  ariaLabel,
  closeOnItemClick = false,
  children,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Layout effect, so the panel is placed before it's ever painted.
  useLayoutEffect(() => {
    const anchor = containerRef.current
    const panel = panelRef.current
    if (!open || !anchor || !panel) {
      return
    }
    // parseFloat('none') is NaN - no cap from the stylesheet.
    const cssCap = (value: string) => (Number.isFinite(parseFloat(value)) ? parseFloat(value) : Infinity)
    const panelStyle = getComputedStyle(panel)
    const cssMaxWidth = cssCap(panelStyle.maxWidth)
    const cssMaxHeight = cssCap(panelStyle.maxHeight)
    const place = () => placeDropdownPanel(anchor, panel, align, cssMaxWidth, cssMaxHeight)
    function onScroll(event: Event) {
      // The panel's own scrolling doesn't move the trigger.
      if (!(event.target instanceof Node && panel?.contains(event.target))) {
        place()
      }
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) {
      return
    }
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="dropdown-menu" ref={containerRef}>
      <button
        type="button"
        className={['dropdown-trigger', open ? 'active' : '', buttonClassName ?? ''].filter(Boolean).join(' ')}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      {open && (
        <div
          ref={panelRef}
          className={['dropdown-panel', panelClassName ?? ''].filter(Boolean).join(' ')}
          style={{ position: 'fixed' }}
          role="menu"
          onClick={
            closeOnItemClick
              ? (event) => {
                  if (event.target instanceof Element && event.target.closest('.dropdown-item')) {
                    setOpen(false)
                  }
                }
              : undefined
          }
        >
          {children}
        </div>
      )}
    </div>
  )
}

type BusyTaskKind = 'solve' | 'generate' | 'ocr' | 'solve-path' | 'find' | 'auto-solve'

interface RunningBusyTask extends BusyTask {
  id: number
  kind: BusyTaskKind
}

let nextBusyTaskId = 1

export default function App() {
  const [grid, setGrid] = useState<GridState>(createInitialGrid)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(() => [{ grid: createInitialGrid(), solvePath: null }])
  const [historyIndex, setHistoryIndex] = useState(0)
  const { board, givens, candidates, candidateColors } = grid

  const [selected, setSelected] = useState<{ row: number; col: number } | null>({
    row: 0,
    col: 2,
  })
  const [highlightedDigit, setHighlightedDigit] = useState<number | null>(null)
  const [activeTechniqueId, setActiveTechniqueId] = useState<string | null>(null)
  const [dragonStepIndex, setDragonStepIndex] = useState(0)
  // null = "not navigating - show every technique substep of the current
  // Dynamic Dragon Colouring step revealed at once" (the default, and the
  // only state a single-technique step or any other move kind ever has).
  // Only becomes a concrete index once the substep player's forward/rewind
  // is used - see DragonStepper's own resolvedSubstepIndex.
  const [dragonSubstepIndex, setDragonSubstepIndex] = useState<number | null>(null)
  const [techniquePanelTab, setTechniquePanelTab] = useState<TechniquePanelTab>('techniques')
  const [findInput, setFindInput] = useState('')
  const [findResult, setFindResult] = useState<FindResult | null>(null)
  const [activeSolvePathIndex, setActiveSolvePathIndex] = useState<number | null>(null)
  // Deliberately state, not a useMemo off [board, candidates]: the whole
  // point is this does NOT recompute on every grid change - only Generate/
  // Regenerate (or clearing it out when auto-solve is used) ever touches
  // it, so it survives switching tabs and applying its own steps for free.
  const [solvePath, setSolvePath] = useState<SolvePathResult | null>(null)
  const [showSolvePathLog, setShowSolvePathLog] = useState(false)
  const [keyboardMode, setKeyboardMode] = useState<'solution' | 'candidate'>(DEFAULT_SETTINGS.keyboardMode)
  const [paintColor, setPaintColor] = useState<CandidateColor | null>(null)
  const [swatchColors, setSwatchColors] = useState<Record<CandidateColor, string>>(loadCustomSwatchColors)

  // Persists a customized swatch colour across reloads - loadCustomSwatchColors
  // reads this same key back on next mount.
  useEffect(() => {
    try {
      localStorage.setItem(CANDIDATE_SWATCH_COLORS_STORAGE_KEY, JSON.stringify(swatchColors))
    } catch {
      // Storage inaccessible (private browsing, quota, etc.) - the custom
      // colour still works for this session, it just won't persist.
    }
  }, [swatchColors])

  const candidateColorSwatches = useMemo(
    () => DEFAULT_CANDIDATE_COLOR_SWATCHES.map((swatch) => ({ ...swatch, hex: swatchColors[swatch.id] })),
    [swatchColors],
  )
  // Every setting below starts from DEFAULT_SETTINGS (settingsDefaults.ts),
  // the same object resetSettingsToDefaults() and the help page read - so
  // change a default there, not here.
  const [showStrongLinks, setShowStrongLinks] = useState(DEFAULT_SETTINGS.showStrongLinks)
  const [showBivalueCells, setShowBivalueCells] = useState(DEFAULT_SETTINGS.showBivalueCells)
  const [gridWhiteMode, setGridWhiteMode] = useState(DEFAULT_SETTINGS.gridWhiteMode)
  const [minBaseMedusaFilter, setMinBaseMedusaFilter] = useState(DEFAULT_SETTINGS.minBaseMedusaFilter)
  const [dynamicDragonDisabled, setDynamicDragonDisabled] = useState(DEFAULT_SETTINGS.dynamicDragonDisabled)
  const [allowedRule3Techniques, setAllowedRule3Techniques] = useState<Set<Rule3Technique>>(
    () => new Set(DEFAULT_SETTINGS.allowedRule3Techniques),
  )
  const [shortAicEnabled, setShortAicEnabled] = useState(DEFAULT_SETTINGS.shortAicEnabled)
  const [genericAicEnabled, setGenericAicEnabled] = useState(DEFAULT_SETTINGS.genericAicEnabled)
  const [shortSingleDigitAicEnabled, setShortSingleDigitAicEnabled] = useState(
    DEFAULT_SETTINGS.shortSingleDigitAicEnabled,
  )
  const [xWingEnabled, setXWingEnabled] = useState(DEFAULT_SETTINGS.xWingEnabled)
  const [finnedXWingEnabled, setFinnedXWingEnabled] = useState(DEFAULT_SETTINGS.finnedXWingEnabled)
  const [swordfishEnabled, setSwordfishEnabled] = useState(DEFAULT_SETTINGS.swordfishEnabled)
  const [finnedSwordfishEnabled, setFinnedSwordfishEnabled] = useState(DEFAULT_SETTINGS.finnedSwordfishEnabled)
  const [alsXzEnabled, setAlsXzEnabled] = useState(DEFAULT_SETTINGS.alsXzEnabled)
  // The four fish toggles as the one set the engine takes.
  const enabledFish = useMemo(() => {
    const enabled = new Set<FishTechnique>()
    if (xWingEnabled) enabled.add('x-wing')
    if (finnedXWingEnabled) enabled.add('finned x-wing')
    if (swordfishEnabled) enabled.add('swordfish')
    if (finnedSwordfishEnabled) enabled.add('finned swordfish')
    return enabled
  }, [xWingEnabled, finnedXWingEnabled, swordfishEnabled, finnedSwordfishEnabled])
  // Invariants, kept by the toggle handlers rather than derived at read
  // time (so the stored state never says something the checkboxes can't):
  //  - genericAicEnabled implies shortAicEnabled implies shortSingleDigitAicEnabled
  //  - a disregard flag can only be false while its technique is enabled
  //  - dragonGenerationDisregardsAic can only be false while
  //    dragonGenerationDisregardsSingleDigitAic is also false, and
  //    dragonGenerationDisregardsGenericAic while dragonGenerationDisregardsAic is
  const [dragonGenerationDisregardsSingleDigitAic, setDragonGenerationDisregardsSingleDigitAic] = useState(
    DEFAULT_SETTINGS.dragonGenerationDisregardsSingleDigitAic,
  )
  const [dragonGenerationDisregardsAic, setDragonGenerationDisregardsAic] = useState(
    DEFAULT_SETTINGS.dragonGenerationDisregardsAic,
  )
  const [dragonGenerationDisregardsGenericAic, setDragonGenerationDisregardsGenericAic] = useState(
    DEFAULT_SETTINGS.dragonGenerationDisregardsGenericAic,
  )
  const [dynamicDragonPuzzleForbidsPlainDragon, setDynamicDragonPuzzleForbidsPlainDragon] = useState(
    DEFAULT_SETTINGS.dynamicDragonPuzzleForbidsPlainDragon,
  )
  const [aicLimitPerDragonStep, setAicLimitPerDragonStep] = useState(DEFAULT_SETTINGS.aicLimitPerDragonStep)
  const [exhaustiveDragonColouring, setExhaustiveDragonColouring] = useState(DEFAULT_SETTINGS.exhaustiveDragonColouring)
  const [optimizeDragons, setOptimizeDragons] = useState(DEFAULT_SETTINGS.optimizeDragons)
  const [optimizeDynamicDragons, setOptimizeDynamicDragons] = useState(DEFAULT_SETTINGS.optimizeDynamicDragons)
  const [easySolveEnabled, setEasySolveEnabled] = useState(DEFAULT_SETTINGS.easySolveEnabled)
  const [solvePathTimeoutMs, setSolvePathTimeoutMs] = useState(DEFAULT_SETTINGS.solvePathTimeoutMs)
  const [dynamicDragonAutoSolveIncludesAics, setDynamicDragonAutoSolveIncludesAics] = useState(
    DEFAULT_SETTINGS.dynamicDragonAutoSolveIncludesAics,
  )
  const [dragonGenerationTimeoutMs, setDragonGenerationTimeoutMs] = useState(
    DEFAULT_SETTINGS.dragonGenerationTimeoutMs,
  )
  const [helpOpen, setHelpOpen] = useState(false)
  const [confirmOptimizeDynamicOpen, setConfirmOptimizeDynamicOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const { compact, phone, landscape } = useCompactLayout()
  const [compactSection, setCompactSection] = useState<CompactSection>('techniques')
  const [importText, setImportText] = useState('')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  // Every explicitly started long operation still running (see
  // runBusyTask) - a list rather than one slot because the worker-based
  // puzzle generation keeps the main thread free, so something else can
  // start and finish while it runs; each removes only its own entry.
  const [busyTasks, setBusyTasks] = useState<RunningBusyTask[]>([])
  const [ocrDragActive, setOcrDragActive] = useState(false)
  const busy = busyTasks.length > 0
  const busyKinds = new Set(busyTasks.map((t) => t.kind))
  const solving = busyKinds.has('solve')
  const generating = busyKinds.has('generate')
  const ocrBusy = busyKinds.has('ocr')
  const [status, setStatus] = useState('Sudoku Colouring Solver Trainer')

  const filled = useMemo(
    () => board.flat().filter((value) => value !== 0).length,
    [board],
  )

  const hasAnyCandidates = useMemo(
    () => candidates.some((row) => row.some((cell) => cell.some(Boolean))),
    [candidates],
  )

  const hasAnyPaintedColor = useMemo(
    () => candidateColors.some((row) => row.some((cell) => cell.some((color) => color !== null))),
    [candidateColors],
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

  // The puzzle's own solution, determined purely from its givens - never
  // from the user's own placed digits, so it stays the one fixed "right
  // answer" to check entries against even after a wrong one is on the
  // board (solving the live board itself would just come back invalid/
  // unsolvable/multiple at that point, not hand back a solution to compare
  // against). Re-solved from scratch on every board change, same tradeoff
  // puzzleSolveResult below already makes - cheap enough now not to bother
  // caching further (see SudokuSolver's bitmask-based backtracking).
  const givensSolveResult = useMemo(() => {
    const givenOnlyBoard = board.map((row, r) => row.map((value, c) => (givens[r][c] ? value : 0)))
    return solver.solve(givenOnlyBoard)
  }, [board, givens])

  // A user-entered digit that's wrong - either it duplicates another digit
  // already in its row/column/box, or (even when it doesn't collide with
  // anything) it simply isn't what the puzzle's givens alone solve to.
  // Re-derived from the board on every change (rather than tracked as an
  // event) so it clears itself automatically the instant the offending
  // digit is edited or removed, same as every other board-derived
  // highlight here. Givens are never flagged - they're locked, not
  // something the user "input", and a puzzle whose own givens conflict is
  // already surfaced separately by the solvability badge.
  const conflictedCells = useMemo(() => {
    const set = new Set<string>()
    const scratch = cloneBoard(board)
    const solution = givensSolveResult.status === 'solved' ? givensSolveResult.board : null
    for (const r of NINE) {
      for (const c of NINE) {
        const value = scratch[r][c]
        if (value === 0 || givens[r][c]) {
          continue
        }
        if (solution) {
          // The givens alone pin down exactly one solution, so any entry
          // that doesn't match it is wrong regardless of whether it also
          // happens to collide with a peer.
          if (value !== solution[r][c]) {
            set.add(`${r},${c}`)
          }
          continue
        }
        // No knowable single solution (too few givens, or the givens
        // themselves are already contradictory/ambiguous) - fall back to
        // flagging only outright rule violations.
        scratch[r][c] = 0
        const safe = SudokuRules.isSafe(scratch, r, c, value)
        scratch[r][c] = value
        if (!safe) {
          set.add(`${r},${c}`)
        }
      }
    }
    return set
  }, [board, givens, givensSolveResult])

  // The global Short AIC on/off switch is a master switch over its own
  // per-technique checkbox in the Dynamic Dragon Colouring list - turning
  // it off excludes 'short aic' regardless of that checkbox's own state,
  // rather than needing every Dynamic Dragon call site to check both.
  // Each fish toggle, and ALS-xz's, is the same kind of master switch over
  // its own Dynamic Dragon checkbox.
  const effectiveAllowedRule3Techniques = useMemo(() => {
    if (
      shortAicEnabled &&
      shortSingleDigitAicEnabled &&
      genericAicEnabled &&
      alsXzEnabled &&
      enabledFish.size === ALL_FISH_TECHNIQUES.length
    ) {
      return allowedRule3Techniques
    }
    const next = new Set(allowedRule3Techniques)
    for (const fish of ALL_FISH_TECHNIQUES) {
      if (!enabledFish.has(fish)) {
        next.delete(fish)
      }
    }
    if (!shortAicEnabled) {
      next.delete('short aic')
    }
    if (!shortSingleDigitAicEnabled) {
      next.delete('short single-digit aic')
    }
    if (!genericAicEnabled) {
      next.delete('generic aic')
    }
    if (!alsXzEnabled) {
      next.delete('als-xz')
    }
    return next
  }, [allowedRule3Techniques, shortAicEnabled, shortSingleDigitAicEnabled, genericAicEnabled, alsXzEnabled, enabledFish])

  // The "solvable / solvable with brute force / unsolvable" status below
  // the grid, split into three memos so the expensive part (a fresh-
  // autofill solve-path search, bruteSolvePath further down) only reruns
  // when the board's own givens change, not on every candidate the user
  // marks or clears - candidate accuracy is checked separately, cheaply,
  // straight off the live marks.
  // A board with fewer than MIN_UNIQUE_SOLUTION_CLUES filled cells can
  // never be uniquely solvable (a proven fact about Sudoku, not something
  // that needs solving to find out), so that case skips the backtracking
  // solver entirely rather than asking it to prove what's already known -
  // classified as "multiple solutions" since an under-clued board that's
  // otherwise a normal, non-contrived arrangement is virtually always
  // satisfiable many different ways, never exactly zero.
  const puzzleSolveResult = useMemo(
    () => (filled < MIN_UNIQUE_SOLUTION_CLUES ? SolveResponse.multiple() : solver.solve(board)),
    [board, filled],
  )
  const candidatesAccurate = useMemo(() => {
    if (puzzleSolveResult.status !== 'solved' || !puzzleSolveResult.board) {
      return true
    }
    const solution = puzzleSolveResult.board
    for (const r of NINE) {
      for (const c of NINE) {
        if (board[r][c] !== 0) {
          continue
        }
        const marked = candidates[r][c]
        if (!marked.some(Boolean)) {
          continue
        }
        if (!marked[solution[r][c] - 1]) {
          return false
        }
      }
    }
    return true
  }, [board, candidates, puzzleSolveResult])

  // Everything the Techniques list is computed from. It reads `analysis`
  // (one painted frame behind, see useSettledValue) rather than the live
  // values, so the busy indicator is on screen before the recompute blocks
  // the page. (The solvability check's far longer solve-path search isn't
  // here - it runs in a Web Worker, see solvabilityRequest.)
  const liveAnalysisInputs = useMemo(
    () => ({
      board,
      candidates,
      minBaseMedusaFilter,
      effectiveAllowedRule3Techniques,
      shortAicEnabled,
      shortSingleDigitAicEnabled,
      aicLimitPerDragonStep,
      exhaustiveDragonColouring,
      genericAicEnabled,
      optimizeDragons,
      optimizeDynamicDragons,
      dynamicDragonDisabled,
      enabledFish,
      alsXzEnabled,
    }),
    [
      board,
      candidates,
      minBaseMedusaFilter,
      effectiveAllowedRule3Techniques,
      shortAicEnabled,
      shortSingleDigitAicEnabled,
      aicLimitPerDragonStep,
      exhaustiveDragonColouring,
      genericAicEnabled,
      optimizeDragons,
      optimizeDynamicDragons,
      dynamicDragonDisabled,
      enabledFish,
      alsXzEnabled,
    ],
  )
  const [analysis, analysisPending] = useSettledValue(liveAnalysisInputs)
  // What the indicator says while `analysis` catches up - worded after what
  // actually changed, since that's what the user just did.
  const analysisBusyTask = useMemo((): BusyTask | null => {
    if (!analysisPending) {
      return null
    }
    const live = liveAnalysisInputs
    const slowSettingsNote =
      live.optimizeDynamicDragons && !live.exhaustiveDragonColouring
        ? ' Optimize Dynamic Dragons ON with Exhaustive Dragon Colouring turned OFF can take a while.'
        : ''
    if (!boardsEqual(live.board, analysis.board)) {
      return {
        title: 'Analysing the grid…',
        detail: `Finding the techniques that apply to the new grid.${slowSettingsNote}`,
      }
    }
    if (!candidatesEqual(live.candidates, analysis.candidates)) {
      return {
        title: 'Updating techniques…',
        detail: `Re-checking which techniques apply to the current candidates.${slowSettingsNote}`,
      }
    }
    return {
      title: 'Applying settings…',
      detail: `Recomputing the techniques list with the new settings.${slowSettingsNote}`,
    }
  }, [analysisPending, liveAnalysisInputs, analysis])

  const techniqueInstances = useMemo(
    () =>
      buildTechniqueInstances(
        analysis.board,
        analysis.candidates,
        analysis.minBaseMedusaFilter ? MIN_BASE_MEDUSA_CANDIDATES : 0,
        analysis.effectiveAllowedRule3Techniques,
        analysis.shortAicEnabled,
        analysis.shortSingleDigitAicEnabled,
        analysis.aicLimitPerDragonStep,
        analysis.exhaustiveDragonColouring,
        analysis.genericAicEnabled,
        analysis.optimizeDragons,
        analysis.optimizeDynamicDragons,
        !analysis.dynamicDragonDisabled,
        analysis.enabledFish,
        analysis.alsXzEnabled,
      ),
    // Not keyed on `analysis` itself: easySolveEnabled (and the
    // solvability-only fields) changing mustn't redo this.
    [
      analysis.enabledFish,
      analysis.alsXzEnabled,
      analysis.board,
      analysis.candidates,
      analysis.minBaseMedusaFilter,
      analysis.effectiveAllowedRule3Techniques,
      analysis.shortAicEnabled,
      analysis.shortSingleDigitAicEnabled,
      analysis.aicLimitPerDragonStep,
      analysis.exhaustiveDragonColouring,
      analysis.genericAicEnabled,
      analysis.optimizeDragons,
      analysis.optimizeDynamicDragons,
      analysis.dynamicDragonDisabled,
    ],
  )
  // Looked up by id (rather than kept as its own state) so that if the
  // board changes underneath an active selection, it silently reflects the
  // fresh instance, or disappears if it no longer applies.
  const activeTechnique = techniqueInstances.find((t) => t.id === activeTechniqueId) ?? null
  // What the grid actually highlights/explains - the Techniques tab's own
  // selection, or (when the Solve Path tab is the one showing a selection)
  // that step's own captured instance, so selecting a solve-path row drives
  // the exact same highlight rendering a live Techniques click would,
  // rather than a separate path. Only one of the two tabs' selections is
  // ever "live" here, matching whichever tab is actually open.
  // The Find tab's result is tied to the grid it was found against: once the
  // board or candidates change it no longer applies, so it stops
  // highlighting and can't be applied until Find is pressed again.
  const findResultIsCurrent =
    findResult?.kind === 'found' &&
    boardsEqual(board, findResult.boardBefore) &&
    candidatesEqual(candidates, findResult.candidatesBefore)
  const findInstance = findResult?.kind === 'found' && findResultIsCurrent ? findResult.instance : null
  const highlightedTechnique =
    techniquePanelTab === 'solve-path'
      ? (activeSolvePathIndex !== null ? (solvePath?.steps[activeSolvePathIndex]?.instance ?? null) : null)
      : techniquePanelTab === 'find'
        ? findInstance
        : activeTechnique
  // The move currently on screen (current main step, clamped) - everything
  // below keys off this one move and, when it chained more than one
  // technique together, how many of its substeps are currently revealed.
  const currentDragonMove = useMemo(() => {
    const moves = highlightedTechnique?.moves
    if (!moves) {
      return null
    }
    return moves[Math.min(dragonStepIndex, moves.length - 1)]
  }, [highlightedTechnique, dragonStepIndex])
  // How many of currentDragonMove.substeps are currently revealed - null
  // (not navigating) defaults to "every substep", exactly the whole-chain
  // view this had before the substep player existed. A move with 0-1
  // substeps (every kind but a multi-technique extension-rule3) has
  // nothing to reveal incrementally, so these two are equivalent for it.
  const substeps: DragonRule3Substep[] | null = currentDragonMove?.substeps ?? null
  const maxSubstepIndex = substeps ? substeps.length - 1 : 0
  const visibleSubstepIndex = dragonSubstepIndex ?? maxSubstepIndex
  const atFinalSubstep = !substeps || substeps.length <= 1 || visibleSubstepIndex >= maxSubstepIndex
  const visibleSubsteps = substeps?.slice(0, visibleSubstepIndex + 1) ?? null
  // Dragon Colouring's colors/eliminations/solves come from folding its
  // move log up through the current step, not from static fields, since
  // which candidate has which color changes as the playback advances. The
  // current move's own conclusion (the cell it colours) is withheld until
  // its substep player (if it has one) reaches the final technique - see
  // foldDragonMoves' includeCurrentMove.
  const dragonHighlight = useMemo(
    () =>
      highlightedTechnique?.moves ? foldDragonMoves(highlightedTechnique.moves, dragonStepIndex, atFinalSubstep) : null,
    [highlightedTechnique, dragonStepIndex, atFinalSubstep],
  )
  // Dynamic Dragon Colouring's non-colouring technique(s) (a naked pair, a
  // Unique Rectangle, ...) only apply at their own single step - unlike the
  // colours/eliminations above, this isn't cumulative across main steps, so
  // it comes from just the one move currently on screen (and, within that
  // move, only as many substeps as are currently revealed), not the fold.
  const dragonTechniqueCellKeys = useMemo(() => {
    if (visibleSubsteps) {
      return new Set(visibleSubsteps.flatMap((s) => s.basisCells).map(([r, c]) => `${r},${c}`))
    }
    if (!currentDragonMove?.dynamicTechniqueCells) {
      return null
    }
    return new Set(currentDragonMove.dynamicTechniqueCells.map(([r, c]) => `${r},${c}`))
  }, [visibleSubsteps, currentDragonMove])
  // A Dragon mass elimination proven by an uncoloured cell that one side
  // would leave with no candidates gets the same yellow border 3D Medusa
  // gives its own emptied cell - only while that move is on screen.
  const dragonEmptiedCell = currentDragonMove?.emptiedCell ?? null
  // An AIC (either kind) used within this one Dynamic Dragon Colouring step
  // gets the same purple/curved-line treatment the standalone Short AIC
  // technique shows - also just the currently-revealed substeps, not folded
  // across main steps.
  const dragonAicChains = useMemo(() => {
    if (visibleSubsteps) {
      const chains = visibleSubsteps
        .filter((s): s is typeof s & { aic: NonNullable<(typeof s)['aic']> } => !!s.aic)
        .map((s) => ({ candidates: s.aic.candidates, links: s.aic.links, hypotheticalEliminations: s.eliminatedCandidates }))
      return chains.length > 0 ? chains : null
    }
    return currentDragonMove?.aicChains ?? null
  }, [visibleSubsteps, currentDragonMove])
  // Every "assumed" elimination across the currently-revealed substeps -
  // any Dynamic Dragon Colouring technique, not just an AIC: the same
  // hollow red circle + cross an AIC's own internal elimination always
  // got, generalized to every technique's own hypothetical deduction (a
  // Locked Candidate's, a naked pair's, ...), not just an AIC's.
  const dragonAssumedEliminations = useMemo(
    () => (visibleSubsteps ? visibleSubsteps.flatMap((s) => s.eliminatedCandidates) : null),
    [visibleSubsteps],
  )

  // True once the live board/candidates have drifted from what the cached
  // solve path's own next step expects (someone applied it out of order,
  // edited a cell by hand, undid something, etc.) - the remaining steps
  // were never recalculated against this new state, so they may no longer
  // make sense.
  const solvePathStale = useMemo(() => {
    if (!solvePath || solvePath.steps.length === 0) {
      return false
    }
    const nextStep = solvePath.steps[0]
    return !boardsEqual(board, nextStep.boardBefore) || !candidatesEqual(candidates, nextStep.candidatesBefore)
  }, [board, candidates, solvePath])

  // Every setting the Solve Path search (buildSolvePath) takes, in the plain
  // shape it's posted to its Web Worker in - shared by the solvability check
  // below and the Solve Path tab's Generate.
  const solvePathOptions = useMemo(
    (): SolvePathOptions => ({
      allowedRule3Techniques: [...effectiveAllowedRule3Techniques],
      shortAicEnabled,
      shortSingleDigitAicEnabled,
      aicLimitPerDragonStep,
      exhaustiveDragon: exhaustiveDragonColouring,
      genericAicEnabled,
      easySolveEnabled,
      optimizeDragons,
      optimizeDynamicDragons,
      timeBudgetMs: solvePathTimeoutMs,
      dynamicDragonEnabled: !dynamicDragonDisabled,
      enabledFish: [...enabledFish],
      alsXzEnabled,
    }),
    [
      enabledFish,
      alsXzEnabled,
      effectiveAllowedRule3Techniques,
      shortAicEnabled,
      shortSingleDigitAicEnabled,
      aicLimitPerDragonStep,
      exhaustiveDragonColouring,
      genericAicEnabled,
      easySolveEnabled,
      optimizeDragons,
      optimizeDynamicDragons,
      solvePathTimeoutMs,
      dynamicDragonDisabled,
    ],
  )

  // The expensive third part of the solvability status (see
  // puzzleSolveResult / candidatesAccurate further up): the Solve Path
  // search from a fresh autofill of the board. It can run for the whole
  // "Solve path timeout", which used to freeze the page solid on every board
  // change, so it runs in a Web Worker instead - the page stays usable and
  // the status line says "Checking…" until the answer comes back. Only the
  // board and settings matter to it, not the user's own candidate marks, so
  // this request object (and with it the search) only changes with those.
  const freshAutofill = useMemo(() => freshAutofillCandidates(board), [board])
  const solvabilityRequest = useMemo(
    () =>
      puzzleSolveResult.status === 'solved' && candidatesAccurate
        ? { board, candidates: freshAutofill, options: solvePathOptions }
        : null,
    [board, freshAutofill, puzzleSolveResult, candidatesAccurate, solvePathOptions],
  )
  const bruteSolvePath = useWorkerSolvePath(solvabilityRequest)

  // Only if that search got genuinely stuck: a second search from the user's
  // own marks, when they're accurate, complete (every empty cell has at least
  // one) and have eliminated something the autofill hasn't. Marks imported
  // from another site can carry eliminations from techniques this app lacks
  // (a Swordfish, say), and the Solve Path tab - which starts from the live
  // marks - would then solve a puzzle this status called "brute force". This
  // one does rerun on mark changes, but only in that already-stuck case.
  const marksSolvabilityRequest = useMemo(() => {
    if (!solvabilityRequest || bruteSolvePath?.stoppedReason !== 'stuck') {
      return null
    }
    let removesSomething = false
    for (const r of NINE) {
      for (const c of NINE) {
        if (board[r][c] !== 0) {
          continue
        }
        if (!candidates[r][c].some(Boolean)) {
          return null
        }
        if (freshAutofill[r][c].some((marked, i) => marked && !candidates[r][c][i])) {
          removesSomething = true
        }
      }
    }
    return removesSomething ? { board, candidates, options: solvabilityRequest.options } : null
  }, [solvabilityRequest, bruteSolvePath, board, candidates, freshAutofill])
  const marksSolvePath = useWorkerSolvePath(marksSolvabilityRequest)

  const solvabilityChecking = solvabilityRequest !== null && bruteSolvePath === null
  const marksSolvabilityChecking = marksSolvabilityRequest !== null && marksSolvePath === null
  const solvability = useMemo(
    () =>
      derivePuzzleSolvability(
        puzzleSolveResult.status,
        candidatesAccurate,
        solvabilityChecking ? 'checking' : bruteSolvePath,
        marksSolvabilityChecking ? 'checking' : marksSolvePath,
      ),
    [puzzleSolveResult, candidatesAccurate, solvabilityChecking, bruteSolvePath, marksSolvabilityChecking, marksSolvePath],
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
   * on a candidate the change just solved or eliminated.
   *
   * `nextSolvePath` bundles the cached Solve Path into this same undo
   * step - omit it (leave as undefined) to carry the current one forward
   * unchanged (an ordinary cell edit doesn't touch it), or pass a value
   * (including null, to clear it) when this specific action changes it,
   * so undoing this step restores the grid *and* the path together rather
   * than leaving them out of sync. */
  function commitGrid(
    next: Omit<GridState, 'candidateColors'> & { candidateColors?: CandidateColorGrid },
    nextSolvePath?: SolvePathResult | null,
  ) {
    const resolved: GridState = {
      board: next.board,
      givens: next.givens,
      candidates: next.candidates,
      candidateColors: sanitizeCandidateColors(next.candidateColors ?? grid.candidateColors, next.board, next.candidates),
    }
    const resolvedSolvePath = nextSolvePath === undefined ? solvePath : nextSolvePath
    const truncated = historyEntries.slice(0, historyIndex + 1)
    setGrid(resolved)
    setSolvePath(resolvedSolvePath)
    setHistoryEntries([...truncated, { grid: resolved, solvePath: resolvedSolvePath }])
    setHistoryIndex(truncated.length)
  }

  /** Same as commitGrid, but also drops any cached solve path - used only
   * by the Auto-solve buttons, since they change the grid through a
   * completely different route than the Solve Path tab's own step-by-step
   * apply, and the cached path has no way to know it needs to account for
   * that. The user has to Regenerate afterward, same as any other
   * out-of-band edit. */
  // The current render's grid and commitGrid, for work that finishes after
  // later renders (Web Worker searches, OCR): the functions captured when
  // that work started would commit onto a stale grid and undo history,
  // silently discarding any edit made while it ran.
  const latestRef = useRef({ grid, commitGrid })
  useLayoutEffect(() => {
    latestRef.current = { grid, commitGrid }
  })

  function commitAutoSolve(next: Omit<GridState, 'candidateColors'> & { candidateColors?: CandidateColorGrid }) {
    commitGrid(next, null)
  }

  /** Runs one long operation under the global busy indicator (and progress
   * cursor): shown first, the work started only once that has been painted
   * (see afterPaint - most of this work is synchronous and blocks the page),
   * and removed in a `finally`, so it goes away the moment the work
   * finishes, throws, or is cancelled. `work` handles its own errors and
   * status messages; one that still escapes is reported generically. */
  function runBusyTask(kind: BusyTaskKind, task: BusyTask, work: () => void | Promise<void>) {
    const id = nextBusyTaskId++
    setBusyTasks((current) => [...current, { ...task, id, kind }])
    afterPaint(async () => {
      try {
        await work()
      } catch {
        setStatus(`${task.title.replace(/…$/, '')} failed.`)
      } finally {
        setBusyTasks((current) => current.filter((t) => t.id !== id))
      }
    })
  }

  function undo() {
    if (!canUndo) {
      setStatus('Nothing to undo.')
      return
    }
    const nextIndex = historyIndex - 1
    setGrid(historyEntries[nextIndex].grid)
    setSolvePath(historyEntries[nextIndex].solvePath)
    setActiveSolvePathIndex(null)
    setHistoryIndex(nextIndex)
    setStatus('Undid last action.')
  }

  function redo() {
    if (!canRedo) {
      setStatus('Nothing to redo.')
      return
    }
    const nextIndex = historyIndex + 1
    setGrid(historyEntries[nextIndex].grid)
    setSolvePath(historyEntries[nextIndex].solvePath)
    setActiveSolvePathIndex(null)
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

    commitAutoSolve({ board: nextBoard, givens, candidates: nextCandidates })
    setStatus(`Filled ${assignments.length} ${assignments.length === 1 ? singularLabel : pluralLabel}.`)
  }

  function onLockedCandidates() {
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus(
        'Locked candidates needs every empty cell to have its candidates marked first — try Autofill all.',
      )
      return
    }

    const eliminations = lockedCandidateFinder.findEliminations(board, candidates)
    if (eliminations.length === 0) {
      setStatus('No locked candidates to eliminate.')
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of eliminations) {
      nextCandidates[row][col][digit - 1] = false
    }

    commitAutoSolve({ board, givens, candidates: nextCandidates })
    setStatus(
      `Eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'} via locked candidates.`,
    )
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

    commitAutoSolve({ board, givens, candidates: nextCandidates })
    setStatus(
      `Eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'} via naked pairs.`,
    )
  }

  function onNakedTriples() {
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus(
        'Naked triples needs every empty cell to have its candidates marked first — try Autofill all.',
      )
      return
    }

    const eliminations = nakedSubsetFinder.findNakedTripleEliminations(board, candidates)
    if (eliminations.length === 0) {
      setStatus('No naked triples to eliminate.')
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of eliminations) {
      nextCandidates[row][col][digit - 1] = false
    }

    commitAutoSolve({ board, givens, candidates: nextCandidates })
    setStatus(
      `Eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'} via naked triples.`,
    )
  }

  function onNakedQuads() {
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus(
        'Naked quads needs every empty cell to have its candidates marked first — try Autofill all.',
      )
      return
    }

    const eliminations = nakedSubsetFinder.findNakedQuadEliminations(board, candidates)
    if (eliminations.length === 0) {
      setStatus('No naked quads to eliminate.')
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of eliminations) {
      nextCandidates[row][col][digit - 1] = false
    }

    commitAutoSolve({ board, givens, candidates: nextCandidates })
    setStatus(
      `Eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'} via naked quads.`,
    )
  }

  function onHiddenPairs() {
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus(
        'Hidden pairs needs every empty cell to have its candidates marked first — try Autofill all.',
      )
      return
    }

    const eliminations = hiddenPairFinder.findHiddenPairEliminations(board, candidates)
    if (eliminations.length === 0) {
      setStatus('No hidden pairs to eliminate.')
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of eliminations) {
      nextCandidates[row][col][digit - 1] = false
    }

    commitAutoSolve({ board, givens, candidates: nextCandidates })
    setStatus(
      `Eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'} via hidden pairs.`,
    )
  }

  function onUniqueRectangleType1() {
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus('Unique Rectangle needs every empty cell to have its candidates marked first — try Autofill all.')
      return
    }

    const instances = uniqueRectangleFinder.find(board, candidates)
    if (instances.length === 0) {
      setStatus('No Unique Rectangle deductions to apply.')
      return
    }

    const solvedByCell = new Map<string, { row: number; col: number; digit: number }>()
    const eliminatedByCell = new Map<string, { row: number; col: number; digit: number }>()
    for (const ur of instances) {
      for (const { row, col, digit } of ur.solvedCandidates) {
        solvedByCell.set(`${row},${col}`, { row, col, digit })
      }
      for (const { row, col, digit } of ur.eliminatedCandidates) {
        eliminatedByCell.set(`${row},${col},${digit}`, { row, col, digit })
      }
    }

    const solvedAssignments = Array.from(solvedByCell.values())
    const eliminations = Array.from(eliminatedByCell.values())

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

    commitAutoSolve({ board: nextBoard, givens, candidates: nextCandidates })

    const parts: string[] = []
    if (solvedAssignments.length > 0) {
      parts.push(`solved ${solvedAssignments.length} cell${solvedAssignments.length === 1 ? '' : 's'}`)
    }
    if (eliminations.length > 0) {
      parts.push(`eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'}`)
    }
    setStatus(`Unique Rectangle ${parts.join(' and ')}.`)
  }

  function onBugPlusOne() {
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus('BUG+1 needs every empty cell to have its candidates marked first — try Autofill all.')
      return
    }

    const bugPlusOne = bugPlusOneFinder.find(board, candidates)
    if (!bugPlusOne) {
      setStatus('No BUG+1 to apply - not every unsolved cell is bivalue except one.')
      return
    }

    const [row, col] = bugPlusOne.cell
    const nextBoard = cloneBoard(board)
    nextBoard[row][col] = bugPlusOne.solvedDigit
    const nextCandidates = cloneCandidates(candidates)
    nextCandidates[row][col] = Array(9).fill(false)
    SudokuRules.eliminatePeerCandidates(nextCandidates, nextBoard, row, col, bugPlusOne.solvedDigit)

    commitAutoSolve({ board: nextBoard, givens, candidates: nextCandidates })
    setStatus(`BUG+1 solved ${cellRef(row, col)} as ${bugPlusOne.solvedDigit}.`)
  }

  function onBivalueOddagon() {
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus('Bivalue Oddagon needs every empty cell to have its candidates marked first — try Autofill all.')
      return
    }

    const instances = bivalueOddagonFinder.find(board, candidates)
    if (instances.length === 0) {
      setStatus('No Bivalue Oddagon deductions to apply.')
      return
    }

    const solvedByCell = new Map<string, { row: number; col: number; digit: number }>()
    const eliminatedByCell = new Map<string, { row: number; col: number; digit: number }>()
    for (const oddagon of instances) {
      if (oddagon.solvedCell) {
        const [row, col] = oddagon.solvedCell
        solvedByCell.set(`${row},${col}`, { row, col, digit: oddagon.guardianDigit })
      }
      for (const { row, col, digit } of oddagon.eliminations) {
        eliminatedByCell.set(`${row},${col},${digit}`, { row, col, digit })
      }
    }

    const solvedAssignments = Array.from(solvedByCell.values())
    const eliminations = Array.from(eliminatedByCell.values())

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

    commitAutoSolve({ board: nextBoard, givens, candidates: nextCandidates })

    const parts: string[] = []
    if (solvedAssignments.length > 0) {
      parts.push(`solved ${solvedAssignments.length} cell${solvedAssignments.length === 1 ? '' : 's'}`)
    }
    if (eliminations.length > 0) {
      parts.push(`eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'}`)
    }
    setStatus(`Bivalue Oddagon ${parts.join(' and ')}.`)
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

    commitAutoSolve({ board: nextBoard, givens, candidates: nextCandidates })

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

  function onShortSingleDigitAic() {
    if (!shortSingleDigitAicEnabled) {
      setStatus('Short Single-Digit AIC is turned off in Settings.')
      return
    }
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus('Short Single-Digit AIC needs every empty cell to have its candidates marked first — try Autofill all.')
      return
    }

    const eliminations = computeShortAicEliminationsByKind(board, candidates, 'single-digit')
    if (eliminations.length === 0) {
      setStatus('No short single-digit AIC eliminations to apply.')
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of eliminations) {
      nextCandidates[row][col][digit - 1] = false
    }

    commitAutoSolve({ board, givens, candidates: nextCandidates })
    setStatus(
      `Eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'} via short single-digit AIC.`,
    )
  }

  function onShortAic() {
    if (!shortAicEnabled) {
      setStatus('Short AIC is turned off in Settings.')
      return
    }
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus('Short AIC needs every empty cell to have its candidates marked first — try Autofill all.')
      return
    }

    const eliminations = computeShortAicEliminationsByKind(board, candidates, 'general')
    if (eliminations.length === 0) {
      setStatus('No short AIC eliminations to apply.')
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of eliminations) {
      nextCandidates[row][col][digit - 1] = false
    }

    commitAutoSolve({ board, givens, candidates: nextCandidates })
    setStatus(
      `Eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'} via short AIC.`,
    )
  }

  function onGenericAic() {
    if (!genericAicEnabled) {
      setStatus('Generic AIC is turned off in Settings.')
      return
    }
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus('Generic AIC needs every empty cell to have its candidates marked first — try Autofill all.')
      return
    }

    const eliminations = computeGenericAicEliminations(board, candidates)
    if (eliminations.length === 0) {
      setStatus('No generic AIC eliminations to apply.')
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of eliminations) {
      nextCandidates[row][col][digit - 1] = false
    }

    commitAutoSolve({ board, givens, candidates: nextCandidates })
    setStatus(
      `Eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'} via generic AIC.`,
    )
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

    commitAutoSolve({ board: nextBoard, givens, candidates: nextCandidates })

    const parts: string[] = []
    if (solvedAssignments.length > 0) {
      parts.push(`solved ${solvedAssignments.length} cell${solvedAssignments.length === 1 ? '' : 's'}`)
    }
    if (eliminations.length > 0) {
      parts.push(`eliminated ${eliminations.length} candidate${eliminations.length === 1 ? '' : 's'}`)
    }
    setStatus(`3D Medusa ${parts.join(' and ')}.`)
  }

  function runDragonColouring(
    compute: (board: Board, candidates: CandidateGrid, filter: DragonChainFilter) => Array<{ moves: DragonMove[] }>,
    filter: DragonChainFilter,
    label: string,
  ) {
    const solvedByCell = new Map<string, { row: number; col: number; digit: number }>()
    const eliminatedByCell = new Map<string, { row: number; col: number; digit: number }>()

    for (const { moves } of compute(board, candidates, filter)) {
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

    commitAutoSolve({ board: nextBoard, givens, candidates: nextCandidates })

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
    runDragonColouring(
      (b, c, f) => computeStuckDragonExtensions(b, c, f, 0, exhaustiveDragonColouring, optimizeDragons),
      'bivalue-seeded',
      'Dragon Colouring (bivalue-seeded)',
    )
  }

  function onDragonColouringAny() {
    runDragonColouring(
      (b, c, f) => computeStuckDragonExtensions(b, c, f, 0, exhaustiveDragonColouring, optimizeDragons),
      'any',
      'Dragon Colouring (any Medusa)',
    )
  }

  function onDynamicDragonColouring() {
    runDragonColouring(
      (b, c, f) => {
        const results = computeStuckDynamicDragonExtensions(
          b,
          c,
          f,
          0,
          effectiveAllowedRule3Techniques,
          aicLimitPerDragonStep,
          exhaustiveDragonColouring,
          optimizeDragons,
          optimizeDynamicDragons,
        )
        // ALS-xz is never auto-solved, not even inside a Dynamic Dragon
        // chain - no setting opts back in.
        const withoutAlsXz = results.filter(
          ({ moves }) => !moves.some((move) => (move.dynamicTechniques ?? []).includes('als-xz')),
        )
        if (dynamicDragonAutoSolveIncludesAics) {
          return withoutAlsXz
        }
        // Default: a chain whose steps needed an AIC (either kind) anywhere
        // is left entirely untouched by auto-solve, even if AICs are
        // otherwise enabled for Dynamic Dragon Colouring - the "Dynamic
        // Dragon Colouring auto-solve includes AICs?" setting is what
        // opts back in.
        return withoutAlsXz.filter(
          ({ moves }) =>
            !moves.some((move) =>
              (move.dynamicTechniques ?? []).some(
                (t) => t === 'short aic' || t === 'short single-digit aic' || t === 'generic aic',
              ),
            ),
        )
      },
      'any',
      'Dynamic Dragon Colouring',
    )
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

  function toggleMinBaseMedusaFilter() {
    setMinBaseMedusaFilter((current) => !current)
  }

  function toggleGridWhiteMode() {
    setGridWhiteMode((current) => !current)
  }

  /** 'naked pair' has no checkbox - it's always allowed - so this is never
   * called with it, but the check stays as a safety net against a future
   * checkbox for it being added by mistake. */
  function toggleRule3Technique(technique: Rule3Technique) {
    if (technique === 'naked pair') {
      return
    }
    setAllowedRule3Techniques((current) => {
      const next = new Set(current)
      if (next.has(technique)) {
        next.delete(technique)
      } else {
        next.add(technique)
      }
      return next
    })
  }

  function toggleShortAicEnabled() {
    if (shortAicEnabled) {
      // Generic AIC builds on Short AIC, so it can't outlive it either.
      setShortAicEnabled(false)
      setGenericAicEnabled(false)
      // Nothing left to not-disregard.
      setDragonGenerationDisregardsAic(true)
      setDragonGenerationDisregardsGenericAic(true)
      return
    }
    if (!shortSingleDigitAicEnabled) {
      return
    }
      setShortAicEnabled(true)
      // Enabling a technique also stops Dragon generation from disregarding
      // it. "Disregards AIC" can only be off while "disregards single-digit
      // AIC" is too (see toggleDragonGenerationDisregardsAic), so both go.
      setDragonGenerationDisregardsSingleDigitAic(false)
      setDragonGenerationDisregardsAic(false)
    // Update:  No longer wants this: A blocking dialog is fine here: it's a rare, deliberate settings
    // change, and cancelling just leaves the (controlled) checkbox unchecked.
    // const confirmed = window.confirm(
    //   'Generating Dragon Colouring puzzles will take longer with this setting enabled.  Are you sure you want to turn this ON?',
    // )
    // if (confirmed) {
    //   setShortAicEnabled(true)
    // }
  }

  function toggleShortSingleDigitAicEnabled() {
    if (shortSingleDigitAicEnabled) {
      // Short AIC builds on Single-Digit AIC, so it can't outlive it.
      setShortSingleDigitAicEnabled(false)
      setShortAicEnabled(false)
      setGenericAicEnabled(false)
      setDragonGenerationDisregardsSingleDigitAic(true)
      setDragonGenerationDisregardsAic(true)
      setDragonGenerationDisregardsGenericAic(true)
      return
    }
    setShortSingleDigitAicEnabled(true)
    // Enabling a technique also stops Dragon generation from disregarding it.
    setDragonGenerationDisregardsSingleDigitAic(false)
  }

  function toggleGenericAicEnabled() {
    if (genericAicEnabled) {
      setGenericAicEnabled(false)
      setDragonGenerationDisregardsGenericAic(true)
      return
    }
    if (!shortAicEnabled) {
      return
    }

    setGenericAicEnabled(true)
    // Enabling a technique also stops Dragon generation from disregarding
    // it - and "disregards Generic AIC" can only be off while both the
    // single-digit and short "disregards" are too, so all three go.
    setDragonGenerationDisregardsSingleDigitAic(false)
    setDragonGenerationDisregardsAic(false)
    setDragonGenerationDisregardsGenericAic(false)
    // Same rare, deliberate settings change as Short AIC's - and the same
    // cost: with this on, every generated puzzle is also checked for long chains.
    // const confirmed = window.confirm(
    //   `Generic AIC searches chains of up to ${GENERIC_AIC_MAX_LENGTH} links, and generating Dragon Colouring puzzles will take longer with this setting enabled.  Are you sure you want to turn this ON?`,
    // )
    // if (confirmed) {
    //   setGenericAicEnabled(true)
    // }
  }

  function toggleDragonGenerationDisregardsSingleDigitAic() {
    if (dragonGenerationDisregardsSingleDigitAic) {
      if (shortSingleDigitAicEnabled) {
        setDragonGenerationDisregardsSingleDigitAic(false)
      }
      return
    }
    setDragonGenerationDisregardsSingleDigitAic(true)
    // Disregarding general AIC is only valid on top of disregarding
    // single-digit AIC, so switching this back on carries it along (and,
    // likewise, Generic AIC's on top of that).
    setDragonGenerationDisregardsAic(true)
    setDragonGenerationDisregardsGenericAic(true)
  }

  function toggleDragonGenerationDisregardsAic() {
    if (dragonGenerationDisregardsAic) {
      if (!dragonGenerationDisregardsSingleDigitAic && shortAicEnabled) {
        setDragonGenerationDisregardsAic(false)
      }
      return
    }
    setDragonGenerationDisregardsAic(true)
    setDragonGenerationDisregardsGenericAic(true)
  }

  function toggleDragonGenerationDisregardsGenericAic() {
    if (dragonGenerationDisregardsGenericAic) {
      if (!dragonGenerationDisregardsAic && genericAicEnabled) {
        setDragonGenerationDisregardsGenericAic(false)
      }
      return
    }
    setDragonGenerationDisregardsGenericAic(true)
  }

  function toggleAicLimitPerDragonStep() {
    setAicLimitPerDragonStep((current) => !current)
  }

  /** Puts every user-adjustable setting back to its default: everything in
   * DEFAULT_SETTINGS plus the custom candidate paint colours (which are
   * saved to localStorage by the effect above, so this overwrites what was
   * saved too). Deliberately leaves the puzzle, undo history, the current
   * selection, and the technique currently being viewed alone - those are
   * work in progress, not settings. */
  function resetSettingsToDefaults() {
    setKeyboardMode(DEFAULT_SETTINGS.keyboardMode)
    setShowStrongLinks(DEFAULT_SETTINGS.showStrongLinks)
    setShowBivalueCells(DEFAULT_SETTINGS.showBivalueCells)
    setGridWhiteMode(DEFAULT_SETTINGS.gridWhiteMode)
    setMinBaseMedusaFilter(DEFAULT_SETTINGS.minBaseMedusaFilter)
    setShortSingleDigitAicEnabled(DEFAULT_SETTINGS.shortSingleDigitAicEnabled)
    setShortAicEnabled(DEFAULT_SETTINGS.shortAicEnabled)
    setGenericAicEnabled(DEFAULT_SETTINGS.genericAicEnabled)
    setXWingEnabled(DEFAULT_SETTINGS.xWingEnabled)
    setFinnedXWingEnabled(DEFAULT_SETTINGS.finnedXWingEnabled)
    setSwordfishEnabled(DEFAULT_SETTINGS.swordfishEnabled)
    setFinnedSwordfishEnabled(DEFAULT_SETTINGS.finnedSwordfishEnabled)
    setAlsXzEnabled(DEFAULT_SETTINGS.alsXzEnabled)
    setDynamicDragonDisabled(DEFAULT_SETTINGS.dynamicDragonDisabled)
    setAllowedRule3Techniques(new Set(DEFAULT_SETTINGS.allowedRule3Techniques))
    setExhaustiveDragonColouring(DEFAULT_SETTINGS.exhaustiveDragonColouring)
    setOptimizeDragons(DEFAULT_SETTINGS.optimizeDragons)
    setOptimizeDynamicDragons(DEFAULT_SETTINGS.optimizeDynamicDragons)
    setEasySolveEnabled(DEFAULT_SETTINGS.easySolveEnabled)
    setSolvePathTimeoutMs(DEFAULT_SETTINGS.solvePathTimeoutMs)
    setAicLimitPerDragonStep(DEFAULT_SETTINGS.aicLimitPerDragonStep)
    setDynamicDragonAutoSolveIncludesAics(DEFAULT_SETTINGS.dynamicDragonAutoSolveIncludesAics)
    setDragonGenerationDisregardsSingleDigitAic(DEFAULT_SETTINGS.dragonGenerationDisregardsSingleDigitAic)
    setDragonGenerationDisregardsAic(DEFAULT_SETTINGS.dragonGenerationDisregardsAic)
    setDragonGenerationDisregardsGenericAic(DEFAULT_SETTINGS.dragonGenerationDisregardsGenericAic)
    setDynamicDragonPuzzleForbidsPlainDragon(DEFAULT_SETTINGS.dynamicDragonPuzzleForbidsPlainDragon)
    setDragonGenerationTimeoutMs(DEFAULT_SETTINGS.dragonGenerationTimeoutMs)
    setSwatchColors(defaultSwatchColors())
    showToast('Settings reset to defaults.')
  }

  function toggleExhaustiveDragonColouring() {
    setExhaustiveDragonColouring((current) => !current)
  }

  function toggleOptimizeDragons() {
    setOptimizeDragons((current) => !current)
  }

  function toggleOptimizeDynamicDragons() {
    if (optimizeDynamicDragons) {
      setOptimizeDynamicDragons(false)
      return
    }
    // Branching on every Extension Rule 3 move is expensive enough on its
    // own; with Exhaustive OFF each of those branches also re-runs far more
    // chains, and all of it happens live on every grid change. Asking first
    // is fine for a rare, deliberate settings change - cancelling just
    // leaves the (controlled) checkbox unchecked.
    if (!exhaustiveDragonColouring) {
      setConfirmOptimizeDynamicOpen(true)
      return
    }
    setOptimizeDynamicDragons(true)
  }

  function toggleEasySolveEnabled() {
    setEasySolveEnabled((current) => !current)
  }

  function toggleDynamicDragonAutoSolveIncludesAics() {
    setDynamicDragonAutoSolveIncludesAics((current) => !current)
  }

  function onDragonGenerationTimeoutChange(event: ChangeEvent<HTMLSelectElement>) {
    setDragonGenerationTimeoutMs(Number(event.target.value))
  }

  function onSelectTechnique(id: string) {
    setActiveTechniqueId((current) => (current === id ? null : id))
    setDragonStepIndex(0)
    setDragonSubstepIndex(null)
  }

  function onTechniquePanelTabChange(tab: TechniquePanelTab) {
    setTechniquePanelTab(tab)
    if (tab === 'find') {
      setDragonStepIndex(0)
      setDragonSubstepIndex(null)
    }
  }

  function onSelectSolvePathStep(index: number) {
    setActiveSolvePathIndex((current) => (current === index ? null : index))
    setDragonStepIndex(0)
    setDragonSubstepIndex(null)
  }

  function onDragonStep(delta: number) {
    const maxIndex = (highlightedTechnique?.moves?.length ?? 1) - 1
    setDragonStepIndex((current) => Math.min(maxIndex, Math.max(0, current + delta)))
    // A different main step is a different move, with its own (possibly
    // absent) substeps - always restart that move's substep player at
    // "fully revealed" rather than carrying over an index from whichever
    // move was on screen before.
    setDragonSubstepIndex(null)
  }

  /** The substep player under the current move (see DragonStepper) -
   * separate from, and independent of, onDragonStep above: it never moves
   * the main step index, only how many of the current step's own chained
   * techniques are revealed. */
  function onDragonSubstep(delta: number) {
    const maxIndex = (currentDragonMove?.substeps?.length ?? 1) - 1
    setDragonSubstepIndex((current) => Math.min(maxIndex, Math.max(0, (current ?? maxIndex) + delta)))
  }

  /** Commits the selected technique's own full effect - for a plain
   * technique that's its own eliminated/solved candidates; for a Dragon
   * Colouring or Dynamic Dragon Colouring row, its *entire* move chain
   * folded to the end, regardless of which step the player is currently
   * showing. The stepper is purely a walkthrough aid - Apply always
   * commits the whole technique, the same as it counts as a single step
   * everywhere else (the Solve Path search, "one step per Dragon chain"). */
  function onApplySelectedTechnique() {
    if (!activeTechnique) {
      return
    }
    const { eliminatedCandidates, solvedCandidates } = fullTechniqueEffect(activeTechnique)
    if (eliminatedCandidates.length === 0 && solvedCandidates.length === 0) {
      setStatus('Nothing to apply - this technique has no effect.')
      return
    }

    const next = applyTechniqueEffect(board, candidates, { eliminatedCandidates, solvedCandidates })
    commitGrid({ board: next.board, givens, candidates: next.candidates })
    setStatus(`Applied ${activeTechnique.name}.`)
  }

  /** Applies the selected solve-path step's own precomputed effect
   * directly to the live grid - no jump to the Techniques tab, no
   * re-selecting anything there. Selecting a step other than the first
   * one means everything ahead of it hasn't been applied yet, so Apply
   * replays every step up to and including the selected one, in order
   * (each one's own full effect, same as a Dragon row - see
   * fullTechniqueEffect), not just the one that's selected. All of them
   * are then dropped from the cached path (so whatever came after becomes
   * the new first step) without recalculating the rest - see
   * solvePathStale for what happens if that leaves the remaining steps
   * out of sync with the live grid. */
  function onApplySolvePathStep() {
    if (!solvePath || activeSolvePathIndex === null) {
      return
    }
    const stepsToApply = solvePath.steps.slice(0, activeSolvePathIndex + 1)
    let curBoard = board
    let curCandidates = candidates
    for (const step of stepsToApply) {
      const next = applyTechniqueEffect(curBoard, curCandidates, fullTechniqueEffect(step.instance))
      curBoard = next.board
      curCandidates = next.candidates
    }
    const remainingSolvePath = { ...solvePath, steps: solvePath.steps.slice(activeSolvePathIndex + 1) }
    commitGrid({ board: curBoard, givens, candidates: curCandidates }, remainingSolvePath)
    setActiveSolvePathIndex(null)
    const lastStep = stepsToApply[stepsToApply.length - 1]
    setStatus(
      stepsToApply.length === 1
        ? `Applied solve path step: ${lastStep.instance.name}.`
        : `Applied ${stepsToApply.length} solve path steps (through "${lastStep.instance.name}").`,
    )
  }

  /** The Auto-solve buttons whose finders can be slow (AICs, Medusa, and
   * above all the Dragon family, which extend every stuck chain) run under
   * the busy indicator; the cheap ones before them are instant and don't. */
  function runAutoSolve(techniqueName: string, action: () => void) {
    runBusyTask(
      'auto-solve',
      {
        title: `Applying ${techniqueName}…`,
        detail: `Finding every ${techniqueName} deduction on the grid and applying them all at once.`,
      },
      action,
    )
  }

  /** The Find tab's Find button: the search below always runs with Exhaustive
   * and Optimize Dragons on, over every stuck chain, so it can take a while. */
  function runFindTargetedDragon() {
    runBusyTask(
      'find',
      {
        title: 'Searching for the shortest Dragon…',
        detail: 'Searching for the shortest Dragon to perform the desired elimination(s).',
      },
      onFindTargetedDragon,
    )
  }

  /** Find by elims: turns the candidates typed into the Find tab into the
   * Dragon or Dynamic Dragon Colouring that eliminates them (see
   * SudokuDragonTargetFinder for how the best one is chosen), or - when the
   * input can't be used, is wrong, or nothing finds it - says why in plain
   * words. The entries are checked before any searching: readable, actually
   * marked as candidates on the grid, and (when the puzzle has one solution)
   * not the true digit of their cell. */
  function onFindTargetedDragon() {
    setDragonStepIndex(0)
    setDragonSubstepIndex(null)
    const say = (tone: 'error' | 'info', title: string, lines: string[] = []) =>
      setFindResult({ kind: 'message', tone, title, lines })

    if (!hasAnyCandidates) {
      say('info', 'This needs candidates on the grid.', ['Click "Autofill all" first, then try again.'])
      return
    }
    const { targets, unreadable } = parseEliminationTargets(findInput)
    if (unreadable.length > 0) {
      say('error', "I couldn't read some of that.", [
        `Not understood: ${unreadable.join(', ')}`,
        'Each candidate should look like 8r2c3: the digit, then the row, then the column.',
      ])
      return
    }
    if (targets.length === 0) {
      say('info', 'Type at least one candidate to eliminate.', ['For example: 8r2c3, 2r3c4'])
      return
    }
    if (!candidatesAccurate) {
      say('error', "The candidates on the grid don't look right.", [
        "Some cell's correct digit isn't marked as a candidate, so a Dragon found from them couldn't be trusted.",
        'Try "Autofill all", then enter your eliminations again.',
      ])
      return
    }

    const solution = puzzleSolveResult.status === 'solved' ? puzzleSolveResult.board : null
    const problems = checkEliminationTargets(board, candidates, targets, solution)
    if (problems.length > 0) {
      say(
        'error',
        problems.length === 1 ? "That one can't be eliminated as entered." : "Some of those can't be eliminated as entered.",
        problems.map(describeTargetProblem),
      )
      return
    }

    const note = solution
      ? undefined
      : "This puzzle doesn't have exactly one solution, so your eliminations couldn't be double-checked - they were taken as correct."
    const search = dragonTargetFinder.find(board, candidates, targets, {
      allowedRule3Techniques: effectiveAllowedRule3Techniques,
      aicLimitPerStep: aicLimitPerDragonStep,
      optimizeDynamic: optimizeDynamicDragons,
      dynamicEnabled: !dynamicDragonDisabled,
    })

    const best = search.best
    if (!best) {
      const lines: string[] = []
      if (search.chainsTried === 0) {
        lines.push(
          'A Dragon starts from a 3D Medusa that is stuck (finds nothing on its own), and there is none on this grid right now.',
        )
      } else if (targets.length > 1) {
        targets.forEach((target, i) => {
          lines.push(
            `${formatCandidate(target)}: ${search.individually[i] ? 'a Dragon can find this one on its own' : 'no Dragon finds this one'}`,
          )
        })
        if (search.individually.every(Boolean)) {
          lines.push('Each can be found separately, but no single Dragon gets them all - try entering fewer at a time.')
        }
      } else {
        lines.push('No Dragon reaches it - it probably needs a different technique.')
      }
      lines.push('Only the techniques enabled in Settings are used.')
      if (note) lines.push(note)
      say(
        'info',
        `No ${dynamicDragonDisabled ? 'Dragon Colouring (Dynamic Dragons are disabled)' : 'Dragon or Dynamic Dragon Colouring'} finds ${targets.length === 1 ? 'that elimination' : 'all of those eliminations'}.`,
        lines,
      )
      return
    }

    const name = best.kind === 'dragon' ? 'Dragon Colouring' : dynamicDragonLabel(best.moves)
    const instance: TechniqueInstance = {
      ...buildDragonInstance(board, candidates, best.kind === 'dragon' ? 'dragon' : 'dynamic-dragon', name, best.chainKey, best.moves),
      // The cells you asked about get the same yellow border Medusa rules use,
      // so they stay easy to find while the colouring builds up.
      medusaHighlightCells: targets.map((t) => [t.row, t.col] as const),
    }
    const previewLimit = 10
    setFindResult({
      kind: 'found',
      instance,
      extraCount: best.extras.length,
      extras: best.extras.slice(0, previewLimit).map(formatCandidate),
      note,
      boardBefore: board,
      candidatesBefore: candidates,
    })
    setStatus(`Found ${name} (${best.moves.length} steps) for ${targets.length} elimination${targets.length === 1 ? '' : 's'}.`)
  }

  /** Commits the Find tab's technique - its full effect, like a Dragon row in
   * the Techniques list - and clears the result, since the grid it was found
   * against no longer exists. */
  function onApplyFoundTechnique() {
    if (!findInstance) {
      return
    }
    const effect = fullTechniqueEffect(findInstance)
    const removed = countEffectiveEliminations(board, candidates, effect)
    const next = applyTechniqueEffect(board, candidates, effect)
    commitGrid({ board: next.board, givens, candidates: next.candidates })
    setFindResult(null)
    setFindInput('')
    setStatus(`Applied ${findInstance.name}: removed ${removed} candidate${removed === 1 ? '' : 's'}.`)
  }

  function onApplyPanelSelection() {
    if (techniquePanelTab === 'solve-path') {
      onApplySolvePathStep()
    } else if (techniquePanelTab === 'find') {
      onApplyFoundTechnique()
    } else {
      onApplySelectedTechnique()
    }
  }

  /** Generate/Regenerate: runs the search fresh from the live board/
   * candidates, replacing whatever solve path was cached before (if
   * any). This is the only thing (besides an auto-solve action clearing
   * it outright) that ever changes the cached path - a normal grid edit,
   * or applying a step from this same tab, does not. */
  /** Generating (or regenerating) is itself a history step, even though
   * the grid doesn't change - otherwise undoing an Apply would skip right
   * past it to whatever the path looked like before it was ever
   * generated, instead of restoring it to what it was immediately before
   * that Apply. */
  function onGenerateSolvePath() {
    const controller = new AbortController()
    setStatus('Calculating solve path…')
    runBusyTask(
      'solve-path',
      {
        title: 'Calculating solve path…',
        detail: `Searching for a step-by-step solve${easySolveEnabled ? ' using the easiest technique at each step' : ''} - stops after ${solvePathTimeoutLabel()} at most.`,
        onCancel: () => controller.abort(),
      },
      async () => {
        try {
          // In a Web Worker: the page stays usable while it runs, which also
          // means the grid can change before it's done - see latestRef.
          const nextSolvePath = await solvePathInWorker(board, candidates, solvePathOptions, controller.signal)
          const { commitGrid: commitLatest, grid: latestGrid } = latestRef.current
          // Recorded against whatever the grid is *now*; if that's no longer
          // the grid it was searched from, the Solve Path tab flags it as
          // stale, same as any other edit made after generating.
          commitLatest(
            { board: latestGrid.board, givens: latestGrid.givens, candidates: latestGrid.candidates },
            nextSolvePath,
          )
          setActiveSolvePathIndex(null)
          setStatus(
            nextSolvePath.solvedFully
              ? `Solve path found: ${nextSolvePath.steps.length} step(s) to a full solve.`
              : `Solve path stopped after ${nextSolvePath.steps.length} step(s) (${nextSolvePath.stoppedReason}).`,
          )
        } catch {
          setStatus(controller.signal.aborted ? 'Solve path calculation cancelled.' : 'Solve path calculation failed.')
        }
      },
    )
  }

  function solvePathTimeoutLabel(): string {
    return (
      SOLVE_PATH_TIMEOUT_OPTIONS.find((option) => option.ms === solvePathTimeoutMs)?.label ??
      `${Math.round(solvePathTimeoutMs / 1000)} seconds`
    )
  }

  function onSolvePathTimeoutChange(event: ChangeEvent<HTMLSelectElement>) {
    setSolvePathTimeoutMs(Number(event.target.value))
  }

  function onToggleSolvePathLog() {
    setShowSolvePathLog((current) => !current)
  }

  function onCellClick(row: number, col: number) {
    if (selected?.row === row && selected?.col === col) {
      setSelected(null)
      setHighlightedDigit(null)
      return
    }
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

  function onSwatchColorChange(id: CandidateColor, hex: string) {
    setSwatchColors((current) => ({ ...current, [id]: hex }))
  }

  /** Un-paints every manually coloured candidate on the board - the
   * swatch colours themselves (and which one is selected) are untouched. */
  function onClearAllCandidateColors() {
    commitGrid({ board, givens, candidates, candidateColors: createEmptyCandidateColors() })
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
      const suffix = givens[row][col] ? ', given' : conflictedCells.has(`${row},${col}`) ? ', conflicts with another cell' : ''
      return `${value}, ${position}${suffix}`
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

  function showToast(message: string) {
    setToastMessage(message)
    window.setTimeout(() => setToastMessage((current) => (current === message ? null : current)), 2200)
  }

  async function onExportToSudokuCoach() {
    let exported: string
    try {
      exported = await importer.exportToSudokuCoachState(board, givens, candidates)
    } catch {
      setStatus('Could not export this puzzle.')
      return
    }
    try {
      await navigator.clipboard.writeText(exported)
      showToast('Copied to clipboard!')
    } catch {
      setStatus("Couldn't access the clipboard - here's the puzzle string to copy manually:")
      setImportText(exported)
    }
  }

  /** Reads a screenshot of a Sudoku grid (dropped or pasted) and rebuilds
   * the board from it, colour and any overlaid lines/arrows ignored -
   * only which pixels are darker than their own cell's background is
   * ever asked. Like the SudokuWiki text-board import, a screenshot has
   * no way to tell an original given apart from a cell you'd already
   * solved yourself, so nothing comes back locked. */
  function onImportImage(file: File) {
    setStatus('Reading screenshot…')
    runBusyTask(
      'ocr',
      {
        title: 'Reading screenshot…',
        detail: 'Finding the grid and recognising its digits - the first read also loads the text recogniser.',
      },
      async () => {
        try {
          const image = await CanvasGridImage.fromBlob(file)
          const result = await ocrGrid(image, recognizeDigit)
          const solvedCount = result.board.flat().filter((v) => v !== 0).length
          const unrecognizedCount = result.cells.filter((c) => c.unrecognizedSolvedDigit).length
          if (solvedCount === 0 && unrecognizedCount === 0) {
            setStatus("Couldn't find a Sudoku grid in that image.")
            return
          }
          latestRef.current.commitGrid({
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
        }
      },
    )
  }

  function onImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setOcrDragActive(false)
    const file = Array.from(event.dataTransfer.files).find((f) => f.type.startsWith('image/'))
    if (file) {
      onImportImage(file)
    }
  }

  function onImagePaste(event: ClipboardEvent<HTMLDivElement>) {
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith('image/'))
      ?.getAsFile()
    if (file) {
      event.preventDefault()
      onImportImage(file)
    }
  }

  function onImageFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      onImportImage(file)
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
    setStatus('Solving…')
    runBusyTask(
      'solve',
      { title: 'Solving…', detail: 'Brute-force solving the grid and checking it has exactly one solution.' },
      () => {
        try {
          const response = solver.solve(board)
          if (response.solved && response.board) {
            commitGrid({ board: response.board, givens, candidates: createEmptyCandidates() })
          }
          setStatus(response.message)
        } catch {
          setStatus('Solve failed.')
        }
      },
    )
  }

  function onClear() {
    const empty = createEmptyBoard()
    commitGrid({ board: empty, givens: computeGivenMask(empty), candidates: createEmptyCandidates() })
    setHighlightedDigit(null)
    setStatus('Board cleared.')
  }

  function onNewPuzzle() {
    setStatus('Generating a new puzzle…')
    runBusyTask(
      'generate',
      { title: 'Generating a new puzzle…', detail: 'Building a random puzzle with exactly one solution.' },
      () => {
        try {
          const puzzle = generator.generate()
          commitGrid({ board: puzzle, givens: computeGivenMask(puzzle), candidates: createEmptyCandidates() })
          setHighlightedDigit(null)
          setStatus('New puzzle loaded. Click Solve to check it.')
        } catch {
          setStatus('Puzzle generation failed.')
        }
      },
    )
  }

  /** Shared by the practice-puzzle generators, which all search random grids
   * in Web Workers (generateDragonPuzzleInParallel) - so, unlike everything
   * else under the busy indicator, the page stays responsive and the search
   * can be cancelled from the indicator. `generate` gets the AbortSignal
   * that Cancel fires. */
  function runPracticePuzzleGeneration(
    title: string,
    generate: (signal: AbortSignal) => Promise<GeneratedDragonPuzzle | null> | GeneratedDragonPuzzle | null,
    loadedStatus: string,
    fromStock = false,
  ) {
    const controller = new AbortController()
    setStatus(title)
    runBusyTask(
      'generate',
      fromStock
        ? { title, detail: 'Picking one from the pre-generated collection.' }
        : {
            title,
            detail: `Generating desired puzzle... gives up after ${dragonGenerationTimeoutLabel()}.`,
            onCancel: () => controller.abort(),
          },
      async () => {
        try {
          const result = await generate(controller.signal)
          if (controller.signal.aborted) {
            setStatus('Puzzle generation cancelled.')
            return
          }
          if (!result) {
            setStatus(
              `Couldn't find one within ${dragonGenerationTimeoutLabel()} - try again, or raise the timeout in Settings.`,
            )
            return
          }
          // Candidates come from the generator itself, already reflecting the
          // point where every easier technique is exhausted - re-autofilling
          // here would just rebuild the same candidates it already checked
          // against, not undo them.
          latestRef.current.commitGrid({ board: result.board, givens: result.givens, candidates: result.candidates })
          setHighlightedDigit(null)
          setStatus(loadedStatus)
        } catch {
          setStatus('Puzzle generation failed.')
        }
      },
    )
  }

  /** Simple Colouring / 3D Medusa practice puzzles: a state where that
   * technique is the easiest move (see DragonPuzzleGenerateOptions.target).
   * AIC checks are skipped for these, so the "Dragon Generation disregards"
   * settings don't apply; these are common enough to find in about a second. */
  function onNewColouringPuzzle(target: 'simple-colouring' | 'medusa') {
    const techniqueName = target === 'simple-colouring' ? 'Simple Colouring' : '3D Medusa'
    runPracticePuzzleGeneration(
      `Generating a puzzle that needs ${techniqueName}…`,
      (signal) =>
        generateDragonPuzzleInParallel(
          { target, timeBudgetMs: dragonGenerationTimeoutMs, enabledFish: [...enabledFish], alsXzEnabled },
          signal,
        ),
      `New puzzle loaded: ${techniqueName} is the easiest technique that can make progress.`,
    )
  }

  function onNewDragonPuzzle() {
    runPracticePuzzleGeneration(
      'Generating a puzzle that needs Dragon Colouring…',
      (signal) =>
        generateDragonPuzzleInParallel(
          {
            timeBudgetMs: dragonGenerationTimeoutMs,
            disregardSingleDigitAic: dragonGenerationDisregardsSingleDigitAic,
            disregardAic: dragonGenerationDisregardsAic,
            disregardGenericAic: dragonGenerationDisregardsGenericAic,
            enabledFish: [...enabledFish],
            alsXzEnabled,
          },
          signal,
        ),
      'New puzzle loaded: every easier technique gets stuck before Dragon Colouring is needed.',
    )
  }

  function onNewDynamicDragonPuzzle() {
    const options: DragonPuzzleGenerateOptions = {
      requireDynamic: true,
      timeBudgetMs: dragonGenerationTimeoutMs,
      disregardSingleDigitAic: dragonGenerationDisregardsSingleDigitAic,
      disregardAic: dragonGenerationDisregardsAic,
      disregardGenericAic: dragonGenerationDisregardsGenericAic,
      enabledFish: [...enabledFish],
      alsXzEnabled,
    }
    runPracticePuzzleGeneration(
      'Generating a puzzle that needs Dynamic Dragon Colouring…',
      // "Must not allow plain Dragon" positions are too rare to find live
      // (minutes each), so they come from the pre-generated stock instead.
      (signal) =>
        dynamicDragonPuzzleForbidsPlainDragon
          ? pickStockDynamicDragonPuzzle(options)
          : generateDragonPuzzleInParallel(options, signal),
      dynamicDragonPuzzleForbidsPlainDragon
        ? 'New puzzle loaded: plain Dragon Colouring is stuck on every chain - only Dynamic Dragon Colouring can continue.'
        : 'New puzzle loaded: a puzzle state that contains at least one Dynamic Dragon Colouring technique.',
      dynamicDragonPuzzleForbidsPlainDragon,
    )
  }

  function dragonGenerationTimeoutLabel(): string {
    return (
      DRAGON_GENERATION_TIMEOUT_OPTIONS.find((option) => option.ms === dragonGenerationTimeoutMs)?.label ??
      `${Math.round(dragonGenerationTimeoutMs / 1000)}s`
    )
  }

  // The page is assembled from these pieces twice: the desktop layout
  // below (unchanged - three columns around the grid), and the touch layout
  // (useCompactLayout), which pins the grid and puts every control group
  // behind one of the dock's tabs. Both reuse the exact same elements.
  const header = (
    <header className="header">
      <h1>
        Sudoku Colouring Solver/Trainer <span className="app-version">{APP_VERSION}</span>
      </h1>
      <p>
        Advanced Sudoku solver and trainer emphasizing Colouring techniques, such as Dragon Colouring. <div></div>
        For the Colouring enthusiasts, click{' '}
        <button type="button" className="header-link" onClick={() => setTutorialOpen(true)}>
          Techniques overview
        </button>{' '}
        for a quick overview.
      </p>
    </header>
  )

  const toolbar = (
    <div className="main-toolbar">
      <div className="toolbar-group">
        <button type="button" onClick={undo} disabled={busy || !canUndo}>
          Undo
        </button>
        <button type="button" onClick={redo} disabled={busy || !canRedo}>
          Redo
        </button>
        {/* On a phone, Clear grid / Techniques overview / ? move into the
            "⋯" menu at the end so the toolbar stays one row - every row
            above the grid comes out of the dock's height. */}
        {!phone && (
          <button type="button" onClick={onClear} disabled={busy}>
            Clear grid
          </button>
        )}
      </div>

      <div className="toolbar-group toolbar-group-end">
        {!phone && (
          <>
            <button
              type="button"
              className="how-it-works-trigger"
              title="Learn the colouring techniques, step by step"
              onClick={() => setTutorialOpen(true)}
            >
              Techniques overview
            </button>
            <button
              type="button"
              className="help-button"
              aria-label="Open the settings guide"
              aria-haspopup="dialog"
              title="What do the settings do?"
              onClick={() => setHelpOpen(true)}
            >
              ?
            </button>
          </>
        )}
        <DropdownMenu
          label={
            <>
              {generating ? (
                'Generating…'
              ) : (
                <>
                  {phone ? 'Generate' : 'Generate Puzzle'}
                  {/* <span
                    style={{
                      fontSize: '0.45em',
                      verticalAlign: 'top',
                      marginLeft: '4px',
                      opacity: 0.7,
                    }}
                  >
                    ALPHA
                  </span> */}
                </>
              )}{' '}
              <span className="dropdown-caret">▾</span>
            </>
          }
          buttonClassName="generate-puzzle-trigger"
        >
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">Puzzle type</h3>
            <button type="button" className="dropdown-item" onClick={onNewPuzzle} disabled={busy}>
              Random puzzle
            </button>
            <button
              type="button"
              className="dropdown-item"
              onClick={() => onNewColouringPuzzle('simple-colouring')}
              disabled={busy}
              title="Generates a puzzle state where Simple Colouring is the easiest technique that can make progress (AICs are not considered)"
            >
              Simple Colouring practice puzzle
            </button>
            <button
              type="button"
              className="dropdown-item"
              onClick={() => onNewColouringPuzzle('medusa')}
              disabled={busy}
              title="Generates a puzzle state where 3D Medusa is the easiest technique that can make progress (AICs are not considered)"
            >
              3D Medusa practice puzzle
            </button>
            <button
              type="button"
              className="dropdown-item"
              onClick={onNewDragonPuzzle}
              disabled={busy}
              title="Generates a puzzle state where the next move requires Dragon Colouring"
            >
              Dragon Colouring practice puzzle
            </button>
            <button
              type="button"
              className="dropdown-item"
              onClick={onNewDynamicDragonPuzzle}
              disabled={busy || dynamicDragonDisabled}
              title={
                dynamicDragonDisabled
                  ? 'Dynamic Dragons are disabled in Dragon Configuration'
                  : 'Generates a puzzle state that includes dynamic Dragon Colouring'
              }
            >
              Dynamic Dragon Colouring practice puzzle
            </button>
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">Puzzle generation</h3>
            <label
              className="menu-checkbox"
              title={
                shortSingleDigitAicEnabled
                  ? 'When on, a generated Dragon or Dynamic Dragon puzzle state may also have a Short Single-Digit AIC available. When off, generation rejects any state where one exists.'
                  : 'Always on while Short Single-Digit AIC is disabled - enable it in Settings to turn this off.'
              }
            >
              <input
                type="checkbox"
                checked={dragonGenerationDisregardsSingleDigitAic}
                disabled={!shortSingleDigitAicEnabled}
                onChange={toggleDragonGenerationDisregardsSingleDigitAic}
              />
              Dragon Generation disregards single digit AIC
            </label>
            <label
              className="menu-checkbox"
              title={
                !shortAicEnabled
                  ? 'Always on while Short AIC is disabled - enable it in Settings to turn this off.'
                  : dragonGenerationDisregardsSingleDigitAic
                    ? 'Always on while "Dragon Generation disregards single digit AIC" is on - turn that off first.'
                    : 'When on, a generated Dragon or Dynamic Dragon puzzle state may also have a Short AIC available. When off, generation rejects any state where one exists.'
              }
            >
              <input
                type="checkbox"
                checked={dragonGenerationDisregardsAic}
                disabled={!shortAicEnabled || dragonGenerationDisregardsSingleDigitAic}
                onChange={toggleDragonGenerationDisregardsAic}
              />
              Dragon Generation disregards AIC
            </label>
            <label
              className="menu-checkbox"
              title={
                !genericAicEnabled
                  ? 'Always on while Generic AIC is disabled - enable it in Settings to turn this off.'
                  : dragonGenerationDisregardsAic
                    ? 'Always on while "Dragon Generation disregards AIC" is on - turn that off first.'
                    : 'When on, a generated Dragon or Dynamic Dragon puzzle state may also have a Generic AIC available. When off, generation rejects any state where one exists.'
              }
            >
              <input
                type="checkbox"
                checked={dragonGenerationDisregardsGenericAic}
                disabled={!genericAicEnabled || dragonGenerationDisregardsAic}
                onChange={toggleDragonGenerationDisregardsGenericAic}
              />
              Dragon Generation disregards Generic AIC
            </label>
            <label
              className="menu-checkbox"
              title="When on, a Dynamic Dragon puzzle is a state where plain Dragon Colouring is stuck on every chain, so Dynamic Dragon is the only way forward. These are too rare to generate live, so one is picked instantly from a built-in stock instead. When off, plain Dragon may still work on some other chain."
            >
              <input
                type="checkbox"
                checked={dynamicDragonPuzzleForbidsPlainDragon}
                onChange={() => setDynamicDragonPuzzleForbidsPlainDragon((value) => !value)}
              />
              Dynamic Dragon puzzles must not allow plain Dragon
            </label>
            <label
              className="menu-select"
              title="Dynamic Dragon Puzzles are rare and might take anywhere from 5 seconds to 2 minutes to find one. This setting sets the timeout before giving up."
            >
              Dragon puzzle generation max timeout
              <select value={dragonGenerationTimeoutMs} onChange={onDragonGenerationTimeoutChange}>
                {DRAGON_GENERATION_TIMEOUT_OPTIONS.map(({ label, ms }) => (
                  <option key={ms} value={ms}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </DropdownMenu>

        <DropdownMenu
          label={
            phone ? (
              '🐉'
            ) : (
              <>
                Dragon Configuration <span className="dropdown-caret">▾</span>
              </>
            )
          }
          ariaLabel={phone ? 'Dragon Configuration' : undefined}
          buttonClassName="dragon-config-trigger"
          align="right"
        >
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">Dragon Colouring</h3>
            <label
              className="menu-checkbox"
              title="When on, Dragon Colouring (plain and Dynamic) keeps going after an elimination that doesn't settle which colour is true: the elimination is applied, and the colouring continues from there (promotions first) until a colour is proven false, the grid is fully coloured, or nothing more can be found. When off, it stops at the first elimination it finds."
            >
              <input
                type="checkbox"
                checked={exhaustiveDragonColouring}
                onChange={toggleExhaustiveDragonColouring}
              />
              Exhaustive Dragon Colouring
            </label>
            <label
              className="menu-checkbox"
              title="When on, Dragon Colouring (plain and Dynamic) looks for the elimination(s) it can reach from each Medusa base with the fewest dragon colour extensions, extending whichever colour gets there quickest instead of making the two colours take turns. When off, the two colours take turns to extend."
            >
              <input type="checkbox" checked={optimizeDragons} onChange={toggleOptimizeDragons} />
              Optimize Dragons
            </label>
            <label
              className="menu-checkbox"
              title={`Only show Dragon Colouring techniques with a Medusa base of at least ${MIN_BASE_MEDUSA_CANDIDATES} coloured candidates`}
            >
              <input type="checkbox" checked={minBaseMedusaFilter} onChange={toggleMinBaseMedusaFilter} />
              Dragon: require {MIN_BASE_MEDUSA_CANDIDATES}+ base Medusa candidates
            </label>
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">Dynamic Dragon Colouring</h3>
            <label
              className="menu-checkbox"
              title={
                dynamicDragonDisabled ? 'Dynamic Dragons are disabled, so this has no effect' : 'When on, Dynamic Dragons are searched for the fewest colour extensions like Optimize Dragons, but also trying every candidate the Dynamic techniques can force at each step, not just the first one found. Finds much shorter Dynamic Dragons; noticeably slower, especially with AICs enabled. Also applies to Find by elims.'
              }
            >
              <input
                type="checkbox"
                checked={optimizeDynamicDragons}
                disabled={dynamicDragonDisabled}
                onChange={toggleOptimizeDynamicDragons}
              />
              Optimize Dynamic Dragons
            </label>
            <label
              className="menu-checkbox"
              title={
                dynamicDragonDisabled ? 'Dynamic Dragons are disabled, so this has no effect' : 'When on, if AIC is enabled, at most one AIC may be chained into a single Dynamic Dragon Colouring step; when off, there is no limit.'
              }
            >
              <input
                type="checkbox"
                checked={aicLimitPerDragonStep}
                disabled={dynamicDragonDisabled}
                onChange={toggleAicLimitPerDragonStep}
              />
              Limit to 1 AIC per step
            </label>
            <label
              className="menu-checkbox"
              title={
                dynamicDragonDisabled ? 'Dynamic Dragons are disabled, so this has no effect' : 'When off, clicking the Dynamic Dragon Colouring auto-solve button skips Dragons whose steps needed an AIC, even if AICs are enabled in Settings.'
              }
            >
              <input
                type="checkbox"
                checked={dynamicDragonAutoSolveIncludesAics}
                disabled={dynamicDragonDisabled}
                onChange={toggleDynamicDragonAutoSolveIncludesAics}
              />
              Auto-solve includes AICs
            </label>
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">Select Dynamic Dragon Colouring techniques</h3>
            <p className="dropdown-hint">
              Which non-colouring techniques Dynamic Dragon Colouring may use to find extensions, for both puzzle generation and solving.
            </p>
            <label
              className="menu-checkbox"
              title="When on, Dynamic Dragon Colouring is not used anywhere - the Techniques list, Solve Path, the Solvable check, Find by elims, auto-solve and puzzle generation - so plain Dragon Colouring is the strongest technique."
            >
              <input
                type="checkbox"
                checked={dynamicDragonDisabled}
                onChange={() => setDynamicDragonDisabled((value) => !value)}
              />
              Disable Dynamic Dragons
            </label>
            {ALL_RULE3_TECHNIQUES.map((technique) => {
              const disabledByMasterSwitch =
                ((ALL_FISH_TECHNIQUES as readonly Rule3Technique[]).includes(technique) &&
                  !enabledFish.has(technique as FishTechnique)) ||
                (technique === 'short aic' && !shortAicEnabled) ||
                (technique === 'generic aic' && !genericAicEnabled) ||
                (technique === 'als-xz' && !alsXzEnabled) ||
                (technique === 'short single-digit aic' && !shortSingleDigitAicEnabled)
              return (
                <label
                  key={technique}
                  className="menu-checkbox"
                  title={
                    dynamicDragonDisabled
                      ? 'Dynamic Dragons are disabled, so this has no effect'
                      : disabledByMasterSwitch
                        ? `${RULE3_TECHNIQUE_LABELS[technique]} is turned off in Settings, so this has no effect`
                        : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={allowedRule3Techniques.has(technique)}
                    disabled={
                      technique === 'naked pair' ||
                      technique === 'hidden single' ||
                      technique === 'locked candidate' ||
                      disabledByMasterSwitch ||
                      dynamicDragonDisabled
                    }
                    onChange={() => toggleRule3Technique(technique)}
                  />
                  {RULE3_TECHNIQUE_LABELS[technique]}
                </label>
              )
            })}
          </div>
        </DropdownMenu>

        <DropdownMenu
          label={phone ? '⚙' : '⚙ Settings'}
          ariaLabel={phone ? 'Settings' : undefined}
          buttonClassName="settings-trigger"
          panelClassName="settings-panel"
          align="right"
        >
          <div className="dropdown-section">
            <button
              type="button"
              className="dropdown-item"
              onClick={resetSettingsToDefaults}
              title="Puts every setting, including your custom paint colours, back to its default. Your puzzle is not touched."
            >
              Reset to defaults
            </button>
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">Keyboard input</h3>
            <button
              type="button"
              className={['mode-toggle', keyboardMode].join(' ')}
              aria-pressed={keyboardMode === 'candidate'}
              onClick={toggleKeyboardMode}
            >
              Toggle input: <strong>{keyboardMode === 'solution' ? 'Solution' : 'Candidates'}</strong>
            </button>
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">Display &amp; hints</h3>
            <label className="menu-checkbox">
              <input type="checkbox" checked={showStrongLinks} onChange={toggleStrongLinks} />
              Show strong links
            </label>
            <label className="menu-checkbox">
              <input type="checkbox" checked={showBivalueCells} onChange={toggleBivalueCells} />
              Show bivalue cells
            </label>
            <label
              className="menu-checkbox"
              title="Toggle the grid's colour scheme between light and dark modes"
            >
              <input type="checkbox" checked={gridWhiteMode} onChange={toggleGridWhiteMode} />
              Light mode for grid
            </label>
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">Techniques</h3>
            <label
              className="menu-checkbox"
              title="When off, the solver will not look for Short Single-Digit AIC chains at all. Disable this for a true Colouring experience."
            >
              <input
                type="checkbox"
                checked={shortSingleDigitAicEnabled}
                onChange={toggleShortSingleDigitAicEnabled}
              />
              Enable Short Single-Digit AIC
            </label>
            <label
              className="menu-checkbox"
              title={
                shortSingleDigitAicEnabled
                  ? 'When off, the solver will not look for Short AIC chains at all. Disable this for a true Colouring experience.'
                  : 'Turn on Enable Short Single-Digit AIC first - Short AIC can only be enabled with it.'
              }
            >
              <input
                type="checkbox"
                checked={shortAicEnabled}
                disabled={!shortSingleDigitAicEnabled}
                onChange={toggleShortAicEnabled}
              />
              Enable Short AIC
            </label>
            <label
              className="menu-checkbox"
              title={
                shortAicEnabled
                  ? `When off, the solver will not look for Generic AIC chains (longer than Short AIC's, up to ${GENERIC_AIC_MAX_LENGTH} links) at all.`
                  : 'Turn on Enable Short AIC first - Generic AIC can only be enabled with it.'
              }
            >
              <input
                type="checkbox"
                checked={genericAicEnabled}
                disabled={!shortAicEnabled}
                onChange={toggleGenericAicEnabled}
              />
              Enable Generic AIC
            </label>
            {(
              [
                ['x-wing', xWingEnabled, setXWingEnabled],
                ['finned x-wing', finnedXWingEnabled, setFinnedXWingEnabled],
                ['swordfish', swordfishEnabled, setSwordfishEnabled],
                ['finned swordfish', finnedSwordfishEnabled, setFinnedSwordfishEnabled],
              ] as const
            ).map(([fish, enabled, setEnabled]) => (
              <label
                key={fish}
                className="menu-checkbox"
                title={`When on, the solver looks for ${FISH_TECHNIQUE_NAMES[fish]} patterns. It can then also be allowed inside Dynamic Dragon Colouring (Dragon Configuration menu).`}
              >
                <input type="checkbox" checked={enabled} onChange={() => setEnabled((value) => !value)} />
                Enable {FISH_TECHNIQUE_NAMES[fish]}
              </label>
            ))}
            <label
              className="menu-checkbox"
              title="When on, the solver looks for ALS-xz. It can then also be allowed inside Dynamic Dragon Colouring (Dragon Configuration menu)."
            >
              <input type="checkbox" checked={alsXzEnabled} onChange={() => setAlsXzEnabled((value) => !value)} />
              Enable ALS-xz
            </label>
          </div>
        </DropdownMenu>
        {phone && (
          <DropdownMenu
            label="⋯"
            ariaLabel="More"
            buttonClassName="more-trigger"
            align="right"
            closeOnItemClick
          >
            {/* The page title, hidden above the toolbar on a phone. */}
            <h3 className="dropdown-section-title">
              Sudoku Colouring Solver/Trainer {APP_VERSION}
            </h3>
            <button type="button" className="dropdown-item" onClick={onClear} disabled={busy}>
              Clear grid
            </button>
            <button
              type="button"
              className="dropdown-item"
              title="Learn the colouring techniques, step by step"
              onClick={() => setTutorialOpen(true)}
            >
              Techniques overview
            </button>
            <button type="button" className="dropdown-item" onClick={() => setHelpOpen(true)}>
              Settings guide (?)
            </button>
          </DropdownMenu>
        )}
      </div>
    </div>
  )

  const techniquePanel = (
    <TechniquePanel
      tab={techniquePanelTab}
      onTabChange={onTechniquePanelTabChange}
      instances={techniqueInstances}
      activeId={activeTechniqueId}
      onSelect={onSelectTechnique}
      dragonStepIndex={dragonStepIndex}
      onDragonStep={onDragonStep}
      dragonSubstepIndex={dragonSubstepIndex}
      onDragonSubstep={onDragonSubstep}
      solvePath={solvePath}
      activeSolvePathIndex={activeSolvePathIndex}
      onSelectSolvePathStep={onSelectSolvePathStep}
      onApply={onApplyPanelSelection}
      canApply={
        techniquePanelTab === 'solve-path'
          ? activeSolvePathIndex !== null
          : techniquePanelTab === 'find'
            ? !!findInstance
            : !!activeTechniqueId
      }
      onGenerateSolvePath={onGenerateSolvePath}
      solvePathStale={solvePathStale}
      showSolvePathLog={showSolvePathLog}
      onToggleSolvePathLog={onToggleSolvePathLog}
      solvability={solvability}
      find={{
        input: findInput,
        onInput: setFindInput,
        onFind: runFindTargetedDragon,
        result: findResult,
        resultIsCurrent: findResultIsCurrent,
      }}
      easySolveEnabled={easySolveEnabled}
      onToggleEasySolve={toggleEasySolveEnabled}
      solvePathTimeoutMs={solvePathTimeoutMs}
      onSolvePathTimeoutChange={onSolvePathTimeoutChange}
    />
  )

  const gridElement = (
    <div
      className={['grid', gridWhiteMode ? 'grid-white-mode' : ''].filter(Boolean).join(' ')}
      role="grid"
      aria-label="Sudoku board"
      tabIndex={0}
    >
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
                highlightedTechnique?.usedCells.some(([ur, uc]) => ur === r && uc === c) ?? false
              const isBivalueCell = bivalueCells.has(`${r},${c}`)
              const isDragonTechniqueCell = dragonTechniqueCellKeys?.has(`${r},${c}`) ?? false
              const isMedusaHighlightCell =
                (highlightedTechnique?.medusaHighlightCells?.some(([hr, hc]) => hr === r && hc === c) ?? false) ||
                (dragonEmptiedCell?.[0] === r && dragonEmptiedCell?.[1] === c)
              const isConflictCell = conflictedCells.has(`${r},${c}`)
              const classes = [
                'cell',
                givens[r][c] ? 'given' : value ? 'filled' : '',
                isSelected ? 'selected' : '',
                isDigitHighlighted ? 'digit-highlighted' : '',
                isBivalueCell ? 'bivalue-highlighted' : '',
                isTechniqueCell ? 'technique-used' : '',
                isMedusaHighlightCell ? 'medusa-highlight-cell' : '',
                isDragonTechniqueCell ? 'dragon-technique-cell' : '',
                isConflictCell ? 'conflict' : '',
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
                          (highlightedTechnique?.usedCandidates.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        const eliminatedSource = dragonHighlight?.eliminatedCandidates ?? highlightedTechnique?.eliminatedCandidates
                        const isTechniqueEliminated =
                          active &&
                          (eliminatedSource?.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        const solvedSource = dragonHighlight?.solvedCandidates ?? highlightedTechnique?.solvedCandidates
                        const isTechniqueSolved =
                          active &&
                          (solvedSource?.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        const blueSource = dragonHighlight?.blueCandidates ?? highlightedTechnique?.blueCandidates
                        const isTechniqueBlue =
                          active &&
                          (blueSource?.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        const yellowSource = dragonHighlight?.yellowCandidates ?? highlightedTechnique?.yellowCandidates
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
                        const aicCandidateSource = dragonAicChains
                          ? dragonAicChains.flatMap((chain) => chain.candidates)
                          : highlightedTechnique?.aicCandidates
                        const isTechniqueAic =
                          active &&
                          (aicCandidateSource?.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        // A Dynamic Dragon Colouring step's own
                        // technique (any of them - a Locked Candidate,
                        // a naked pair, an AIC, ...) eliminates a
                        // candidate purely as an internal deduction its
                        // reasoning depends on, not a real board
                        // elimination this move claims - shown as a
                        // hollow circle+cross instead of the usual red
                        // elimination pip (see
                        // technique-hypothetical-elimination in
                        // App.css).
                        const isTechniqueHypotheticalElimination =
                          active &&
                          (dragonAssumedEliminations?.some(
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
                          isTechniqueOrange ||
                          isTechniqueAic ||
                          isTechniqueHypotheticalElimination
                        // A manually painted colour is a pure user
                        // annotation - it only shows through when no
                        // technique highlight is already claiming this
                        // pip's background, so the two never fight.
                        const paintedColorId = active && !isTechniqueColored ? candidateColors[r][c][digit - 1] : null
                        const paintedHex = paintedColorId
                          ? candidateColorSwatches.find((s) => s.id === paintedColorId)?.hex
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
                              isTechniqueAic ? 'technique-aic' : '',
                              isTechniqueHypotheticalElimination ? 'technique-hypothetical-elimination' : '',
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

      {(() => {
        const aicLinks = dragonAicChains ? dragonAicChains.flatMap((chain) => chain.links) : highlightedTechnique?.aicLinks
        if (!aicLinks || aicLinks.length === 0) {
          return null
        }
        return (
          <svg className="aic-links" viewBox="0 0 900 900" aria-hidden="true">
            {aicLinks.map((link, index) => {
              const p1 = pipCenter(link.from.row, link.from.col, link.from.digit)
              const p2 = pipCenter(link.to.row, link.to.col, link.to.digit)
              return (
                <path
                  key={index}
                  className={link.kind === 'strong' ? 'aic-link-strong' : 'aic-link-weak'}
                  d={curvedPath(p1, p2)}
                />
              )
            })}
          </svg>
        )
      })()}

    </div>
  )

  const importRows = (
    <>
      <div className="import-row">
        <textarea
          className="import-input"
          placeholder="Paste a 81-char string, or Sudoku.Coach puzzle string, or SudokuWiki.org text format..."
          rows={1}
          value={importText}
          disabled={busy}
          onChange={(event) => setImportText(event.target.value)}
        />
        <button type="button" onClick={onImport} disabled={busy || importText.trim().length === 0}>
          Import
        </button>
      </div>

      <div className="import-secondary-row">
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
              : 'Drag & drop or paste a Sudoku grid screenshot, or '}
          </span>
          {!ocrBusy && (
            <label className="image-import-browse">
              browse for an image
              <input type="file" accept="image/*" onChange={onImageFileSelected} disabled={busy} />
            </label>
          )}
        </div>
        <button
          type="button"
          className="copy-sc-button"
          onClick={onExportToSudokuCoach}
          disabled={busy}
          title="Copies a Sudoku.Coach puzzle string for the current grid to your clipboard"
        >
          Copy SC puzzle string
        </button>
      </div>
    </>
  )

  const solutionGroup = (
    <section className="control-group solution-group">
      {/* Each group's one "undo this section" action sits in the header,
          right of the title, rather than as a stray button under the pad -
          the old placement rendered as an unpadded, left-hugging sliver and
          cost a whole row of height per group. */}
      <div className="control-header">
        <h2 className="control-label">Solution</h2>
        <button
          type="button"
          className="control-header-action"
          disabled={!selected || selectedIsLocked}
          onClick={() => selected && clearCell(selected.row, selected.col)}
          title="Erase the selected cell's digit"
        >
          Erase
        </button>
      </div>
      <DigitPad
        variant="solution"
        isDisabled={() => !selected || selectedIsLocked}
        onSelect={(digit) => selected && setCellValue(selected.row, selected.col, digit)}
      />
    </section>
  )

  const candidateGroup = (
    <section className="control-group candidate-group">
      <div className="control-header">
        <h2 className="control-label">Candidates</h2>
        <button
          type="button"
          className="control-header-action"
          disabled={!selected || selectedIsLocked || selectedIsSolved}
          onClick={() => selected && clearCandidates(selected.row, selected.col)}
          title="Remove every candidate from the selected cell"
        >
          Clear cell
        </button>
      </div>
      <DigitPad
        variant="candidate"
        isDisabled={() => !selected || selectedIsLocked || selectedIsSolved}
        onSelect={(digit) => selected && toggleCandidate(selected.row, selected.col, digit)}
      />
      <div className="candidate-bulk-actions">
        <button
          type="button"
          className="bulk-action-button"
          disabled={busy || filled === 81}
          onClick={onAutofillCandidates}
          title="Fill in every possible candidate for every empty cell"
        >
          Autofill all
        </button>
        <button
          type="button"
          className="bulk-action-button"
          disabled={busy || !hasAnyCandidates}
          onClick={onClearAllCandidates}
          title="Remove every candidate from the whole grid"
        >
          Clear all
        </button>
      </div>
    </section>
  )

  const paintGroup = (
    <section className="control-group paint-group">
      <div className="control-header">
        <h2 className="control-label">Candidate Colours</h2>
        <button
          type="button"
          className="control-header-action"
          disabled={!hasAnyPaintedColor}
          onClick={onClearAllCandidateColors}
          title="Remove every candidate colour from the grid"
        >
          Clear all
        </button>
      </div>
      <div className="paint-swatches">
        {candidateColorSwatches.map((swatch) => (
          <div key={swatch.id} className="paint-swatch-wrapper">
            <button
              type="button"
              className={['paint-swatch', paintColor === swatch.id ? 'active' : ''].filter(Boolean).join(' ')}
              style={{ backgroundColor: swatch.hex }}
              aria-pressed={paintColor === swatch.id}
              aria-label={swatch.label}
              title={swatch.label}
              onClick={() => onSelectPaintColor(swatch.id)}
            />
            {/* A small "edit" badge pinned to the swatch's corner, rather
                than a separate strip below it - the previous layout read
                as a decorative sliver, not a control, so customizing a
                colour went undiscovered. The pencil icon is a
                pointer-events-none overlay purely for the visual cue;
                the actual native colour-picker input sits right beneath
                it, same size and position, and still owns the click. */}
            <span className="paint-swatch-edit-icon" aria-hidden="true">
              ✎
            </span>
            <input
              type="color"
              className="paint-swatch-color-input"
              value={swatch.hex}
              onChange={(event) => onSwatchColorChange(swatch.id, event.target.value)}
              aria-label={`Customize ${swatch.label} colour`}
              title={`Customize ${swatch.label} colour`}
            />
          </div>
        ))}
      </div>
      <p className="paint-hint">
        {paintColor
          ? 'Click a candidate to colour or uncolour it.'
          : 'Pick a colour, then click candidates to colour them.'}
      </p>
    </section>
  )

  const highlightGroup = (
    <section className="control-group highlight-group">
      <div className="control-header">
        <h2 className="control-label">Highlight digit</h2>
        <button
          type="button"
          className="control-header-action"
          disabled={highlightedDigit === null}
          onClick={() => setHighlightedDigit(null)}
          title="Stop highlighting the digit"
        >
          Clear
        </button>
      </div>
      <DigitPad
        variant="highlight"
        isActive={(digit) => highlightedDigit === digit}
        onSelect={onHighlightDigit}
      />
    </section>
  )

  const autosolveGroup = (
    <section className="control-group autosolve-group">
      <h2 className="control-label">Auto-solve</h2>
      {/* Two columns under difficulty-tier subheadings instead of one
          full-width button per technique (18 rows) - the labels are
          shortened to fit a column; each button's title still spells out
          exactly what it applies. */}
      <div className="autosolve-subgroup">
        <h3 className="autosolve-subgroup-label">Basics</h3>
        <div className="autosolve-grid">
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || !hasAnyCandidates || filled === 81}
            onClick={onAutoNakedSingles}
            title="Auto-solve all visible Naked Singles."
          >
            Naked singles
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || !hasAnyCandidates || filled === 81}
            onClick={onAutoNakedAndHiddenSingles}
            title="Auto-solve all visible Naked and Hidden Singles."
          >
            All singles
          </button>
          <button
            type="button"
            className="autosolve-button wide"
            disabled={busy || filled === 81}
            onClick={onLockedCandidates}
            title="Auto-solve all visible Locked Candidates."
          >
            Locked candidates
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || filled === 81}
            onClick={onNakedPairs}
            title="Auto-solve all visible Naked Pairs."
          >
            Naked pairs
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || filled === 81}
            onClick={onNakedTriples}
            title="Auto-solve all visible Naked Triples."
          >
            Naked triples
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || filled === 81}
            onClick={onNakedQuads}
            title="Auto-solve all visible Naked Quads."
          >
            Naked quads
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || filled === 81}
            onClick={onHiddenPairs}
            title="Auto-solve all visible Hidden Pairs."
          >
            Hidden pairs
          </button>
        </div>
      </div>
      <div className="autosolve-subgroup">
        <h3 className="autosolve-subgroup-label">Uniqueness</h3>
        <div className="autosolve-grid">
          <button
            type="button"
            className="autosolve-button wide"
            disabled={busy || filled === 81}
            onClick={onUniqueRectangleType1}
            title="Auto-solve all visible Unique Rectangles (every type)."
          >
            Unique rectangle
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || filled === 81}
            onClick={onBugPlusOne}
            title="Auto-solve BUG+1, if the grid is currently in that pattern."
          >
            BUG+1
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || filled === 81}
            onClick={onBivalueOddagon}
            title="Auto-solve all visible Bivalue Oddagons."
          >
            Bivalue oddagon
          </button>
        </div>
      </div>
      <div className="autosolve-subgroup">
        <h3 className="autosolve-subgroup-label">Colouring</h3>
        <div className="autosolve-grid">
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || !hasAnyCandidates || filled === 81}
            onClick={onSimpleColoring}
            title="Auto-solve all visible Simple Colouring finds."
          >
            Simple colouring
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || !hasAnyCandidates || filled === 81}
            onClick={() => runAutoSolve('3D Medusa', onMedusa)}
            title="Auto-solve all visible 3D Medusa finds."
          >
            3D Medusa
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || !hasAnyCandidates || filled === 81}
            onClick={() => runAutoSolve('Dragon Colouring (bivalue-seeded)', onDragonColouringBivalueSeeded)}
            title="Auto-solve Non-dynamic Dragons that uses a Medusa base that consists of at least 1 bivalue cell"
          >
            Dragon (bivalue)
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || !hasAnyCandidates || filled === 81}
            onClick={() => runAutoSolve('Dragon Colouring (any Medusa)', onDragonColouringAny)}
            title="Auto-solve Non-dynamic Dragons that use any Medusa base"
          >
            Dragon (any Medusa)
          </button>
          <button
            type="button"
            className="autosolve-button wide"
            disabled={busy || !hasAnyCandidates || filled === 81 || dynamicDragonDisabled}
            onClick={() => runAutoSolve('Dynamic Dragon Colouring', onDynamicDragonColouring)}
            title={
              dynamicDragonDisabled
                ? 'Dynamic Dragons are disabled in Dragon Configuration'
                : 'Auto-solve Dynamic Dragons.  Dynamic Dragons that use AIC will be solved based on the Setting.'
            }
          >
            Dynamic Dragon
          </button>
        </div>
      </div>
      {/* Only while at least one AIC technique is switched on in Settings,
          and then only the buttons for the enabled ones - a row of
          permanently greyed-out AIC buttons was just clutter for the
          (default) AICs-off setup. Generic implies Short implies
          Single-Digit (see the toggle invariants), so the Single-Digit flag
          alone decides whether the subgroup shows at all. */}
      {shortSingleDigitAicEnabled && (
        <div className="autosolve-subgroup">
          <h3 className="autosolve-subgroup-label">AICs</h3>
          <div className="autosolve-grid">
            <button
              type="button"
              className={['autosolve-button', genericAicEnabled ? '' : 'wide'].filter(Boolean).join(' ')}
              disabled={busy || !hasAnyCandidates || filled === 81}
              onClick={() => runAutoSolve('short single-digit AIC', onShortSingleDigitAic)}
              title="Auto-solve all visible Short Single-Digit AICs (length 3)."
            >
              Short single-digit
            </button>
            {SHOW_SHORT_AIC_AUTOSOLVE && shortAicEnabled && (
              <button
                type="button"
                className="autosolve-button"
                disabled={busy || !hasAnyCandidates || filled === 81}
                onClick={() => runAutoSolve('short AIC', onShortAic)}
                title="Auto-solve all visible Short AICs (length <= 5)."
              >
                Short AIC
              </button>
            )}
            {genericAicEnabled && (
              <button
                type="button"
                className="autosolve-button"
                disabled={busy || !hasAnyCandidates || filled === 81}
                onClick={() => runAutoSolve('generic AIC', onGenericAic)}
                title={`Auto-solve all visible Generic AICs (length 7 to ${GENERIC_AIC_MAX_LENGTH}).`}
              >
                Generic
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )

  const actionsRow = (
    <div className="actions">
      <button type="button" className="primary" onClick={onSolve} disabled={busy}>
        {solving ? 'Solving…' : 'Brute force solve'}
      </button>
    </div>
  )

  const statusLines = (
    <>
      <p className="status" role="status">
        {status} <span className="muted">(grid has {filled}/81 cells filled)</span>
      </p>
      <p className={['solvability', `solvability-${solvability.kind}`].join(' ')}>{solvabilityText(solvability)}</p>
    </>
  )

  const overlays = (
    <>
      {/* An explicitly started operation takes precedence; the newest one if
          several overlap (only possible while worker-based generation runs).
          Once it ends, the recompute of whatever it changed takes over. */}
      <BusyIndicator task={busyTasks[busyTasks.length - 1] ?? analysisBusyTask} />

      {toastMessage && (
        <div className="toast" role="status">
          {toastMessage}
        </div>
      )}

      {helpOpen && (
        <HelpModal
          onClose={() => setHelpOpen(false)}
          onOpenTutorial={() => {
            setHelpOpen(false)
            setTutorialOpen(true)
          }}
        />
      )}
      {tutorialOpen && <TutorialPage onClose={() => setTutorialOpen(false)} />}

      {confirmOptimizeDynamicOpen && (
        <ConfirmDialog
          title="Turn on Optimize Dynamic Dragons?"
          confirmLabel="Turn it on anyway"
          cancelLabel="Keep it off"
          onConfirm={() => {
            setConfirmOptimizeDynamicOpen(false)
            setOptimizeDynamicDragons(true)
          }}
          onCancel={() => setConfirmOptimizeDynamicOpen(false)}
        >
          <p>
            <b>Exhaustive Dragon Colouring is currently OFF</b>, and Optimize Dynamic Dragons is much slower without it.
          </p>
          <p>
            This should be turned ON for Dynamic Dragon analysis purposes only.  Keep it OFF for normal puzzle solving.
          </p>
          <p>  
             The techniques list, the solve path and the solvability check could each take many seconds to update
            after every change you make to the grid.
          </p>
          <p className="confirm-tip">Tip: turn Exhaustive Dragon Colouring ON first to keep things quick.</p>
        </ConfirmDialog>
      )}
    </>
  )

  if (compact) {
    const dockContent: Record<CompactSection, ReactNode> = {
      techniques: techniquePanel,
      input: (
        <>
          {solutionGroup}
          {candidateGroup}
        </>
      ),
      colour: (
        <>
          {paintGroup}
          {highlightGroup}
        </>
      ),
      solve: (
        <>
          <div className="compact-status">{statusLines}</div>
          {autosolveGroup}
          {actionsRow}
        </>
      ),
      import: importRows,
    }
    return (
      <main
        className={[
          'page',
          'compact-layout',
          landscape ? 'compact-landscape' : 'compact-portrait',
          phone ? 'compact-phone' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onKeyDown={onKeyDown}
      >
        {!phone && header}
        {toolbar}
        <div className="compact-board">{gridElement}</div>
        {/* Keyed on the tab so switching tabs starts the new one scrolled to
            its top instead of wherever the previous tab was left. */}
        <div
          key={compactSection}
          className={`compact-dock compact-dock-${compactSection}`}
          role="tabpanel"
          id="compact-dock"
          aria-labelledby={`compact-tab-${compactSection}`}
        >
          {dockContent[compactSection]}
        </div>
        <nav className="compact-tabs" role="tablist" aria-label="Control panels">
          {COMPACT_SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`compact-tab-${id}`}
              aria-selected={compactSection === id}
              aria-controls="compact-dock"
              className={['compact-tab', compactSection === id ? 'active' : ''].filter(Boolean).join(' ')}
              onClick={() => setCompactSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {overlays}
      </main>
    )
  }

  return (
    <main className="page" onKeyDown={onKeyDown}>
      {header}

      {toolbar}

      <div className="board-area">
        {techniquePanel}

        {/* The grid plus the import / screenshot / export rows, kept in one
            column so they sit right under the grid instead of below
            whichever side column (techniques panel, controls) is tallest. */}
        <div className="grid-column">
          {gridElement}

          {importRows}
        </div>

        <div className="controls">
          {solutionGroup}

          {candidateGroup}

          {paintGroup}

          {highlightGroup}

          {autosolveGroup}
        </div>
      </div>

      {actionsRow}

      {statusLines}

      {overlays}
    </main>
  )
}
