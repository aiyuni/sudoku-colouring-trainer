import { DEFAULT_RULE3_TECHNIQUES, type Rule3Technique } from './sudoku/SudokuDragonFinder'
import { GENERIC_AIC_MAX_LENGTH } from './sudoku/SudokuGenericAicFinder'
import { THEME_OPTIONS, type ThemeId } from './theme'
import { DEFAULT_HOTKEYS, HOTKEY_ACTIONS, HOTKEY_LABELS, formatHotkey, type HotkeyBindings } from './hotkeys'

/** Every user-adjustable setting, with its default. This is the single
 * source of truth for three things at once: what App's `useState` calls start
 * from, what "Reset to defaults" restores, and the "Default: ..." shown next
 * to each setting in the help page (see helpContent.ts). Change a default
 * here and all three follow.
 *
 * Not in here: the nine candidate paint colours (they're a Record of hex
 * values, kept in App.tsx next to the palette and saved to localStorage) -
 * "Reset to defaults" restores those separately. */
export interface AppSettings {
  keyboardMode: 'solution' | 'candidate'
  showStrongLinks: boolean
  showBivalueCells: boolean
  gridWhiteMode: boolean
  /** Settings -> Theme: the page's colours (theme.ts). 'system' follows the
   * device's light/dark setting. */
  theme: ThemeId
  minBaseMedusaFilter: boolean
  /** Settings -> "Entropy: colour cells by group" (Variant page, Entropy
   * puzzles only): cells narrowed to one or two of the low / middle / high
   * groups are tinted. Drawing only - no technique reads it. */
  entropyGroupMarking: boolean
  /** Settings -> "All Possible Techniques": the Techniques list keeps rows
   * whose eliminations easier (non-basic) rows already make. List only -
   * the solve path and solvability check are unaffected. */
  allPossibleTechniques: boolean
  shortSingleDigitAicEnabled: boolean
  shortAicEnabled: boolean
  genericAicEnabled: boolean
  /** The four fish (Technique Selections -> Techniques), each off by default. Their
   * Dynamic Dragon checkboxes (allowedRule3Techniques) only count while the
   * fish itself is on - see App's effectiveAllowedRule3Techniques. */
  xWingEnabled: boolean
  finnedXWingEnabled: boolean
  swordfishEnabled: boolean
  finnedSwordfishEnabled: boolean
  /** ALS-xz (singly linked), off by default. Its Dynamic Dragon checkbox
   * ('als-xz' in allowedRule3Techniques, also off by default) only counts
   * while this is on, like a fish. */
  alsXzEnabled: boolean
  /** UR-AIC (AICs that may link through a Unique Rectangle), off by default.
   * Its Dynamic Dragon checkbox ('ur-aic' in allowedRule3Techniques, also off
   * by default) only counts while this is on, like ALS-xz. */
  urAicEnabled: boolean
  /** ALS-AIC (AICs that may link through an Almost Locked Set), off by
   * default. Its Dynamic Dragon checkbox ('als-aic' in
   * allowedRule3Techniques, also off by default) only counts while this is
   * on, like UR-AIC. */
  alsAicEnabled: boolean
  /** Grouped AIC (a Generic AIC whose nodes may be groups), off by default.
   * Its Dynamic Dragon checkbox ('grouped aic' in allowedRule3Techniques,
   * also off by default) only counts while this is on, like UR-AIC. */
  groupedAicEnabled: boolean
  /** Technique Selections -> Exotic Techniques (hidden behind a Show button), off by
   * default. Exotic techniques are never used inside Dynamic Dragon or by
   * the puzzle generator. */
  sueDeCoqEnabled: boolean
  /** Extended UR (Type 1, the 6-cell deadly patterns), off by default: an
   * exotic technique like Sue-de-Coq, except that it may be used inside
   * Dynamic Dragon. Its checkbox there ('extended ur' in
   * allowedRule3Techniques, also off by default) only counts while this is
   * on. Also what shows its How It Works sub-tab. */
  extendedUrEnabled: boolean
  /** ON = no Dynamic Dragon Colouring anywhere (Techniques list, solve
   * path, solvability check, Find by elims, auto-solve, generation), so plain
   * Dragon is the strongest technique. Named for what ON does, matching its
   * checkbox. */
  dynamicDragonDisabled: boolean
  /** Double Dragon Colouring (two stuck plain Dragons linked), off by
   * default. Also gates the "Double Dragon Colouring practice puzzle"
   * generator. */
  doubleDragonEnabled: boolean
  /** Double Dynamic Dragon Colouring (two linked Dragons, at least one of
   * them Dynamic), off by default; no effect while Dynamic Dragons are
   * disabled. Also gates its practice-puzzle button. */
  doubleDynamicDragonEnabled: boolean
  allowedRule3Techniques: readonly Rule3Technique[]
  exhaustiveDragonColouring: boolean
  optimizeDragons: boolean
  optimizeDynamicDragons: boolean
  aicLimitPerDragonStep: boolean
  /** Dynamic Dragon: most technique applications one extension may chain
   * (MAX_TECHNIQUES_PER_DRAGON_STEP_OPTIONS); Infinity = no limit. */
  maxTechniquesPerDragonStep: number
  dynamicDragonAutoSolveIncludesAics: boolean
  dragonGenerationDisregardsSingleDigitAic: boolean
  dragonGenerationDisregardsAic: boolean
  dragonGenerationDisregardsGenericAic: boolean
  dynamicDragonPuzzleForbidsPlainDragon: boolean
  /** Only settable ON while dynamicDragonPuzzleForbidsPlainDragon is ON:
   * Dynamic Dragon puzzles also reject positions a Double Dragon solves. */
  dynamicDragonPuzzleForbidsDoubleDragon: boolean
  /** "Dynamic Dragon only uses defaults" (Generate Puzzle menu): Double
   * Dynamic Dragon puzzles come from the defaults-only stock
   * (defaultsDoubleDynamicDragonPuzzleStockData.ts). Dynamic Dragon puzzles
   * are unaffected: the generator (and so its stock) only ever lets Dynamic
   * Dragon use DEFAULT_RULE3_TECHNIQUES already. Live "must not allow plain
   * Dragon" generation was timed for this (2026-10-03) and takes minutes. */
  dynamicDragonPuzzleUsesDefaultsOnly: boolean
  dragonGenerationTimeoutMs: number
  easySolveEnabled: boolean
  /** Solve Path tab, only while Easy Solve is on: a Double Dynamic Dragon
   * using easier techniques than every single Dynamic Dragon needs counts as
   * easier than single Dynamic Dragon. */
  preferEasierDoubleDragons: boolean
  /** Solve Path tab, only while Easy Solve is on: between Dragons of one
   * kind, the one needing the easiest techniques wins before the shortest. */
  preferEasiestDragonTechniques: boolean
  /** Techniques tab: the list shows Dragons of one kind easiest techniques
   * first instead of shortest first. Its own setting - independent of the
   * Solve Path's preferEasiestDragonTechniques, neither affects the other. */
  techniquesListEasiestDragonTechniquesFirst: boolean
  solvePathTimeoutMs: number
  /** Keyboard shortcuts (Settings -> Keyboard shortcuts), see hotkeys.ts. */
  hotkeys: HotkeyBindings
}

