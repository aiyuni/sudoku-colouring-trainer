import {
  createContext,
  useCallback,
  useContext,
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
  type Ref,
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
import { reportImport } from './importAnalytics'
import { AREA_LAYER, trackEvent, trackSettingsChanges, useAnalyticsArea } from './usageTracking'
import { recognizeDigit } from './sudoku/OcrDigitRecognizer'
import { PuzzleImporter } from './sudoku/PuzzleImporter'
import { SolveResponse, type SolveStatus } from './sudoku/SolveResponse'
import {
  isDynamicDragonMove,
  type DragonColor,
  type DragonExtendOptions,
  type DragonMove,
  type DragonNode,
  type DragonRule3Substep,
  type Rule3Technique,
} from './sudoku/SudokuDragonFinder'
import { ALL_FISH_TECHNIQUES, FISH_TECHNIQUE_NAMES, type FishTechnique } from './sudoku/SudokuFishFinder'
import { foldDragonMoves } from './sudoku/dragonReplay'
import { SudokuAicDragonConverter, type AicChainShape, type AicDragonFailure, type AicDragonSearch } from './sudoku/SudokuAicDragonConverter'
import { dragonAicSummary, dragonAicText, isDragonEliminationMove, type DragonAicStatus, type DragonAicSummary } from './sudoku/SudokuDragonAicConverter'
import { aicChainView } from './sudoku/SudokuShortAicFinder'
import {
  SudokuDragonTargetFinder,
  checkEliminationTargets,
  formatCandidate,
  parseEliminationTargets,
} from './sudoku/SudokuDragonTargetFinder'
import { generateDragonPuzzleInParallel } from './sudoku/ParallelDragonPuzzleGenerator'
import {
  pickStockDoubleDragonPuzzle,
  pickStockDefaultsDoubleDynamicDragonPuzzle,
  pickStockDoubleDynamicDragonPuzzle,
  pickStockDynamicDragonPuzzle,
} from './sudoku/dynamicDragonPuzzleStock'
import type { DragonPuzzleGenerateOptions, GeneratedDragonPuzzle } from './sudoku/SudokuDragonPuzzleGenerator'
import { SudokuGenerator } from './sudoku/SudokuGenerator'
import { ocrGrid } from './sudoku/SudokuGridOcr'
import { bugPlusNEliminationsText, bugPlusNName } from './sudoku/SudokuBugPlusNFinder'
import { SudokuRules } from './sudoku/SudokuRules'
import { GENERIC_AIC_MAX_LENGTH } from './sudoku/SudokuGenericAicFinder'
import { type SingleAssignment } from './sudoku/SudokuSingleFinder'
import { SudokuSolver } from './sudoku/SudokuSolver'
import { autocompleteMedusa, type MedusaSeed } from './sudoku/SudokuMedusaAutocompleter'
import {
  DEFAULT_PUZZLE,
  type Board,
  type CandidateColor,
  type CandidateColorGrid,
  type CandidateGrid,
  type CandidatePaint,
  type CandidatePaintLayer,
  type CandidatePaintShape,
} from './sudoku/types'
import HelpModal from './HelpModal'
import WelcomeModal from './WelcomeModal'
import HintModal from './HintModal'
import {
  buildTechniqueHint,
  checkMedusaPaint,
  colouringHintKind,
  dragonMoveSteps,
  medusaColouringSteps,
  medusaStartCandidate,
  type HintStep,
  type MedusaHintContext,
  type TechniqueHint,
} from './hints'
import TutorialPage from './tutorial/TutorialPage'
import { tutorialTargetFor, type TutorialTarget } from './tutorial/tutorialLinks'
import { useCompactLayout } from './useCompactLayout'
import { useHasKeyboard } from './useHasKeyboard'
import { BusyIndicator } from './BusyIndicator'
import ConfirmDialog from './ConfirmDialog'
import { afterPaint, useSettledValue, type BusyTask } from './busyTask'
import { solvePathInWorker, type SolvePathOptions } from './solvePathInWorker'
import { seRatingPosition, seRatingText, useSeRating } from './seRating'
import {
  DEFAULT_SETTINGS,
  DRAGON_GENERATION_TIMEOUT_OPTIONS,
  SOLVE_PATH_TIMEOUT_OPTIONS,
  MAX_TECHNIQUES_PER_DRAGON_STEP_OPTIONS,
  MIN_BASE_MEDUSA_CANDIDATES,
  RULE3_TECHNIQUE_GROUPS,
  RULE3_TECHNIQUE_LABELS,
  type AppSettings,
} from './settingsDefaults'
import {
  loadSavedGrid,
  loadSavedSettings,
  loadWelcomeDismissed,
  saveGrid,
  saveSettings,
  saveWelcomeDismissed,
} from './persistedState'
import { isNativePasteHotkey, keyNameOf, matchHotkey, type HotkeyBindings } from './hotkeys'
import HotkeySettings from './HotkeySettings'
import { isContiguousGroup, layoutAicOverlay } from './aicLinkLayout'
import {
  singleFinder,
  lockedCandidateFinder,
  pairFinder,
  nakedSubsetFinder,
  hiddenPairFinder,
  uniqueRectangleFinder,
  bugPlusNFinder,
  colorFinder,
  medusaFinder,
  NINE,
  DIGITS,
  type TechniqueInstance,
  describeTargetProblem,
  cellRef,
  type DragonChainFilter,
  computeDoubleDragonExtensions,
  computeDoubleDynamicDragonExtensions,
  computeStuckDragonExtensions,
  computeStuckDynamicDragonExtensions,
  computeShortAicEliminationsByKind,
  computeGenericAicEliminations,
  buildTechniqueInstances,
  buildDragonInstance,
  buildMedusaChainInstance,
  autocompleteDragon,
  dynamicDragonLabel,
  fullTechniqueEffect,
  countEffectiveEliminations,
  applyTechniqueEffect,
  pickEasiestInstance,
  type SolvePathResult,
  boardsEqual,
  candidatesEqual,
  EXOTIC_TECHNIQUE_NAMES,
  type ExoticTechnique,
} from './techniqueEngine'
import './App.css'

/** Keyboard shortcuts only fire inside elements marked `data-hotkey-scope`:
 * the grid and the Solution / Candidates / Candidate Colours / Highlight
 * digit pads. Elsewhere (menus, the Techniques panel, the import box) keys
 * keep their normal meaning - e.g. Space still presses a focused button. */
function isInHotkeyScope(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-hotkey-scope]') !== null
}

/** Somewhere the user is typing text, which keeps every key to itself. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

const solver = new SudokuSolver()
const generator = new SudokuGenerator()
const dragonTargetFinder = new SudokuDragonTargetFinder()
const aicDragonConverter = new SudokuAicDragonConverter()
/** The Dynamic Dragon techniques that are themselves chains. An AIC's
 * equivalent Dragon is searched without them: a Dynamic Dragon that calls on
 * the chain itself as a helper would explain nothing. */
const AIC_RULE3_TECHNIQUES: ReadonlySet<Rule3Technique> = new Set<Rule3Technique>([
  'short single-digit aic',
  'short aic',
  'generic aic',
  'grouped aic',
  'ur-aic',
  'als-aic',
])
const importer = new PuzzleImporter()
const APP_VERSION = 'v0.8.8-beta'

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
    board: cloneBoard(DEFAULT_PUZZLE),
    givens: computeGivenMask(DEFAULT_PUZZLE),
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
// user recolour freely. The order here is the palette order and must match
// CANDIDATE_COLOR_ORDER (types.ts), which copied puzzle strings encode.
const DEFAULT_CANDIDATE_COLOR_SWATCHES: Array<{ id: CandidateColor; label: string; hex: string }> = [
  { id: 'skyBlue', label: 'Light blue', hex: '#38bdf8' },
  { id: 'paleYellow', label: 'Light yellow', hex: '#fde047' },
  { id: 'lightPink', label: 'Light pink', hex: '#e6a3e6' },
  { id: 'blue', label: 'Dark blue', hex: '#2563eb' },
  { id: 'rust', label: 'Orange', hex: '#fb923c' },
  { id: 'purple', label: 'Purple', hex: '#9313b5' },
  { id: 'limeGreen', label: 'Lime green', hex: '#7bc82c' },
  { id: 'darkGreen', label: 'Dark green', hex: '#3d5c0e' },
  { id: 'tan', label: 'Red', hex: '#ef4444' },
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

const CANDIDATE_SWATCH_SHAPES_STORAGE_KEY = 'sudoku-solver-candidate-swatch-shapes'

/** Every colour paints as a circle until the user switches it to a square. */
function defaultSwatchShapes(): Record<CandidateColor, CandidatePaintShape> {
  return Object.fromEntries(DEFAULT_CANDIDATE_COLOR_SWATCHES.map((s) => [s.id, 'circle'])) as Record<
    CandidateColor,
    CandidatePaintShape
  >
}

/** Same fallback rules as loadCustomSwatchColors, for each colour's shape. */
function loadCustomSwatchShapes(): Record<CandidateColor, CandidatePaintShape> {
  const shapes = defaultSwatchShapes()
  try {
    const raw = localStorage.getItem(CANDIDATE_SWATCH_SHAPES_STORAGE_KEY)
    if (!raw) {
      return shapes
    }
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      for (const swatch of DEFAULT_CANDIDATE_COLOR_SWATCHES) {
        const value = (parsed as Record<string, unknown>)[swatch.id]
        if (typeof value === 'string' && (CANDIDATE_PAINT_SHAPES as readonly string[]).includes(value)) {
          shapes[swatch.id] = value as CandidatePaintShape
        }
      }
    }
  } catch {
    // Same as the colours: fall back to defaults silently.
  }
  return shapes
}

const CANDIDATE_PAINT_SHAPES: readonly CandidatePaintShape[] = ['circle', 'square', 'diamond']

/** The painted colour(s) behind a candidate's digit, one span per layer
 * (the shape itself is CSS: .paint-shape-circle/-square/-diamond). A
 * diamond needs clip-path, which the old single-element border-radius
 * trick couldn't combine with a half-circle or half-square, so each layer
 * is its own element instead. With two layers the pip is split along a
 * backslash diagonal (top-left to bottom-right corner): each layer is
 * wrapped in a triangle clip - the first layer's shape shows only in the
 * bottom-left triangle, the second's only in the top-right - so any two
 * shapes combine, each half still recognizable by hue and shape. */
function renderCandidatePaint(paint: CandidatePaint, hexes: Record<CandidateColor, string>): ReactNode {
  const [first, second] = paint
  const shapeSpan = (layer: CandidatePaintLayer) => (
    <span className={`paint-shape paint-shape-${layer.shape}`} style={{ backgroundColor: hexes[layer.color] }} />
  )
  if (second === undefined) {
    return <span className="paint-layer">{shapeSpan(first)}</span>
  }
  return (
    <>
      <span className="paint-layer paint-layer-bottom-left">{shapeSpan(first)}</span>
      <span className="paint-layer paint-layer-top-right">{shapeSpan(second)}</span>
    </>
  )
}

/** Dragon Colouring's highlight colours, for a Double Dragon candidate both
 * Dragons colour - drawn as a split pip (renderDragonSplit) instead of one
 * .technique-* class. The same hexes as those classes in App.css. */
const DRAGON_HIGHLIGHT_HEX = {
  'technique-blue': '#38bdf8',
  'technique-yellow': '#fde047',
  'technique-darkblue': '#1d4ed8',
  'technique-orange': '#fb923c',
  'technique-pink': '#e6a3e6',
  'technique-purple': '#9313b5',
  'technique-limegreen': '#7bc82c',
  'technique-darkgreen': '#3d5c0e',
} as const
type DragonHighlightClass = keyof typeof DRAGON_HIGHLIGHT_HEX

/** A Dragon colour's highlight class (a Double Dragon's second Dragon in its
 * own colours). */
function dragonHighlightClass(color: DragonColor, secondDragon: boolean): DragonHighlightClass {
  const first: Record<DragonColor, DragonHighlightClass> = {
    blue: 'technique-blue',
    yellow: 'technique-yellow',
    darkBlue: 'technique-darkblue',
    orange: 'technique-orange',
  }
  const second: Record<DragonColor, DragonHighlightClass> = {
    blue: 'technique-pink',
    yellow: 'technique-limegreen',
    darkBlue: 'technique-purple',
    orange: 'technique-darkgreen',
  }
  return (secondDragon ? second : first)[color]
}

/** A candidate coloured by both of a Double Dragon's Dragons: the first
 * Dragon's colour bottom-left, the second's top-right - the same diagonal
 * split as a two-colour manual paint (renderCandidatePaint). */
function renderDragonSplit(first: DragonHighlightClass, second: DragonHighlightClass): ReactNode {
  return (
    <>
      <span className="paint-layer paint-layer-bottom-left">
        <span className="paint-shape paint-shape-circle" style={{ backgroundColor: DRAGON_HIGHLIGHT_HEX[first] }} />
      </span>
      <span className="paint-layer paint-layer-top-right">
        <span className="paint-shape paint-shape-circle" style={{ backgroundColor: DRAGON_HIGHLIGHT_HEX[second] }} />
      </span>
    </>
  )
}

/** What clicking a candidate with `layer` (the selected colour, in its
 * swatch's current shape) turns its paint into:
 * - unpainted -> that colour;
 * - already holds that colour in that shape -> that colour comes off (the
 *   other half, if any, becomes the whole pip; otherwise it's unpainted);
 * - already holds that colour in a different shape -> reshaped in place, so
 *   an old candidate can be brought in line with a new shape setting
 *   without first clearing it;
 * - painted one other colour -> multicolour, old colour bottom-left, new
 *   top-right;
 * - already two other colours -> the new colour replaces the top-right half,
 *   so the first colour stays put and the second can be swapped freely. */
function nextCandidatePaint(current: CandidatePaint | null, layer: CandidatePaintLayer): CandidatePaint | null {
  if (!current) {
    return [layer]
  }
  const index = current.findIndex((l) => l.color === layer.color)
  if (index >= 0) {
    if (current[index].shape !== layer.shape) {
      return current.length === 1 ? [layer] : index === 0 ? [layer, current[1]!] : [current[0], layer]
    }
    const rest = current.filter((l) => l.color !== layer.color)
    return rest.length > 0 ? [rest[0]] : null
  }
  return [current[0], layer]
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
  request: { board: Board; candidates: CandidateGrid; givens: boolean[][]; options: SolvePathOptions } | null,
): SolvePathResult | null {
  const [search, setSearch] = useState<{ request: NonNullable<typeof request>; result: SolvePathResult } | null>(null)
  useEffect(() => {
    if (!request) {
      return
    }
    const controller = new AbortController()
    solvePathInWorker(request.board, request.candidates, request.givens, request.options, controller.signal).then(
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

type TechniquePanelTab = 'techniques' | 'solve-path' | 'find' | 'autocomplete'

/** The Short AIC (length <= 5) Auto-solve button is hidden - Short
 * Single-Digit and Generic cover the useful ends of the AIC range there -
 * but kept behind this flag rather than deleted (along with onShortAic),
 * in case it is wanted back. Short AIC itself is unaffected everywhere
 * else (Techniques panel, solve path, Dynamic Dragon). */
const SHOW_SHORT_AIC_AUTOSOLVE = false

/** The touch layout's dock tabs (see useCompactLayout) - each shows one or
 * two of the desktop layout's side-column blocks under/beside the grid. */
type CompactSection = 'techniques' | 'input' | 'colour' | 'solve' | 'import'

const TECHNIQUE_PANEL_TAB_LABELS: Record<TechniquePanelTab, string> = {
  techniques: 'Techniques',
  'solve-path': 'Solve Path',
  find: 'Find by elims',
  autocomplete: 'Autocomplete Colours',
}

/** A technique's name without the digit or rule details some names carry
 * ("Simple Colouring Rule 1 (5)"), so analytics groups by technique. */
function techniqueTrackingName(name: string): string {
  return name.replace(/\s*\(\d\)$/, '').replace(/^3D Medusa Rules? .*$/, '3D Medusa')
}

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

/** A single plain or Dynamic Dragon's step read as an AIC through its own coloured
 * candidates (SudokuDragonAicConverter) - what the step player says about the
 * step on screen. Null outside a single Dragon (Double Dragons
 * have no chain form). A context rather than props because every step player
 * (Techniques list, Solve Path, Find by elims, Autocomplete, the touch
 * layout's focus view) shows the one highlighted technique. */
interface DragonAicView {
  shown: boolean
  onToggle: (shown: boolean) => void
  /** The current step's line; null when it isn't an elimination step. */
  text: string | null
}
/** `note`: the step player's box - null unless the highlighted technique is a
 * single Dragon with an equivalent AIC at one of its steps at least.
 * `statusOf`: what a row's badge says about its Dragon (by its move log);
 * undefined while that isn't worked out yet. */
interface DragonAicContextValue {
  note: DragonAicView | null
  statusOf: (moves: readonly DragonMove[]) => DragonAicStatus | undefined
}
const DragonAicContext = createContext<DragonAicContextValue | null>(null)
/** Is `instance` a single plain or Dynamic Dragon (the only Dragons with a
 * chain form - never a Double one)? */
function isSingleDragon(instance: TechniqueInstance): boolean {
  return !!instance.moves && (instance.id.startsWith('dragon-') || instance.id.startsWith('dynamic-dragon-'))
}

const DRAGON_AIC_BADGE_TEXT: Record<DragonAicStatus, string> = {
  every: 'Has an equivalent AIC: every elimination step of this Dragon is also a chain through its coloured candidates',
  some: "Partly an AIC: some of this Dragon's elimination steps are also a chain through its coloured candidates, others are not",
  none: "No equivalent AIC: none of this Dragon's elimination steps is a chain through its coloured candidates",
}

/** A single Dragon row's "has an equivalent AIC" badge, just left of its ?.
 * Nothing while the feature is off, for any other technique, or until the
 * row's Dragon has been converted (App does that in the background). */
function DragonAicBadge({ instance }: { instance: TechniqueInstance }) {
  const context = useContext(DragonAicContext)
  const status = context && instance.moves && isSingleDragon(instance) ? context.statusOf(instance.moves) : undefined
  if (!status) {
    return null
  }
  return (
    <span className={`dragon-aic-badge dragon-aic-badge-${status}`} role="img" aria-label={DRAGON_AIC_BADGE_TEXT[status]} title={DRAGON_AIC_BADGE_TEXT[status]}>
      AIC
    </span>
  )
}
/** localStorage: the dev-only switch for the feature (dev server only). */
const DRAGON_AIC_DEV_KEY = 'sudoku-solver.dev.dragonAic'

function DragonAicNote() {
  const view = useContext(DragonAicContext)?.note
  if (!view) {
    return null
  }
  return (
    <div className="dragon-aic-note">
      <label className="dragon-aic-toggle">
        <input type="checkbox" checked={view.shown} onChange={(event) => view.onToggle(event.target.checked)} />
        Show equivalent AIC
      </label>
      {view.shown && (
        <p className="dragon-aic-text">
          {view.text ?? 'Go to a step that eliminates candidates to see it as a chain through the coloured candidates.'}
        </p>
      )}
    </div>
  )
}

/** An AIC row's equivalent Dragon (SudokuAicDragonConverter) - the reverse of
 * the note above, and dev-only like it: the Dragon built from the chain
 * itself, so it follows the chain exactly or there is none. Worked out as soon
 * as a chain row is selected (a few ms), on the Techniques tab only, whose
 * rows are found on the live grid. */
/** What a chain row's badge says: the easiest colouring that does the
 * chain's work - a 3D Medusa, a plain Dragon, a Dynamic Dragon - or none. */
type AicDragonStatus = 'medusa' | 'dragon' | 'dynamic' | 'none'
type AicDragonResult =
  /** `label`: what the checkbox shows - a Dragon, or the 3D Medusa that
   * already does the chain's work. */
  | {
      kind: 'found'
      status: Exclude<AicDragonStatus, 'none'>
      instance: TechniqueInstance
      summary: string
      label: string
      /** A Dragon that has to colour candidates the chain doesn't use (off
       * its own candidates and, for an ALS-AIC, its ALS cells): a partial
       * equivalent, by request - removing more than the chain doesn't make
       * one partial. Never set for a Medusa. */
      partial?: true
    }
  | { kind: 'none'; status: 'none'; text: string }
/** Both answers for one chain row. `full`: a real 3D Medusa (the whole
 * component) or a real Dragon (from a stuck Medusa). `short`: the dev-only
 * cut-down forms - a Medusa coloured only along the chain, a Dragon started
 * from one strong link - which exist far more often and stay on the chain's
 * own candidates (SudokuAicDragonConverter.findShort). */
interface AicDragonResults {
  full: AicDragonResult
  short: AicDragonResult
}
type AicDragonVariant = keyof AicDragonResults
/** What the grid shows for the selected chain row. */
type AicDragonShown = 'chain' | AicDragonVariant
/** `note`: the selected chain row's box - null for any other selection.
 * `resultsOf`: what a row's badges say; undefined while that isn't worked
 * out yet, or for a row that isn't a chain on the live grid. */
interface AicDragonContextValue {
  note: AicDragonNoteView | null
  resultsOf: (instance: TechniqueInstance) => AicDragonResults | undefined
}
interface AicDragonNoteView {
  /** The id of the selected AIC row - the one row the note is shown under. */
  sourceId: string
  results: AicDragonResults
  shown: AicDragonShown
  onShow: (shown: AicDragonShown) => void
  stepIndex: number
  onDragonStep: (delta: number) => void
  substepIndex: number | null
  onSubstep: (delta: number) => void
}
const AicDragonContext = createContext<AicDragonContextValue | null>(null)
/** localStorage: the dev-only switch for the feature (dev server only). */
const AIC_DRAGON_DEV_KEY = 'sudoku-solver.dev.aicDragon'
/** Is `instance` drawn as a chain - any AIC kind (short, generic, grouped,
 * UR-AIC, ALS-AIC, and the named patterns), never a Dragon? */
function isAicInstance(instance: TechniqueInstance): boolean {
  return !instance.moves && (instance.aicLinks?.length ?? 0) > 0
}
/** A chain row as its nodes in order (a grouped node is several candidates)
 * and which of its links are strong - what its equivalent Dragon is built
 * from. */
function aicInstanceShape(instance: TechniqueInstance): AicChainShape {
  const links = instance.aicLinks ?? []
  const nodeOf = (ref: { row: number; col: number; digit: number }, cells: ReadonlyArray<readonly [number, number]> | undefined) =>
    cells ? cells.map(([row, col]) => ({ row, col, digit: ref.digit })) : [ref]
  return {
    nodes: links.length === 0 ? [] : [nodeOf(links[0].from, links[0].fromCells), ...links.map((link) => nodeOf(link.to, link.toCells))],
    strong: links.map((link) => link.kind === 'strong'),
    // An ALS-AIC row's used cells are its almost locked sets' cells: a
    // candidate coloured in one of them is not "off the chain".
    ...(instance.id.startsWith('alsaic-') ? { alsCells: instance.usedCells } : {}),
  }
}
const AIC_DRAGON_FAILURE_TEXT: Record<AicDragonFailure, string> = {
  'no-medusa-link':
    "none of the chain's strong links is a 3D Medusa link between two single candidates (a digit with two places left, or a cell with two candidates), so there is no Medusa to start a Dragon from.",
  'medusa-resolves':
    "the 3D Medusa through the chain's strong links is not stuck - it already proves something on its own, though not all of this chain's eliminations - and a Dragon only starts from a stuck Medusa.",
  unreachable:
    "Dragon's rules can't colour the chain's candidates one after another. Either a link is not one a Dragon can follow (a group, a UR or an ALS, with no enabled Dynamic Dragon technique standing in for it), or the chain doubles back on itself, so following one side breaks down before its end.",
  'not-covered':
    "the chain's candidates can be coloured, but its eliminations don't follow from that colouring (an end that is a group of cells can't be coloured, for one).",
}

const AIC_DRAGON_BADGE: Record<AicDragonVariant, Record<AicDragonStatus, { text: string; title: string }>> = {
  full: {
    medusa: { text: 'MED', title: 'Equivalent 3D Medusa: a 3D Medusa through this chain already makes its eliminations' },
    dragon: { text: 'DRG', title: 'Equivalent Dragon: a plain Dragon Colouring follows this chain exactly' },
    dynamic: { text: 'DYN', title: 'Equivalent Dynamic Dragon: a Dynamic Dragon Colouring follows this chain exactly' },
    none: { text: 'DRG', title: 'No equivalent: neither a 3D Medusa nor a Dragon follows this chain' },
  },
  short: {
    medusa: { text: 'S-MED', title: "Equivalent Short Medusa: colouring only the strong links between the chain's two ends makes its eliminations" },
    dragon: { text: 'S-DRG', title: "Equivalent Short Dragon: a Dragon started from one of the chain's strong links follows it exactly" },
    dynamic: { text: 'S-DYN', title: "Equivalent Short Dynamic Dragon: a Dynamic Dragon started from one of the chain's strong links follows it exactly" },
    none: { text: 'S-DRG', title: 'No short equivalent: neither a Short Medusa nor a Short Dragon follows this chain' },
  },
}

/** A chain row's "is there an equivalent Medusa or Dragon" badges, just left
 * of its ? - the reverse of DragonAicBadge, in the same place (a row is a
 * chain or a Dragon, never both): one for the real technique, one for its
 * short form. Nothing while the feature is off, for any other technique, or
 * until the row has been converted (App does that in the background). */
function AicDragonBadge({ instance }: { instance: TechniqueInstance }) {
  const results = useContext(AicDragonContext)?.resultsOf(instance)
  if (!results) {
    return null
  }
  return (
    <span className="dragon-aic-badge aic-dragon-badges">
      {(['full', 'short'] as const).map((variant) => {
        const result = results[variant]
        const badge = AIC_DRAGON_BADGE[variant][result.status]
        const partial = result.kind === 'found' && result.partial
        const title = partial
          ? `Partial ${badge.title.charAt(0).toLowerCase()}${badge.title.slice(1).replace(/ follows (this chain|it) exactly/, " follows this chain, but has to colour candidates the chain doesn't use")}`
          : badge.title
        return (
          <span
            key={variant}
            className={`aic-dragon-chip aic-dragon-badge-${result.status}${partial ? ' aic-dragon-badge-partial' : ''}`}
            role="img"
            aria-label={title}
            title={title}
          >
            {partial ? `≈${badge.text}` : badge.text}
          </span>
        )
      })}
    </span>
  )
}

function AicDragonNote({ instance }: { instance: TechniqueInstance }) {
  const context = useContext(AicDragonContext)?.note
  if (!context || context.sourceId !== instance.id) {
    return null
  }
  const shownResult = context.shown === 'chain' ? null : context.results[context.shown]
  const moves = shownResult?.kind === 'found' ? shownResult.instance.moves : undefined
  // The step player goes under the note, not inside it: it is styled for the
  // row's own background, not the note's.
  return (
    <>
      <div className="dragon-aic-note aic-dragon-note">
        {(['full', 'short'] as const).map((variant) => {
          const result = context.results[variant]
          return result.kind === 'none' ? (
            <p key={variant} className="dragon-aic-text">
              {result.text}
            </p>
          ) : (
            <div key={variant} className="aic-dragon-option">
              <label className="dragon-aic-toggle">
                <input
                  type="checkbox"
                  checked={context.shown === variant}
                  onChange={(event) => context.onShow(event.target.checked ? variant : 'chain')}
                />
                {result.label}
              </label>
              {/* The explanation only for the one being shown, by request. */}
              {context.shown === variant && <p className="dragon-aic-text">{result.summary}</p>}
            </div>
          )
        })}
      </div>
      {moves && (
        <DragonStepper
          moves={moves}
          stepIndex={Math.min(context.stepIndex, moves.length - 1)}
          onDragonStep={context.onDragonStep}
          substepIndex={context.substepIndex}
          onSubstep={context.onSubstep}
        />
      )}
    </>
  )
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
      <DragonAicNote />
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

/** The phone toolbar's Undo / Redo: the familiar curved-arrow icons
 * (Material Design's, Apache 2.0), drawn in the button's text colour. */
function UndoRedoIcon({ direction }: { direction: 'undo' | 'redo' }) {
  return (
    <svg className="undo-redo-icon" viewBox="0 0 24 24" width="1.35em" height="1.35em" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d={
          direction === 'undo'
            ? 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z'
            : 'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.4 3.6z'
        }
      />
    </svg>
  )
}

/** The Technique Selections menu's icon: a Medusa head (the 3D Medusa
 * technique's namesake) - a face with snakes for hair. An SVG rather than an
 * emoji because there is no Medusa emoji, and it adds no text to the button,
 * so the usage analytics still names the button by its words alone. */
function MedusaIcon() {
  return (
    <svg className="medusa-icon" viewBox="0 0 24 24" width="1.25em" height="1.25em" aria-hidden="true" focusable="false">
      <g fill="none" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round">
        <path d="M7.5 13.5C4 14 2 11.5 3.5 9" />
        <path d="M8 10.5C4.5 9.5 4.5 5.5 7 4.5" />
        <path d="M10.5 9C9 6.5 10.5 4 9.5 2" />
        <path d="M13.5 9C15 6.5 13.5 4 14.5 2" />
        <path d="M16 10.5C19.5 9.5 19.5 5.5 17 4.5" />
        <path d="M16.5 13.5C20 14 22 11.5 20.5 9" />
      </g>
      <g fill="#15803d">
        <circle cx="3.5" cy="9" r="1.3" />
        <circle cx="7" cy="4.5" r="1.3" />
        <circle cx="9.5" cy="2" r="1.3" />
        <circle cx="14.5" cy="2" r="1.3" />
        <circle cx="17" cy="4.5" r="1.3" />
        <circle cx="20.5" cy="9" r="1.3" />
      </g>
      <ellipse cx="12" cy="15.5" rx="5" ry="6" fill="#bbf7d0" stroke="#15803d" strokeWidth="1.2" />
      <circle cx="10" cy="14.8" r="1" fill="#b91c1c" />
      <circle cx="14" cy="14.8" r="1" fill="#b91c1c" />
      <path d="M10.2 18.2Q12 19.4 13.8 18.2" fill="none" stroke="#15803d" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

/** Touch layout only: the selected Techniques-list row, alone, filling the
 * dock. In the list the row's step player sits below its (often long)
 * notation, and a Dynamic Dragon's substep player below that, so stepping
 * through one meant scrolling the dock between the buttons and the text on
 * every tap. Here the dock is split into a fixed head (back, name, ?,
 * Apply), the reasoning text (the only part that scrolls, back to its top
 * on every step), and one fixed row holding both players' controls at the
 * bottom, within thumb reach - so the buttons never move. */
function TechniqueFocusView({
  instance,
  onClose,
  onApply,
  canApply,
  onLearn,
  stepIndex,
  onDragonStep,
  substepIndex,
  onSubstep,
}: {
  instance: TechniqueInstance
  onClose: () => void
  onApply: () => void
  canApply: boolean
  onLearn: (target: TutorialTarget) => void
  stepIndex: number
  onDragonStep: (delta: number) => void
  substepIndex: number | null
  onSubstep: (delta: number) => void
}) {
  const moves = instance.moves
  const move = moves ? moves[Math.min(stepIndex, moves.length - 1)] : null
  const substeps = move?.substeps && move.substeps.length > 1 ? move.substeps : null
  const resolvedSubstepIndex = substeps ? (substepIndex ?? substeps.length - 1) : 0
  return (
    <div className="technique-focus">
      <div className="technique-focus-head">
        <button type="button" className="technique-focus-back" onClick={onClose} aria-label="Back to all techniques">
          ‹ All
        </button>
        {/* A Dragon's notation is a one-line summary ("14 steps - eliminates
            26 candidates"), so it goes under the name here rather than
            taking a line of the text area, which on a short phone only has
            room for a few lines; other techniques' notation is the whole
            explanation and stays in the text area. */}
        <span className="technique-focus-title" title={moves ? instance.notation : undefined}>
          <span className="technique-focus-name">{instance.name}</span>
          {moves && <span className="technique-focus-summary">{instance.notation}</span>}
        </span>
        <DragonAicBadge instance={instance} />
        <AicDragonBadge instance={instance} />
        <TechniqueLearnButton instance={instance} onLearn={onLearn} />
        <button type="button" className="technique-apply-button" disabled={!canApply} onClick={onApply}>
          Apply
        </button>
      </div>
      {/* Keyed on the step, so each step's text starts scrolled to its top. */}
      <div className="technique-focus-text" key={`${stepIndex}-${resolvedSubstepIndex}`}>
        {!moves && <p className="technique-notation">{instance.notation}</p>}
        <AicDragonNote instance={instance} />
        {move && <p className="dragon-player-description">{move.description}</p>}
        {move && <DragonAicNote />}
        {substeps && (
          <p className="dragon-substep-description technique-focus-substep">
            {capitalizeFirst(substeps[resolvedSubstepIndex].clause)}.
          </p>
        )}
      </div>
      {moves && (
        <div className="technique-focus-controls">
          <div className="dragon-player-controls">
            <button
              type="button"
              className="dragon-player-button"
              aria-label="Previous step"
              disabled={stepIndex <= 0}
              onClick={() => onDragonStep(-1)}
            >
              ◀
            </button>
            <span className="dragon-player-step technique-focus-counter">
              <span className="technique-focus-counter-label">Step</span>
              {stepIndex + 1}/{moves.length}
            </span>
            <button
              type="button"
              className="dragon-player-button"
              aria-label="Next step"
              disabled={stepIndex >= moves.length - 1}
              onClick={() => onDragonStep(1)}
            >
              ▶
            </button>
          </div>
          {substeps && (
            <div className="dragon-player-controls dragon-substep-controls">
              <button
                type="button"
                className="dragon-player-button"
                aria-label="Previous substep"
                disabled={resolvedSubstepIndex <= 0}
                onClick={() => onSubstep(-1)}
              >
                ◀
              </button>
              <span className="dragon-player-step technique-focus-counter">
                <span className="technique-focus-counter-label">Substep</span>
                {resolvedSubstepIndex + 1}/{substeps.length}
              </span>
              <button
                type="button"
                className="dragon-player-button"
                aria-label="Next substep"
                disabled={resolvedSubstepIndex >= substeps.length - 1}
                onClick={() => onSubstep(1)}
              >
                ▶
              </button>
            </div>
          )}
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

/** What the "Autocomplete Colours" tab is currently showing - same shape and
 * same staleness rule as FindResult: a `found` result is tied to the grid it
 * was worked out on. */
/** Which Autocomplete Colours button a result came from - each section
 * shows its own result (step player included) right under its button. */
type AutocompleteSource = 'medusa' | 'plain-dragon' | 'dynamic-dragon'

type AutocompleteResult =
  | { kind: 'message'; source: AutocompleteSource; tone: 'error' | 'info'; title: string; lines: string[] }
  | {
      kind: 'found'
      source: AutocompleteSource
      instance: TechniqueInstance
      summary: string
      /** Autocomplete medusa only: "row,col,digit" of every candidate in the
       * finished Medusa - these keep showing the user's own paint rather
       * than the solved/eliminated highlight, so the result reads in their
       * two colours (the text says which one is true). */
      chainKeys?: string[]
      /** Autocomplete Dragon only. The grid shows the move log's colouring
       * at the current step in the user's own swatches (`rolePaint`, one
       * per Dragon colour) instead of Dragon's fixed four highlight colours;
       * the first `checkedMoves` moves are the user's own colouring. */
      dragon?: { checkedMoves: number; rolePaint: Record<DragonColor, CandidatePaintLayer>; dynamic: boolean }
      boardBefore: Board
      candidatesBefore: CandidateGrid
      /** The grid's colouring right after autocompleting (JSON of the
       * candidate colours). The result is stale once the colouring differs -
       * clearing colours or removing one must take the result's colours off
       * the grid too, and Autocomplete Dragon draws its colouring from the
       * result rather than from the grid's own colours. */
      coloursKey: string
    }

/** What checkPaintedDragon (in App) makes of the painted colouring - the
 * shared core of Autocomplete Dragon and the Hint popup's Dragon hints. */
type PaintedDragonCheck =
  | { kind: 'invalid'; title: string; lines: string[] }
  | { kind: 'not-stuck' }
  | { kind: 'no-result' }
  | {
      kind: 'found'
      outcome: Extract<ReturnType<typeof autocompleteDragon>, { kind: 'found' }>
      /** The log, its text already renamed to the user's colours. */
      moves: DragonMove[]
      roleSwatch: Record<DragonColor, MedusaColourSwatch>
      rename: (text: string) => string
      assignment: { darkBlue?: MedusaColourSwatch; orange?: MedusaColourSwatch }
      /** The painted dragon colours (0-2). */
      extra: MedusaColourSwatch[]
    }

/** The two painted colours "Autocomplete Colours" treats as the Medusa's two
 * sides: the first two swatches, in the Colour section's order, that are on
 * the grid - so light blue and light yellow whenever both are used. */
interface MedusaColourSwatch {
  id: CandidateColor
  label: string
  hex: string
}

interface AutocompletePanelData {
  /** Every colour painted on the grid, in the Colour section's order - the
   * first two are the Medusa colours, any others the dragon colours. */
  paintedSwatches: MedusaColourSwatch[]
  onAutocomplete: () => void
  onAutocompleteDragon: () => void
  onAutocompleteDynamicDragon: () => void
  /** Settings -> "disable Dynamic Dragons": Autocomplete Dynamic Dragon is
   * unavailable, like every other Dynamic Dragon feature. */
  dynamicDragonDisabled: boolean
  result: AutocompleteResult | null
  /** False once the grid has changed since a `found` result was computed. */
  resultIsCurrent: boolean
}

/** Dragon Colouring's text names its four colours by its own fixed labels
 * (see colorLabel in SudokuDragonFinder.ts); Autocomplete Dragon shows them
 * in the user's own swatches, so its text is renamed to match - in one pass,
 * so a renamed colour is never renamed again. */
function renameDragonColours(text: string, roleSwatch: Record<DragonColor, { label: string }>): string {
  const byLabel: Record<string, DragonColor> = {
    'light blue': 'blue',
    yellow: 'yellow',
    'dark blue': 'darkBlue',
    orange: 'orange',
  }
  return text.replace(/\b(light blue|dark blue|yellow|orange)\b/g, (label) => roleSwatch[byLabel[label]].label.toLowerCase())
}

function ColourChip({ swatch }: { swatch: MedusaColourSwatch }) {
  return (
    <span className="autocomplete-colour">
      <span className="autocomplete-colour-dot" style={{ backgroundColor: swatch.hex }} aria-hidden="true" />
      {swatch.label.toLowerCase()}
    </span>
  )
}

/** "Autocomplete Colours": the user starts a colouring by hand and this
 * finishes it. Autocomplete medusa: two colours, a 3D Medusa - checked (see
 * autocompleteMedusa), the rest of the chain painted in the same two
 * colours, and what the finished Medusa proves shown the way the Techniques
 * list shows a Medusa row. Autocomplete Dragon (Plain): three or four colours,
 * a Medusa plus dragon colours - checked and carried on (autocompleteDragon)
 * and shown like a Dragon row, step player included, in the user's colours. */
function AutocompletePanel({
  paintedSwatches,
  onAutocomplete,
  onAutocompleteDragon,
  onAutocompleteDynamicDragon,
  dynamicDragonDisabled,
  result,
  resultIsCurrent,
  dragonStepIndex,
  onDragonStep,
  dragonSubstepIndex,
  onDragonSubstep,
}: AutocompletePanelData & {
  dragonStepIndex: number
  onDragonStep: (delta: number) => void
  dragonSubstepIndex: number | null
  onDragonSubstep: (delta: number) => void
}) {
  const paintedColourCount = paintedSwatches.length
  const medusaColours = paintedColourCount >= 2 ? paintedSwatches.slice(0, 2) : null
  const dragonColours = paintedSwatches.slice(2)
  const disabledReason =
    paintedColourCount === 0
      ? 'Colour at least one candidate in each of two Medusa colours to autocomplete the Medusa.'
      : paintedColourCount === 1
        ? 'Only one colour is coloured on the grid - colour at least one candidate in a second colour to start the Medusa.'
        : null
  const dragonDisabledReason =
    paintedColourCount < 3
      ? 'Colour candidates in at least 3 colours to autocomplete the Dragon: the two Medusa colours, plus 1+ dragon colours.'
      : paintedColourCount > 4
        ? `There are ${paintedColourCount} colours on the grid - a Dragon can only have 3 or 4 (two Medusa colours and one or two dragon colours).`
        : null
  const dynamicDisabledReason = dynamicDragonDisabled
    ? 'Dynamic Dragons are disabled in Settings.'
    : dragonDisabledReason
  const moves = result?.kind === 'found' ? result.instance.moves : undefined
  const buttonName: Record<AutocompleteSource, string> = {
    medusa: 'Autocomplete medusa',
    'plain-dragon': 'Autocomplete Dragon (Plain)',
    'dynamic-dragon': 'Autocomplete Dynamic Dragon',
  }
  // The latest result, shown under the button that produced it (one at a
  // time - it's also what the grid highlights and Apply commits).
  const resultFor = (source: AutocompleteSource) =>
    result?.source !== source ? null : result.kind === 'message' ? (
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
    ) : resultIsCurrent ? (
      <div className="find-result">
        <p className="find-summary">{result.summary}</p>
        <div className="technique-item active find-item">
          <span className="technique-name">{result.instance.name}</span>
          <span className="technique-notation">{result.instance.notation}</span>
          {moves && (
            <DragonStepper
              moves={moves}
              stepIndex={Math.min(dragonStepIndex, moves.length - 1)}
              onDragonStep={onDragonStep}
              substepIndex={dragonSubstepIndex}
              onSubstep={onDragonSubstep}
            />
          )}
        </div>
        <p className="technique-empty">
          Click Apply to make these {result.instance.solvedCandidates.length > 0 ? 'placements and eliminations' : 'eliminations'}.
        </p>
      </div>
    ) : (
      <p className="solve-path-stale-warning">The grid or colouring has changed - press {buttonName[source]} again.</p>
    )
  return (
    <div className="find-panel">
      <div className="experimental-label">experimental</div>
      <p className="autocomplete-heading">3D Medusa</p>
            <p className="technique-empty">
         Start a 3D Medusa by colouring candidates in two colours, and this will check your colouring, colour the rest of the Medusa for you, and show what it proves. </p>
      {medusaColours && (
        <p className="technique-empty">
          Medusa colours: <ColourChip swatch={medusaColours[0]} /> and <ColourChip swatch={medusaColours[1]} />
          {paintedColourCount > 2 && ' (the first two colours in the Colour section that are on the grid; other colours are ignored)'}.
        </p>
      )}
      <div className="find-form">
        <button
          type="button"
          className="find-button"
          disabled={disabledReason !== null}
          title={disabledReason ?? undefined}
          onClick={onAutocomplete}
        >
          Autocomplete medusa
        </button>
      </div>
      {disabledReason && <p className="technique-empty">{disabledReason}</p>}
      {resultFor('medusa')}

      <p className="autocomplete-heading">Dragon (Plain)</p>
      <p className="technique-empty">
        Start a plain Dragon by colouring the Medusa set and its dragon colours (dragons colours are dark blue and orange by default). Then click the button to checks your colouring, continues your Dragon extensions, and shows the end result, step-by-step.  This feature does not support Double Dragons.
      </p>
      {medusaColours && dragonColours.length > 0 && dragonColours.length <= 2 && (
        <p className="technique-empty">
          Medusa colours: <ColourChip swatch={medusaColours[0]} /> and <ColourChip swatch={medusaColours[1]} />; dragon{' '}
          {dragonColours.length === 1 ? (
            <>
              colour: <ColourChip swatch={dragonColours[0]} /> (which side it belongs to is worked out from your colouring).
            </>
          ) : (
            <>
              colours: <ColourChip swatch={dragonColours[0]} /> and <ColourChip swatch={dragonColours[1]} />.
            </>
          )}
        </p>
      )}
      <div className="find-form">
        <button
          type="button"
          className="find-button"
          disabled={dragonDisabledReason !== null}
          title={dragonDisabledReason ?? undefined}
          onClick={onAutocompleteDragon}
        >
          Autocomplete Dragon (Plain)
        </button>
      </div>
      {dragonDisabledReason && <p className="technique-empty">{dragonDisabledReason}</p>}
      {resultFor('plain-dragon')}

      <p className="autocomplete-heading">Dynamic Dragon</p>
      <p className="technique-empty">
        Start a Dynamic Dragon by colouring the Medusa set and its dragon colours. Then click the button to checks your colouring, continues your Dynamic Dragon extensions (based on the Dynamic Dragon configurations), and shows the end result, step-by-step.  This feature does not support Double Dynamic Dragons.
      </p>
      <div className="find-form">
        <button
          type="button"
          className="find-button"
          disabled={dynamicDisabledReason !== null}
          title={dynamicDisabledReason ?? undefined}
          onClick={onAutocompleteDynamicDragon}
        >
          Autocomplete Dynamic Dragon
        </button>
      </div>
      {dynamicDisabledReason && dynamicDisabledReason !== dragonDisabledReason && (
        <p className="technique-empty">{dynamicDisabledReason}</p>
      )}
      {resultFor('dynamic-dragon')}

    </div>
  )
}

/** The ? at the right of a Techniques / Solve Path row's name line: opens
 * the How It Works tab (and sub-tab) teaching that row's technique. Nothing
 * for a technique the page doesn't teach - tutorialTargetFor decides, the
 * same lookup as the Hint popup's "Learn this technique" link, so a new
 * lesson mapped there gets its ? here automatically. A sibling of the row's
 * own button (a button can't nest in a button), placed over its top-right
 * corner by CSS (.technique-row). */
function TechniqueLearnButton({
  instance,
  onLearn,
}: {
  instance: TechniqueInstance
  onLearn: (target: TutorialTarget) => void
}) {
  const target = tutorialTargetFor(instance.id)
  if (!target) {
    return null
  }
  return (
    <button
      type="button"
      className="menu-help-button technique-learn-button"
      aria-label={`Learn ${instance.name} in the Learn techniques`}
      title="Learn this technique"
      onClick={() => onLearn(target)}
    >
      ?
    </button>
  )
}

/** A Techniques / Solve Path row's clickable part. A div with the button
 * role, not a <button>: the row's name and explanation must be selectable
 * for copying, and Firefox and Safari never let text inside a real button be
 * selected, whatever user-select says. Looks like a button through
 * .technique-item[role='button'] in App.css. */
function TechniqueRowButton({
  active,
  onSelect,
  children,
}: {
  active: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={['technique-item', active ? 'active' : ''].filter(Boolean).join(' ')}
      aria-pressed={active}
      onClick={(event) => {
        // Releasing the mouse after dragging out a selection is a click on
        // the row too; it must not also select/deselect the row.
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed && selection.containsNode(event.currentTarget, true)) {
          return
        }
        onSelect()
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      {children}
    </div>
  )
}

/** The Techniques list while a correct digit is missing from a cell's
 * candidates: one shared empty array, so the memos reading it stay put. */
const NO_TECHNIQUE_INSTANCES: TechniqueInstance[] = []

interface TechniquePanelProps {
  tab: TechniquePanelTab
  onTabChange: (tab: TechniquePanelTab) => void
  instances: TechniqueInstance[]
  /** A cell's correct digit is no longer among its candidates: the list is
   * replaced by a note saying so (`instances` is empty then). */
  wrongCandidates: boolean
  /** How many rows the "3+ base Medusa candidates" filter hid, counted only
   * when it left the list empty (see hiddenByMedusaFilterCount in App). */
  hiddenByMedusaFilterCount: number
  activeId: string | null
  onSelect: (id: string) => void
  techniquesRevealed: boolean
  onToggleTechniquesRevealed: () => void
  dragonStepIndex: number
  onDragonStep: (delta: number) => void
  dragonSubstepIndex: number | null
  onDragonSubstep: (delta: number) => void
  solvePath: SolvePathResult | null
  activeSolvePathIndex: number | null
  onSelectSolvePathStep: (index: number) => void
  onApply: () => void
  /** Opens the Hint popup (the Techniques tab's Hint button). */
  /** Omitted: no Hint button in the header (the touch layout has its own
   * in the toolbar). */
  onHint?: () => void
  /** Opens the How It Works page on a technique's lesson - the ? at the
   * right of a Techniques / Solve Path row. */
  onLearn: (target: TutorialTarget) => void
  canApply: boolean
  onGenerateSolvePath: () => void
  solvePathStale: boolean
  showSolvePathLog: boolean
  onToggleSolvePathLog: () => void
  solvability: PuzzleSolvability
  find: FindPanelData
  autocomplete: AutocompletePanelData
  easySolveEnabled: boolean
  onToggleEasySolve: () => void
  preferEasierDoubleDragons: boolean
  onTogglePreferEasierDoubleDragons: () => void
  preferEasiestDragonTechniques: boolean
  onTogglePreferEasiestDragonTechniques: () => void
  /** The Techniques tab's own checkbox of that name: the order of the list's
   * Dragon rows. Independent of the Solve Path's one above. */
  listEasiestDragonTechniquesFirst: boolean
  onToggleListEasiestDragonTechniquesFirst: () => void
  solvePathTimeoutMs: number
  onSolvePathTimeoutChange: (event: ChangeEvent<HTMLSelectElement>) => void
  panelRef?: Ref<HTMLDivElement>
  /** Desktop, beside the grid: the panel's maximum height in px, so a long
   * panel ends level with the "Drag or paste a grid" row (see App's
   * techniquePanelHeight) - the tabs and Apply stay put and the rest scrolls
   * - while a short one keeps its natural height. Null: no cap. */
  fittedHeight?: number | null
  /** Touch layout: a selected Techniques-list row takes over the panel
   * (TechniqueFocusView) instead of expanding inside the list. */
  compact?: boolean
  /** Shown instead of the whole panel (tabs, Apply and all) while an
   * imported screenshot's digits are still waiting to be locked as givens -
   * until then a misread digit would make every technique wrong. */
  locked?: ReactNode
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
  hiddenByMedusaFilterCount,
  wrongCandidates,
  activeId,
  onSelect,
  techniquesRevealed,
  onToggleTechniquesRevealed,
  dragonStepIndex,
  onDragonStep,
  dragonSubstepIndex,
  onDragonSubstep,
  solvePath,
  activeSolvePathIndex,
  onSelectSolvePathStep,
  onApply,
  onHint,
  onLearn,
  canApply,
  onGenerateSolvePath,
  solvePathStale,
  showSolvePathLog,
  //onToggleSolvePathLog,
  solvability,
  find,
  autocomplete,
  easySolveEnabled,
  onToggleEasySolve,
  preferEasierDoubleDragons,
  onTogglePreferEasierDoubleDragons,
  preferEasiestDragonTechniques,
  onTogglePreferEasiestDragonTechniques,
  listEasiestDragonTechniquesFirst,
  onToggleListEasiestDragonTechniquesFirst,
  solvePathTimeoutMs,
  onSolvePathTimeoutChange,
  panelRef,
  fittedHeight,
  compact = false,
  locked,
}: TechniquePanelProps) {
  const fitted = fittedHeight != null
  if (locked) {
    return (
      <div
        ref={panelRef}
        className={['technique-panel', fitted ? 'technique-panel-fitted' : ''].filter(Boolean).join(' ')}
        style={fitted ? { maxHeight: fittedHeight } : undefined}
      >
        <div className="technique-panel-body">{locked}</div>
      </div>
    )
  }
  const focused = compact && tab === 'techniques' && techniquesRevealed ? instances.find((t) => t.id === activeId) : undefined
  if (focused) {
    return (
      <div ref={panelRef} className="technique-panel technique-panel-focused">
        <TechniqueFocusView
          instance={focused}
          onClose={() => onSelect(focused.id)}
          onApply={onApply}
          canApply={canApply}
          onLearn={onLearn}
          stepIndex={dragonStepIndex}
          onDragonStep={onDragonStep}
          substepIndex={dragonSubstepIndex}
          onSubstep={onDragonSubstep}
        />
      </div>
    )
  }
  return (
    <div
      ref={panelRef}
      className={['technique-panel', fitted ? 'technique-panel-fitted' : ''].filter(Boolean).join(' ')}
      style={fitted ? { maxHeight: fittedHeight } : undefined}
    >
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
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'autocomplete'}
            className={['technique-tab', tab === 'autocomplete' ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => onTabChange('autocomplete')}
            title="Autocomplete Colours: finish a 3D Medusa you started colouring and see what it proves."
          >
            Find by colours
          </button>
        </div>
        <div className="technique-header-actions">
          {tab === 'techniques' && onHint && (
            <button
              type="button"
              className="technique-hint-button"
              onClick={onHint}
              title="Get a hint about the easiest technique on the grid, one step at a time."
            >
              Hint
            </button>
          )}
          <button type="button" className="technique-apply-button" disabled={!canApply} onClick={onApply}>
            Apply
          </button>
        </div>
      </div>
      <div className="technique-panel-body">
      {tab === 'techniques' && wrongCandidates ? (
        // Shown whether or not the list is revealed: it gives no move away.
        <p className="technique-empty technique-wrong-candidates" role="alert">
          <strong>There are wrong candidates on the grid.</strong> A cell's correct digit has been removed from its
          candidates, so the techniques list is hidden - anything found from these candidates couldn't be trusted. Undo
          the removal, or click "Autofill all" under Candidates.
        </p>
      ) : tab === 'techniques' ? (
        // Spoiler view: hidden until the user asks, so the list doesn't give
        // away the next move. Not even the count is shown while hidden.
        !techniquesRevealed ? (
          <div className="technique-spoiler">
            <p className="technique-empty">Shows the techniques available for the grid.</p>
            <button type="button" className="technique-spoiler-toggle" onClick={onToggleTechniquesRevealed}>
              Reveal techniques
            </button>
          </div>
        ) : instances.length === 0 ? (
          <>
            <button type="button" className="technique-spoiler-toggle" onClick={onToggleTechniquesRevealed}>
              Hide (spoiler view)
            </button>
            {hiddenByMedusaFilterCount > 0 ? (
              <p className="technique-empty">
                {hiddenByMedusaFilterCount === 1 ? '1 Dragon row is' : `${hiddenByMedusaFilterCount} Dragon rows are`} hidden
                by the "Dragon: require {MIN_BASE_MEDUSA_CANDIDATES}+ base Medusa candidates" setting (Dragon
                Configuration). Turn it off to see {hiddenByMedusaFilterCount === 1 ? 'it' : 'them'}.
              </p>
            ) : (
              <p className="technique-empty">
                None currently apply. Either the solver can't find any, or the puzzle doesn't have full candidates (click "Autofill all" under Candidates)
              </p>
            )}
          </>
        ) : (
        <>
          <button type="button" className="technique-spoiler-toggle" onClick={onToggleTechniquesRevealed}>
            Hide (spoiler view)
          </button>
          <label
            className="technique-list-option"
            title="Order of the Dynamic Dragon rows. On: the Dragon needing the easiest techniques first (the hardest technique group it uses, then the fewest techniques in any one step, then the shortest Dragon). Off: the shortest Dragon first. Separate from the Solve path tab's checkbox of the same name."
          >
            <input
              type="checkbox"
              checked={listEasiestDragonTechniquesFirst}
              onChange={onToggleListEasiestDragonTechniquesFirst}
            />
            Prefer easiest techs within dragon
          </label>
          <p className="technique-empty" style={{ marginBottom: '0.75rem' }}>
            Click on a technique and click on the "Apply" button to execute the technique.
          </p>
          <ul className="technique-list">
            {instances.map((instance) => {
              const isActive = activeId === instance.id
              const moves = instance.moves
              const stepIndex = moves ? Math.min(dragonStepIndex, moves.length - 1) : 0
              return (
                <li key={instance.id} className="technique-row">
                  <TechniqueRowButton active={isActive} onSelect={() => onSelect(instance.id)}>
                    <span className="technique-name">{instance.name}</span>
                    <span className="technique-notation">{instance.notation}</span>
                  </TechniqueRowButton>
                  <DragonAicBadge instance={instance} />
                  <AicDragonBadge instance={instance} />
                  <TechniqueLearnButton instance={instance} onLearn={onLearn} />
                  {isActive && moves && (
                    <DragonStepper
                      moves={moves}
                      stepIndex={stepIndex}
                      onDragonStep={onDragonStep}
                      substepIndex={dragonSubstepIndex}
                      onSubstep={onDragonSubstep}
                    />
                  )}
                  {isActive && <AicDragonNote instance={instance} />}
                </li>
              )
            })}
          </ul>
        </>
        )
      ) : tab === 'autocomplete' ? (
        <AutocompletePanel
          {...autocomplete}
          dragonStepIndex={dragonStepIndex}
          onDragonStep={onDragonStep}
          dragonSubstepIndex={dragonSubstepIndex}
          onDragonSubstep={onDragonSubstep}
        />
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
              className="solve-path-timeout"
              title="How long Generate keeps searching before it stops and shows the steps found so far. The Solvable check under the grid uses the same limit."
            >
              Time limit:
              <select value={solvePathTimeoutMs} onChange={onSolvePathTimeoutChange}>
                {SOLVE_PATH_TIMEOUT_OPTIONS.map(({ label, ms }) => (
                  <option key={ms} value={ms}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {/* The checkboxes get lines of their own, the others indented
                under the first: they only exist while Easy Solve is on. */}
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
              className={`solve-path-easy-solve solve-path-sub-option${easySolveEnabled ? '' : ' solve-path-option-disabled'}`}
              title={
                easySolveEnabled
                  ? 'Between Dragons of the same kind, the one needing the easiest techniques wins: the hardest technique group it uses, then the fewest techniques in any one step, then the shortest Dragon. Off: the shortest Dragon wins.'
                  : 'Needs Easiest Path (Easy Solve).'
              }
            >
              <input
                type="checkbox"
                checked={preferEasiestDragonTechniques}
                disabled={!easySolveEnabled}
                onChange={onTogglePreferEasiestDragonTechniques}
              />
              Prefer easiest techs within dragon
            </label>
            <label
              className={`solve-path-easy-solve solve-path-sub-option${easySolveEnabled ? '' : ' solve-path-option-disabled'}`}
              title={
                easySolveEnabled
                  ? 'A Double Dynamic Dragon that uses easier techniques than every single Dynamic Dragon needs counts as easier than a single Dynamic Dragon.'
                  : 'Needs Easiest Path (Easy Solve).'
              }
            >
              <input
                type="checkbox"
                checked={preferEasierDoubleDragons}
                disabled={!easySolveEnabled}
                onChange={onTogglePreferEasierDoubleDragons}
              />
              Prefer easier double dragons
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
                    <li key={`${step.instance.id}-${index}`} className="technique-row">
                      <TechniqueRowButton active={isActive} onSelect={() => onSelectSolvePathStep(index)}>
                        <span className="technique-name">
                          Step {index + 1}: {step.instance.name}
                        </span>
                        <span className="technique-notation">{step.instance.notation}</span>
                      </TechniqueRowButton>
                      <DragonAicBadge instance={step.instance} />
                      <TechniqueLearnButton instance={step.instance} onLearn={onLearn} />
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
  /** The menu's name in usage analytics (time spent with it open). */
  trackingName: string
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
  trackingName,
  children,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  useAnalyticsArea(`Menu › ${trackingName}`, AREA_LAYER.menu, open)
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
          onClick={(event) => {
            // A menu's ? opens the Settings guide over it - close the menu
            // so it isn't left open behind (or above) the dialog.
            const closer = closeOnItemClick ? '.dropdown-item, .menu-help-button' : '.menu-help-button'
            if (event.target instanceof Element && event.target.closest(closer)) {
              setOpen(false)
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** The small round ? beside a settings menu's section heading: opens the
 * Settings guide on the tab explaining that menu (see HELP_TABS). Its
 * DropdownMenu closes itself when one is clicked. */
function MenuHelpButton({ topic, onClick }: { topic: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="menu-help-button"
      aria-label={`Explain the ${topic} settings`}
      aria-haspopup="dialog"
      title={`What do the ${topic} settings do?`}
      onClick={onClick}
    >
      ?
    </button>
  )
}

type BusyTaskKind = 'solve' | 'generate' | 'ocr' | 'solve-path' | 'find' | 'auto-solve' | 'autocomplete' | 'hint'

interface RunningBusyTask extends BusyTask {
  id: number
  kind: BusyTaskKind
}

let nextBusyTaskId = 1

export default function App() {
  // The puzzle and settings the user left the page with (persistedState.ts),
  // read once on mount; the effects further down keep both saved.
  const [initialGrid] = useState<GridState>(() => loadSavedGrid() ?? createInitialGrid())
  const [initialSettings] = useState(loadSavedSettings)
  const [grid, setGrid] = useState<GridState>(initialGrid)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(() => [{ grid: initialGrid, solvePath: null }])
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
  // "Show equivalent AIC" in a single (plain or Dynamic) Dragon's step player - session-only
  // view state, like the menus' collapse states.
  const [dragonAicShown, setDragonAicShown] = useState(true)
  // The whole equivalent-AIC feature is dev-only for now: off unless switched
  // on with the Settings menu's dev button, which only the dev server renders
  // (import.meta.env.DEV) - so a build can never turn it on. Remembered across
  // reloads of the dev server only.
  const [dragonAicDevEnabled, setDragonAicDevEnabled] = useState(() => {
    if (!import.meta.env.DEV) {
      return false
    }
    try {
      return localStorage.getItem(DRAGON_AIC_DEV_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleDragonAicDev = () => {
    setDragonAicDevEnabled((enabled) => {
      try {
        localStorage.setItem(DRAGON_AIC_DEV_KEY, enabled ? '0' : '1')
      } catch {
        // Not remembered, that's all.
      }
      return !enabled
    })
  }
  // The reverse feature - an AIC row's equivalent Dragon - is dev-only in the
  // same way, with its own switch. `aicDragonShown` says what the grid shows
  // for a selected chain row: the chain (the default, so selecting a row
  // still shows the chain first), its equivalent, or its short equivalent
  // (session-only).
  const [aicDragonDevEnabled, setAicDragonDevEnabled] = useState(() => {
    if (!import.meta.env.DEV) {
      return false
    }
    try {
      return localStorage.getItem(AIC_DRAGON_DEV_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleAicDragonDev = () => {
    setAicDragonDevEnabled((enabled) => {
      try {
        localStorage.setItem(AIC_DRAGON_DEV_KEY, enabled ? '0' : '1')
      } catch {
        // Not remembered, that's all.
      }
      return !enabled
    })
  }
  const [aicDragonShown, setAicDragonShown] = useState<AicDragonShown>('chain')
  const [techniquePanelTab, setTechniquePanelTab] = useState<TechniquePanelTab>('techniques')
  // Techniques tab spoiler view: hidden by default, stays revealed until the
  // user hides it again (session only, not persisted).
  const [techniquesRevealed, setTechniquesRevealed] = useState(false)
  const [findInput, setFindInput] = useState('')
  const [findResult, setFindResult] = useState<FindResult | null>(null)
  const [autocompleteResult, setAutocompleteResult] = useState<AutocompleteResult | null>(null)
  const [activeSolvePathIndex, setActiveSolvePathIndex] = useState<number | null>(null)
  // Deliberately state, not a useMemo off [board, candidates]: the whole
  // point is this does NOT recompute on every grid change - only Generate/
  // Regenerate (or clearing it out when auto-solve is used) ever touches
  // it, so it survives switching tabs and applying its own steps for free.
  const [solvePath, setSolvePath] = useState<SolvePathResult | null>(null)
  const [showSolvePathLog, setShowSolvePathLog] = useState(false)
  const [keyboardMode, setKeyboardMode] = useState<'solution' | 'candidate'>(initialSettings.keyboardMode)
  const [hotkeys, setHotkeys] = useState<HotkeyBindings>(initialSettings.hotkeys)
  const [paintColor, setPaintColor] = useState<CandidateColor | null>(null)
  const [swatchColors, setSwatchColors] = useState<Record<CandidateColor, string>>(loadCustomSwatchColors)
  const [swatchShapes, setSwatchShapes] = useState<Record<CandidateColor, CandidatePaintShape>>(loadCustomSwatchShapes)

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

  useEffect(() => {
    try {
      localStorage.setItem(CANDIDATE_SWATCH_SHAPES_STORAGE_KEY, JSON.stringify(swatchShapes))
    } catch {
      // As above - works for this session, just won't persist.
    }
  }, [swatchShapes])

  const candidateColorSwatches = useMemo(
    () => DEFAULT_CANDIDATE_COLOR_SWATCHES.map((swatch) => ({ ...swatch, hex: swatchColors[swatch.id] })),
    [swatchColors],
  )
  // Every setting below starts from what was saved last visit, else from
  // DEFAULT_SETTINGS (settingsDefaults.ts) - the same object
  // resetSettingsToDefaults() and the help page read, so change a default
  // there, not here.
  const [showStrongLinks, setShowStrongLinks] = useState(initialSettings.showStrongLinks)
  const [showBivalueCells, setShowBivalueCells] = useState(initialSettings.showBivalueCells)
  const [gridWhiteMode, setGridWhiteMode] = useState(initialSettings.gridWhiteMode)
  const [minBaseMedusaFilter, setMinBaseMedusaFilter] = useState(initialSettings.minBaseMedusaFilter)
  const [allPossibleTechniques, setAllPossibleTechniques] = useState(initialSettings.allPossibleTechniques)
  const [dynamicDragonDisabled, setDynamicDragonDisabled] = useState(initialSettings.dynamicDragonDisabled)
  const [doubleDragonEnabled, setDoubleDragonEnabled] = useState(initialSettings.doubleDragonEnabled)
  // Double Dynamic Dragon Colouring can only be on while both Double Dragon and
  // Dynamic Dragon Colouring are: turning either off turns it off too (not just
  // greys it out), and a saved state that breaks this is corrected on load.
  const [doubleDynamicDragonEnabled, setDoubleDynamicDragonEnabled] = useState(
    initialSettings.doubleDynamicDragonEnabled &&
      initialSettings.doubleDragonEnabled &&
      !initialSettings.dynamicDragonDisabled,
  )
  const doubleDynamicDragonUnavailableReason = dynamicDragonDisabled
    ? 'Dynamic Dragons are disabled - turn on Dynamic Dragon Colouring first'
    : !doubleDragonEnabled
      ? 'Double Dragons are disabled - turn on Double Dragon Colouring first'
      : null
  const toggleDoubleDragonEnabled = () => {
    if (doubleDragonEnabled) setDoubleDynamicDragonEnabled(false)
    setDoubleDragonEnabled(!doubleDragonEnabled)
  }
  const toggleDynamicDragonDisabled = () => {
    if (!dynamicDragonDisabled) setDoubleDynamicDragonEnabled(false)
    setDynamicDragonDisabled(!dynamicDragonDisabled)
  }
  const [allowedRule3Techniques, setAllowedRule3Techniques] = useState<Set<Rule3Technique>>(
    () => new Set(initialSettings.allowedRule3Techniques),
  )
  const [shortAicEnabled, setShortAicEnabled] = useState(initialSettings.shortAicEnabled)
  const [genericAicEnabled, setGenericAicEnabled] = useState(initialSettings.genericAicEnabled)
  const [shortSingleDigitAicEnabled, setShortSingleDigitAicEnabled] = useState(
    initialSettings.shortSingleDigitAicEnabled,
  )
  const [xWingEnabled, setXWingEnabled] = useState(initialSettings.xWingEnabled)
  const [finnedXWingEnabled, setFinnedXWingEnabled] = useState(initialSettings.finnedXWingEnabled)
  const [swordfishEnabled, setSwordfishEnabled] = useState(initialSettings.swordfishEnabled)
  const [finnedSwordfishEnabled, setFinnedSwordfishEnabled] = useState(initialSettings.finnedSwordfishEnabled)
  const [alsXzEnabled, setAlsXzEnabled] = useState(initialSettings.alsXzEnabled)
  const [urAicEnabled, setUrAicEnabled] = useState(initialSettings.urAicEnabled)
  const [alsAicEnabled, setAlsAicEnabled] = useState(initialSettings.alsAicEnabled)
  const [groupedAicEnabled, setGroupedAicEnabled] = useState(initialSettings.groupedAicEnabled)
  const [sueDeCoqEnabled, setSueDeCoqEnabled] = useState(initialSettings.sueDeCoqEnabled)
  const [extendedUrEnabled, setExtendedUrEnabled] = useState(initialSettings.extendedUrEnabled)
  // Technique Selections -> Extreme Techniques starts collapsed every session: it's for
  // advanced users only, so it stays out of the way until asked for. (Internally the
  // section's own non-Dynamic-Dragon techniques are still "exotic", see enabledExotic.)
  const [exoticTechniquesShown, setExoticTechniquesShown] = useState(false)
  // Technique Selections -> Basic / Colouring Techniques: view state only, not saved.
  // Basics start collapsed (they are always on, nothing to change), Colouring open.
  const [basicTechniquesShown, setBasicTechniquesShown] = useState(false)
  const [colouringTechniquesShown, setColouringTechniquesShown] = useState(true)
  // Dragon Configuration -> Select Dynamic Dragon Colouring techniques: which of
  // its sections (by title) are collapsed. View state only, not saved - Extreme
  // and Unfair start collapsed every session.
  const [collapsedRule3Groups, setCollapsedRule3Groups] = useState<ReadonlySet<string>>(
    () => new Set(RULE3_TECHNIQUE_GROUPS.filter((group) => group.collapsedByDefault).map((group) => group.title)),
  )
  const toggleRule3Group = (title: string) =>
    setCollapsedRule3Groups((current) => {
      const next = new Set(current)
      if (!next.delete(title)) next.add(title)
      return next
    })
  // The exotic technique toggles as the one set the engine takes.
  const enabledExotic = useMemo(() => {
    const enabled = new Set<ExoticTechnique>()
    if (sueDeCoqEnabled) enabled.add('sue de coq')
    if (extendedUrEnabled) enabled.add('extended ur')
    return enabled
  }, [sueDeCoqEnabled, extendedUrEnabled])
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
    initialSettings.dragonGenerationDisregardsSingleDigitAic,
  )
  const [dragonGenerationDisregardsAic, setDragonGenerationDisregardsAic] = useState(
    initialSettings.dragonGenerationDisregardsAic,
  )
  const [dragonGenerationDisregardsGenericAic, setDragonGenerationDisregardsGenericAic] = useState(
    initialSettings.dragonGenerationDisregardsGenericAic,
  )
  const [dynamicDragonPuzzleForbidsDoubleDragon, setDynamicDragonPuzzleForbidsDoubleDragon] = useState(
    initialSettings.dynamicDragonPuzzleForbidsDoubleDragon,
  )
  const [dynamicDragonPuzzleForbidsPlainDragon, setDynamicDragonPuzzleForbidsPlainDragon] = useState(
    initialSettings.dynamicDragonPuzzleForbidsPlainDragon,
  )
  const [dynamicDragonPuzzleUsesDefaultsOnly, setDynamicDragonPuzzleUsesDefaultsOnly] = useState(
    initialSettings.dynamicDragonPuzzleUsesDefaultsOnly,
  )
  const [aicLimitPerDragonStep, setAicLimitPerDragonStep] = useState(initialSettings.aicLimitPerDragonStep)
  const [maxTechniquesPerDragonStep, setMaxTechniquesPerDragonStep] = useState(initialSettings.maxTechniquesPerDragonStep)
  const [exhaustiveDragonColouring, setExhaustiveDragonColouring] = useState(initialSettings.exhaustiveDragonColouring)
  const [optimizeDragons, setOptimizeDragons] = useState(initialSettings.optimizeDragons)
  const [optimizeDynamicDragons, setOptimizeDynamicDragons] = useState(initialSettings.optimizeDynamicDragons)
  const [easySolveEnabled, setEasySolveEnabled] = useState(initialSettings.easySolveEnabled)
  const [preferEasierDoubleDragons, setPreferEasierDoubleDragons] = useState(
    initialSettings.easySolveEnabled && initialSettings.preferEasierDoubleDragons,
  )
  // Unlike the one above, this keeps its value while Easy Solve is off (it
  // is ON by default, so it should be on when Easy Solve is switched on).
  const [preferEasiestDragonTechniques, setPreferEasiestDragonTechniques] = useState(
    initialSettings.preferEasiestDragonTechniques,
  )
  // The Techniques tab's checkbox of the same name: the list's own setting,
  // independent of the Solve Path's one (neither affects the other).
  const [listEasiestDragonTechniquesFirst, setListEasiestDragonTechniquesFirst] = useState(
    initialSettings.techniquesListEasiestDragonTechniquesFirst,
  )
  const [solvePathTimeoutMs, setSolvePathTimeoutMs] = useState(initialSettings.solvePathTimeoutMs)
  const [dynamicDragonAutoSolveIncludesAics, setDynamicDragonAutoSolveIncludesAics] = useState(
    initialSettings.dynamicDragonAutoSolveIncludesAics,
  )
  const [dragonGenerationTimeoutMs, setDragonGenerationTimeoutMs] = useState(
    initialSettings.dragonGenerationTimeoutMs,
  )
  // null = closed; otherwise the tab it opens on (undefined = the top).
  const [helpOpen, setHelpOpen] = useState<{ tab?: string } | null>(null)
  // The welcome popup: open on every page load until its "Never show again"
  // is ticked.
  const [welcomeOpen, setWelcomeOpen] = useState(() => !loadWelcomeDismissed())
  /** The Hint popup (Techniques tab): open while non-null. */
  const [hintView, setHintView] = useState<{ hint: TechniqueHint | null; revealed: number } | null>(null)
  /** The last hint shown, kept after the popup closes: reopening it for the
   * same technique keeps what was already revealed (see onOpenHint). */
  const lastHintRef = useRef<{ hint: TechniqueHint; revealed: number } | null>(null)
  const [confirmOptimizeDynamicOpen, setConfirmOptimizeDynamicOpen] = useState(false)
  const [confirmAllPossibleTechniquesOpen, setConfirmAllPossibleTechniquesOpen] = useState(false)
  // Where How It Works is open (null: closed) - a hint's "Learn this
  // technique" link opens it on that technique's tab/sub-tab.
  const [tutorialTarget, setTutorialTarget] = useState<TutorialTarget | null>(null)
  const { compact, phone, landscape } = useCompactLayout()
  // Touch device with no hardware keyboard: the Keyboard Input switches and
  // keyboard-shortcut settings are hidden (always true on desktop).
  const hasKeyboard = useHasKeyboard(compact)

  // Desktop: the Techniques panel ends level with the bottom of the "Drag or
  // paste a grid" row next to it. The grid is square and shrinks with the
  // window, so where that row ends can't be a fixed CSS height - it's
  // measured, and re-measured whenever the grid column resizes. Only while
  // the panel sits beside the grid (same top); once the row wraps it onto a
  // line of its own it keeps its natural height.
  const techniquePanelRef = useRef<HTMLDivElement>(null)
  const gridColumnRef = useRef<HTMLDivElement>(null)
  const importSecondaryRowRef = useRef<HTMLDivElement>(null)
  const [techniquePanelHeight, setTechniquePanelHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const panel = techniquePanelRef.current
    const column = gridColumnRef.current
    const row = importSecondaryRowRef.current
    if (compact || !panel || !column || !row) {
      setTechniquePanelHeight(null)
      return
    }
    const measure = () => {
      const panelTop = panel.getBoundingClientRect().top
      const besideGrid = Math.abs(panelTop - column.getBoundingClientRect().top) < 2
      setTechniquePanelHeight(besideGrid ? Math.round(row.getBoundingClientRect().bottom - panelTop) : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(column)
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [compact])
  // The touch layout opens on the digit pads - entering and marking digits
  // is what a phone user does first; the Techniques list is a spoiler anyway.
  const [compactSection, setCompactSection] = useState<CompactSection>('input')
  const [importText, setImportText] = useState('')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  // Every explicitly started long operation still running (see
  // runBusyTask) - a list rather than one slot because the worker-based
  // puzzle generation keeps the main thread free, so something else can
  // start and finish while it runs; each removes only its own entry.
  const [busyTasks, setBusyTasks] = useState<RunningBusyTask[]>([])
  const [ocrDragActive, setOcrDragActive] = useState(false)
  // A screenshot import waiting to be proofread: its digits load as ordinary
  // (editable) solved cells, so a misread one can be fixed, and only become
  // givens when the user clicks "Lock as givens" in the banner under the
  // grid. `historyIndex` is the import's undo-history entry - undoing past it
  // hides the banner, and a new edit from there discards it (commitGrid).
  // `imageUrl` is an object URL of the screenshot, shown for comparison.
  const [ocrProofread, setOcrProofread] = useState<{ historyIndex: number; imageUrl: string } | null>(null)
  const [ocrProofreadShowImage, setOcrProofreadShowImage] = useState(false)
  const ocrProofreadVisible = ocrProofread !== null && historyIndex >= ocrProofread.historyIndex
  useEffect(() => {
    if (!ocrProofread) {
      return
    }
    return () => URL.revokeObjectURL(ocrProofread.imageUrl)
  }, [ocrProofread])
  const busy = busyTasks.length > 0
  const busyKinds = new Set(busyTasks.map((t) => t.kind))
  const solving = busyKinds.has('solve')
  const generating = busyKinds.has('generate')
  const ocrBusy = busyKinds.has('ocr')
  const [status, setStatus] = useState('Grid status')

  const filled = useMemo(
    () => board.flat().filter((value) => value !== 0).length,
    [board],
  )

  const hasAnyCandidates = useMemo(
    () => candidates.some((row) => row.some((cell) => cell.some(Boolean))),
    [candidates],
  )

  const hasAnyPaintedColor = useMemo(
    () => candidateColors.some((row) => row.some((cell) => cell.some((paint) => paint !== null))),
    [candidateColors],
  )
  const selectedCellHasPaintedColor =
    selected !== null && candidateColors[selected.row][selected.col].some((paint) => paint !== null)

  // Every colour painted on the grid, in the Colour section's swatch order -
  // Autocomplete Colours takes the first two as the Medusa's two sides.
  const paintedSwatches = useMemo(() => {
    const present = new Set<CandidateColor>()
    for (const row of candidateColors) {
      for (const cell of row) {
        for (const paint of cell) {
          paint?.forEach((layer) => present.add(layer.color))
        }
      }
    }
    return candidateColorSwatches.filter((swatch) => present.has(swatch.id))
  }, [candidateColors, candidateColorSwatches])

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
  // Each fish toggle, and Extended UR's, Grouped AIC's, ALS-xz's, UR-AIC's and ALS-AIC's, is the same kind of master
  // switch over its own Dynamic Dragon checkbox.
  const effectiveAllowedRule3Techniques = useMemo(() => {
    if (
      shortAicEnabled &&
      shortSingleDigitAicEnabled &&
      genericAicEnabled &&
      alsXzEnabled &&
      urAicEnabled &&
      alsAicEnabled &&
      groupedAicEnabled &&
      extendedUrEnabled &&
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
    if (!urAicEnabled) {
      next.delete('ur-aic')
    }
    if (!alsAicEnabled) {
      next.delete('als-aic')
    }
    if (!groupedAicEnabled) {
      next.delete('grouped aic')
    }
    if (!extendedUrEnabled) {
      next.delete('extended ur')
    }
    return next
  }, [allowedRule3Techniques, shortAicEnabled, shortSingleDigitAicEnabled, genericAicEnabled, alsXzEnabled, urAicEnabled, alsAicEnabled, groupedAicEnabled, extendedUrEnabled, enabledFish])

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
  // The puzzle the SE rating under the grid is for: the givens, so the
  // rating is the loaded/generated puzzle's and stays put while it is being
  // solved. A grid with no usable givens (digits typed in, or a screenshot
  // still being proofread) is rated as it stands instead. Only a puzzle with
  // exactly one solution is rated - SE's number means nothing otherwise. A
  // string, so the rating is only redone when the puzzle itself changes.
  const seRatedPuzzle = useMemo(() => {
    if (givensSolveResult.status === 'solved') {
      return board.map((row, r) => row.map((value, c) => (givens[r][c] ? value : 0)).join('')).join('')
    }
    return puzzleSolveResult.status === 'solved' && filled < 81 ? board.map((row) => row.join('')).join('') : null
  }, [board, givens, givensSolveResult, puzzleSolveResult, filled])
  const seRating = useSeRating(seRatedPuzzle)
  const seRatingLine = seRating && seRatingText(seRating, 'puzzle')

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

  // The "current" SE rating beside it: SE started from the position on the
  // grid now - givens, solved cells and whatever candidates are left - so
  // it drops as the hard steps get done. Needs a position SE can make
  // sense of: digits that still solve, and no true candidate eliminated.
  // Before the first move it is the puzzle itself, and nothing is rated
  // twice (the string is then the same as seRatedPuzzle).
  const seCurrentPosition = useMemo(
    () =>
      seRatedPuzzle && puzzleSolveResult.status === 'solved' && candidatesAccurate && filled < 81
        ? seRatingPosition(board, candidates, freshAutofillCandidates(board))
        : null,
    [seRatedPuzzle, puzzleSolveResult, candidatesAccurate, filled, board, candidates],
  )
  const seCurrentIsPuzzle = seCurrentPosition === seRatedPuzzle
  const seCurrentOwnRating = useSeRating(seCurrentIsPuzzle ? null : seCurrentPosition, false)
  const seCurrentRating = seCurrentIsPuzzle ? seRating : seCurrentOwnRating
  const seCurrentRatingLine = seCurrentRating && seRatingText(seCurrentRating, 'current')

  // Everything the Techniques list is computed from. It reads `analysis`
  // (one painted frame behind, see useSettledValue) rather than the live
  // values, so the busy indicator is on screen before the recompute blocks
  // the page. (The solvability check's far longer solve-path search isn't
  // here - it runs in a Web Worker, see solvabilityRequest.)
  const liveAnalysisInputs = useMemo(
    () => ({
      board,
      candidates,
      givens,
      minBaseMedusaFilter,
      allPossibleTechniques,
      listEasiestDragonTechniquesFirst,
      effectiveAllowedRule3Techniques,
      shortAicEnabled,
      shortSingleDigitAicEnabled,
      aicLimitPerDragonStep,
      maxTechniquesPerDragonStep,
      exhaustiveDragonColouring,
      genericAicEnabled,
      optimizeDragons,
      optimizeDynamicDragons,
      dynamicDragonDisabled,
      enabledFish,
      alsXzEnabled,
      urAicEnabled,
      alsAicEnabled,
      groupedAicEnabled,
      doubleDragonEnabled,
      doubleDynamicDragonEnabled,
      enabledExotic,
    }),
    [
      board,
      candidates,
      givens,
      minBaseMedusaFilter,
      allPossibleTechniques,
      listEasiestDragonTechniquesFirst,
      effectiveAllowedRule3Techniques,
      shortAicEnabled,
      shortSingleDigitAicEnabled,
      aicLimitPerDragonStep,
      maxTechniquesPerDragonStep,
      exhaustiveDragonColouring,
      genericAicEnabled,
      optimizeDragons,
      optimizeDynamicDragons,
      dynamicDragonDisabled,
      enabledFish,
      alsXzEnabled,
      urAicEnabled,
      alsAicEnabled,
      groupedAicEnabled,
      doubleDragonEnabled,
      doubleDynamicDragonEnabled,
      enabledExotic,
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

  // Nothing is listed while a cell's correct digit has been removed from its
  // candidates (by request): the finders trust the marks as given, so every
  // row would be reasoned from a wrong grid - and applying one digs the hole
  // deeper. The panel and the Hint popup say so instead (`wrongCandidates`).
  // candidatesAccurate is live while `analysis` is a frame behind; for that
  // one frame the two may disagree, which shows nothing worse than a blink.
  const techniqueInstances = useMemo(
    () =>
      !candidatesAccurate
        ? NO_TECHNIQUE_INSTANCES
        : buildTechniqueInstances(
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
        analysis.maxTechniquesPerDragonStep,
        analysis.doubleDragonEnabled,
        analysis.doubleDynamicDragonEnabled,
        analysis.givens,
        analysis.enabledExotic,
        analysis.urAicEnabled,
        analysis.alsAicEnabled,
        analysis.groupedAicEnabled,
        analysis.allPossibleTechniques,
        false,
        analysis.listEasiestDragonTechniquesFirst,
      ),
    // Not keyed on `analysis` itself: easySolveEnabled (and the
    // solvability-only fields) changing mustn't redo this.
    [
      candidatesAccurate,
      analysis.allPossibleTechniques,
      analysis.listEasiestDragonTechniquesFirst,
      analysis.enabledFish,
      analysis.enabledExotic,
      analysis.alsXzEnabled,
      analysis.urAicEnabled,
      analysis.alsAicEnabled,
      analysis.groupedAicEnabled,
      analysis.doubleDragonEnabled,
      analysis.doubleDynamicDragonEnabled,
      analysis.board,
      analysis.candidates,
      analysis.givens,
      analysis.minBaseMedusaFilter,
      analysis.effectiveAllowedRule3Techniques,
      analysis.shortAicEnabled,
      analysis.shortSingleDigitAicEnabled,
      analysis.aicLimitPerDragonStep,
      analysis.maxTechniquesPerDragonStep,
      analysis.exhaustiveDragonColouring,
      analysis.genericAicEnabled,
      analysis.optimizeDragons,
      analysis.optimizeDynamicDragons,
      analysis.dynamicDragonDisabled,
    ],
  )
  // The "3+ base Medusa candidates" filter only hides Dragon rows from this
  // list - the Solve Path and the solvability status ignore it - so with
  // the filter on, an empty list could sit next to "Solvable" with no clue
  // why. Only then is the list rebuilt without the filter, to say how many
  // rows it hid: an empty filtered list means every other finder found
  // nothing, so whatever the unfiltered run lists is exactly what the filter
  // dropped. Not done for a non-empty list (by request), which would double
  // the Dragon work on every change.
  const hiddenByMedusaFilterCount = useMemo(
    () =>
      !candidatesAccurate || !analysis.minBaseMedusaFilter || techniqueInstances.length > 0
        ? 0
        : buildTechniqueInstances(
            analysis.board,
            analysis.candidates,
            0,
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
            analysis.maxTechniquesPerDragonStep,
            analysis.doubleDragonEnabled,
            analysis.doubleDynamicDragonEnabled,
            analysis.givens,
            analysis.enabledExotic,
            analysis.urAicEnabled,
            analysis.alsAicEnabled,
            analysis.groupedAicEnabled,
          ).length,
    // Same inputs as techniqueInstances (which it also reads).
    [
      candidatesAccurate,
      techniqueInstances,
      analysis.enabledFish,
      analysis.enabledExotic,
      analysis.alsXzEnabled,
      analysis.urAicEnabled,
      analysis.alsAicEnabled,
      analysis.groupedAicEnabled,
      analysis.doubleDragonEnabled,
      analysis.doubleDynamicDragonEnabled,
      analysis.board,
      analysis.candidates,
      analysis.givens,
      analysis.minBaseMedusaFilter,
      analysis.effectiveAllowedRule3Techniques,
      analysis.shortAicEnabled,
      analysis.shortSingleDigitAicEnabled,
      analysis.aicLimitPerDragonStep,
      analysis.maxTechniquesPerDragonStep,
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
  const candidateColorsKey = useMemo(() => JSON.stringify(candidateColors), [candidateColors])
  const autocompleteResultIsCurrent =
    autocompleteResult?.kind === 'found' &&
    boardsEqual(board, autocompleteResult.boardBefore) &&
    candidatesEqual(candidates, autocompleteResult.candidatesBefore) &&
    candidateColorsKey === autocompleteResult.coloursKey
  const autocompleteInstance =
    autocompleteResult?.kind === 'found' && autocompleteResultIsCurrent ? autocompleteResult.instance : null
  const autocompleteChainKeys = useMemo(
    () =>
      techniquePanelTab === 'autocomplete' &&
      autocompleteResult?.kind === 'found' &&
      autocompleteResultIsCurrent &&
      autocompleteResult.chainKeys
        ? new Set(autocompleteResult.chainKeys)
        : null,
    [techniquePanelTab, autocompleteResult, autocompleteResultIsCurrent],
  )
  const selectedTechnique =
    techniquePanelTab === 'solve-path'
      ? (activeSolvePathIndex !== null ? (solvePath?.steps[activeSolvePathIndex]?.instance ?? null) : null)
      : techniquePanelTab === 'find'
        ? findInstance
        : techniquePanelTab === 'autocomplete'
          ? autocompleteInstance
          : activeTechnique
  // A selected AIC row whose equivalent Dragon is being shown (dev only): the
  // grid, the step player and the colours then follow that Dragon instead of
  // the chain. Apply still applies the row itself.
  const aicDragonSource =
    aicDragonDevEnabled && techniquePanelTab === 'techniques' && selectedTechnique && isAicInstance(selectedTechnique)
      ? selectedTechnique
      : null
  // Built from the chain itself (SudokuAicDragonConverter): the plain Dragon
  // that follows it, else - unless Dynamic Dragons are disabled - a Dynamic
  // one under the current Dynamic settings minus the AIC kinds.
  const computeAicDragon = useCallback((source: TechniqueInstance): AicDragonResults => {
    const shape = aicInstanceShape(source)
    const eliminations = source.eliminatedCandidates
    const options = {
      dynamicEnabled: !dynamicDragonDisabled,
      allowedRule3Techniques: new Set([...effectiveAllowedRule3Techniques].filter((t) => !AIC_RULE3_TECHNIQUES.has(t))),
      aicLimitPerStep: aicLimitPerDragonStep,
      maxTechniquesPerStep: maxTechniquesPerDragonStep,
      givens,
    }
    const candidateText = (node: AicChainShape['nodes'][number]) => `${node[0].digit}${cellRef(node[0].row, node[0].col)}`
    const linkText = (link: number) => `${candidateText(shape.nodes[link])} = ${candidateText(shape.nodes[link + 1])}`
    const total = new Set(shape.nodes.flat().map((c) => `${c.row},${c.col},${c.digit}`)).size
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
    const removes = (extras: number) =>
      extras === 0 ? 'It removes exactly what the chain removes.' : `It also removes ${plural(extras, 'other candidate')}.`

    const describe = (variant: AicDragonVariant, { best, medusa, failure }: AicDragonSearch): AicDragonResult => {
      const short = variant === 'short'
      // A Medusa that already makes the chain's eliminations by itself comes
      // first, by request - it is the easier technique - even when a Dragon
      // from another of the chain's links exists too.
      const built = medusa ? buildMedusaChainInstance(medusa.medusa, board, candidates) : null
      if (medusa && built) {
        return {
          kind: 'found',
          status: 'medusa',
          label: short ? 'Show equivalent Short Medusa' : 'Show equivalent 3D Medusa',
          instance: {
            ...(short ? { ...built.instance, id: `short-${built.instance.id}`, name: `Short Medusa (${built.instance.name})` } : built.instance),
            aicTargetCandidates: eliminations,
          },
          summary: [
            short
              ? `Partial Medusa doing the work.`
              : `${built.instance.name}: Full-breadth Medusa for reference.`,
            `It colours ${medusa.coloured} of the chain's ${plural(total, 'candidate')}.`,
            medusa.medusaExtras > 0
              ? `It also colours ${plural(medusa.medusaExtras, 'candidate')} that ${medusa.medusaExtras === 1 ? 'is' : 'are'} not on the chain${short ? ' (the chain itself is not joined by strong links all the way)' : ''}.`
              : '',
            removes(medusa.extras.length),
          ]
            .filter(Boolean)
            .join(' '),
        }
      }
      if (!best) {
        return {
          kind: 'none',
          status: 'none',
          text: short
            ? `No Short Medusa or Short Dragon either: ${failure === 'no-medusa-link' ? AIC_DRAGON_FAILURE_TEXT['no-medusa-link'] : AIC_DRAGON_FAILURE_TEXT[failure === 'not-covered' ? 'not-covered' : 'unreachable']}`
            : `No Dragon follows this chain exactly: ${AIC_DRAGON_FAILURE_TEXT[failure ?? 'unreachable']}`,
        }
      }
      const base = best.kind === 'dragon' ? 'Dragon Colouring' : dynamicDragonLabel(best.moves)
      const name = short ? `Short ${base}` : base
      const offChain = short ? best.offChain : best.medusaExtras
      // Anything coloured outside the chain's own candidates (and an
      // ALS-AIC's ALS cells) - the Medusa's extras included - makes it partial.
      const partial = best.offChain > 0
      return {
        kind: 'found',
        status: best.kind,
        ...(partial ? { partial: true as const } : {}),
        label: `Show ${partial ? 'partial ' : ''}equivalent ${short ? 'Short ' : ''}Dragon`,
        instance: {
          ...buildDragonInstance(board, candidates, best.kind === 'dragon' ? 'dragon' : 'dynamic-dragon', name, best.chainKey, best.moves),
          // The chain's eliminations are ringed on the grid while the
          // colouring builds up (not a yellow cell border, by request: that
          // is what an ALS outline looks like).
          aicTargetCandidates: eliminations,
        },
        summary: [
          short
            ? `${name}, ${plural(best.moves.length, 'step')}: Utilizes the strong link ${linkText(best.seedLink)} for the medusa, then immediately starts the extensions.`
            : `${name}, ${plural(best.moves.length, 'step')}, Utilizes a stuck medusa, and starting the extensions from the strong link ${linkText(best.seedLink)}.`,
          `${best.coloured} of the chain's ${plural(total, 'candidate')} end up coloured; the rest are the ones each extension rules out.`,
          partial ? `A partial equivalent: it colours ${plural(best.offChain, 'candidate')} the chain doesn't use.` : '',
          offChain > 0 && !partial
            ? short
              ? `${plural(offChain, 'candidate')} off the chain ${offChain === 1 ? 'is' : 'are'} coloured too.`
              : `The Medusa also colours ${plural(offChain, 'candidate')} that ${offChain === 1 ? 'is' : 'are'} not on the chain.`
            : '',
          best.furtherExtensions > 0 ? `It needed ${plural(best.furtherExtensions, 'more extension')} after the chain's own candidates.` : '',
          removes(best.extras.length),
        ]
          .filter(Boolean)
          .join(' '),
      }
    }
    return {
      full: describe('full', aicDragonConverter.find(board, candidates, shape, eliminations, options)),
      short: describe('short', aicDragonConverter.findShort(board, candidates, shape, eliminations, options)),
    }
  }, [
    board,
    candidates,
    dynamicDragonDisabled,
    effectiveAllowedRule3Techniques,
    aicLimitPerDragonStep,
    maxTechniquesPerDragonStep,
    givens,
  ])
  // Each chain row is converted once and kept by its instance (a new grid or
  // new settings make new instances; `by` guards the frame in which the list
  // is still the previous grid's).
  const aicDragonResults = useRef(new WeakMap<TechniqueInstance, { by: typeof computeAicDragon; result: AicDragonResults }>())
  const aicDragonFor = useCallback(
    (source: TechniqueInstance): AicDragonResults => {
      const known = aicDragonResults.current.get(source)
      if (known && known.by === computeAicDragon) {
        return known.result
      }
      const result = computeAicDragon(source)
      aicDragonResults.current.set(source, { by: computeAicDragon, result })
      return result
    },
    [computeAicDragon],
  )
  const aicDragonResult = useMemo(() => (aicDragonSource ? aicDragonFor(aicDragonSource) : null), [aicDragonSource, aicDragonFor])
  // The badges of every chain row in the Techniques list, worked out one row
  // per task after the list is on screen (a few ms each, dozens of rows).
  const [aicDragonStatusVersion, setAicDragonStatusVersion] = useState(0)
  useEffect(() => {
    if (!aicDragonDevEnabled) {
      return
    }
    const pending = techniqueInstances.filter(isAicInstance)
    let cancelled = false
    let timer = 0
    const next = (at: number) => {
      if (cancelled || at >= pending.length) {
        return
      }
      if (aicDragonResults.current.get(pending[at])?.by !== computeAicDragon) {
        aicDragonFor(pending[at])
        setAicDragonStatusVersion((version) => version + 1)
      }
      timer = window.setTimeout(() => next(at + 1), 0)
    }
    timer = window.setTimeout(() => next(0), 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [aicDragonDevEnabled, techniqueInstances, computeAicDragon, aicDragonFor])
  const aicDragonShownResult = aicDragonResult && aicDragonShown !== 'chain' ? aicDragonResult[aicDragonShown] : null
  const highlightedTechnique = aicDragonShownResult?.kind === 'found' ? aicDragonShownResult.instance : selectedTechnique

  // Usage analytics (usageTracking.ts): which part of the solver the user
  // is in - the dock tab on a touch layout, else the Techniques-panel tab
  // plus the technique being studied on it. Menus and overlays stack above.
  const solverArea =
    compact && compactSection !== 'techniques'
      ? `Solver › ${COMPACT_SECTIONS.find((section) => section.id === compactSection)?.label ?? compactSection}`
      : techniquePanelTab === 'techniques' && !techniquesRevealed
        ? 'Solver › Playing (techniques hidden)'
        : selectedTechnique
          ? `Solver › ${TECHNIQUE_PANEL_TAB_LABELS[techniquePanelTab]} › ${techniqueTrackingName(selectedTechnique.name)}`
          : `Solver › ${TECHNIQUE_PANEL_TAB_LABELS[techniquePanelTab]}`
  useAnalyticsArea(solverArea, AREA_LAYER.solver)
  // Every setting as one AppSettings snapshot: saved so a reopened tab
  // comes back as it was left (persistedState.ts), and diffed for usage
  // analytics. A new setting must be added here and to the deps.
  const currentSettings = useMemo<AppSettings>(
    () => ({
      keyboardMode,
      showStrongLinks,
      showBivalueCells,
      gridWhiteMode,
      minBaseMedusaFilter,
      allPossibleTechniques,
      shortSingleDigitAicEnabled,
      shortAicEnabled,
      genericAicEnabled,
      xWingEnabled,
      finnedXWingEnabled,
      swordfishEnabled,
      finnedSwordfishEnabled,
      alsXzEnabled,
      urAicEnabled,
      alsAicEnabled,
      groupedAicEnabled,
      sueDeCoqEnabled,
      extendedUrEnabled,
      dynamicDragonDisabled,
      doubleDragonEnabled,
      doubleDynamicDragonEnabled,
      allowedRule3Techniques: [...allowedRule3Techniques],
      exhaustiveDragonColouring,
      optimizeDragons,
      optimizeDynamicDragons,
      aicLimitPerDragonStep,
      maxTechniquesPerDragonStep,
      dynamicDragonAutoSolveIncludesAics,
      dragonGenerationDisregardsSingleDigitAic,
      dragonGenerationDisregardsAic,
      dragonGenerationDisregardsGenericAic,
      dynamicDragonPuzzleForbidsPlainDragon,
      dynamicDragonPuzzleForbidsDoubleDragon,
      dynamicDragonPuzzleUsesDefaultsOnly,
      dragonGenerationTimeoutMs,
      easySolveEnabled,
      preferEasierDoubleDragons,
      preferEasiestDragonTechniques,
      techniquesListEasiestDragonTechniquesFirst: listEasiestDragonTechniquesFirst,
      solvePathTimeoutMs,
      hotkeys,
    }),
    [
      keyboardMode,
      showStrongLinks,
      showBivalueCells,
      gridWhiteMode,
      minBaseMedusaFilter,
      allPossibleTechniques,
      shortSingleDigitAicEnabled,
      shortAicEnabled,
      genericAicEnabled,
      xWingEnabled,
      finnedXWingEnabled,
      swordfishEnabled,
      finnedSwordfishEnabled,
      alsXzEnabled,
      urAicEnabled,
      alsAicEnabled,
      groupedAicEnabled,
      sueDeCoqEnabled,
      extendedUrEnabled,
      dynamicDragonDisabled,
      doubleDragonEnabled,
      doubleDynamicDragonEnabled,
      allowedRule3Techniques,
      exhaustiveDragonColouring,
      optimizeDragons,
      optimizeDynamicDragons,
      aicLimitPerDragonStep,
      maxTechniquesPerDragonStep,
      dynamicDragonAutoSolveIncludesAics,
      dragonGenerationDisregardsSingleDigitAic,
      dragonGenerationDisregardsAic,
      dragonGenerationDisregardsGenericAic,
      dynamicDragonPuzzleForbidsPlainDragon,
      dynamicDragonPuzzleForbidsDoubleDragon,
      dynamicDragonPuzzleUsesDefaultsOnly,
      dragonGenerationTimeoutMs,
      easySolveEnabled,
      preferEasierDoubleDragons,
      preferEasiestDragonTechniques,
      listEasiestDragonTechniquesFirst,
      solvePathTimeoutMs,
      hotkeys,
    ],
  )
  useEffect(() => {
    saveSettings(currentSettings)
  }, [currentSettings])
  useEffect(() => {
    trackSettingsChanges(currentSettings as unknown as Record<string, unknown>)
  })
  useEffect(() => {
    // A screenshot import still being proofread is saved already locked: the
    // proofread (and the screenshot) doesn't survive a reload, so what comes
    // back is the digits as they stood, as givens - same as "Lock as givens".
    saveGrid(
      ocrProofreadVisible
        ? { ...grid, givens: grid.board.map((row) => row.map((value) => value !== 0)) }
        : grid,
    )
  }, [grid, ocrProofreadVisible])
  const gridFilled = board.every((row) => row.every((value) => value !== 0)) && conflictedCells.size === 0
  useEffect(() => {
    if (gridFilled) {
      trackEvent('puzzle', 'Grid filled')
    }
  }, [gridFilled])

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
  // Autocomplete Dragon shows the step player's colouring in the user's own
  // swatches: every candidate coloured at the current step gets its Dragon
  // colour's swatch, drawn as paint instead of the fixed light blue/yellow/
  // dark blue/orange highlight, and nothing else shows paint meanwhile (so
  // rewinding really takes colours off). "row,col,digit" -> paint.
  const autocompleteDragonPaint = useMemo(() => {
    const dragon =
      techniquePanelTab === 'autocomplete' && autocompleteResult?.kind === 'found' && autocompleteResultIsCurrent
        ? autocompleteResult.dragon
        : undefined
    if (!dragon || !dragonHighlight) {
      return null
    }
    const paintByKey = new Map<string, CandidatePaint>()
    const add = (refs: Array<{ row: number; col: number; digit: number }>, color: DragonColor) => {
      for (const ref of refs) {
        paintByKey.set(`${ref.row},${ref.col},${ref.digit}`, [dragon.rolePaint[color]])
      }
    }
    add(dragonHighlight.blueCandidates, 'blue')
    add(dragonHighlight.yellowCandidates, 'yellow')
    add(dragonHighlight.darkBlueCandidates, 'darkBlue')
    add(dragonHighlight.orangeCandidates, 'orange')
    return paintByKey
  }, [techniquePanelTab, autocompleteResult, autocompleteResultIsCurrent, dragonHighlight])
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

  // A single plain or Dynamic Dragon's elimination step as an AIC (plain if
  // there is one, else the easiest complex one) through the Dragon's own
  // coloured candidates (see SudokuDragonAicConverter): drawn over the
  // colouring, which stays. `undefined` = not a single Dragon (or one the grid
  // has moved on from, e.g. an applied Solve Path step); `view: null` on an
  // elimination step = no chain form (a forcing net).
  // The box only appears for a Dragon with a chain at one step at least (by
  // request); the rows' badges say which Dragons those are.
  // Each Dragon is converted once, every elimination step together, and kept
  // by its move log for as long as that log is on that grid: equally easy
  // chains are picked between at random, and stepping away and back must not
  // swap the chain under the reader.
  const dragonAicSummaries = useRef(new WeakMap<readonly DragonMove[], { board: Board; candidates: CandidateGrid; summary: DragonAicSummary }>())
  const summarizeDragonAic = useCallback((moves: readonly DragonMove[], onBoard: Board, onCandidates: CandidateGrid): DragonAicSummary => {
    const known = dragonAicSummaries.current.get(moves)
    if (known && known.board === onBoard && known.candidates === onCandidates) {
      return known.summary
    }
    const summary = dragonAicSummary(onBoard, onCandidates, moves)
    dragonAicSummaries.current.set(moves, { board: onBoard, candidates: onCandidates, summary })
    return summary
  }, [])
  // The badges of every single Dragon listed (Techniques list on the current
  // grid, Solve Path steps each on their own), worked out one Dragon per
  // task after the list is on screen - a long Exhaustive log is tens of
  // conversions at several ms each, and there can be dozens of rows.
  const [dragonAicStatusVersion, setDragonAicStatusVersion] = useState(0)
  const solvePathSteps = solvePath?.steps
  useEffect(() => {
    if (!dragonAicDevEnabled) {
      return
    }
    const pending = [
      ...techniqueInstances.filter(isSingleDragon).map((instance) => ({ moves: instance.moves!, board, candidates })),
      ...(solvePathSteps ?? [])
        .filter((step) => isSingleDragon(step.instance))
        .map((step) => ({ moves: step.instance.moves!, board: step.boardBefore, candidates: step.candidatesBefore })),
    ]
    let cancelled = false
    let timer = 0
    const next = (at: number) => {
      if (cancelled || at >= pending.length) {
        return
      }
      const { moves, board: onBoard, candidates: onCandidates } = pending[at]
      const known = dragonAicSummaries.current.get(moves)
      if (!known || known.board !== onBoard || known.candidates !== onCandidates) {
        summarizeDragonAic(moves, onBoard, onCandidates)
        setDragonAicStatusVersion((version) => version + 1)
      }
      timer = window.setTimeout(() => next(at + 1), 0)
    }
    timer = window.setTimeout(() => next(0), 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [dragonAicDevEnabled, techniqueInstances, solvePathSteps, board, candidates, summarizeDragonAic])

  const dragonAic = useMemo(() => {
    const moves = highlightedTechnique?.moves
    if (!dragonAicDevEnabled || !moves || !isSingleDragon(highlightedTechnique)) {
      return undefined
    }
    if (!moves[0].colored.every((n) => board[n.row][n.col] === 0 && candidates[n.row][n.col][n.digit - 1])) {
      return undefined
    }
    const summary = summarizeDragonAic(moves, board, candidates)
    if (summary.status === 'none') {
      return undefined
    }
    const index = Math.min(dragonStepIndex, moves.length - 1)
    const move = moves[index]
    if (!dragonAicShown || !isDragonEliminationMove(move)) {
      return { text: null, view: null }
    }
    const equivalent = summary.byStep.get(index) ?? null
    return {
      text: dragonAicText(move, equivalent, highlightedTechnique.id.startsWith('dynamic-dragon-')),
      view: equivalent ? aicChainView(equivalent.aic) : null,
    }
  }, [dragonAicDevEnabled, highlightedTechnique, dragonStepIndex, dragonAicShown, board, candidates, summarizeDragonAic])
  const dragonAicView = useMemo<DragonAicContextValue | null>(() => {
    if (!dragonAicDevEnabled) {
      return null
    }
    // A new value per version, so the badges re-render as Dragons finish.
    void dragonAicStatusVersion
    return {
      note: dragonAic ? { shown: dragonAicShown, onToggle: setDragonAicShown, text: dragonAic.text } : null,
      statusOf: (moves) => dragonAicSummaries.current.get(moves)?.summary.status,
    }
  }, [dragonAicDevEnabled, dragonAic, dragonAicShown, dragonAicStatusVersion])
  // The selected AIC row's "equivalent Dragon" note (dev only); null for any
  // other selection, which is what hides the note everywhere else.
  // A new value per version, so the badges re-render as rows are converted.
  void aicDragonStatusVersion
  const aicDragonView: AicDragonContextValue | null = aicDragonDevEnabled
    ? {
        note:
          aicDragonSource && aicDragonResult
            ? {
                sourceId: aicDragonSource.id,
                results: aicDragonResult,
                shown: aicDragonShown,
                onShow: onShowAicDragon,
                stepIndex: dragonStepIndex,
                onDragonStep,
                substepIndex: dragonSubstepIndex,
                onSubstep: onDragonSubstep,
              }
            : null,
        resultsOf: (instance) => {
          const known = aicDragonResults.current.get(instance)
          return known && known.by === computeAicDragon ? known.result : undefined
        },
      }
    : null

  // The AIC chain overlay: which links to draw, and where (straight or how
  // curved - see aicLinkLayout.ts). Memoized because the layout scores
  // several curves per link against the chain and every other link.
  const highlightedAicLinks = highlightedTechnique?.aicLinks
  const highlightedEliminations = highlightedTechnique?.eliminatedCandidates
  const aicLinkOverlay = useMemo(() => {
    const links = dragonAicChains ? dragonAicChains.flatMap((chain) => chain.links) : (dragonAic?.view?.links ?? highlightedAicLinks)
    // What the chain eliminates - the hypothetical eliminations, inside a
    // Dynamic Dragon step - is kept clear of lines, like the chain itself.
    const eliminations = dragonAicChains ? dragonAicChains.flatMap((chain) => chain.hypotheticalEliminations) : (highlightedEliminations ?? [])
    return links && links.length > 0 ? layoutAicOverlay(links, eliminations, board, candidates) : null
  }, [dragonAicChains, dragonAic, highlightedAicLinks, highlightedEliminations, board, candidates])

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
  // Without the "Dragon: require 3+ base Medusa candidates" filter: what the
  // "Solvable" check uses (the filter is about which Dragons are shown and
  // taken, not about whether the puzzle can be solved). The Solve Path's own
  // options, with the filter, are solvePathOptions just below.
  const solvabilityOptions = useMemo(
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
      maxTechniquesPerDragonStep,
      doubleDragonEnabled,
      doubleDynamicDragonEnabled,
      enabledExotic: [...enabledExotic],
      urAicEnabled,
      alsAicEnabled,
      groupedAicEnabled,
      preferEasierDoubleDragons: easySolveEnabled && preferEasierDoubleDragons,
      preferEasiestDragonTechniques: easySolveEnabled && preferEasiestDragonTechniques,
      minBaseMedusaCandidates: 0,
    }),
    [
      preferEasierDoubleDragons,
      preferEasiestDragonTechniques,
      enabledFish,
      enabledExotic,
      alsXzEnabled,
      urAicEnabled,
      alsAicEnabled,
      groupedAicEnabled,
      doubleDragonEnabled,
      doubleDynamicDragonEnabled,
      effectiveAllowedRule3Techniques,
      shortAicEnabled,
      shortSingleDigitAicEnabled,
      aicLimitPerDragonStep,
      maxTechniquesPerDragonStep,
      exhaustiveDragonColouring,
      genericAicEnabled,
      easySolveEnabled,
      optimizeDragons,
      optimizeDynamicDragons,
      solvePathTimeoutMs,
      dynamicDragonDisabled,
    ],
  )
  const solvePathOptions = useMemo(
    (): SolvePathOptions =>
      minBaseMedusaFilter ? { ...solvabilityOptions, minBaseMedusaCandidates: MIN_BASE_MEDUSA_CANDIDATES } : solvabilityOptions,
    [solvabilityOptions, minBaseMedusaFilter],
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
        ? { board, candidates: freshAutofill, givens, options: solvabilityOptions }
        : null,
    [board, freshAutofill, givens, puzzleSolveResult, candidatesAccurate, solvabilityOptions],
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
    return removesSomething ? { board, candidates, givens, options: solvabilityRequest.options } : null
  }, [solvabilityRequest, bruteSolvePath, board, candidates, givens, freshAutofill])
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
  ): number {
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
    // The screenshot proofread ends when its import entry is discarded (an
    // edit after undoing past it) or a different puzzle loads (its givens
    // change - the load sites with no givens clear it themselves).
    if (
      ocrProofread &&
      (truncated.length <= ocrProofread.historyIndex ||
        next.givens.some((row, r) => row.some((given, c) => given !== grid.givens[r][c])))
    ) {
      setOcrProofread(null)
    }
    return truncated.length
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
    // Usage analytics: what was run, how it ended and how long it took.
    const startedAt = performance.now()
    let outcome = 'completed'
    const onCancel = task.onCancel
    const tracked: BusyTask = onCancel
      ? {
          ...task,
          onCancel: () => {
            outcome = 'cancelled'
            onCancel()
          },
        }
      : task
    setBusyTasks((current) => [...current, { ...tracked, id, kind }])
    afterPaint(async () => {
      try {
        await work()
      } catch {
        outcome = 'failed'
        setStatus(`${task.title.replace(/…$/, '')} failed.`)
      } finally {
        setBusyTasks((current) => current.filter((t) => t.id !== id))
        trackEvent('task', `${kind}: ${task.title.replace(/…$/, '')}`, outcome, Math.round(performance.now() - startedAt))
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
    trackEvent('board', 'Undo')
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
    trackEvent('board', 'Redo')
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
    trackEvent('board', 'Digit placed')
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
    trackEvent('board', 'Cell cleared')
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
    trackEvent('board', 'Candidate toggled')
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

  /** The BUG+1/2/3 auto-solve button - one technique (BUG+N) internally. */
  function onBugPlusN() {
    if (!pairFinder.hasFullCandidates(board, candidates)) {
      setStatus('BUG+1 needs every empty cell to have its candidates marked first — try Autofill all.')
      return
    }

    const bug = bugPlusNFinder.find(board, candidates)
    if (!bug) {
      setStatus('No BUG+1 to apply - not every unsolved cell is bivalue except one to three cells with three candidates.')
      return
    }

    if (bug.solved) {
      const { row, col, digit } = bug.solved
      const nextBoard = cloneBoard(board)
      nextBoard[row][col] = digit
      const nextCandidates = cloneCandidates(candidates)
      nextCandidates[row][col] = Array(9).fill(false)
      SudokuRules.eliminatePeerCandidates(nextCandidates, nextBoard, row, col, digit)
      commitAutoSolve({ board: nextBoard, givens, candidates: nextCandidates })
      setStatus(`BUG+1 solved ${cellRef(row, col)} as ${digit}.`)
      return
    }

    const nextCandidates = cloneCandidates(candidates)
    for (const { row, col, digit } of bug.eliminations) {
      nextCandidates[row][col][digit - 1] = false
    }
    commitAutoSolve({ board, givens, candidates: nextCandidates })
    setStatus(`${bugPlusNName(bug)}: ${bugPlusNEliminationsText(bug)}.`)
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
      setStatus('Short Single-Digit AIC is turned off in Technique Selections.')
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
      setStatus('Short AIC is turned off in Technique Selections.')
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
      setStatus('Generic AIC is turned off in Technique Selections.')
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

  // Commented out along with its "Dragon (bivalue)" auto-solve button below;
  // left in place (rather than deleted) so the button can be restored.
  // function onDragonColouringBivalueSeeded() {
  //   runDragonColouring(
  //     (b, c, f) => computeStuckDragonExtensions(b, c, f, 0, exhaustiveDragonColouring, optimizeDragons),
  //     'bivalue-seeded',
  //     'Dragon Colouring (bivalue-seeded)',
  //   )
  // }

  function onDragonColouringAny() {
    runDragonColouring(
      (b, c, f) => computeStuckDragonExtensions(b, c, f, 0, exhaustiveDragonColouring, optimizeDragons),
      'any',
      'Dragon Colouring (any Medusa)',
    )
  }

  /** Whether auto-solve may apply a Dragon whose steps used these Dynamic
   * techniques - shared by the Dynamic and Double Dynamic buttons. */
  function dynamicDragonAutoSolveAllows(moves: DragonMove[]) {
    const uses = (techniques: Rule3Technique[]) =>
      moves.some((move) => (move.dynamicTechniques ?? []).some((t) => techniques.includes(t)))
    // Grouped AIC, ALS-xz, UR-AIC and ALS-AIC are never auto-solved, not even inside
    // a Dynamic Dragon chain - no setting opts back in.
    if (uses(['grouped aic', 'als-xz', 'ur-aic', 'als-aic'])) {
      return false
    }
    // Default: a chain whose steps needed an AIC (either kind) anywhere
    // is left entirely untouched by auto-solve, even if AICs are
    // otherwise enabled for Dynamic Dragon Colouring - the "Dynamic
    // Dragon Colouring auto-solve includes AICs?" setting is what
    // opts back in (its checkbox is hidden by request; only a value
    // saved before then, or Reset to defaults, still changes it).
    return dynamicDragonAutoSolveIncludesAics || !uses(['short aic', 'short single-digit aic', 'generic aic'])
  }

  function onDynamicDragonColouring() {
    runDragonColouring(
      (b, c, f) =>
        computeStuckDynamicDragonExtensions(
          b,
          c,
          f,
          0,
          effectiveAllowedRule3Techniques,
          aicLimitPerDragonStep,
          exhaustiveDragonColouring,
          optimizeDragons,
          optimizeDynamicDragons,
          maxTechniquesPerDragonStep,
          givens,
        ).filter(({ moves }) => dynamicDragonAutoSolveAllows(moves)),
      'any',
      'Dynamic Dragon Colouring',
    )
  }

  // The two Double buttons take every pair of stuck chains (no Medusa filter,
  // like the single Dragon buttons' 0 minimum base candidates).
  function onDoubleDragonColouring() {
    runDragonColouring(
      (b, c) => computeDoubleDragonExtensions(b, c, 0, exhaustiveDragonColouring, optimizeDragons),
      'any',
      'Double Dragon Colouring',
    )
  }

  function onDoubleDynamicDragonColouring() {
    runDragonColouring(
      (b, c) =>
        computeDoubleDynamicDragonExtensions(
          b,
          c,
          0,
          effectiveAllowedRule3Techniques,
          aicLimitPerDragonStep,
          maxTechniquesPerDragonStep,
          exhaustiveDragonColouring,
          optimizeDragons,
          optimizeDynamicDragons,
          doubleDragonEnabled,
          givens,
        ).filter(({ moves }) => dynamicDragonAutoSolveAllows(moves)),
      'any',
      'Double Dynamic Dragon Colouring',
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
    setAllPossibleTechniques(DEFAULT_SETTINGS.allPossibleTechniques)
    setShortSingleDigitAicEnabled(DEFAULT_SETTINGS.shortSingleDigitAicEnabled)
    setShortAicEnabled(DEFAULT_SETTINGS.shortAicEnabled)
    setGenericAicEnabled(DEFAULT_SETTINGS.genericAicEnabled)
    setXWingEnabled(DEFAULT_SETTINGS.xWingEnabled)
    setFinnedXWingEnabled(DEFAULT_SETTINGS.finnedXWingEnabled)
    setSwordfishEnabled(DEFAULT_SETTINGS.swordfishEnabled)
    setFinnedSwordfishEnabled(DEFAULT_SETTINGS.finnedSwordfishEnabled)
    setAlsXzEnabled(DEFAULT_SETTINGS.alsXzEnabled)
    setUrAicEnabled(DEFAULT_SETTINGS.urAicEnabled)
    setAlsAicEnabled(DEFAULT_SETTINGS.alsAicEnabled)
    setGroupedAicEnabled(DEFAULT_SETTINGS.groupedAicEnabled)
    setSueDeCoqEnabled(DEFAULT_SETTINGS.sueDeCoqEnabled)
    setExtendedUrEnabled(DEFAULT_SETTINGS.extendedUrEnabled)
    setDynamicDragonDisabled(DEFAULT_SETTINGS.dynamicDragonDisabled)
    setDoubleDragonEnabled(DEFAULT_SETTINGS.doubleDragonEnabled)
    setDoubleDynamicDragonEnabled(DEFAULT_SETTINGS.doubleDynamicDragonEnabled)
    setAllowedRule3Techniques(new Set(DEFAULT_SETTINGS.allowedRule3Techniques))
    setExhaustiveDragonColouring(DEFAULT_SETTINGS.exhaustiveDragonColouring)
    setOptimizeDragons(DEFAULT_SETTINGS.optimizeDragons)
    setOptimizeDynamicDragons(DEFAULT_SETTINGS.optimizeDynamicDragons)
    setEasySolveEnabled(DEFAULT_SETTINGS.easySolveEnabled)
    setPreferEasierDoubleDragons(DEFAULT_SETTINGS.preferEasierDoubleDragons)
    setPreferEasiestDragonTechniques(DEFAULT_SETTINGS.preferEasiestDragonTechniques)
    setListEasiestDragonTechniquesFirst(DEFAULT_SETTINGS.techniquesListEasiestDragonTechniquesFirst)
    setSolvePathTimeoutMs(DEFAULT_SETTINGS.solvePathTimeoutMs)
    setAicLimitPerDragonStep(DEFAULT_SETTINGS.aicLimitPerDragonStep)
    setMaxTechniquesPerDragonStep(DEFAULT_SETTINGS.maxTechniquesPerDragonStep)
    setDynamicDragonAutoSolveIncludesAics(DEFAULT_SETTINGS.dynamicDragonAutoSolveIncludesAics)
    setDragonGenerationDisregardsSingleDigitAic(DEFAULT_SETTINGS.dragonGenerationDisregardsSingleDigitAic)
    setDragonGenerationDisregardsAic(DEFAULT_SETTINGS.dragonGenerationDisregardsAic)
    setDragonGenerationDisregardsGenericAic(DEFAULT_SETTINGS.dragonGenerationDisregardsGenericAic)
    setDynamicDragonPuzzleForbidsPlainDragon(DEFAULT_SETTINGS.dynamicDragonPuzzleForbidsPlainDragon)
    setDynamicDragonPuzzleForbidsDoubleDragon(DEFAULT_SETTINGS.dynamicDragonPuzzleForbidsDoubleDragon)
    setDynamicDragonPuzzleUsesDefaultsOnly(DEFAULT_SETTINGS.dynamicDragonPuzzleUsesDefaultsOnly)
    setDragonGenerationTimeoutMs(DEFAULT_SETTINGS.dragonGenerationTimeoutMs)
    setHotkeys(DEFAULT_SETTINGS.hotkeys)
    setSwatchColors(defaultSwatchColors())
    setSwatchShapes(defaultSwatchShapes())
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
    // "Prefer easier double dragons" only exists under Easy Solve.
    if (easySolveEnabled) {
      setPreferEasierDoubleDragons(false)
    }
    setEasySolveEnabled((current) => !current)
  }

  function togglePreferEasierDoubleDragons() {
    setPreferEasierDoubleDragons((current) => !current)
  }

  function togglePreferEasiestDragonTechniques() {
    setPreferEasiestDragonTechniques((current) => !current)
  }

  function toggleListEasiestDragonTechniquesFirst() {
    setListEasiestDragonTechniquesFirst((current) => !current)
  }

  function onDragonGenerationTimeoutChange(event: ChangeEvent<HTMLSelectElement>) {
    setDragonGenerationTimeoutMs(Number(event.target.value))
  }

  function onSelectTechnique(id: string) {
    if (id !== activeTechniqueId) {
      const selected = techniqueInstances.find((t) => t.id === id)
      if (selected) {
        trackEvent('technique', 'Selected', techniqueTrackingName(selected.name))
      }
    }
    setActiveTechniqueId((current) => (current === id ? null : id))
    setDragonStepIndex(0)
    setDragonSubstepIndex(null)
  }

  function onToggleTechniquesRevealed() {
    // Hiding drops the selection too, or its highlight would stay on the
    // grid and give the hidden move away.
    if (techniquesRevealed) {
      setActiveTechniqueId(null)
      setDragonStepIndex(0)
      setDragonSubstepIndex(null)
    }
    setTechniquesRevealed(!techniquesRevealed)
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
    trackEvent('technique', 'Applied', techniqueTrackingName(activeTechnique.name))
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
    trackEvent('solve path', 'Steps applied', null, stepsToApply.length)
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

  function onShowAicDragon(shown: AicDragonShown) {
    setAicDragonShown(shown)
    setDragonStepIndex(0)
    setDragonSubstepIndex(null)
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
      maxTechniquesPerStep: maxTechniquesPerDragonStep,
      givens,
      optimizeDynamic: optimizeDynamicDragons,
      dynamicEnabled: !dynamicDragonDisabled,
      doubleEnabled: doubleDragonEnabled,
      doubleDynamicEnabled: doubleDynamicDragonEnabled,
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
      lines.push('Only the techniques enabled in Technique Selections are used.')
      if (note) lines.push(note)
      say(
        'info',
        `No ${dynamicDragonDisabled ? 'Dragon Colouring (Dynamic Dragons are disabled)' : 'Dragon or Dynamic Dragon Colouring'} finds ${targets.length === 1 ? 'that elimination' : 'all of those eliminations'}.`,
        lines,
      )
      return
    }

    const { idPrefix, name } = {
      dragon: { idPrefix: 'dragon', name: 'Dragon Colouring' },
      double: { idPrefix: 'double-dragon', name: 'Double Dragon Colouring' },
      dynamic: { idPrefix: 'dynamic-dragon', name: dynamicDragonLabel(best.moves) },
      'double-dynamic': { idPrefix: 'double-dynamic-dragon', name: `Double ${dynamicDragonLabel(best.moves)}` },
    }[best.kind]
    const instance: TechniqueInstance = {
      ...buildDragonInstance(board, candidates, idPrefix, name, best.chainKey, best.moves),
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

  /** Autocomplete Colours: finishes the 3D Medusa the user started painting.
   * The first two painted colours (paintedSwatches) are its two sides; their
   * paint is checked as a valid start (autocompleteMedusa), the rest of the
   * chain is painted in the same colours as one undoable step - the user's
   * own paint is never touched - and the finished chain goes through the
   * exact same Medusa rules 1-5 as a Techniques-list Medusa row
   * (buildMedusaChainInstance). */
  function onAutocompleteMedusa() {
    const say = (tone: 'error' | 'info', title: string, lines: string[] = []) =>
      setAutocompleteResult({ kind: 'message', source: 'medusa', tone, title, lines })
    if (paintedSwatches.length < 2) {
      return
    }
    const [first, second] = paintedSwatches
    const colorNames = { blue: first.label.toLowerCase(), yellow: second.label.toLowerCase() }
    const { seeds, problems } = medusaSeedsFromPaint(first, second)

    const outcome = autocompleteMedusa(medusaFinder, board, candidates, seeds, colorNames)
    if (outcome.kind === 'invalid') {
      problems.push(...outcome.problems)
    }
    if (problems.length > 0 || outcome.kind === 'invalid') {
      say('error', 'The current Medusa is invalid.', problems.slice(0, 5))
      setStatus('The current Medusa is invalid.')
      return
    }

    const nextColors = cloneCandidateColors(candidateColors)
    if (outcome.added.length > 0) {
      for (const node of outcome.added) {
        const swatch = node.color === 'blue' ? first : second
        const layer = { color: swatch.id, shape: swatchShapes[swatch.id] }
        // A candidate already painted some other (non-Medusa) colour keeps
        // it, as the first half of a multicolour pip.
        const existing = nextColors[node.row][node.col][node.digit - 1]
        nextColors[node.row][node.col][node.digit - 1] = existing ? [existing[0], layer] : [layer]
      }
      commitGrid({ board, givens, candidates, candidateColors: nextColors })
    }

    const total = outcome.chain.candidates.length
    const colouredText =
      outcome.added.length === 0
        ? `Your Medusa was already fully coloured (${total} candidates).`
        : `Coloured ${outcome.added.length} more candidate${outcome.added.length === 1 ? '' : 's'} (${total} in the whole Medusa).`
    const built = buildMedusaChainInstance(outcome.chain, board, candidates, colorNames)
    if (!built) {
      say('info', 'Continuing the current Medusa does not lead to any eliminations or placements.', [colouredText])
      setStatus('Continuing the current Medusa does not lead to any eliminations or placements.')
      return
    }

    setAutocompleteResult({
      kind: 'found',
      source: 'medusa',
      // No blue/yellow highlight: the chain is now painted in the user's own
      // colours, which show through wherever nothing else is highlighted.
      instance: { ...built.instance, blueCandidates: undefined, yellowCandidates: undefined },
      summary: colouredText,
      chainKeys: outcome.chain.candidates.map((c) => `${c.row},${c.col},${c.digit}`),
      boardBefore: board,
      candidatesBefore: candidates,
      coloursKey: JSON.stringify(sanitizeCandidateColors(nextColors, board, candidates)),
    })
    setStatus(`Autocompleted the Medusa: ${built.instance.name}.`)
  }

  /** Autocomplete Dragon (Plain) / Autocomplete Dynamic Dragon: carries on
   * the Dragon Colouring the user started painting - plain, or Dynamic with
   * exactly the options the solver's Dynamic Dragons use
   * (computeStuckDynamicDragonExtensions). The first two painted colours (Colour section
   * order) are the Medusa's two sides and the rest (one or two) their dragon
   * colours. With two dragon colours the first goes with the first Medusa
   * colour; with one, whose side it is isn't known up front - both readings
   * are tried (orange's own side first, as Dragon's default dragon colours
   * are dark blue for light blue and orange for yellow) and the one that
   * checks out is used, as is swapping two dragon colours that only check
   * out the other way round. The checking and carrying on is
   * autocompleteDragon; this maps the user's swatches onto Dragon's four
   * colours and back, in the text (renameDragonColours) and on the grid. */
  function onAutocompleteDragon(dynamic: boolean) {
    const source: AutocompleteSource = dynamic ? 'dynamic-dragon' : 'plain-dragon'
    const say = (tone: 'error' | 'info', title: string, lines: string[] = []) =>
      setAutocompleteResult({ kind: 'message', source, tone, title, lines })
    if (paintedSwatches.length < 3 || paintedSwatches.length > 4) {
      return
    }
    const checked = checkPaintedDragon(dynamic)
    const kindName = dynamic ? 'Dynamic Dragon' : 'Dragon'
    if (checked.kind === 'invalid') {
      say('error', checked.title, checked.lines)
      setStatus(checked.title)
      return
    }
    if (checked.kind === 'not-stuck') {
      say('info', "The current Medusa isn't stuck, so it can't start a Dragon.", [
        'Its own Medusa rules already lead to eliminations or placements - try Autocomplete Medusa instead.',
      ])
      setStatus("The current Medusa isn't stuck, so it can't start a Dragon.")
      return
    }
    if (checked.kind === 'no-result') {
      say('info', `Continuing the current ${kindName} does not lead to any eliminations or placements.`, [
        dynamic
          ? 'Your colouring is a valid Dynamic Dragon so far, but continuing it with the Dynamic Dragon techniques selected in Dragon Configuration leads to a dead end.'
          : 'Your colouring is a valid plain Dragon so far, but continuing the Dragon Colouring leads to a dead end.',
      ])
      setStatus(`Continuing the current ${kindName} does not lead to any eliminations or placements.`)
      return
    }

    const { outcome, moves, roleSwatch, rename, assignment, extra } = checked
    // Named like the Techniques list's rows: a Dynamic Dragon after the
    // techniques its Extension Rule 3 steps used, and one that never needed
    // Rule 3 is just a (plain) Dragon.
    const usesRule3 = moves.some(isDynamicDragonMove)
    const built = usesRule3
      ? buildDragonInstance(board, candidates, 'dynamic-dragon', dynamicDragonLabel(moves), outcome.chainKey, moves)
      : buildDragonInstance(board, candidates, 'dragon', 'Dragon Colouring', outcome.chainKey, moves)
    const rolePaint = Object.fromEntries(
      (Object.keys(roleSwatch) as DragonColor[]).map((color) => [
        color,
        { color: roleSwatch[color].id, shape: swatchShapes[roleSwatch[color].id] },
      ]),
    ) as Record<DragonColor, CandidatePaintLayer>

    // Paint the finished colouring onto the grid (one undoable step), the
    // way Autocomplete medusa does - only onto candidates the user hasn't
    // painted, so their own paint is never replaced.
    const final = foldDragonMoves(moves, moves.length - 1)
    const nextColors = cloneCandidateColors(candidateColors)
    let added = 0
    for (const [refs, color] of [
      [final.blueCandidates, 'blue'],
      [final.yellowCandidates, 'yellow'],
      [final.darkBlueCandidates, 'darkBlue'],
      [final.orangeCandidates, 'orange'],
    ] as const) {
      for (const ref of refs) {
        if (!nextColors[ref.row][ref.col][ref.digit - 1] && candidates[ref.row][ref.col][ref.digit - 1]) {
          nextColors[ref.row][ref.col][ref.digit - 1] = [rolePaint[color]]
          added++
        }
      }
    }
    if (added > 0) {
      commitGrid({ board, givens, candidates, candidateColors: nextColors })
    }

    const label = (color: DragonColor) => roleSwatch[color].label.toLowerCase()
    const colourNotes: string[] = []
    if (extra.length === 1) {
      const side = assignment.darkBlue ? 'blue' : 'yellow'
      colourNotes.push(`${label(side === 'blue' ? 'darkBlue' : 'orange')} is the dragon colour of the ${label(side)} side`)
    } else if (assignment.darkBlue !== extra[0]) {
      colourNotes.push(
        `your colouring only works with ${label('darkBlue')} as the dragon colour of the ${label('blue')} side and ${label('orange')} of the ${label('yellow')} side, so they're used that way round`,
      )
    }
    for (const color of ['darkBlue', 'orange'] as const) {
      if (!paintedSwatches.includes(roleSwatch[color]) && moves.some((m) => m.colored.some((n) => n.color === color))) {
        colourNotes.push(`${label(color)} is used for the ${label(color === 'darkBlue' ? 'blue' : 'yellow')} side's dragon colour`)
      }
    }
    if (dynamic && !usesRule3) {
      colourNotes.push('no Dynamic Dragon technique was needed - plain Dragon Colouring does it')
    }
    const autocompletedSteps = moves.length - outcome.checkedMoves
    const summary = [
      `Your colouring checks out (steps 1-${outcome.checkedMoves}); the Dragon continues from there in ${autocompletedSteps} more step${autocompletedSteps === 1 ? '' : 's'}.`,
      ...colourNotes.map((note) => capitalizeFirst(note) + '.'),
    ].join(' ')
    setAutocompleteResult({
      kind: 'found',
      source,
      instance: { ...built, notation: rename(built.notation) },
      summary,
      dragon: { checkedMoves: outcome.checkedMoves, rolePaint, dynamic },
      boardBefore: board,
      candidatesBefore: candidates,
      coloursKey: JSON.stringify(sanitizeCandidateColors(nextColors, board, candidates)),
    })
    // Open the step player where the user left off.
    setDragonStepIndex(outcome.checkedMoves - 1)
    setDragonSubstepIndex(null)
    setStatus(`Autocompleted the ${kindName}: ${moves.length} steps.`)
  }

  /** The checking half of Autocomplete Dragon, shared with the Hint popup:
   * maps the painted swatches onto Dragon's four colours (see
   * onAutocompleteDragon), checks the colouring and carries it on. Takes 2-4
   * painted colours (2: a Medusa with no dragon colours yet - only the hint
   * asks that). The `found` moves' text is already in the user's colours. */
  function checkPaintedDragon(dynamic: boolean): PaintedDragonCheck {
    const [medusaA, medusaB, ...extra] = paintedSwatches
    const assignments: Array<{ darkBlue?: MedusaColourSwatch; orange?: MedusaColourSwatch }> =
      extra.length === 0
        ? [{}]
        : extra.length === 2
        ? [
            { darkBlue: extra[0], orange: extra[1] },
            { darkBlue: extra[1], orange: extra[0] },
          ]
        : extra[0].id === 'rust'
          ? [{ orange: extra[0] }, { darkBlue: extra[0] }]
          : [{ darkBlue: extra[0] }, { orange: extra[0] }]
    // A Dragon colour the user hasn't used (one dragon colour painted) still
    // needs a swatch if the Dragon grows that side: Dragon's default for it
    // (dark blue / orange) when that isn't already taken, else the first
    // swatch not on the grid.
    const unusedSwatch = (preferred: CandidateColor) => {
      const used = new Set(paintedSwatches.map((swatch) => swatch.id))
      return (
        candidateColorSwatches.find((swatch) => swatch.id === preferred && !used.has(swatch.id)) ??
        candidateColorSwatches.find((swatch) => !used.has(swatch.id))!
      )
    }

    const problems: string[] = []
    const paintedCells: Array<{ row: number; col: number; digit: number; color: CandidateColor }> = []
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        for (let digit = 1; digit <= 9; digit++) {
          const paint = candidateColors[row][col][digit - 1]
          if (!paint) {
            continue
          }
          const colours = [...new Set(paint.map((layer) => layer.color))]
          if (colours.length > 1) {
            const labels = colours.map((id) => paintedSwatches.find((swatch) => swatch.id === id)!.label.toLowerCase())
            problems.push(
              `${formatCandidate({ row, col, digit })} is coloured both ${labels[0]} and ${labels[1]}, but a candidate can only have one Dragon colour.`,
            )
          } else {
            paintedCells.push({ row, col, digit, color: colours[0] })
          }
        }
      }
    }
    if (problems.length > 0) {
      return { kind: 'invalid', title: 'The current Dragon colours are invalid.', lines: problems.slice(0, 5) }
    }

    const extendOptions: DragonExtendOptions = dynamic
      ? {
          dynamic: true,
          allowedRule3Techniques: effectiveAllowedRule3Techniques,
          aicLimitPerStep: aicLimitPerDragonStep,
          maxTechniquesPerStep: maxTechniquesPerDragonStep,
          givens,
          exhaustive: exhaustiveDragonColouring,
          // As for the solver's Dynamic Dragons: Optimize Dynamic Dragons
          // implies the optimized search.
          optimize: optimizeDragons || optimizeDynamicDragons,
          optimizeDynamic: optimizeDynamicDragons,
        }
      : { exhaustive: exhaustiveDragonColouring, optimize: optimizeDragons }
    let firstFailure: { outcome: Extract<ReturnType<typeof autocompleteDragon>, { kind: 'invalid' }>; rename: (text: string) => string } | null = null
    for (const assignment of assignments) {
      const roleSwatch: Record<DragonColor, MedusaColourSwatch> = {
        blue: medusaA,
        yellow: medusaB,
        darkBlue: assignment.darkBlue ?? unusedSwatch('blue'),
        orange: assignment.orange ?? unusedSwatch('rust'),
      }
      const roleOf = new Map<CandidateColor, DragonColor>(
        (Object.keys(roleSwatch) as DragonColor[]).map((color) => [roleSwatch[color].id, color]),
      )
      const rename = (text: string) => renameDragonColours(text, roleSwatch)
      const painted: DragonNode[] = paintedCells.map((cell) => ({ ...cell, color: roleOf.get(cell.color)! }))
      const outcome = autocompleteDragon(board, candidates, painted, extendOptions)
      if (outcome.kind === 'invalid') {
        firstFailure ??= { outcome, rename }
        continue
      }
      if (outcome.kind === 'not-stuck' || outcome.kind === 'no-result') {
        return { kind: outcome.kind }
      }
      const moves = outcome.moves.map((move) => ({
        ...move,
        description: rename(move.description),
        substeps: move.substeps?.map((substep) => ({ ...substep, clause: rename(substep.clause) })),
      }))
      return { kind: 'found', outcome, moves, roleSwatch, rename, assignment, extra }
    }

    const failure = firstFailure!
    const title =
      failure.outcome.stage === 'medusa' ? 'The current Medusa colours are invalid.' : 'The current Dragon colours are invalid.'
    const lines = failure.outcome.problems.slice(0, 5).map(failure.rename)
    if (!dynamic && failure.outcome.stage === 'dragon' && !dynamicDragonDisabled) {
      lines.push('If you used Dynamic Dragon techniques, try Autocomplete Dynamic Dragon instead.')
    }
    return { kind: 'invalid', title, lines }
  }

  /** The candidates painted in the two Medusa colours `first` (blue side)
   * and `second` (yellow side), and any painted in both (a problem). */
  function medusaSeedsFromPaint(first: MedusaColourSwatch, second: MedusaColourSwatch) {
    const seeds: MedusaSeed[] = []
    const problems: string[] = []
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        for (let digit = 1; digit <= 9; digit++) {
          const paint = candidateColors[row][col][digit - 1]
          const hasFirst = paint?.some((layer) => layer.color === first.id) ?? false
          const hasSecond = paint?.some((layer) => layer.color === second.id) ?? false
          if (hasFirst && hasSecond) {
            problems.push(
              `${formatCandidate({ row, col, digit })} is coloured both ${first.label.toLowerCase()} and ${second.label.toLowerCase()}, but a candidate can only be on one side of a Medusa.`,
            )
          } else if (hasFirst || hasSecond) {
            seeds.push({ row, col, digit, color: hasFirst ? 'blue' : 'yellow' })
          }
        }
      }
    }
    return { seeds, problems }
  }

  /** The Hint popup's steps for the easiest technique on the grid (null when
   * none applies). A 3D Medusa or single (Dynamic) Dragon reads the user's
   * own paint the way Find by colours does - the first two painted colours
   * are the Medusa, any others its dragon colours - and says which
   * candidate to look at next; everything else gets fixed advice (hints.ts). */
  function computeHint(): TechniqueHint | null {
    const instance = pickEasiestInstance(techniqueInstances)
    if (!instance) {
      return null
    }
    const kind = colouringHintKind(instance)
    if (!kind) {
      return buildTechniqueHint(instance, board, candidates)
    }

    // The Medusa colours: the first two painted, else the first swatches
    // not painted yet (what the hint tells the user to paint with).
    const medusaSwatches = [
      ...paintedSwatches.slice(0, 2),
      ...candidateColorSwatches.filter((swatch) => !paintedSwatches.some((p) => p.id === swatch.id)),
    ].slice(0, 2)
    const [first, second] = medusaSwatches
    const { seeds, problems } = paintedSwatches.length > 0 ? medusaSeedsFromPaint(first, second) : { seeds: [], problems: [] }
    const colorNames = { blue: first.label.toLowerCase(), yellow: second.label.toLowerCase() }
    const say = (text: string, lines?: string[]): HintStep[] => [{ text, lines }]
    if (problems.length > 0) {
      return buildTechniqueHint(instance, board, candidates, say('Your Medusa colouring has a problem:', problems.slice(0, 5)))
    }

    if (kind === 'medusa') {
      const context: MedusaHintContext = {
        seeds,
        colorNames,
        targetChain: [...(instance.blueCandidates ?? []), ...(instance.yellowCandidates ?? [])],
        focusCells: instance.medusaHighlightCells,
      }
      return buildTechniqueHint(instance, board, candidates, medusaColouringSteps(board, candidates, context))
    }

    // A single plain or Dynamic Dragon: finish the Medusa first, then the
    // Dragon moves, one at a time.
    const moves = instance.moves ?? []
    const lastMove = moves[moves.length - 1]
    const context: MedusaHintContext = {
      seeds,
      colorNames,
      targetChain: moves[0]?.colored ?? [],
      focusCells: lastMove ? [...lastMove.eliminated, ...lastMove.solved].map((c) => [c.row, c.col] as const) : [],
    }
    const deadEnd = (why: string) => {
      const start = medusaStartCandidate(context.targetChain, context.focusCells)
      return say(
        `${why} The easiest ${kind === 'dynamic-dragon' ? 'Dynamic Dragon' : 'Dragon'} starts from the 3D Medusa that includes ${formatCandidate(start)} - clear your colours and start there.`,
      )
    }
    const medusaCheck = checkMedusaPaint(board, candidates, context, true)
    if (medusaCheck.kind === 'steps') {
      return buildTechniqueHint(instance, board, candidates, medusaCheck.steps)
    }
    if (!medusaCheck.stuck) {
      return buildTechniqueHint(
        instance,
        board,
        candidates,
        say(
          "Your Medusa is fully coloured, and its own rules already prove something - it's a 3D Medusa, not the start of a Dragon.",
          medusaCheck.builtNotation ? [medusaCheck.builtNotation] : undefined,
        ),
      )
    }
    if (paintedSwatches.length > 4) {
      return buildTechniqueHint(
        instance,
        board,
        candidates,
        say(
          `There are ${paintedSwatches.length} colours on the grid - a Dragon can only have 3 or 4 (two Medusa colours and one or two dragon colours).`,
        ),
      )
    }
    const checked = checkPaintedDragon(kind === 'dynamic-dragon')
    const steps: HintStep[] =
      checked.kind === 'invalid'
        ? say(checked.title, checked.lines)
        : checked.kind === 'not-stuck'
          ? deadEnd("Your Medusa isn't stuck, so it can't start a Dragon.")
          : checked.kind === 'no-result'
            ? deadEnd('Your colouring is valid, but continuing it leads to a dead end.')
            : (() => {
                const next = checked.moves[checked.outcome.checkedMoves]
                const colourSteps = next ? dragonMoveSteps(next, (text) => text) : []
                // A dragon colour the user hasn't painted yet: say which
                // swatch the hint's text means by it.
                for (const color of ['darkBlue', 'orange'] as const) {
                  const swatch = checked.roleSwatch[color]
                  if (next?.colored.some((n) => n.color === color) && !paintedSwatches.includes(swatch)) {
                    colourSteps[colourSteps.length - 1].text += ` Use ${swatch.label.toLowerCase()} as the ${checked.roleSwatch[color === 'darkBlue' ? 'blue' : 'yellow'].label.toLowerCase()} side's dragon colour.`
                  }
                }
                return colourSteps
              })()
    return buildTechniqueHint(instance, board, candidates, steps)
  }

  /** The Hint button: works the hint out (under the busy indicator - a
   * Dynamic Dragon hint re-runs Autocomplete Dynamic Dragon) and opens the
   * popup. Reopened for the same technique it keeps what was revealed, up
   * to the first hint that has changed since (the user has coloured the
   * candidate it pointed at, say), so the new one is the latest shown. */
  function onOpenHint() {
    if (ocrProofreadVisible) {
      return
    }
    runBusyTask('hint', { title: 'Working out a hint…', detail: 'Finding the easiest technique on the grid.' }, () => {
      const hint = computeHint()
      if (!hint) {
        setHintView({ hint: null, revealed: 1 })
        return
      }
      const last = lastHintRef.current
      let revealed = 1
      if (last && last.hint.instanceId === hint.instanceId) {
        const firstChanged = hint.steps.findIndex((step, i) => last.hint.steps[i]?.text !== step.text)
        revealed = Math.min(last.revealed, firstChanged === -1 ? hint.steps.length : firstChanged + 1)
      }
      lastHintRef.current = { hint, revealed }
      setHintView({ hint, revealed })
    })
  }

  function onNextHint() {
    setHintView((current) => {
      if (!current?.hint) {
        return current
      }
      const next = { hint: current.hint, revealed: Math.min(current.revealed + 1, current.hint.steps.length) }
      lastHintRef.current = next
      return next
    })
  }

  /** Autocomplete Dynamic Dragon can run many Extension Rule 3 simulations
   * (every AIC kind ticked, say) - under the busy indicator, like Find by
   * elims, so the page shows it's working. */
  function runAutocompleteDragon(dynamic: boolean) {
    runBusyTask(
      'autocomplete',
      {
        title: dynamic ? 'Autocompleting the Dynamic Dragon…' : 'Autocompleting the Dragon…',
        detail: 'Checking your colouring and carrying the Dragon on from it.',
      },
      () => onAutocompleteDragon(dynamic),
    )
  }

  /** Commits the Autocomplete tab's Medusa conclusion, like the Find tab's
   * Apply, and clears the result - the grid it was worked out on is gone. */
  function onApplyAutocompletedMedusa() {
    if (!autocompleteInstance) {
      return
    }
    const next = applyTechniqueEffect(board, candidates, fullTechniqueEffect(autocompleteInstance))
    commitGrid({ board: next.board, givens, candidates: next.candidates })
    setAutocompleteResult(null)
    setStatus(`Applied ${autocompleteInstance.name}.`)
  }

  function onApplyPanelSelection() {
    if (techniquePanelTab === 'solve-path') {
      onApplySolvePathStep()
    } else if (techniquePanelTab === 'find') {
      onApplyFoundTechnique()
    } else if (techniquePanelTab === 'autocomplete') {
      onApplyAutocompletedMedusa()
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
          const nextSolvePath = await solvePathInWorker(board, candidates, givens, solvePathOptions, controller.signal)
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

  function onSetSwatchShape(id: CandidateColor, shape: CandidatePaintShape) {
    setSwatchShapes((current) => ({ ...current, [id]: shape }))
  }

  /** Un-paints every manually coloured candidate on the board - the
   * swatch colours themselves (and which one is selected) are untouched. */
  function onClearAllCandidateColors() {
    commitGrid({ board, givens, candidates, candidateColors: createEmptyCandidateColors() })
  }

  /** Un-paints every candidate in the selected cell only. */
  function onClearCellCandidateColors() {
    if (!selected) {
      return
    }
    const nextColors = cloneCandidateColors(candidateColors)
    nextColors[selected.row][selected.col] = nextColors[selected.row][selected.col].map(() => null)
    commitGrid({ board, givens, candidates, candidateColors: nextColors })
  }

  /** Paints one candidate with the selected colour - or un-paints it, or
   * splits it into two colours; see nextCandidatePaint. A manual annotation
   * only, never touched by any solving technique or auto-solve. Only
   * meaningful with a paint colour selected and an actual candidate under
   * the click. */
  function onCandidatePipClick(row: number, col: number, digit: number) {
    if (!paintColor || !candidates[row][col][digit - 1]) {
      return
    }
    const nextColors = cloneCandidateColors(candidateColors)
    nextColors[row][col][digit - 1] = nextCandidatePaint(nextColors[row][col][digit - 1], {
      color: paintColor,
      shape: swatchShapes[paintColor],
    })
    commitGrid({ board, givens, candidates, candidateColors: nextColors })
    trackEvent('board', 'Candidate painted')
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
    if (await importPuzzleText(importText)) {
      setImportText('')
    }
  }

  /** Imports a puzzle string (any format PuzzleImporter reads); shared by the
   * import box and the paste shortcut. False (with the reason in the status
   * line) when the text isn't a puzzle. */
  async function importPuzzleText(text: string): Promise<boolean> {
    const result = await importer.import(text)
    if (!result.ok) {
      setStatus(result.error)
      return false
    }
    // Past an await - see latestRef.
    // A new puzzle starts unpainted unless its string carries paint (a Copy
    // Puzzle As-Is string does) - never the old puzzle's paint.
    latestRef.current.commitGrid({
      board: result.board,
      givens: result.givens,
      candidates: result.candidates,
      candidateColors: result.candidateColors ?? createEmptyCandidateColors(),
    })
    setOcrProofread(null)
    reportImport(result.board, { importType: 'string', sourceFormat: importer.detectFormat(text) })
    setHighlightedDigit(null)
    setStatus('Puzzle imported. Click Solve to check it.')
    return true
  }

  /** The paste shortcut: a puzzle string if the clipboard text is one, else
   * a screenshot read by OCR, like a dropped one. Text is tried first because
   * copying from some apps puts a rendered image on the clipboard next to the
   * text; an image with no usable text beside it goes to OCR. */
  async function importFromClipboard(text: string, image: Blob | null) {
    const trimmed = text.trim()
    if (trimmed && (await importPuzzleText(trimmed))) {
      return
    }
    if (image) {
      onImportImage(image)
    } else if (!trimmed) {
      setStatus('Nothing to paste - copy a puzzle string or a screenshot of a grid first.')
    }
  }

  /** The paste shortcut when it isn't the browser's own Ctrl+V, so there is
   * no paste event: ask the async Clipboard API (may prompt for permission). */
  async function pasteFromClipboardApi() {
    try {
      if (navigator.clipboard.read) {
        let text = ''
        let image: Blob | null = null
        for (const item of await navigator.clipboard.read()) {
          const imageType = item.types.find((type) => type.startsWith('image/'))
          if (imageType && !image) {
            image = await item.getType(imageType)
          }
          if (item.types.includes('text/plain') && !text) {
            text = await (await item.getType('text/plain')).text()
          }
        }
        await importFromClipboard(text, image)
      } else {
        await importFromClipboard(await navigator.clipboard.readText(), null)
      }
    } catch {
      setStatus("Couldn't read the clipboard - allow clipboard access, or paste into the import box instead.")
    }
  }

  /** The browser's paste event, when the paste shortcut is Ctrl+V itself
   * (the event carries the clipboard with no permission prompt). Only
   * within the shortcut areas; the import box and the screenshot drop zone
   * handle their own pastes. */
  function onScopedPaste(event: ClipboardEvent<HTMLElement>) {
    if (
      busy ||
      !isNativePasteHotkey(hotkeys.paste) ||
      !isInHotkeyScope(event.target) ||
      isTypingTarget(event.target)
    ) {
      return
    }
    event.preventDefault()
    const image =
      Array.from(event.clipboardData.items)
        .find((item) => item.type.startsWith('image/'))
        ?.getAsFile() ?? null
    void importFromClipboard(event.clipboardData.getData('text/plain'), image)
  }

  function showToast(message: string) {
    setToastMessage(message)
    window.setTimeout(() => setToastMessage((current) => (current === message ? null : current)), 2200)
  }

  /** "Copy Puzzle As-Is": the current progress as a Sudoku.Coach state
   * string - givens, solved cells and candidates, which Sudoku.Coach reads,
   * plus the candidate paint (by palette position), which only this app
   * reads back. Pastes into either. Also the "Copy puzzle as-is" shortcut. */
  async function onCopyPuzzleAsIs() {
    let exported: string
    try {
      exported = await importer.exportToSudokuCoachState(board, givens, candidates, candidateColors)
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

  /** "Copy Original": the puzzle as a plain 81-character string (row by row,
   * 0 = empty) - its givens, or every filled cell when the grid has no
   * givens (typed in by hand), since then the digits on it are the puzzle. */
  async function onCopyOriginal() {
    const hasGivens = givens.some((row) => row.some(Boolean))
    const puzzle = board
      .flatMap((row, r) => row.map((value, c) => (value !== 0 && (!hasGivens || givens[r][c]) ? String(value) : '0')))
      .join('')
    try {
      await navigator.clipboard.writeText(puzzle)
      showToast('Copied to clipboard!')
    } catch {
      setStatus("Couldn't access the clipboard - here's the puzzle string to copy manually:")
      setImportText(puzzle)
    }
  }

  /** Reads a screenshot of a Sudoku grid (dropped or pasted) and rebuilds
   * the board from it, colour and any overlaid lines/arrows ignored -
   * only which pixels are darker than their own cell's background is
   * ever asked. A screenshot has no reliable way to tell an original given
   * apart from a cell already solved, so every digit it shows is to become
   * a given - but OCR can misread, so they load editable first, with the
   * proofread banner (ocrProofread) to check them against the screenshot
   * and then lock them. */
  function onImportImage(file: Blob) {
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
          const historyIndex = latestRef.current.commitGrid({
            board: result.board,
            givens: result.board.map((row) => row.map(() => false)),
            candidates: result.candidates,
          })
          setOcrProofread({ historyIndex, imageUrl: URL.createObjectURL(file) })
          setOcrProofreadShowImage(false)
          reportImport(result.board, { importType: 'ocr' })
          setHighlightedDigit(null)
          const parts = [`read ${solvedCount} digit${solvedCount === 1 ? '' : 's'}`]
          if (unrecognizedCount > 0) {
            parts.push(`couldn't read ${unrecognizedCount} digit${unrecognizedCount === 1 ? '' : 's'}`)
          }
          setStatus(`Screenshot imported: ${parts.join(', ')}. Check the digits, then lock them as givens.`)
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

  /** The last key a shortcut handled, so its keyup is swallowed too - a
   * focused pad button would otherwise still be "clicked" by Space's keyup
   * in some browsers even though its keydown was prevented. */
  const handledHotkeyKeyRef = useRef<string | null>(null)

  /** Runs a keyboard shortcut (Settings -> Keyboard shortcuts); true if the
   * key press was one. Only called for keys pressed inside the grid or one
   * of the four pads (isInHotkeyScope). */
  function runHotkey(event: KeyboardEvent<HTMLElement>): boolean {
    const match = matchHotkey(event, hotkeys)
    if (!match) {
      return false
    }
    if (match.action === 'paste' && isNativePasteHotkey(hotkeys.paste)) {
      // Leave Ctrl+V to the browser: its paste event (onScopedPaste) carries
      // the clipboard without asking for permission.
      return true
    }
    event.preventDefault()
    handledHotkeyKeyRef.current = keyNameOf(event)
    switch (match.action) {
      case 'toggleInputMode':
        toggleKeyboardMode()
        break
      case 'candidateDigit':
        if (selected && match.digit) {
          toggleCandidate(selected.row, selected.col, match.digit)
        }
        break
      case 'deselect':
        setSelected(null)
        break
      case 'undo':
        if (!busy) {
          undo()
        }
        break
      case 'redo':
        if (!busy) {
          redo()
        }
        break
      case 'copyGrid':
        void onCopyPuzzleAsIs()
        break
      case 'paste':
        if (!busy) {
          void pasteFromClipboardApi()
        }
        break
    }
    return true
  }

  function onKeyUp(event: KeyboardEvent<HTMLElement>) {
    if (handledHotkeyKeyRef.current !== null && handledHotkeyKeyRef.current === keyNameOf(event)) {
      handledHotkeyKeyRef.current = null
      event.preventDefault()
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (isTypingTarget(event.target)) {
      // Let the import box handle its own typing instead of routing digits
      // and arrow keys to the grid.
      return
    }
    if (isInHotkeyScope(event.target) && runHotkey(event)) {
      return
    }
    if (!selected || event.ctrlKey || event.metaKey || event.altKey) {
      // A modified digit is a shortcut (or the browser's own), never entry.
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

  /** The proofread banner's "Lock as givens": every digit now on the grid
   * (the screenshot's, as corrected) becomes a given, as one undoable step. */
  function onLockOcrDigits() {
    commitGrid({ board, givens: board.map((row) => row.map((value) => value !== 0)), candidates })
    setOcrProofread(null)
    setStatus('Digits locked as givens.')
  }

  function onClear() {
    const empty = createEmptyBoard()
    commitGrid({ board: empty, givens: computeGivenMask(empty), candidates: createEmptyCandidates() })
    setOcrProofread(null)
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
      `New ${techniqueName} puzzle loaded: Find the ${techniqueName} to progress the puzzle.`,
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
      'New Dragon Colouring puzzle loaded: find a Dragon to progress the puzzle.',
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
      // Only meaningful (and only settable) with "must not allow plain Dragon".
      forbidDoubleDragon: dynamicDragonPuzzleForbidsPlainDragon && dynamicDragonPuzzleForbidsDoubleDragon,
    }
    runPracticePuzzleGeneration(
      'Generating a puzzle that needs Dynamic Dragon Colouring…',
      // "Must not allow plain Dragon" positions are too rare to find live
      // (minutes each), so they come from the pre-generated stock instead.
      // Either way Dynamic Dragon only uses the default techniques (the
      // generator, and so the stock, never uses any other), which is why
      // "Dynamic Dragon only uses defaults" doesn't change this button.
      (signal) =>
        dynamicDragonPuzzleForbidsPlainDragon
          ? pickStockDynamicDragonPuzzle(options)
          : generateDragonPuzzleInParallel(options, signal),
      dynamicDragonPuzzleForbidsPlainDragon
        ? 'New Dynamic Dragon puzzle loaded: Easiest technique to progress is Dynamic Dragon Colouring.'
        : 'New Dynamic Dragon puzzle loaded:  The grid contains at least one Dynamic Dragon Colouring technique.',
      dynamicDragonPuzzleForbidsPlainDragon,
    )
  }

  /** Double Dragon positions (plain Dragon stuck on every chain) are far too
   * rare to find live, so like the "must not allow plain Dragon" Dynamic
   * puzzles they come from a pre-generated stock (pickStockDoubleDragonPuzzle),
   * re-checked under the current generation settings. */
  function onNewDoubleDragonPuzzle() {
    runPracticePuzzleGeneration(
      'Picking a puzzle that needs Double Dragon Colouring…',
      () =>
        pickStockDoubleDragonPuzzle({
          disregardSingleDigitAic: dragonGenerationDisregardsSingleDigitAic,
          disregardAic: dragonGenerationDisregardsAic,
          disregardGenericAic: dragonGenerationDisregardsGenericAic,
          enabledFish: [...enabledFish],
          alsXzEnabled,
        }),
      'New Double Dragon puzzle loaded: A Double Plain Dragon is the easiest technique to progress.',
      true,
    )
  }

  /** Double Dynamic Dragon positions were found offline (the famous hardest
   * puzzles plus a correct extra clue or two - see
   * doubleDynamicDragonPuzzleStockData.ts) and are served from that stock. */
  function onNewDoubleDynamicDragonPuzzle() {
    runPracticePuzzleGeneration(
      'Picking a puzzle that needs Double Dynamic Dragon Colouring…',
      () =>
        dynamicDragonPuzzleUsesDefaultsOnly
          ? pickStockDefaultsDoubleDynamicDragonPuzzle()
          : pickStockDoubleDynamicDragonPuzzle(),
      dynamicDragonPuzzleUsesDefaultsOnly
        ? 'New Double Dynamic Dragon puzzle loaded: nothing else can progress here except for Double Dynamic Dragon Colouring, with Dynamic Dragon using only the default techniques (at most 3 per step).'
        : 'New Double Dynamic Dragon puzzle loaded: nothing else can progress here except for Double Dynamic Dragon Colouring with every Dynamic Dragon technique and no AIC or technique limits.',
      true,
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
        Advanced Sudoku solver and trainer emphasizing Colouring techniques, such as Dragon Colouring. <br/> <div></div> <br/>
        For beginners or Colouring enthusiasts, use the default settings and click{' '}
        <button type="button" className="header-link" onClick={() => setTutorialTarget({ tab: 'basics' })}>
          Learn techniques
        </button>{' '}
        for a quick overview.  <br/>
        For advanced Colourists and solvers, learn how to configure your { ' '}
        <button type="button" className="header-link" onClick={() => setHelpOpen({tab: "Dragon Configuration"})}>
           Dragon settings
        </button>{' '} and enable your preferred { ' '}
        <button type="button" className="header-link" onClick={() => setHelpOpen({tab: "Technique Selections"})}>
           techniques
        </button>{' '}
      </p>
    </header>
  )

  const toolbar = (
    <div className="main-toolbar">
      <div className="toolbar-group">
        {/* Icons on a phone, so the one-row toolbar still fits the 💡 Hint.
            Desktop: Undo and Redo are one joined pair (.toolbar-segment). */}
        <div className="toolbar-segment">
        <button
          type="button"
          className="undo-trigger"
          onClick={undo}
          disabled={busy || !canUndo}
          aria-label={phone ? 'Undo' : undefined}
          title={phone ? 'Undo' : undefined}
        >
          <UndoRedoIcon direction="undo" />
          {!phone && <span>Undo</span>}
        </button>
        <button
          type="button"
          className="redo-trigger"
          onClick={redo}
          disabled={busy || !canRedo}
          aria-label={phone ? 'Redo' : undefined}
          title={phone ? 'Redo' : undefined}
        >
          <UndoRedoIcon direction="redo" />
          {!phone && <span>Redo</span>}
        </button>
        </div>
        {/* On a phone, Clear grid / Learn techniques / ? move into the
            "⋯" menu at the end so the toolbar stays one row - every row
            above the grid comes out of the dock's height. */}
        {!phone && (
          <button type="button" className="clear-grid-trigger" onClick={onClear} disabled={busy}>
            Clear grid
          </button>
        )}
      </div>

      {/* Touch layout: Hint lives here, in the middle of the toolbar, rather
          than in the Techniques tab's header - it is wanted most while
          playing on the Digits tab, and the dock header has no room for it.
          The desktop keeps it beside Apply. */}
      {compact && (
        <button
          type="button"
          className="technique-hint-button toolbar-hint-button"
          onClick={onOpenHint}
          disabled={ocrProofreadVisible}
          aria-label="Hint"
          title="Get a hint about the easiest technique on the grid, one step at a time."
        >
          <span aria-hidden="true">💡</span>
          {!phone && ' Hint'}
        </button>
      )}

      <div className="toolbar-group toolbar-group-end">
        {!phone && (
          <div className="toolbar-segment">
            <button
              type="button"
              className="how-it-works-trigger"
              title="Learn the colouring techniques, step by step"
              onClick={() => setTutorialTarget({ tab: 'basics' })}
            >
              Learn techniques
            </button>
            <button
              type="button"
              className="help-button"
              aria-label="Open the settings guide"
              aria-haspopup="dialog"
              title="What do the settings do?"
              onClick={() => setHelpOpen({})}
            >
              Quickstart
            </button>
          </div>
        )}
        <DropdownMenu
          trackingName="Generate Puzzle"
          label={
            phone ? (
              // An icon like the 🐉 / ⚙ menus beside it, so the row still fits
              // a 320px screen with the 💡 Hint button added to it.
              generating ? (
                '⏳'
              ) : (
                '🧩'
              )
            ) : (
            <>
              {generating ? (
                'Generating…'
              ) : (
                <>
                  {'Generate Puzzle'}
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
            )
          }
          ariaLabel={phone ? (generating ? 'Generating puzzle' : 'Generate Puzzle') : undefined}
          buttonClassName="generate-puzzle-trigger"
        >
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">
              Generate Practice Puzzle
              <MenuHelpButton topic="Generate Practice Puzzle" onClick={() => setHelpOpen({ tab: 'Generate Puzzle' })} />
            </h3>
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
              Simple Colouring puzzle
            </button>
            <button
              type="button"
              className="dropdown-item"
              onClick={() => onNewColouringPuzzle('medusa')}
              disabled={busy}
              title="Generates a puzzle state where 3D Medusa is the easiest technique that can make progress (AICs are not considered)"
            >
              3D Medusa puzzle
            </button>
            <button
              type="button"
              className="dropdown-item"
              onClick={onNewDragonPuzzle}
              disabled={busy}
              title="Generates a puzzle state where the next move requires Dragon Colouring"
            >
              Dragon Colouring puzzle
            </button>
                      <button
              type="button"
              className="dropdown-item"
              onClick={onNewDoubleDragonPuzzle}
              disabled={busy || !doubleDragonEnabled}
              title={
                doubleDragonEnabled
                  ? 'Picks a puzzle state where plain Dragon Colouring is stuck on every chain, but Double Dragon Colouring can progress (a Dynamic Dragon may too)'
                  : 'Turn on Double Dragon Colouring in Dragon Configuration first'
              }
            >
              Double Dragon Colouring puzzle
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
              Dynamic Dragon Colouring puzzle
            </button>

            <button
              type="button"
              className="dropdown-item"
              onClick={onNewDoubleDynamicDragonPuzzle}
              disabled={busy || !doubleDynamicDragonEnabled || doubleDynamicDragonUnavailableReason !== null}
              title={
                doubleDynamicDragonUnavailableReason !== null
                  ? doubleDynamicDragonUnavailableReason
                  : doubleDynamicDragonEnabled
                    ? 'Picks a puzzle state that nothing else can progress - not even Dynamic Dragon or Double Dragon with every technique enabled and no limits - but Double Dynamic Dragon Colouring (with no AIC or technique limits) can'
                    : 'Turn on Double Dynamic Dragon Colouring in Dragon Configuration first'
              }
            >
              Double Dynamic Dragon Colouring puzzle
            </button>
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">Dragon generation Settings</h3>
            <label
              className="menu-checkbox"
              title={
                shortSingleDigitAicEnabled
                  ? 'When on, a generated Dragon or Dynamic Dragon puzzle state may also have a Short Single-Digit AIC available. When off, generation rejects any state where one exists.'
                  : 'Always on while Short Single-Digit AIC is disabled - enable it in Technique Selections to turn this off.'
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
                  ? 'Always on while Short AIC is disabled - enable it in Technique Selections to turn this off.'
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
              Dragon disregards AIC
            </label>
            <label
              className="menu-checkbox"
              title={
                !genericAicEnabled
                  ? 'Always on while Generic AIC is disabled - enable it in Technique Selections to turn this off.'
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
              Dragon disregards Generic AIC
            </label>
                        <label
              className="menu-checkbox"
              title="When on, a Double Dynamic Dragon puzzle is picked from a stock where Dynamic Dragon needs only its default techniques (at most 3 per step), whatever other techniques are enabled. Dynamic Dragon puzzles always use only the default techniques, so they don't change."
            >
              <input
                type="checkbox"
                checked={dynamicDragonPuzzleUsesDefaultsOnly}
                onChange={() => setDynamicDragonPuzzleUsesDefaultsOnly((value) => !value)}
              />
              Dynamic Dragon puzzles only use default techniques
            </label>
            <label
              className="menu-checkbox"
              title="When on, a Dynamic Dragon puzzle is a state where plain Dragon Colouring is stuck on every chain, so Dynamic Dragon is the only way forward. These are too rare to generate live, so one is picked instantly from a built-in stock instead. When off, plain Dragon may still work on some other chain."
            >
              <input
                type="checkbox"
                checked={dynamicDragonPuzzleForbidsPlainDragon}
                onChange={() => {
                  // "must not allow double Dragons" only means anything on top of this.
                  if (dynamicDragonPuzzleForbidsPlainDragon) {
                    setDynamicDragonPuzzleForbidsDoubleDragon(false)
                  }
                  setDynamicDragonPuzzleForbidsPlainDragon((value) => !value)
                }}
              />
              Dynamic Dragon puzzles must not allow plain Dragon
            </label>
            <label
              className="menu-checkbox"
              title={
                dynamicDragonPuzzleForbidsPlainDragon
                  ? 'When on, a Dynamic Dragon puzzle is also never one that Double Dragon Colouring can progress, so Dynamic Dragon is the only way forward. When off, a Double Dragon may also progress it.'
                  : 'Can only be turned on while "Dynamic Dragon puzzles must not allow plain Dragon" is on.'
              }
            >
              <input
                type="checkbox"
                checked={dynamicDragonPuzzleForbidsDoubleDragon}
                disabled={!dynamicDragonPuzzleForbidsPlainDragon}
                onChange={() => setDynamicDragonPuzzleForbidsDoubleDragon((value) => !value)}
              />
              Dynamic Dragon puzzles must not allow Double plain Dragons
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

        {/* The three settings menus, joined into one group on the desktop. */}
        <div className="toolbar-segment">
        <DropdownMenu
          trackingName="Dragon Configuration"
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
            <h3 className="dropdown-section-title">
              Dragon Colouring
              <MenuHelpButton topic="Dragon Colouring" onClick={() => setHelpOpen({ tab: 'Dragon Configuration' })} />
            </h3>
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
            <h3 className="dropdown-section-title">Double Dragon Colouring</h3>
            <label
              className="menu-checkbox"
              title="When on, the solver also looks for Double Dragons. Follows Exhaustive and Optimize Dragons. Ranked between Dragon and Dynamic Dragon. Also enables the Double Dragon practice puzzle."
            >
              <input type="checkbox" checked={doubleDragonEnabled} onChange={toggleDoubleDragonEnabled} />
              Enable Double Dragons
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
                dynamicDragonDisabled ? 'Dynamic Dragons are disabled, so this has no effect' : 'When on, if AIC is enabled, a single Dynamic Dragon Colouring step may rely on at most one AIC (an AIC that leads nowhere does not count - the next one is tried instead); when off, there is no limit.'
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
              className="menu-select"
              title={
                dynamicDragonDisabled
                  ? 'Dynamic Dragons are disabled, so this has no effect'
                  : 'The most technique applications (of any kind) a single Dynamic Dragon Colouring step may chain to find its new colour. Naked and hidden singles do not count.'
              }
            >
              Max techniques per step
              <select
                value={maxTechniquesPerDragonStep}
                disabled={dynamicDragonDisabled}
                onChange={(event) => setMaxTechniquesPerDragonStep(Number(event.target.value))}
              >
                {MAX_TECHNIQUES_PER_DRAGON_STEP_OPTIONS.map((max) => (
                  <option key={max} value={max}>
                    {max === Infinity ? 'Infinite' : max}
                  </option>
                ))}
              </select>
            </label>
          <div className="dropdown-divider" />

             <h3 className="dropdown-section-title">Double Dynamic Dragon Colouring</h3>
           <label
              className="menu-checkbox"
              title={
                doubleDynamicDragonUnavailableReason ??
                  'When on, the solver also looks for Double Dynamic Dragon Colouring: two linked Dragons, like Double Dragon Colouring, where at least one of them is Dynamic. Only chains single Dynamic Dragon is stuck on are used. Follows the Dynamic Dragon settings (techniques, AIC limit, max techniques per step), Exhaustive Dragon Colouring and Optimize Dynamic Dragons. Also enables the Double Dynamic Dragon practice puzzle.'
              }
            >
              <input
                type="checkbox"
                checked={doubleDynamicDragonEnabled}
                disabled={doubleDynamicDragonUnavailableReason !== null}
                onChange={() => setDoubleDynamicDragonEnabled((value) => !value)}
              />
              Enable Double Dynamic Dragons
            </label>
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">Select Dynamic Dragon Colouring techniques</h3>
            <p className="dropdown-hint">
              Determines the non-colouring techniques Dynamic Dragon Colouring may use to find extensions.
            </p>
            <label
              className="menu-checkbox"
              title="When on, Dynamic Dragon Colouring is not used anywhere - the Techniques list, Solve Path, the Solvable check, Find by elims, auto-solve and puzzle generation - so plain Dragon Colouring becomes the strongest technique."
            >
              <input
                type="checkbox"
                checked={dynamicDragonDisabled}
                onChange={toggleDynamicDragonDisabled}
              />
              Disable Dynamic Dragons
            </label>
            {/* Hidden Single isn't listed: it's part of plain Dragon Colouring
                too, so it isn't a Dynamic Dragon choice (always on, see extend()). */}
            {RULE3_TECHNIQUE_GROUPS.map((group) => {
              const shown = !collapsedRule3Groups.has(group.title)
              return (
                <div key={group.title} className="rule3-technique-group">
                  <div className="menu-section-toggle-row">
                    <button
                      type="button"
                      className="menu-section-toggle"
                      aria-expanded={shown}
                      onClick={() => toggleRule3Group(group.title)}
                    >
                      <h4 className="dropdown-section-title">{group.title}</h4>
                      <span className="menu-section-chevron" aria-hidden="true">
                        {shown ? '▾' : '▸'}
                      </span>
                    </button>
                  </div>
                  {/* Below the title, not beside it: the panel is too narrow
                      for both on one line (the text wrapped two words a line). */}
                  {group.warning && (
                    <p className={`menu-section-warning menu-section-warning-${group.warningLevel ?? 'caution'}`}>
                      <span className="menu-section-warning-icon" aria-hidden="true">
                        {group.warningLevel === 'danger' ? '⚠' : '!'}
                      </span>
                      {group.warning}
                    </p>
                  )}
                  {shown && group.techniques.map((technique) => {
              const disabledByMasterSwitch =
                ((ALL_FISH_TECHNIQUES as readonly Rule3Technique[]).includes(technique) &&
                  !enabledFish.has(technique as FishTechnique)) ||
                (technique === 'short aic' && !shortAicEnabled) ||
                (technique === 'generic aic' && !genericAicEnabled) ||
                (technique === 'extended ur' && !extendedUrEnabled) ||
                (technique === 'grouped aic' && !groupedAicEnabled) ||
                (technique === 'als-xz' && !alsXzEnabled) ||
                (technique === 'ur-aic' && !urAicEnabled) ||
                (technique === 'als-aic' && !alsAicEnabled) ||
                (technique === 'short single-digit aic' && !shortSingleDigitAicEnabled)
              return (
                <label
                  key={technique}
                  className="menu-checkbox"
                  title={
                    dynamicDragonDisabled
                      ? 'Dynamic Dragons are disabled, so this has no effect'
                      : disabledByMasterSwitch
                        ? `${RULE3_TECHNIQUE_LABELS[technique]} is turned off in Technique Selections, so this has no effect`
                        : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={allowedRule3Techniques.has(technique)}
                    disabled={
                      technique === 'naked pair' ||
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
              )
            })}
          </div>
        </DropdownMenu>

        <DropdownMenu
          trackingName="Technique Selections"
          label={
            phone ? (
              <MedusaIcon />
            ) : (
              <>
                <MedusaIcon /> Technique Selections <span className="dropdown-caret">▾</span>
              </>
            )
          }
          ariaLabel={phone ? 'Technique Selections' : undefined}
          buttonClassName="technique-selections-trigger"
          align="right"
        >
          <div className="dropdown-section">
            <div className="menu-section-toggle-row">
              <button
                type="button"
                className="menu-section-toggle"
                aria-expanded={basicTechniquesShown}
                onClick={() => setBasicTechniquesShown((value) => !value)}
              >
                <h3 className="dropdown-section-title">Basic Techniques</h3>
                <span className="menu-section-chevron" aria-hidden="true">
                  {basicTechniquesShown ? '▾' : '▸'}
                </span>
              </button>
              <MenuHelpButton topic="Basic Techniques" onClick={() => setHelpOpen({ tab: 'Technique Selections' })} />
            </div>
            {basicTechniquesShown &&
              [
                'Naked Singles',
                'Hidden Singles',
                'Naked Pairs',
                'Locked Candidates',
                'Naked Triples',
                'Naked Quads',
                'Hidden Pairs',
              ].map((name) => (
                <label key={name} className="menu-checkbox" title={`${name} are always used by the solver.`}>
                  <input type="checkbox" checked disabled readOnly />
                  {name}
                </label>
              ))}
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <div className="menu-section-toggle-row">
              <button
                type="button"
                className="menu-section-toggle"
                aria-expanded={colouringTechniquesShown}
                onClick={() => setColouringTechniquesShown((value) => !value)}
              >
                <h3 className="dropdown-section-title">Colouring Techniques</h3>
                <span className="menu-section-chevron" aria-hidden="true">
                  {colouringTechniquesShown ? '▾' : '▸'}
                </span>
              </button>
              <MenuHelpButton topic="Colouring Techniques" onClick={() => setHelpOpen({ tab: 'Technique Selections' })} />
            </div>
            {colouringTechniquesShown && (
              <>
                {['Simple Colouring', '3D Medusa', 'Dragon Colouring'].map((name) => (
                  <label key={name} className="menu-checkbox" title={`${name} is always used by the solver.`}>
                    <input type="checkbox" checked disabled readOnly />
                    {name}
                  </label>
                ))}
                {/* The same settings as the Dragon Configuration menu's own toggles. */}
                <label
                  className="menu-checkbox"
                  title="When on, the solver also looks for Double Dragons. Same setting as Dragon Configuration -> Double Dragon Colouring."
                >
                  <input type="checkbox" checked={doubleDragonEnabled} onChange={toggleDoubleDragonEnabled} />
                  Double Dragon Colouring
                </label>
                <label
                  className="menu-checkbox"
                  title='When off, Dynamic Dragon Colouring is not used anywhere. Same setting as Dragon Configuration -> "Disable Dynamic Dragons" (inverted).'
                >
                  <input
                    type="checkbox"
                    checked={!dynamicDragonDisabled}
                    onChange={toggleDynamicDragonDisabled}
                  />
                  Dynamic Dragon Colouring
                </label>
                <label
                  className="menu-checkbox"
                  title={
                    doubleDynamicDragonUnavailableReason ??
                    'When on, the solver also looks for Double Dynamic Dragons. Same setting as Dragon Configuration -> Double Dynamic Dragon Colouring.'
                  }
                >
                  <input
                    type="checkbox"
                    checked={doubleDynamicDragonEnabled}
                    disabled={doubleDynamicDragonUnavailableReason !== null}
                    onChange={() => setDoubleDynamicDragonEnabled((value) => !value)}
                  />
                  Double Dynamic Dragon Colouring
                </label>
              </>
            )}
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <h3 className="dropdown-section-title dropdown-section-title-nowrap">
              Techniques (Non-Colouring)
              <MenuHelpButton topic="Techniques" onClick={() => setHelpOpen({ tab: 'Technique Selections' })} />
            </h3>
            {['Unique Rectangle', 'Bivalue Oddagon', 'BUG+1', 'Avoidable Rectangle'].map((name) => (
              <label key={name} className="menu-checkbox" title={`${name} is always used by the solver.`}>
                <input type="checkbox" checked disabled readOnly />
                {name}
              </label>
            ))}
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
          </div>
          <div className="dropdown-divider" />
          <div className="dropdown-section">
            <h3 className="dropdown-section-title">
              Extreme Techniques
              <MenuHelpButton topic="Extreme Techniques" onClick={() => setHelpOpen({ tab: 'Technique Selections' })} />
            </h3>
            {!exoticTechniquesShown ? (
              <button
                type="button"
                className="dropdown-item"
                title="Advanced techniques, for experienced solvers only."
                onClick={() => setExoticTechniquesShown(true)}
              >
                Show extreme techniques (for -advanced solvers)
                {(() => {
                  const enabledCount =
                    enabledExotic.size + Number(groupedAicEnabled) + Number(alsXzEnabled) + Number(urAicEnabled) + Number(alsAicEnabled)
                  return enabledCount > 0 ? ` - ${enabledCount} enabled` : ''
                })()}
              </button>
            ) : (
              <>
                {(
                  [
                    ['sue de coq', sueDeCoqEnabled, setSueDeCoqEnabled],
                    ['extended ur', extendedUrEnabled, setExtendedUrEnabled],
                  ] as const
                ).map(([technique, enabled, setEnabled]) => (
                  <label
                    key={technique}
                    className="menu-checkbox"
                    title={
                      technique === 'extended ur'
                        ? "When on, the solver looks for Extended Unique Rectangles (Type 1): a Unique Rectangle on a 6-cell deadly pattern. It can then also be allowed inside Dynamic Dragon Colouring (Dragon Configuration menu), and gets its own lesson under Learn techniques. It doesn't affect puzzle generation."
                        : `When on, the solver looks for ${EXOTIC_TECHNIQUE_NAMES[technique]}. It can't be used inside Dynamic Dragon Colouring and doesn't affect puzzle generation.`
                    }
                  >
                    <input type="checkbox" checked={enabled} onChange={() => setEnabled((value) => !value)} />
                    Enable {EXOTIC_TECHNIQUE_NAMES[technique]}
                  </label>
                ))}
                <label
                  className="menu-checkbox"
                  title="When on, the solver looks for Grouped AICs: Generic AICs whose links may go through a group of a digit's candidates in one box and line. It can then also be allowed inside Dynamic Dragon Colouring (Dragon Configuration menu)."
                >
                  <input type="checkbox" checked={groupedAicEnabled} onChange={() => setGroupedAicEnabled((value) => !value)} />
                  Enable Grouped AIC
                </label>
                <label
                  className="menu-checkbox"
                  title="When on, the solver looks for ALS-xz. It can then also be allowed inside Dynamic Dragon Colouring (Dragon Configuration menu)."
                >
                  <input type="checkbox" checked={alsXzEnabled} onChange={() => setAlsXzEnabled((value) => !value)} />
                  Enable ALS-xz
                </label>
                <label
                  className="menu-checkbox"
                  title="When on, the solver looks for UR-AICs: chains that may link through a Unique Rectangle. It can then also be allowed inside Dynamic Dragon Colouring (Dragon Configuration menu)."
                >
                  <input type="checkbox" checked={urAicEnabled} onChange={() => setUrAicEnabled((value) => !value)} />
                  Enable UR-AIC
                </label>
                <label
                  className="menu-checkbox"
                  title="When on, the solver looks for ALS-AICs: chains that may link through an Almost Locked Set. It can then also be allowed inside Dynamic Dragon Colouring (Dragon Configuration menu)."
                >
                  <input type="checkbox" checked={alsAicEnabled} onChange={() => setAlsAicEnabled((value) => !value)} />
                  Enable ALS-AIC
                </label>
                <button type="button" className="dropdown-item" onClick={() => setExoticTechniquesShown(false)}>
                  Hide extreme techniques
                </button>
              </>
            )}
          </div>
        </DropdownMenu>

        <DropdownMenu
          trackingName="Settings"
          label={
            phone ? (
              '⚙'
            ) : (
              <>
                ⚙ Settings <span className="dropdown-caret">▾</span>
              </>
            )
          }
          ariaLabel={phone ? 'Settings' : undefined}
          buttonClassName="settings-trigger"
          panelClassName="settings-panel"
          align="right"
        >
          <div className="dropdown-section">
            <button
              type="button"
              className="dropdown-item settings-reset-button"
              onClick={resetSettingsToDefaults}
              title="Puts every setting, including your custom colours, back to its default. Your puzzle is not touched."
            >
              <span className="settings-reset-icon" aria-hidden="true">
                ↺
              </span>
              Reset to defaults
            </button>
            {/* Dev server only (never in a build): forgets "Never show
                again" and reopens the welcome popup, to test it. */}
            {import.meta.env.DEV && (
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  saveWelcomeDismissed(false)
                  setWelcomeOpen(true)
                }}
              >
                Reset welcome popup (dev only)
              </button>
            )}
            {/* Dev server only: a single Dragon's "Show equivalent AIC" (see
                SudokuDragonAicConverter) - hidden everywhere while off. */}
            {import.meta.env.DEV && (
              <button type="button" className="dropdown-item" aria-pressed={dragonAicDevEnabled} onClick={toggleDragonAicDev}>
                Dragon equivalent AIC: {dragonAicDevEnabled ? 'ON' : 'OFF'} (dev only)
              </button>
            )}
            {/* Dev server only: an AIC row's "Find equivalent Dragon" (see
                SudokuAicDragonConverter) - hidden everywhere while off. */}
            {import.meta.env.DEV && (
              <button type="button" className="dropdown-item" aria-pressed={aicDragonDevEnabled} onClick={toggleAicDragonDev}>
                AIC equivalent Dragon: {aicDragonDevEnabled ? 'ON' : 'OFF'} (dev only)
              </button>
            )}
          </div>
          <div className="dropdown-divider" />
          {/* Keyboard input moved out of Settings: it is now the "Use as
              Keyboard Input" switch in the Solution / Candidates group headers.
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
          */}
          {hasKeyboard && (
            <>
              <div className="dropdown-section">
                <HotkeySettings hotkeys={hotkeys} onChange={setHotkeys} />
              </div>
              <div className="dropdown-divider" />
            </>
          )}
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
            <h3 className="dropdown-section-title">Techniques list</h3>
            <label
              className="menu-checkbox"
              title="Lists every row of every enabled technique, even when an easier technique already finds the same eliminations (unless that easier technique is a Basic Technique). Only the Techniques list changes - the Solve Path is the same either way."
            >
              <input
                type="checkbox"
                checked={allPossibleTechniques}
                // Turning it on asks first (the list gets much longer);
                // cancelling leaves the (controlled) checkbox unchecked.
                onChange={() => (allPossibleTechniques ? setAllPossibleTechniques(false) : setConfirmAllPossibleTechniquesOpen(true))}
              />
              All Possible Techniques
            </label>
          </div>
        </DropdownMenu>
        </div>
        {phone && (
          <DropdownMenu
          trackingName="More"
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
              onClick={() => setTutorialTarget({ tab: 'basics' })}
            >
              Learn techniques
            </button>
            <button type="button" className="dropdown-item" onClick={() => setHelpOpen({})}>
              Settings guide (?)
            </button>
          </DropdownMenu>
        )}
      </div>
    </div>
  )

  // While an imported screenshot's digits await proofreading, the technique
  // sections are off: a misread digit would make every technique, hint and
  // auto-solve wrong, and locking is what turns them into givens.
  const techniquesLockedNotice = ocrProofreadVisible ? (
    <div className="techniques-locked">
      <p className="technique-empty">
        <b>Lock the imported digits first.</b> Check the grid against your screenshot, then lock the digits as givens to
        see the techniques.
      </p>
      {conflictedCells.size > 0 && (
        <p className="ocr-proofread-warning">Some digits clash with each other (outlined in red) - fix them first.</p>
      )}
      <button type="button" className="primary" onClick={onLockOcrDigits} disabled={busy || conflictedCells.size > 0}>
        Lock as givens
      </button>
    </div>
  ) : null

  const techniquePanel = (
    <TechniquePanel
      locked={techniquesLockedNotice}
      tab={techniquePanelTab}
      onTabChange={onTechniquePanelTabChange}
      instances={techniqueInstances}
      wrongCandidates={!candidatesAccurate}
      hiddenByMedusaFilterCount={hiddenByMedusaFilterCount}
      activeId={activeTechniqueId}
      onSelect={onSelectTechnique}
      techniquesRevealed={techniquesRevealed}
      onToggleTechniquesRevealed={onToggleTechniquesRevealed}
      dragonStepIndex={dragonStepIndex}
      onDragonStep={onDragonStep}
      dragonSubstepIndex={dragonSubstepIndex}
      onDragonSubstep={onDragonSubstep}
      solvePath={solvePath}
      activeSolvePathIndex={activeSolvePathIndex}
      onSelectSolvePathStep={onSelectSolvePathStep}
      onApply={onApplyPanelSelection}
      // The touch layout's Hint button is in the toolbar instead.
      onHint={compact ? undefined : onOpenHint}
      onLearn={setTutorialTarget}
      canApply={
        techniquePanelTab === 'solve-path'
          ? activeSolvePathIndex !== null
          : techniquePanelTab === 'find'
            ? !!findInstance
            : techniquePanelTab === 'autocomplete'
              ? !!autocompleteInstance
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
      autocomplete={{
        paintedSwatches,
        onAutocomplete: onAutocompleteMedusa,
        onAutocompleteDragon: () => runAutocompleteDragon(false),
        onAutocompleteDynamicDragon: () => runAutocompleteDragon(true),
        dynamicDragonDisabled,
        result: autocompleteResult,
        resultIsCurrent: autocompleteResultIsCurrent,
      }}
      easySolveEnabled={easySolveEnabled}
      onToggleEasySolve={toggleEasySolveEnabled}
      preferEasierDoubleDragons={preferEasierDoubleDragons}
      onTogglePreferEasierDoubleDragons={togglePreferEasierDoubleDragons}
      preferEasiestDragonTechniques={preferEasiestDragonTechniques}
      onTogglePreferEasiestDragonTechniques={togglePreferEasiestDragonTechniques}
      listEasiestDragonTechniquesFirst={listEasiestDragonTechniquesFirst}
      onToggleListEasiestDragonTechniquesFirst={toggleListEasiestDragonTechniquesFirst}
      solvePathTimeoutMs={solvePathTimeoutMs}
      onSolvePathTimeoutChange={onSolvePathTimeoutChange}
      panelRef={techniquePanelRef}
      fittedHeight={compact ? null : techniquePanelHeight}
      compact={compact}
    />
  )

  const gridElement = (
    <div
      className={['grid', gridWhiteMode ? 'grid-white-mode' : ''].filter(Boolean).join(' ')}
      role="grid"
      aria-label="Sudoku board"
      tabIndex={0}
      data-hotkey-scope
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
                        // An autocompleted Medusa's own candidates keep the
                        // user's paint instead of the green/red/yellow
                        // highlight - see AutocompleteResult.chainKeys.
                        const autocompletePaint = autocompleteDragonPaint?.get(`${r},${c},${digit}`)
                        const showsMedusaPaint =
                          (autocompleteChainKeys?.has(`${r},${c},${digit}`) ?? false) || autocompletePaint !== undefined
                        const isTechniqueUsed =
                          active &&
                          !showsMedusaPaint &&
                          (highlightedTechnique?.usedCandidates.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        const eliminatedSource = dragonHighlight?.eliminatedCandidates ?? highlightedTechnique?.eliminatedCandidates
                        const isTechniqueEliminated =
                          active &&
                          !showsMedusaPaint &&
                          (eliminatedSource?.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        const solvedSource = dragonHighlight?.solvedCandidates ?? highlightedTechnique?.solvedCandidates
                        const isTechniqueSolved =
                          active &&
                          !showsMedusaPaint &&
                          (solvedSource?.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        const blueSource = dragonHighlight?.blueCandidates ?? highlightedTechnique?.blueCandidates
                        const isTechniqueBlue =
                          active &&
                          !autocompleteDragonPaint &&
                          (blueSource?.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        const yellowSource = dragonHighlight?.yellowCandidates ?? highlightedTechnique?.yellowCandidates
                        const isTechniqueYellow =
                          active &&
                          !autocompleteDragonPaint &&
                          (yellowSource?.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        const isTechniqueDarkBlue =
                          active &&
                          !autocompleteDragonPaint &&
                          (dragonHighlight?.darkBlueCandidates.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        const isTechniqueOrange =
                          active &&
                          !autocompleteDragonPaint &&
                          (dragonHighlight?.orangeCandidates.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        // Double Dragon's second Dragon: pink/purple and
                        // lime green/dark green (see foldDragonMoves).
                        const secondDragonColour =
                          active && dragonHighlight
                            ? (
                                [
                                  [dragonHighlight.pinkCandidates, 'technique-pink'],
                                  [dragonHighlight.purpleCandidates, 'technique-purple'],
                                  [dragonHighlight.limeGreenCandidates, 'technique-limegreen'],
                                  [dragonHighlight.darkGreenCandidates, 'technique-darkgreen'],
                                ] as const
                              ).find(([refs]) =>
                                refs.some((ref) => ref.row === r && ref.col === c && ref.digit === digit),
                              )?.[1] ?? null
                            : null
                        const aicCandidateSource = dragonAicChains
                          ? dragonAicChains.flatMap((chain) => chain.candidates)
                          : (dragonAic?.view?.candidates ?? highlightedTechnique?.aicCandidates)
                        // A plain Dragon's equivalent AIC leaves the Dragon's
                        // own colours (and eliminations) as they are: only the
                        // chain's uncoloured candidates turn purple.
                        const keepsDragonColour =
                          !!dragonAic?.view &&
                          (isTechniqueBlue ||
                            isTechniqueYellow ||
                            isTechniqueDarkBlue ||
                            isTechniqueOrange ||
                            isTechniqueEliminated ||
                            isTechniqueSolved)
                        const isTechniqueAic =
                          active &&
                          !keepsDragonColour &&
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
                        // Dev-only equivalent Medusa/Dragon of a chain row:
                        // the chain's own eliminations, ringed so they
                        // stay findable while the colouring builds up.
                        const isAicTarget =
                          active &&
                          (highlightedTechnique?.aicTargetCandidates?.some(
                            (ref) => ref.row === r && ref.col === c && ref.digit === digit,
                          ) ??
                            false)
                        // Double Dragon: coloured by both Dragons (the
                        // first's colour stays when the second absorbs it).
                        const firstDragonColour: DragonHighlightClass | null = isTechniqueBlue
                          ? 'technique-blue'
                          : isTechniqueYellow
                            ? 'technique-yellow'
                            : isTechniqueDarkBlue
                              ? 'technique-darkblue'
                              : isTechniqueOrange
                                ? 'technique-orange'
                                : null
                        // The two-sided rule: one candidate coloured by both
                        // sides (until it is placed).
                        const bothSides =
                          active && dragonHighlight
                            ? dragonHighlight.bothSidesCandidates.find((ref) => ref.row === r && ref.col === c && ref.digit === digit)
                            : undefined
                        const dragonSplit =
                          isTechniqueEliminated || isTechniqueSolved
                            ? null
                            : bothSides
                              ? ([
                                  dragonHighlightClass(bothSides.colors[0], bothSides.secondDragon),
                                  dragonHighlightClass(bothSides.colors[1], bothSides.secondDragon),
                                ] as const)
                              : firstDragonColour && secondDragonColour
                                ? ([firstDragonColour, secondDragonColour] as const)
                                : null
                        const isTechniqueColored =
                          isTechniqueUsed ||
                          isTechniqueEliminated ||
                          isTechniqueSolved ||
                          isTechniqueBlue ||
                          isTechniqueYellow ||
                          isTechniqueDarkBlue ||
                          isTechniqueOrange ||
                          secondDragonColour !== null ||
                          isTechniqueAic ||
                          isTechniqueHypotheticalElimination
                        // A manually painted colour is a pure user
                        // annotation - it only shows through when no
                        // technique highlight is already claiming this
                        // pip's background, so the two never fight.
                        const paint =
                          active && !isTechniqueColored
                            ? autocompleteDragonPaint
                              ? (autocompletePaint ?? null)
                              : candidateColors[r][c][digit - 1]
                            : null
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
                              dragonSplit ? 'candidate-painted technique-dragon-split' : '',
                              !dragonSplit && isTechniqueBlue ? 'technique-blue' : '',
                              !dragonSplit && isTechniqueYellow ? 'technique-yellow' : '',
                              !dragonSplit && isTechniqueDarkBlue ? 'technique-darkblue' : '',
                              !dragonSplit && isTechniqueOrange ? 'technique-orange' : '',
                              !dragonSplit ? (secondDragonColour ?? '') : '',
                              isTechniqueAic ? 'technique-aic' : '',
                              isTechniqueHypotheticalElimination ? 'technique-hypothetical-elimination' : '',
                              isAicTarget ? 'aic-elimination-target' : '',
                              paint ? 'candidate-painted' : '',
                              active && paintColor ? 'paint-target' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={
                              active && paintColor
                                ? (event) => {
                                    event.stopPropagation()
                                    onCandidatePipClick(r, c, digit)
                                  }
                                : undefined
                            }
                          >
                            {paint && renderCandidatePaint(paint, swatchColors)}
                            {dragonSplit && renderDragonSplit(dragonSplit[0], dragonSplit[1])}
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

      {aicLinkOverlay && (
        <svg className="aic-links" viewBox="0 0 900 900" aria-hidden="true">
          {aicLinkOverlay.groups.flatMap(([key, group]) => {
            const pad = PIP_SIZE / 2
            // One outline round a group whose cells sit side by side,
            // otherwise one per cell, so the outline doesn't take in the
            // cells between (see isContiguousGroup).
            const outlines = isContiguousGroup(group.cells) ? [group.cells] : group.cells.map((cell) => [cell])
            return outlines.map((cells, i) => {
              const points = cells.map(([r, c]) => pipCenter(r, c, group.digit))
              const x = Math.min(...points.map((p) => p.x)) - pad
              const y = Math.min(...points.map((p) => p.y)) - pad
              return (
                <rect
                  key={`${key}#${i}`}
                  className="aic-group"
                  x={x}
                  y={y}
                  width={Math.max(...points.map((p) => p.x)) + pad - x}
                  height={Math.max(...points.map((p) => p.y)) + pad - y}
                  rx={pad}
                />
              )
            })
          })}
          {aicLinkOverlay.paths.map((path, index) => (
            <path key={index} className={path.kind === 'strong' ? 'aic-link-strong' : 'aic-link-weak'} d={path.d} />
          ))}
        </svg>
      )}

    </div>
  )

  const importRows = (
    <>
      {ocrProofreadVisible && (
        <div className="ocr-proofread" role="region" aria-label="Check the imported digits">
          <p className="ocr-proofread-text">
            <b>Check the imported digits.</b> Compare the grid with your screenshot, correct any mistakes, then lock them in.
          </p>
          {conflictedCells.size > 0 && (
            <p className="ocr-proofread-warning">Some digits clash with each other (outlined in red) - fix them first.</p>
          )}
          <div className="ocr-proofread-actions">
            <button type="button" onClick={() => setOcrProofreadShowImage((shown) => !shown)}>
              {ocrProofreadShowImage ? 'Hide screenshot' : 'Show screenshot'}
            </button>
            <button type="button" className="primary" onClick={onLockOcrDigits} disabled={busy || conflictedCells.size > 0}>
              Lock as givens
            </button>
          </div>
          {ocrProofreadShowImage && (
            <img className="ocr-proofread-image" src={ocrProofread.imageUrl} alt="The imported screenshot" />
          )}
        </div>
      )}
      <div className="import-row">
        <textarea
          className="import-input"
          placeholder="Paste a sudoku grid in any format (Sudoku.Coach, 81-char string, etc.)"
          rows={1}
          value={importText}
          disabled={busy}
          onChange={(event) => setImportText(event.target.value)}
        />
        <button type="button" onClick={onImport} disabled={busy || importText.trim().length === 0}>
          Import
        </button>
      </div>

      <div className="import-secondary-row" ref={importSecondaryRowRef}>
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
              : 'Drag or paste a screenshot, or '}
          </span>
          {!ocrBusy && (
            <label className="image-import-browse">
              upload
              <input type="file" accept="image/*" onChange={onImageFileSelected} disabled={busy} />
            </label>
          )}
        </div>
        <button
          type="button"
          className="copy-sc-button"
          onClick={onCopyPuzzleAsIs}
          disabled={busy}
          title="Copies the current progress - givens, solved cells, candidates and colours - to your clipboard. Pastes into Sudoku.Coach (without the colours) or back into this app."
        >
          Copy Puzzle As-Is
        </button>
        <button
          type="button"
          className="copy-sc-button"
          onClick={onCopyOriginal}
          disabled={busy}
          title="Copies just the original puzzle (its givens) as an 81-character string (0 = empty) to your clipboard"
        >
          Copy Original
        </button>
      </div>
    </>
  )

  // The Solution and Candidates groups each carry one of these switches; they
  // are two views of the single keyboardMode setting, so exactly one is ever
  // on and clicking either just flips the mode. Lives here rather than in
  // Settings so it is visible right next to the pads it affects.
  const keyboardInputToggle = (mode: 'solution' | 'candidate') => {
    if (!hasKeyboard) {
      return null
    }
    const active = keyboardMode === mode
    return (
      <button
        type="button"
        role="switch"
        aria-checked={active}
        className={['keyboard-input-toggle', mode, active ? 'active' : ''].join(' ')}
        onClick={toggleKeyboardMode}
        title={
          active
            ? `Typing 1-9 on your keyboard ${mode === 'solution' ? 'places a solution digit' : 'toggles a candidate'}. Click to switch the keyboard to ${mode === 'solution' ? 'candidates' : 'solutions'}.`
            : `Click to make typing 1-9 on your keyboard ${mode === 'solution' ? 'place solution digits' : 'toggle candidates'} instead.`
        }
      >
        <span className="keyboard-input-toggle-track" aria-hidden="true">
          <span className="keyboard-input-toggle-knob" />
        </span>
        <span className="keyboard-input-toggle-label">Keyboard Input</span>
      </button>
    )
  }

  const solutionGroup = (
    <section className="control-group solution-group" data-hotkey-scope>
      {/* Each group's one "undo this section" action sits in the header,
          right of the title, rather than as a stray button under the pad -
          the old placement rendered as an unpadded, left-hugging sliver and
          cost a whole row of height per group. */}
      <div className="control-header">
        <h2 className="control-label">Solution</h2>
        {keyboardInputToggle('solution')}
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
    <section className="control-group candidate-group" data-hotkey-scope>
      <div className="control-header">
        <h2 className="control-label">Candidates</h2>
        {keyboardInputToggle('candidate')}
        <button
          type="button"
          className="control-header-action"
          disabled={!selected || selectedIsLocked || selectedIsSolved}
          onClick={() => selected && clearCandidates(selected.row, selected.col)}
          title="Remove every candidate from the selected cell"
        >
          Clear
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
    <section className="control-group paint-group" data-hotkey-scope>
      <div className="control-header">
        <h2 className="control-label">Candidate Colours</h2>
        <div className="control-header-actions">
          <button
            type="button"
            className="control-header-action"
            disabled={!selectedCellHasPaintedColor}
            onClick={onClearCellCandidateColors}
            title="Remove every candidate colour from the selected cell"
          >
            Clear cell
          </button>
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
      </div>
      <div className="paint-swatches">
        {candidateColorSwatches.map((swatch) => (
          <div key={swatch.id} className="paint-swatch-item">
            <div className="paint-swatch-wrapper">
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
            {/* Shape picker: both options always visible side by side, the
                chosen one filled in this colour and the other just a grey
                outline - a single flip-toggle badge (tried first) only
                showed one shape, so it wasn't clear what it was or what
                clicking it would do. */}
            <div className="paint-shape-picker" role="group" aria-label={`${swatch.label} shape`}>
              {CANDIDATE_PAINT_SHAPES.map((shape) => {
                const selectedShape = swatchShapes[swatch.id] === shape
                return (
                  <button
                    key={shape}
                    type="button"
                    className={['paint-shape-option', selectedShape ? 'selected' : ''].filter(Boolean).join(' ')}
                    aria-pressed={selectedShape}
                    aria-label={`${swatch.label}: ${shape}`}
                    title={`Colour ${swatch.label.toLowerCase()} as a ${shape}`}
                    onClick={() => onSetSwatchShape(swatch.id, shape)}
                  >
                    <span
                      className={`paint-shape-glyph paint-shape-glyph-${shape}`}
                      style={selectedShape ? { backgroundColor: swatch.hex } : undefined}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="paint-hint">
        {paintColor
          ? 'Click a candidate to colour it. A second colour performs multi-colouring; the same colour again removes it.'
          : 'Pick a colour, then click candidates to colour them. Shapes can be changed anytime; ✎ changes the colour.'}
      </p>
    </section>
  )

  const highlightGroup = (
    <section className="control-group highlight-group" data-hotkey-scope>
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
    <section
      className={['control-group', 'autosolve-group', ocrProofreadVisible ? 'autosolve-locked' : ''].filter(Boolean).join(' ')}
      // Off until an imported screenshot's digits are locked (see
      // techniquesLockedNotice); inert takes every button out of reach.
      inert={ocrProofreadVisible}
    >
      <h2 className="control-label">Auto-solve</h2>
      {ocrProofreadVisible && <p className="dropdown-hint">Lock the imported digits as givens first.</p>}
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
            className="autosolve-button"
            disabled={busy || filled === 81}
            onClick={onUniqueRectangleType1}
            title="Auto-solve all visible Unique Rectangles (every type)."
          >
            Unique Rectangle
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || filled === 81}
            onClick={onBugPlusN}
            title="Auto-solve BUG+1, BUG+2 or BUG+3, if the grid is currently in one of those patterns."
          >
            BUG+1
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
            Simple Colouring
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
          {/* <button
            type="button"
            className="autosolve-button"
            disabled={busy || !hasAnyCandidates || filled === 81}
            onClick={() => runAutoSolve('Dragon Colouring (bivalue-seeded)', onDragonColouringBivalueSeeded)}
            title="Auto-solve Non-dynamic Dragons that uses a Medusa base that consists of at least 1 bivalue cell"
          >
            Dragon (bivalue)
          </button> */}
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || !hasAnyCandidates || filled === 81}
            onClick={() => runAutoSolve('Dragon Colouring (any Medusa)', onDragonColouringAny)}
            title="Auto-solve Non-dynamic Dragons that use any Medusa base"
          >
            Plain Dragon
          </button>
          <button
            type="button"
            className="autosolve-button"
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
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || !hasAnyCandidates || filled === 81 || !doubleDragonEnabled}
            onClick={() => runAutoSolve('Double Dragon Colouring', onDoubleDragonColouring)}
            title={
              doubleDragonEnabled
                ? 'Auto-solve Double Dragons (two linked Non-dynamic Dragons).'
                : 'Double Dragon Colouring is switched off in Dragon Configuration'
            }
          >
            Double Plain Dragon
          </button>
          <button
            type="button"
            className="autosolve-button"
            disabled={busy || !hasAnyCandidates || filled === 81 || !doubleDynamicDragonEnabled || dynamicDragonDisabled}
            onClick={() => runAutoSolve('Double Dynamic Dragon Colouring', onDoubleDynamicDragonColouring)}
            title={
              doubleDynamicDragonEnabled && !dynamicDragonDisabled
                ? 'Auto-solve Double Dynamic Dragons.  Ones that use AIC will be solved based on the Setting.'
                : 'Double Dynamic Dragon Colouring is switched off in Dragon Configuration'
            }
          >
            Double Dynamic Dragon
          </button>
        </div>
      </div>
      {/* Only while at least one AIC technique is switched on in Technique Selections,
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

  // The desktop layout shows this directly below the grid (by request); the
  // touch layout has no room there - the grid and dock fill the screen - so
  // it joins the status lines on the Solve tab.
  const seRatingPart = (rating: typeof seRating, line: typeof seRatingLine) =>
    line && (
      <span
        className={['se-rating-part', rating?.kind === 'calculating' ? 'se-rating-calculating' : ''].filter(Boolean).join(' ')}
        title={line.title}
      >
        {line.text}
      </span>
    )
  const seRatingElement = (seRatingLine || seCurrentRatingLine) && (
    <p className="se-rating">
      {seRatingPart(seRating, seRatingLine)}
      {seRatingPart(seCurrentRating, seCurrentRatingLine)}
    </p>
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

      {welcomeOpen && (
        <WelcomeModal
          onDismiss={(neverShowAgain, link) => {
            if (neverShowAgain) {
              saveWelcomeDismissed(true)
            }
            setWelcomeOpen(false)
            if (link === 'learn') {
              setTutorialTarget({ tab: 'basics' })
            } else if (link === 'dragon-settings') {
              setHelpOpen({ tab: 'Dragon Configuration' })
            } else if (link === 'techniques') {
              setHelpOpen({ tab: 'Technique Selections' })
            }
          }}
        />
      )}
      {helpOpen && (
        <HelpModal
          onClose={() => setHelpOpen(null)}
          initialTab={helpOpen.tab}
          hideKeyboardShortcuts={!hasKeyboard}
          onOpenTutorial={() => {
            setHelpOpen(null)
            setTutorialTarget({ tab: 'basics' })
          }}
        />
      )}
      {tutorialTarget && (
        <TutorialPage
          initialTab={tutorialTarget.tab}
          extendedUrEnabled={extendedUrEnabled}
          initialGroup={tutorialTarget.group}
          onClose={() => setTutorialTarget(null)}
        />
      )}
      {hintView && (
        <HintModal
          hint={hintView.hint}
          wrongCandidates={!candidatesAccurate}
          revealed={hintView.revealed}
          onNextHint={onNextHint}
          onClose={() => setHintView(null)}
          onOpenTutorial={(target) => {
            setHintView(null)
            setTutorialTarget(target)
          }}
        />
      )}

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
            <b>CAUTION: Unless you have a somewhat decent CPU, I recommend you to turn ON Exhaustive Dragon Colouring first</b>.
          </p>
          <p>
            This setting should be turned ON for Dynamic Dragon analysis purposes only.  Keep it <b>OFF</b> if you are just doing normal puzzle solving.
          </p>
          <p>  
             If this is turned ON right now, expect slower performance and higher CPU usage.  This is because the Dynamic Dragon analysis will be optimized to find more solutions, which requires more CPU cycles. 
          </p>
          <p className="confirm-tip">Tip: turn Exhaustive Dragon Colouring ON first to keep things quick and minimize CPU usage.</p>
        </ConfirmDialog>
      )}
      {confirmAllPossibleTechniquesOpen && (
        <ConfirmDialog
          title="Turn on All Possible Techniques?"
          confirmLabel="Turn it on"
          cancelLabel="Keep it off"
          onConfirm={() => {
            setConfirmAllPossibleTechniquesOpen(false)
            setAllPossibleTechniques(true)
          }}
          onCancel={() => setConfirmAllPossibleTechniquesOpen(false)}
        >
          <p>
            <b>Warning:</b> Enabling "All Possible Techniques" will bloat the Techniques list because every technique will be
            included, even if an easier technique performs the same elims.
          </p>
          <p>Are you sure you want to enable this feature?</p>
        </ConfirmDialog>
      )}
    </>
  )

  if (compact) {
    // A selected Techniques-list row fills the dock (TechniqueFocusView).
    const techniqueFocused =
      compactSection === 'techniques' && techniquePanelTab === 'techniques' && techniquesRevealed && activeTechnique != null
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
          <div className="compact-status">
            {statusLines}
            {seRatingElement}
          </div>
          {autosolveGroup}
          {actionsRow}
        </>
      ),
      import: importRows,
    }
    return (
      <DragonAicContext.Provider value={dragonAicView}>
      <AicDragonContext.Provider value={aicDragonView}>
      <main
        className={[
          'page',
          'compact-layout',
          landscape ? 'compact-landscape' : 'compact-portrait',
          phone ? 'compact-phone' : '',
          techniqueFocused ? 'compact-technique-focused' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPaste={onScopedPaste}
      >
        {!phone && header}
        {toolbar}
        <div className="compact-board">{gridElement}</div>
        {/* Keyed on the tab so switching tabs starts the new one scrolled to
            its top instead of wherever the previous tab was left. */}
        <div
          key={compactSection}
          className={[
            'compact-dock',
            `compact-dock-${compactSection}`,
            // The focused technique (TechniqueFocusView) fills the dock and
            // scrolls only its own text, so the dock itself must not scroll.
            techniqueFocused ? 'compact-dock-focused' : '',
          ]
            .filter(Boolean)
            .join(' ')}
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
      </AicDragonContext.Provider>
      </DragonAicContext.Provider>
    )
  }

  return (
    <DragonAicContext.Provider value={dragonAicView}>
      <AicDragonContext.Provider value={aicDragonView}>
    <main className="page" onKeyDown={onKeyDown} onKeyUp={onKeyUp} onPaste={onScopedPaste}>
      {header}

      {toolbar}

      <div className="board-area">
        {techniquePanel}

        {/* The grid plus the import / screenshot / export rows, kept in one
            column so they sit right under the grid instead of below
            whichever side column (techniques panel, controls) is tallest. */}
        <div className="grid-column" ref={gridColumnRef}>
          {gridElement}

          {seRatingElement}

          {importRows}

          {/* Right under the import rows, not below the status lines. */}
          {actionsRow}
        </div>

        <div className="controls">
          {solutionGroup}

          {candidateGroup}

          {paintGroup}

          {highlightGroup}

          {autosolveGroup}
        </div>
      </div>

      {statusLines}

      {overlays}
    </main>
    </AicDragonContext.Provider>
      </DragonAicContext.Provider>
  )
}