export const DEFAULT_SETTINGS: AppSettings = {
  keyboardMode: 'solution',
  showStrongLinks: false,
  showBivalueCells: false,
  gridWhiteMode: true,
  theme: 'system',
  minBaseMedusaFilter: false,
  entropyGroupMarking: false,
  allPossibleTechniques: false,
  shortSingleDigitAicEnabled: false,
  shortAicEnabled: false,
  genericAicEnabled: false,
  xWingEnabled: false,
  finnedXWingEnabled: false,
  swordfishEnabled: false,
  finnedSwordfishEnabled: false,
  alsXzEnabled: false,
  urAicEnabled: false,
  alsAicEnabled: false,
  groupedAicEnabled: false,
  sueDeCoqEnabled: false,
  extendedUrEnabled: false,
  dynamicDragonDisabled: false,
  doubleDragonEnabled: false,
  doubleDynamicDragonEnabled: false,
  allowedRule3Techniques: DEFAULT_RULE3_TECHNIQUES,
  exhaustiveDragonColouring: true,
  optimizeDragons: false,
  optimizeDynamicDragons: false,
  aicLimitPerDragonStep: true,
  maxTechniquesPerDragonStep: Infinity,
  dynamicDragonAutoSolveIncludesAics: false,
  dragonGenerationDisregardsSingleDigitAic: true,
  dragonGenerationDisregardsAic: true,
  dragonGenerationDisregardsGenericAic: true,
  dynamicDragonPuzzleForbidsPlainDragon: false,
  dynamicDragonPuzzleForbidsDoubleDragon: false,
  dynamicDragonPuzzleUsesDefaultsOnly: false,
  dragonGenerationTimeoutMs: 30_000,
  easySolveEnabled: false,
  preferEasierDoubleDragons: false,
  preferEasiestDragonTechniques: true,
  techniquesListEasiestDragonTechniquesFirst: true,
  solvePathTimeoutMs: 12_000,
  hotkeys: DEFAULT_HOTKEYS,
}

/** Threshold for the "Require a bigger base Medusa" toggle - the minimum
 * number of coloured candidates the *starting*, stuck Medusa chain (before
 * any Dragon Colouring extension) must have for a Dragon Colouring or
 * Dynamic Dragon Colouring instance to be shown. */
export const MIN_BASE_MEDUSA_CANDIDATES = 3

/** Options for the "Dragon puzzle generation timeout" setting - how long
 * SudokuDragonPuzzleGenerator.generate() keeps retrying fresh random grids
 * before giving up. A Dynamic-Dragon-only checkpoint especially can be
 * rare, so this is mostly a "how long am I willing to wait" dial rather
 * than a safety cap. */
export const DRAGON_GENERATION_TIMEOUT_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: '15 seconds', ms: 15_000 },
  { label: '30 seconds', ms: 30_000 },
  { label: '1 minute', ms: 60_000 },
  { label: '2 minutes', ms: 120_000 },
  { label: '5 minutes', ms: 300_000 },
]

/** Options for the "Solve path timeout" setting - how long the Solve Path
 * search (buildSolvePath) keeps taking steps before it stops and shows what
 * it has. The same budget decides the "Solvable" verdict under the grid, which
 * runs that search from a fresh autofill: one that runs out of time is
 * reported as "couldn't tell", so a longer timeout means fewer of those. Both
 * run in a Web Worker, so a long one no longer freezes the page. */
export const SOLVE_PATH_TIMEOUT_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: '12 seconds', ms: 12_000 },
  { label: '30 seconds', ms: 30_000 },
  { label: '1 minute', ms: 60_000 },
  { label: '2 minutes', ms: 120_000 },
  { label: '5 minutes', ms: 300_000 },
]

/** Display labels for the Dynamic Dragon Colouring settings checkboxes -
 * one per Rule3Technique, in the same order findExtensionRule3Move checks
 * them in. */
export const RULE3_TECHNIQUE_LABELS: Record<Rule3Technique, string> = {
  'hidden single': 'Hidden Single',
  'locked candidate': 'Locked Candidates',
  'naked pair': 'Naked Pair',
  'naked triple': 'Naked Triple',
  'naked quad': 'Naked Quad',
  'hidden pair': 'Hidden Pair',
  UR: 'Unique Rectangle',
  'bivalue oddagon': 'Bivalue Oddagon',
  'BUG+N': 'BUG+1',  //technically bug+1, bug+2, bug+3, but the label is generic
  'avoidable rectangle': 'Avoidable Rectangle',
  'x-wing': 'X-Wing',
  'short single-digit aic': 'Short Single-Digit AIC',
  'extended ur': 'Extended UR',
  'finned x-wing': 'Finned X-Wing',
  'short aic': 'Short AIC (links <= 5)',
  swordfish: 'Swordfish',
  'finned swordfish': 'Finned Swordfish',
  // The longest chain is set in one place - see GENERIC_AIC_MAX_LENGTH.
  'generic aic': `Generic AIC (links <= ${GENERIC_AIC_MAX_LENGTH})`,
  'grouped aic': `Grouped AIC (links <= ${GENERIC_AIC_MAX_LENGTH})`,
  'als-xz': 'ALS-xz',
  'ur-aic': 'UR-AIC',
  'als-aic': 'ALS-AIC',
}

/** The collapsible sections of Dragon Configuration -> "Select Dynamic Dragon
 * Colouring techniques", by request: every Rule3Technique but Hidden Single
 * (never a choice, see extend()) in exactly one section, each section in
 * ALL_RULE3_TECHNIQUES order. Display grouping only - "Defaults" is the
 * section's name, not DEFAULT_RULE3_TECHNIQUES (Avoidable Rectangle is listed
 * there but still starts unticked). `warning` is shown after the title,
 * collapsed or not. */
export const RULE3_TECHNIQUE_GROUPS: readonly {
  title: string
  warning?: string
  /** How loud the warning is drawn: 'caution' (a quiet "!" note) or 'danger'
   * (the red warning triangle) - Unfair is meant to read as the bigger one. */
  warningLevel?: 'caution' | 'danger'
  collapsedByDefault: boolean
  techniques: readonly Rule3Technique[]
}[] = [
  {
    title: 'Defaults',
    collapsedByDefault: false,
    techniques: [
      'locked candidate',
      'naked pair',
      'naked triple',
      'naked quad',
      'hidden pair',
      'UR',
      'bivalue oddagon',
      'BUG+N',
      'avoidable rectangle',
    ],
  },
  {
    title: 'Advanced Techniques',
    collapsedByDefault: false,
    techniques: ['x-wing', 'short single-digit aic', 'finned x-wing', 'short aic'],
  },
  {
    title: 'Brutal Techniques',
    warning: 'Spotting these techniques inside a Dragon is very challenging. Expand to see.',
    warningLevel: 'caution',
    collapsedByDefault: true,
    techniques: ['swordfish', 'finned swordfish', 'generic aic'],
  },
  {
    title: 'Unfair Techniques',
    warning: 'Beware! These techniques within Dragons are usually inhumane to spot.  Expand to see.',
    warningLevel: 'danger',
    collapsedByDefault: true,
    techniques: ['extended ur', 'grouped aic', 'als-xz', 'ur-aic', 'als-aic'],
  },
]

/** The "Max techniques per step" dropdown's choices (Dynamic Dragon). */
export const MAX_TECHNIQUES_PER_DRAGON_STEP_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, Infinity]

/** A setting's default as a human-readable string, for the help page:
 * on/off for checkboxes, the option's own label for choices, the technique
 * names for the Dynamic Dragon technique set. */
export function describeDefault(key: keyof AppSettings): string {
  const value = DEFAULT_SETTINGS[key]
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off'
  }
  if (key === 'keyboardMode') {
    return value === 'solution' ? 'Solution' : 'Candidates'
  }
  if (key === 'theme') {
    return THEME_OPTIONS.find((option) => option.id === value)?.label ?? String(value)
  }
  if (key === 'dragonGenerationTimeoutMs') {
    return DRAGON_GENERATION_TIMEOUT_OPTIONS.find((option) => option.ms === value)?.label ?? `${Number(value) / 1000} seconds`
  }
  if (key === 'solvePathTimeoutMs') {
    return SOLVE_PATH_TIMEOUT_OPTIONS.find((option) => option.ms === value)?.label ?? `${Number(value) / 1000} seconds`
  }
  if (key === 'maxTechniquesPerDragonStep') {
    return value === Infinity ? 'Infinite' : String(value)
  }
  if (key === 'hotkeys') {
    return HOTKEY_ACTIONS.map((action) => `${HOTKEY_LABELS[action]}: ${formatHotkey(DEFAULT_HOTKEYS[action])}`).join(', ')
  }
  if (Array.isArray(value)) {
    return value.map((technique) => RULE3_TECHNIQUE_LABELS[technique as Rule3Technique]).join(', ')
  }
  return String(value)
}
